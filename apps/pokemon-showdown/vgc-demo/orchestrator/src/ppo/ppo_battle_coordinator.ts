import { buildActionsForRequest } from './action_builder';
import { BattleStateTracker } from './battle_state_tracker';
import { buildPackedObs } from './obs_builder';
import { PpoClient, PpoHttpError } from './ppo_client';
import { RolloutCollector } from './rollout_collector';
import type { PpoRunStats } from './ppo_observability';

export type PpoBattlePolicies = {
  p1_policy_id: string; // learner
  p2_policy_id: string; // learner|snapshot:<id>|baseline
};

type DecisionDump = {
  reason: string;
  battle_id: string;
  turn: number;
  side: 'p1' | 'p2';
  phase: 'team_preview' | 'forced_switch' | 'normal' | 'unknown';
  raw_request_json: any;
  built_obs_shapes: any;
  mask_left: number[];
  mask_right: number[];
  mask_left_sum?: number;
  mask_right_sum?: number;
  chosen_action_left: number;
  chosen_action_right: number;
  chosen_choice_string_left: string;
  chosen_choice_string_right: string;
  legal_choice_table_left: Array<string | null>;
  legal_choice_table_right: Array<string | null>;
  lastK_history: any;
  league_info: any;
  // HTTP error context (for ppo_act_http_error)
  http_status?: number;
  response_body_snippet?: string;
  error_message?: string;
  request_id?: string;
  note?: any;
  attempted_choice?: string;
  attempted_choice_source?: string;
};

function obsShapes(obs: any): any {
  const shape = (v: any) => {
    if (Array.isArray(v)) {
      if (v.length > 0 && Array.isArray(v[0])) return [v.length, (v[0] as any[]).length];
      return [v.length];
    }
    return null;
  };
  const out: any = {};
  for (const k of Object.keys(obs ?? {})) out[k] = shape((obs as any)[k]);
  return out;
}

function detectPhase(req: any): 'team_preview' | 'forced_switch' | 'normal' | 'unknown' {
  if (req?.teamPreview) return 'team_preview';
  if (Array.isArray(req?.forceSwitch)) return 'forced_switch';
  if (Array.isArray(req?.active)) return 'normal';
  return 'unknown';
}

export class PpoBattleCoordinator {
  readonly tracker = new BattleStateTracker();
  readonly client: PpoClient;
  readonly collector: RolloutCollector;
  readonly policies: PpoBattlePolicies;
  readonly stats?: PpoRunStats;
  private battleId: string;
  private lastDecision: { p1?: DecisionDump; p2?: DecisionDump } = {};
  private episodeReturn = 0;

  constructor(
    client: PpoClient,
    collector: RolloutCollector,
    policies: PpoBattlePolicies,
    stats?: PpoRunStats,
    opts?: { battle_id?: string }
  ) {
    this.client = client;
    this.collector = collector;
    this.policies = policies;
    this.stats = stats;
    this.battleId = String(opts?.battle_id ?? '').trim() || 'unknown_battle';
  }

  ingestSpectatorLine(line: string): void {
    this.tracker.ingestSpectatorLine(line);
  }

  dumpInvalidChoice(args: { player: 'p1' | 'p2'; turn: number; req: any; note?: any }): void {
    const prev = args.player === 'p1' ? this.lastDecision.p1 : this.lastDecision.p2;
    const payload = {
      ...(prev ?? {
        reason: 'invalid_choice',
        battle_id: this.battleId,
        turn: args.turn,
        side: args.player,
        phase: detectPhase(args.req),
        raw_request_json: args.req,
      }),
      note: args.note ?? null,
      current_request_json: args.req,
    };
    this.stats?.incInvalidChoice();
    const base = `${this.battleId}_turn${args.turn}_invalid_choice.json`;
    this.stats?.writeDump(base, payload);
  }

  dumpActHttpError(args: {
    player: 'p1' | 'p2';
    turn: number;
    req: any;
    http_status: number;
    response_body_snippet: string;
    request_shapes: any;
    mask_left: number[];
    mask_right: number[];
    mask_left_sum: number;
    mask_right_sum: number;
    policy_id: string;
    error_message: string;
    stack?: string;
  }): void {
    this.stats?.incPpoActHttpError();
    const payload: DecisionDump = {
      reason: 'ppo_act_http_error',
      battle_id: this.battleId,
      turn: args.turn,
      side: args.player,
      phase: detectPhase(args.req),
      raw_request_json: args.req,
      built_obs_shapes: args.request_shapes,
      mask_left: args.mask_left,
      mask_right: args.mask_right,
      mask_left_sum: args.mask_left_sum,
      mask_right_sum: args.mask_right_sum,
      chosen_action_left: -1,
      chosen_action_right: -1,
      chosen_choice_string_left: '',
      chosen_choice_string_right: '',
      legal_choice_table_left: [],
      legal_choice_table_right: [],
      lastK_history: {
        last_actions_my: this.tracker.last_actions_my,
        last_actions_opp: this.tracker.last_actions_opp,
        last_damage: this.tracker.last_damage,
      },
      league_info: { ...this.policies, acting_policy_id: args.policy_id },
      http_status: args.http_status,
      response_body_snippet: args.response_body_snippet,
      error_message: args.error_message,
      request_id: `${this.battleId}:${args.turn}:${args.player}`,
      note: args.stack ? { stack: args.stack } : null,
    };
    const base = `${this.battleId}_turn${args.turn}_ppo_act_http_error.json`;
    this.stats?.writeDump(base, payload);
  }

