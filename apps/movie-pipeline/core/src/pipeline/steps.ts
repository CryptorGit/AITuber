import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type {
  ProjectRecord,
  ProjectOutputs,
  StepName,
  ScriptDraft,
  ScriptFile,
  ScriptTimed,
  SubtitleTimeline,
  TtsTiming,
  LipSyncTimeline,
  TimelineFile,
  Live2dMotionFile,
} from '../types.ts';
import { projectArtifactPath, projectArtifactRel } from '../project/store.ts';
import { generateScriptDraft } from '../adapters/ladm/ruleBased.ts';
import { subtitleTimelineToSrt, subtitleTimelineToAss } from './subtitles.ts';
import { synthesizeVoicevox } from '../adapters/tts/voicevox.ts';
import { synthesizeGoogleTts } from '../adapters/tts/googleTts.ts';
import { synthesizeMockTts } from '../adapters/tts/mockTts.ts';
import { renderSimpleCanvas } from '../adapters/renderer/simpleCanvas.ts';
import { composeFinalMp4, generateSilentWav, fitWavToDuration, probeDurationSec, probeFile, runFfmpeg, wavToMp3 } from './ffmpeg.ts';
import { createStepLogger } from '../utils/logger.ts';
import { loadCharacter } from '../assets/characters.ts';
import { fsStorage } from '../adapters/storage/fs.ts';

async function probeVideoSize(filePath: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const proc = spawn('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height',
      '-of',
      'csv=p=0:s=x',
      filePath,
    ]);
    let out = '';
    proc.stdout.on('data', (d) => (out += String(d)));
    proc.on('error', () => resolve(null));
    proc.on('close', (code) => {
      if (code !== 0) return resolve(null);
      const text = out.trim();
      const m = text.match(/^(\d+)x(\d+)$/);
      if (!m) return resolve(null);
      const width = Number(m[1]);
      const height = Number(m[2]);
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return resolve(null);
      resolve({ width, height });
    });
  });
}

export type StepContext = {
  project: ProjectRecord;
  runId: string;
  logPath: string;
};

export type StepResult = {
  outputs: Partial<ProjectOutputs>;
  metrics?: Record<string, number | string | boolean>;
};

function writeJsonArtifact(projectId: string, rel: string, data: unknown) {
  const abs = projectArtifactPath(projectId, rel);
  fsStorage.writeJson(abs, data);
  return rel;
}

function writeTextArtifact(projectId: string, rel: string, text: string) {
  const abs = projectArtifactPath(projectId, rel);
  fsStorage.writeText(abs, text);
  return rel;
}

function buildDraftSubtitle(script: ScriptDraft, minMs: number): SubtitleTimeline {
  let cursor = 0;
  const items = script.segments.map((seg) => {
    const start = seg.start_hint_ms ?? cursor;
    const end = seg.end_hint_ms ?? start + minMs;
    cursor = end;
    return { start_ms: start, end_ms: end, text: seg.text };
  });
  return { battle_id: script.battle_id, version: 1, items };
}

function isScriptDraft(data: any): data is ScriptDraft {
  return Boolean(data && typeof data === 'object' && Array.isArray(data.segments));
}

function isScriptFile(data: any): data is ScriptFile {
  return Boolean(data && typeof data === 'object' && Array.isArray(data.lines));
}

function coerceScriptDraft(data: any, battleIdFallback: string): ScriptDraft {
  if (isScriptDraft(data)) return data;
  if (isScriptFile(data)) {
    const battleId = String(data.battle_id || battleIdFallback);
    return {
      battle_id: battleId,
      version: 1,
      segments: data.lines.map((l: any, idx: number) => ({
        id: String(l?.id || `line_${String(idx).padStart(3, '0')}`),
        start_hint_ms: null,
        end_hint_ms: null,
        text: String(l?.text || ''),
        speaker: 'n',
        emotion_tag: 'neutral',
        reason_tags: [],
        source_refs: [],
      })),
    };
  }
  throw new Error('Invalid script.json: expected {segments:[...]} or {lines:[...]}');
}

