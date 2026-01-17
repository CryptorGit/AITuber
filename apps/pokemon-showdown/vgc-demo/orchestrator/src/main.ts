import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { appendJsonl, appendJsonlGz } from './io/jsonl';
import { extractRequestFeatures } from './learn/obs_features';
import { readSaveConfig } from './learn/save_config';
import { collectReplayMeta } from './meta';
import { listVgcFormatCandidates, resolveFormatIdOrSuggest } from './showdown/format_resolver';
import { generatePackedTeam, loadTeamGenData, tryGeneratePackedTeamFromPool } from './team/teamgen';
import { runOneBattle, type TraceDecisionEvent } from './showdown/sim_runner';
import { LeagueManager } from './ppo/league_manager';
import { PpoBattleCoordinator } from './ppo/ppo_battle_coordinator';
import { PpoClient } from './ppo/ppo_client';
import { RolloutCollector } from './ppo/rollout_collector';
import { PpoRunStats } from './ppo/ppo_observability';
import * as TeamsMod from '../../../../../tools/pokemon-showdown/pokemon-showdown/sim/teams';

const Teams: any = (TeamsMod as any).default?.Teams ?? (TeamsMod as any).Teams ?? (TeamsMod as any).default;
const DEBUG = process.env.VGC_DEMO_DEBUG === '1';

function isPpoPolicy(p: string): boolean {
  const s = String(p ?? '').trim();
  return s === 'ppo' || s === 'learner' || s === 'baseline' || s === 'league' || s.startsWith('snapshot:');
}

function toPpoPolicyId(p: string): string {
  const s = String(p ?? '').trim();
  if (s === 'ppo') return 'learner';
  if (s === 'league') return 'league';
  if (s === 'learner' || s === 'baseline' || s.startsWith('snapshot:')) return s;
  return 'learner';
}

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

  // npm on some versions may consume unknown "--flag" options and leave only values.
  // Support positional fallback.
  // Common shapes observed:
  // - [n_battles, format, p1_policy, p2_policy, python_url?, seed?]
  // - [n_battles, format, python_url, p1_policy, p2_policy, seed?] (when npm eats the flags)
  const looksLikeUrl = (s: string | undefined) => !!s && /^https?:\/\//i.test(s);
  if (!out['n_battles'] && positional[0]) out['n_battles'] = positional[0];
  if (!out['format'] && positional[1]) out['format'] = positional[1];

  if (looksLikeUrl(positional[2])) {
    if (!out['python_url'] && positional[2]) out['python_url'] = positional[2];
    if (!out['p1_policy'] && positional[3]) out['p1_policy'] = positional[3];
    if (!out['p2_policy'] && positional[4]) out['p2_policy'] = positional[4];
    if (!out['seed'] && positional[5]) out['seed'] = positional[5];
  } else {
    if (!out['p1_policy'] && positional[2]) out['p1_policy'] = positional[2];
    if (!out['p2_policy'] && positional[3]) out['p2_policy'] = positional[3];
    if (!out['python_url'] && positional[4]) out['python_url'] = positional[4];
    if (!out['seed'] && positional[5]) out['seed'] = positional[5];
  }

  return out;
}

function isoNow() {
  return new Date().toISOString();
}

function makeRunId() {
  // Stable per-run identifier; safe for filenames/ids.
  const ts = new Date().toISOString().replace(/[-:.TZ]/g, '');
  const rand = randomBytes(4).toString('hex');
  return `${ts}_${rand}`;
}

