import type { ScriptDraft, ScriptTimed, SubtitleTimeline, TtsTiming } from '../types.ts';

export type TimingOptions = {
  pad_start_ms: number;
  pad_end_ms: number;
  min_gap_ms: number;
};

const DEFAULT_OPTS: TimingOptions = {
  pad_start_ms: 80,
  pad_end_ms: 80,
  min_gap_ms: 40,
};

export function normalizeTimings(script: ScriptDraft, tts: TtsTiming, opts?: Partial<TimingOptions>) {
  const options = { ...DEFAULT_OPTS, ...(opts || {}) };
  const segments = script.segments.slice();

  let cursor = 0;
  const timed: ScriptTimed = {
    battle_id: script.battle_id,
    version: 1,
    segments: [],
  };

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const ttsSeg = tts.segments[i];
    const baseStart = ttsSeg ? ttsSeg.start_ms : cursor;
    const baseEnd = ttsSeg ? ttsSeg.end_ms : baseStart + 1000;
    let start = Math.max(0, Math.round(baseStart - options.pad_start_ms));
    let end = Math.min(tts.total_ms, Math.round(baseEnd + options.pad_end_ms));
    if (start < cursor + options.min_gap_ms) start = cursor + options.min_gap_ms;
    if (end <= start) end = start + Math.max(200, baseEnd - baseStart);
    timed.segments.push({
      ...seg,
      start_ms: start,
      end_ms: end,
    });
    cursor = end;
  }

  const subtitles: SubtitleTimeline = {
    battle_id: script.battle_id,
    version: 1,
    items: timed.segments.map((seg) => ({ start_ms: seg.start_ms, end_ms: seg.end_ms, text: seg.text })),
  };

  return { script_timed: timed, subtitles };
}
