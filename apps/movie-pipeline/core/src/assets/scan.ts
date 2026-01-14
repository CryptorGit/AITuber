import fs from 'node:fs';
import path from 'node:path';
import { assetsRoot, ensureDir, registryPath } from '../paths.ts';
import { readJson, writeJson } from '../utils/io.ts';
import type { AssetEntry, AssetRegistry } from '../types.ts';
import { parseBattleLogMeta } from './battleMeta.ts';

if (process.env.MP_DEBUG_SCAN === '1') {
  try {
    console.log('[scanAssets] scan.ts loaded');
  } catch {
    // ignore
  }
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function resolveVgcDemoReplaysJsonl(vgcDir: string, battleId: string): string | null {
  const indexPath = path.join(vgcDir, 'index.json');
  const indexAny = readJsonFile<any>(indexPath);
  const entriesArr = Array.isArray(indexAny) ? indexAny : Array.isArray(indexAny?.entries) ? indexAny.entries : [];
  const idxEntry = Array.isArray(entriesArr) ? entriesArr.find((e) => String(e?.battle_id ?? '') === battleId) : null;
  const trainDir = String(idxEntry?.train_dir ?? '').trim();
  const replaysPath = trainDir ? path.join(vgcDir, trainDir, 'replays.jsonl') : '';
  if (process.env.MP_DEBUG_SCAN === '1') {
    try {
      console.log('[scanAssets] vgc-demo resolve', {
        battleId,
        vgcDir,
        indexPathExists: fs.existsSync(indexPath),
        entriesLen: Array.isArray(entriesArr) ? entriesArr.length : -1,
        trainDir,
        replaysPath,
        replaysExists: replaysPath ? fs.existsSync(replaysPath) : false,
      });
    } catch {
      // ignore
    }
  }
  if (replaysPath && fs.existsSync(replaysPath)) return replaysPath;

  // Fallback: scan train_*/replays.jsonl to find the battle_id.
  try {
    const dirs = fs
      .readdirSync(vgcDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.toLowerCase().startsWith('train_'))
      .map((e) => e.name)
      .sort();
    for (const d of dirs) {
      const candidate = path.join(vgcDir, d, 'replays.jsonl');
      if (!fs.existsSync(candidate)) continue;
      try {
        const raw = fs.readFileSync(candidate, 'utf8');
        if (!raw.includes(battleId)) continue;
        if (process.env.MP_DEBUG_SCAN === '1') {
          console.log('[scanAssets] vgc-demo fallback hit', { battleId, candidate });
        }
        return candidate;
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
  return null;
}

function findFirstFileByExt(dir: string, ext: string) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith(ext)) {
      return path.join(dir, entry.name);
    }
  }
  return null;
}

function listFilesByExt(dir: string, ext: string) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(ext))
    .map((e) => path.join(dir, e.name))
    .sort();
}

function isFile(p: string) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function findFirstFileByNames(dir: string, names: string[]) {
  for (const name of names) {
    const candidate = path.join(dir, name);
    if (isFile(candidate)) return candidate;
  }
  return null;
}

function findFirstByExt(dir: string, ext: string) {
  return findFirstFileByExt(dir, ext);
}

function findBattleLog(dir: string) {
  const direct = findFirstFileByNames(dir, ['battle_log.json', 'battle_log.jsonl', 'battle_log.txt']);
  if (direct) return direct;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const name = entry.name.toLowerCase();
    if (name.includes('battle') && (name.endsWith('.json') || name.endsWith('.jsonl') || name.endsWith('.txt'))) {
      return path.join(dir, entry.name);
    }
  }
  return null;
}

function findTsLog(dir: string) {
  const direct = findFirstFileByNames(dir, ['ts_log.json', 'ts_log.jsonl', 'timestamps.json']);
  if (direct) return direct;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const name = entry.name.toLowerCase();
    if (name.includes('ts') && name.includes('log') && name.endsWith('.json')) {
      return path.join(dir, entry.name);
    }
  }
  return null;
}

function findBaseMp4(dir: string) {
  const direct = findFirstFileByNames(dir, ['replay.mp4', 'base.mp4']);
  if (direct) return direct;
  return findFirstByExt(dir, '.mp4');
}

function readDirMtimeMs(dir: string) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let max = 0;
  for (const entry of entries) {
    const p = path.join(dir, entry.name);
    try {
      const st = fs.statSync(p);
      if (st.mtimeMs > max) max = st.mtimeMs;
    } catch {
      // ignore
    }
  }
  return max;
}

function listFiles(dir: string) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.filter((e) => e.isFile()).map((e) => e.name).sort();
}

