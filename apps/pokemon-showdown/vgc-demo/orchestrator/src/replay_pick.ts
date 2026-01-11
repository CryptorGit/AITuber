import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readSaveConfig } from './learn/save_config';
import { readJsonlMaybeGz } from './io/jsonl';

function repoRoot(): string {
  const here = fileURLToPath(new URL('.', import.meta.url));
  return join(here, '../../../../..');
}

function parseArgs(argv: string[]) {
  const out: Record<string, string> = {};
  const positional: string[] = [];

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
      out[k] = v;
    } else {
      positional.push(a);
    }
  }

  // npm may swallow unknown --flags and leave only values as positional args.
  // Support fallback positional shapes:
  //   [where, min_turns?, first?]
  if (!out['where'] && positional[0]) out['where'] = positional[0];
  if (!out['min_turns'] && positional[1]) out['min_turns'] = positional[1];
  if (!out['first'] && positional[2]) out['first'] = positional[2];

  // Some npm versions swallow unknown --flags into env vars instead.
  if (!out['where']) {
    const v = String(process.env.npm_config_where ?? '').trim();
    if (v) out['where'] = v;
  }
  if (!out['min_turns']) {
    const v = String(process.env.npm_config_min_turns ?? '').trim();
    if (v) out['min_turns'] = v;
  }
  if (!out['first']) {
    const v = String(process.env.npm_config_first ?? '').trim();
    if (v) out['first'] = v;
  }
  return out;
}

function usageExit() {
  console.error('Usage: npm run replay:pick -- --where "winner=p1" [--min_turns 12] [--first true]');
  process.exit(2);
}

function parseWhere(whereRaw: string): { winner?: string } {
  const where = String(whereRaw ?? '').trim();
  if (!where) return {};
  const m = /^winner\s*=\s*(p1|p2|tie)$/i.exec(where);
  if (!m) return {};
  return { winner: m[1].toLowerCase() };
}

async function main() {
  const args = parseArgs(process.argv);
  const where = parseWhere(String(args['where'] ?? ''));
  const minTurns = args['min_turns'] != null ? Number(args['min_turns']) : null;
  const firstOnly = String(args['first'] ?? '').toLowerCase() === 'true';

  if (!where.winner && minTurns == null) usageExit();

  const root = repoRoot();
  const outDir = join(root, 'data/pokemon-showdown/vgc-demo');
  const saveCfg0 = readSaveConfig(outDir);

  const outDirResolved = resolve(outDir);
  let saveDir = resolve(saveCfg0.saveDir);
  if (!saveDir.toLowerCase().startsWith(outDirResolved.toLowerCase())) {
    console.warn(`[vgc-demo] VGC_SAVE_DIR must be under data/pokemon-showdown/vgc-demo/: ${saveCfg0.saveDir} (using default)`);
    saveDir = outDirResolved;
  }

  const replaysPathPlain = join(saveDir, 'replays.jsonl');
  const replaysPathGz = join(saveDir, 'replays.jsonl.gz');
  const replaysPath = existsSync(replaysPathPlain) ? replaysPathPlain : replaysPathGz;
  if (!existsSync(replaysPath)) {
    console.error(`Missing replay log: ${replaysPathPlain} (or .gz)`);
    process.exit(2);
  }

  const rows = readJsonlMaybeGz(replaysPath);
  const hits: string[] = [];

  for (const r of rows) {
    const battleId = String(r?.battle_id ?? '').trim();
    if (!battleId) continue;

    const w = String(r?.expected_winner ?? 'tie').toLowerCase();
    const t = Number(r?.expected_turns ?? 0);

    if (where.winner && w !== where.winner) continue;
    if (minTurns != null && !(Number.isFinite(t) && t >= minTurns)) continue;

    hits.push(battleId);
    if (firstOnly) break;
  }

  if (hits.length === 0) {
    console.error('No matching battle_id found');
    process.exit(1);
  }

  for (const id of hits) console.log(id);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
