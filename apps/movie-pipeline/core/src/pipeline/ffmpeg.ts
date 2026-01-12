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
    audioFilters.push(`[${ttsIndex}:a]volume=${opts.tts_volume}[a_tts]`);
    audioFilters.push(`[${bgmIndex}:a]volume=${opts.bgm_volume}[a_bgm]`);
    if (opts.ducking) {
      audioFilters.push('[a_bgm][a_tts]sidechaincompress=threshold=0.02:ratio=8:attack=5:release=200[a_bgm_duck]');
      audioFilters.push('[a_tts][a_bgm_duck]amix=inputs=2:duration=first:dropout_transition=2[a]');
    } else {
      audioFilters.push('[a_tts][a_bgm]amix=inputs=2:duration=first:dropout_transition=2[a]');
    }
  } else {
    audioFilters.push(`[${ttsIndex}:a]volume=${opts.tts_volume}[a]`);
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
