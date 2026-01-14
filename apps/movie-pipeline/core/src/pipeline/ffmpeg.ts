import path from 'node:path';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import type { StepLogger } from '../utils/logger.ts';

export type ComposeOptions = {
  base_mp4: string;
  overlay?: {
    path: string;
    chroma_key?: string;
    scale?: number;
    x: string;
    y: string;
  } | null;
  tts_audio: string;
  bgm_audio?: string | null;
  subtitles_ass?: string | null;
  output_mp4: string;
  output_with_subs_mp4?: string | null;
  tts_volume: number;
  bgm_volume: number;
  ducking: boolean;
  log?: StepLogger;
};

function runCommand(bin: string, args: string[], log?: StepLogger) {
  return new Promise<void>((resolve, reject) => {
    const cmdLine = `${bin} ${args.join(' ')}`;
    if (log) log.info(`cmd: ${cmdLine}`);
    const proc = spawn(bin, args, { stdio: 'pipe' });
    let stderr = '';
    proc.stderr.on('data', (d) => {
      const text = String(d);
      stderr += text;
      if (log) log.info(text.trimEnd());
    });
    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`ffmpeg failed (${code}): ${stderr.slice(-2000)}`));
    });
  });
}

export function runFfmpeg(args: string[], log?: StepLogger) {
  return runCommand('ffmpeg', args, log);
}

export async function probeDurationSec(filePath: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    if (!fs.existsSync(filePath)) return reject(new Error(`Missing file: ${filePath}`));
    const proc = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nk=1:nw=1', filePath]);
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => (out += String(d)));
    proc.stderr.on('data', (d) => (err += String(d)));
    proc.on('error', (e) => reject(e));
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffprobe failed (${code}): ${err}`));
      const dur = Number(out.trim());
      if (!Number.isFinite(dur)) return reject(new Error(`ffprobe invalid duration: ${out}`));
      resolve(dur);
    });
  });
}

export async function generateSilentWav(opts: { outWav: string; durationSec: number; sampleRate?: number; channels?: number; log?: StepLogger }) {
  const sr = opts.sampleRate ?? 48000;
  const ch = opts.channels ?? 1;
  const dur = Math.max(0.05, opts.durationSec);
  await runFfmpeg(
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      `anullsrc=r=${sr}:cl=${ch === 1 ? 'mono' : 'stereo'}`,
      '-t',
      String(dur),
      '-c:a',
      'pcm_s16le',
      opts.outWav,
    ],
    opts.log
  );
}

export async function wavToMp3(opts: { inWav: string; outMp3: string; log?: StepLogger }) {
  await runFfmpeg(['-y', '-i', opts.inWav, '-c:a', 'libmp3lame', '-q:a', '4', opts.outMp3], opts.log);
}

export async function fitWavToDuration(opts: { inWav: string; outWav: string; targetSec: number; log?: StepLogger }) {
  const target = Math.max(0.05, opts.targetSec);
  const current = await probeDurationSec(opts.inWav);
  if (!Number.isFinite(current) || current <= 0) {
    throw new Error(`invalid input wav duration: ${current}`);
  }

  // atempo supports 0.5..2.0; chain if needed.
  const desiredTempo = current / target;
  const tempos: number[] = [];
  let remaining = desiredTempo;
  while (remaining > 2.0) {
    tempos.push(2.0);
    remaining /= 2.0;
  }
  while (remaining < 0.5) {
    tempos.push(0.5);
    remaining /= 0.5;
  }
  tempos.push(remaining);

  const atempo = tempos.map((t) => `atempo=${t.toFixed(6)}`).join(',');
  const filter = `${atempo},apad,atrim=0:${target.toFixed(6)}`;

  await runFfmpeg(['-y', '-i', opts.inWav, '-filter:a', filter, '-c:a', 'pcm_s16le', opts.outWav], opts.log);
}

export async function concatWavs(opts: { inputs: string[]; outWav: string; log?: StepLogger }) {
  if (!opts.inputs.length) throw new Error('concatWavs: no inputs');

  // Use concat demuxer for robustness.
  const listPath = `${opts.outWav}.concat.txt`;
  const lines = opts.inputs.map((p) => `file '${path.resolve(p).replace(/'/g, "'\\''")}'`).join('\n');
  fs.writeFileSync(listPath, lines, 'utf8');

  await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c:a', 'pcm_s16le', opts.outWav], opts.log);
}