function scriptDraftToScriptFile(script: ScriptDraft): ScriptFile {
  return {
    battle_id: script.battle_id,
    narrator_style: 'neutral',
    lines: script.segments.map((s) => ({ id: s.id, text: s.text })),
  };
}

function timelineMaxEndSec(tl: TimelineFile): number {
  let max = 0;
  for (const it of tl.items || []) {
    if (typeof it?.end === 'number' && it.end > max) max = it.end;
  }
  return max;
}

function timelineToTtsTiming(tl: TimelineFile): TtsTiming {
  const segments = (tl.items || [])
    .filter((it) => it && typeof it.start === 'number' && typeof it.end === 'number')
    .map((it) => ({
      id: it.id,
      text: it.text,
      start_ms: Math.max(0, Math.round(it.start * 1000)),
      end_ms: Math.max(0, Math.round(it.end * 1000)),
      moras: [],
    }));

  const totalMs = Math.max(0, Math.round(timelineMaxEndSec(tl) * 1000));
  return { battle_id: tl.battle_id, version: 1, segments, total_ms: totalMs };
}

function timelineToSubtitleTimelineMs(tl: TimelineFile): SubtitleTimeline {
  return {
    battle_id: tl.battle_id,
    version: 1,
    items: (tl.items || []).map((it) => ({
      start_ms: Math.max(0, Math.round(it.start * 1000)),
      end_ms: Math.max(0, Math.round(it.end * 1000)),
      text: it.text,
    })),
  };
}

function buildScriptTimed(script: ScriptDraft, narrationTl: TimelineFile): ScriptTimed {
  const byId = new Map<string, { start_ms: number; end_ms: number }>();
  for (const it of narrationTl.items || []) {
    byId.set(it.id, { start_ms: Math.round(it.start * 1000), end_ms: Math.round(it.end * 1000) });
  }
  const built: any[] = [];
  for (let i = 0; i < script.segments.length; i++) {
    const s = script.segments[i];
    const t = byId.get(s.id);
    const prevEnd = built.length ? built[built.length - 1].end_ms : 0;
    const start_ms = t ? Math.max(prevEnd, Math.max(0, t.start_ms)) : prevEnd;
    const end_ms = t ? Math.max(start_ms, t.end_ms) : start_ms + 1000;
    built.push({ ...s, start_ms, end_ms });
  }
  return { battle_id: script.battle_id, version: 1, segments: built };
}

function buildLive2dMotionFromTimeline(narrationTl: TimelineFile): Live2dMotionFile {
  return {
    battle_id: narrationTl.battle_id,
    version: 1,
    items: (narrationTl.items || []).map((it) => ({
      id: it.id,
      start: it.start,
      end: it.end,
      expression: null,
      motion: null,
    })),
  };
}

function timelineToNarrationTimeline(tl: TimelineFile): TimelineFile {
  return {
    battle_id: tl.battle_id,
    version: 1,
    items: (tl.items || []).map((it) => ({
      id: it.id,
      start: it.start,
      end: it.end,
      text: it.text,
      kind: 'narration',
    })),
  };
}

