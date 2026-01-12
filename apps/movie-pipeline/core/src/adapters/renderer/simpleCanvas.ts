import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import type { ScriptTimed, TtsTiming, LipSyncTimeline, ProjectSettings } from '../../types.ts';
import { ensureDir } from '../../paths.ts';
import { createStepLogger } from '../../utils/logger.ts';

function rendererHtml() {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    html, body { margin: 0; padding: 0; overflow: hidden; background: transparent; }
    canvas { display: block; }
  </style>
</head>
<body>
  <canvas id="stage"></canvas>
  <audio id="audio"></audio>
  <script>
    const config = window.__MP_CONFIG__;
    const canvas = document.getElementById('stage');
    const ctx = canvas.getContext('2d');
    canvas.width = config.width;
    canvas.height = config.height;

    const audio = document.getElementById('audio');
    audio.src = config.audio_url;
    audio.crossOrigin = 'anonymous';

    const lipPoints = [];
    let lastMs = 0;

    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    const source = audioCtx.createMediaElementSource(audio);
    source.connect(analyser);
    analyser.connect(audioCtx.destination);
    const data = new Uint8Array(analyser.fftSize);

    function currentSegment(ms) {
      const segs = config.script.segments || [];
      for (const seg of segs) {
        if (ms >= seg.start_ms && ms <= seg.end_ms) return seg;
      }
      return null;
    }

    function drawFrame(open, seg, ms) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = config.chroma_key;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const centerX = canvas.width * 0.5;
      const centerY = canvas.height * 0.55;
      const bob = Math.sin(ms / 300) * 4;
      const headRadius = canvas.width * 0.18;
      const bodyColor = config.avatar.body_color;
      const accentColor = config.avatar.accent_color;
      const mouthColor = config.avatar.mouth_color;

      ctx.fillStyle = bodyColor;
      ctx.beginPath();
      ctx.arc(centerX, centerY + bob, headRadius, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = accentColor;
      ctx.beginPath();
      ctx.arc(centerX - headRadius * 0.5, centerY - headRadius * 0.4 + bob, headRadius * 0.18, 0, Math.PI * 2);
      ctx.arc(centerX + headRadius * 0.5, centerY - headRadius * 0.4 + bob, headRadius * 0.18, 0, Math.PI * 2);
      ctx.fill();

      const mouthWidth = headRadius * 0.7;
      const mouthHeight = Math.max(4, headRadius * 0.15 * open);
      ctx.fillStyle = mouthColor;
      ctx.fillRect(centerX - mouthWidth / 2, centerY + headRadius * 0.25 + bob, mouthWidth, mouthHeight);

      if (seg) {
        ctx.fillStyle = '#ffffff';
        ctx.font = `${Math.round(canvas.width * 0.04)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(seg.emotion_tag || 'neutral', centerX, centerY - headRadius - 20 + bob);
      }
    }

    function update() {
      const ms = Math.round(audio.currentTime * 1000);
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      const open = Math.min(1, Math.max(0.05, rms * 4));

      if (ms !== lastMs) {
        lipPoints.push({ t_ms: ms, open });
        lastMs = ms;
      }

      drawFrame(open, currentSegment(ms), ms);
      if (!audio.paused) {
        requestAnimationFrame(update);
      }
    }

    audio.addEventListener('play', () => {
      audioCtx.resume();
      requestAnimationFrame(update);
    });

    audio.addEventListener('ended', () => {
      window.__MP_LIP_SYNC__ = lipPoints;
      window.__MP_DONE__ = true;
    });

    window.__MP_START__ = async () => {
      await audio.play();
    };
  </script>
</body>
</html>`;
}

export async function renderSimpleCanvas(opts: {
  script: ScriptTimed;
  timing: TtsTiming;
  audioPath: string;
  outputWebm: string;
  logPath: string;
  settings: ProjectSettings;
  chromaKey: string;
  avatar?: { body_color: string; accent_color: string; mouth_color: string };
}) {
  const log = createStepLogger(opts.logPath);
  ensureDir(path.dirname(opts.outputWebm));
  const tmpDir = path.join(path.dirname(opts.outputWebm), `tmp_render_${Date.now()}`);
  ensureDir(tmpDir);

  const audioUrl = pathToFileURL(opts.audioPath).toString();

  const config = {
    width: opts.settings.render.width,
    height: opts.settings.render.height,
    fps: opts.settings.render.fps,
    chroma_key: opts.chromaKey,
    avatar: opts.avatar || {
      body_color: '#242424',
      accent_color: '#ff7a59',
      mouth_color: '#ffffff',
    },
    script: opts.script,
    audio_url: audioUrl,
  };

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--allow-file-access-from-files',
      '--disable-web-security',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });

  const context = await browser.newContext({
    viewport: { width: config.width, height: config.height },
    recordVideo: { dir: tmpDir, size: { width: config.width, height: config.height } },
  });

  const page = await context.newPage();
  await page.addInitScript(`window.__MP_CONFIG__ = ${JSON.stringify(config)};`);
  await page.setContent(rendererHtml(), { waitUntil: 'load' });

  await page.evaluate(() => (window as any).__MP_START__());
  const totalMs = opts.timing.total_ms + 1000;
  try {
    await page.waitForFunction(() => (window as any).__MP_DONE__ === true, undefined, { timeout: totalMs + 2000 });
  } catch {
    await page.waitForTimeout(totalMs);
  }

  const lipPoints = await page.evaluate(() => (window as any).__MP_LIP_SYNC__ || []);
  await context.close();
  await browser.close();

  const videoFiles = fs.readdirSync(tmpDir).filter((f) => f.endsWith('.webm'));
  if (!videoFiles.length) {
    throw new Error('No recorded webm produced by renderer');
  }
  const recorded = path.join(tmpDir, videoFiles[0]);
  fs.copyFileSync(recorded, opts.outputWebm);

  const lipSync: LipSyncTimeline = {
    battle_id: opts.script.battle_id,
    version: 1,
    points: lipPoints,
  };

  log.info(`Renderer produced ${opts.outputWebm}`);
  return { lipSync };
}
