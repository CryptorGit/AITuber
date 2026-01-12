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
  scan_meta: {
    root: string;
    scanned_at: string;
    entries: Record<string, { dir_mtime_ms: number; files: string[] }>;
  };
};

export type ScriptSegment = {
  id: string;
  start_hint_ms: number | null;
  end_hint_ms: number | null;
  text: string;
  speaker: string;
  emotion_tag: string;
  reason_tags: string[];
  source_refs: string[];
};

export type ScriptDraft = {
  battle_id: string;
  version: 1;
  segments: ScriptSegment[];
};

export type TimedSegment = ScriptSegment & {
  start_ms: number;
  end_ms: number;
};

export type ScriptTimed = {
  battle_id: string;
  version: 1;
  segments: TimedSegment[];
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

export type TtsMoraTiming = {
  text: string;
  start_ms: number;
  end_ms: number;
  consonant?: string | null;
  vowel?: string | null;
};

export type TtsSegmentTiming = {
  id: string;
  text: string;
  start_ms: number;
  end_ms: number;
  moras: TtsMoraTiming[];
};

export type TtsTiming = {
  battle_id: string;
  version: 1;
  segments: TtsSegmentTiming[];
  total_ms: number;
};

export type TtsProvider = 'google' | 'voicevox';

export type GoogleTtsSettings = {
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

export type GoogleVoiceInfo = {
  name: string;
  languageCodes: string[];
  ssmlGender?: string;
  naturalSampleRateHertz?: number;
};

export type VoicevoxTtsSettings = {
  base_url: string;
  speaker: number;
  speed_scale: number;
  pitch_scale: number;
  intonation_scale: number;
  volume_scale: number;
  pre_phoneme_length: number;
  post_phoneme_length: number;
};

export type TtsSettings = {
  provider: TtsProvider;
  google: GoogleTtsSettings;
  voicevox: VoicevoxTtsSettings;
};

export type LipSyncPoint = { t_ms: number; open: number };

export type LipSyncTimeline = {
  battle_id: string;
  version: 1;
  points: LipSyncPoint[];
};

export type ProjectInputs = {
  battle_id: string;
  base_mp4: string;
  battle_log: string;
  ts_log: string | null;
  bgm_mp3: string | null;
  character_id: string | null;
};

export type ProjectOutputs = {
  script_json: string | null;
  script_timed_json: string | null;
  subtitles_draft_srt: string | null;
  subtitles_srt: string | null;
  subtitles_ass: string | null;
  tts_wav: string | null;
  tts_mp3: string | null;
  tts_timing_json: string | null;
  overlay_webm: string | null;
  overlay_mp4: string | null;
  lip_sync_json: string | null;
  final_mp4: string | null;
  final_with_subs_mp4: string | null;
  manifest_json: string | null;
};

export type ProjectSettings = {
  ladm: {
    max_segments: number;
    min_segment_ms: number;
    narrator: string;
  };
  tts: TtsSettings;
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
  audio: {
    tts_volume: number;
    bgm_volume: number;
    ducking: boolean;
  };
  subtitles: {
    burn_in: boolean;
    font: string;
    font_size: number;
  };
};

export type ProjectHashes = {
  ladm?: string | null;
  tts?: string | null;
  live2d?: string | null;
  compose?: string | null;
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
  hashes: ProjectHashes;
};

export type RunRecord = {
  run_id: string;
  project_id: string;
  status: StepState;
  started_at: string;
  ended_at: string | null;
  steps: Record<StepName, StepStatus>;
  inputs: ProjectInputs;
  settings: ProjectSettings;
  outputs: ProjectOutputs;
  version: string;
  metrics: Record<string, number | string | boolean>;
};

export type CharacterProfile = {
  character_id: string;
  name: string;
  renderer: 'simple_canvas';
  avatar: {
    body_color: string;
    accent_color: string;
    mouth_color: string;
  };
  chroma_key: string;
  width: number;
  height: number;
  fps: number;
};

export type DoctorStatus = {
  name: string;
  ok: boolean;
  message: string;
};
