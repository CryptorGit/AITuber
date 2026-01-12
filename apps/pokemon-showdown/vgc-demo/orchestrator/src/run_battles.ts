import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { appendJsonl, appendJsonlGz } from './io/jsonl';
import { extractRequestFeatures } from './learn/obs_features';
import { readSaveConfig } from './learn/save_config';
import { collectReplayMeta } from './meta';
import { isoNow, sha256Hex, hashToUnitInterval, type JsonRow } from './shared';
import { loadTeamGenData, select4FromTeam, tryGeneratePackedTeamFromPool } from './team/teamgen';
import { runOneBattle, type TraceDecisionEvent } from './showdown/sim_runner';
import { select4Local } from './ai/selector';
import { LeagueManager } from './ppo/league_manager';
import { PpoBattleCoordinator } from './ppo/ppo_battle_coordinator';
import { PpoClient } from './ppo/ppo_client';
import { RolloutCollector } from './ppo/rollout_collector';
import { PpoRunStats } from './ppo/ppo_observability';
import { resolvePpoRolloutLen } from './ppo/rollout_config';
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

function clampInt(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
}

function buildTeamPreviewChoice(opts: {
  teamSize: number;
  pickN: number;
  selectIdx0: number[];
  preferredOrderIdx0?: number[] | null;
}): string {
  const teamSize = clampInt(opts.teamSize, 1, 24);
  const pickN = clampInt(opts.pickN, 1, teamSize);

  // If we bring the whole team (singles 6v6, etc), just keep a stable order.
  if (pickN >= teamSize) {
    const order = Array.from({ length: teamSize }, (_, i) => i + 1);
    return `team ${order.join('')}`;
  }

  const base = Array.isArray(opts.preferredOrderIdx0) && opts.preferredOrderIdx0.length === pickN
    ? opts.preferredOrderIdx0
    : opts.selectIdx0;

  const digits = base
    .slice(0, pickN)
    .map((i) => clampInt(Number(i), 0, teamSize - 1) + 1)
    .join('');

  return `team ${digits}`;
}

export type BatchMeta = {
  batch_id: string;
  batch_index: number;
  batch_size: number;
  batch_seed: number;
  opponent_id: string;
};

export type RunPaths = {
  outDir: string;
  battlesPath: string;
  summaryPath: string;
  errorsPath: string;
  debugPath: string;
  trajectoriesPath: string;
  replaysPath: string;
  batchesPath?: string;
};

export function initRunPaths(rootRepo: string, opts?: { outDir?: string }) {
  const outDir = opts?.outDir ?? join(rootRepo, 'data/pokemon-showdown/vgc-demo');
  mkdirSync(outDir, { recursive: true });

  const saveCfg0 = readSaveConfig(outDir);
  const outDirResolved = resolve(outDir);
  let saveDir = resolve(saveCfg0.saveDir);
  if (!saveDir.toLowerCase().startsWith(outDirResolved.toLowerCase())) {
    console.warn(`[vgc-demo] VGC_SAVE_DIR must be under data/pokemon-showdown/vgc-demo/: ${saveCfg0.saveDir} (using default)`);
    saveDir = outDirResolved;
  }
  const saveCfg = { ...saveCfg0, saveDir };

  const battlesPath = join(outDir, 'battles.jsonl');
  const summaryPath = join(outDir, 'summary.json');
  const errorsPath = join(outDir, 'errors.jsonl');
  const debugPath = join(outDir, 'debug.jsonl');
  const batchesPath = join(outDir, 'batches.jsonl');

  const trajectoriesPath = join(
    saveCfg.saveDir,
    saveCfg.compress ? 'trajectories.jsonl.gz' : 'trajectories.jsonl'
  );
  const replaysPath = join(saveCfg.saveDir, saveCfg.compress ? 'replays.jsonl.gz' : 'replays.jsonl');

  const paths: RunPaths = {
    outDir,
    battlesPath,
    summaryPath,
    errorsPath,
    debugPath,
    trajectoriesPath,
    replaysPath,
    batchesPath,
  };

  return { saveCfg, paths };
}

export function getAppendSave(compress: boolean) {
  return compress ? appendJsonlGz : appendJsonl;
}

