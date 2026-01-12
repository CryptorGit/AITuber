export type Emotion = 'neutral' | 'happy' | 'angry' | 'surprised';
export type MotionName = 'idle' | 'nod' | 'point' | 'shock' | 'laugh';

export type ScriptSegment = {
  id: string;
  start_ms: number;
  end_ms: number;
  text: string;
  style: { emotion: Emotion; intensity: number };
  motion_hint: { name: MotionName; weight: number };
};

export type ScriptTimeline = {
  battle_id: string;
  version: 1;
  segments: ScriptSegment[];
};

export type SubtitleItem = {
  start_ms: number;
  end_ms: number;
  text: string;
};

export type SubtitleTimeline = {
  battle_id: string;
  version: 1;
  items: SubtitleItem[];
};

export type MotionItem = {
  start_ms: number;
  end_ms: number;
  motion: MotionName | string;
};

export type LipPoint = {
  t_ms: number;
  open: number;
};

export type MotionTimeline = {
  battle_id: string;
  version: 1;
  motions: MotionItem[];
  lip: LipPoint[];
};

export type AssetEntry = {
  battle_id: string;
  dir: string;
  base_mp4?: string | null;
  battle_log?: string | null;
  ts_log?: string | null;
};

export type AssetRegistry = {
  version: 1;
  updated_at: string;
  assets: AssetEntry[];
};

export type StepName = 'ladm' | 'tts' | 'live2d' | 'compose';
export type StepState = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';

export type StepStatus = {
  status: StepState;
  started_at: string | null;
  ended_at: string | null;
  log_path: string | null;
  error: string | null;
};

export type ProjectInputs = {
  battle_id: string;
  base_mp4: string;
  battle_log: string;
  ts_log: string;
  bgm_mp3: string | null;
};

export type ProjectArtifacts = {
  script_timeline: string | null;
  subtitle_timeline: string | null;
  motion_timeline: string | null;
  tts_mp3: string | null;
  tts_wav: string | null;
  overlay_video: string | null;
  subtitles_ass: string | null;
  final_mp4: string | null;
};

export type ProjectStatus = {
  project_id: string;
  battle_id: string;
  created_at: string;
  updated_at: string;
  inputs: ProjectInputs;
  steps: Record<StepName, StepStatus>;
  artifacts: ProjectArtifacts;
};

export type StepResult = {
  ok: boolean;
  error?: string;
};