  dumpPpoDisabledChoice(args: { player: 'p1' | 'p2'; turn: number; req: any; attempted_choice: string; source: string }): void {
    const prev = args.player === 'p1' ? this.lastDecision.p1 : this.lastDecision.p2;
    const payload = {
      ...(prev ?? {
        reason: 'ppo_disabled_choice',
        battle_id: this.battleId,
        turn: args.turn,
        side: args.player,
        phase: detectPhase(args.req),
        raw_request_json: args.req,
      }),
      reason: 'ppo_disabled_choice',
      attempted_choice: args.attempted_choice,
      attempted_choice_source: args.source,
      current_request_json: args.req,
    };
    const base = `${this.battleId}_turn${args.turn}_ppo_disabled_choice.json`;
    this.stats?.writeDump(base, payload);
  }

  async chooseForRequest(args: { player: 'p1' | 'p2'; req: any; turn: number; seed?: number }): Promise<string> {
    const { player, req, seed } = args;

    // Update request-derived state only from p1's request to avoid leaking p2 hidden info.
    if (player === 'p1') this.tracker.updateFromRequest('p1', req);

    // At decision time, compute shaping reward since last decision and assign to previous step.
    if (player === 'p1') {
      const shaped = this.tracker.consumeShapingReward();
      this.collector.applyRewardToPrevious(shaped.reward);
      this.episodeReturn += shaped.reward;

      // Train opportunistically, but only on fully-rewarded steps.
      const trainRes = await this.collector.maybeTrain();
      try {
        this.stats?.setCollectorState({ rollout_buffer_len: this.collector.size });
      } catch {
        // ignore
      }
      if (trainRes.trained && trainRes.metrics) {
        const m = trainRes.metrics;
        try {
          this.stats?.recordTrainResponse({
            update_step: Number(m.update_step ?? 0),
            samples: Number(m.samples ?? m.n_steps ?? 0),
            warnings: Array.isArray(m.warnings) ? m.warnings : [],
            metrics: {
              policy_loss: Number(m.policy_loss ?? m.metrics?.policy_loss ?? 0),
              value_loss: Number(m.value_loss ?? m.metrics?.value_loss ?? 0),
              entropy: Number(m.entropy ?? m.metrics?.entropy ?? 0),
              approx_kl: Number(m.approx_kl ?? m.metrics?.approx_kl ?? 0),
              clipfrac: Number(m.clipfrac ?? m.metrics?.clipfrac ?? 0),
              adv_mean: Number(m.adv_mean ?? m.metrics?.adv_mean ?? 0),
              adv_std: Number(m.adv_std ?? m.metrics?.adv_std ?? 0),
              grad_norm: Number(m.grad_norm ?? m.metrics?.grad_norm ?? 0),
            },
          });
        } catch {
          // ignore
        }
      }
    }

    const obs = buildPackedObs(this.tracker);
    this.collector.setBootstrapObs(obs, 0);

    const built = buildActionsForRequest({ req, tracker: this.tracker });

    const sumL = built.mask_left.reduce((a, b) => a + (b ? 1 : 0), 0);
    const sumR = built.mask_right.reduce((a, b) => a + (b ? 1 : 0), 0);
    if (sumL <= 0 || sumR <= 0) {
      this.stats?.incMaskZero();
      const payload = {
        reason: 'mask_zero',
        battle_id: this.battleId,
        turn: args.turn,
        side: player,
        phase: detectPhase(req),
        raw_request_json: req,
        built_obs_shapes: obsShapes(obs),
        mask_left: built.mask_left,
        mask_right: built.mask_right,
        chosen_action_left: -1,
        chosen_action_right: -1,
        chosen_choice_string_left: '',
        chosen_choice_string_right: '',
        legal_choice_table_left: built.table_left.map((s) => (s == null ? null : String(s))),
        legal_choice_table_right: built.table_right.map((s) => (s == null ? null : String(s))),
        lastK_history: {
          last_actions_my: this.tracker.last_actions_my,
          last_actions_opp: this.tracker.last_actions_opp,
          last_damage: this.tracker.last_damage,
        },
        league_info: { ...this.policies },
      } satisfies DecisionDump;
      const base = `${this.battleId}_turn${args.turn}_mask_zero.json`;
      this.stats?.writeDump(base, payload);
      throw new Error('PPO mask_zero: no legal actions');
    }

    const policy_id = player === 'p1' ? this.policies.p1_policy_id : this.policies.p2_policy_id;

    const request_id = `${this.battleId}:${args.turn}:${player}`;

    let res: { a_left: number; a_right: number; logp: number; value: number };
    try {
      res = await this.client.act({
        request_id,
        battle_id: this.battleId,
        turn: args.turn,
        side: player,
        policy_id,
        obs,
        mask_left: built.mask_left,
        mask_right: built.mask_right,
        sample: true,
        seed,
      });
    } catch (e: any) {
      if (e instanceof PpoHttpError) {
        try {
          this.dumpActHttpError({
            player,
            turn: args.turn,
            req,
            http_status: e.status,
            response_body_snippet: String(e.bodySnippet ?? ''),
            request_shapes: obsShapes(obs),
            mask_left: built.mask_left,
            mask_right: built.mask_right,
            mask_left_sum: sumL,
            mask_right_sum: sumR,
            policy_id,
            error_message: String(e.message ?? e),
            stack: String(e.stack ?? ''),
          });
        } catch {
          // ignore
        }
      }
      throw e;
    }

    // Post-process chosen actions for edge cases where the raw pair is invalid in Showdown.
    // (e.g., forced-switch requiring distinct bench Pokémon).
    let a_left = res.a_left;
    let a_right = res.a_right;
    let leftChoice = built.table_left[a_left] ?? 'default';
    let rightChoice = built.expectedChoices >= 2 ? (built.table_right[a_right] ?? 'default') : '';

    if (built.expectedChoices >= 2 && detectPhase(req) === 'forced_switch') {
      if (
        typeof leftChoice === 'string' &&
        typeof rightChoice === 'string' &&
        leftChoice.startsWith('switch ') &&
        rightChoice.startsWith('switch ') &&
        leftChoice === rightChoice
      ) {
        // Try to pick a different legal switch for the right slot.
        const alt = built.table_right.findIndex((c, idx) => {
          if (!c) return false;
          if (built.mask_right[idx] !== 1) return false;
          const s = String(c);
          return s.startsWith('switch ') && s !== leftChoice;
        });
        if (alt >= 0) {
          a_right = alt;
          rightChoice = built.table_right[a_right] ?? rightChoice;
        }
      }
    }

    const choice = built.expectedChoices >= 2 ? `${leftChoice}, ${rightChoice}` : leftChoice;

    // Store a dumpable record of this decision (both sides).
    const rec: DecisionDump = {
      reason: 'decision',
      battle_id: this.battleId,
      turn: args.turn,
      side: player,
      phase: detectPhase(req),
      raw_request_json: req,
      built_obs_shapes: obsShapes(obs),
      mask_left: built.mask_left,
      mask_right: built.mask_right,
      chosen_action_left: a_left,
      chosen_action_right: a_right,
      chosen_choice_string_left: leftChoice,
      chosen_choice_string_right: rightChoice,
      legal_choice_table_left: built.table_left.map((s) => (s == null ? null : String(s))),
      legal_choice_table_right: built.table_right.map((s) => (s == null ? null : String(s))),
      lastK_history: {
        last_actions_my: this.tracker.last_actions_my,
        last_actions_opp: this.tracker.last_actions_opp,
        last_damage: this.tracker.last_damage,
      },
      league_info: { ...this.policies, acting_policy_id: policy_id },
    };
    if (player === 'p1') this.lastDecision.p1 = rec;
    else this.lastDecision.p2 = rec;

    if (player === 'p1') {
      this.tracker.recordMyActions(a_left, a_right);
      this.collector.pushDecision({
        obs,
        mask_left: built.mask_left,
        mask_right: built.mask_right,
        a_left,
        a_right,
        old_logp: res.logp,
        old_value: res.value,
      });
      try {
        this.stats?.setCollectorState({ rollout_buffer_len: this.collector.size });
      } catch {
        // ignore
      }
    }

    return choice;
  }

  finalizeBattle(winner: string | null): void {
    // Assign final shaping reward delta + terminal reward.
    const shaped = this.tracker.consumeShapingReward();
    const terminal = winner === 'p1' ? 1 : winner === 'p2' ? -1 : 0;
    this.episodeReturn += shaped.reward + terminal;
    this.collector.finalizeTerminal(shaped.reward + terminal);
    this.collector.setBootstrapObs(buildPackedObs(this.tracker), 1);
    this.stats?.recordEpisodeReturn(this.episodeReturn);
  }
}