function sha256Hex(s: string) {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

function hashToUnitInterval(s: string): number {
  // Deterministic [0,1) from sha256 prefix.
  const h = sha256Hex(s).slice(0, 8);
  const n = parseInt(h, 16) >>> 0;
  return n / 0x1_0000_0000;
}

function lcg(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

function sampleUniqueIndices(n: number, k: number, rng: () => number): number[] {
  const out: number[] = [];
  const used = new Set<number>();
  let guard = 0;
  while (out.length < k && guard++ < 10000) {
    const idx = Math.floor(rng() * n);
    if (idx < 0 || idx >= n) continue;
    if (used.has(idx)) continue;
    used.add(idx);
    out.push(idx);
  }
  if (out.length !== k) throw new Error(`Failed to sample ${k} unique indices from 0..${n - 1}`);
  return out;
}

function shuffleInPlace<T>(arr: T[], rng: () => number) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
}

function clampInt(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
}

function buildTeamPreviewChoice(opts: {
  teamSize: number;
  pickN: number;
  selectIdx0: number[];
}): string {
  const teamSize = clampInt(opts.teamSize, 1, 24);
  const pickN = clampInt(opts.pickN, 1, teamSize);

  // If we bring the whole team (6v6 singles, etc), keep a stable order.
  if (pickN >= teamSize) {
    const order = Array.from({ length: teamSize }, (_, i) => i + 1);
    return `team ${order.join('')}`;
  }

  const digits = opts.selectIdx0
    .slice(0, pickN)
    .map((i) => clampInt(Number(i), 0, teamSize - 1) + 1)
    .join('');

  return `team ${digits}`;
}

type BattleRow = Record<string, unknown>;

function readJsonl(filePath: string): BattleRow[] {
  if (!existsSync(filePath)) return [];
  const txt = readFileSync(filePath, 'utf8');
  const lines = txt.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const rows: BattleRow[] = [];
  for (const line of lines) {
    try {
      rows.push(JSON.parse(line));
    } catch {
      // ignore malformed lines
    }
  }
  return rows;
}

function aggregateSummary(rows: BattleRow[]) {
  const n = rows.length;
  let p1wins = 0;
  let p2wins = 0;
  let ties = 0;
  let errors = 0;
  let totalTurns = 0;
  let totalSimMs = 0;
  let totalBattleMs = 0;
  let format: string | null = null;
  let runId: string | null = null;

  const asNum = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const asStr = (v: unknown) => (typeof v === 'string' ? v : null);

  for (const r of rows) {
    const w = asStr(r['winner']);
    if (w === 'p1') p1wins++;
    else if (w === 'p2') p2wins++;
    else if (w === 'tie' || w === null) ties++;
    else if (w === 'error') errors++;

    totalTurns += asNum(r['turns']);
    totalSimMs += asNum(r['sim_ms'] ?? r['ms']);
    totalBattleMs += asNum(r['battle_total_ms'] ?? r['duration_ms']);

    if (!format) format = asStr(r['format']);
    if (!runId) runId = asStr(r['run_id']);
  }

  return {
    run_id: runId,
    format,
    n_battles: n,
    p1wins,
    p2wins,
    ties,
    winrate_p1: n ? p1wins / n : 0,
    avg_turns: n ? totalTurns / n : 0,
    // Backward compatible alias (historically based on the sim loop's ms):
    avg_ms: n ? totalSimMs / n : 0,
    avg_sim_ms: n ? totalSimMs / n : 0,
    avg_battle_total_ms: n ? totalBattleMs / n : 0,
    error_rate: n ? errors / n : 0,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  // npm may swallow unknown flags like "--list_formats" and instead expose them as
  // environment variables (npm_config_list_formats=true). Honor that so users can
  // still run: npm run demo -- --list_formats
  if (!args['list_formats']) {
    const npmCfg = String(process.env.npm_config_list_formats ?? '').toLowerCase();
    if (npmCfg === 'true' || npmCfg === '1') args['list_formats'] = 'true';
  }
  if (args['list_formats'] === 'true') {
    console.log(JSON.stringify(listVgcFormatCandidates(), null, 2));
    return;
  }

  const nBattles = Number(args['n_battles'] ?? '200');
  const format = String(args['format'] ?? 'gen9vgc2026regf');
  const p1Policy = String(args['p1_policy'] ?? 'heuristic');
  const p2Policy = String(args['p2_policy'] ?? 'heuristic');
  const pythonUrl = String(args['python_url'] ?? '');
  const seed = Number(args['seed'] ?? '0');

  // PPO state (optional).
  const ppoRolloutLen = clampInt(Number(process.env.PPO_ROLLOUT_LEN ?? '5048'), 8, 8192);
  const ppoEnabled = isPpoPolicy(p1Policy) || isPpoPolicy(p2Policy);
  const ppoClient = ppoEnabled ? new PpoClient(pythonUrl) : null;
  const ppoStats = ppoClient ? new PpoRunStats() : null;
  const ppoCollector = ppoClient ? new RolloutCollector(ppoClient, ppoRolloutLen, ppoStats ?? undefined) : null;
  const ppoLeague = ppoClient ? new LeagueManager(ppoClient) : null;

  const resolved = resolveFormatIdOrSuggest(format);
  if (!resolved.ok) {
    console.error(resolved.error);
    console.error('VGC candidates (first 50):');
    console.error(JSON.stringify(resolved.candidates.slice(0, 50), null, 2));
    process.exit(2);
  }

  const root = repoRoot();
  const vgcDataRoot = join(root, 'data/pokemon-showdown/vgc-demo');
  mkdirSync(vgcDataRoot, { recursive: true });

  const runId = makeRunId();
  // Write demo outputs in a per-run train_* directory so Replay Studio indexes them.
  const outDir = join(vgcDataRoot, `train_${runId}`);
  mkdirSync(outDir, { recursive: true });

  const saveCfg0 = readSaveConfig(outDir);
  const outDirResolved = resolve(outDir);
  let saveDir = resolve(saveCfg0.saveDir);
  if (!saveDir.toLowerCase().startsWith(outDirResolved.toLowerCase())) {
    console.warn(`[vgc-demo] VGC_SAVE_DIR must be under ${outDir}: ${saveCfg0.saveDir} (using default)`);
    saveDir = outDirResolved;
  }
  const saveCfg = { ...saveCfg0, saveDir };
  // For demo runs, default to saving replays (unless user explicitly set VGC_SAVE_REPLAY).
  if (!Object.prototype.hasOwnProperty.call(process.env, 'VGC_SAVE_REPLAY')) {
    saveCfg.saveReplay = true;
  }

  const battlesPath = join(outDir, 'battles.jsonl');
  const summaryPath = join(outDir, 'summary.json');
  const errorsPath = join(outDir, 'errors.jsonl');
  const invalidsPath = join(outDir, 'invalids.jsonl');
  const debugPath = join(outDir, 'debug.jsonl');

  const trajectoriesPath = join(
    saveCfg.saveDir,
    saveCfg.compress ? 'trajectories.jsonl.gz' : 'trajectories.jsonl'
  );
  const replaysPath = join(saveCfg.saveDir, saveCfg.compress ? 'replays.jsonl.gz' : 'replays.jsonl');

  // Make outputs deterministic per run (no stale/accumulated lines).
  rmSync(battlesPath, { force: true });
  rmSync(errorsPath, { force: true });
  rmSync(invalidsPath, { force: true });
  rmSync(debugPath, { force: true });
  rmSync(trajectoriesPath, { force: true });
  rmSync(replaysPath, { force: true });

  // Create empty marker logs so "no events" is explicit.
  writeFileSync(invalidsPath, '', 'utf8');

  const appendSave = saveCfg.compress ? appendJsonlGz : appendJsonl;

  const data = loadTeamGenData();

  // Pool-only: do not fall back to species_pool/sets_min.

  // Team cycling: run N battles with the same team6, then resample.
  // Default to 10 so a 21-battle demo produces 10 + 10 + 1 battles across 3 teams.
  const battlesPerBatch = Math.max(1, Math.min(500, Number(process.env.VGC_BATTLES_PER_BATCH ?? '10') || 10));
  let curBatch = -1;
  let team6_p1: any[] = [];
  let team6_p2: any[] = [];
  let team6_packed_p1 = '';
  let team6_packed_p2 = '';
  let team1Hash = '';
  let team2Hash = '';
  let team1Id = '';
  let team2Id = '';

  // Updated per battle (inside the try block), but also needed in the catch path
  // so we can audit batch team rotation even when battles error/timeout.
  let select4_p1: number[] = [];
  let select4_p2: number[] = [];

  if (saveCfg.saveTrainLog || saveCfg.saveReplay) {
    console.log(
      `[vgc-demo] save: train=${saveCfg.saveTrainLog} replay=${saveCfg.saveReplay} sampleRate=${saveCfg.sampleRate} obs=${saveCfg.obsMode} compress=${saveCfg.compress} dir=${saveCfg.saveDir}`
    );
  }

  for (let i = 0; i < nBattles; i++) {
    const battleSeed = seed + i + 1;
    const battleId = `${runId}-${i}`;
    const startedAt = isoNow();
    const battleStartMs = Date.now();
    let phase = 'init';

    const sampled = saveCfg.sampleRate >= 1 || hashToUnitInterval(battleId) < saveCfg.sampleRate;
    const saveReplayThis = sampled && saveCfg.saveReplay;
    const saveTrainThis = sampled && saveCfg.saveTrainLog;

    const replayP1Choices: string[] = [];
    const replayP2Choices: string[] = [];
    const decisions: TraceDecisionEvent[] = [];
    const trace = (evt: TraceDecisionEvent) => {
      if (evt.player === 'p1') replayP1Choices.push(evt.choice_norm);
      else replayP2Choices.push(evt.choice_norm);
      if (saveTrainThis) decisions.push(evt);
    };

    try {
      phase = 'teamgen';
      const batch = Math.floor(i / battlesPerBatch);
      if (batch !== curBatch) {
        curBatch = batch;
        const batchSeed = seed + 100_000 * (batch + 1);

        const pool1 = tryGeneratePackedTeamFromPool(batchSeed * 1009 + 1, { mode: 'random' });
        const pool2 = tryGeneratePackedTeamFromPool(batchSeed * 1009 + 2, { mode: 'random' });
        if (!pool1 || !pool2) {
          throw new Error(
            'pool.json not usable (need >= 6 valid entries). Please populate config/pokemon-showdown/vgc-demo/pool.json'
          );
        }
        const t1 = pool1;
        const t2 = pool2;

        team6_p1 = t1.team;
        team6_p2 = t2.team;
        team6_packed_p1 = t1.packed;
        team6_packed_p2 = t2.packed;

        team1Hash = sha256Hex(team6_packed_p1);
        team2Hash = sha256Hex(team6_packed_p2);
        team1Id = team1Hash.slice(0, 12);
        team2Id = team2Hash.slice(0, 12);
      }

      // Team preview selection (demo): choose pickN mons from teamSize.
      // - VGC: 6 shown -> pick 4
      // - BSS singles: 6 shown -> pick 3
      phase = 'teamPreview';
      const teamSize = Array.isArray(team6_p1) ? team6_p1.length : 6;
      const defaultPickN = Number((data as any)?.rules?.battle_size ?? 4);
      const pickN = clampInt(Number(process.env.PS_PICK_N ?? defaultPickN), 1, teamSize);

      const rng1 = lcg(battleSeed * 1009 + 11);
      const rng2 = lcg(battleSeed * 1009 + 22);

      if (pickN >= teamSize) {
        select4_p1 = Array.from({ length: teamSize }, (_, i) => i);
        select4_p2 = Array.from({ length: teamSize }, (_, i) => i);
      } else {
        select4_p1 = sampleUniqueIndices(teamSize, pickN, rng1);
        select4_p2 = sampleUniqueIndices(teamSize, pickN, rng2);
        // Randomize order (the sim interprets order as lead preference where applicable).
        shuffleInPlace(select4_p1, rng1);
        shuffleInPlace(select4_p2, rng2);
      }

      const packed1 = team6_packed_p1;
      const packed2 = team6_packed_p2;
      const teamPreviewChoiceP1 = buildTeamPreviewChoice({ teamSize, pickN, selectIdx0: select4_p1 });
      const teamPreviewChoiceP2 = buildTeamPreviewChoice({ teamSize, pickN, selectIdx0: select4_p2 });

      const isLocal = (p: string) => p === 'battle_policy' || p.startsWith('local:');
      const policyMode1 = isLocal(p1Policy)
        ? 'local'
        : ppoEnabled && isPpoPolicy(p1Policy)
          ? 'ppo'
          : pythonUrl && p1Policy !== 'fallback'
            ? 'python'
            : 'fallback';
      const policyMode2 = isLocal(p2Policy)
        ? 'local'
        : ppoEnabled && isPpoPolicy(p2Policy)
          ? 'ppo'
          : pythonUrl && p2Policy !== 'fallback'
            ? 'python'
            : 'fallback';

      let ppoCoordinator: PpoBattleCoordinator | undefined;
      if (ppoEnabled && ppoClient && ppoCollector) {
        await ppoLeague?.refreshSnapshots();
        const p1PolicyId = toPpoPolicyId(p1Policy);
        let p2PolicyId = toPpoPolicyId(p2Policy);
        if (p2PolicyId === 'league' && ppoLeague) {
          const sample = ppoLeague.sampleOpponent(battleSeed ^ 0x9e3779b9);
          p2PolicyId = sample.policy_id;
        }
        ppoCoordinator = new PpoBattleCoordinator(
          ppoClient,
          ppoCollector,
          {
            p1_policy_id: p1PolicyId,
            p2_policy_id: p2PolicyId,
          },
          ppoStats ?? undefined,
          { battle_id: battleId }
        );
      }

      phase = 'battle';
      const result = await runOneBattle({
        runId,
        battleId,
        invalidLogPath: invalidsPath,
        formatId: resolved.id,
        seed: battleSeed,
        p1: {
          name: 'p1',
          team: packed1,
          policyMode: policyMode1 as any,
          python: policyMode1 === 'python' ? { baseUrl: pythonUrl, policy: (p1Policy as any) } : undefined,
          teamPreviewChoice: teamPreviewChoiceP1,
        },
        p2: {
          name: 'p2',
          team: packed2,
          policyMode: policyMode2 as any,
          python: policyMode2 === 'python' ? { baseUrl: pythonUrl, policy: (p2Policy as any) } : undefined,
          teamPreviewChoice: teamPreviewChoiceP2,
        },
        ppo: ppoCoordinator,
        debug: DEBUG ? { logPath: debugPath, runId, battleId } : undefined,
        trace: saveReplayThis || saveTrainThis ? trace : undefined,
      });

      const finishedAt = isoNow();
      const battleTotalMs = Date.now() - battleStartMs;

      appendJsonl(battlesPath, {
        // v2 schema (minimal sufficient):
        run_id: runId,
        battle_index: i,
        battle_id: battleId,
        seed: battleSeed,
        format: resolved.id,
        started_at: startedAt,
        finished_at: finishedAt,
        duration_ms: battleTotalMs,
        battle_total_ms: battleTotalMs,
        sim_ms: result.ms,
        winner: result.winner ?? 'tie',
        result_reason: undefined,
        turns: result.turns,
        p1: { policy: result.p1.policy, team_id: team1Id, team_hash: team1Hash, select4: select4_p1 },
        p2: { policy: result.p2.policy, team_id: team2Id, team_hash: team2Hash, select4: select4_p2 },
        teams: { team1_packed: team6_packed_p1, team2_packed: team6_packed_p2 },
        rng: { seed: battleSeed },

        // Backward-compatible fields:
        ms: result.ms,
        p1_policy: result.p1.policy,
        p2_policy: result.p2.policy,
        select4_p1,
        select4_p2,
      });

      ppoStats?.onBattleFinished();

      if (saveReplayThis) {
        const meta = collectReplayMeta({
          format: resolved.id,
          obs_mode: saveCfg.obsMode,
          save_compress: saveCfg.compress,
          save_sample_rate: saveCfg.sampleRate,
          p1_policy: result.p1.policy,
          p2_policy: result.p2.policy,
        });
        appendSave(replaysPath, {
          run_id: runId,
          battle_index: i,
          battle_id: battleId,
          format: resolved.id,
          seed: battleSeed,
          start_seed: [battleSeed, battleSeed + 1, battleSeed + 2, battleSeed + 3],
          started_at: startedAt,
          finished_at: finishedAt,
          expected_winner: result.winner ?? 'tie',
          expected_turns: result.turns,
          p1: { policy: result.p1.policy, team_id: team1Id, select4: select4_p1 },
          p2: { policy: result.p2.policy, team_id: team2Id, select4: select4_p2 },
          // Exact start state for policy-independent replay:
          p1_team: packed1,
          p2_team: packed2,
          // Exact choices written into the sim (per-player queue):
          p1_choices: replayP1Choices,
          p2_choices: replayP2Choices,
          // Extra metadata (useful for analysis; still request-safe):
          teams: { team1_packed: team6_packed_p1, team2_packed: team6_packed_p2 },
          meta,
        });
      }

      if (saveTrainThis && decisions.length > 0) {
        const winner = result.winner ?? 'tie';
        const rewardFor = (player: 'p1' | 'p2') => {
          if (winner === 'tie' || winner === null) return 0;
          return winner === player ? 1 : -1;
        };

        let lastP1 = -1;
        let lastP2 = -1;
        for (let k = 0; k < decisions.length; k++) {
          if (decisions[k].player === 'p1') lastP1 = k;
          else lastP2 = k;
        }

        for (let k = 0; k < decisions.length; k++) {
          const d = decisions[k];
          const done = (d.player === 'p1' && k === lastP1) || (d.player === 'p2' && k === lastP2);
          const reward = done ? rewardFor(d.player) : 0;
          const obs = saveCfg.obsMode === 'full' ? d.request : extractRequestFeatures(d.request);
          appendSave(trajectoriesPath, {
            run_id: runId,
            battle_index: i,
            battle_id: battleId,
            format: resolved.id,
            seed: battleSeed,
            player: d.player,
            turn: d.turn,
            step: k,
            obs_mode: saveCfg.obsMode,
            obs,
            legal: d.legal,
            choice: d.choice_norm,
            choice_raw: d.choice_raw,
            choice_source: d.choice_source,
            done,
            reward,
            outcome: { winner, turns: result.turns },
          });
        }
      }

      if ((i + 1) % 10 === 0) {
        console.log(`[vgc-demo] ${i + 1}/${nBattles} done`);
      }
    } catch (e: any) {
      const finishedAt = isoNow();
      const battleTotalMs = Date.now() - battleStartMs;
      const errMessage = String(e?.message ?? e);
      const errStack = String(e?.stack ?? '');

      appendJsonl(battlesPath, {
        run_id: runId,
        battle_index: i,
        battle_id: battleId,
        seed: battleSeed,
        format: resolved.id,
        started_at: startedAt,
        finished_at: finishedAt,
        duration_ms: battleTotalMs,
        battle_total_ms: battleTotalMs,
        sim_ms: 0,
        winner: 'error',
        turns: 0,
        p1: {
          policy: ppoEnabled && isPpoPolicy(p1Policy) ? 'ppo' : pythonUrl && p1Policy !== 'fallback' ? `python:${p1Policy}` : 'fallback',
          team_id: team1Id || undefined,
          team_hash: team1Hash || undefined,
          select4: select4_p1.length ? select4_p1 : undefined,
        },
        p2: {
          policy: ppoEnabled && isPpoPolicy(p2Policy) ? 'ppo' : pythonUrl && p2Policy !== 'fallback' ? `python:${p2Policy}` : 'fallback',
          team_id: team2Id || undefined,
          team_hash: team2Hash || undefined,
          select4: select4_p2.length ? select4_p2 : undefined,
        },
        teams: team6_packed_p1 && team6_packed_p2 ? { team1_packed: team6_packed_p1, team2_packed: team6_packed_p2 } : undefined,
        rng: { seed: battleSeed },
        error: { kind: e?.name ?? 'Error', message: errMessage, stack: errStack, phase },
      });

      appendJsonl(errorsPath, {
        battle_index: i,
        battle_id: battleId,
        error_type: String(e?.name ?? 'Error'),
        error: errStack || errMessage,
      });
    }
  }

  // Re-aggregate from battles.jsonl to guarantee consistency.
  const rows = readJsonl(battlesPath);
  const summary = aggregateSummary(rows);
  writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');
  console.log(`[vgc-demo] wrote ${battlesPath}`);
  console.log(`[vgc-demo] wrote ${summaryPath}`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
