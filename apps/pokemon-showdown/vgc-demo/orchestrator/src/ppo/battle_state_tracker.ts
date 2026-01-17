import { moveId, speciesId, statusIdFromCondition, terrainId, weatherId } from './id_maps';
import { PPO_PASS_ACTION_ID } from './action_space';
import { PPO_HISTORY_K, PPO_TEAM_SIZE } from './obs_types';
import { isFaintedFromCondition, parseHpFraction, parseSpeciesFromSwitchDetails, rotatePush } from './util';

export type TeamMon = {
  species_name: string;
  species_id: number;
  hp_frac: number; // unknown=-1
  fainted: boolean;
  active: boolean;
  status_id: number;
  revealed_moves: number[]; // len 4
  boosts: number[]; // len 7
  terastallized: boolean;
};

type Side = 'p1' | 'p2';

type HpSnapshot = {
  hp: number;
  known: boolean;
  fainted: boolean;
};

export class BattleStateTracker {
  readonly my: TeamMon[];
  readonly opp: TeamMon[];

  // Opponent ident -> slot index (0..5)
  private oppSlotByIdent: Map<string, number> = new Map();
  private nextOppSlot = 0;

  // Track which opponent team slot occupies each active position (a/b).
  // In doubles, both positions can be active simultaneously.
  private oppActiveSlotByPos: Array<number | null> = [null, null];

  turn = 0;
  weather_id = 0;
  terrain_id = 0;
  trick_room_turns = 0;
  tailwind_my = 0;
  tailwind_opp = 0;
  reflect_my = 0;
  lightscreen_my = 0;
  reflect_opp = 0;
  lightscreen_opp = 0;

  // History buffers (fixed-length, newest at end)
  last_actions_my: [number, number][] = [];
  last_actions_opp: [number, number][] = [];
  last_damage: [number, number][] = []; // [delta_my_hp_sum, delta_opp_hp_sum]

  // For shaping reward
  private prevHpSnapshot: HpSnapshot[];

  constructor() {
    const blankMon = (): TeamMon => ({
      species_name: '',
      species_id: 0,
      hp_frac: -1,
      fainted: false,
      active: false,
      status_id: 0,
      revealed_moves: [0, 0, 0, 0],
      boosts: [0, 0, 0, 0, 0, 0, 0],
      terastallized: false,
    });
    this.my = Array.from({ length: PPO_TEAM_SIZE }, blankMon);
    this.opp = Array.from({ length: PPO_TEAM_SIZE }, blankMon);

    this.prevHpSnapshot = Array.from({ length: PPO_TEAM_SIZE * 2 }, () => ({ hp: -1, known: false, fainted: false }));

    // Initialize history with zeros.
    for (let i = 0; i < PPO_HISTORY_K; i++) {
      this.last_actions_my.push([PPO_PASS_ACTION_ID, PPO_PASS_ACTION_ID]);
      this.last_actions_opp.push([PPO_PASS_ACTION_ID, PPO_PASS_ACTION_ID]);
      this.last_damage.push([0, 0]);
    }
  }

  get oppAliveActiveCount(): number {
    return this.opp.filter((m) => m.active && !m.fainted).length;
  }

  updateFromRequest(player: Side, req: any): void {
    if (!req || typeof req !== 'object') return;
    if (player !== 'p1') return; // pack is defined from the perspective of p1 learner.

    const side = req?.side ?? {};
    const mons = Array.isArray(side?.pokemon) ? (side.pokemon as any[]) : [];

    for (let i = 0; i < Math.min(PPO_TEAM_SIZE, mons.length); i++) {
      const p = mons[i] ?? {};
      const cond = String(p?.condition ?? '');
      const hp = parseHpFraction(cond);
      const fainted = !!p?.fainted || isFaintedFromCondition(cond);
      this.my[i].active = !!p?.active;
      this.my[i].fainted = fainted;
      this.my[i].hp_frac = fainted ? 0 : hp;
      this.my[i].status_id = statusIdFromCondition(cond);

      // Species from details if present.
      const details = String(p?.details ?? '').trim();
      if (details) {
        const sp = details.split(',')[0]?.trim() ?? '';
        if (sp && !this.my[i].species_name) {
          this.my[i].species_name = sp;
          this.my[i].species_id = speciesId(sp);
        }
      }

      // Revealed moves for my mons are visible on side.pokemon[i].moves
      const mv = Array.isArray(p?.moves) ? (p.moves as any[]) : [];
      const out = [0, 0, 0, 0];
      for (let j = 0; j < Math.min(4, mv.length); j++) out[j] = moveId(String(mv[j] ?? ''));
      this.my[i].revealed_moves = out;
    }

    // Active boosts come from req.active[i].boosts
    const activeReq = Array.isArray(req?.active) ? (req.active as any[]) : [];
    for (let ai = 0; ai < Math.min(2, activeReq.length); ai++) {
      const a = activeReq[ai] ?? {};
      const boosts = a?.boosts ?? {};
      const keys = ['atk', 'def', 'spa', 'spd', 'spe', 'accuracy', 'evasion'];
      const b: number[] = [];
      for (const k of keys) b.push(Number(boosts?.[k] ?? 0) || 0);

      // Map this active request entry to a team slot by matching side pokemon actives.
      // side.pokemon active order is stable.
      const activeSlots = mons
        .map((p2, idx) => ({ idx, active: !!p2?.active }))
        .filter((x) => x.active)
        .map((x) => x.idx);
      const slotIdx = activeSlots[ai];
      if (typeof slotIdx === 'number' && slotIdx >= 0 && slotIdx < PPO_TEAM_SIZE) {
        this.my[slotIdx].boosts = b;
      }
    }
  }