export async function runBattlesChunk(opts: {
  runId: string;
  startBattleIndex: number;
  nBattles: number;
  seedBase: number;
  formatId: string;
  p1Policy: string;
  p2Policy: string;
  pythonUrl: string;
  saveCfg: ReturnType<typeof readSaveConfig> & { saveDir: string };
  paths: RunPaths;
  batch?: BatchMeta;
  collectTrajectories?: boolean;
  ppoStats?: import('./ppo/ppo_observability').PpoRunStats;
  ppo?: {
    client: PpoClient;
    collector: RolloutCollector;
    league: LeagueManager;
  };
}) {
  const data = loadTeamGenData();
  const appendSave = getAppendSave(opts.saveCfg.compress);

  const rows: JsonRow[] = [];
  const battleIds: string[] = [];
  const trajectoryRows: JsonRow[] = [];

  // PPO state (may be shared across chunks/batches by passing opts.ppo).
  const ppoRolloutCfg = resolvePpoRolloutLen();
  const ppoRolloutLen = ppoRolloutCfg.value;
  const ppoEnabled = isPpoPolicy(opts.p1Policy) || isPpoPolicy(opts.p2Policy);
  const ppoClient = ppoEnabled ? (opts.ppo?.client ?? new PpoClient(opts.pythonUrl)) : null;
  const ppoStats = opts.ppoStats ?? (ppoClient ? new PpoRunStats(process.env.PPO_RUN_ID ?? 'unknown_run') : null);
  if (ppoStats) {
    try {
      ppoStats.setAppliedConfig({ rollout_len: ppoRolloutLen, rollout_len_source: ppoRolloutCfg.source });
    } catch {
      // ignore
    }
  }
  const ppoCollector = ppoClient ? (opts.ppo?.collector ?? new RolloutCollector(ppoClient, ppoRolloutLen, ppoStats ?? undefined)) : null;
  const ppoLeague = ppoClient ? (opts.ppo?.league ?? new LeagueManager(ppoClient)) : null;

  const saveReplayOnlyAfterUpdate = String(process.env.VGC_SAVE_REPLAY_ONLY_AFTER_UPDATE ?? '').trim() === '1';

  for (let i = 0; i < opts.nBattles; i++) {
    const globalIndex = opts.startBattleIndex + i;
    const battleSeed = opts.seedBase + i + 1;
    const battleId = `${opts.runId}-${globalIndex}`;
    battleIds.push(battleId);

    const startedAt = isoNow();
    const battleStartMs = Date.now();
    let phase = 'init';

    const sampled =
      opts.saveCfg.sampleRate >= 1 || hashToUnitInterval(battleId) < Number(opts.saveCfg.sampleRate ?? 1);
    const wantsReplay = sampled && opts.saveCfg.saveReplay;

    // If the user requested "only after update", we treat the next replay as mandatory.
    // (This guarantees one saved replay immediately after each successful PPO update,
    // even across batch boundaries when opts.ppo is shared.)
    const mustSaveAfterUpdate = saveReplayOnlyAfterUpdate && !!ppoCollector?.peekSaveNextReplay();
    let consumedAfterUpdateReplay = false;
    const saveReplayThis = saveReplayOnlyAfterUpdate
      ? mustSaveAfterUpdate
        ? (consumedAfterUpdateReplay = !!ppoCollector?.consumeSaveNextReplay())
        : false
      : wantsReplay;
    const saveTrainThis = sampled && opts.saveCfg.saveTrainLog;

    let replaySaved = false;

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
      const pool1 = tryGeneratePackedTeamFromPool(battleSeed * 1009 + 1, { mode: 'random' });
      const pool2 = tryGeneratePackedTeamFromPool(battleSeed * 1009 + 2, { mode: 'random' });
      if (!pool1 || !pool2) {
        throw new Error(
          'pool.json not usable (need >= 6 valid entries). Please populate config/pokemon-showdown/vgc-demo/pool.json'
        );
      }

      const t1 = pool1;
      const t2 = pool2;

      const team6_p1 = t1.team;
      const team6_p2 = t2.team;
      const team6_packed_p1 = t1.packed;
      const team6_packed_p2 = t2.packed;
      const team6_pool_entry_ids_p1 = t1.entryIds;
      const team6_pool_entry_ids_p2 = t2.entryIds;

      // How many mons to bring from team preview.
      // Default to VGC teamgen_rules.battle_size (usually 4). For singles, callers can set PS_PICK_N=6.
      const teamSize = Array.isArray(team6_p1) ? team6_p1.length : 6;
      const defaultPickN = Number((data as any)?.rules?.battle_size ?? 4);
      const pickN = clampInt(Number(process.env.PS_PICK_N ?? defaultPickN), 1, teamSize);

      const team1Hash = sha256Hex(team6_packed_p1);
      const team2Hash = sha256Hex(team6_packed_p2);
      const team1Id = team1Hash.slice(0, 12);
      const team2Id = team2Hash.slice(0, 12);

      let select4_p1 = [0, 1, 2, 3];
      let select4_p2 = [0, 1, 2, 3];

      // Local selector fallback (deterministic) when python is not available.
      // Note: this returns both the 4-of-6 indices and a preferred ordering (leads first).
      let ordered4_p1: number[] | null = null;
      let ordered4_p2: number[] | null = null;

      const needsPick = pickN < teamSize;

      if (opts.pythonUrl && needsPick && pickN === 4) {
        try {
          phase = 'select4:p1';
          const res1 = await fetch(`${opts.pythonUrl}/select4`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ team6: team6_packed_p1, format: opts.formatId, turn: 0, policy: opts.p1Policy }),
          });
          if (res1.ok) {
            const j = await res1.json();
            if (Array.isArray(j?.select4) && j.select4.length === 4) select4_p1 = j.select4;
          }
        } catch {}

        try {
          phase = 'select4:p2';
          const res2 = await fetch(`${opts.pythonUrl}/select4`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ team6: team6_packed_p2, format: opts.formatId, turn: 0, policy: opts.p2Policy }),
          });
          if (res2.ok) {
            const j = await res2.json();
            if (Array.isArray(j?.select4) && j.select4.length === 4) select4_p2 = j.select4;
          }
        } catch {}
      }

      if (!opts.pythonUrl && needsPick && pickN === 4) {
        const sel1 = select4Local(team6_packed_p1);
        const sel2 = select4Local(team6_packed_p2);
        select4_p1 = sel1.select4 as any;
        select4_p2 = sel2.select4 as any;
        ordered4_p1 = sel1.ordered4;
        ordered4_p2 = sel2.ordered4;
      }

      // Provide a deterministic team-preview choice so doubles can be 6 shown -> pick 4.
      const teamPreviewChoiceP1 = buildTeamPreviewChoice({
        teamSize,
        pickN,
        selectIdx0: select4_p1,
        preferredOrderIdx0: ordered4_p1,
      });
      const teamPreviewChoiceP2 = buildTeamPreviewChoice({
        teamSize,
        pickN,
        selectIdx0: select4_p2,
        preferredOrderIdx0: ordered4_p2,
      });

      const packed1 = team6_packed_p1;
      const packed2 = team6_packed_p2;

      const isLocal = (p: string) => p === 'battle_policy' || p.startsWith('local:');
      const policyMode1 = isLocal(opts.p1Policy)
        ? 'local'
        : ppoEnabled && isPpoPolicy(opts.p1Policy)
          ? 'ppo'
          : opts.pythonUrl && opts.p1Policy !== 'fallback'
            ? 'python'
            : 'fallback';
      const policyMode2 = isLocal(opts.p2Policy)
        ? 'local'
        : ppoEnabled && isPpoPolicy(opts.p2Policy)
          ? 'ppo'
          : opts.pythonUrl && opts.p2Policy !== 'fallback'
            ? 'python'
            : 'fallback';

      let ppoCoordinator: PpoBattleCoordinator | undefined;
      if (ppoEnabled && ppoClient && ppoCollector) {
        await ppoLeague?.refreshSnapshots();
        const p1PolicyId = toPpoPolicyId(opts.p1Policy);
        let p2PolicyId = toPpoPolicyId(opts.p2Policy);
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
        formatId: opts.formatId,
        seed: battleSeed,
        p1: {
          name: 'p1',
          team: packed1,
          policyMode: policyMode1 as any,
          python: policyMode1 === 'python' ? { baseUrl: opts.pythonUrl, policy: opts.p1Policy as any } : undefined,
          teamPreviewChoice: teamPreviewChoiceP1,
        },
        p2: {
          name: 'p2',
          team: packed2,
          policyMode: policyMode2 as any,
          python: policyMode2 === 'python' ? { baseUrl: opts.pythonUrl, policy: opts.p2Policy as any } : undefined,
          teamPreviewChoice: teamPreviewChoiceP2,
        },
        ppo: ppoCoordinator,
        debug: DEBUG ? { logPath: opts.paths.debugPath, runId: opts.runId, battleId } : undefined,
        trace: saveReplayThis || saveTrainThis ? trace : undefined,
      });

      const finishedAt = isoNow();
      const battleTotalMs = Date.now() - battleStartMs;

      const baseRow: JsonRow = {
        run_id: opts.runId,
        battle_index: globalIndex,
        battle_id: battleId,
        seed: battleSeed,
        format: opts.formatId,
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

        // Batch grouping (optional):
        batch_id: opts.batch?.batch_id,
        batch_index: opts.batch?.batch_index,
        batch_size: opts.batch?.batch_size,
        batch_seed: opts.batch?.batch_seed,
        batch_battle_index: i,
        opponent_id: opts.batch?.opponent_id,

        // Backward-compatible fields:
        ms: result.ms,
        p1_policy: result.p1.policy,
        p2_policy: result.p2.policy,
        select4_p1,
        select4_p2,
      };

      appendJsonl(opts.paths.battlesPath, baseRow);
      rows.push(baseRow);

      ppoStats?.onBattleFinished();

      if (saveReplayThis) {
        const meta = collectReplayMeta({
          format: opts.formatId,
          obs_mode: opts.saveCfg.obsMode,
          save_compress: opts.saveCfg.compress,
          save_sample_rate: opts.saveCfg.sampleRate,
          p1_policy: result.p1.policy,
          p2_policy: result.p2.policy,
        });
        appendSave(opts.paths.replaysPath, {
          run_id: opts.runId,
          battle_index: globalIndex,
          battle_id: battleId,
          format: opts.formatId,
          seed: battleSeed,
          start_seed: [battleSeed, battleSeed + 1, battleSeed + 2, battleSeed + 3],
          started_at: startedAt,
          finished_at: finishedAt,
          expected_winner: result.winner ?? 'tie',
          expected_turns: result.turns,
          p1: { policy: result.p1.policy, team_id: team1Id, select4: select4_p1 },
          p2: { policy: result.p2.policy, team_id: team2Id, select4: select4_p2 },
          p1_team: packed1,
          p2_team: packed2,
          p1_pool_entry_ids: team6_pool_entry_ids_p1,
          p2_pool_entry_ids: team6_pool_entry_ids_p2,
          p1_choices: replayP1Choices,
          p2_choices: replayP2Choices,
          teams: { team1_packed: team6_packed_p1, team2_packed: team6_packed_p2 },

          batch_id: opts.batch?.batch_id,
          batch_index: opts.batch?.batch_index,
          batch_size: opts.batch?.batch_size,
          batch_seed: opts.batch?.batch_seed,
          batch_battle_index: i,
          opponent_id: opts.batch?.opponent_id,

          meta,
        });
        replaySaved = true;
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
          const obs = opts.saveCfg.obsMode === 'full' ? d.request : extractRequestFeatures(d.request);
          const trajRow: JsonRow = {
            run_id: opts.runId,
            battle_index: globalIndex,
            battle_id: battleId,
            format: opts.formatId,
            seed: battleSeed,
            player: d.player,
            turn: d.turn,
            step: k,
            obs_mode: opts.saveCfg.obsMode,
            obs,
            legal: d.legal,
            choice: d.choice_norm,
            choice_raw: d.choice_raw,
            choice_source: d.choice_source,
            done,
            reward,
            outcome: { winner, turns: result.turns },

            batch_id: opts.batch?.batch_id,
            batch_index: opts.batch?.batch_index,
            batch_size: opts.batch?.batch_size,
            batch_seed: opts.batch?.batch_seed,
            batch_battle_index: i,
            opponent_id: opts.batch?.opponent_id,
          };

          appendSave(opts.paths.trajectoriesPath, trajRow);
          if (opts.collectTrajectories) trajectoryRows.push(trajRow);
        }
      }

      if ((globalIndex + 1) % 10 === 0) {
        console.log(`[vgc-demo] ${globalIndex + 1} battles done`);
      }
    } catch (e: any) {
      if (consumedAfterUpdateReplay && !replaySaved) {
        try {
          ppoCollector?.restoreSaveNextReplay();
        } catch {
          // ignore
        }
      }
      const finishedAt = isoNow();
      const battleTotalMs = Date.now() - battleStartMs;
      const errMessage = String(e?.message ?? e);
      const errStack = String(e?.stack ?? '');

      const errRow: JsonRow = {
        run_id: opts.runId,
        battle_index: globalIndex,
        battle_id: battleId,
        seed: battleSeed,
        format: opts.formatId,
        started_at: startedAt,
        finished_at: finishedAt,
        duration_ms: battleTotalMs,
        battle_total_ms: battleTotalMs,
        sim_ms: 0,
        winner: 'error',
        turns: 0,
        p1: { policy: opts.pythonUrl && opts.p1Policy !== 'fallback' ? `python:${opts.p1Policy}` : 'fallback', select4: undefined },
        p2: { policy: opts.pythonUrl && opts.p2Policy !== 'fallback' ? `python:${opts.p2Policy}` : 'fallback', select4: undefined },
        teams: undefined,
        rng: { seed: battleSeed },
        error: { kind: e?.name ?? 'Error', message: errMessage, stack: errStack, phase },

        batch_id: opts.batch?.batch_id,
        batch_index: opts.batch?.batch_index,
        batch_size: opts.batch?.batch_size,
        batch_seed: opts.batch?.batch_seed,
        batch_battle_index: i,
        opponent_id: opts.batch?.opponent_id,
      };

      appendJsonl(opts.paths.battlesPath, errRow);
      rows.push(errRow);

      appendJsonl(opts.paths.errorsPath, {
        battle_index: globalIndex,
        battle_id: battleId,
        error_type: String(e?.name ?? 'Error'),
        error: errStack || errMessage,
      });
    }
  }

  return { rows, battleIds, trajectoryRows };
}

