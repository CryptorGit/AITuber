export type StepName = 'ladm' | 'tts' | 'live2d' | 'compose';
export type StepState = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'CANCELED' | 'CACHED';

export type StepStatus = {
  status: StepState;
  started_at: string | null;
  ended_at: string | null;
  log_path: string | null;
  error: string | null;
  cached: boolean;
  metrics?: Record<string, number | string | boolean>;
};

export type AssetEntry = {
  battle_id: string;
  dir: string;
  base_mp4?: string | null;
  battle_log?: string | null;
  ts_log?: string | null;
  updated_at?: string | null;
  turns?: number | null;
  winner?: string | null;
  tags?: string[];
};

export type AssetRegistry = {
  version: 2;
  updated_at: string;
  assets: AssetEntry[];
};

export type BgmEntry = {
  name: string;
  path: string;
  size_bytes: number;
  loop?: { start_sec: number; end_sec: number } | null;
};

export type CharacterProfile = {
  character_id: string;
  name: string;
  renderer: 'simple_canvas';
  model_dir?: string;
};

export type ProjectSettings = {
  ladm: { max_segments: number; min_segment_ms: number; narrator: string };
  tts: {
    provider: 'google' | 'voicevox';
    google: {
      language_code: string;
      voice_name: string;
      speaking_rate: number;
      pitch: number;
      volume_gain_db: number;
      audio_encoding: 'LINEAR16' | 'MP3';
      sample_rate_hertz: number;
      enable_timepoints: boolean;
      ssml_mark_style: 'segment_start';
    };
    voicevox: {
      base_url: string;
      speaker: number;
      speed_scale: number;
      pitch_scale: number;
      intonation_scale: number;
      volume_scale: number;
      pre_phoneme_length: number;
      post_phoneme_length: number;
    };
  };
  render: {
    width: number;
    height: number;
    fps: number;
    chroma_key: string;
    overlay_x: string;
    overlay_y: string;
    overlay_scale: number;
    renderer: 'simple_canvas';
  };
  audio: { tts_volume: number; bgm_volume: number; ducking: boolean };
  subtitles: { burn_in: boolean; font: string; font_size: number };
};

export type ProjectInputs = {
  battle_id: string;
  base_mp4: string;
  battle_log: string | null;
  ts_log: string | null;
  bgm_mp3: string | null;
  character_id: string | null;
};

export type ProjectOutputs = {
  script_json: string | null;
  script_timed_json: string | null;
  narration_timeline_json: string | null;
  subtitle_timeline_json: string | null;
  subtitles_draft_srt: string | null;
  subtitles_srt: string | null;
  subtitles_ass: string | null;
  tts_wav: string | null;
  tts_mp3: string | null;
  tts_timing_json: string | null;
  live2d_motion_json: string | null;
  overlay_webm: string | null;
  overlay_mp4: string | null;
  lip_sync_json: string | null;
  final_mp4: string | null;
  final_with_subs_mp4: string | null;
  manifest_json: string | null;
};

export type ProjectRecord = {
  project_id: string;
  battle_id: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  inputs: ProjectInputs;
  settings: ProjectSettings;
  outputs: ProjectOutputs;
  steps: Record<StepName, StepStatus>;
  last_run_id: string | null;
};

export type RunRecord = {
  run_id: string;
  project_id: string;
  status: StepState;
  started_at: string;
  ended_at: string | null;
  steps: Record<StepName, StepStatus>;
  outputs: ProjectOutputs;
  version: string;
};

export type DoctorStatus = { name: string; ok: boolean; message: string };
export type GoogleVoice = {
  name: string;
  languageCodes: string[];
  ssmlGender?: string;
  naturalSampleRateHertz?: number;
};

export const API_BASE = (import.meta as any).env?.VITE_MP_API_BASE || 'http://127.0.0.1:8788';

async function fetchJson<T>(url: string, opts?: RequestInit) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return (await res.json()) as T;
}

export async function getAssets(refresh?: boolean) {
  const url = new URL(API_BASE + '/api/mp/assets');
  if (refresh) url.searchParams.set('refresh', '1');
  return fetchJson<{ registry: AssetRegistry; bgm: BgmEntry[]; characters: CharacterProfile[] }>(url.toString());
}

export function assetMediaUrl(battleId: string, kind: 'base_mp4' | 'battle_log' | 'ts_log') {
  const url = new URL(API_BASE + `/api/mp/assets/${encodeURIComponent(battleId)}/media`);
  url.searchParams.set('kind', kind);
  return url.toString();
}

export async function getProjects() {
  return fetchJson<{ projects: ProjectRecord[] }>(API_BASE + '/api/mp/projects');
}

