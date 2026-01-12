import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { ScriptDraft, TtsTiming, TtsSegmentTiming } from '../../types.ts';
import type { ProjectSettings } from '../../types.ts';
import { ensureDir } from '../../paths.ts';
import { hashString } from '../../utils/hash.ts';
import { createStepLogger } from '../../utils/logger.ts';

function voicevoxUrl(base: string, pathPart: string, query?: Record<string, string | number | boolean>) {
  const url = new URL(pathPart, base);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

async function voicevoxJson(url: string, opts: RequestInit) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`VOICEVOX ${res.status}: ${text}`);
  }
  return res.json();
}

async function voicevoxBinary(url: string, body: any) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`VOICEVOX ${res.status}: ${text}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

function buildMoraTimings(query: any) {
  const timings: Array<{ text: string; start_ms: number; end_ms: number; consonant?: string | null; vowel?: string | null }> = [];
  let cursor = 0;

  const pre = Number(query?.prePhonemeLength ?? 0);
  const post = Number(query?.postPhonemeLength ?? 0);
  if (Number.isFinite(pre)) cursor += pre * 1000;

  const phrases = Array.isArray(query?.accent_phrases) ? query.accent_phrases : [];
  for (const phrase of phrases) {
    const moras = Array.isArray(phrase?.moras) ? phrase.moras : [];
    for (const mora of moras) {
      const consonant = mora?.consonant ?? null;
      const vowel = mora?.vowel ?? null;
      const consonantLength = Number(mora?.consonant_length ?? 0) || 0;
      const vowelLength = Number(mora?.vowel_length ?? 0) || 0;
      const start = cursor;
      cursor += (consonantLength + vowelLength) * 1000;
      timings.push({ text: mora?.text ?? '', start_ms: Math.round(start), end_ms: Math.round(cursor), consonant, vowel });
    }
    if (phrase?.pause_mora) {
      const mora = phrase.pause_mora;
      const vowelLength = Number(mora?.vowel_length ?? 0) || 0;
      const start = cursor;
      cursor += vowelLength * 1000;
      timings.push({ text: mora?.text ?? 'pause', start_ms: Math.round(start), end_ms: Math.round(cursor) });
    }
  }

  if (Number.isFinite(post)) cursor += post * 1000;
  return { timings, totalMs: Math.round(cursor) };
}

async function convertWavToMp3(inputWav: string, outputMp3: string, log?: ReturnType<typeof createStepLogger>) {
  const args = ['-y', '-i', inputWav, '-codec:a', 'libmp3lame', '-q:a', '4', outputMp3];
  await runFfmpeg(args, log);
}

async function concatWavFiles(inputs: string[], outputWav: string, log?: ReturnType<typeof createStepLogger>) {
  const listPath = path.join(path.dirname(outputWav), 'concat_list.txt');
  const lines = inputs.map((p) => `file '${p.replace(/'/g, "'\\''")}'`);
  fs.writeFileSync(listPath, lines.join('\n'), 'utf8');
  const args = ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outputWav];
  await runFfmpeg(args, log);
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

export async function synthesizeVoicevox(opts: {
  script: ScriptDraft;
  settings: ProjectSettings;
  outDir: string;
  logPath: string;
}): Promise<{ wavPath: string; mp3Path: string; timing: TtsTiming }> {
  const log = createStepLogger(opts.logPath);
  ensureDir(opts.outDir);

  const segments = opts.script.segments;
  if (!segments.length) throw new Error('Script has no segments');

  const segmentFiles: string[] = [];
  const timingSegments: TtsSegmentTiming[] = [];
  let cursor = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const text = seg.text.trim() || '...';

    const queryUrl = voicevoxUrl(opts.settings.tts.voicevox.base_url, '/audio_query', {
      text,
      speaker: opts.settings.tts.voicevox.speaker,
    });
    const query = await voicevoxJson(queryUrl, { method: 'POST' });

    query.speedScale = opts.settings.tts.voicevox.speed_scale;
    query.pitchScale = opts.settings.tts.voicevox.pitch_scale;
    query.intonationScale = opts.settings.tts.voicevox.intonation_scale;
    query.volumeScale = opts.settings.tts.voicevox.volume_scale;
    query.prePhonemeLength = opts.settings.tts.voicevox.pre_phoneme_length;
    query.postPhonemeLength = opts.settings.tts.voicevox.post_phoneme_length;

    const { timings, totalMs } = buildMoraTimings(query);
    const synthUrl = voicevoxUrl(opts.settings.tts.voicevox.base_url, '/synthesis', {
      speaker: opts.settings.tts.voicevox.speaker,
      enable_interrogative_upspeak: true,
    });
    const audio = await voicevoxBinary(synthUrl, query);

    const segFile = path.join(opts.outDir, `seg_${String(i + 1).padStart(3, '0')}.wav`);
    fs.writeFileSync(segFile, audio);
    segmentFiles.push(segFile);

    const startMs = cursor;
    const endMs = cursor + totalMs;
    timingSegments.push({
      id: seg.id,
      text: seg.text,
      start_ms: startMs,
      end_ms: endMs,
      moras: timings.map((m) => ({
        ...m,
        start_ms: m.start_ms + startMs,
        end_ms: m.end_ms + startMs,
      })),
    });
    cursor = endMs;

    log.info(`TTS segment ${seg.id}: ${totalMs} ms`);
  }

  const wavPath = path.join(opts.outDir, 'tts.wav');
  const mp3Path = path.join(opts.outDir, 'tts.mp3');
  await concatWavFiles(segmentFiles, wavPath, log);
  await convertWavToMp3(wavPath, mp3Path, log);

  const timing: TtsTiming = {
    battle_id: opts.script.battle_id,
    version: 1,
    segments: timingSegments,
    total_ms: cursor,
  };

  log.info(`TTS total duration: ${cursor} ms`);

  return { wavPath, mp3Path, timing };
}

export async function ttsInputHash(script: ScriptDraft, settings: ProjectSettings) {
  return hashString(JSON.stringify({ script, settings: settings.tts }));
}
