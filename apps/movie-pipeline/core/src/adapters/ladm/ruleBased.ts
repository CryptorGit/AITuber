import type { ScriptDraft, ScriptSegment } from '../../types.ts';
import type { ProjectSettings } from '../../types.ts';
import { parseBattleLog } from '../../ladm/battleLog.ts';
import { parseTsLog } from '../../ladm/tsLog.ts';

function pickEmotion(text: string) {
  const low = text.toLowerCase();
  if (low.includes('faint') || low.includes('critical')) return 'surprised';
  if (low.includes('won the battle')) return 'happy';
  if (low.includes('trick room') || low.includes('tailwind')) return 'neutral';
  return 'neutral';
}

function summarizeTurn(events: string[]) {
  if (!events.length) return 'The teams trade position.';
  const unique = Array.from(new Set(events));
  if (unique.length <= 2) return unique.join(' and ') + '.';
  return `${unique.slice(0, 2).join(' and ')}, and more.`;
}

function toTurnKey(turn: number | null) {
  return turn != null ? turn : 0;
}

export function generateScriptDraft(opts: {
  battleId: string;
  battleLogPath: string;
  tsLogPath?: string | null;
  settings: ProjectSettings;
}): ScriptDraft {
  const events = parseBattleLog(opts.battleLogPath);
  const tsInfo = opts.tsLogPath ? parseTsLog(opts.tsLogPath) : null;

  const segments: ScriptSegment[] = [];
  const narrator = opts.settings.ladm.narrator;

  const startLine = events.find((ev) => ev.text.toLowerCase().includes('battle started between'));
  if (startLine) {
    segments.push({
      id: 'seg_000',
      start_hint_ms: startLine.t_ms ?? 0,
      end_hint_ms: (startLine.t_ms ?? 0) + opts.settings.ladm.min_segment_ms,
      text: startLine.text,
      speaker: narrator,
      emotion_tag: 'neutral',
      reason_tags: ['battle-start'],
      source_refs: [startLine.text],
    });
  } else {
    segments.push({
      id: 'seg_000',
      start_hint_ms: 0,
      end_hint_ms: opts.settings.ladm.min_segment_ms,
      text: 'The battle begins!',
      speaker: narrator,
      emotion_tag: 'neutral',
      reason_tags: ['battle-start'],
      source_refs: [],
    });
  }

  let currentTurn = 0;
  const turnEvents: Record<number, string[]> = {};
  for (const ev of events) {
    if (ev.type === 'turn' && ev.turn != null) {
      currentTurn = ev.turn;
      if (!turnEvents[currentTurn]) turnEvents[currentTurn] = [];
      continue;
    }
    const key = toTurnKey(currentTurn);
    if (!turnEvents[key]) turnEvents[key] = [];
    if (ev.type === 'move') {
      turnEvents[key].push(ev.text);
    } else if (ev.type === 'faint') {
      turnEvents[key].push(ev.text);
    } else if (ev.type === 'start' || ev.type === 'weather') {
      turnEvents[key].push(ev.text);
    } else if (ev.type === 'text' && /fainted|knocked out|won the battle/i.test(ev.text)) {
      turnEvents[key].push(ev.text);
    }
  }

  if (!turnEvents[1] && turnEvents[0]) {
    turnEvents[1] = turnEvents[0];
    delete turnEvents[0];
  }

  const maxTurn = Math.max(1, ...Object.keys(turnEvents).map((k) => Number(k)));
  const maxSegments = opts.settings.ladm.max_segments;
  let segIndex = 1;

  for (let turn = 1; turn <= maxTurn && segments.length < maxSegments - 1; turn++) {
    const lines = turnEvents[turn] || [];
    if (!lines.length) continue;
    const summary = summarizeTurn(lines);
    const tHint = tsInfo?.turnTimes.get(turn) ?? null;
    segments.push({
      id: `seg_${String(segIndex).padStart(3, '0')}`,
      start_hint_ms: tHint,
      end_hint_ms: tHint != null ? tHint + opts.settings.ladm.min_segment_ms : null,
      text: `Turn ${turn}: ${summary}`,
      speaker: narrator,
      emotion_tag: pickEmotion(summary),
      reason_tags: ['turn', ...(lines.some((l) => l.toLowerCase().includes('faint')) ? ['faint'] : [])],
      source_refs: lines.slice(0, 3),
    });
    segIndex += 1;
  }

  const winEvent = events.find((ev) => ev.type === 'win' || ev.text.toLowerCase().includes('won the battle'));
  if (winEvent && segments.length < maxSegments) {
    segments.push({
      id: `seg_${String(segIndex).padStart(3, '0')}`,
      start_hint_ms: winEvent.t_ms,
      end_hint_ms: winEvent.t_ms != null ? winEvent.t_ms + opts.settings.ladm.min_segment_ms : null,
      text: winEvent.text,
      speaker: narrator,
      emotion_tag: 'happy',
      reason_tags: ['battle-end'],
      source_refs: [winEvent.text],
    });
  }

  return { battle_id: opts.battleId, version: 1, segments };
}
