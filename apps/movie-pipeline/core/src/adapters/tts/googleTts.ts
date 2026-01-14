import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { GoogleAuth } from 'google-auth-library';
import type { ScriptDraft, TtsTiming, TtsSegmentTiming, GoogleVoiceInfo } from '../../types.ts';
import type { ProjectSettings, GoogleTtsSettings } from '../../types.ts';
import { ensureDir } from '../../paths.ts';
import { createStepLogger } from '../../utils/logger.ts';

const GOOGLE_TTS_URL_V1 = 'https://texttospeech.googleapis.com/v1/text:synthesize';
const GOOGLE_TTS_URL_V1BETA1 = 'https://texttospeech.googleapis.com/v1beta1/text:synthesize';
const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';

export type GoogleTimepoint = { markName: string; timeSeconds: number };

function inferSampleRateFromTimepoints(pcmBytes: number, timepoints: GoogleTimepoint[]): number | null {
  // For LINEAR16 mono, bytes = samples * 2. If we have an end mark time, we can infer sample rate.
  if (!Number.isFinite(pcmBytes) || pcmBytes <= 0) return null;
  if (pcmBytes % 2 !== 0) return null;
  if (!Array.isArray(timepoints) || !timepoints.length) return null;

  let maxSec = 0;
  for (const tp of timepoints) {
    const t = Number((tp as any)?.timeSeconds);
    if (Number.isFinite(t) && t > maxSec) maxSec = t;
  }
  if (!Number.isFinite(maxSec) || maxSec <= 0.05) return null;

  const samples = pcmBytes / 2;
  const sr = Math.round(samples / maxSec);
  if (!Number.isFinite(sr) || sr < 8000 || sr > 96000) return null;
  return sr;
}

function escapeSsml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function buildSsmlWithMarks(script: ScriptDraft, style: GoogleTtsSettings['ssml_mark_style']) {
  const marks: string[] = [];
  let ssml = '<speak>';
  for (const seg of script.segments) {
    const markName = `${seg.id}_start`;
    marks.push(markName);
    ssml += `<mark name="${markName}"/>`;
    ssml += escapeSsml(seg.text) + ' ';
  }
  const endMark = 'end';
  marks.push(endMark);
  ssml += `<mark name="${endMark}"/>`;
  ssml += '</speak>';
  return { ssml, marks, endMark, style };
}

function wavHeader(dataLength: number, sampleRate: number, channels = 1, bitDepth = 16) {
  const blockAlign = (channels * bitDepth) / 8;
  const byteRate = sampleRate * blockAlign;
  const buffer = Buffer.alloc(44);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitDepth, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataLength, 40);
  return buffer;
}

function writeLinear16Wav(outputPath: string, pcmData: Buffer, sampleRate: number) {
  const header = wavHeader(pcmData.length, sampleRate, 1, 16);
  fs.writeFileSync(outputPath, Buffer.concat([header, pcmData]));
}

async function runFfmpeg(args: string[], log?: ReturnType<typeof createStepLogger>) {
  return new Promise<void>((resolve, reject) => {
    if (log) log.info(`ffmpeg ${args.join(' ')}`);
    const proc = spawn('ffmpeg', args, { stdio: 'pipe' });
    let stderr = '';
    proc.stderr.on('data', (d) => (stderr += String(d)));
    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg failed (${code}): ${stderr.slice(-2000)}`));
    });
  });
}

async function convertAudio(inputPath: string, outputPath: string, log?: ReturnType<typeof createStepLogger>) {
  await runFfmpeg(['-y', '-i', inputPath, outputPath], log);
}

async function probeDurationMs(filePath: string) {
  return new Promise<number>((resolve, reject) => {
    const proc = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nk=1:nw=1', filePath]);
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => (out += String(d)));
    proc.stderr.on('data', (d) => (err += String(d)));
    proc.on('error', (e) => reject(e));
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffprobe failed (${code}): ${err}`));
      const sec = Number(out.trim());
      if (!Number.isFinite(sec)) return reject(new Error(`ffprobe invalid duration: ${out}`));
      resolve(Math.max(0, Math.round(sec * 1000)));
    });
  });
}

