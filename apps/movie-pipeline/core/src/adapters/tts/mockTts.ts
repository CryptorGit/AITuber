import path from 'node:path';
import { createStepLogger } from '../../utils/logger.ts';
import { ensureDir } from '../../paths.ts';
import type { ProjectSettings, ScriptDraft, TtsTiming, TtsSegmentTiming } from '../../types.ts';
import { probeDurationSec, runFfmpeg, wavToMp3 } from '../../pipeline/ffmpeg.ts';

export async function synthesizeMockTts(opts: {
  script: ScriptDraft;
  settings: ProjectSettings;
  outDir: string;
  logPath: string;
}): Promise<{ wavPath: string; mp3Path: string; timing: TtsTiming }> {
  const log = createStepLogger(opts.logPath);
  ensureDir(opts.outDir);

  const hz = opts.settings.tts.mock.tone_hz;
  const sr = opts.settings.tts.mock.sample_rate_hz;

  // Generate a deterministic synthetic tone; step runner will fit to timeline duration later.
  const approxSec = Math.max(
    0.8,
    opts.script.segments.reduce((sum, seg) => sum + Math.max(0.35, seg.text.trim().length / 20), 0)
  );

  const wavPath = path.join(opts.outDir, 'tts.wav');
  const mp3Path = path.join(opts.outDir, 'tts.mp3');

  log.info(`Mock TTS: tone_hz=${hz} sample_rate=${sr} approxSec=${approxSec.toFixed(3)}`);
  await runFfmpeg(
    ['-y', '-f', 'lavfi', '-i', `sine=frequency=${hz}:sample_rate=${sr}:duration=${approxSec}`, '-c:a', 'pcm_s16le', wavPath],
    log
  );
  await wavToMp3({ inWav: wavPath, outMp3: mp3Path, log });

  const totalSec = await probeDurationSec(wavPath);
  const totalMs = Math.max(0, Math.round(totalSec * 1000));

  const segCount = Math.max(1, opts.script.segments.length);
  const slice = Math.max(50, Math.floor(totalMs / segCount));
  const segments: TtsSegmentTiming[] = [];
  let cursor = 0;
  for (let i = 0; i < opts.script.segments.length; i++) {
    const seg = opts.script.segments[i];
    const start = cursor;
    const end = i === opts.script.segments.length - 1 ? totalMs : Math.min(totalMs, start + slice);
    segments.push({ id: seg.id, text: seg.text, start_ms: start, end_ms: end, moras: [] });
    cursor = end;
  }

  const timing: TtsTiming = {
    battle_id: opts.script.battle_id,
    version: 1,
    segments,
    total_ms: totalMs,
  };

  return { wavPath, mp3Path, timing };
}
