import type { ScriptTimeline, SubtitleTimeline, MotionTimeline, ScriptSegment, MotionName } from './types.ts';

function clamp01(n: number) {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function segmentWeights(segments: ScriptSegment[]) {
  return segments.map((seg) => {
    const len = seg.text.trim().length;
    return Math.max(1, len);
  });
}

export function normalizeScriptTimeline(
  script: ScriptTimeline,
  audioDurationMs: number
): ScriptTimeline {
  const segments = script.segments.slice();
  if (!segments.length || audioDurationMs <= 0) return script;

  const weights = segmentWeights(segments);
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  let cursor = 0;
  const normalized = segments.map((seg, idx) => {
    const slice = audioDurationMs * (weights[idx] / totalWeight);
    const start = Math.round(cursor);
    let end = Math.round(cursor + slice);
    if (idx === segments.length - 1) end = Math.round(audioDurationMs);
    if (end < start) end = start;
    cursor = end;
    return {
      ...seg,
      start_ms: start,
      end_ms: end,
    };
  });

  return {
    ...script,
    segments: normalized,
  };
}

export function subtitleFromScript(script: ScriptTimeline): SubtitleTimeline {
  return {
    battle_id: script.battle_id,
    version: 1,
    items: script.segments.map((seg) => ({
      start_ms: seg.start_ms,
      end_ms: seg.end_ms,
      text: seg.text,
    })),
  };
}

export function deriveMotionFromScript(script: ScriptTimeline, audioDurationMs: number): MotionTimeline {
  const motionCycle: MotionName[] = ['idle', 'nod', 'point', 'shock', 'laugh'];
  const motions = script.segments.map((seg, idx) => ({
    start_ms: seg.start_ms,
    end_ms: seg.end_ms,
    motion: seg.motion_hint?.name || motionCycle[idx % motionCycle.length],
  }));

  const lip: { t_ms: number; open: number }[] = [];
  const stepMs = 80;
  const total = Math.max(0, Math.round(audioDurationMs));
  for (let t = 0; t <= total; t += stepMs) {
    const wave = Math.abs(Math.sin(t / 180));
    const open = clamp01(0.15 + wave * 0.75);
    lip.push({ t_ms: t, open });
  }

  return {
    battle_id: script.battle_id,
    version: 1,
    motions,
    lip,
  };
}

export function normalizeTimelines(
  script: ScriptTimeline,
  subtitle: SubtitleTimeline,
  motion: MotionTimeline,
  audioDurationMs: number
) {
  const normalizedScript = normalizeScriptTimeline(script, audioDurationMs);
  const normalizedSubtitle = subtitleFromScript(normalizedScript);
  const normalizedMotion = deriveMotionFromScript(normalizedScript, audioDurationMs);
  return {
    script: normalizedScript,
    subtitle: normalizedSubtitle,
    motion: normalizedMotion,
  };
}
