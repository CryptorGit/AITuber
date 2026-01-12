import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import type { StepLogger } from './logger.ts';

function resolveBinary(name: string, envVar: string) {
  const fromEnv = process.env[envVar];
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  return name;
}

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
      reject(new Error(`Command failed (${code}): ${stderr.slice(-2000)}`));
    });
  });
}

export function ffmpegBin() {
  return resolveBinary('ffmpeg', 'FFMPEG_PATH');
}

export function ffprobeBin() {
  return resolveBinary('ffprobe', 'FFPROBE_PATH');
}

export async function probeDurationMs(filePath: string): Promise<number> {
  const bin = ffprobeBin();
  return new Promise((resolve, reject) => {
    const args = ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', filePath];
    const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => (out += String(d)));
    proc.stderr.on('data', (d) => (err += String(d)));
    proc.on('error', (e) => reject(e));
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffprobe failed (${code}): ${err}`));
      const sec = Number(String(out).trim());
      if (!Number.isFinite(sec)) return reject(new Error(`ffprobe invalid duration: ${out}`));
      resolve(Math.max(0, Math.round(sec * 1000)));
    });
  });
}

export async function generateToneMp3(outputPath: string, durationMs: number, log?: StepLogger) {
  const bin = ffmpegBin();
  const sec = Math.max(0.1, durationMs / 1000);
  const args = [
    '-y',
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=440:duration=${sec}`,
    '-q:a',
    '6',
    '-acodec',
    'libmp3lame',
    outputPath,
  ];
  await runCommand(bin, args, log);
}

export async function convertMp3ToWav(inputMp3: string, outputWav: string, log?: StepLogger) {
  const bin = ffmpegBin();
  const args = ['-y', '-i', inputMp3, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', outputWav];
  await runCommand(bin, args, log);
}

export async function generateOverlayStub(
  outputPath: string,
  durationMs: number,
  width: number,
  height: number,
  log?: StepLogger
) {
  const bin = ffmpegBin();
  const sec = Math.max(0.1, durationMs / 1000);
  const filter = `drawbox=x=0:y=0:w=${width}:h=${height}:color=green@0.35:t=fill,format=yuva420p`;
  const args = [
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=c=black@0.0:s=${width}x${height}:r=30:d=${sec}`,
    '-vf',
    filter,
    '-c:v',
    'libvpx-vp9',
    '-pix_fmt',
    'yuva420p',
    '-auto-alt-ref',
    '0',
    outputPath,
  ];
  await runCommand(bin, args, log);
}

function escapeFilterPath(p: string) {
  const normalized = path.resolve(p).replace(/\\/g, '/');
  return normalized.replace(/:/g, '\\:').replace(/'/g, "\\'");
}

export async function composeFinalMp4(opts: {
  baseMp4: string;
  overlayVideo?: string | null;
  ttsMp3: string;
  bgmMp3?: string | null;
  subtitlesAss: string;
  outputMp4: string;
  overlayX?: string;
  overlayY?: string;
  log?: StepLogger;
}) {
  const bin = ffmpegBin();
  const args: string[] = ['-y', '-i', opts.baseMp4];
  if (opts.overlayVideo) args.push('-i', opts.overlayVideo);
  args.push('-i', opts.ttsMp3);
  if (opts.bgmMp3) args.push('-i', opts.bgmMp3);

  const overlayX = opts.overlayX ?? 'W-w-48';
  const overlayY = opts.overlayY ?? 'H-h-48';
  const subsPath = escapeFilterPath(opts.subtitlesAss);

  const filters: string[] = [];
  let videoLabel = '[v0]';
  if (opts.overlayVideo) {
    filters.push(`[0:v][1:v]overlay=${overlayX}:${overlayY}:format=auto${videoLabel}`);
  } else {
    filters.push(`[0:v]null${videoLabel}`);
  }
  filters.push(`${videoLabel}subtitles='${subsPath}'[v]`);

  const audioFilters: string[] = [];
  const ttsIndex = opts.overlayVideo ? 2 : 1;
  if (opts.bgmMp3) {
    const bgmIndex = opts.overlayVideo ? 3 : 2;
    audioFilters.push(`[${ttsIndex}:a]volume=1.0[a_tts]`);
    audioFilters.push(`[${bgmIndex}:a]volume=0.25[a_bgm]`);
    audioFilters.push('[a_tts][a_bgm]amix=inputs=2:duration=first:dropout_transition=2[a]');
  } else {
    audioFilters.push(`[${ttsIndex}:a]anull[a]`);
  }

  const filterComplex = [...filters, ...audioFilters].join(';');

  args.push(
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
    opts.outputMp4
  );

  await runCommand(bin, args, opts.log);
}

export function fileExists(p: string | null | undefined) {
  if (!p) return false;
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}
