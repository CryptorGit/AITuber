import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

import { resolveFormatIdOrSuggest } from './showdown/format_resolver';
import { appendJsonl } from './io/jsonl';
import { aggregateSummary, makeRunId, parseArgs, repoRoot, sha256Hex, type JsonRow } from './shared';
import { initRunPaths, runBattlesChunk, type BatchMeta } from './run_battles';

const BATCH_SIZE = 20;

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

function sampleOpponentSnapshot(snapshots: string[], poolSize: number, rng: () => number): string | null {
  if (snapshots.length === 0) return null;
  const pool = snapshots.slice(-Math.max(1, poolSize));
  // Exponential recency weighting.
  // Newer snapshots should be sampled more often.
  const halfLife = Math.max(1, Math.floor(pool.length / 2));
  const weights = pool.map((_, idx) => {
    const age = pool.length - 1 - idx;
    return Math.exp(-age / halfLife);
  });
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rng() * total;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

function makeRng(seed: number) {
  // Tiny deterministic RNG (xorshift32)
  let x = (seed >>> 0) || 0x12345678;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) % 0x1_0000_0000) / 0x1_0000_0000;
  };
}

async function listSnapshots(pythonUrl: string): Promise<string[]> {
  try {
    const res = await fetch(`${pythonUrl}/list_snapshots`);
    if (!res.ok) return [];
    const j = await res.json();
    const ids = Array.isArray(j?.snapshot_ids) ? j.snapshot_ids.map(String) : [];
    return ids.filter((s: string) => s.length > 0);
  } catch {
    return [];
  }
}

async function saveSnapshot(pythonUrl: string, tag: string): Promise<string | null> {
  try {
    const res = await fetch(`${pythonUrl}/save_snapshot`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tag }),
    });
    if (!res.ok) return null;
    const j = await res.json();
    const id = String(j?.snapshot_id ?? '').trim();
    return id || null;
  } catch {
    return null;
  }
}

