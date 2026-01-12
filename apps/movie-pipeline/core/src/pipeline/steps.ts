import fs from 'node:fs';
import path from 'node:path';
import type { ProjectRecord, ProjectOutputs, StepName, ScriptDraft, SubtitleTimeline, ScriptTimed, TtsTiming, LipSyncTimeline } from '../types.ts';
import { projectArtifactPath, projectArtifactRel } from '../project/store.ts';
import { generateScriptDraft } from '../adapters/ladm/ruleBased.ts';
import { subtitleTimelineToSrt, subtitleTimelineToAss } from './subtitles.ts';
import { normalizeTimings } from './timing.ts';
import { synthesizeVoicevox } from '../adapters/tts/voicevox.ts';
import { synthesizeGoogleTts } from '../adapters/tts/googleTts.ts';
import { renderSimpleCanvas } from '../adapters/renderer/simpleCanvas.ts';
import { composeFinalMp4, probeFile } from './ffmpeg.ts';
import { createStepLogger } from '../utils/logger.ts';
import { loadCharacter } from '../assets/characters.ts';
import { fsStorage } from '../adapters/storage/fs.ts';

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

export async function runLadmStep(ctx: StepContext): Promise<StepResult> {
  const log = createStepLogger(ctx.logPath);
  const project = ctx.project;
  if (!project.inputs.battle_log) throw new Error('Missing battle_log input');

  log.info('Generating script draft (rule-based)');
  const script = generateScriptDraft({
    battleId: project.battle_id,
    battleLogPath: project.inputs.battle_log,
    tsLogPath: project.inputs.ts_log || undefined,
    settings: project.settings,
  });

  const scriptRel = projectArtifactRel('script.json');
  const draftSrtRel = projectArtifactRel('subtitles.draft.srt');
  const draftTimeline = buildDraftSubtitle(script, project.settings.ladm.min_segment_ms);

  writeJsonArtifact(project.project_id, scriptRel, script);
  writeTextArtifact(project.project_id, draftSrtRel, subtitleTimelineToSrt(draftTimeline));

  log.info(`Script segments: ${script.segments.length}`);
  return {
    outputs: {
      script_json: scriptRel,
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
  if (!project.outputs.script_json) throw new Error('script.json missing (run LADM first)');

  const scriptPath = projectArtifactPath(project.project_id, project.outputs.script_json);
  const script: ScriptDraft = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));

  const ttsDir = projectArtifactPath(project.project_id, projectArtifactRel('tts_segments'));
  log.info(`Synthesizing TTS via ${project.settings.tts.provider}`);
  const synth = project.settings.tts.provider === 'google' ? synthesizeGoogleTts : synthesizeVoicevox;
  const { wavPath, mp3Path, timing } = await synth({
    script,
    settings: project.settings,
    outDir: ttsDir,
    logPath: ctx.logPath,
  });

  const timingRel = projectArtifactRel('tts_timing.json');
  writeJsonArtifact(project.project_id, timingRel, timing);

  const wavRel = projectArtifactRel('tts.wav');
  const mp3Rel = projectArtifactRel('tts.mp3');
  fs.copyFileSync(wavPath, projectArtifactPath(project.project_id, wavRel));
  fs.copyFileSync(mp3Path, projectArtifactPath(project.project_id, mp3Rel));

  log.info('Normalizing timelines based on TTS timing');
  const { script_timed, subtitles } = normalizeTimings(script, timing);
  const scriptTimedRel = projectArtifactRel('script_timed.json');
  const subtitlesRel = projectArtifactRel('subtitles.srt');
  const subtitlesAssRel = projectArtifactRel('subtitles.ass');

  writeJsonArtifact(project.project_id, scriptTimedRel, script_timed);
  writeTextArtifact(project.project_id, subtitlesRel, subtitleTimelineToSrt(subtitles));
  writeTextArtifact(
    project.project_id,
    subtitlesAssRel,
    subtitleTimelineToAss(subtitles, { font: project.settings.subtitles.font, fontSize: project.settings.subtitles.font_size })
  );

  return {
    outputs: {
      tts_wav: wavRel,
      tts_mp3: mp3Rel,
      tts_timing_json: timingRel,
      script_timed_json: scriptTimedRel,
      subtitles_srt: subtitlesRel,
      subtitles_ass: subtitlesAssRel,
    },
    metrics: {
      tts_ms: timing.total_ms,
    },
  };
}

export async function runLive2dStep(ctx: StepContext): Promise<StepResult> {
  const log = createStepLogger(ctx.logPath);
  const project = ctx.project;
  if (!project.outputs.script_timed_json || !project.outputs.tts_timing_json || !project.outputs.tts_wav) {
    throw new Error('Missing timed script or tts artifacts (run TTS first)');
  }

  const scriptPath = projectArtifactPath(project.project_id, project.outputs.script_timed_json);
  const timingPath = projectArtifactPath(project.project_id, project.outputs.tts_timing_json);
  const script: ScriptTimed = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
  const timing: TtsTiming = JSON.parse(fs.readFileSync(timingPath, 'utf8'));

  const audioPath = projectArtifactPath(project.project_id, project.outputs.tts_wav);
  const overlayRel = projectArtifactRel('overlay.webm');
  const overlayAbs = projectArtifactPath(project.project_id, overlayRel);

  const character = loadCharacter(project.inputs.character_id);
  const chromaKey = character.chroma_key || project.settings.render.chroma_key;

  log.info('Rendering overlay (simple canvas renderer)');
  const { lipSync } = await renderSimpleCanvas({
    script,
    timing,
    audioPath,
    outputWebm: overlayAbs,
    logPath: ctx.logPath,
    settings: project.settings,
    chromaKey,
    avatar: character.avatar,
  });

  const lipRel = projectArtifactRel('lip_sync.json');
  writeJsonArtifact(project.project_id, lipRel, lipSync as LipSyncTimeline);

  return {
    outputs: {
      overlay_webm: overlayRel,
      lip_sync_json: lipRel,
    },
  };
}

export async function runComposeStep(ctx: StepContext): Promise<StepResult> {
  const log = createStepLogger(ctx.logPath);
  const project = ctx.project;
  if (!project.inputs.base_mp4) throw new Error('Missing base_mp4');
  if (!project.outputs.tts_wav) throw new Error('Missing tts.wav');

  await probeFile(project.inputs.base_mp4);
  await probeFile(projectArtifactPath(project.project_id, project.outputs.tts_wav));
  if (project.inputs.bgm_mp3) {
    await probeFile(project.inputs.bgm_mp3);
  }
  if (project.outputs.overlay_webm) {
    await probeFile(projectArtifactPath(project.project_id, project.outputs.overlay_webm));
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
    tts_audio: projectArtifactPath(project.project_id, project.outputs.tts_wav),
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
