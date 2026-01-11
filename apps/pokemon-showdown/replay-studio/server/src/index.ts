import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';

import { exportRequestSchema, poolSchema, trainSettingsSchema } from './schemas.ts';

// Import Pokemon Showdown sim (TypeScript) via tsx runtime
import * as BattleStreamMod from '../../../../../tools/pokemon-showdown/pokemon-showdown/sim/battle-stream.ts';
import * as SimMod from '../../../../../tools/pokemon-showdown/pokemon-showdown/sim/index.ts';

const Sim: any = (SimMod as any).Dex ? (SimMod as any) : (SimMod as any).default;
if (!Sim?.Dex || !Sim?.toID) {
  throw new Error('Failed to load Pokemon Showdown sim exports (Dex/toID)');
}
const Dex: any = Sim.Dex;
const toID: (s: any) => string = Sim.toID;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const repoRoot = path.resolve(__dirname, '..', '..', '..', '..', '..');
const dataRoot = path.join(repoRoot, 'data', 'pokemon-showdown', 'vgc-demo');
const configRoot = path.join(repoRoot, 'config', 'pokemon-showdown', 'vgc-demo');
const localPsClientRoot = path.join(repoRoot, 'tools', 'pokemon-showdown', 'pokemon-showdown-client', 'play.pokemonshowdown.com');

const exportsRoot = path.join(dataRoot, 'exports');
const jobsRoot = path.join(exportsRoot, 'jobs');
const generatedLogsRoot = path.join(dataRoot, 'generated_logs');
const indexPath = path.join(dataRoot, 'index.json');
const psAssetsRoot = path.join(dataRoot, 'ps_assets');

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

ensureDir(exportsRoot);
ensureDir(jobsRoot);
ensureDir(generatedLogsRoot);
ensureDir(configRoot);
ensureDir(psAssetsRoot);

// ---------- Pokemon Showdown client asset proxy/cache ----------
// Rationale: replay viewer loads many assets (CSS/JS/data/sprites). If remote assets fail or are slow,
// the viewer looks "missing textures". We cache the upstream assets under data/ and serve them locally.
const PS_ORIGIN = 'https://play.pokemonshowdown.com';

function sanitizePsPath(p: string) {
  // Ensure we only handle absolute paths like /style/battle.css
  if (!p.startsWith('/')) return null;
  if (p.includes('..')) return null;
  return p;
}

function cacheKeyForPsRequest(urlPath: string, query: string) {
  // Keep stable names while incorporating query (cache busters like ?a7)
  const q = (query || '').replace(/[^a-zA-Z0-9_.=&-]+/g, '_');
  const rel = urlPath.replace(/^\//, '');
  return q ? `${rel}__${q}` : rel;
}

function isTextContentType(ct: string) {
  const c = (ct || '').toLowerCase();
  return (
    c.startsWith('text/') ||
    c.includes('javascript') ||
    c.includes('json') ||
    c.includes('xml') ||
    c.includes('css') ||
    c.includes('svg')
  );
}

function guessContentTypeByPath(p: string) {
  const ext = path.extname(p).toLowerCase();
  if (ext === '.js' || ext === '.mjs') return 'application/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.txt') return 'text/plain; charset=utf-8';
  if (ext === '.html' || ext === '.htm') return 'text/html; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml; charset=utf-8';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.ico') return 'image/x-icon';
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.ogg') return 'audio/ogg';
  return 'application/octet-stream';
}

function patchPlayShowdownAbsoluteUrls(text: string) {
  // Rewrite absolute origin URLs to local root.
  return text
    .replaceAll('//play.pokemonshowdown.com/', '/')
    .replaceAll('//play.pokemonshowdown.com', '')
    .replaceAll('https://play.pokemonshowdown.com/', '/')
    .replaceAll('http://play.pokemonshowdown.com/', '/')
    .replaceAll('https://play.pokemonshowdown.com', '')
    .replaceAll('http://play.pokemonshowdown.com', '')
    // battle-sound.js hardcodes https://${Config.routes.client}/... which breaks local HTTP playback.
    // Rewrite to use the current origin so audio can load from our proxied assets.
    .replaceAll('sound.src="https://"+Config.routes.client+"/"+url;', 'sound.src=location.origin+"/"+url;');
}

async function fetchAndCachePsAsset(urlPath: string, queryString: string) {
  const safePath = sanitizePsPath(urlPath);
  if (!safePath) throw new Error('Invalid asset path');

  const key = cacheKeyForPsRequest(safePath, queryString);
  const filePath = path.join(psAssetsRoot, key);
  const metaPath = `${filePath}.meta.json`;

  if (fs.existsSync(filePath) && fs.existsSync(metaPath)) {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as { contentType?: string };
    let buf = fs.readFileSync(filePath);
    const contentType = meta.contentType || '';
    // Re-apply URL patching even for cached assets, so older caches still get fixed.
    if (isTextContentType(contentType)) {
      try {
        const src = buf.toString('utf8');
        const patched = patchPlayShowdownAbsoluteUrls(src);
        if (patched !== src) {
          buf = Buffer.from(patched, 'utf8');
          fs.writeFileSync(filePath, buf);
        }
      } catch {
        // ignore
      }
    }
    return { buf, contentType };
  }

  // Prefer local, checked-in PS client assets under tools/ to avoid network dependency.
  // We still write into data/ cache so future loads are fast and query-keyed.
  const localFilePath = path.join(localPsClientRoot, safePath.replace(/^\//, ''));
  try {
    const st = fs.statSync(localFilePath);
    if (st.isFile()) {
      const contentType = guessContentTypeByPath(localFilePath);
      let buf = fs.readFileSync(localFilePath);
      if (isTextContentType(contentType)) {
        const src = buf.toString('utf8');
        const patched = patchPlayShowdownAbsoluteUrls(src);
        buf = Buffer.from(patched, 'utf8');
      }

      ensureDir(path.dirname(filePath));
      fs.writeFileSync(filePath, buf);
      fs.writeFileSync(metaPath, JSON.stringify({ contentType }, null, 2), 'utf8');
      return { buf, contentType };
    }
  } catch {
    // fall through to upstream fetch
  }

  const upstreamUrl = `${PS_ORIGIN}${safePath}${queryString ? `?${queryString}` : ''}`;
  const r = await fetch(upstreamUrl);
  if (!r.ok) throw new Error(`Upstream ${r.status} ${r.statusText}`);

  const contentType = r.headers.get('content-type') || '';
  const ab = await r.arrayBuffer();
  let buf = Buffer.from(ab);

  if (isTextContentType(contentType)) {
    const src = buf.toString('utf8');
    const patched = patchPlayShowdownAbsoluteUrls(src);
    buf = Buffer.from(patched, 'utf8');
  }

  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, buf);
  fs.writeFileSync(metaPath, JSON.stringify({ contentType }, null, 2), 'utf8');

  return { buf, contentType };
}

async function servePsAsset(req: express.Request, res: express.Response) {
  try {
    const urlPath = req.path;
    const queryString = req.originalUrl.includes('?') ? req.originalUrl.split('?', 2)[1] : '';
    const { buf, contentType } = await fetchAndCachePsAsset(urlPath, queryString);
    if (contentType) res.setHeader('content-type', contentType);
    // aggressive caching is fine; files are cache-busted by query in upstream and our cache key
    res.setHeader('cache-control', 'public, max-age=31536000, immutable');
    res.send(buf);
  } catch (e: any) {
    res.status(502).type('text/plain').send(String(e?.message ?? e));
  }
}

// Serve a safe subset of PS client assets
app.get(['/style/*', '/js/*', '/data/*', '/config/*', '/sprites/*', '/fx/*', '/images/*', '/audio/*', '/cries/*'], (req, res) => {
  void servePsAsset(req, res);
});

// ---------- Dex helpers (Pokemon Showdown data) ----------
const dex = Dex.mod('gen9');
let dexPrimed = false;
function primeDexOnce() {
  if (dexPrimed) return;
  // Load formats + core data so list endpoints are usable.
  dex.includeFormats();
  dex.loadData();
  dexPrimed = true;
}

type DexListIconSheet = { kind: 'sheet'; url: string; size: number; x: number; y: number };
type DexListIcon = DexListIconSheet;
type DexListRow = { id: string; name: string; icon_url?: string; icon?: DexListIcon; desc?: string };
type DexSpeciesAbility = { slot: string; name: string };
type DexSpeciesStats = { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
type DexSpeciesListRow = DexListRow & {
  num?: number;
  types?: string[];
  abilities?: DexSpeciesAbility[];
  baseStats?: DexSpeciesStats;
};
type DexMoveDetailRow = {
  id: string;
  name: string;
  type: string;
  category?: string;
  basePower: number;
  accuracy: number;
  pp: number;
  desc: string;
};

let cachedSpecies: DexListRow[] | null = null;
let cachedSpeciesDetailed: DexSpeciesListRow[] | null = null;
let cachedItems: DexListRow[] | null = null;
let cachedMoves: DexListRow[] | null = null;
let cachedMovesBasic: { id: string; name: string }[] | null = null;
let cachedMovesDetailed: DexMoveDetailRow[] | null = null;
let cachedAbilities: DexListRow[] | null = null;
let cachedNatures: DexListRow[] | null = null;
let cachedTypes: DexListRow[] | null = null;
let cachedFormats: { id: string; name: string }[] | null = null;

function showdownMonSpriteUrl(species: any) {
  // Use locally proxied/cached sprites (served via /sprites/*).
  // IMPORTANT: many formes use spriteid with dashes (e.g. calyrex-ice), while species.id is toID (calyrexice).
  const spriteId = String(species?.spriteid || species?.id || '').trim();
  return `/sprites/gen5/${encodeURIComponent(spriteId)}.png`;
}

function mapSpeciesAbilities(species: any): DexSpeciesAbility[] {
  const abilities = species?.abilities ?? {};
  const out: DexSpeciesAbility[] = [];
  for (const slot of ['0', '1', 'H', 'S']) {
    const name = abilities?.[slot];
    if (name) out.push({ slot, name: String(name) });
  }
  return out;
}

function showdownItemSpriteUrl(id: string) {
  // Use locally proxied/cached sprites (served via /sprites/*).
  return `/sprites/items/${encodeURIComponent(id)}.png`;
}

function showdownItemIcon(item: any): DexListIconSheet | undefined {
  // Pokemon Showdown teambuilder uses a sprite sheet: /sprites/itemicons-sheet.png
  // Tiles are 24px and the sheet is 16 columns.
  const spriteNum = Number(item?.spritenum ?? 0);
  if (!Number.isFinite(spriteNum)) return undefined;
  const size = 24;
  const cols = 16;
  const idx = Math.max(0, Math.trunc(spriteNum));
  const x = (idx % cols) * size;
  const y = Math.floor(idx / cols) * size;
  return { kind: 'sheet', url: '/sprites/itemicons-sheet.png', size, x, y };
}

function normalizeQuery(q: unknown) {
  const s = String(q ?? '').trim().toLowerCase();
  return s;
}

function toIDLike(text: string) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function scoreQueryMatch(name: string, id: string, qRaw: string): number | null {
  const q = String(qRaw ?? '').trim().toLowerCase();
  if (!q) return 0;

  const qId = toIDLike(q);
  if (!qId) return null;

  const idLower = String(id ?? '').toLowerCase();
  const nameLower = String(name ?? '').toLowerCase();
  const nameId = toIDLike(nameLower);

  // Multi-token queries should match all tokens (similar feel to teambuilder).
  const tokens = q.split(/\s+/g).filter(Boolean);
  for (const t of tokens) {
    const tId = toIDLike(t);
    if (!tId) continue;
    if (!nameId.includes(tId) && !idLower.includes(tId) && !nameLower.includes(t)) return null;
  }

  if (idLower === qId) return 0;
  if (nameId === qId) return 1;
  if (idLower.startsWith(qId)) return 2;
  if (nameId.startsWith(qId)) return 3;
  if (nameLower.startsWith(q)) return 4;

  // word-start match (e.g. "ice f" => "Ice Fang")
  const words = nameLower.split(/[\s\-]+/g).filter(Boolean);
  for (const w of words) {
    if (toIDLike(w).startsWith(qId)) return 5;
  }

  if (nameId.includes(qId) || idLower.includes(qId)) return 6;
  if (nameLower.includes(q)) return 7;
  return null;
}

function applyQuery<T extends { id: string; name: string }>(rows: readonly T[], q: string, limit: number) {
  if (!q) return rows.slice(0, limit);
  const scored: Array<{ row: T; score: number }> = [];
  for (const r of rows) {
    const score = scoreQueryMatch(r.name, r.id, q);
    if (score === null) continue;
    scored.push({ row: r, score });
  }
  scored.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    // tiebreak: shorter names feel closer to teambuilder
    const an = a.row.name.length;
    const bn = b.row.name.length;
    if (an !== bn) return an - bn;
    return a.row.name.localeCompare(b.row.name);
  });
  return scored.slice(0, limit).map((x) => x.row);
}

