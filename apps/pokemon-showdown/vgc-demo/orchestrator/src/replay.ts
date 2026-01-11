import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readSaveConfig } from './learn/save_config';
import { compareReplayMeta } from './meta';
import { readJsonlMaybeGz } from './io/jsonl';
import { runReplay, type ReplayRecord } from './showdown/replay_runner';

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
  if (!out['battle_id'] && positional[0]) out['battle_id'] = positional[0];
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const battleId = String(args['battle_id'] ?? '').trim();
  if (!battleId) {
    console.error('Usage: npm run replay -- <battle_id>');
    process.exit(2);
  }

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
    console.error('Set VGC_SAVE_REPLAY=1 and rerun the demo first.');
    process.exit(2);
  }

  const rows = readJsonlMaybeGz(replaysPath);
  const row = rows.find((r) => r && String(r.battle_id ?? '') === battleId);
  if (!row) {
    console.error(`battle_id not found in ${replaysPath}: ${battleId}`);
    process.exit(2);
  }

  const record: ReplayRecord = {
    battle_id: String(row.battle_id),
    format: String(row.format),
    seed: Number(row.seed),
    start_seed: Array.isArray(row.start_seed) ? row.start_seed.map((x: any) => Number(x)) : undefined,
    p1_team: String(row.p1_team),
    p2_team: String(row.p2_team),
    p1_choices: Array.isArray(row.p1_choices) ? row.p1_choices.map((x: any) => String(x)) : [],
    p2_choices: Array.isArray(row.p2_choices) ? row.p2_choices.map((x: any) => String(x)) : [],
    expected_winner: row.expected_winner != null ? String(row.expected_winner) : undefined,
    expected_turns: row.expected_turns != null ? Number(row.expected_turns) : undefined,
  };

  const warnings = compareReplayMeta(row.meta);
  if (warnings.length > 0) {
    console.warn('[vgc-demo][WARN] replay meta mismatch/unknown detected (replay will still run)');
    for (const w of warnings.slice(0, 20)) console.warn(`[vgc-demo][WARN] ${w}`);
    if (warnings.length > 20) console.warn(`[vgc-demo][WARN] ...and ${warnings.length - 20} more`);
  }

  const res = await runReplay(record);
  const expectedWinner = record.expected_winner ?? 'tie';
  const winnerActual = res.winner ?? 'tie';
  const winnerMatch = expectedWinner === winnerActual;
  const turnsMatch = record.expected_turns == null ? true : record.expected_turns === res.turns;
  const ok = winnerMatch && turnsMatch;
  console.log(
    JSON.stringify(
      {
        battle_id: battleId,
        winner: winnerActual,
        turns: res.turns,
        winner_match: winnerMatch,
        turns_match: turnsMatch,
        ok,
        warnings,
      },
      null,
      2
    )
  );

  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
