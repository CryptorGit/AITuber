import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

import { resolveFormatIdOrSuggest } from './showdown/format_resolver';
import { appendJsonl } from './io/jsonl';
import { aggregateSummary, makeRunId, parseArgs, repoRoot, sha256Hex, type JsonRow } from './shared';
import { initRunPaths, runBattlesChunk, type BatchMeta } from './run_battles';
import { PpoClient } from './ppo/ppo_client';
import { LeagueManager } from './ppo/league_manager';
import { RolloutCollector } from './ppo/rollout_collector';
import { PpoRunStats } from './ppo/ppo_observability';
import { resolvePpoRolloutLen } from './ppo/rollout_config';

const DEFAULT_BATTLES_PER_BATCH = 20;
const DEFAULT_BATCHES_PER_EPOCH = 1;

function isIntString(s: string) {
  return /^-?\d+$/.test(s.trim());
}

function asUrl(s: string) {
  const u = String(s || '').trim();
  return u.endsWith('/') ? u.slice(0, -1) : u;
}

function nowCompact() {
  return new Date().toISOString().replace(/[-:.TZ]/g, '');
}

async function main() {
  const args = parseArgs(process.argv);

  // npm flag swallowing compatibility
  if (!args['epochs'] && args['n_battles']) args['epochs'] = args['n_battles'];
  if (!args['epochs']) {
    const npmCfg = String(process.env.npm_config_epochs ?? '').trim();
    if (npmCfg && isIntString(npmCfg)) args['epochs'] = npmCfg;
  }
  if (!args['seed']) {
    const npmCfg = String(process.env.npm_config_seed ?? '').trim();
    if (npmCfg && isIntString(npmCfg)) args['seed'] = npmCfg;
  }

  // Positional form supported by scripts/run_ps_vgc_train.ps1:
  //   npm run train -- <epochs> <format> <python_url> <seed> <snapshot_every> <opponent_pool> <lr> [batches_per_epoch] [battles_per_batch] [resume_snapshot] [save_snapshot_on_exit]
  // parseArgs() may map these into existing keys; stitch them back here.
  const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (!args['epochs'] && positional[0] && isIntString(positional[0])) args['epochs'] = positional[0];
  if (!args['format'] && positional[1]) args['format'] = positional[1];
  if (!args['python_url'] && positional[2] && /^https?:\/\//i.test(positional[2])) args['python_url'] = positional[2];
  if (!args['seed'] && positional[3] && isIntString(positional[3])) args['seed'] = positional[3];
  if (!args['snapshot_every'] && positional[4] && isIntString(positional[4])) args['snapshot_every'] = positional[4];
  if (!args['opponent_pool'] && positional[5] && isIntString(positional[5])) args['opponent_pool'] = positional[5];
  if (!args['lr'] && positional[6]) args['lr'] = positional[6];
  if (!args['batches_per_epoch'] && positional[7] && isIntString(positional[7])) args['batches_per_epoch'] = positional[7];
  if (!args['battles_per_batch'] && positional[8] && isIntString(positional[8])) args['battles_per_batch'] = positional[8];
  // Optional tail args: resume_snapshot and save_snapshot_on_exit.
  // Be careful: shell wrappers may omit empty args, so a lone numeric tail should be treated as save_snapshot_on_exit.
  if (!args['resume_snapshot'] && positional[9] && !isIntString(positional[9])) args['resume_snapshot'] = positional[9];
  if (!args['save_snapshot_on_exit'] && positional[10] && isIntString(positional[10])) args['save_snapshot_on_exit'] = positional[10];
  if (!args['save_snapshot_on_exit'] && !args['resume_snapshot'] && positional[9] && isIntString(positional[9])) {
    args['save_snapshot_on_exit'] = positional[9];
  }
  if (!args['seed']) {
    const maybeSeed = String(args['python_url'] ?? '').trim();
    if (maybeSeed && isIntString(maybeSeed)) {
      args['seed'] = maybeSeed;
      args['python_url'] = '';
    }
  }

  if (!args['resume_snapshot']) {
    const env = String(process.env.VGC_TRAIN_RESUME_SNAPSHOT ?? '').trim();
    if (env) args['resume_snapshot'] = env;
  }
  if (!args['save_snapshot_on_exit']) {
    const env = String(process.env.VGC_TRAIN_SAVE_SNAPSHOT_ON_EXIT ?? '').trim();
    if (env && isIntString(env)) args['save_snapshot_on_exit'] = env;
  }

  const epochs = Number(args['epochs'] ?? '0'); // 0 => infinite
  const format = String(args['format'] ?? 'gen9vgc2026regf');
  const pythonUrl = asUrl(String(args['python_url'] ?? ''));
  const seed = Number(args['seed'] ?? '0');
  const snapshotEvery = Number(args['snapshot_every'] ?? '10');
  const opponentPool = Number(args['opponent_pool'] ?? '20');
  const lr = Number(args['lr'] ?? '0.01');
  const batchesPerEpoch = Number(args['batches_per_epoch'] ?? String(DEFAULT_BATCHES_PER_EPOCH));
  const battlesPerBatch = Number(args['battles_per_batch'] ?? String(DEFAULT_BATTLES_PER_BATCH));
  const resumeSnapshot = String(args['resume_snapshot'] ?? '').trim();
  const saveSnapshotOnExit = Number(args['save_snapshot_on_exit'] ?? '0') > 0;

  const batchesPerEpochInt = Number.isFinite(batchesPerEpoch) && batchesPerEpoch > 0 ? Math.trunc(batchesPerEpoch) : DEFAULT_BATCHES_PER_EPOCH;
  const battlesPerBatchInt = Number.isFinite(battlesPerBatch) && battlesPerBatch > 0 ? Math.trunc(battlesPerBatch) : DEFAULT_BATTLES_PER_BATCH;

  if (!pythonUrl) {
    console.error('[train] --python_url is required (agent must be running)');
    process.exit(2);
  }

  // PPO training now runs via the PPO endpoints (/act + /train) during battle-time.
  // The legacy --lr flag is kept for script compatibility but is not used by PPO.
  if (Number.isFinite(lr) && lr !== 0.01) {
    console.warn('[train] NOTE: --lr is ignored for PPO (set PPO_LR on the Python server process instead)');
  }

  const resolved = resolveFormatIdOrSuggest(format);
  if (!resolved.ok) {
    console.error(resolved.error);
    process.exit(2);
  }

  const root = repoRoot();
  const trainRunId = `train_${nowCompact()}_${randomBytes(3).toString('hex')}`;
  const outDir = join(root, 'data/pokemon-showdown/vgc-demo', trainRunId);
  mkdirSync(outDir, { recursive: true });

  // Ensure trajectories include full request JSON so the agent can actually train.
  process.env.VGC_SAVE_TRAIN_LOG = '1';
  process.env.VGC_SAVE_SAMPLE_RATE = '1';
  process.env.VGC_OBS_MODE = 'full';

  // Replay Studio indexes only train_* dirs that have replays.jsonl(.gz).
  // For training runs, we default to saving a minimal subset to avoid exploding disk usage.
  process.env.VGC_SAVE_REPLAY = '1';
  process.env.VGC_SAVE_REPLAY_ONLY_AFTER_UPDATE = '1';

  // Keep all artifacts for this training run under a single directory.
  process.env.VGC_SAVE_DIR = outDir;

  const { saveCfg, paths } = initRunPaths(root, { outDir });

  const ppoClient = new PpoClient(pythonUrl);

  if (resumeSnapshot) {
    try {
      let sid = resumeSnapshot;
      if (sid === 'latest') {
        const snaps = await ppoClient.listSnapshots();
        snaps.sort((a, b) => (b.step ?? 0) - (a.step ?? 0));
        if (!snaps.length) throw new Error('no snapshots found');
        sid = snaps[0].id;
        console.log(`[train] resume_snapshot=latest resolved_id=${sid} step=${snaps[0].step}`);
      } else {
        console.log(`[train] resume_snapshot=${sid}`);
      }
      const ok = await ppoClient.loadSnapshot(sid);
      if (!ok) throw new Error(`snapshot/load returned ok=false for id=${sid}`);
      console.log(`[train] resumed from snapshot id=${sid}`);
    } catch (e: any) {
      console.error(`[train] resume failed: ${String(e?.message ?? e)}`);
      process.exit(2);
    }
  }

  // Fresh run directory.
  rmSync(paths.battlesPath, { force: true });
  rmSync(paths.errorsPath, { force: true });
  rmSync(paths.debugPath, { force: true });
  rmSync(paths.trajectoriesPath, { force: true });
  rmSync(paths.replaysPath, { force: true });
  if (paths.batchesPath) rmSync(paths.batchesPath, { force: true });

  // RUN_ID: required for E2E isolation + metrics reproducibility.
  const runId = makeRunId();
  process.env.PPO_RUN_ID = runId;
  console.log(`[train] run_id=${runId}`);

  const rolloutCfg = resolvePpoRolloutLen();
  console.log(
    `[train] applied_config ppo_rollout_len=${rolloutCfg.value} source=${rolloutCfg.source} seed=${seed} epochs=${epochs} batches_per_epoch=${batchesPerEpochInt} battles_per_batch=${battlesPerBatchInt} format=${resolved.id}`
  );

  // Ensure PPO writes metrics/dumps under logs/runs/{run_id}/...
  const ppoStats = new PpoRunStats(runId);
  ppoStats.setAppliedConfig({ rollout_len: rolloutCfg.value, rollout_len_source: rolloutCfg.source });
  ppoStats.forceLogProgress('start');

  // Share PPO objects across batches so "save replay after update" works across batch boundaries.
  const ppoCollector = new RolloutCollector(ppoClient, rolloutCfg.value, ppoStats);
  const ppoLeague = new LeagueManager(ppoClient);
  let stopRequested = false;
  process.on('SIGINT', () => {
    stopRequested = true;
    console.log('[train] SIGINT received; stopping after current batch...');
  });

  let globalBatchIndex = 0;
  let globalBattleIndex = 0;

  for (let epoch = 0; epochs === 0 || epoch < epochs; epoch++) {
    if (stopRequested) break;

    for (let b = 0; b < batchesPerEpochInt; b++) {
      if (stopRequested) break;

      // PPO self-play league: opponent policy is resolved per-battle in run_battles.ts.
      // (50% mirror learner, 40% stratified snapshots, 10% baseline)
      const opponentPolicy = 'league';
      const opponentId = 'policy:league';

      const batchSeed = seed + globalBatchIndex * 100_000;
      const batchId = sha256Hex(`${resolved.id}:${seed}:${epoch}:${b}:${globalBatchIndex}:learned:${opponentId}`).slice(0, 16);
      const batch: BatchMeta = {
        batch_id: batchId,
        batch_index: globalBatchIndex,
        batch_size: battlesPerBatchInt,
        batch_seed: batchSeed,
        opponent_id: opponentId,
      };

      console.log(
        `[train] epoch=${epoch + 1}${epochs ? `/${epochs}` : ''} batch=${b + 1}/${batchesPerEpochInt} batch_id=${batchId} opponent=${opponentId} seed=${batchSeed} battles_per_batch=${battlesPerBatchInt}`
      );

      const { rows, battleIds, trajectoryRows } = await runBattlesChunk({
        runId,
        startBattleIndex: globalBattleIndex,
        nBattles: battlesPerBatchInt,
        seedBase: batchSeed,
        formatId: resolved.id,
        p1Policy: 'learner',
        p2Policy: opponentPolicy,
        pythonUrl,
        saveCfg,
        paths,
        batch,
        collectTrajectories: true,
        ppoStats,
        ppo: { client: ppoClient, collector: ppoCollector, league: ppoLeague },
      });

      const batchSummary = aggregateSummary(rows);
      appendJsonl(paths.batchesPath!, {
        run_id: runId,
        batch_id: batchId,
        batch_index: globalBatchIndex,
        epoch_index: epoch,
        batch_in_epoch: b,
        batches_per_epoch: batchesPerEpochInt,
        batch_size: battlesPerBatchInt,
        batch_seed: batchSeed,
        format: resolved.id,
        p1_policy: 'learned',
        p2_policy: opponentPolicy,
        opponent_id: opponentId,
        battle_ids: battleIds,
        summary: batchSummary,
      });

      console.log(`[train] batch_summary: ${JSON.stringify(batchSummary)}`);

      // PPO training happens online via /train during the battles.
      void trajectoryRows;

      globalBatchIndex += 1;
      globalBattleIndex += battlesPerBatchInt;
    }

    if (snapshotEvery > 0 && (epoch + 1) % snapshotEvery === 0) {
      try {
        const snap = await ppoClient.saveSnapshot(`epoch_${epoch + 1}`);
        if (snap) console.log(`[train] saved snapshot: ${snap}`);
        else console.warn('[train] snapshot/save returned empty id');
      } catch (e: any) {
        console.warn(`[train] snapshot/save failed: ${String(e?.message ?? e)}`);
      }
    }
  }

  if (stopRequested && saveSnapshotOnExit) {
    try {
      const snap = await ppoClient.saveSnapshot('sigint');
      if (snap) console.log(`[train] saved snapshot on exit: ${snap}`);
      else console.warn('[train] snapshot/save (on exit) returned empty id');
    } catch (e: any) {
      console.warn(`[train] snapshot/save (on exit) failed: ${String(e?.message ?? e)}`);
    }
  }

  ppoStats.forceLogProgress('final');
  console.log(`[train] done. out_dir=${outDir} run_id=${runId}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
