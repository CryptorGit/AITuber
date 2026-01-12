import { hashFile, hashString } from '../utils/hash.ts';
import type { ProjectRecord } from '../types.ts';
import { projectArtifactPath } from '../project/store.ts';

async function combine(parts: string[]) {
  return hashString(parts.join('|'));
}

export async function hashLadm(project: ProjectRecord) {
  const parts: string[] = [];
  parts.push(project.inputs.battle_log ? await hashFile(project.inputs.battle_log) : '');
  parts.push(project.inputs.ts_log ? await hashFile(project.inputs.ts_log) : '');
  parts.push(await hashString(JSON.stringify(project.settings.ladm)));
  return combine(parts);
}

export async function hashTts(project: ProjectRecord) {
  if (!project.outputs.script_json) return '';
  const scriptPath = projectArtifactPath(project.project_id, project.outputs.script_json);
  const parts: string[] = [];
  parts.push(await hashFile(scriptPath));
  const provider = project.settings.tts.provider;
  const ttsSettings =
    provider === 'google'
      ? { provider, google: project.settings.tts.google }
      : { provider, voicevox: project.settings.tts.voicevox };
  parts.push(await hashString(JSON.stringify(ttsSettings)));
  return combine(parts);
}

export async function hashLive2d(project: ProjectRecord) {
  if (!project.outputs.script_timed_json || !project.outputs.tts_wav || !project.outputs.tts_timing_json) return '';
  const parts: string[] = [];
  parts.push(await hashFile(projectArtifactPath(project.project_id, project.outputs.script_timed_json)));
  parts.push(await hashFile(projectArtifactPath(project.project_id, project.outputs.tts_wav)));
  parts.push(await hashFile(projectArtifactPath(project.project_id, project.outputs.tts_timing_json)));
  parts.push(await hashString(JSON.stringify(project.settings.render)));
  parts.push(await hashString(String(project.inputs.character_id || 'builtin_simple')));
  return combine(parts);
}

export async function hashCompose(project: ProjectRecord) {
  const parts: string[] = [];
  parts.push(await hashFile(project.inputs.base_mp4));
  if (project.outputs.overlay_webm) {
    parts.push(await hashFile(projectArtifactPath(project.project_id, project.outputs.overlay_webm)));
  }
  if (project.outputs.tts_wav) {
    parts.push(await hashFile(projectArtifactPath(project.project_id, project.outputs.tts_wav)));
  }
  if (project.inputs.bgm_mp3) {
    parts.push(await hashFile(project.inputs.bgm_mp3));
  }
  if (project.outputs.subtitles_ass) {
    parts.push(await hashFile(projectArtifactPath(project.project_id, project.outputs.subtitles_ass)));
  }
  parts.push(await hashString(JSON.stringify({ audio: project.settings.audio, render: project.settings.render, subtitles: project.settings.subtitles })));
  return combine(parts);
}
