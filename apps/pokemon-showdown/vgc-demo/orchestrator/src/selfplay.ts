import { rmSync, writeFileSync } from 'node:fs';

import { resolveFormatIdOrSuggest } from './showdown/format_resolver';
import { appendJsonl } from './io/jsonl';
import { aggregateSummary, makeRunId, parseArgs, repoRoot, sha256Hex, readJsonl } from './shared';
import { initRunPaths, runBattlesChunk, type BatchMeta } from './run_battles';

// Fixed batch size baseline.
const BATCH_SIZE = 20;

async function main() {
  const args = parseArgs(process.argv);

  const isIntString = (s: string) => /^-?\d+$/.test(s.trim());

  // npm may swallow unknown flags like "--n_batches" and instead forward only values.
  // In that situation, our shared parseArgs (optimized for the demo CLI) may map:
  //   n_batches -> n_battles
  //   seed -> python_url
  // Fix those up here to keep selfplay stable on Windows/npm.
  if (!args['n_batches'] && args['n_battles']) args['n_batches'] = args['n_battles'];
  if (!args['n_batches']) {
    const npmCfg = String(process.env.npm_config_n_batches ?? '').trim();
    if (npmCfg && isIntString(npmCfg)) args['n_batches'] = npmCfg;
  }

  if (!args['seed']) {
    const npmCfg = String(process.env.npm_config_seed ?? '').trim();
    if (npmCfg && isIntString(npmCfg)) args['seed'] = npmCfg;
  }
  if (!args['seed']) {
    const maybeSeed = String(args['python_url'] ?? '').trim();
    if (maybeSeed && isIntString(maybeSeed)) {
      args['seed'] = maybeSeed;
      args['python_url'] = '';
    }
  }

  const nBatches = Number(args['n_batches'] ?? '1');
  const format = String(args['format'] ?? 'gen9vgc2026regf');
  const p1Policy = String(args['p1_policy'] ?? 'heuristic');
  const p2Policy = String(args['p2_policy'] ?? 'heuristic');
  const pythonUrl = String(args['python_url'] ?? '');
  const seed = Number(args['seed'] ?? '0');

  const resolved = resolveFormatIdOrSuggest(format);
  if (!resolved.ok) {
    console.error(resolved.error);
    process.exit(2);
  }

  const root = repoRoot();
  const { saveCfg, paths } = initRunPaths(root);

  // Reset logs once per selfplay run.
  rmSync(paths.battlesPath, { force: true });
  rmSync(paths.errorsPath, { force: true });
  rmSync(paths.debugPath, { force: true });
  rmSync(paths.trajectoriesPath, { force: true });
  rmSync(paths.replaysPath, { force: true });
  if (paths.batchesPath) rmSync(paths.batchesPath, { force: true });

  const runId = makeRunId();
  const opponentId = `policy:${p2Policy}`;

  for (let b = 0; b < nBatches; b++) {
    const batchSeed = seed + b * 100_000;
    const batchId = sha256Hex(`${resolved.id}:${seed}:${b}:${p1Policy}:${opponentId}`).slice(0, 16);
    const batch: BatchMeta = {
      batch_id: batchId,
      batch_index: b,
      batch_size: BATCH_SIZE,
      batch_seed: batchSeed,
      opponent_id: opponentId,
    };

    console.log(`[selfplay] batch ${b + 1}/${nBatches} (size=${BATCH_SIZE}) opponent=${opponentId} seed=${batchSeed}`);
    const { rows, battleIds } = await runBattlesChunk({
      runId,
      startBattleIndex: b * BATCH_SIZE,
      nBattles: BATCH_SIZE,
      seedBase: batchSeed,
      formatId: resolved.id,
      p1Policy,
      p2Policy,
      pythonUrl,
      saveCfg,
      paths,
      batch,
    });

    const batchSummary = aggregateSummary(rows);
    appendJsonl(paths.batchesPath!, {
      run_id: runId,
      batch_id: batchId,
      batch_index: b,
      batch_size: BATCH_SIZE,
      batch_seed: batchSeed,
      format: resolved.id,
      p1_policy: p1Policy,
      p2_policy: p2Policy,
      opponent_id: opponentId,
      battle_ids: battleIds,
      summary: batchSummary,
    });

    console.log(`[selfplay] batch_summary: ${JSON.stringify(batchSummary)}`);
  }

  // Keep summary.json consistent with battles.jsonl (whole-run aggregation).
  const rowsAll = readJsonl(paths.battlesPath);
  const summary = aggregateSummary(rowsAll);
  writeFileSync(paths.summaryPath, JSON.stringify(summary, null, 2), 'utf8');

  console.log(`[selfplay] wrote ${paths.battlesPath}`);
  console.log(`[selfplay] wrote ${paths.batchesPath}`);
  console.log(`[selfplay] wrote ${paths.summaryPath}`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