function escapeFilterPath(p: string) {
  const normalized = path.resolve(p).replace(/\\/g, '/');
  return normalized.replace(/:/g, '\\:').replace(/'/g, "\\'");
}

export function buildFilterComplex(opts: ComposeOptions, burnSubtitles: boolean) {
  const filters: string[] = [];
  const audioFilters: string[] = [];

  let videoLabel = '[v0]';
  if (opts.overlay) {
    const overlayInput = '[1:v]';
    const overlayLabel = '[ov]';
    const scale = opts.overlay.scale && opts.overlay.scale !== 1 ? `scale=iw*${opts.overlay.scale}:ih*${opts.overlay.scale}` : null;
    const chroma = opts.overlay.chroma_key
      ? `chromakey=${opts.overlay.chroma_key.replace('#', '0x')}:0.2:0.1`
      : null;
    const overlayFilters = [scale, chroma].filter(Boolean).join(',');
    if (overlayFilters) {
      filters.push(`${overlayInput}${overlayFilters}${overlayLabel}`);
    } else {
      filters.push(`${overlayInput}null${overlayLabel}`);
    }
    filters.push(`[0:v]${overlayLabel}overlay=${opts.overlay.x}:${opts.overlay.y}:format=auto${videoLabel}`);
  } else {
    filters.push(`[0:v]null${videoLabel}`);
  }

  if (burnSubtitles && opts.subtitles_ass) {
    const subPath = escapeFilterPath(opts.subtitles_ass);
    filters.push(`${videoLabel}subtitles='${subPath}'[v]`);
  } else {
    filters.push(`${videoLabel}null[v]`);
  }

  const ttsIndex = opts.overlay ? 2 : 1;
  if (opts.bgm_audio) {
    const bgmIndex = opts.overlay ? 3 : 2;
    audioFilters.push(`[${ttsIndex}:a:0]volume=${opts.tts_volume}[a_tts]`);
    audioFilters.push(`[${bgmIndex}:a:0]volume=${opts.bgm_volume}[a_bgm]`);
    if (opts.ducking) {
      audioFilters.push('[a_tts]asplit=2[a_tts_sc][a_tts_mix]');
      audioFilters.push('[a_bgm][a_tts_sc]sidechaincompress=threshold=0.02:ratio=8:attack=5:release=200[a_bgm_duck]');
      audioFilters.push('[a_tts_mix][a_bgm_duck]amix=inputs=2:duration=first:dropout_transition=2[a]');
    } else {
      audioFilters.push('[a_tts][a_bgm]amix=inputs=2:duration=first:dropout_transition=2[a]');
    }
  } else {
    audioFilters.push(`[${ttsIndex}:a:0]volume=${opts.tts_volume}[a]`);
  }

  return [...filters, ...audioFilters].join(';');
}

export async function composeFinalMp4(opts: ComposeOptions) {
  const baseArgs: string[] = ['-y', '-i', opts.base_mp4];
  if (opts.overlay) baseArgs.push('-i', opts.overlay.path);
  baseArgs.push('-i', opts.tts_audio);
  if (opts.bgm_audio) baseArgs.push('-i', opts.bgm_audio);

  const filterComplex = buildFilterComplex(opts, false);
  const args = baseArgs.concat([
    '-filter_complex',
    filterComplex,
    '-map',
    '[v]',
    '-map',
    '[a]',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-shortest',
    '-movflags',
    '+faststart',
    opts.output_mp4,
  ]);

  await runCommand('ffmpeg', args, opts.log);

  if (opts.output_with_subs_mp4 && opts.subtitles_ass) {
    const subsFilter = buildFilterComplex(opts, true);
    const subArgs = baseArgs.concat([
      '-filter_complex',
      subsFilter,
      '-map',
      '[v]',
      '-map',
      '[a]',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-shortest',
      '-movflags',
      '+faststart',
      opts.output_with_subs_mp4,
    ]);
    await runCommand('ffmpeg', subArgs, opts.log);
  }
}

export async function probeFile(filePath: string) {
  return new Promise<void>((resolve, reject) => {
    if (!fs.existsSync(filePath)) return reject(new Error(`Missing file: ${filePath}`));
    const proc = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nk=1:nw=1', filePath]);
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => (out += String(d)));
    proc.stderr.on('data', (d) => (err += String(d)));
    proc.on('error', (e) => reject(e));
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffprobe failed (${code}): ${err}`));
      const dur = Number(out.trim());
      if (!Number.isFinite(dur)) return reject(new Error(`ffprobe invalid duration: ${out}`));
      resolve();
    });
  });
}
