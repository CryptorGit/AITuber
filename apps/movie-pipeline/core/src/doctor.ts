import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { GoogleAuth } from 'google-auth-library';
import { assetsRoot, bgmRoot, charactersRoot } from './paths.ts';
import { defaultProjectSettings } from './config.ts';
import type { DoctorStatus, ProjectSettings } from './types.ts';

async function checkCommand(cmd: string, args: string[]) {
  return new Promise<boolean>((resolve) => {
    const proc = spawn(cmd, args, { stdio: 'ignore' });
    proc.on('error', () => resolve(false));
    proc.on('close', (code) => resolve(code === 0));
  });
}

async function checkVoicevox(baseUrl: string) {
  try {
    const res = await fetch(new URL('/version', baseUrl).toString());
    if (!res.ok) return false;
    return true;
  } catch {
    return false;
  }
}

async function getGoogleAccessToken() {
  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  const token = typeof tokenResponse === 'string' ? tokenResponse : tokenResponse?.token;
  if (!token) throw new Error('Missing Google access token');
  return token;
}

async function checkGoogleTts(settings: ProjectSettings) {
  const token = await getGoogleAccessToken();
  const voice = settings.tts.google;
  const res = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      input: { text: 'doctor check' },
      voice: { languageCode: voice.language_code, name: voice.voice_name },
      audioConfig: { audioEncoding: voice.audio_encoding, speakingRate: voice.speaking_rate },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google TTS error ${res.status}: ${text}`);
  }
  return true;
}

export async function doctor(settings?: ProjectSettings): Promise<DoctorStatus[]> {
  const statuses: DoctorStatus[] = [];
  const effective = settings || defaultProjectSettings();

  const ffmpegOk = await checkCommand('ffmpeg', ['-version']);
  statuses.push({ name: 'ffmpeg', ok: ffmpegOk, message: ffmpegOk ? 'ffmpeg available' : 'ffmpeg not found in PATH' });

  const ffprobeOk = await checkCommand('ffprobe', ['-version']);
  statuses.push({ name: 'ffprobe', ok: ffprobeOk, message: ffprobeOk ? 'ffprobe available' : 'ffprobe not found in PATH' });

  let playwrightOk = true;
  try {
    await import('playwright');
  } catch {
    playwrightOk = false;
  }
  statuses.push({
    name: 'playwright',
    ok: playwrightOk,
    message: playwrightOk ? 'playwright module available' : 'playwright not installed (run npm install in apps/movie-pipeline/core)',
  });

  const provider = effective.tts.provider || 'google';

  if (provider === 'google') {
    try {
      await getGoogleAccessToken();
      statuses.push({ name: 'gcp_auth', ok: true, message: 'Google ADC token acquired' });
    } catch (e: any) {
      statuses.push({ name: 'gcp_auth', ok: false, message: String(e?.message ?? e) });
    }

    try {
      await checkGoogleTts(effective);
      statuses.push({ name: 'google_tts', ok: true, message: 'Google TTS reachable' });
    } catch (e: any) {
      statuses.push({ name: 'google_tts', ok: false, message: String(e?.message ?? e) });
    }
  } else {
    const baseUrl = effective.tts.voicevox.base_url || 'http://127.0.0.1:50021';
    const voicevoxOk = await checkVoicevox(baseUrl);
    statuses.push({
      name: 'voicevox',
      ok: voicevoxOk,
      message: voicevoxOk ? `VOICEVOX ok (${baseUrl})` : `VOICEVOX unavailable (${baseUrl})`,
    });
    statuses.push({ name: 'gcp_auth', ok: true, message: 'skipped (provider voicevox)' });
    statuses.push({ name: 'google_tts', ok: true, message: 'skipped (provider voicevox)' });
  }

  const assetsOk = fs.existsSync(assetsRoot());
  statuses.push({ name: 'assets', ok: assetsOk, message: assetsOk ? assetsRoot() : `Missing assets root: ${assetsRoot()}` });

  const bgmOk = fs.existsSync(bgmRoot());
  statuses.push({ name: 'bgm', ok: bgmOk, message: bgmOk ? bgmRoot() : `Missing BGM root: ${bgmRoot()}` });

  const charsOk = fs.existsSync(charactersRoot());
  statuses.push({ name: 'characters', ok: charsOk, message: charsOk ? charactersRoot() : `Missing characters root: ${charactersRoot()}` });

  return statuses;
}