function moveDetailRow(m: any): DexMoveDetailRow {
  return {
    id: m.id,
    name: m.name,
    type: m.type,
    category: m.category,
    basePower: Number(m.basePower ?? 0) || 0,
    accuracy: m.accuracy === true ? 0 : (Number(m.accuracy ?? 0) || 0),
    pp: Number(m.pp ?? 0) || 0,
    desc: String(m.shortDesc || m.desc || ''),
  };
}

app.get('/api/dex/species', (req, res) => {
  primeDexOnce();
  const q = normalizeQuery(req.query.q);
  const detail = String(req.query.detail ?? '').toLowerCase();
  const detailEnabled = detail === '1' || detail === 'true' || detail === 'yes';
  const limit = Math.min(1000, Math.max(1, Number(req.query.limit ?? 300)));
  if (detailEnabled) {
    if (!cachedSpeciesDetailed) {
      cachedSpeciesDetailed = dex.species
        .all()
        .filter((s) => s.exists && !s.isNonstandard)
        .map((s) => ({
          id: s.id,
          name: s.name,
          num: Number(s.num ?? 0) || 0,
          icon_url: showdownMonSpriteUrl(s),
          types: Array.isArray(s.types) ? s.types.slice() : [],
          abilities: mapSpeciesAbilities(s),
          baseStats: s.baseStats as DexSpeciesStats,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    res.json({ items: applyQuery(cachedSpeciesDetailed, q, limit) });
    return;
  }

  if (!cachedSpecies) {
    cachedSpecies = dex.species
      .all()
      .filter((s) => s.exists && !s.isNonstandard)
      .map((s) => ({ id: s.id, name: s.name, icon_url: showdownMonSpriteUrl(s) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  res.json({ items: applyQuery(cachedSpecies, q, limit) });
});

app.get('/api/dex/species/:id', (req, res) => {
  primeDexOnce();
  const id = toID(req.params.id);
  if (!id) return res.status(400).json({ error: 'id required' });
  const s = dex.species.get(id);
  if (!s?.exists) return res.status(404).json({ error: 'not found' });
  res.json({
    id: s.id,
    name: s.name,
    types: s.types,
    baseStats: s.baseStats,
    abilities: Object.values(s.abilities ?? {}).filter(Boolean),
    icon_url: showdownMonSpriteUrl(s),
  });
});

app.get('/api/dex/items', (req, res) => {
  primeDexOnce();
  if (!cachedItems) {
    cachedItems = dex.items
      .all()
      .filter((i) => i.exists && !i.isNonstandard)
      // Items don't have per-item PNGs on play.pokemonshowdown.com; the official teambuilder uses the sprite sheet.
      .map((i) => ({ id: i.id, name: i.name, icon: showdownItemIcon(i), desc: String(i.shortDesc || i.desc || '') }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  const q = normalizeQuery(req.query.q);
  const limit = Math.min(2000, Math.max(1, Number(req.query.limit ?? 400)));
  res.json({ items: applyQuery(cachedItems, q, limit) });
});

app.get('/api/dex/abilities', (req, res) => {
  primeDexOnce();
  if (!cachedAbilities) {
    cachedAbilities = dex.abilities
      .all()
      .filter((a) => a.exists && !a.isNonstandard)
      .map((a) => ({ id: a.id, name: a.name, desc: String(a.shortDesc || a.desc || '') }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  const q = normalizeQuery(req.query.q);
  const limit = Math.min(2000, Math.max(1, Number(req.query.limit ?? 400)));
  res.json({ items: applyQuery(cachedAbilities, q, limit) });
});

app.get('/api/dex/moves', (req, res) => {
  primeDexOnce();
  const q = normalizeQuery(req.query.q);
  const detail = String(req.query.detail ?? '').toLowerCase();
  const detailEnabled = detail === '1' || detail === 'true' || detail === 'yes';

  // Detailed move rows can be large (desc text). Only return them for search queries.
  if (detailEnabled) {
    const limit = Math.min(4000, Math.max(1, Number(req.query.limit ?? 120)));
    if (!cachedMovesDetailed) {
      cachedMovesDetailed = dex.moves
        .all()
        .filter((m) => m.exists && !m.isNonstandard)
        .map(moveDetailRow)
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    if (!q) return res.json({ items: cachedMovesDetailed.slice(0, limit) });

    const scored: Array<{ row: DexMoveDetailRow; score: number }> = [];
    for (const row of cachedMovesDetailed) {
      const score = scoreQueryMatch(row.name, row.id, q);
      if (score === null) continue;
      scored.push({ score, row });
    }
    scored.sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      const an = a.row.name.length;
      const bn = b.row.name.length;
      if (an !== bn) return an - bn;
      return a.row.name.localeCompare(b.row.name);
    });
    return res.json({ items: scored.slice(0, limit).map((x) => x.row) });
  }

  if (!cachedMoves) {
    cachedMoves = dex.moves
      .all()
      .filter((m) => m.exists && !m.isNonstandard)
      .map((m) => ({ id: m.id, name: m.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  const limit = Math.min(4000, Math.max(1, Number(req.query.limit ?? 800)));
  res.json({ items: applyQuery(cachedMoves, q, limit) });
});

app.get('/api/dex/move/:id', (req, res) => {
  primeDexOnce();
  const id = toID(req.params.id);
  if (!id) return res.status(400).json({ error: 'id required' });
  const m = dex.moves.get(id);
  if (!m?.exists) return res.status(404).json({ error: 'not found' });
  res.json({
    id: m.id,
    name: m.name,
    type: m.type,
    category: m.category,
    basePower: Number(m.basePower ?? 0) || 0,
    accuracy: m.accuracy === true ? 0 : (Number(m.accuracy ?? 0) || 0),
    pp: Number(m.pp ?? 0) || 0,
    desc: String(m.shortDesc || m.desc || ''),
  });
});

app.get('/api/dex/natures', (req, res) => {
  primeDexOnce();
  if (!cachedNatures) {
    const natures = dex.data.Natures as any;
    cachedNatures = Object.keys(natures)
      .map((k) => {
        const n = natures[k];
        if (!n?.name) return null;
        return { id: toID(n.name), name: n.name };
      })
      .filter((x): x is DexListRow => Boolean(x))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  const q = normalizeQuery(req.query.q);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 200)));
  res.json({ items: applyQuery(cachedNatures, q, limit) });
});

app.get('/api/dex/types', (req, res) => {
  primeDexOnce();
  if (!cachedTypes) {
    // Use Dex type data (canonical names).
    const typesObj = (dex.data as any)?.Types ?? {};
    cachedTypes = Object.keys(typesObj)
      .map((k) => {
        const t = typesObj[k];
        const name = String(t?.name ?? k);
        const id = toID(name);
        if (!id) return null;
        // exclude ??? if present
        if (name === '???' || id === '???') return null;
        return { id, name };
      })
      .filter((x): x is DexListRow => Boolean(x))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  const q = normalizeQuery(req.query.q);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));
  res.json({ items: applyQuery(cachedTypes, q, limit) });
});

app.get('/api/dex/formats', (req, res) => {
  primeDexOnce();
  if (!cachedFormats) {
    cachedFormats = dex.formats
      .all()
      .filter((f: any) => f?.id && f?.name)
      .map((f: any) => ({ id: String(f.id), name: String(f.name) }));
  }
  const q = normalizeQuery(req.query.q);
  const only = String(req.query.only ?? '').toLowerCase();
  let rows = cachedFormats;
  if (only === 'vgc') {
    rows = rows.filter((f) => f.id.includes('vgc') || f.name.toLowerCase().includes('vgc'));
  }
  const limit = Math.min(2000, Math.max(1, Number(req.query.limit ?? (only === 'vgc' ? 200 : 500))));
  const items = applyQuery(rows, q, limit);
  res.json({ items });
});

function safeJsonParse(line: string) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

async function readJsonl(filePath: string, onRow: (row: any) => Promise<void> | void) {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const row = safeJsonParse(line);
    if (!row) continue;
    await onRow(row);
  }
}

async function readJsonlGz(filePath: string, onRow: (row: any) => Promise<void> | void) {
  const fileStream = fs.createReadStream(filePath);
  const gunzip = zlib.createGunzip();
  const stream = fileStream.pipe(gunzip);
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!String(line).trim()) continue;
    const row = safeJsonParse(String(line));
    if (!row) continue;
    await onRow(row);
  }
}

function listTrainDirs() {
  if (!fs.existsSync(dataRoot)) return [] as string[];
  return fs
    .readdirSync(dataRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith('train_'))
    .map((d) => path.join(dataRoot, d.name));
}

function inferOpponentType(opponentId: unknown) {
  if (!opponentId) return 'unknown';
  const s = String(opponentId);
  if (s.startsWith('snapshot:')) return 'snapshot';
  if (s.startsWith('policy:')) return 'agent';
  return 'unknown';
}

type IndexEntry = {
  battle_id: string;
  run_id: string | null;
  format: string | null;
  winner: string | null;
  turns: number | null;
  seed: number | null;
  opponent_id: string | null;
  opponent_type: string;
  error_rate: number | null;
  timestamp: string | null;
  train_dir: string;
};

type IndexFile = {
  version: 1;
  created_at: string;
  entries: IndexEntry[];
};

async function buildIndex(): Promise<IndexFile> {
  const entries: IndexEntry[] = [];

  for (const trainDir of listTrainDirs()) {
    const batchesPath = path.join(trainDir, 'batches.jsonl');
    const replaysPath = path.join(trainDir, 'replays.jsonl');
    const replaysGzPath = path.join(trainDir, 'replays.jsonl.gz');

    const batchErrorRate = new Map<string, number>();
    if (fs.existsSync(batchesPath)) {
      await readJsonl(batchesPath, async (row) => {
        if (row.batch_id && row.summary && typeof row.summary.error_rate === 'number') {
          batchErrorRate.set(String(row.batch_id), row.summary.error_rate);
        }
      });
    }

    // IMPORTANT: Only index battles that have a replay record. This prevents the UI from listing
    // entries that cannot be opened/logged/exported.
    const hasReplays = fs.existsSync(replaysPath) || fs.existsSync(replaysGzPath);
    if (!hasReplays) continue;

    const reader = fs.existsSync(replaysPath) ? readJsonl : readJsonlGz;
    const filePath = fs.existsSync(replaysPath) ? replaysPath : replaysGzPath;

    await reader(filePath, async (row) => {
      const battleId = row.battle_id;
      if (!battleId) return;

      const batchId = row.batch_id ?? null;
      const opponentId = row.opponent_id ?? null;
      entries.push({
        battle_id: String(battleId),
        run_id: row.run_id ?? null,
        format: row.format ?? null,
        winner: row.expected_winner ?? row.winner ?? null,
        turns: typeof row.expected_turns === 'number' ? row.expected_turns : typeof row.turns === 'number' ? row.turns : null,
        seed: typeof row.seed === 'number' ? row.seed : null,
        opponent_id: opponentId,
        opponent_type: inferOpponentType(opponentId),
        error_rate: batchId != null ? batchErrorRate.get(String(batchId)) ?? null : null,
        timestamp: row.started_at ?? row.finished_at ?? null,
        train_dir: path.basename(trainDir),
      });
    });
  }

  entries.sort((a, b) => String(b.timestamp ?? '').localeCompare(String(a.timestamp ?? '')));

  const index: IndexFile = {
    version: 1,
    created_at: new Date().toISOString(),
    entries,
  };

  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), 'utf8');
  return index;
}

async function loadIndex({ refresh = false } = {}) {
  const shouldAutoRefresh = () => {
    if (!fs.existsSync(indexPath)) return true;
    let indexMtime = 0;
    try {
      indexMtime = fs.statSync(indexPath).mtimeMs;
    } catch {
      return true;
    }

    // If any train dir (or its replay file) is newer than the saved index,
    // rebuild so the UI can see newly generated runs without a server restart.
    for (const trainDir of listTrainDirs()) {
      try {
        if (fs.statSync(trainDir).mtimeMs > indexMtime + 1) return true;
      } catch {
        continue;
      }

      const replayPath = path.join(trainDir, 'replays.jsonl');
      const replayGzPath = path.join(trainDir, 'replays.jsonl.gz');
      for (const p of [replayPath, replayGzPath]) {
        if (!fs.existsSync(p)) continue;
        try {
          if (fs.statSync(p).mtimeMs > indexMtime + 1) return true;
        } catch {
          // ignore
        }
      }
    }

    return false;
  };

  const effectiveRefresh = refresh || shouldAutoRefresh();
  if (!effectiveRefresh && fs.existsSync(indexPath)) {
    try {
      return JSON.parse(fs.readFileSync(indexPath, 'utf8')) as IndexFile;
    } catch {
      // fallthrough
    }
  }
  return await buildIndex();
}

async function findReplayRecord(trainDirName: string, battleId: string) {
  const trainDir = path.join(dataRoot, trainDirName);
  const replayPath = path.join(trainDir, 'replays.jsonl');
  const replayGzPath = path.join(trainDir, 'replays.jsonl.gz');
  if (!fs.existsSync(replayPath) && !fs.existsSync(replayGzPath)) return null;

  let found: any = null;

  const reader = fs.existsSync(replayPath) ? readJsonl : readJsonlGz;
  const p = fs.existsSync(replayPath) ? replayPath : replayGzPath;
  await reader(p, async (row) => {
    if (row.battle_id === battleId) found = row;
  });
  return found;
}

async function generateBattleLog(record: any) {
  const BS: any = (BattleStreamMod as any).BattleStream ? (BattleStreamMod as any) : (BattleStreamMod as any).default;
  if (!BS?.BattleStream || !BS?.getPlayerStreams) {
    throw new Error('Failed to load Pokemon Showdown BattleStream exports');
  }

  const stream = new BS.BattleStream({ debug: false });
  const players = BS.getPlayerStreams(stream);

  const lines: string[] = [];

  const splitFirst = (str: string, delimiter: string) => {
    const idx = str.indexOf(delimiter);
    if (idx < 0) return [str, ''];
    return [str.slice(0, idx), str.slice(idx + delimiter.length)];
  };

  class ReplayPlayer {
    name: 'p1' | 'p2';
    stream: any;
    lastRequest: any = null;

    constructor(name: 'p1' | 'p2', stream: any) {
      this.name = name;
      this.stream = stream;
    }

    async start() {
      for await (const chunk of this.stream) {
        for (const line of String(chunk).split('\n')) {
          this.receiveLine(line);
        }
      }
    }

    receiveLine(line: string) {
      if (!line.startsWith('|')) return;
      const [cmd, rest] = splitFirst(line.slice(1), '|');
      if (cmd === 'request') {
        try {
          this.lastRequest = JSON.parse(rest);
        } catch {
          this.lastRequest = null;
        }
      }
    }

    choose(choice: string) {
      void this.stream.write(choice);
    }
  }

  const p1 = new ReplayPlayer('p1', players.p1);
  const p2 = new ReplayPlayer('p2', players.p2);

  void p1.start();
  void p2.start();

  let ended = false;
  let sawResult = false;
  let spectatorError: any = null;

  const spectatorDone = (async () => {
    for await (const chunk of players.spectator) {
      for (const line of String(chunk).split('\n')) {
        if (line) lines.push(line);
        if (line.startsWith('|win|') || line.startsWith('|tie|')) {
          ended = true;
          sawResult = true;
        }
      }
    }
  })().catch((err: any) => {
    spectatorError = err ?? new Error('Spectator stream failed');
    ended = true;
  });

  const seedArr = Array.isArray(record.start_seed) && record.start_seed.length === 4 ? record.start_seed : [record.seed, record.seed + 1, record.seed + 2, record.seed + 3];

  const startOptions = {
    formatid: record.format,
    seed: seedArr.join(','),
  };

  await stream.write(`>start ${JSON.stringify(startOptions)}\n`);
  await stream.write(`>player p1 ${JSON.stringify({ name: 'p1', team: record.p1_team })}\n`);
  await stream.write(`>player p2 ${JSON.stringify({ name: 'p2', team: record.p2_team })}\n`);

  const p1q: string[] = [...(record.p1_choices ?? [])];
  const p2q: string[] = [...(record.p2_choices ?? [])];

  const started = Date.now();
  const deadlineMs = started + 30_000;

  while (!ended) {
    if (Date.now() > deadlineMs) throw new Error('Replay log generation timed out');

    const r1 = p1.lastRequest;
    const r2 = p2.lastRequest;

    if (r1?.wait) p1.lastRequest = null;
    if (r2?.wait) p2.lastRequest = null;

    if (r1 && !r1.wait) {
      const choice = p1q.shift();
      if (!choice) throw new Error('Replay ran out of p1 choices');
      p1.lastRequest = null;
      p1.choose(choice);
    }

    if (r2 && !r2.wait) {
      const choice = p2q.shift();
      if (!choice) throw new Error('Replay ran out of p2 choices');
      p2.lastRequest = null;
      p2.choose(choice);
    }

    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  if (spectatorError) {
    throw spectatorError;
  }

  if (!sawResult) {
    throw new Error(`Replay ended without win/tie (produced ${lines.length} log lines)`);
  }

  // Give the spectator stream a moment to flush any final lines.
  await Promise.race([spectatorDone, new Promise<void>((resolve) => setTimeout(resolve, 2_000))]);

  return lines.join('\n');
}

async function getOrCreateBattleLog(trainDirName: string, battleId: string) {
  const logPath = path.join(generatedLogsRoot, `${battleId}.log`);
  if (fs.existsSync(logPath)) {
    const cached = fs.readFileSync(logPath, 'utf8');
    const hasProgress = cached.includes('\n|turn|') || cached.includes('\n|win|') || cached.includes('\n|tie|');
    // If a cached log never progressed beyond pre-battle lines, regenerate.
    if (hasProgress) return cached;
  }

  const record = await findReplayRecord(trainDirName, battleId);
  if (!record) {
    throw new Error(
      `Replay record not found: ${battleId} (no replays.jsonl in ${trainDirName}; replay saving may have been disabled)`
    );
  }

  const logText = await generateBattleLog(record);
  fs.writeFileSync(logPath, logText, 'utf8');
  return logText;
}

function readOrCreateConfig(filePath: string, schema: any, defaults: any) {
  ensureDir(path.dirname(filePath));
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaults, null, 2), 'utf8');
    return defaults;
  }
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return schema.parse(raw);
}

function writeConfig(filePath: string, schema: any, data: any) {
  ensureDir(path.dirname(filePath));
  const parsed = schema.parse(data);
  const withUpdated = { ...parsed, updated_at: new Date().toISOString() };
  fs.writeFileSync(filePath, JSON.stringify(withUpdated, null, 2), 'utf8');
  return withUpdated;
}

// ---------- API: replays list ----------
app.get('/api/replays', async (req, res) => {
  const refresh = req.query.refresh === '1';
  const page = Math.max(1, Number(req.query.page ?? 1));
  const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize ?? 50)));

  const format = req.query.format ? String(req.query.format) : null;
  const winner = req.query.winner ? String(req.query.winner) : null;
  const minTurns = req.query.minTurns != null ? Number(req.query.minTurns) : null;
  const maxTurns = req.query.maxTurns != null ? Number(req.query.maxTurns) : null;
  const opponentType = req.query.opponentType ? String(req.query.opponentType) : null;
  const q = req.query.q ? String(req.query.q).toLowerCase() : null;

  const index = await loadIndex({ refresh });
  let rows = index.entries;

  if (format) rows = rows.filter((r) => r.format === format);
  if (winner) rows = rows.filter((r) => r.winner === winner);
  if (opponentType) rows = rows.filter((r) => r.opponent_type === opponentType);
  if (minTurns != null && !Number.isNaN(minTurns)) rows = rows.filter((r) => (r.turns ?? 0) >= minTurns);
  if (maxTurns != null && !Number.isNaN(maxTurns)) rows = rows.filter((r) => (r.turns ?? 0) <= maxTurns);
  if (q) rows = rows.filter((r) => String(r.battle_id).toLowerCase().includes(q));

  const total = rows.length;
  const start = (page - 1) * pageSize;
  const items = rows.slice(start, start + pageSize);

  res.json({
    page,
    pageSize,
    total,
    items,
    formats: Array.from(new Set(index.entries.map((r) => r.format).filter(Boolean))).sort(),
  });
});

app.get('/api/replays/:battleId', async (req, res) => {
  const battleId = req.params.battleId;
  const index = await loadIndex({ refresh: false });
  const meta = index.entries.find((e) => e.battle_id === battleId);
  if (!meta) return res.status(404).json({ error: 'battle_id not found in index' });

  const record = await findReplayRecord(meta.train_dir, battleId);
  if (!record) {
    return res.status(404).json({
      error: 'replay_record_missing',
      message:
        'This battle is indexed (from battles.jsonl) but no replay record exists (replays.jsonl / replays.jsonl.gz is missing for this train_dir). Rerun with replay saving enabled (VGC_SAVE_REPLAY=1) and sample rate 1 (VGC_SAVE_SAMPLE_RATE=1) if you want to view it in Replay Studio.',
      meta,
    });
  }
  res.json({ meta, record });
});

app.get('/api/replays/:battleId/log', async (req, res) => {
  const battleId = req.params.battleId;
  const index = await loadIndex({ refresh: false });
  const meta = index.entries.find((e) => e.battle_id === battleId);
  if (!meta) return res.status(404).json({ error: 'battle_id not found in index' });

  try {
    const logText = await getOrCreateBattleLog(meta.train_dir, battleId);
    res.type('text/plain').send(logText);
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    if (msg.includes('Replay record not found:')) {
      return res.status(404).json({ error: 'replay_record_missing', message: msg, meta });
    }
    res.status(500).json({ error: msg });
  }
});

// ---------- Replay viewer (official UI, not custom rendering) ----------
app.get('/viewer/:battleId', async (req, res) => {
  const battleId = req.params.battleId;
  const index = await loadIndex({ refresh: false });
  const meta = index.entries.find((e) => e.battle_id === battleId);
  if (!meta) return res.status(404).send('battle_id not found');

  const autoplay = String(req.query.autoplay ?? '').toLowerCase();
  const autoplayEnabled = autoplay === '1' || autoplay === 'true' || autoplay === 'yes';
  const embed = String(req.query.embed ?? '').toLowerCase();
  const embedEnabled = embed === '1' || embed === 'true' || embed === 'yes';
  const exportMode = String(req.query.export ?? '').toLowerCase();
  const exportEnabled = exportMode === '1' || exportMode === 'true' || exportMode === 'yes';
  const subtitles = String(req.query.subtitles ?? '').toLowerCase();
  const subtitlesEnabled = subtitles === '' || subtitles === '1' || subtitles === 'true' || subtitles === 'yes';
  const speed = String(req.query.speed ?? '').toLowerCase();
  const speedValue = ['hyperfast', 'fast', 'normal', 'slow', 'reallyslow'].includes(speed) ? speed : '';

  let logText = '';
  try {
    logText = await getOrCreateBattleLog(meta.train_dir, battleId);
  } catch (e: any) {
    res.status(500).send(String(e?.message ?? e));
    return;
  }

  const escaped = logText.replace(/<\/script/gi, '<\\/script');

  res.type('text/html').send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Replay ${battleId}</title>
  <style>
    html, body { height: 100%; width: 100%; margin: 0; padding: 0; }
    body { overflow: ${(embedEnabled || exportEnabled) ? 'hidden' : 'auto'}; }
    /* IMPORTANT: replay-embed.js expects a .wrapper to exist; if absent it appends one to <body>.
       When it appends, it bypasses our layout container and often ends up visually broken.
       We provide the exact wrapper skeleton it uses so CSS/layout match the official viewer. */
    .wrapper.replay-wrapper {
      max-width: ${(embedEnabled || exportEnabled) ? 'none' : '1180px'};
      margin: ${(embedEnabled || exportEnabled) ? '0' : '0 auto'};
      width: ${(embedEnabled || exportEnabled) ? '100%' : 'auto'};
    }
    ${(embedEnabled || exportEnabled) ? 'body { background: transparent; }' : ''}
    ${embedEnabled && !exportEnabled ? `
      /* Embed viewer: fixed height, responsive width.
         The gray background area should stretch horizontally with the window.
         Height stays fixed so layout is stable and matches the UI container. */
      html, body { width: 100%; height: 460px; overflow: hidden; }
      .wrapper.replay-wrapper { width: 100%; height: 460px; overflow: hidden; padding: 0 !important; }
      /* Center the replay UI in the available width. */
      .wrapper.replay-wrapper > * { margin-left: auto; margin-right: auto; }
      .wrapper.replay-wrapper .battle { margin: 0 !important; }
    ` : ''}
    ${exportEnabled ? `
      /* Export mode: force battle box size and remove side panes/controls from layout.
         We still keep the elements in DOM so replay-embed.js can bind normally. */
      html, body { overflow: hidden; }
      .wrapper.replay-wrapper { width: 641.6px; height: 361.6px; position: relative; padding: 0 !important; }
      .wrapper.replay-wrapper .battle {
        width: 641.6px !important;
        height: 361.6px !important;
        box-sizing: border-box !important;
        border: 0 !important;
        margin: 0 !important;
        position: absolute !important;
        left: 0 !important;
        top: 0 !important;
      }
      .wrapper.replay-wrapper .battle-log,
      .wrapper.replay-wrapper .battle-log { display: none !important; }
      /* Keep controls mounted so replay-embed.js can bind and our automation can query them,
         but keep them out of layout and invisible so they don't end up in the recording. */
      .wrapper.replay-wrapper .replay-controls,
      .wrapper.replay-wrapper .replay-controls-2 {
        position: absolute !important;
        left: 0 !important;
        top: 0 !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }

      /* Hide the in-battle big Play / Play (sound off) overlay buttons. */
      .wrapper.replay-wrapper .playbutton,
      .wrapper.replay-wrapper .playbutton1,
      .wrapper.replay-wrapper .playbutton2 {
        display: none !important;
      }
    ` : ''}
    ${subtitlesEnabled ? '' : '.messagebar { opacity: 0 !important; }'}
  </style>
</head>
<body>
  <input type="hidden" name="replayid" value="${battleId}" />
  <script type="text/plain" class="battle-log-data">${escaped}</script>
  <div class="wrapper replay-wrapper">
    <div class="battle"></div>
    <div class="battle-log"></div>
    <div class="replay-controls"></div>
    <div class="replay-controls-2"></div>
  </div>
  <script src="/js/replay-embed.js"></script>
  <script>
  (function() {
    var autoplay = ${autoplayEnabled ? 'true' : 'false'};
    var speed = ${JSON.stringify(speedValue)};

    var attempts = 0;
    var timer = setInterval(function() {
      attempts++;
      try {
        if (!window.Replays || !window.Replays.battle) {
          if (attempts > 500) clearInterval(timer);
          return;
        }

        if (speed) {
          var speedBtn = document.querySelector('.speedchooser button[value="' + speed + '"]');
          if (speedBtn) speedBtn.click();
        }

        if (autoplay) {
          var playBtn = document.querySelector('.replay-controls button[data-action="play"]');
          if (playBtn) playBtn.click();
        }
        clearInterval(timer);
      } catch (e) {
        if (attempts > 500) clearInterval(timer);
      }
    }, 50);
  })();
  </script>
</body>
</html>`);
});

// ---------- Config: pool/settings ----------
const poolPath = path.join(configRoot, 'pool.json');
const settingsPath = path.join(configRoot, 'train_settings.json');

app.get('/api/config/pool', (req, res) => {
  try {
    const cfg = readOrCreateConfig(poolPath, poolSchema, { version: 1, updated_at: new Date().toISOString(), team6: [], pool: [] });
    res.json(cfg);
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

app.put('/api/config/pool', (req, res) => {
  try {
    const saved = writeConfig(poolPath, poolSchema, req.body);
    res.json(saved);
  } catch (e: any) {
    res.status(400).json({ error: String(e?.message ?? e) });
  }
});

app.get('/api/config/settings', (req, res) => {
  try {
    const cfg = readOrCreateConfig(settingsPath, trainSettingsSchema, {
      version: 1,
      updated_at: new Date().toISOString(),
      format: 'gen9vgc2026regf',
      epochs: 1,
      snapshotEvery: 1,
      opponentPool: [],
      seed: 0,
      battlesPerBatch: 20,
      timeoutMs: 30000,
    });
    res.json(cfg);
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

app.put('/api/config/settings', (req, res) => {
  try {
    const saved = writeConfig(settingsPath, trainSettingsSchema, req.body);
    res.json(saved);
  } catch (e: any) {
    res.status(400).json({ error: String(e?.message ?? e) });
  }
});

// ---------- Export jobs ----------
function jobPath(battleId: string) {
  return path.join(jobsRoot, `${battleId}.json`);
}

function writeJob(battleId: string, patch: any) {
  const p = jobPath(battleId);
  const prev = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : { battle_id: battleId };
  const next = { ...prev, ...patch };
  fs.writeFileSync(p, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function readJob(battleId: string) {
  const p = jobPath(battleId);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

async function resolveFfmpegPath() {
  const local = path.join(repoRoot, 'tools', 'ffmpeg', 'bin', 'ffmpeg.exe');
  if (fs.existsSync(local)) return local;
  return 'ffmpeg';
}

async function runExportJob(opts: { battleId: string; jobId: string; port: number }) {
  let playwright: any;
  try {
    playwright = await import('playwright');
  } catch {
    throw new Error('Playwright is not installed. Run: npm i (in apps/pokemon-showdown/replay-studio/server) and then: npx playwright install chromium');
  }

  const { chromium } = playwright;
  const tmpDir = path.join(exportsRoot, 'tmp', `${opts.jobId}-${Date.now()}`);
  ensureDir(tmpDir);

  const debugArtifacts = {
    tmpDir,
    screenshot: path.join(tmpDir, 'page.png'),
    html: path.join(tmpDir, 'page.html'),
    console: path.join(tmpDir, 'console.log'),
  };

  let exportCrop: { x: number; y: number; w: number; h: number } | null = null;

  // We export the official viewer's battle box at its native CSS size.
  // The battle box is 641.6x361.6 CSS pixels in the Showdown replay UI.
  // Video frames must be integer pixels, so we round up to an even size for H.264.
  const battleCss = { width: 641.6, height: 361.6 };
  const capture = {
    width: Math.ceil(battleCss.width + 0.0001),
    height: Math.ceil(battleCss.height + 0.0001),
  };
  // Ensure even dimensions for yuv420p
  if (capture.width % 2) capture.width += 1;
  if (capture.height % 2) capture.height += 1;

  const browser = await chromium.launch({
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: capture.width, height: capture.height },
    recordVideo: { dir: tmpDir, size: { width: capture.width, height: capture.height } },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  // Export timeline spec:
  // - Keep the replay idle for 30s total before pressing Play.
  // - Trim the first 10s from the recorded video so output t=0 starts at recorded t=10s.
  // => Output has 20s of idle (no Play) before playback starts.
  const trimHeadSec = 10;
  // User-requested flow:
  // - wait 10s
  // - click Last turn (seek)
  // - wait 20s
  // - click Play
  const preSeekMs = 10_000;
  const prePlayMs = 30_000;

  // Capture the viewer's battle log with timestamps (for later subtitle/LLM processing).
  // We record timestamps in seconds relative to the recording start, then also provide an adjusted
  // timestamp for the cut MP4 timeline: t_adj = t_raw - trimHeadSec.
  await page.addInitScript(`
(() => {
  const w = globalThis;
  if (w.__aituberBattleLogInstalled) return;
  w.__aituberBattleLogInstalled = true;

  // Debug counters so we can verify capture without DevTools.
  w.__aituberBattleLogDebug = { source: null, hooked: false, domAttached: false, pushed: 0 };

  w.__aituberBattleLogEvents = [];
  w.__aituberBattleLogLastLines = [];
  w.__aituberBattleLastMessage = '';

  function nowMs() {
    const n = (w.performance && w.performance.now) ? w.performance.now() : Date.now();
    const t0 = Number(w.__aituberCaptureT0PerfMs);
    if (Number.isFinite(t0)) return Math.max(0, n - t0);
    return null;
  }

  function pushLines(lines) {
    try {
      const ms = nowMs();
      if (ms == null) return;
      for (const line of lines) {
        const text = String(line || '').trimEnd();
        if (!text) continue;
        w.__aituberBattleLogEvents.push({ t_ms: ms, text });
        try { w.__aituberBattleLogDebug.pushed++; } catch {}
      }
    } catch {}
  }

  function pushFromAny(value) {
    try {
      if (value == null) return;
      if (Array.isArray(value)) {
        for (const v of value) pushFromAny(v);
        return;
      }
      if (typeof value === 'string') {
        const parts = value.split(/\\r?\\n/);
        const out = [];
        for (const p of parts) {
          const s = String(p || '').trimEnd();
          if (!s) continue;
          out.push(s);
        }
        if (out.length) pushLines(out);
        return;
      }
    } catch {}
  }

  // In embed/export mode, the visual log panel is often absent/disabled.
  // Hook the replay engine itself and timestamp the raw protocol lines (dev battle-log) as they are applied.
  function tryHookReplayEngine() {
    try {
      const b = w.Replays && w.Replays.battle;
      if (!b) return false;
      if (b.__aituberHooked) return true;
      b.__aituberHooked = true;
      w.__aituberBattleLogDebug.hooked = true;

      const wrap = (methodName) => {
        try {
          const orig = b[methodName];
          if (typeof orig !== 'function') return false;
          b[methodName] = function(...args) {
            try {
              // Only record protocol-ish strings/arrays. This avoids spamming with non-log calls.
              const a0 = args && args.length ? args[0] : null;
              if (typeof a0 === 'string') {
                const s = String(a0);
                if (s.startsWith('|') || s.includes('\n|')) pushFromAny(s);
              } else if (Array.isArray(a0)) {
                pushFromAny(a0);
              }
            } catch {}
            return orig.apply(this, args);
          };
          return true;
        } catch {
          return false;
        }
      };

      // Prefer hooking a single canonical entry point to avoid duplicates.
      if (wrap('add')) {
        w.__aituberBattleLogDebug.source = 'Replays.battle.add';
        return true;
      }
      if (wrap('receive')) {
        w.__aituberBattleLogDebug.source = 'Replays.battle.receive';
        return true;
      }
      if (wrap('addQueue')) {
        w.__aituberBattleLogDebug.source = 'Replays.battle.addQueue';
        return true;
      }
      // Hooking failed; leave source null.
      return true;
    } catch {
      return false;
    }
  }

  function getLines(el) {
    try {
      const t = (el && (el.innerText || el.textContent)) ? String(el.innerText || el.textContent) : '';
      const lines = t.split(/\\r?\\n/).map((s) => String(s).trimEnd()).filter((s) => s.length > 0);
      return lines;
    } catch {
      return [];
    }
  }

  function processMessagebar(el) {
    try {
      const t = (el && (el.textContent || el.innerText)) ? String(el.textContent || el.innerText) : '';
      const text = t.replace(/\\r?\\n+/g, ' ').trim();
      if (!text) return;
      const prev = String(w.__aituberBattleLastMessage || '');
      if (text === prev) return;
      w.__aituberBattleLastMessage = text;
      pushLines([text]);
    } catch {}
  }

  function process(el) {
    try {
      const cur = getLines(el);
      const prev = Array.isArray(w.__aituberBattleLogLastLines) ? w.__aituberBattleLogLastLines : [];
      // Append-only behavior:
      // - If the log truly appended: take the suffix after the previous prefix.
      // - If the log re-rendered/shifted: find the largest overlap between prev tail and cur head,
      //   and only emit the non-overlapping new tail.
      let appended = [];

      let prefixOk = prev.length <= cur.length;
      if (prefixOk) {
        for (let i = 0; i < prev.length; i++) {
          if (prev[i] !== cur[i]) { prefixOk = false; break; }
        }
      }

      if (prefixOk) {
        appended = cur.slice(prev.length);
      } else {
        let kBest = 0;
        const kMax = Math.min(prev.length, cur.length);
        for (let k = kMax; k >= 1; k--) {
          let ok = true;
          for (let i = 0; i < k; i++) {
            if (prev[prev.length - k + i] !== cur[i]) { ok = false; break; }
          }
          if (ok) { kBest = k; break; }
        }
        appended = kBest > 0 ? cur.slice(kBest) : [];
      }
      w.__aituberBattleLogLastLines = cur;
      if (appended.length) pushLines(appended);
    } catch {}
  }

  function tryAttach() {
    try {
      const d = w.document;
      if (!d) return false;
      const el = d.querySelector('.battle-log') || d.querySelector('.battlelog') || d.getElementById('battle-log');
      if (!el) return false;
      if (w.__aituberBattleLogObserver) return true;
      // Initial snapshot.
      process(el);
      let scheduled = false;
      const schedule = () => {
        if (scheduled) return;
        scheduled = true;
        setTimeout(() => {
          scheduled = false;
          process(el);
        }, 0);
      };
      const obs = new MutationObserver(() => schedule());
      obs.observe(el, { childList: true, subtree: true, characterData: true });
      w.__aituberBattleLogObserver = obs;
      try { w.__aituberBattleLogDebug.domAttached = true; } catch {}
      return true;
    } catch {
      return false;
    }
  }

  function tryAttachMessagebar() {
    try {
      const d = w.document;
      if (!d) return false;
      const el = d.querySelector('.battle .messagebar') || d.querySelector('.messagebar');
      if (!el) return false;
      if (w.__aituberBattleMessageObserver) return true;
      processMessagebar(el);
      let scheduled = false;
      const schedule = () => {
        if (scheduled) return;
        scheduled = true;
        setTimeout(() => {
          scheduled = false;
          processMessagebar(el);
        }, 0);
      };
      const obs = new MutationObserver(() => schedule());
      obs.observe(el, { childList: true, subtree: true, characterData: true });
      w.__aituberBattleMessageObserver = obs;
      try {
        if (!w.__aituberBattleLogDebug.source) w.__aituberBattleLogDebug.source = 'messagebar';
      } catch {}
      return true;
    } catch {
      return false;
    }
  }

  // Poll until the log element exists.
  const tick = () => {
    const ok = tryAttach();
    if (!ok) setTimeout(tick, 100);
  };
  tick();

  // Poll until messagebar exists (this changes during playback and is reliable in embed/export mode).
  const tickMsg = () => {
    const ok = tryAttachMessagebar();
    if (!ok) setTimeout(tickMsg, 100);
  };
  tickMsg();

  // Independently poll until we can hook the replay engine.
  const tickHook = () => {
    const ok = tryHookReplayEngine();
    if (!ok) setTimeout(tickHook, 100);
  };
  tickHook();
})();
`);

  // Capture page logs to help diagnose flaky viewer/script loads.
  const consoleLines: string[] = [];
  const pageErrors: string[] = [];
  const requestFails: string[] = [];
  page.on('console', (msg: any) => {
    try {
      const t = msg.type?.() || 'log';
      consoleLines.push(`[console.${t}] ${msg.text?.() ?? String(msg)}`);
    } catch {
      consoleLines.push('[console] <unreadable>');
    }
  });
  page.on('pageerror', (err: any) => {
    pageErrors.push(String(err?.stack ?? err?.message ?? err));
  });
  page.on('requestfailed', (req: any) => {
    try {
      requestFails.push(`[requestfailed] ${req.url?.() ?? ''} :: ${req.failure?.()?.errorText ?? ''}`);
    } catch {
      requestFails.push('[requestfailed] <unreadable>');
    }
  });

  async function writeDebugArtifacts() {
    try {
      const txt = [...consoleLines, ...pageErrors.map((e) => `[pageerror] ${e}`), ...requestFails].join('\n');
      fs.writeFileSync(debugArtifacts.console, txt, 'utf8');
    } catch {
      // ignore
    }
    try {
      const html = await page.content();
      fs.writeFileSync(debugArtifacts.html, html, 'utf8');
    } catch {
      // ignore
    }
    try {
      await page.screenshot({ path: debugArtifacts.screenshot });
    } catch {
      // ignore
    }
  }

  async function snapshotState(label: string) {
    try {
      const state = await page.evaluate(() => {
        const w: any = globalThis as any;
        const d: any = w.document;
        const b = w.Replays?.battle;
        const speedSel = d ? d.querySelector('.speedchooser button.sel') : null;
        return {
          href: d?.location?.href ?? '',
          readyState: d?.readyState ?? '',
          title: d?.title ?? '',
          hasReplays: Boolean(w.Replays),
          hasBattle: Boolean(b),
          battle: b
            ? {
                ended: Boolean(b.ended),
                paused: Boolean(b.paused),
                atQueueEnd: Boolean(b.atQueueEnd),
                turn: Number(b.turn ?? -1),
                messageShownTime: Number(b.messageShownTime ?? -1),
                messageFadeTime: Number(b.messageFadeTime ?? -1),
              }
            : null,
          controls: {
            hasReplayControls: Boolean(d ? d.querySelector('.replay-controls') : null),
            hasPlayButton: Boolean(d ? d.querySelector('.replay-controls button[data-action="play"]') : null),
            hasPauseButton: Boolean(d ? d.querySelector('.replay-controls button[data-action="pause"]') : null),
            hasSpeedChooser: Boolean(d ? d.querySelector('.speedchooser') : null),
            selectedSpeed: speedSel ? String((speedSel as any).getAttribute?.('value') ?? '') : '',
          },
        };
      });
      return { label, state };
    } catch (e: any) {
      return { label, error: String(e?.message ?? e) };
    }
  }

  async function waitForFunctionLabeled(label: string, fn: any, timeoutMs: number) {
    try {
      await page.waitForFunction(fn, null, { timeout: timeoutMs });
    } catch (e: any) {
      const snap = await snapshotState(label);
      await writeDebugArtifacts();
      writeJob(opts.jobId, {
        status: 'failed',
        progress: 1,
        message: `${label}: ${String(e?.message ?? e)}`,
        finished_at: new Date().toISOString(),
        // Avoid leaving stale output pointers from a previous run.
        output_mp4: null,
        download_url: null,
        debug_snapshot: snap,
        debug_artifacts: debugArtifacts,
      });
      throw new Error(`${label}: ${String(e?.message ?? e)}`);
    }
  }

  // For export, do NOT autoplay. We want to confirm layout/assets are ready before starting playback.
  // User requirement: export playback at "Really Slow" speed.
  const url = `http://127.0.0.1:${opts.port}/viewer/${encodeURIComponent(opts.battleId)}?export=1&embed=1&autoplay=0&speed=reallyslow&subtitles=0`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  // Wait for replay-embed.js to initialize the battle.
  await waitForFunctionLabeled(
    'wait:init battle',
    () => Boolean((globalThis as any).Replays && (globalThis as any).Replays.battle),
    30_000
  );

  // Ensure the controls are present and the replay is actually playing.
  // In some cases (asset timing / embed mode), the battle object can exist while still paused.
  await waitForFunctionLabeled(
    'wait:controls ready',
    () => {
      const w: any = globalThis as any;
      const b = w.Replays?.battle;
      const d: any = w.document;
      const hasControls = Boolean(d ? d.querySelector('.replay-controls') : null);
      const hasSpeedChooser = Boolean(d ? d.querySelector('.speedchooser') : null);
      const playBtn = d ? d.querySelector('.replay-controls button[data-action="play"]') : null;
      const pauseBtn = d ? d.querySelector('.replay-controls button[data-action="pause"]') : null;
      // In autoplay/playing state, the viewer swaps Play -> Pause, so Play may never exist.
      return Boolean(b && hasControls && hasSpeedChooser && (playBtn || pauseBtn));
    },
    30_000
  );

  // Force requested speed/play again from Playwright (viewer page also tries, but this removes races).
  await page.evaluate(() => {
    const w: any = globalThis as any;
    const d: any = w.document;
    // If the replay started for any reason, pause it so we can start cleanly after layout is ready.
    const pauseBtn: any = d ? d.querySelector('.replay-controls button[data-action="pause"]') : null;
    if (pauseBtn && pauseBtn.click) pauseBtn.click();
    const speedBtn: any = d ? d.querySelector('.speedchooser button[value="reallyslow"]') : null;
    if (speedBtn && speedBtn.click) speedBtn.click();
  });

  // Verify battle box size is as expected (within a small tolerance).
  const measured = await page.evaluate(() => {
    const w: any = globalThis as any;
    const d: any = w.document;
    const el: any = d ? d.querySelector('.battle') : null;
    if (!el || !el.getBoundingClientRect) return null;
    const r = el.getBoundingClientRect();
    return { width: r.width, height: r.height, x: r.x, y: r.y };
  });
  if (!measured) throw new Error('Export failed: .battle element not found');
  const tol = 1.0;
  if (Math.abs(measured.width - battleCss.width) > tol || Math.abs(measured.height - battleCss.height) > tol) {
    // Not fatal for playback, but it violates the export contract, so fail early.
    throw new Error(
      `Export failed: .battle size mismatch (got ${measured.width.toFixed(1)}x${measured.height.toFixed(1)}, expected ${battleCss.width}x${battleCss.height})`
    );
  }

  // Wait for the DOM/layout to be stable before starting playback.
  await waitForFunctionLabeled(
    'wait:layout stable',
    () => {
      const d: any = (globalThis as any).document;
      const el: any = d ? d.querySelector('.battle') : null;
      const inner: any = d ? d.querySelector('.battle .innerbattle') : null;
      if (!el || !inner || !el.getBoundingClientRect) return false;
      const r = el.getBoundingClientRect();
      // The battle should be pinned to the top-left in export mode.
      if (r.x > 0.75 || r.y > 0.75) return false;
      // Ensure at least some sprites/backdrop have rendered.
      const imgs = Array.from(d.querySelectorAll('.battle img')) as any[];
      if (imgs.length < 2) return false;
      const complete = imgs.every((im) => Boolean(im && im.complete));
      return complete;
    },
    30_000
  );

  // Capture exact crop box (integer pixels) for post-processing.
  exportCrop = await page.evaluate(() => {
    const d: any = (globalThis as any).document;
    const el: any = d ? d.querySelector('.battle') : null;
    if (!el || !el.getBoundingClientRect) return null;
    const r = el.getBoundingClientRect();
    const x = Math.max(0, Math.round(r.x));
    const y = Math.max(0, Math.round(r.y));
    const w = Math.max(0, Math.round(r.width));
    const h = Math.max(0, Math.round(r.height));
    return { x, y, w, h };
  });

  // Always start from a paused state and follow the export timeline.
  // NOTE: Use a string evaluate to avoid bundler-injected helpers (e.g. __name) breaking in-page execution.
  writeJob(opts.jobId, {
    status: 'running',
    progress: 0.15,
    message: `Waiting ${Math.round(prePlayMs / 1000)}s before pressing Play (seek@${Math.round(preSeekMs / 1000)}s; trim_head_sec=${trimHeadSec})...`,
    trim_head_sec: trimHeadSec,
    pre_seek_ms: preSeekMs,
    pre_play_ms: prePlayMs,
  });

  const prePlayScript = `
(async () => {
  const w = globalThis;
  const d = w.document;

  // Anchor timestamps for battle-log and other meta.
  const t0 = (w.performance && w.performance.now) ? w.performance.now() : Date.now();
  w.__aituberCaptureT0PerfMs = t0;
  w.__aituberTrimHeadSec = ${trimHeadSec};

  // Install battle log capture in the main world.
  // In this export pipeline, we only need capture to start before playback.
  try {
    if (!w.__aituberBattleLogInstalled) {
      w.__aituberBattleLogInstalled = true;
      w.__aituberBattleLogDebug = { source: null, domAttached: false, msgAttached: false, pushed: 0 };
      w.__aituberBattleLogEvents = [];
      w.__aituberBattleLastMessage = '';
      w.__aituberBattleLogLastLines = [];
      w.__aituberBattleStartLine = null;
      w.__aituberBattleStartLineSource = null;

      const nowMs = () => {
        const n = (w.performance && w.performance.now) ? w.performance.now() : Date.now();
        const base = Number(w.__aituberCaptureT0PerfMs);
        if (!Number.isFinite(base)) return null;
        return Math.max(0, n - base);
      };

      // Split a Showdown messagebar/log line into stable, human-readable lines.
      // This mainly fixes messagebar "incremental reveal" where text becomes: "A!B!C".
      const splitIntoLines = (text) => {
        try {
          let s = String(text || '');
          const SEP = '<<<AIT_SEP>>>';
          // Normalize newlines (regex-free) and prevent literal newlines from leaking into JSONL.
          // Some innerText sources can contain hard newlines inside words; try to stitch those.
          try {
            s = s.replaceAll('\\r\\n', '\\n');
            s = s.replaceAll('\\r', '\\n');
          } catch {}
          try {
            let stitched = '';
            for (let i = 0; i < s.length; i++) {
              const ch = s[i];
              if (ch !== '\\n') { stitched += ch; continue; }
              const prev = i > 0 ? s[i - 1] : '';
              const next = i + 1 < s.length ? s[i + 1] : '';
              const isLetter = (c) => {
                if (!c) return false;
                const cc = c.charCodeAt(0);
                return (cc >= 65 && cc <= 90) || (cc >= 97 && cc <= 122);
              };
              // If newline is in the middle of a word (or hyphenated), drop it; otherwise treat as a space.
              if ((isLetter(prev) || prev === '-') && isLetter(next)) {
                continue;
              }
              stitched += ' ';
            }
            s = stitched;
          } catch {}

          // Insert separators where sentences were concatenated without spacing.
          // We avoid regex literals here because this whole script is injected as a string.
          const isSplitStart = (ch) => {
            if (!ch) return false;
            const c = ch.charCodeAt(0);
            const isAZ = c >= 65 && c <= 90;
            const is09 = c >= 48 && c <= 57;
            return isAZ || is09 || ch === '(' || ch === '[';
          };

          let outStr = '';
          for (let i = 0; i < s.length; i++) {
            const ch = s[i];
            outStr += ch;
            if (ch === '!' || ch === '?' || ch === '.') {
              // Avoid splitting between "..." dots; only split after the final dot.
              if (ch === '.' && (s[i + 1] === '.')) continue;
              let j = i + 1;
              // Skip spaces
              while (j < s.length && s[j] === ' ') j++;
              if (j < s.length && isSplitStart(s[j])) outStr += SEP;
            } else if (ch === ')' || ch === ']') {
              const nx = s[i + 1] || '';
              if (isSplitStart(nx)) outStr += SEP;
            }
          }
          s = outStr;

          const out = [];
          for (const raw of s.split(SEP)) {
            const t = String(raw || '').trim();
            if (!t) continue;
            out.push(t);
          }
          return out;
        } catch {
          return [];
        }
      };

      const maybeSetBattleStartMarker = (ms, s, source) => {
        try {
          if (!ms || !s) return;
          const low = String(s).toLowerCase();
          if (!low.includes('battle started between')) return;
          // If we already set a marker:
          // - Prefer a captured marker over a synthetic Play-click marker (even if it appears slightly later).
          // - Otherwise keep the earliest one.
          const existing = w.__aituberBattleStartLine;
          const existingMs = existing && Number.isFinite(Number(existing.t_ms)) ? Number(existing.t_ms) : null;
          const existingSrc = String(w.__aituberBattleStartLineSource || '');
          const isIncomingCaptured = String(source || '').startsWith('captured_');
          const isExistingSynthetic = existingSrc === 'synthetic_play_click';
          if (!(isExistingSynthetic && isIncomingCaptured)) {
            if (existingMs != null && existingMs <= ms) return;
          }
          w.__aituberBattleStartLine = { t_ms: ms, text: s };
          w.__aituberBattleStartLineSource = source;
        } catch {}
      };

      const pushLines = (text) => {
        const lines = splitIntoLines(text);
        for (const line of lines) pushLine(line);
      };

      const pushLine = (text) => {
        try {
          const ms = nowMs();
          if (ms == null) return;
          let s = String(text || '').trimEnd();
          if (!s) return;
          // Ensure JSONL stays one-record-per-line.
          try {
            s = s.replaceAll('\\r\\n', ' ');
            s = s.replaceAll('\\n', ' ');
            s = s.replaceAll('\\r', ' ');
          } catch {}
          // Collapse whitespace without regex.
          s = s.split(' ').filter((x) => x && x.length).join(' ').trim();
          if (!s) return;
          // De-dupe consecutive identical lines (covers Turn duplicates from multiple sources).
          try {
            const prev = String(w.__aituberBattleLastPushed || '');
            if (prev && prev === s) return;
            w.__aituberBattleLastPushed = s;
          } catch {}
          // If Showdown ever emits a real "Battle started between ..." line into messagebar/DOM,
          // capture it and mark its provenance.
          try {
            const src = (w.__aituberBattleLogDebug && w.__aituberBattleLogDebug.source) ? String(w.__aituberBattleLogDebug.source) : null;
            if (src) maybeSetBattleStartMarker(ms, s, 'captured_' + src);
          } catch {}
          w.__aituberBattleLogEvents.push({ t_ms: ms, text: s });
          try { w.__aituberBattleLogDebug.pushed++; } catch {}
        } catch {}
      };

      // Emit Turn markers based on the replay engine's turn counter.
      // This is independent of messagebar/log DOM and works in export/embed mode.
      try {
        w.__aituberBattleLastTurn = 0;
        const tickTurn = () => {
          try {
            // If we have a reliable DOM log attached, it already contains Turn lines; avoid duplicating.
            if (w.__aituberBattleLogDebug && w.__aituberBattleLogDebug.domAttached) {
              // Still keep tracking for endDebug.
              const b0 = w.Replays && w.Replays.battle;
              const t0 = b0 ? Number(b0.turn ?? 0) : 0;
              if (Number.isFinite(t0) && t0 > 0) w.__aituberBattleLastTurn = t0;
            } else {
            const b = w.Replays && w.Replays.battle;
            const t = b ? Number(b.turn ?? 0) : 0;
            const prev = Number(w.__aituberBattleLastTurn ?? 0) || 0;
            if (Number.isFinite(t) && t > 0 && t !== prev) {
              w.__aituberBattleLastTurn = t;
              pushLine('Turn ' + t);
            }
            }
          } catch {}
          try { w.setTimeout(tickTurn, 100); } catch {}
        };
        tickTurn();
      } catch {}

      const attachMsg = () => {
        try {
          if (w.__aituberBattleMessageObserver) return true;
          const el = d.querySelector('.battle .messagebar') || d.querySelector('.messagebar');
          if (!el) return false;
          const proc = () => {
            try {
              // If we have a real log panel attached, prefer it to avoid duplicates.
              if (w.__aituberBattleLogDebug && w.__aituberBattleLogDebug.domAttached) return;
              let t = String(el.textContent || el.innerText || '');
              try {
                t = t.replaceAll('\\r\\n', ' ');
                t = t.replaceAll('\\n', ' ');
                t = t.replaceAll('\\r', ' ');
              } catch {}
              // Collapse whitespace without regex.
              t = t.split(' ').filter((x) => x && x.length).join(' ').trim();
              if (!t) return;
              const prev = String(w.__aituberBattleLastMessage || '');
              if (t === prev) return;
              w.__aituberBattleLastMessage = t;

              // Messagebar often shows incremental reveal: new text may include the previous text as a prefix.
              // Only emit the newly appended suffix when possible.
              let delta = t;
              if (prev && t.startsWith(prev)) {
                delta = t.slice(prev.length);
              }
              delta = String(delta || '').trim();
              if (!delta) return;
              pushLines(delta);
            } catch {}
          };
          proc();
          let scheduled = false;
          const schedule = () => {
            if (scheduled) return;
            scheduled = true;
            setTimeout(() => { scheduled = false; proc(); }, 0);
          };
          const obs = new MutationObserver(() => schedule());
          obs.observe(el, { childList: true, subtree: true, characterData: true });
          w.__aituberBattleMessageObserver = obs;
          try { w.__aituberBattleLogDebug.msgAttached = true; } catch {}
          try { if (!w.__aituberBattleLogDebug.source) w.__aituberBattleLogDebug.source = 'messagebar'; } catch {}
          return true;
        } catch {
          return false;
        }
      };

      const attachDomLog = () => {
        try {
          if (w.__aituberBattleLogObserver) return true;
          const el = d.querySelector('.battle-log') || d.querySelector('.battlelog') || d.getElementById('battle-log');
          if (!el) return false;
          const getLines = () => {
            let t = String(el.innerText || el.textContent || '');
            try {
              t = t.replaceAll('\\r\\n', '\\n');
              t = t.replaceAll('\\r', '\\n');
            } catch {}
            const rawLines = t.split('\\n').map((x) => String(x).trimEnd()).filter((x) => x.length > 0);
            // Further split lines that were glued together (e.g., "Go! X![Ability]...").
            const out = [];
            for (const ln of rawLines) {
              const parts = splitIntoLines(ln);
              if (parts.length) out.push(...parts);
            }
            return out;
          };
          const proc = () => {
            try {
              const cur = getLines();
              const prev = Array.isArray(w.__aituberBattleLogLastLines) ? w.__aituberBattleLogLastLines : [];
              // Append-only behavior:
              // - If the log truly appended: take the suffix after the previous prefix.
              // - If the log re-rendered/shifted: find the largest overlap between prev tail and cur head,
              //   and only emit the non-overlapping new tail.
              let appended = [];

              let prefixOk = prev.length <= cur.length;
              if (prefixOk) {
                for (let i = 0; i < prev.length; i++) {
                  if (prev[i] !== cur[i]) { prefixOk = false; break; }
                }
              }

              if (prefixOk) {
                appended = cur.slice(prev.length);
              } else {
                // Overlap fallback: prev suffix == cur prefix
                let kBest = 0;
                const kMax = Math.min(prev.length, cur.length);
                for (let k = kMax; k >= 1; k--) {
                  let ok = true;
                  for (let i = 0; i < k; i++) {
                    if (prev[prev.length - k + i] !== cur[i]) { ok = false; break; }
                  }
                  if (ok) { kBest = k; break; }
                }
                appended = kBest > 0 ? cur.slice(kBest) : [];
              }

              w.__aituberBattleLogLastLines = cur;
              for (const line of appended) pushLines(line);
            } catch {}
          };
          proc();
          let scheduled = false;
          const schedule = () => {
            if (scheduled) return;
            scheduled = true;
            setTimeout(() => { scheduled = false; proc(); }, 0);
          };
          const obs = new MutationObserver(() => schedule());
          obs.observe(el, { childList: true, subtree: true, characterData: true });
          w.__aituberBattleLogObserver = obs;
          try { w.__aituberBattleLogDebug.domAttached = true; } catch {}
          try { if (!w.__aituberBattleLogDebug.source) w.__aituberBattleLogDebug.source = 'battle-log-dom'; } catch {}
          return true;
        } catch {
          return false;
        }
      };

      const attachBattleHistory = () => {
        try {
          if (w.__aituberBattleHistoryObserver) return true;
          const hist =
            d.querySelector('.inner .message-log .battle-history') ||
            d.querySelector('.message-log .battle-history') ||
            d.querySelector('.battle-history');
          if (!hist) return false;

          const getHistoryLines = () => {
            const out = [];
            let buf = '';
            const flush = () => {
              const s = String(buf || '').trim();
              buf = '';
              if (s) out.push(s);
            };

            const children = hist.childNodes ? Array.from(hist.childNodes) : [];
            for (const n of children) {
              try {
                // Element nodes
                if (n && n.nodeType === 1) {
                  const el = n;
                  const tag = (el.tagName || '').toString().toUpperCase();
                  if (tag === 'BR') {
                    flush();
                    continue;
                  }
                  try {
                    const cls = el.classList;
                    if (cls && cls.contains('spacer') && cls.contains('battle-history')) {
                      // In Showdown replays, key messages (e.g. "Battle started between ...")
                      // can appear as spacer rows. Treat it as its own line.
                      flush();
                      const spacerText = String(el.textContent || '').trim();
                      if (spacerText) out.push(spacerText);
                      continue;
                    }
                  } catch {}
                  const t = String(el.textContent || '').trim();
                  if (t) {
                    if (buf) buf += ' ';
                    buf += t;
                  }
                  continue;
                }
                // Text nodes
                if (n && n.nodeType === 3) {
                  const t = String((n && (n.textContent || '')) || '').trim();
                  if (t) {
                    if (buf) buf += ' ';
                    buf += t;
                  }
                  continue;
                }
              } catch {}
            }
            flush();

            // Further split glued lines.
            const finalOut = [];
            for (const ln of out) {
              const parts = splitIntoLines(ln);
              if (parts.length) finalOut.push(...parts);
            }
            return finalOut;
          };

          const proc = () => {
            try {
              const cur = getHistoryLines();
              const prev = Array.isArray(w.__aituberBattleHistoryLastLines) ? w.__aituberBattleHistoryLastLines : [];
              let appended = [];
              let prefixOk = prev.length <= cur.length;
              if (prefixOk) {
                for (let i = 0; i < prev.length; i++) {
                  if (prev[i] !== cur[i]) { prefixOk = false; break; }
                }
              }
              if (prefixOk) {
                appended = cur.slice(prev.length);
              } else {
                let kBest = 0;
                const kMax = Math.min(prev.length, cur.length);
                for (let k = kMax; k >= 1; k--) {
                  let ok = true;
                  for (let i = 0; i < k; i++) {
                    if (prev[prev.length - k + i] !== cur[i]) { ok = false; break; }
                  }
                  if (ok) { kBest = k; break; }
                }
                appended = kBest > 0 ? cur.slice(kBest) : [];
              }
              w.__aituberBattleHistoryLastLines = cur;
              for (const line of appended) pushLines(line);
            } catch {}
          };

          proc();
          let scheduled = false;
          const schedule = () => {
            if (scheduled) return;
            scheduled = true;
            setTimeout(() => { scheduled = false; proc(); }, 0);
          };
          const obs = new MutationObserver(() => schedule());
          obs.observe(hist, { childList: true, subtree: true, characterData: true });
          w.__aituberBattleHistoryObserver = obs;
          try { w.__aituberBattleLogDebug.domAttached = true; } catch {}
          try { if (!w.__aituberBattleLogDebug.source) w.__aituberBattleLogDebug.source = 'battle-history'; } catch {}
          return true;
        } catch {
          return false;
        }
      };

      const tick = () => {
        try { attachBattleHistory(); } catch {}
        try { attachDomLog(); } catch {}
        try { attachMsg(); } catch {}
        setTimeout(tick, 100);
      };
      tick();
    }
  } catch {}

  // Ensure paused immediately.
  try {
    const pauseBtn = d ? d.querySelector('.replay-controls button[data-action="pause"]') : null;
    if (pauseBtn && pauseBtn.click) pauseBtn.click();
  } catch {}

  const tSeek = t0 + ${preSeekMs};
  const target = t0 + ${prePlayMs};
  await new Promise((resolve) => {
    let didSeek = false;
    const tick = () => {
      const now = (w.performance && w.performance.now) ? w.performance.now() : Date.now();

      // At 10s: click Last turn (seek), and start audio capture (if enabled).
      if (!didSeek && now >= tSeek) {
        didSeek = true;
        try {
          const lastBtn = d ? d.querySelector('.replay-controls button[data-action="last"]') : null;
          if (lastBtn && lastBtn.click) lastBtn.click();
        } catch {}
        // Ensure paused after seeking.
        try {
          const pauseBtn = d ? d.querySelector('.replay-controls button[data-action="pause"]') : null;
          if (pauseBtn && pauseBtn.click) pauseBtn.click();
        } catch {}

      }

      if (now >= target) {
        try {
          const playBtn = d ? d.querySelector('.replay-controls button[data-action="play"]') : null;
          if (playBtn && playBtn.click) playBtn.click();
        } catch {}
        try { w.__aituberPlayClickPerfMs = now; } catch {}

        // Emit a synthetic battle-start marker for downstream alignment (BGM delay, subtitles, etc).
        // The Showdown UI doesn't always surface this as a log/messagebar line in export/embed mode.
        try {
          if (!w.__aituberBattleStartLine) {
            let p1 = 'p1';
            let p2 = 'p2';
            try {
              const b = w.Replays && w.Replays.battle;
              const n1 = b && b.p1 && b.p1.name ? String(b.p1.name) : '';
              const n2 = b && b.p2 && b.p2.name ? String(b.p2.name) : '';
              if (n1) p1 = n1;
              if (n2) p2 = n2;
            } catch {}
            const tMs = Math.max(0, Math.round(now - t0));
            w.__aituberBattleStartLine = { t_ms: tMs, text: 'Battle started between ' + p1 + ' and ' + p2 + '!' };
            w.__aituberBattleStartLineSource = 'synthetic_play_click';
          }
        } catch {}

        resolve();
        return;
      }
      w.requestAnimationFrame(tick);
    };
    w.requestAnimationFrame(tick);
  });
})();
`;

  // Persist the injected script for debugging (helps diagnose page.evaluate syntax errors).
  try {
    fs.writeFileSync(path.join(tmpDir, 'debug_preplay.js'), prePlayScript, 'utf8');
  } catch {
    // ignore
  }

  await page.evaluate(prePlayScript);

  // Wait until the replay starts progressing (not paused, turn advances or queue begins processing).
  await waitForFunctionLabeled(
    'wait:playback started',
    () => {
      const w: any = globalThis as any;
      const b = w.Replays?.battle;
      if (!b) return false;
      if (b.paused) return false;
      const started = Boolean((b as any).started);
      const turn = Number(b.turn ?? 0) || 0;
      // Either the battle has started, or we've entered the battle proper (turn>=1).
      return started || turn >= 1;
    },
    30_000
  );

  // Meta timing: measure how long it took for playback to actually start after the Play click.
  // This helps debug the "slight freeze" the user sees when pressing Play.
  try {
    const dtMs = await page.evaluate(() => {
      const w: any = globalThis as any;
      const click = Number(w.__aituberPlayClickPerfMs);
      const now = (w.performance && w.performance.now) ? w.performance.now() : Date.now();
      if (!Number.isFinite(click)) return null;
      return Math.max(0, Math.round(now - click));
    });
    if (dtMs != null) writeJob(opts.jobId, { debug_play_start_dt_ms: dtMs });
  } catch {
    // ignore
  }

  // Wait for the replay to actually finish.
  // The Showdown Battle object sets `ended=true` when the log has fully played.
  let expectedTurns: number | null = null;
  try {
    const index = await loadIndex({ refresh: false });
    const meta = index.entries.find((e) => e.battle_id === opts.battleId);
    if (meta?.turns != null) expectedTurns = Number(meta.turns);
  } catch {}
  // Normal speed replay playback can legitimately take much longer than a couple seconds per turn
  // depending on animations/effects. Use a generous upper bound and a conservative per-turn heuristic.
  // "Really Slow" playback is much slower than normal; give it a larger time budget.
  const perTurnMs = 45_000;
  const baseMs = 120_000;
  const maxWaitMs = Math.min(
    20 * 60_000,
    Math.max(60_000, baseMs + (expectedTurns && !Number.isNaN(expectedTurns) ? expectedTurns * perTurnMs : 180_000))
  );

  writeJob(opts.jobId, {
    status: 'running',
    progress: 0.2,
    message: `Playing replay... (battle=${measured.width.toFixed(1)}x${measured.height.toFixed(1)}; capture=${capture.width}x${capture.height}; maxWaitMs=${maxWaitMs})`,
    started_at: new Date().toISOString(),
    // Clear any stale outputs from previous attempts.
    output_mp4: null,
    download_url: null,
  });

  // Capture some debug info about the loaded replay/log.
  try {
    const diag = await page.evaluate(() => {
      const w: any = globalThis as any;
      const b = w.Replays?.battle;
      const d: any = w.document;
      const raw = (d ? d.querySelector('.battle-log-data') : null)?.textContent || '';
      const turnCount = (raw.match(/\n\|turn\|/g) || []).length;
      const hasResult = raw.includes('\n|win|') || raw.includes('\n|tie|');
      const capture = {
        installed: Boolean(w.__aituberBattleLogInstalled),
        hasDomObserver: Boolean(w.__aituberBattleLogObserver),
        hasMsgObserver: Boolean(w.__aituberBattleMessageObserver),
        eventsSoFar: Array.isArray(w.__aituberBattleLogEvents) ? w.__aituberBattleLogEvents.length : null,
        debug: w.__aituberBattleLogDebug || null,
      };
      return {
        rawLen: raw.length,
        turnCount,
        hasResult,
        capture,
        battle: b
          ? {
              ended: Boolean(b.ended),
              paused: Boolean(b.paused),
              atQueueEnd: Boolean(b.atQueueEnd),
              turn: Number(b.turn ?? -1),
              messageShownTime: Number(b.messageShownTime ?? -1),
              messageFadeTime: Number(b.messageFadeTime ?? -1),
            }
          : null,
      };
    });
    writeJob(opts.jobId, { debug_loaded: diag });
  } catch {
    // ignore
  }

  try {
    await waitForFunctionLabeled(
      'wait:replay ended',
      () => {
        const w: any = globalThis as any;
        const b = w.Replays?.battle;
        return Boolean(b && b.ended === true && b.atQueueEnd === true);
      },
      maxWaitMs
    );
  } catch {
    const debug = await page.evaluate(() => {
      const b = (globalThis as any).Replays?.battle;
      return b ? { ended: Boolean(b.ended), turn: Number(b.turn ?? -1), atQueueEnd: Boolean(b.atQueueEnd), paused: Boolean(b.paused) } : null;
    });
    throw new Error(`Export timed out waiting for replay end (debug=${JSON.stringify(debug)})`);
  }

  // Sanity check: if we know the expected turn count, ensure we didn't end prematurely.
  try {
    const endDebug = await page.evaluate(() => {
      const b = (globalThis as any).Replays?.battle;
      return b ? { ended: Boolean(b.ended), turn: Number(b.turn ?? -1), atQueueEnd: Boolean(b.atQueueEnd), paused: Boolean(b.paused) } : null;
    });
    writeJob(opts.jobId, { debug_end: endDebug });
    if (expectedTurns != null && endDebug && Number.isFinite(endDebug.turn)) {
      // tolerate +/- 1 because internal counter can differ slightly from metadata.
      if (endDebug.turn >= 0 && endDebug.turn + 1 < expectedTurns) {
        throw new Error(`Replay ended too early (turn=${endDebug.turn}, expectedTurns=${expectedTurns})`);
      }
    }
  } catch (e: any) {
    throw e;
  }

  writeJob(opts.jobId, { progress: 0.7, message: 'Finalizing video...' });

  // Save battle log with timestamps adjusted for the cut MP4.
  const battleLogPath = path.join(exportsRoot, `${opts.jobId}.battlelog.jsonl`);
  try {
    const payload = await page.evaluate(() => {
      const w: any = globalThis as any;
      const evs = Array.isArray(w.__aituberBattleLogEvents) ? w.__aituberBattleLogEvents : [];
      const t0 = Number(w.__aituberCaptureT0PerfMs);
      const trim = Number(w.__aituberTrimHeadSec);
      const dbg = w.__aituberBattleLogDebug || null;
      const battleStartLine = w.__aituberBattleStartLine || null;
      const battleStartLineSource = w.__aituberBattleStartLineSource || null;
      return { evs, t0, trim, dbg, battleStartLine, battleStartLineSource };
    });
    const trim = Number.isFinite(payload?.trim) ? Number(payload.trim) : 0;
    const lines: string[] = [];
    const evs: any[] = Array.isArray(payload?.evs) ? payload.evs : [];

    // Ensure the synthetic battle-start marker exists in the log stream so downstream steps
    // (notably BGM delay derivation) can rely on it.
    try {
      const bsl = payload?.battleStartLine;
      const bslSource = String(payload?.battleStartLineSource ?? '').trim();
      const tMs = Number(bsl?.t_ms);
      const text = String(bsl?.text ?? '').trimEnd();
      if (Number.isFinite(tMs) && text) {
        const low = text.toLowerCase();
        const already = evs.some((ev) => {
          const t = Number(ev?.t_ms);
          const s = String(ev?.text ?? '').trimEnd().toLowerCase();
          return Number.isFinite(t) && t === Math.round(tMs) && s === low;
        });
        if (!already) {
          // Insert in chronological position by t_ms (evs are usually already in order).
          let idx = evs.length;
          for (let i = 0; i < evs.length; i++) {
            const t = Number(evs[i]?.t_ms);
            if (Number.isFinite(t) && t > tMs) { idx = i; break; }
          }
          evs.splice(idx, 0, { t_ms: Math.round(tMs), text });
        }

        // Record provenance so downstream analysis can distinguish synthetic markers.
        if (bslSource) {
          writeJob(opts.jobId, { battle_start_source: bslSource });
        }
      }
    } catch {
      // ignore
    }

    // Derive key timeline anchors from the battle log.
    // Use cut-adjusted timeline: t_adj = t_raw - trimHeadSec.
    let battleStartMs: number | null = null;
    let battleGoMs: number | null = null;
    for (const ev of evs) {
      const tMs = Number(ev?.t_ms);
      const text = String(ev?.text ?? '').trimEnd();
      if (!Number.isFinite(tMs) || !text) continue;
      const low = text.toLowerCase();
      if (battleStartMs == null && low.includes('battle started between')) {
        battleStartMs = tMs;
      }
      if (battleGoMs == null && text === 'Go!') {
        battleGoMs = tMs;
      }
      if (battleStartMs != null && battleGoMs != null) break;
    }

    const jobUpdate: any = {};
    if (battleStartMs != null) {
      const adjMs = Math.max(0, Math.round(battleStartMs - trim * 1000));
      jobUpdate.battle_start_t_ms = Math.round(battleStartMs);
      jobUpdate.battle_start_t_adj_ms = adjMs;
      jobUpdate.battle_start_t_adj_sec = Number((adjMs / 1000).toFixed(3));
    }
    if (battleGoMs != null) {
      const adjMs = Math.max(0, Math.round(battleGoMs - trim * 1000));
      jobUpdate.battle_go_t_ms = Math.round(battleGoMs);
      jobUpdate.battle_go_t_adj_ms = adjMs;
      jobUpdate.battle_go_t_adj_sec = Number((adjMs / 1000).toFixed(3));
    }

    if (Object.keys(jobUpdate).length) {
      writeJob(opts.jobId, jobUpdate);
    }

    for (const ev of evs) {
      const tMs = Number(ev?.t_ms);
      const text = String(ev?.text ?? '').trimEnd();
      if (!Number.isFinite(tMs) || !text) continue;
      const tSec = tMs / 1000.0;
      const tAdjSec = tSec - trim;
      // Keep negative times (if any) so it's clear they were before the cut.
      lines.push(
        JSON.stringify({
          t_ms: Math.round(tMs),
          t_sec: Number(tSec.toFixed(3)),
          t_adj_ms: Math.round(tAdjSec * 1000.0),
          t_adj_sec: Number(tAdjSec.toFixed(3)),
          text,
        })
      );
    }
    fs.writeFileSync(battleLogPath, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
    writeJob(opts.jobId, {
      battlelog_path: battleLogPath,
      battlelog_url: `/exports/${encodeURIComponent(opts.jobId)}.battlelog.jsonl`,
      debug_battlelog: {
        events: evs.length,
        lines_written: lines.length,
        capture_debug: payload?.dbg ?? null,
      },
    });
  } catch (e: any) {
    // Don't fail the export if battlelog capture fails, but do record why.
    try {
      writeJob(opts.jobId, {
        debug_battlelog: {
          error: String(e?.message ?? e),
        },
      });
    } catch {}
  }

  // Give the recorder a moment to flush the last frames.
  await page.waitForTimeout(750);

  await context.close();
  await browser.close();

  // Playwright's recordVideo writes a .webm into tmpDir.
  const videoFiles = fs.readdirSync(tmpDir).filter((f) => f.endsWith('.webm'));
  if (!videoFiles.length) throw new Error('No recorded video (.webm) produced by Playwright');
  const inputWebm = path.join(tmpDir, videoFiles[0]);

  const ffmpeg = await resolveFfmpegPath();
  const outMp4 = path.join(exportsRoot, `${opts.jobId}.mp4`);

  writeJob(opts.jobId, { progress: 0.85, message: 'Converting to mp4 (ffmpeg)...' });

  await new Promise<void>((resolve, reject) => {
    // Video-only export. If we found a crop box for .battle, apply it so the output MP4 is pixel-exact.
    let cropFilter = '';
    if (exportCrop && exportCrop.w > 0 && exportCrop.h > 0) {
      let w = exportCrop.w;
      let h = exportCrop.h;
      // Ensure even dimensions for yuv420p (crop reduces size).
      if (w % 2) w -= 1;
      if (h % 2) h -= 1;
      cropFilter = `crop=${w}:${h}:${exportCrop.x}:${exportCrop.y}`;
    }

    const vf: string[] = [];
    vf.push(`trim=start=${trimHeadSec}`);
    vf.push(`setpts=PTS-STARTPTS`);
    if (cropFilter) vf.push(cropFilter);
    const videoChain = vf.join(',');

    const args = [
      '-y',
      '-i',
      inputWebm,
      '-vf',
      videoChain,
      '-an',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      outMp4,
    ];

    const p = spawn(ffmpeg, args, { stdio: 'pipe' });
    let stderr = '';
    p.stderr.on('data', (d: any) => (stderr += String(d)));
    p.on('error', (err: any) => reject(err));
    p.on('close', (code: number) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg failed (code=${code}): ${stderr.slice(-2000)}`));
    });
  });

  writeJob(opts.jobId, {
    status: 'done',
    progress: 1,
    message: 'Done',
    finished_at: new Date().toISOString(),
    output_mp4: outMp4,
    download_url: `/exports/${encodeURIComponent(opts.jobId)}.mp4`,
  });
}

app.post('/api/export', async (req, res) => {
  let body: any;
  try {
    body = exportRequestSchema.parse(req.body);
  } catch (e: any) {
    return res.status(400).json({ error: String(e?.message ?? e) });
  }

  const battleId = String(body.battle_id);
  const jobId = battleId;

  const existing = readJob(jobId);
  if (existing?.status === 'running' || existing?.status === 'queued') {
    return res.json(existing);
  }

  writeJob(jobId, {
    status: 'queued',
    progress: 0,
    message: 'Queued',
    requested_at: new Date().toISOString(),
    params: body,
    // Clear stale output/debug pointers from previous attempts.
    started_at: null,
    finished_at: null,
    output_mp4: null,
    download_url: null,
    debug_snapshot: null,
    debug_artifacts: null,
    debug_loaded: null,
    debug_end: null,
    battlelog_path: null,
    battlelog_url: null,
    debug_battlelog: null,
    battle_start_t_ms: null,
    battle_start_t_adj_ms: null,
    battle_start_t_adj_sec: null,
    battle_start_source: null,
    battle_go_t_ms: null,
    battle_go_t_adj_ms: null,
    battle_go_t_adj_sec: null,
  });

  const port = Number(process.env.PORT ?? 8787);
  setTimeout(() => {
    runExportJob({ battleId, jobId, port }).catch((e: any) => {
      writeJob(jobId, { status: 'failed', progress: 1, message: String(e?.message ?? e), finished_at: new Date().toISOString() });
    });
  }, 10);

  res.json(readJob(jobId));
});

app.get('/api/export/status', (req, res) => {
  const battleId = String(req.query.battle_id ?? '');
  if (!battleId) return res.status(400).json({ error: 'battle_id required' });
  const job = readJob(battleId);
  if (!job) return res.status(404).json({ error: 'no job' });
  res.json(job);
});

app.use('/exports', express.static(exportsRoot));

const port = Number(process.env.PORT ?? 8787);
app.listen(port, '127.0.0.1', () => {
  console.log(`[replay-studio-server] listening on http://127.0.0.1:${port}`);
  console.log(`[replay-studio-server] dataRoot=${dataRoot}`);
});