function ensureTimelinesFromScript(opts: {
  project: ProjectRecord;
  script: ScriptDraft;
}): { created: Partial<ProjectOutputs>; narrationTl: TimelineFile; subtitleTl: TimelineFile } {
  const project = opts.project;
  const script = opts.script;

  const created: Partial<ProjectOutputs> = {};

  let subtitleTl: TimelineFile | null = null;
  if (project.outputs.subtitle_timeline_json) {
    const abs = projectArtifactPath(project.project_id, project.outputs.subtitle_timeline_json);
    subtitleTl = JSON.parse(fs.readFileSync(abs, 'utf8')) as TimelineFile;
  }
  if (!subtitleTl) {
    const draftTimeline = buildDraftSubtitle(script, project.settings.ladm.min_segment_ms);
    const rel = projectArtifactRel('subtitle_timeline.json');
    subtitleTl = {
      battle_id: script.battle_id,
      version: 1,
      items: draftTimeline.items.map((it, i) => ({
        id: script.segments[i]?.id || `line_${String(i).padStart(3, '0')}`,
        start: it.start_ms / 1000,
        end: it.end_ms / 1000,
        text: it.text,
        kind: 'subtitle',
      })),
    };
    writeJsonArtifact(project.project_id, rel, subtitleTl);
    created.subtitle_timeline_json = rel;
  }

  let narrationTl: TimelineFile | null = null;
  if (project.outputs.narration_timeline_json) {
    const abs = projectArtifactPath(project.project_id, project.outputs.narration_timeline_json);
    narrationTl = JSON.parse(fs.readFileSync(abs, 'utf8')) as TimelineFile;
  }
  if (!narrationTl) {
    const rel = projectArtifactRel('narration_timeline.json');
    narrationTl = timelineToNarrationTimeline(subtitleTl);
    writeJsonArtifact(project.project_id, rel, narrationTl);
    created.narration_timeline_json = rel;
  }

  return { created, narrationTl, subtitleTl };
}

export async function runLadmStep(ctx: StepContext): Promise<StepResult> {
  const log = createStepLogger(ctx.logPath);
  const project = ctx.project;
  if (!project.inputs.battle_log && !project.inputs.ts_log) {
    throw new Error('Missing inputs: require battle_log or ts_log');
  }

  let script: ScriptDraft | null = null;
  if (project.outputs.script_json) {
    try {
      const existingPath = projectArtifactPath(project.project_id, project.outputs.script_json);
      const existingRaw = JSON.parse(fs.readFileSync(existingPath, 'utf8'));
      script = coerceScriptDraft(existingRaw, project.battle_id);
      log.info('Using existing script.json as input');
    } catch {
      script = null;
    }
  }

  if (!script) {
    log.info('Generating script draft (rule-based)');
    script = generateScriptDraft({
      battleId: project.battle_id,
      battleLogPath: project.inputs.battle_log || null,
      tsLogPath: project.inputs.ts_log || undefined,
      settings: project.settings,
    });
  }

  const scriptFile = scriptDraftToScriptFile(script);

  const scriptRel = projectArtifactRel('script.json');
  const scriptDraftRel = projectArtifactRel('script_draft.json');
  const narrationTimelineRel = projectArtifactRel('narration_timeline.json');
  const subtitleTimelineRel = projectArtifactRel('subtitle_timeline.json');
  const draftSrtRel = projectArtifactRel('subtitles.draft.srt');
  const draftTimeline = buildDraftSubtitle(script, project.settings.ladm.min_segment_ms);

  // Spec: narration/subtitle timelines are separate. For now, default subtitle items == narration items.
  // Times are stored in seconds (start/end) and also used to generate a draft SRT.
  const narrationTimeline: TimelineFile = {
    battle_id: script.battle_id,
    version: 1,
    items: draftTimeline.items.map((it, i) => ({
      id: script.segments[i]?.id || `line_${String(i).padStart(3, '0')}`,
      start: it.start_ms / 1000,
      end: it.end_ms / 1000,
      text: it.text,
      kind: 'narration',
    })),
  };
  const subtitleTimelineFile: TimelineFile = {
    battle_id: script.battle_id,
    version: 1,
    items: draftTimeline.items.map((it, i) => ({
      id: script.segments[i]?.id || `line_${String(i).padStart(3, '0')}`,
      start: it.start_ms / 1000,
      end: it.end_ms / 1000,
      text: it.text,
      kind: 'subtitle',
    })),
  };

  // Spec: script.json is the minimal {lines:[...]} schema.
  writeJsonArtifact(project.project_id, scriptRel, scriptFile);
  // Keep the richer draft for debugging.
  writeJsonArtifact(project.project_id, scriptDraftRel, script);
  writeJsonArtifact(project.project_id, narrationTimelineRel, narrationTimeline);
  writeJsonArtifact(project.project_id, subtitleTimelineRel, subtitleTimelineFile);
  writeTextArtifact(project.project_id, draftSrtRel, subtitleTimelineToSrt(draftTimeline));

  log.info(`Script segments: ${script.segments.length}`);
  return {
    outputs: {
      script_json: scriptRel,
      narration_timeline_json: narrationTimelineRel,
      subtitle_timeline_json: subtitleTimelineRel,
      subtitles_draft_srt: draftSrtRel,
    },
    metrics: {
      segments: script.segments.length,
    },
  };
}

