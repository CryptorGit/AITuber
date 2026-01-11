import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { appendJsonl, appendJsonlGz } from './io/jsonl';
import { extractRequestFeatures } from './learn/obs_features';
import { readSaveConfig } from './learn/save_config';
import { collectReplayMeta } from './meta';
import { isoNow, sha256Hex, hashToUnitInterval, type JsonRow } from './shared';
import { generatePackedTeam, loadTeamGenData, select4FromTeam } from './team/teamgen';
import { runOneBattle, type TraceDecisionEvent } from './showdown/sim_runner';
import { select4Local } from './ai/selector';
import * as TeamsMod from '../../../../../tools/pokemon-showdown/pokemon-showdown/sim/teams';

const Teams: any = (TeamsMod as any).default?.Teams ?? (TeamsMod as any).Teams ?? (TeamsMod as any).default;
const DEBUG = process.env.VGC_DEMO_DEBUG === '1';

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
}) {
  const data = loadTeamGenData();
  const appendSave = getAppendSave(opts.saveCfg.compress);

  const rows: JsonRow[] = [];
  const battleIds: string[] = [];
  const trajectoryRows: JsonRow[] = [];

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
    const saveReplayThis = sampled && opts.saveCfg.saveReplay;
    const saveTrainThis = sampled && opts.saveCfg.saveTrainLog;

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
      const t1 = generatePackedTeam(data, battleSeed * 1009 + 1);
      const t2 = generatePackedTeam(data, battleSeed * 1009 + 2);

      const team6_p1 = t1.team;
      const team6_p2 = t2.team;
      const team6_packed_p1 = t1.packed;
      const team6_packed_p2 = t2.packed;

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

      if (opts.pythonUrl) {
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

      if (!opts.pythonUrl) {
        const sel1 = select4Local(team6_packed_p1);
        const sel2 = select4Local(team6_packed_p2);
        select4_p1 = sel1.select4 as any;
        select4_p2 = sel2.select4 as any;
        ordered4_p1 = sel1.ordered4;
        ordered4_p2 = sel2.ordered4;
      }

      const team4_p1_raw = select4FromTeam(team6_p1, select4_p1);
      const team4_p2_raw = select4FromTeam(team6_p2, select4_p2);

      // If local selector provided a preferred ordering, apply it by reordering the 4-set list.
      // This makes team preview deterministic with a simple `team 1234` choice.
      const applyOrder = (team4: any[], ordered4: number[] | null, select4: number[]) => {
        if (!ordered4 || ordered4.length !== 4) return team4;
        const idxToPos = new Map<number, number>();
        for (let i = 0; i < select4.length; i++) idxToPos.set(select4[i], i);
        const orderedPos = ordered4.map((idx6) => idxToPos.get(idx6)).filter((p) => typeof p === 'number') as number[];
        if (orderedPos.length !== 4) return team4;
        const out: any[] = [];
        for (const pos of orderedPos) out.push(team4[pos]);
        return out;
      };

      const team4_p1 = applyOrder(team4_p1_raw, ordered4_p1, select4_p1);
      const team4_p2 = applyOrder(team4_p2_raw, ordered4_p2, select4_p2);

      const packed1 = Teams.pack(team4_p1);
      const packed2 = Teams.pack(team4_p2);

      const isLocal = (p: string) => p === 'battle_policy' || p.startsWith('local:');
      const policyMode1 = isLocal(opts.p1Policy) ? 'local' : opts.pythonUrl && opts.p1Policy !== 'fallback' ? 'python' : 'fallback';
      const policyMode2 = isLocal(opts.p2Policy) ? 'local' : opts.pythonUrl && opts.p2Policy !== 'fallback' ? 'python' : 'fallback';

      phase = 'battle';
      const result = await runOneBattle({
        formatId: opts.formatId,
        seed: battleSeed,
        p1: {
          name: 'p1',
          team: packed1,
          policyMode: policyMode1 as any,
          python: opts.pythonUrl ? { baseUrl: opts.pythonUrl, policy: opts.p1Policy as any } : undefined,
        },
        p2: {
          name: 'p2',
          team: packed2,
          policyMode: policyMode2 as any,
          python: opts.pythonUrl ? { baseUrl: opts.pythonUrl, policy: opts.p2Policy as any } : undefined,
        },
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