export async function createProject(payload: {
  battle_id: string;
  project_id?: string;
  bgm_path?: string | null;
  bgm_name?: string | null;
  character_id?: string | null;
  settings?: Partial<ProjectSettings>;
}) {
  return fetchJson<ProjectRecord>(API_BASE + '/api/mp/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function bgmMediaUrl(name: string) {
  return API_BASE + `/api/mp/bgm/${encodeURIComponent(name)}`;
}

export async function updateProject(projectId: string, payload: { settings?: Partial<ProjectSettings>; bgm_path?: string | null; character_id?: string | null }) {
  return fetchJson<ProjectRecord>(API_BASE + `/api/mp/projects/${encodeURIComponent(projectId)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function deleteProject(projectId: string, opts?: { hard?: boolean }) {
  const url = new URL(API_BASE + `/api/mp/projects/${encodeURIComponent(projectId)}`);
  if (opts?.hard) url.searchParams.set('hard', 'true');
  return fetchJson<{ deleted: boolean; project: ProjectRecord }>(url.toString(), {
    method: 'DELETE',
  });
}

export async function updateScript(projectId: string, script: any) {
  return fetchJson<ProjectRecord>(API_BASE + `/api/mp/projects/${encodeURIComponent(projectId)}/script`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ script }),
  });
}

export async function updateSubtitleTimeline(projectId: string, timeline: any) {
  return fetchJson<ProjectRecord>(API_BASE + `/api/mp/projects/${encodeURIComponent(projectId)}/subtitle_timeline`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ timeline }),
  });
}

export async function updateLive2dMotion(projectId: string, motion: any) {
  return fetchJson<ProjectRecord>(API_BASE + `/api/mp/projects/${encodeURIComponent(projectId)}/live2d_motion`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ motion }),
  });
}

export async function llmGenerate(
  projectId: string,
  payload: { kind: 'script' | 'subtitles' | 'live2d_motion'; prompt: string; model?: string; max_output_tokens?: number }
) {
  return fetchJson<{ raw: string; json: any }>(API_BASE + `/api/mp/projects/${encodeURIComponent(projectId)}/llm/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function getLlmSystemPrompt() {
  return fetchJson<{ text: string }>(API_BASE + '/api/mp/llm/system_prompt');
}

export async function updateLlmSystemPrompt(text: string) {
  return fetchJson<{ ok: boolean }>(API_BASE + '/api/mp/llm/system_prompt', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
}

export async function getLlmPrompts() {
  return fetchJson<{ script: string; subtitles: string; live2d_motion: string }>(API_BASE + '/api/mp/llm/prompts');
}

export async function updateLlmPrompts(payload: { script: string; subtitles: string; live2d_motion: string }) {
  return fetchJson<{ ok: boolean }>(API_BASE + '/api/mp/llm/prompts', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function getLlmConfig() {
  return fetchJson<{ default_model: string; has_api_key: boolean }>(API_BASE + '/api/mp/llm/config');
}

export async function getProject(projectId: string) {
  return fetchJson<ProjectRecord>(API_BASE + `/api/mp/projects/${encodeURIComponent(projectId)}`);
}

export async function runProjectStep(projectId: string, step: StepName | 'all', force?: boolean) {
  const url = new URL(API_BASE + `/api/mp/projects/${encodeURIComponent(projectId)}/run`);
  url.searchParams.set('step', step);
  if (force) url.searchParams.set('force', 'true');
  return fetchJson<ProjectRecord>(url.toString(), { method: 'POST' });
}

export async function getRuns(projectId: string) {
  return fetchJson<{ runs: RunRecord[] }>(API_BASE + `/api/mp/projects/${encodeURIComponent(projectId)}/runs`);
}

export async function getRun(projectId: string, runId: string) {
  return fetchJson<RunRecord>(API_BASE + `/api/mp/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}`);
}

export async function getStepLog(projectId: string, step: StepName, runId?: string | null) {
  const url = new URL(API_BASE + `/api/mp/projects/${encodeURIComponent(projectId)}/logs/${step}`);
  url.searchParams.set('tail', '8000');
  if (runId) url.searchParams.set('run_id', runId);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(await res.text());
  return res.text();
}

export async function getDoctor() {
  return fetchJson<{ statuses: DoctorStatus[] }>(API_BASE + '/api/mp/doctor');
}

export async function getVoices(languageCode?: string) {
  const url = new URL(API_BASE + '/api/mp/voices');
  if (languageCode) url.searchParams.set('language_code', languageCode);
  return fetchJson<{ voices: GoogleVoice[] }>(url.toString());
}

export function projectFileUrl(projectId: string, relPath: string) {
  return API_BASE + `/projects/${encodeURIComponent(projectId)}/${relPath.replace(/\\/g, '/')}`;
}