export async function runTtsStep(ctx: StepContext): Promise<StepResult> {
  const log = createStepLogger(ctx.logPath);
  const project = ctx.project;
  if (!project.outputs.script_json) throw new Error('script.json missing (generate/apply script.json first)');

  const scriptPath = projectArtifactPath(project.project_id, project.outputs.script_json);
  const scriptRaw = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
  const script: ScriptDraft = coerceScriptDraft(scriptRaw, project.battle_id);

  // LADM is optional: if narration/subtitle timelines are missing, derive defaults from script.
  const ensured = ensureTimelinesFromScript({ project, script });
  const narrationTl = ensured.narrationTl;
  const subtitleTl = ensured.subtitleTl;

  const targetTotalSec = Math.max(0.05, timelineMaxEndSec(narrationTl));

  const ttsDir = projectArtifactPath(project.project_id, projectArtifactRel('tts_segments'));
  log.info(`Synthesizing TTS via ${project.settings.tts.provider}`);
  const synth =
    project.settings.tts.provider === 'google'
      ? synthesizeGoogleTts
      : project.settings.tts.provider === 'voicevox'
        ? synthesizeVoicevox
        : synthesizeMockTts;
  const { wavPath, mp3Path, timing } = await synth({
    script,
    settings: project.settings,
    outDir: ttsDir,
    logPath: ctx.logPath,
  });

  // Keep original timing as debug artifact.
  const timingRel = projectArtifactRel('tts_timing.json');
  writeJsonArtifact(project.project_id, timingRel, timing);

  // Spec: narration timeline is the timing source. Fit audio to narration total duration.
  const wavRel = projectArtifactRel('narration_tts.wav');
  const mp3Rel = projectArtifactRel('narration_tts.mp3');
  const fittedWavAbs = projectArtifactPath(project.project_id, wavRel);
  await fitWavToDuration({ inWav: wavPath, outWav: fittedWavAbs, targetSec: targetTotalSec, log });
  await wavToMp3({ inWav: fittedWavAbs, outMp3: projectArtifactPath(project.project_id, mp3Rel), log });

  // Spec: subtitles timeline is separate; generate SRT/ASS directly from it.
  const subtitles = timelineToSubtitleTimelineMs(subtitleTl);
  const subtitlesRel = projectArtifactRel('subtitles.srt');
  const subtitlesAssRel = projectArtifactRel('subtitles.ass');
  writeTextArtifact(project.project_id, subtitlesRel, subtitleTimelineToSrt(subtitles));
  writeTextArtifact(
    project.project_id,
    subtitlesAssRel,
    subtitleTimelineToAss(subtitles, { font: project.settings.subtitles.font, fontSize: project.settings.subtitles.font_size })
  );

  // Provide a script_timed.json for debug/compat, derived from narration timeline.
  const scriptTimedRel = projectArtifactRel('script_timed.json');
  writeJsonArtifact(project.project_id, scriptTimedRel, buildScriptTimed(script, narrationTl));

  let mp3DurSec = 0;
  try {
    mp3DurSec = await probeDurationSec(projectArtifactPath(project.project_id, mp3Rel));
  } catch {
    mp3DurSec = 0;
  }

  return {
    outputs: {
      ...ensured.created,
      tts_wav: wavRel,
      tts_mp3: mp3Rel,
      tts_timing_json: timingRel,
      script_timed_json: scriptTimedRel,
      subtitles_srt: subtitlesRel,
      subtitles_ass: subtitlesAssRel,
    },
    metrics: {
      tts_ms: Math.round(targetTotalSec * 1000),
      tts_mp3_sec: mp3DurSec,
    },
  };
}

