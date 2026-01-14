import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import type { ScriptTimed, TtsTiming, LipSyncTimeline, ProjectSettings } from '../../types.ts';
import { ensureDir } from '../../paths.ts';
import { createStepLogger } from '../../utils/logger.ts';
import { runFfmpeg } from '../../pipeline/ffmpeg.ts';

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
  <script>
    // Always define these so the Node side can query status even if boot fails.
    window.__MP_DONE__ = false;
    window.__MP_LIP_SYNC__ = [];
    window.__MP_BOOT_ERROR__ = null;
    window.__MP_START__ = async () => {
      try {
        const config = window.__MP_CONFIG__;
        const canvas = document.getElementById('stage');
        const ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
        if (!config) throw new Error('Missing window.__MP_CONFIG__');
        if (!canvas || !ctx) throw new Error('Canvas 2D context unavailable');
        canvas.width = config.width;
        canvas.height = config.height;

        const lipPoints = [];
        let lastMs = 0;

        // Headless-safe renderer: drive animation purely from an internal clock.
        // Audio is mixed later in ffmpeg, so we don't need to play it here.
        const totalMs = Math.max(0, Number(config.total_ms || 0));
        const startedAt = performance.now();

      function currentSegment(ms) {
        const segs = (config.script && config.script.segments) ? config.script.segments : [];
        for (const seg of segs) {
          if (ms >= seg.start_ms && ms <= seg.end_ms) return seg;
        }
        return null;
      }

      function drawFrame(open, seg, ms) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = config.chroma_key;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Spec-ish layout: 16:9 canvas, avatar bottom-left, upper-body visible.
      const bob = Math.sin(ms / 300) * 3;
      const headRadius = Math.min(canvas.width, canvas.height) * 0.16;
      const headX = canvas.width * 0.18;
      const headY = canvas.height * 0.78;
      const bodyColor = config.avatar.body_color;
      const accentColor = config.avatar.accent_color;
      const mouthColor = config.avatar.mouth_color;

      // Torso (extends below bottom so only upper part shows)
      ctx.fillStyle = bodyColor;
      const torsoW = headRadius * 2.0;
      const torsoH = headRadius * 2.4;
      ctx.fillRect(headX - torsoW * 0.55, headY + headRadius * 0.65 + bob, torsoW, torsoH);

      ctx.fillStyle = bodyColor;
      ctx.beginPath();
      ctx.arc(headX, headY + bob, headRadius, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = accentColor;
      ctx.beginPath();
      ctx.arc(headX - headRadius * 0.45, headY - headRadius * 0.35 + bob, headRadius * 0.18, 0, Math.PI * 2);
      ctx.arc(headX + headRadius * 0.45, headY - headRadius * 0.35 + bob, headRadius * 0.18, 0, Math.PI * 2);
      ctx.fill();

      const mouthWidth = headRadius * 0.7;
      const mouthHeight = Math.max(4, headRadius * 0.15 * open);
      ctx.fillStyle = mouthColor;
      ctx.fillRect(headX - mouthWidth / 2, headY + headRadius * 0.25 + bob, mouthWidth, mouthHeight);

        if (seg) {
          ctx.fillStyle = '#ffffff';
          ctx.font = Math.round(canvas.width * 0.04) + 'px sans-serif';
          ctx.textAlign = 'left';
          ctx.fillText(seg.emotion_tag || 'neutral', Math.max(12, headX - headRadius), Math.max(24, headY - headRadius * 1.4 + bob));
        }
      }

      function mouthOpen(ms, seg) {
        if (!seg) return 0.12;
        // Simple deterministic pulse during speech segments.
        const phase = ms / 85;
        const base = 0.25;
        const amp = 0.75;
        return Math.min(1, Math.max(0.08, base + amp * (0.5 + 0.5 * Math.sin(phase))));
      }

      function update() {
        const ms = Math.round(performance.now() - startedAt);
        const seg = currentSegment(ms);
        const open = mouthOpen(ms, seg);

        if (ms !== lastMs) {
          lipPoints.push({ t_ms: ms, open });
          lastMs = ms;
        }

        drawFrame(open, seg, ms);
        if (ms >= totalMs) {
          window.__MP_LIP_SYNC__ = lipPoints;
          window.__MP_DONE__ = true;
          return;
        }
        requestAnimationFrame(update);
      }

        requestAnimationFrame(update);
      } catch (e) {
        window.__MP_BOOT_ERROR__ = String((e && e.stack) ? e.stack : e);
        window.__MP_DONE__ = true;
        throw e;
      }
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
    total_ms: opts.timing.total_ms + 1000,
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
  await page.setContent(rendererHtml(), { waitUntil: 'load' });

  // Inject config after content is loaded (more reliable than addInitScript for large JSON blobs).
  await page.evaluate((cfg) => {
    (window as any).__MP_CONFIG__ = cfg;
  }, config);

  const bootError = await page.evaluate(() => (window as any).__MP_BOOT_ERROR__ || null);
  if (bootError) {
    await context.close();
    await browser.close();
    throw new Error(`Renderer boot failed: ${bootError}`);
  }

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

  // Re-encode to keep overlay.webm reasonably small.
  const tmpOut = `${opts.outputWebm}.tmp.webm`;
  await runFfmpeg(
    [
      '-y',
      '-i',
      recorded,
      '-an',
      '-c:v',
      'libvpx-vp9',
      '-b:v',
      '0',
      '-crf',
      '35',
      '-pix_fmt',
      'yuv420p',
      '-r',
      String(config.fps),
      tmpOut,
    ],
    log
  );
  fs.renameSync(tmpOut, opts.outputWebm);

  const lipSync: LipSyncTimeline = {
    battle_id: opts.script.battle_id,
    version: 1,
    points: lipPoints,
  };

  log.info(`Renderer produced ${opts.outputWebm}`);
  return { lipSync };
}
