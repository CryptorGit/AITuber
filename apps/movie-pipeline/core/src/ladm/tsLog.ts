import fs from 'node:fs';
import path from 'node:path';

export type TsEvent = {
  t_ms: number;
  turn?: number | null;
  type?: string | null;
  text?: string | null;
  meta?: Record<string, any> | null;
};

export type TsLogInfo = {
  events: TsEvent[];
  turnTimes: Map<number, number>;
};

function normalizeEvent(obj: any): TsEvent | null {
  if (!obj) return null;

  // Source-of-Truth schema: `t` is seconds from start of input_battle.
  // Legacy/other schemas may provide ms in `t_ms`, `timestamp_ms`, etc.
  const rawMs = obj.t_ms ?? obj.timestamp_ms ?? obj.time_ms;
  const rawT = obj.t;

  let tMs: number | null = null;
  if (rawMs !== undefined && rawMs !== null) {
    const v = Number(rawMs);
    if (Number.isFinite(v)) tMs = v;
  } else if (rawT !== undefined && rawT !== null) {
    const v = Number(rawT);
    if (Number.isFinite(v)) {
      // Heuristic: if it's a small number, treat as seconds; otherwise assume ms.
      tMs = v < 10000 ? Math.round(v * 1000) : Math.round(v);
    }
  }

  if (tMs == null || !Number.isFinite(tMs)) return null;
  const turn = obj.turn != null ? Number(obj.turn) : null;
  const type = obj.event_type ? String(obj.event_type) : obj.type ? String(obj.type) : null;
  const text = obj.text ? String(obj.text) : null;

  const meta = obj.meta && typeof obj.meta === 'object' ? (obj.meta as Record<string, any>) : null;
  return { t_ms: tMs, turn: Number.isFinite(turn) ? turn : null, type, text, meta };
}

export function parseTsLog(filePath: string): TsLogInfo {
  const ext = path.extname(filePath).toLowerCase();
  const raw = fs.readFileSync(filePath, 'utf8');
  const events: TsEvent[] = [];

  if (ext === '.jsonl') {
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed);
        const ev = normalizeEvent(obj);
        if (ev) events.push(ev);
      } catch {
        // ignore
      }
    }
  } else {
    try {
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        for (const item of data) {
          const ev = normalizeEvent(item);
          if (ev) events.push(ev);
        }
      } else if (Array.isArray(data?.events)) {
        for (const item of data.events) {
          const ev = normalizeEvent(item);
          if (ev) events.push(ev);
        }
      } else if (data?.turns && typeof data.turns === 'object') {
        for (const [turnKey, tMs] of Object.entries(data.turns)) {
          const turn = Number(turnKey);
          const t = Number(tMs);
          if (Number.isFinite(turn) && Number.isFinite(t)) {
            events.push({ t_ms: t, turn });
          }
        }
      }
    } catch {
      // ignore
    }
  }

  const turnTimes = new Map<number, number>();
  for (const ev of events) {
    if (ev.turn != null && !turnTimes.has(ev.turn)) {
      turnTimes.set(ev.turn, ev.t_ms);
    }
  }

  events.sort((a, b) => a.t_ms - b.t_ms);
  return { events, turnTimes };
}