function fallbackTiming(script: ScriptDraft, totalMs: number) {
  const weights = script.segments.map((seg) => Math.max(1, seg.text.trim().length));
  const weightSum = weights.reduce((a, b) => a + b, 0) || 1;
  const baseTotal = totalMs > 0 ? totalMs : weights.reduce((sum, w) => sum + Math.max(800, w * 60), 0);
  let cursor = 0;
  const segments: TtsSegmentTiming[] = [];
  for (let i = 0; i < script.segments.length; i++) {
    const seg = script.segments[i];
    const slice = Math.max(200, Math.round((weights[i] / weightSum) * baseTotal));
    const start = cursor;
    const end = i === script.segments.length - 1 ? baseTotal : Math.min(baseTotal, start + slice);
    segments.push({ id: seg.id, text: seg.text, start_ms: start, end_ms: end, moras: [] });
    cursor = end;
  }
  return {
    battle_id: script.battle_id,
    version: 1,
    segments,
    total_ms: Math.max(baseTotal, cursor),
  } as TtsTiming;
}

export function timepointsToTiming(script: ScriptDraft, timepoints: GoogleTimepoint[], audioDurationMs: number): TtsTiming {
  const markMap = new Map<string, number>();
  for (const tp of timepoints) {
    if (!tp?.markName) continue;
    markMap.set(tp.markName, Number(tp.timeSeconds));
  }

  const markNames = script.segments.map((seg) => `${seg.id}_start`);
  const endMark = 'end';

  const allPresent = markNames.every((m) => markMap.has(m)) && (markMap.has(endMark) || audioDurationMs > 0);
  if (!allPresent) {
    return fallbackTiming(script, audioDurationMs);
  }

  const startTimesMs = markNames.map((m) => Math.round((markMap.get(m) || 0) * 1000));
  const endMs = markMap.has(endMark) ? Math.round((markMap.get(endMark) || 0) * 1000) : audioDurationMs;

  const segments: TtsSegmentTiming[] = [];
  for (let i = 0; i < script.segments.length; i++) {
    const seg = script.segments[i];
    const prevEnd = segments.length ? segments[segments.length - 1].end_ms : 0;
    const start = Math.max(prevEnd, startTimesMs[i]);
    const nextStart = i < startTimesMs.length - 1 ? startTimesMs[i + 1] : endMs;
    const end = Math.max(start, nextStart);
    segments.push({
      id: seg.id,
      text: seg.text,
      start_ms: start,
      end_ms: end,
      moras: [],
    });
  }

  return {
    battle_id: script.battle_id,
    version: 1,
    segments,
    total_ms: Math.max(endMs, segments.at(-1)?.end_ms || 0),
  };
}

async function getAccessToken() {
  const auth = new GoogleAuth({ scopes: [GOOGLE_SCOPE] });
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  const token = typeof tokenResponse === 'string' ? tokenResponse : tokenResponse?.token;
  if (!token) throw new Error('Failed to obtain Google access token');
  return token;
}