  ingestSpectatorLine(line: string): void {
    const s = String(line ?? '');
    if (!s.startsWith('|')) return;
    const parts = s.split('|');
    const tag = parts[1] ?? '';

    if (tag === 'turn') {
      const t = Number(parts[2] ?? this.turn);
      if (Number.isFinite(t)) {
        this.turn = t;
        this._decayTurnCounters();
      }
      return;
    }

    if (tag === '-weather') {
      const w = String(parts[2] ?? '').trim();
      if (!w || w === 'none') this.weather_id = 0;
      else this.weather_id = weatherId(w);
      return;
    }

    if (tag === '-fieldstart') {
      const what = String(parts[2] ?? '').trim();
      if (/trick room/i.test(what)) {
        this.trick_room_turns = 5;
      } else if (/terrain/i.test(what)) {
        // e.g. "move: Electric Terrain"
        const m = /terrain\s*:?\s*(.*)$/i.exec(what);
        const name = m ? m[1] : what;
        this.terrain_id = terrainId(name);
      }
      return;
    }

    if (tag === '-fieldend') {
      const what = String(parts[2] ?? '').trim();
      if (/trick room/i.test(what)) this.trick_room_turns = 0;
      if (/terrain/i.test(what)) this.terrain_id = 0;
      return;
    }

    if (tag === '-sidestart' || tag === '-sideend') {
      const side = String(parts[2] ?? '');
      const what = String(parts[3] ?? '');
      const isP1 = side.startsWith('p1');
      const isStart = tag === '-sidestart';

      if (/tailwind/i.test(what)) {
        if (isP1) this.tailwind_my = isStart ? 4 : 0;
        else this.tailwind_opp = isStart ? 4 : 0;
      }
      if (/reflect/i.test(what)) {
        if (isP1) this.reflect_my = isStart ? 5 : 0;
        else this.reflect_opp = isStart ? 5 : 0;
      }
      if (/light screen/i.test(what)) {
        if (isP1) this.lightscreen_my = isStart ? 5 : 0;
        else this.lightscreen_opp = isStart ? 5 : 0;
      }
      return;
    }

    // Switch/drag reveal species and hp for opp.
    if (tag === 'switch' || tag === 'drag') {
      const who = String(parts[2] ?? ''); // e.g. "p2a: Foo"
      const details = String(parts[3] ?? '');
      const cond = String(parts[4] ?? '');
      const { side, pos } = this._parseWho(who);
      const sp = parseSpeciesFromSwitchDetails(details);
      const hp = parseHpFraction(cond);
      const fainted = isFaintedFromCondition(cond);

      if (side === 'p2') {
        const slot = this._oppSlotForIdent(who);
        if (sp) {
          this.opp[slot].species_name = this.opp[slot].species_name || sp;
          this.opp[slot].species_id = this.opp[slot].species_id || speciesId(sp);
        }
        this.opp[slot].hp_frac = fainted ? 0 : hp;
        this.opp[slot].fainted = fainted;
      }

      // Update active flags by position (a/b) without clearing the other active.
      // Important for doubles: both p2a and p2b can be active simultaneously.
      if (side === 'p2' && (pos === 0 || pos === 1)) {
        const slot = this._oppSlotForIdent(who);

        const prev = this.oppActiveSlotByPos[pos];
        if (typeof prev === 'number' && prev >= 0 && prev < this.opp.length) {
          this.opp[prev].active = false;
        }
        this.oppActiveSlotByPos[pos] = slot;
        this.opp[slot].active = !fainted;
      }
      return;
    }

    if (tag === 'faint') {
      const who = String(parts[2] ?? '');
      const { side } = this._parseWho(who);
      if (side === 'p2') {
        const slot = this._oppSlotForIdent(who);
        this.opp[slot].fainted = true;
        this.opp[slot].hp_frac = 0;
        this.opp[slot].active = false;

        // If a fainted mon was occupying an active position, clear it.
        for (let pos = 0; pos < this.oppActiveSlotByPos.length; pos++) {
          if (this.oppActiveSlotByPos[pos] === slot) this.oppActiveSlotByPos[pos] = null;
        }
      }
      return;
    }

    if (tag === '-damage' || tag === '-heal') {
      const who = String(parts[2] ?? '');
      const cond = String(parts[3] ?? '');
      const { side } = this._parseWho(who);
      if (side === 'p2') {
        const slot = this._oppSlotForIdent(who);
        const hp = parseHpFraction(cond);
        const fainted = isFaintedFromCondition(cond);
        this.opp[slot].hp_frac = fainted ? 0 : hp;
        this.opp[slot].fainted = fainted;
      }
      return;
    }

    if (tag === 'move') {
      const who = String(parts[2] ?? '');
      const moveName = String(parts[3] ?? '');
      const { side } = this._parseWho(who);
      if (side === 'p2') {
        const slot = this._oppSlotForIdent(who);
        this._revealMove(this.opp[slot], moveName);
      }
      return;
    }
  }