export async function runLive2dStep(ctx: StepContext): Promise<StepResult> {
  const log = createStepLogger(ctx.logPath);
  const project = ctx.project;
  if (!project.outputs.script_json) throw new Error('script.json missing (generate/apply script.json first)');

  const scriptPath = projectArtifactPath(project.project_id, project.outputs.script_json);
  const scriptRaw = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
  const scriptDraft: ScriptDraft = coerceScriptDraft(scriptRaw, project.battle_id);

  // LADM is optional: ensure narration/subtitle exist so timing/motion can be derived.
  const ensured = ensureTimelinesFromScript({ project, script: scriptDraft });
  const narrationTl: TimelineFile = ensured.narrationTl;
  const timing: TtsTiming = timelineToTtsTiming(narrationTl);
  const script: ScriptTimed = buildScriptTimed(scriptDraft, narrationTl);

  // Renderer requires an audio file. For spec order (Live2D before TTS), use a silent placeholder.
  const silenceRel = projectArtifactRel('live2d_silence.wav');
  const silenceAbs = projectArtifactPath(project.project_id, silenceRel);
  await generateSilentWav({ outWav: silenceAbs, durationSec: Math.max(0.05, timing.total_ms / 1000), log });
  const audioPath = silenceAbs;

  // Spec motion contract
  const defaultMotionRel = projectArtifactRel('live2d_motion.json');
  let motionRel = defaultMotionRel;
  if (project.outputs.live2d_motion_json) {
    const existingAbs = projectArtifactPath(project.project_id, project.outputs.live2d_motion_json);
    if (fs.existsSync(existingAbs) && fs.statSync(existingAbs).size > 0) {
      motionRel = project.outputs.live2d_motion_json;
      log.info('Using existing live2d_motion.json');
    }
  }
  if (motionRel === defaultMotionRel) {
    writeJsonArtifact(project.project_id, motionRel, buildLive2dMotionFromTimeline(narrationTl));
  }

  const overlayRel = projectArtifactRel('overlay.webm');
  const overlayAbs = projectArtifactPath(project.project_id, overlayRel);

  const character = loadCharacter(project.inputs.character_id);
  const chromaKey = character.chroma_key || project.settings.render.chroma_key;

  // Prefer matching base_mp4 resolution for overlay so it aligns when composed at (0,0).
  // (This also makes the overlay naturally 16:9 when the base is 16:9.)
  let renderSettings = project.settings;
  if (project.inputs.base_mp4) {
    const sz = await probeVideoSize(project.inputs.base_mp4);
    if (sz) {
      renderSettings = {
        ...project.settings,
        render: {
          ...project.settings.render,
          width: sz.width,
          height: sz.height,
          overlay_x: '0',
          overlay_y: '0',
          overlay_scale: 1.0,
        },
      };
      log.info(`Overlay render size: ${sz.width}x${sz.height} (from base_mp4)`);
    }
  }

  const useMock = String(process.env.MP_MOCK_LIVE2D || '').toLowerCase() === '1' || String(process.env.MP_MOCK_LIVE2D || '').toLowerCase() === 'true';

  let lipSync: LipSyncTimeline;
  if (useMock) {
    log.info('Rendering overlay via ffmpeg mock (MP_MOCK_LIVE2D=1)');
    const w = renderSettings.render.width;
    const h = renderSettings.render.height;
    const durSec = Math.max(0.05, timing.total_ms / 1000);
    const fps = renderSettings.render.fps;
    // Green background (for chromakey) + a black box.
    await runFfmpeg(
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        `color=c=${chromaKey.replace('#', '0x')}:s=${w}x${h}:d=${durSec}`,
        '-vf',
        `drawbox=x=${Math.round(w * 0.35)}:y=${Math.round(h * 0.25)}:w=${Math.round(w * 0.3)}:h=${Math.round(h * 0.5)}:color=black@1:t=fill`,
        '-r',
        String(fps),
        '-c:v',
        'libvpx-vp9',
        '-pix_fmt',
        'yuv420p',
        overlayAbs,
      ],
      log
    );

    const points: { t_ms: number; open: number }[] = [];
    for (let t = 0; t <= timing.total_ms; t += 100) {
      points.push({ t_ms: t, open: 0.2 });
    }
    lipSync = { battle_id: script.battle_id, version: 1, points };
  } else {
    log.info('Rendering overlay (simple canvas renderer)');
    const rendered = await renderSimpleCanvas({
      script,
      timing,
      audioPath,
      outputWebm: overlayAbs,
      logPath: ctx.logPath,
      settings: renderSettings,
      chromaKey,
      avatar: character.avatar,
    });
    lipSync = rendered.lipSync as LipSyncTimeline;
  }

  const lipRel = projectArtifactRel('lip_sync.json');
  writeJsonArtifact(project.project_id, lipRel, lipSync as LipSyncTimeline);

  return {
    outputs: {
      ...ensured.created,
      live2d_motion_json: motionRel,
      overlay_webm: overlayRel,
      lip_sync_json: lipRel,
    },
  };
}