export async function synthesizeGoogleTts(opts: {
  script: ScriptDraft;
  settings: ProjectSettings;
  outDir: string;
  logPath: string;
}): Promise<{ wavPath: string; mp3Path: string; timing: TtsTiming }> {
  const log = createStepLogger(opts.logPath);
  ensureDir(opts.outDir);

  const tts = opts.settings.tts.google;
  const { ssml } = buildSsmlWithMarks(opts.script, tts.ssml_mark_style);

  const buildRequestBody = (includeTimepoints: boolean) => {
    const body: any = {
      input: { ssml },
      voice: {
        languageCode: tts.language_code,
        name: tts.voice_name,
      },
      audioConfig: {
        audioEncoding: tts.audio_encoding,
        speakingRate: tts.speaking_rate,
        pitch: tts.pitch,
        volumeGainDb: tts.volume_gain_db,
        sampleRateHertz: tts.sample_rate_hertz,
      },
    };

    if (includeTimepoints) {
      body.enableTimePointing = ['SSML_MARK'];
    }

    return body;
  };

  log.info(`Google TTS request: voice=${tts.voice_name} lang=${tts.language_code} rate=${tts.speaking_rate} pitch=${tts.pitch}`);
  log.info(`Google TTS audio: encoding=${tts.audio_encoding} sampleRate=${tts.sample_rate_hertz} volumeGainDb=${tts.volume_gain_db}`);
  log.info(`Google TTS marks: enable=${tts.enable_timepoints} style=${tts.ssml_mark_style}`);

  const token = await getAccessToken();
  const postSynthesize = async (includeTimepoints: boolean) => {
    const url = includeTimepoints ? GOOGLE_TTS_URL_V1BETA1 : GOOGLE_TTS_URL_V1;
    const body = buildRequestBody(includeTimepoints);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const text = await res.text();
    if (!res.ok) {
      const err: any = new Error(`Google TTS error ${res.status}: ${text}`);
      err.status = res.status;
      err.body = text;
      throw err;
    }

    return JSON.parse(text);
  };

  let payload: any;
  try {
    payload = await postSynthesize(Boolean(tts.enable_timepoints));
  } catch (e: any) {
    const bodyText = String(e?.body ?? e?.message ?? '');
    const shouldRetry = Boolean(tts.enable_timepoints) && e?.status === 400 && /enableTimePointing/i.test(bodyText);
    if (!shouldRetry) throw e;
    log.warn('Google TTS: enableTimePointing was rejected by API; retrying without timepoints.');
    payload = await postSynthesize(false);
  }
  const audioContent = payload.audioContent;
  if (!audioContent) throw new Error('Google TTS response missing audioContent');

  const buffer = Buffer.from(audioContent, 'base64');
  const wavPath = path.join(opts.outDir, 'tts.wav');
  const mp3Path = path.join(opts.outDir, 'tts.mp3');

  const timepoints: GoogleTimepoint[] = Array.isArray(payload.timepoints) ? payload.timepoints : [];

  if (tts.audio_encoding === 'LINEAR16') {
    // Some voices / API variants may ignore sampleRateHertz for LINEAR16.
    // If timepoints are present, infer the actual sample rate from (bytes, duration) to avoid fast playback.
    let sampleRateForWav = tts.sample_rate_hertz;
    const inferred = inferSampleRateFromTimepoints(buffer.length, timepoints);
    if (inferred && inferred !== sampleRateForWav) {
      log.warn(`Google TTS: inferred sample rate ${inferred}Hz (configured ${sampleRateForWav}Hz); using inferred for WAV header`);
      sampleRateForWav = inferred;
    }
    writeLinear16Wav(wavPath, buffer, sampleRateForWav);
    await convertAudio(wavPath, mp3Path, log);
  } else {
    fs.writeFileSync(mp3Path, buffer);
    await convertAudio(mp3Path, wavPath, log);
  }

  let durationMs = 0;
  try {
    durationMs = await probeDurationMs(wavPath);
  } catch {
    durationMs = 0;
  }

  const timing = timepointsToTiming(opts.script, timepoints, durationMs);

  log.info(`Google TTS timing segments: ${timing.segments.length} total_ms=${timing.total_ms}`);

  return { wavPath, mp3Path, timing };
}

export async function googleAuthCheck() {
  const token = await getAccessToken();
  return Boolean(token);
}

export async function listGoogleVoices(languageCode?: string): Promise<GoogleVoiceInfo[]> {
  const token = await getAccessToken();
  const url = new URL('https://texttospeech.googleapis.com/v1/voices');
  if (languageCode && languageCode !== 'all') {
    url.searchParams.set('languageCode', languageCode);
  }
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google TTS voices error ${res.status}: ${text}`);
  }
  const payload = await res.json();
  const voices = Array.isArray(payload.voices) ? payload.voices : [];
  return voices.map((voice: any) => ({
    name: String(voice.name || ''),
    languageCodes: Array.isArray(voice.languageCodes) ? voice.languageCodes.map((c: any) => String(c)) : [],
    ssmlGender: voice.ssmlGender ? String(voice.ssmlGender) : undefined,
    naturalSampleRateHertz: voice.naturalSampleRateHertz ? Number(voice.naturalSampleRateHertz) : undefined,
  }));
}