async function trainBatch(pythonUrl: string, trajectories: JsonRow[], lr: number): Promise<any> {
  const p1Rows = trajectories.filter((r) => String(r['player']) === 'p1');
  const res = await fetch(`${pythonUrl}/train_batch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ trajectories: p1Rows, lr }),
  });
  const txt = await res.text();
  try {
    return JSON.parse(txt);
  } catch {
    return { ok: res.ok, text: txt };
  }
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
  //   npm run train -- <epochs> <format> <python_url> <seed> <snapshot_every> <opponent_pool> <lr>
  // parseArgs() may map these into existing keys; stitch them back here.
  const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (!args['epochs'] && positional[0] && isIntString(positional[0])) args['epochs'] = positional[0];
  if (!args['format'] && positional[1]) args['format'] = positional[1];
  if (!args['python_url'] && positional[2] && /^https?:\/\//i.test(positional[2])) args['python_url'] = positional[2];
  if (!args['seed'] && positional[3] && isIntString(positional[3])) args['seed'] = positional[3];
  if (!args['snapshot_every'] && positional[4] && isIntString(positional[4])) args['snapshot_every'] = positional[4];
  if (!args['opponent_pool'] && positional[5] && isIntString(positional[5])) args['opponent_pool'] = positional[5];
  if (!args['lr'] && positional[6]) args['lr'] = positional[6];
  if (!args['seed']) {
    const maybeSeed = String(args['python_url'] ?? '').trim();
    if (maybeSeed && isIntString(maybeSeed)) {
      args['seed'] = maybeSeed;
      args['python_url'] = '';
    }
  }

  const epochs = Number(args['epochs'] ?? '0'); // 0 => infinite
  const format = String(args['format'] ?? 'gen9vgc2026regf');
  const pythonUrl = asUrl(String(args['python_url'] ?? ''));
  const seed = Number(args['seed'] ?? '0');
  const snapshotEvery = Number(args['snapshot_every'] ?? '10');
  const opponentPool = Number(args['opponent_pool'] ?? '20');
  const lr = Number(args['lr'] ?? '0.01');

  if (!pythonUrl) {
    console.error('[train] --python_url is required (agent must be running)');
    process.exit(2);
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

  // Keep all artifacts for this training run under a single directory.
  process.env.VGC_SAVE_DIR = outDir;

  const { saveCfg, paths } = initRunPaths(root, { outDir });

  // Fresh run directory.
  rmSync(paths.battlesPath, { force: true });
  rmSync(paths.errorsPath, { force: true });
  rmSync(paths.debugPath, { force: true });
  rmSync(paths.trajectoriesPath, { force: true });
  rmSync(paths.replaysPath, { force: true });
  if (paths.batchesPath) rmSync(paths.batchesPath, { force: true });

  const runId = makeRunId();
  let stopRequested = false;
  process.on('SIGINT', () => {
    stopRequested = true;
    console.log('[train] SIGINT received; stopping after current batch...');
  });

  for (let epoch = 0; epochs === 0 || epoch < epochs; epoch++) {
    if (stopRequested) break;

    const rng = makeRng(seed + epoch * 99991);
    const snapshots = await listSnapshots(pythonUrl);
    const opponentSnapshot = sampleOpponentSnapshot(snapshots, opponentPool, rng);

    const opponentPolicy = opponentSnapshot ? `snapshot:${opponentSnapshot}` : 'heuristic';
    const opponentId = opponentSnapshot ? `snapshot:${opponentSnapshot}` : 'policy:heuristic';

    const batchSeed = seed + epoch * 100_000;
    const batchId = sha256Hex(`${resolved.id}:${seed}:${epoch}:learned:${opponentId}`).slice(0, 16);
    const batch: BatchMeta = {
      batch_id: batchId,
      batch_index: epoch,
      batch_size: BATCH_SIZE,
      batch_seed: batchSeed,
      opponent_id: opponentId,
    };

    console.log(
      `[train] epoch=${epoch + 1}${epochs ? `/${epochs}` : ''} batch_id=${batchId} opponent=${opponentId} seed=${batchSeed}`
    );

    const { rows, battleIds, trajectoryRows } = await runBattlesChunk({
      runId,
      startBattleIndex: epoch * BATCH_SIZE,
      nBattles: BATCH_SIZE,
      seedBase: batchSeed,
      formatId: resolved.id,
      p1Policy: 'learned',
      p2Policy: opponentPolicy,
      pythonUrl,
      saveCfg,
      paths,
      batch,
      collectTrajectories: true,
    });

    const batchSummary = aggregateSummary(rows);
    appendJsonl(paths.batchesPath!, {
      run_id: runId,
      batch_id: batchId,
      batch_index: epoch,
      batch_size: BATCH_SIZE,
      batch_seed: batchSeed,
      format: resolved.id,
      p1_policy: 'learned',
      p2_policy: opponentPolicy,
      opponent_id: opponentId,
      battle_ids: battleIds,
      summary: batchSummary,
    });

    console.log(`[train] batch_summary: ${JSON.stringify(batchSummary)}`);

    // Train the agent from this batch (p1 only).
    try {
      const trainRes = await trainBatch(pythonUrl, trajectoryRows, lr);
      console.log(`[train] train_result: ${JSON.stringify(trainRes)}`);
    } catch (e: any) {
      console.warn(`[train] train_batch failed: ${String(e?.message ?? e)}`);
    }

    if (snapshotEvery > 0 && (epoch + 1) % snapshotEvery === 0) {
      const snap = await saveSnapshot(pythonUrl, `epoch_${epoch + 1}`);
      if (snap) console.log(`[train] saved snapshot: ${snap}`);
      else console.warn('[train] save_snapshot failed');
    }
  }

  console.log(`[train] done. out_dir=${outDir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