export async function runComposeStep(ctx: StepContext): Promise<StepResult> {
  const log = createStepLogger(ctx.logPath);
  const project = ctx.project;
  // Spec: compose requires base mp4, overlay, narration TTS, and subtitles.
  const missing: string[] = [];
  if (!project.inputs.base_mp4) missing.push('inputs.base_mp4');
  if (!project.outputs.tts_mp3) missing.push('outputs.narration_tts.mp3');
  if (!project.outputs.overlay_webm) missing.push('outputs.overlay.webm');
  if (!project.outputs.subtitles_ass) missing.push('outputs.subtitles.ass');
  if (missing.length) {
    throw new Error(`Missing required inputs/artifacts: ${missing.join(', ')}`);
  }

  await probeFile(project.inputs.base_mp4);
  if (project.inputs.bgm_mp3) {
    await probeFile(project.inputs.bgm_mp3);
  } else {
    log.info('No BGM selected; composing without bgm_audio');
  }
  await probeFile(projectArtifactPath(project.project_id, project.outputs.tts_mp3!));
  await probeFile(projectArtifactPath(project.project_id, project.outputs.overlay_webm!));
  {
    const subsPath = projectArtifactPath(project.project_id, project.outputs.subtitles_ass!);
    if (!fs.existsSync(subsPath)) throw new Error(`Missing file: ${subsPath}`);
    const st = fs.statSync(subsPath);
    if (st.size <= 0) throw new Error(`Empty file: ${subsPath}`);
  }

  const overlay = project.outputs.overlay_webm
    ? {
        path: projectArtifactPath(project.project_id, project.outputs.overlay_webm),
        chroma_key: project.settings.render.chroma_key,
        scale: project.settings.render.overlay_scale,
        x: project.settings.render.overlay_x,
        y: project.settings.render.overlay_y,
      }
    : null;

  const outRel = projectArtifactRel('final.mp4');
  const outAbs = projectArtifactPath(project.project_id, outRel);
  const outSubRel = project.settings.subtitles.burn_in ? projectArtifactRel('final_with_subs.mp4') : null;
  const outSubAbs = outSubRel ? projectArtifactPath(project.project_id, outSubRel) : null;

  await composeFinalMp4({
    base_mp4: project.inputs.base_mp4,
    overlay,
    tts_audio: projectArtifactPath(project.project_id, project.outputs.tts_mp3!),
    bgm_audio: project.inputs.bgm_mp3 || null,
    subtitles_ass: project.outputs.subtitles_ass ? projectArtifactPath(project.project_id, project.outputs.subtitles_ass) : null,
    output_mp4: outAbs,
    output_with_subs_mp4: outSubAbs,
    tts_volume: project.settings.audio.tts_volume,
    bgm_volume: project.settings.audio.bgm_volume,
    ducking: project.settings.audio.ducking,
    log,
  });

  return {
    outputs: {
      final_mp4: outRel,
      final_with_subs_mp4: outSubRel,
    },
  };
}