  recordMyActions(a1: number, a2: number): void {
    rotatePush(this.last_actions_my, [a1, a2], PPO_HISTORY_K);
  }

  recordOppActions(a1: number, a2: number): void {
    rotatePush(this.last_actions_opp, [a1, a2], PPO_HISTORY_K);
  }

  consumeShapingReward(): { reward: number; hpDeltaMy: number; hpDeltaOpp: number; faintDelta: number } {
    // Reward based on deltas since last consume.
    // faint_diff = (Δopp_fainted - Δmy_fainted)
    // hp_diff = (Δopp_hp_sum - Δmy_hp_sum) over observed-only contributions.

    let deltaMyHp = 0;
    let deltaOppHp = 0;
    let deltaMyFainted = 0;
    let deltaOppFainted = 0;

    const cur = this._currentHpSnapshot();

    for (let i = 0; i < cur.length; i++) {
      const prev = this.prevHpSnapshot[i];
      const now = cur[i];

      if (prev.fainted !== now.fainted) {
        if (i < PPO_TEAM_SIZE) deltaMyFainted += now.fainted ? 1 : -1;
        else deltaOppFainted += now.fainted ? 1 : -1;
      }

      // hp delta contributes only if both snapshots were known.
      if (prev.known && now.known) {
        const d = (now.hp - prev.hp) || 0;
        if (i < PPO_TEAM_SIZE) deltaMyHp += d;
        else deltaOppHp += d;
      }
    }

    this.prevHpSnapshot = cur;

    const faintDiff = deltaOppFainted - deltaMyFainted;
    const hpDiff = deltaOppHp - deltaMyHp;

    const reward = 1.0 * faintDiff + 0.1 * hpDiff;

    rotatePush(this.last_damage, [deltaMyHp, deltaOppHp], PPO_HISTORY_K);

    return { reward, hpDeltaMy: deltaMyHp, hpDeltaOpp: deltaOppHp, faintDelta: faintDiff };
  }

  private _currentHpSnapshot(): HpSnapshot[] {
    const snap: HpSnapshot[] = [];
    for (let i = 0; i < PPO_TEAM_SIZE; i++) {
      const m = this.my[i];
      const known = m.fainted || m.hp_frac >= 0;
      snap.push({ hp: m.fainted ? 0 : m.hp_frac, known, fainted: !!m.fainted });
    }
    for (let i = 0; i < PPO_TEAM_SIZE; i++) {
      const m = this.opp[i];
      const known = m.fainted || m.hp_frac >= 0;
      snap.push({ hp: m.fainted ? 0 : m.hp_frac, known, fainted: !!m.fainted });
    }
    return snap;
  }

  private _revealMove(mon: TeamMon, moveName: string): void {
    const mid = moveId(moveName);
    if (!mid) return;
    if (mon.revealed_moves.includes(mid)) return;
    const idx = mon.revealed_moves.findIndex((x) => x === 0);
    if (idx >= 0) mon.revealed_moves[idx] = mid;
  }

  private _parseWho(who: string): { side: Side | null; pos: 0 | 1 | null } {
    // who: "p2a: Foo" / "p2b: Foo"
    const m = /^(p[12])([ab])?:/i.exec(String(who ?? '').trim());
    if (!m) return { side: null, pos: null };
    const side = m[1].toLowerCase() as Side;
    const pos = m[2] ? (m[2].toLowerCase() === 'a' ? 0 : 1) : null;
    return { side, pos };
  }

  private _oppSlotForIdent(who: string): number {
    const key = String(who ?? '').trim();
    const existing = this.oppSlotByIdent.get(key);
    if (typeof existing === 'number') return existing;
    const slot = Math.min(PPO_TEAM_SIZE - 1, this.nextOppSlot);
    if (this.nextOppSlot < PPO_TEAM_SIZE) this.nextOppSlot++;
    this.oppSlotByIdent.set(key, slot);
    return slot;
  }

  private _decayTurnCounters(): void {
    const dec = (x: number) => Math.max(0, (Number(x) || 0) - 1);
    this.trick_room_turns = dec(this.trick_room_turns);
    this.tailwind_my = dec(this.tailwind_my);
    this.tailwind_opp = dec(this.tailwind_opp);
    this.reflect_my = dec(this.reflect_my);
    this.lightscreen_my = dec(this.lightscreen_my);
    this.reflect_opp = dec(this.reflect_opp);
    this.lightscreen_opp = dec(this.lightscreen_opp);
  }
}