function registryIsFresh(registry: AssetRegistry, current: Record<string, { dir_mtime_ms: number; files: string[] }>) {
  const prev = registry.scan_meta.entries || {};
  const prevKeys = Object.keys(prev).sort();
  const curKeys = Object.keys(current).sort();
  if (prevKeys.length !== curKeys.length) return false;
  for (let i = 0; i < prevKeys.length; i++) {
    if (prevKeys[i] !== curKeys[i]) return false;
  }
  for (const key of curKeys) {
    const p = prev[key];
    const c = current[key];
    if (!p || !c) return false;
    if (p.dir_mtime_ms !== c.dir_mtime_ms) return false;
    if (p.files.join('|') !== c.files.join('|')) return false;
  }
  return true;
}

export function scanAssets(opts?: { refresh?: boolean }) {
  const root = assetsRoot();
  ensureDir(root);

  const cached = readJson<AssetRegistry | null>(registryPath(), null);
  const currentMeta: Record<string, { dir_mtime_ms: number; files: string[] }> = {};

  const topLevelMp4s = listFilesByExt(root, '.mp4');
  const hasFlatExports = topLevelMp4s.length > 0;

  const dirEntries = hasFlatExports ? [] : fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory());
  if (hasFlatExports) {
    // Flat exports mode (vgc-demo): treat the root as the scanned container.
    currentMeta.__root__ = {
      dir_mtime_ms: readDirMtimeMs(root),
      files: listFiles(root),
    };
  } else {
    for (const entry of dirEntries) {
      const dirPath = path.join(root, entry.name);
      currentMeta[entry.name] = {
        dir_mtime_ms: readDirMtimeMs(dirPath),
        files: listFiles(dirPath),
      };
    }
  }

  if (!opts?.refresh && cached && registryIsFresh(cached, currentMeta)) {
    return cached;
  }

  const assets: AssetEntry[] = [];

  if (hasFlatExports) {
    for (const mp4Path of topLevelMp4s) {
      const battleId = path.basename(mp4Path, '.mp4');
      // Source-of-Truth: 
      // - battle_log = replay-studio input log (generated from replay viewer)
      // - ts_log = exported timeline/source log (.battlelog.jsonl)
      const tsCandidate = path.join(root, `${battleId}.battlelog.jsonl`);
      const ts_log = isFile(tsCandidate) ? tsCandidate : null;

      // battle_log (per UX spec) should be the raw replay record, not the generated viewer log.
      // For vgc-demo, the raw replay record row is stored in: vgc-demo/train_*/replays.jsonl
      // We resolve the correct train dir via vgc-demo/index.json.
      const vgcDir = path.resolve(root, '..');
      const battle_log = resolveVgcDemoReplaysJsonl(vgcDir, battleId);

      // Optional: still parse meta from generated_logs if present (useful for turns/winner),
      // but do NOT treat it as the canonical battle_log.
      const generatedBattleLog = path.resolve(vgcDir, 'generated_logs', `${battleId}.log`);
      const meta = isFile(generatedBattleLog)
        ? parseBattleLogMeta(generatedBattleLog)
        : { turns: null, winner: null, tags: [] as string[] };
      const updatedMs = Math.max(
        (() => {
          try {
            return fs.statSync(mp4Path).mtimeMs;
          } catch {
            return 0;
          }
        })(),
        (() => {
          if (!battle_log && !ts_log) return 0;
          try {
            return fs.statSync((battle_log || ts_log)!).mtimeMs;
          } catch {
            return 0;
          }
        })()
      );
      assets.push({
        battle_id: battleId,
        dir: root,
        base_mp4: mp4Path,
        battle_log,
        ts_log,
        updated_at: new Date(updatedMs || Date.now()).toISOString(),
        turns: meta.turns,
        winner: meta.winner,
        tags: meta.tags,
      });
    }
  } else {
    for (const entry of dirEntries) {
      const battleId = entry.name;
      const dir = path.join(root, battleId);
      const base_mp4 = findBaseMp4(dir);
      const battle_log = findBattleLog(dir);
      const ts_log = findTsLog(dir);
      const meta = (battle_log || ts_log) ? parseBattleLogMeta((battle_log || ts_log)!) : { turns: null, winner: null, tags: [] };
      assets.push({
        battle_id: battleId,
        dir,
        base_mp4,
        battle_log,
        ts_log,
        updated_at: new Date(currentMeta[battleId]?.dir_mtime_ms || Date.now()).toISOString(),
        turns: meta.turns,
        winner: meta.winner,
        tags: meta.tags,
      });
    }
  }

  const registry: AssetRegistry = {
    version: 2,
    updated_at: new Date().toISOString(),
    assets,
    scan_meta: {
      root,
      scanned_at: new Date().toISOString(),
      entries: currentMeta,
    },
  };
  ensureDir(path.dirname(registryPath()));
  writeJson(registryPath(), registry);
  return registry;
}
