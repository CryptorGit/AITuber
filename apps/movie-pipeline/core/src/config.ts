import { z } from 'zod';
import type { ProjectSettings } from './types.ts';

export const ladmSettingsSchema = z.object({
  max_segments: z.number().int().min(1).max(200),
  min_segment_ms: z.number().int().min(200).max(30000),
  narrator: z.string().min(1),
});

export const googleTtsSettingsSchema = z.object({
  language_code: z.string().min(2),
  voice_name: z.string().min(1),
  speaking_rate: z.number().min(0.5).max(2.0),
  pitch: z.number().min(-20).max(20),
  volume_gain_db: z.number().min(-96).max(16),
  audio_encoding: z.enum(['LINEAR16', 'MP3']),
  sample_rate_hertz: z.number().int().min(8000).max(48000),
  enable_timepoints: z.boolean(),
  ssml_mark_style: z.literal('segment_start'),
});

export const voicevoxTtsSettingsSchema = z.object({
  base_url: z.string().url(),
  speaker: z.number().int().min(0),
  speed_scale: z.number().min(0.5).max(2.0),
  pitch_scale: z.number().min(-0.5).max(0.5),
  intonation_scale: z.number().min(0.0).max(2.0),
  volume_scale: z.number().min(0.0).max(2.0),
  pre_phoneme_length: z.number().min(0.0).max(1.0),
  post_phoneme_length: z.number().min(0.0).max(1.0),
});

export const mockTtsSettingsSchema = z.object({
  tone_hz: z.number().min(50).max(2000),
  sample_rate_hz: z.number().int().min(8000).max(48000),
});

export const ttsSettingsSchema = z.object({
  provider: z.enum(['google', 'voicevox', 'mock']),
  google: googleTtsSettingsSchema,
  voicevox: voicevoxTtsSettingsSchema,
  mock: mockTtsSettingsSchema,
});

export const renderSettingsSchema = z.object({
  width: z.number().int().min(256).max(3840),
  height: z.number().int().min(256).max(2160),
  fps: z.number().int().min(10).max(60),
  chroma_key: z.string().min(1),
  overlay_x: z.string().min(1),
  overlay_y: z.string().min(1),
  overlay_scale: z.number().min(0.1).max(2.0),
  renderer: z.literal('simple_canvas'),
});

export const audioSettingsSchema = z.object({
  tts_volume: z.number().min(0.1).max(2.0),
  bgm_volume: z.number().min(0.0).max(1.0),
  ducking: z.boolean(),
});

export const subtitlesSettingsSchema = z.object({
  burn_in: z.boolean(),
  font: z.string().min(1),
  font_size: z.number().int().min(12).max(96),
});

export const projectSettingsSchema = z.object({
  ladm: ladmSettingsSchema,
  tts: ttsSettingsSchema,
  render: renderSettingsSchema,
  audio: audioSettingsSchema,
  subtitles: subtitlesSettingsSchema,
});

function pickLegacyTts(raw: any, keys: string[]) {
  const out: Record<string, unknown> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(raw, key) && raw[key] !== undefined) {
      out[key] = raw[key];
    }
  }
  return out;
}

export function defaultProjectSettings(): ProjectSettings {
  return {
    ladm: {
      max_segments: 40,
      min_segment_ms: 1200,
      narrator: 'Narrator',
    },
    tts: {
      provider: 'google',
      google: {
        language_code: 'ja-JP',
        voice_name: 'ja-JP-Standard-A',
        speaking_rate: 1.0,
        pitch: 0.0,
        volume_gain_db: 0.0,
        audio_encoding: 'LINEAR16',
        sample_rate_hertz: 24000,
        enable_timepoints: true,
        ssml_mark_style: 'segment_start',
      },
      voicevox: {
        base_url: 'http://127.0.0.1:50021',
        speaker: 3,
        speed_scale: 1.0,
        pitch_scale: 0.0,
        intonation_scale: 1.0,
        volume_scale: 1.0,
        pre_phoneme_length: 0.1,
        post_phoneme_length: 0.1,
      },
      mock: {
        tone_hz: 440,
        sample_rate_hz: 24000,
      },
    },
    render: {
      width: 1280,
      height: 720,
      fps: 30,
      chroma_key: '#00ff00',
      overlay_x: '0',
      overlay_y: '0',
      overlay_scale: 1.0,
      renderer: 'simple_canvas',
    },
    audio: {
      tts_volume: 1.0,
      bgm_volume: 0.25,
      ducking: true,
    },
    subtitles: {
      burn_in: true,
      font: 'Arial',
      font_size: 48,
    },
  };
}

export function mergeSettings(partial?: Partial<ProjectSettings>): ProjectSettings {
  const defaults = defaultProjectSettings();
  if (!partial) return defaults;
  const rawTts: any = (partial as any).tts ?? {};
  const legacyGoogle = pickLegacyTts(rawTts, [
    'language_code',
    'voice_name',
    'speaking_rate',
    'pitch',
    'volume_gain_db',
    'audio_encoding',
    'sample_rate_hertz',
    'enable_timepoints',
    'ssml_mark_style',
  ]);
  const legacyVoicevox = pickLegacyTts(rawTts, [
    'base_url',
    'speaker',
    'speed_scale',
    'pitch_scale',
    'intonation_scale',
    'volume_scale',
    'pre_phoneme_length',
    'post_phoneme_length',
  ]);
  const hasLegacyGoogle = Object.keys(legacyGoogle).length > 0;
  const hasLegacyVoicevox = Object.keys(legacyVoicevox).length > 0;
  const provider =
    typeof rawTts.provider === 'string'
      ? rawTts.provider
      : hasLegacyGoogle
        ? 'google'
        : hasLegacyVoicevox
          ? 'voicevox'
          : defaults.tts.provider;
  return projectSettingsSchema.parse({
    ladm: { ...defaults.ladm, ...(partial.ladm || {}) },
    tts: {
      provider,
      google: { ...defaults.tts.google, ...legacyGoogle, ...(rawTts.google || {}) },
      voicevox: { ...defaults.tts.voicevox, ...legacyVoicevox, ...(rawTts.voicevox || {}) },
      mock: { ...defaults.tts.mock, ...(rawTts.mock || {}) },
    },
    render: { ...defaults.render, ...(partial.render || {}) },
    audio: { ...defaults.audio, ...(partial.audio || {}) },
    subtitles: { ...defaults.subtitles, ...(partial.subtitles || {}) },
  });
}
