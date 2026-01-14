/* global PIXI, AITuberTextLipSync */

(async function () {
  const hud = document.getElementById('hud');
  const canvas = document.getElementById('l2dCanvas');
  const input = document.getElementById('text');

  function setHud(obj) {
    try {
      hud.textContent = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
    } catch {
      hud.textContent = String(obj || '');
    }
  }

  function safeJsonFetch(url) {
    return fetch(url, { cache: 'no-store' }).then((r) => r.json());
  }

  async function pickFirstModelPath() {
    try {
      const j = await safeJsonFetch('/api/models/index');
      const items = j && j.ok && Array.isArray(j.items) ? j.items : [];
      const first = items && items.length ? String(items[0] || '').trim() : '';
      return first;
    } catch {
      return '';
    }
  }

  async function loadModelLipSyncIds(modelJsonUrl) {
    try {
      const j = await safeJsonFetch(modelJsonUrl);
      const groups = j && Array.isArray(j.Groups) ? j.Groups : [];
      for (const g of groups) {
        const name = g && g.Name ? String(g.Name) : '';
        const target = g && g.Target ? String(g.Target) : '';
        if (target !== 'Parameter') continue;
        if (String(name).toLowerCase() !== 'lipsync') continue;
        const ids = g && Array.isArray(g.Ids) ? g.Ids.map((x) => String(x || '').trim()).filter(Boolean) : [];
        return ids;
      }
      return [];
    } catch {
      return [];
    }
  }

  function clamp(x, lo, hi) {
    if (x < lo) return lo;
    if (x > hi) return hi;
    return x;
  }

  function scale01ToParam(core, id, v01) {
    try {
      if (typeof core.getParameterIndex !== 'function') return v01;
      const idx = core.getParameterIndex(id);
      if (typeof idx !== 'number' || idx < 0) return v01;
      if (typeof core.getParameterMinimumValue !== 'function' || typeof core.getParameterMaximumValue !== 'function') return v01;
      const mn = Number(core.getParameterMinimumValue(idx));
      const mx = Number(core.getParameterMaximumValue(idx));
      if (!Number.isFinite(mn) || !Number.isFinite(mx) || mx <= mn) return v01;
      return mn + clamp(v01, 0, 1) * (mx - mn);
    } catch {
      return v01;
    }
  }

  function apply(core, ids, v01) {
    const v = clamp(v01, 0, 1);
    for (const id of ids) {
      try {
        core.setParameterValueById(id, scale01ToParam(core, id, v));
      } catch {
        // ignore
      }
    }
  }

  // --- boot ---
  if (!window.Live2DCubismCore) {
    setHud('Live2D: Cubism Core not found. Put ./vendor/live2dcubismcore.min.js');
    return;
  }
  const Live2DModel = PIXI && PIXI.live2d && PIXI.live2d.Live2DModel ? PIXI.live2d.Live2DModel : null;
  if (!Live2DModel) {
    setHud('Live2D: pixi-live2d-display not loaded');
    return;
  }

  const modelPath = (localStorage.getItem('aituber.modelPath') || '').trim() || (await pickFirstModelPath());
  if (!modelPath) {
    setHud('No model found under /models.');
    return;
  }

  const modelUrl = `/models/${modelPath.split('/').map(encodeURIComponent).join('/')}`;
  const lipIds = await loadModelLipSyncIds(modelUrl);

  const app = new PIXI.Application({
    view: canvas,
    autoStart: true,
    resizeTo: document.getElementById('root') || window,
    backgroundAlpha: 1,
    backgroundColor: 0x000000,
    antialias: true,
  });

  const model = await Live2DModel.from(modelUrl, { motionPreload: PIXI.live2d.MotionPreloadStrategy.IDLE });
  app.stage.addChild(model);
  model.anchor.set(0.5, 0.5);
  model.x = app.renderer.width / 2;
  model.y = app.renderer.height * 0.85;
  const fitScale = Math.min(app.renderer.width / model.width, app.renderer.height / model.height) * 0.9;
  model.scale.set(fitScale, fitScale);

  const core = model && model.internalModel && model.internalModel.coreModel ? model.internalModel.coreModel : null;
  if (!core) {
    setHud('coreModel not found');
    return;
  }

  // Minimal: if LipSync group is empty, fall back to common mouth ids.
  const driveIds = lipIds.length ? lipIds : ['ParamMouthOpenY', 'ParamA', 'ParamMouthA'];

  let mode = 'sin';
  let t0 = performance.now();
  let textCurve = null;

  // Apply in beforeModelUpdate to win against motion/physics.
  model.internalModel.on('beforeModelUpdate', () => {
    const t = (performance.now() - t0) / 1000;
    let v = 0;
    if (mode === 'sin') {
      v = (Math.sin(t * Math.PI * 2 * 2) + 1) * 0.5; // 2Hz
    } else if (mode === 'text' && textCurve) {
      const fps = Number(textCurve.fps || 60) || 60;
      const dt = 1000 / fps;
      const idx = Math.min(textCurve.series.mouth_open.length - 1, Math.floor(((performance.now() - t0) / 1000) * 1000 / dt));
      v = Number(textCurve.series.mouth_open[idx] || 0);
    }
    apply(core, driveIds, v);
  });

  // HUD
  setInterval(() => {
    setHud({
      modelPath,
      driveIds,
      mode,
      hint: "Type text and press Enter to switch to text mode."
    });
  }, 250);

  // Input -> build text curve
  if (input) {
    input.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter') return;
      const text = String(input.value || '').trim();
      if (!text) {
        mode = 'sin';
        textCurve = null;
        t0 = performance.now();
        return;
      }
      textCurve = AITuberTextLipSync.buildTextLipSyncCurve(text, { fps: 60, moraMs: 120 });
      mode = 'text';
      t0 = performance.now();
    });
  }
})();
