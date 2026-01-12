import fs from 'node:fs';
import path from 'node:path';

export type BattleEvent = {
  t_ms: number | null;
  turn: number | null;
  text: string;
  type: string;
  raw: string | null;
};

function parseRawLine(line: string): BattleEvent | null {
  if (!line.startsWith('|')) return null;
  const parts = line.split('|').slice(1);
  const type = parts[0] || 'raw';
  if (type === 'turn') {
    const turn = Number(parts[1] || 0) || null;
    return { t_ms: null, turn, text: `Turn ${turn}`, type: 'turn', raw: line };
  }
  if (type === 'move') {
    const actor = parts[1] || '';
    const move = parts[2] || '';
    return { t_ms: null, turn: null, text: `${actor} used ${move}`, type: 'move', raw: line };
  }
  if (type === 'faint') {
    const target = parts[1] || '';
    return { t_ms: null, turn: null, text: `${target} fainted`, type: 'faint', raw: line };
  }
  if (type === 'win') {
    const winner = parts[1] || '';
    return { t_ms: null, turn: null, text: `${winner} won the battle`, type: 'win', raw: line };
  }
  if (type === '-weather') {
    const weather = parts[1] || '';
    return { t_ms: null, turn: null, text: `Weather changed: ${weather}`, type: 'weather', raw: line };
  }
  if (type === 'start') {
    const msg = parts.slice(1).join(' ').trim();
    return { t_ms: null, turn: null, text: msg || 'Battle effect started', type: 'start', raw: line };
  }
  return { t_ms: null, turn: null, text: line, type, raw: line };
}

function parseTextLine(line: string): BattleEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const rawEvent = parseRawLine(trimmed);
  if (rawEvent) return rawEvent;
  return { t_ms: null, turn: null, text: trimmed, type: 'text', raw: null };
}

function parseJsonLine(obj: any): BattleEvent | null {
  if (obj == null) return null;
  if (typeof obj === 'string') return parseTextLine(obj);
  const text = String(obj.text ?? obj.message ?? obj.line ?? obj.raw ?? '').trim();
  if (!text) return null;
  const tMs = Number(obj.t_ms ?? obj.t ?? obj.timestamp_ms ?? obj.time_ms);
  const turn = obj.turn != null ? Number(obj.turn) : null;
  const base = parseTextLine(text) || { t_ms: null, turn: null, text, type: 'text', raw: null };
  return { ...base, t_ms: Number.isFinite(tMs) ? tMs : null, turn: Number.isFinite(turn) ? turn : base.turn };
}

export function parseBattleLog(filePath: string): BattleEvent[] {
  const ext = path.extname(filePath).toLowerCase();
  const raw = fs.readFileSync(filePath, 'utf8');
  const events: BattleEvent[] = [];

  if (ext === '.jsonl') {
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed);
        const ev = parseJsonLine(obj);
        if (ev) events.push(ev);
      } catch {
        const ev = parseTextLine(trimmed);
        if (ev) events.push(ev);
      }
    }
    return events;
  }

  if (ext === '.json') {
    try {
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        for (const item of data) {
          const ev = parseJsonLine(item);
          if (ev) events.push(ev);
        }
        return events;
      }
      if (Array.isArray(data?.events)) {
        for (const item of data.events) {
          const ev = parseJsonLine(item);
          if (ev) events.push(ev);
        }
        return events;
      }
      const ev = parseJsonLine(data);
      if (ev) events.push(ev);
      return events;
    } catch {
      // fall through
    }
  }

  for (const line of raw.split(/\r?\n/)) {
    const ev = parseTextLine(line);
    if (ev) events.push(ev);
  }
  return events;
}
