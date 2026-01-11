/* global PIXI */

(function () {
  const overlayEl = document.getElementById('overlayText');
  const statusEl = document.getElementById('status');
  const audioEl = document.getElementById('ttsAudio');
  const canvas = document.getElementById('l2dCanvas');

  const DEBUG = (() => {
    try {
      const q = new URLSearchParams(window.location.search);
      return q.get('debug') === '1' || q.get('debug') === 'true';
    } catch {
      return false;
    }
  })();

  let debugEl = null;
  function ensureDebugEl() {
    if (!DEBUG) return;
    if (debugEl) return;
    try {
      debugEl = document.createElement('div');
      debugEl.style.position = 'fixed';
      debugEl.style.left = '8px';
      debugEl.style.top = '8px';
      debugEl.style.zIndex = '9999';
      debugEl.style.fontSize = '12px';
      debugEl.style.fontFamily = 'monospace';
      debugEl.style.whiteSpace = 'pre';
      debugEl.style.padding = '6px 8px';
      debugEl.style.background = 'rgba(0,0,0,0.65)';
      debugEl.style.color = '#fff';
      debugEl.style.maxWidth = '70vw';
      debugEl.style.pointerEvents = 'none';
      document.body.appendChild(debugEl);
    } catch {
      debugEl = null;
    }
  }

  function setDebugText(s) {
    if (!DEBUG) return;
    ensureDebugEl();
    if (!debugEl) return;
    try {
      debugEl.textContent = String(s || '');
    } catch {
      // ignore
    }
  }

  const POLL_OVERLAY_MS = 250;
  const POLL_LIVE2D_MS = 250;

  // Some browsers block autoplay until the user interacts with the page.
  // We keep a tiny prompt in the status area when playback is blocked.
  let audioBlockedHint = false;

  function setStatus(msg) {
    if (!statusEl) return;
    const m = String(msg || '').trim();
    statusEl.textContent = m;
    // Only show status when there is something actionable (errors).
    statusEl.style.display = m ? 'block' : 'none';
  }

  function safeJsonFetch(url) {
    return fetch(url, { cache: 'no-store' }).then((r) => r.json());
  }

  async function loadHotkeys() {
    try {
      const res = await safeJsonFetch('./hotkeys.json');
      return res && typeof res === 'object' ? res : {};
    } catch {
      return {};
    }
  }

  function getModelName() {
    return localStorage.getItem('aituber.modelName') || 'default';
  }

  function getModelFile() {
    // Default convention: /models/<name>/<name>.model3.json
    return localStorage.getItem('aituber.modelFile') || `${getModelName()}.model3.json`;
  }

  function getModelPath() {
    // Preferred: a single path under /models, e.g. "default/default.model3.json"
    const p = (localStorage.getItem('aituber.modelPath') || '').trim();
    return p || `${getModelName()}/${getModelFile()}`;
  }

  function normalizeRelPath(p) {
    const s = String(p || '').replace(/^\.\//, '');
    return s;
  }

  function getStageBackgroundPrefs() {
    const legacy = String(localStorage.getItem('aituber.stage.bg') || '').trim();
    const color = String(localStorage.getItem('aituber.stage.bgColor') || legacy || '#000000').trim() || '#000000';
    return { color };
  }

  function getOverlayFont() {
    return String(localStorage.getItem('aituber.stage.fontFamily') || 'system-ui').trim() || 'system-ui';
  }

  function hexToPixiColor(hex) {
    const s = String(hex || '').trim();
    const m = /^#?([0-9a-fA-F]{6})$/.exec(s);
    if (!m) return 0x000000;
    return parseInt(m[1], 16);
  }

  function getMouseMode() {
    const raw = String(localStorage.getItem('aituber.stage.mouseMode') || '').trim();
    return raw === 'no_input' ? 'no_input' : 'no_follow';
  }

  function stageLog(msg, payload) {
    try {
      console.log(`[AITuber][Stage] ${msg}`, payload || '');
    } catch {
      // ignore
    }
  }

  async function buildMotionIndex(modelJsonUrl) {
    try {
      const j = await safeJsonFetch(modelJsonUrl);
      const motions = j && j.FileReferences && j.FileReferences.Motions ? j.FileReferences.Motions : {};
      const map = new Map();
      for (const group of Object.keys(motions)) {
        const arr = motions[group] || [];
        for (let i = 0; i < arr.length; i += 1) {
          const file = arr[i] && arr[i].File ? normalizeRelPath(arr[i].File) : '';
          if (file) map.set(file, { group, index: i });
        }
      }
      return map;
    } catch {
      return new Map();
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

  async function startStage() {
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

    let modelPath = String(getModelPath() || '').replace(/^\/?models\//, '').replace(/^\//, '');
    if (!modelPath) {
      modelPath = await pickFirstModelPath();
      if (modelPath) {
        try {
          localStorage.setItem('aituber.modelPath', modelPath);
        } catch {
          // ignore
        }
      }
    }

    let modelUrl = modelPath ? `/models/${modelPath.split('/').map(encodeURIComponent).join('/')}` : '';

    stageLog('model selected', { modelPath, modelUrl });

    const modelLipSyncIds = await loadModelLipSyncIds(modelUrl);
    stageLog('model lipsync ids', modelLipSyncIds);

    const hotkeys = await loadHotkeys();
    const motionIndex = await buildMotionIndex(modelUrl);

    // Cubism Core is required for cubism4.
    if (!window.Live2DCubismCore) {
      setStatus('Live2D: Cubism Core not found. See web/README.md (live2dcubismcore.min.js).');
    }

    // pixi-live2d-display is exposed as PIXI.live2d
    const Live2DModel = PIXI && PIXI.live2d && PIXI.live2d.Live2DModel ? PIXI.live2d.Live2DModel : null;
    if (!Live2DModel) {
      setStatus('Live2D: pixi-live2d-display not loaded.');
      return;
    }

    const bg = getStageBackgroundPrefs();
    const app = new PIXI.Application({
      view: canvas,
      autoStart: true,
      resizeTo: document.getElementById('root') || window,
      backgroundAlpha: 1,
      backgroundColor: hexToPixiColor(bg.color),
      antialias: true,
    });

    // Apply Stage background color (picked from /console).
    try {
      const rootEl = document.getElementById('root') || document.body;
      const htmlEl = document.documentElement;
      const bodyEl = document.body;
      const canvasEl = canvas;
      if (htmlEl) htmlEl.style.background = bg.color;
      if (bodyEl) bodyEl.style.background = bg.color;
      if (rootEl) rootEl.style.background = bg.color;
      if (canvasEl) canvasEl.style.background = 'transparent';
    } catch {
      // ignore
    }

    // Apply subtitle font
    try {
      if (overlayEl) overlayEl.style.fontFamily = getOverlayFont();
    } catch {
      // ignore
    }

    let model;
    try {
      if (!modelUrl) throw new Error('No model found under /models');
      model = await Live2DModel.from(modelUrl, {
        // load only Idle motions by default (lighter)
        motionPreload: PIXI.live2d.MotionPreloadStrategy.IDLE,
      });
    } catch (e) {
      // Retry with the first discovered model
      const fallback = await pickFirstModelPath();
      if (fallback && fallback !== modelPath) {
        modelPath = fallback;
        modelUrl = `/models/${modelPath.split('/').map(encodeURIComponent).join('/')}`;
        try {
          model = await Live2DModel.from(modelUrl, {
            motionPreload: PIXI.live2d.MotionPreloadStrategy.IDLE,
          });
          try {
            localStorage.setItem('aituber.modelPath', modelPath);
          } catch {
            // ignore
          }
        } catch (e2) {
          setStatus(`Live2D load failed: ${e2 && e2.message ? e2.message : e2}`);
          return;
        }
      } else {
        setStatus(`Live2D load failed: ${e && e.message ? e.message : e}`);
        return;
      }
    }

    app.stage.addChild(model);
    model.anchor.set(0.5, 0.5);
    model.x = app.renderer.width / 2;
    model.y = app.renderer.height * 0.85;

    // Fit model to canvas (initial)
    const fitScale = Math.min(app.renderer.width / model.width, app.renderer.height / model.height) * 0.9;
    model.scale.set(fitScale, fitScale);

    // --- Interaction: disable pointer-follow (look-at-cursor) ---
    const mouseMode = getMouseMode();
    const removedEvents = [];
    let focusPatched = false;
    try {
      // pixi-live2d-display often attaches pointermove handlers; remove them so the model doesn't track the cursor.
      const evtNames = ['pointermove', 'mousemove', 'touchmove'];
      for (const evt of evtNames) {
        let count = 0;
        try {
          if (typeof model.listeners === 'function') {
            count = model.listeners(evt).length;
          }
        } catch {
          count = 0;
        }
        if (count) removedEvents.push(`${evt}:${count}`);
        model.removeAllListeners(evt);
      }
    } catch {
      // ignore
    }

    // Hard-disable: some builds still track mouse via internal focus().
    // Make it a no-op in no_follow mode.
    if (mouseMode === 'no_follow') {
      try {
        if (typeof model.focus === 'function') {
          model.focus = () => {};
          focusPatched = true;
        }
      } catch {
        // ignore
      }
    }

    // Stronger: if the runtime still tracks cursor, force eye parameters back to neutral each frame.
    // This avoids look-at behavior without requiring library-internal hooks.
    try {
      const core = model && model.internalModel && model.internalModel.coreModel ? model.internalModel.coreModel : null;
      if (core && typeof core.setParameterValueById === 'function') {
        const ids = ['ParamEyeBallX', 'ParamEyeBallY'];
        app.ticker.add(() => {
          for (const id of ids) {
            try {
              core.setParameterValueById(id, 0);
            } catch {
              // ignore
            }
          }
        });
      }
    } catch {
      // ignore
    }

    // --- Lip sync (audio-timeline based) ---
    const LIPSYNC_FPS_DEFAULT = 60;
    const MOUTH_OPEN_CANDIDATES = ['ParamMouthOpenY', 'ParamMouthOpen', 'MouthOpenY', 'MouthOpen'];
    const MOUTH_FORM_CANDIDATES = ['ParamMouthForm', 'MouthForm'];
    const MOUTH_SMILE_CANDIDATES = ['ParamMouthSmile', 'MouthSmile'];
    const VOWEL_A_CANDIDATES = ['ParamMouthA', 'MouthA', 'ParamA', 'A'];
    const VOWEL_I_CANDIDATES = ['ParamMouthI', 'MouthI', 'ParamI', 'I'];
    const VOWEL_U_CANDIDATES = ['ParamMouthU', 'MouthU', 'ParamU', 'U'];
    const VOWEL_E_CANDIDATES = ['ParamMouthE', 'MouthE', 'ParamE', 'E'];
    const VOWEL_O_CANDIDATES = ['ParamMouthO', 'MouthO', 'ParamO', 'O'];

    const lipsyncCache = new Map();
    let pendingLipSyncUrl = '';
    let currentLipSyncUrl = '';
    let currentCurve = null;
    let audioStartPerfMs = null;

    // Perceptual boost for mouth movement (client-side).
    // These are intentionally a bit aggressive because many models have small mouth ranges.
    const OPEN_DEADZONE = 0.02;
    const OPEN_GAIN = 3.0;
    const OPEN_EXP = 0.65;

    let paramIndexById = null; // Map<string, number>

    function getApplyMode() {
      try {
        const m = String(localStorage.getItem('aituber.lipsync.applyMode') || '').trim().toLowerCase();
        return m === 'add' ? 'add' : 'set';
      } catch {
        return 'set';
      }
    }
    let resolvedParamIds = {
      mouthOpen: null,
      mouthForm: null,
      mouthSmile: null,
      vowelA: null,
      vowelI: null,
      vowelU: null,
      vowelE: null,
      vowelO: null,
      lipSyncDirect: null,
    };

    function getCoreModel() {
      return model && model.internalModel && model.internalModel.coreModel ? model.internalModel.coreModel : null;
    }

    // --- Envelope-only lip sync fallback (no lipsync JSON required) ---
    // This guarantees "mouth moves" even when forced alignment/timing is unavailable.
    // Uses WebAudio AnalyserNode on the actual audio playback.
    let audioCtx = null;
    let audioSrcNode = null;
    let analyser = null;
    let analyserBuf = null;
    let envOpen = 0;

    const ENV_FLOOR = 0.015; // noise floor
    const ENV_GAIN = 6.0; // boost
    const ENV_ATTACK = 0.35; // 0..1 per frame
    const ENV_RELEASE = 0.15; // 0..1 per frame

    function ensureAnalyser() {
      try {
        if (!audioEl) return;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        if (!audioCtx) audioCtx = new AC();
        if (audioCtx && audioCtx.state === 'suspended') {
          // Must be called after a user gesture in some browsers.
          audioCtx.resume().catch(() => {});
        }
        if (!audioSrcNode) {
          audioSrcNode = audioCtx.createMediaElementSource(audioEl);
        }
        if (!analyser) {
          analyser = audioCtx.createAnalyser();
          analyser.fftSize = 2048;
          analyser.smoothingTimeConstant = 0.0;
          analyserBuf = new Uint8Array(analyser.fftSize);
          // Route: source -> analyser -> destination
          audioSrcNode.connect(analyser);
          analyser.connect(audioCtx.destination);
        }
      } catch {
        // ignore
      }
    }

    function envelopeOpen01() {
      try {
        if (!analyser || !analyserBuf) return 0;
        analyser.getByteTimeDomainData(analyserBuf);
        let ss = 0;
        const n = analyserBuf.length || 0;
        for (let i = 0; i < n; i += 1) {
          const x = (analyserBuf[i] - 128) / 128;
          ss += x * x;
        }
        const rms = Math.sqrt(ss / Math.max(1, n));
        let v = (rms - ENV_FLOOR) * ENV_GAIN;
        if (v < 0) v = 0;
        if (v > 1) v = 1;

        // attack/release smoothing
        if (v >= envOpen) envOpen = envOpen + (v - envOpen) * ENV_ATTACK;
        else envOpen = envOpen + (v - envOpen) * ENV_RELEASE;
        if (envOpen < 0) envOpen = 0;
        if (envOpen > 1) envOpen = 1;
        return envOpen;
      } catch {
        return 0;
      }
    }

    function listParameterIds(core) {
      try {
        if (!core) return [];
        if (typeof core.getParameterCount !== 'function' || typeof core.getParameterId !== 'function') return [];
        const n = Number(core.getParameterCount() || 0);
        const ids = [];
        for (let i = 0; i < n; i += 1) {
          try {
            const id = core.getParameterId(i);
            if (id) ids.push(String(id));
          } catch {
            // ignore
          }
        }
        return ids;
      } catch {
        return [];
      }
    }

    function buildParamIndexMap(core) {
      const ids = listParameterIds(core);
      if (!ids || !ids.length) return null;
      const m = new Map();
      for (let i = 0; i < ids.length; i += 1) m.set(ids[i], i);
      return m;
    }

    function shape01(x01) {
      let v = clamp(Number(x01 || 0), 0, 1);
      v = Math.max(0, v - OPEN_DEADZONE);
      v = clamp(v * OPEN_GAIN, 0, 1);
      v = Math.pow(v, OPEN_EXP);
      return clamp(v, 0, 1);
    }

    function scale01ToParam(core, id, v01) {
      // Convert a normalized 0..1 value into the model's actual parameter range when available.
      try {
        let idx = null;
        if (typeof core.getParameterIndex === 'function') {
          const x = core.getParameterIndex(id);
          if (typeof x === 'number' && x >= 0) idx = x;
        }
        if (idx == null) {
          if (!paramIndexById || !paramIndexById.has(id)) return v01;
          idx = paramIndexById.get(id);
        }
        if (typeof core.getParameterMinimumValue !== 'function' || typeof core.getParameterMaximumValue !== 'function') return v01;
        const mn = Number(core.getParameterMinimumValue(idx));
        const mx = Number(core.getParameterMaximumValue(idx));
        if (!Number.isFinite(mn) || !Number.isFinite(mx) || mx <= mn) return v01;
        return mn + clamp(v01, 0, 1) * (mx - mn);
      } catch {
        return v01;
      }
    }

    function scale11ToParam(core, id, v11) {
      // Convert a normalized -1..1 value into parameter range.
      const v01 = (clamp(Number(v11 || 0), -1, 1) + 1) * 0.5;
      return scale01ToParam(core, id, v01);
    }

    function getParamDefaultValue(core, id) {
      try {
        let idx = null;
        if (typeof core.getParameterIndex === 'function') {
          const x = core.getParameterIndex(id);
          if (typeof x === 'number' && x >= 0) idx = x;
        }
        if (idx == null) {
          if (!paramIndexById || !paramIndexById.has(id)) return 0;
          idx = paramIndexById.get(id);
        }
        if (typeof core.getParameterDefaultValue !== 'function') return 0;
        const d = Number(core.getParameterDefaultValue(idx));
        return Number.isFinite(d) ? d : 0;
      } catch {
        return 0;
      }
    }

    function tryApplyParam(core, id, targetValue) {
      // Apply mouth param in a way that can either override (set) or blend (add from default).
      if (!core) return false;
      const mode = getApplyMode();
      if (mode === 'add' && typeof core.addParameterValueById === 'function') {
        try {
          const base = getParamDefaultValue(core, id);
          const delta = Number(targetValue) - Number(base);
          core.addParameterValueById(id, delta);
          return true;
        } catch {
          // fall through
        }
      }
      return trySetParam(core, id, targetValue);
    }

    function trySetParam(core, id, value) {
      if (!core || typeof core.setParameterValueById !== 'function') return false;
      try {
        core.setParameterValueById(id, value);
        // Some runtimes don't throw even for unknown ids. Verify via readback when available.
        if (typeof core.getParameterValueById === 'function') {
          const v = Number(core.getParameterValueById(id));
          if (Number.isFinite(v) && Math.abs(v - Number(value)) > 1e-3) return false;
        }
        return true;
      } catch {
        return false;
      }
    }

    function resolveByProbe(core, candidates) {
      // Some Cubism core builds don't expose getParameterId/getParameterCount, so we probe via setParameterValueById.
      for (const id of candidates) {
        if (trySetParam(core, id, 0)) return id;
      }
      return null;
    }

    function pickFirstExisting(candidates, idsSet) {
      for (const c of candidates) {
        if (idsSet.has(c)) return c;
      }
      return null;
    }

    function resolveMouthParams() {
      const core = getCoreModel();
      if (!core) return;
      // Prefer enumeration when available (nice diagnostics), otherwise fall back to probing.
      const ids = listParameterIds(core);
      const set = new Set(ids);

      // Cache id->index for range scaling.
      paramIndexById = ids.length ? buildParamIndexMap(core) : null;
      const mouthOpen = ids.length ? pickFirstExisting(MOUTH_OPEN_CANDIDATES, set) : resolveByProbe(core, MOUTH_OPEN_CANDIDATES);
      const mouthForm = ids.length ? pickFirstExisting(MOUTH_FORM_CANDIDATES, set) : resolveByProbe(core, MOUTH_FORM_CANDIDATES);
      const mouthSmile = ids.length ? pickFirstExisting(MOUTH_SMILE_CANDIDATES, set) : resolveByProbe(core, MOUTH_SMILE_CANDIDATES);
      const vowelA = ids.length ? pickFirstExisting(VOWEL_A_CANDIDATES, set) : resolveByProbe(core, VOWEL_A_CANDIDATES);
      const vowelI = ids.length ? pickFirstExisting(VOWEL_I_CANDIDATES, set) : resolveByProbe(core, VOWEL_I_CANDIDATES);
      const vowelU = ids.length ? pickFirstExisting(VOWEL_U_CANDIDATES, set) : resolveByProbe(core, VOWEL_U_CANDIDATES);
      const vowelE = ids.length ? pickFirstExisting(VOWEL_E_CANDIDATES, set) : resolveByProbe(core, VOWEL_E_CANDIDATES);
      const vowelO = ids.length ? pickFirstExisting(VOWEL_O_CANDIDATES, set) : resolveByProbe(core, VOWEL_O_CANDIDATES);

      // If model3.json declares a LipSync group, use it as an authoritative fallback.
      const lipIds = Array.isArray(modelLipSyncIds) ? modelLipSyncIds : [];
      const lipSyncDirect = lipIds.length ? (ids.length ? pickFirstExisting(lipIds, set) : resolveByProbe(core, lipIds)) : null;

      resolvedParamIds = { mouthOpen, mouthForm, mouthSmile, vowelA, vowelI, vowelU, vowelE, vowelO, lipSyncDirect };
      stageLog('lipsync params', { ...resolvedParamIds, enumeratedCount: ids.length });
      const hasAnyVowel = !!(resolvedParamIds.vowelA || resolvedParamIds.vowelI || resolvedParamIds.vowelU || resolvedParamIds.vowelE || resolvedParamIds.vowelO);
      if (!resolvedParamIds.mouthOpen && !hasAnyVowel && !resolvedParamIds.lipSyncDirect) {
        setStatus('LipSync: mouth parameter not found (expected ParamMouthOpenY or ParamMouthA/I/U/E/O).');
      }
    }

    function clamp(x, lo, hi) {
      if (x < lo) return lo;
      if (x > hi) return hi;
      return x;
    }

    function sampleCurve(curve, tMs) {
      if (!curve || !curve.series) return null;
      const fps = Number(curve.fps || LIPSYNC_FPS_DEFAULT) || LIPSYNC_FPS_DEFAULT;
      const dt = 1000 / fps;
      const duration = Number(curve.duration_ms || 0) || 0;
      const maxIdx = Math.max(0, Math.ceil(duration / dt) - 1);
      let idx = Math.floor(Number(tMs || 0) / dt);
      if (idx < 0) idx = 0;
      if (idx > maxIdx) idx = maxIdx;

      const s = curve.series;
      const open = Array.isArray(s.mouth_open) ? Number(s.mouth_open[Math.min(idx, s.mouth_open.length - 1)] || 0) : 0;
      const form = Array.isArray(s.mouth_form) ? Number(s.mouth_form[Math.min(idx, s.mouth_form.length - 1)] || 0) : 0;
      const smile = Array.isArray(s.smile) ? Number(s.smile[Math.min(idx, s.smile.length - 1)] || 0) : 0;
      const hasVowelSeries =
        Array.isArray(s.vowel_a) ||
        Array.isArray(s.vowel_i) ||
        Array.isArray(s.vowel_u) ||
        Array.isArray(s.vowel_e) ||
        Array.isArray(s.vowel_o);

      let va = Array.isArray(s.vowel_a) ? Number(s.vowel_a[Math.min(idx, s.vowel_a.length - 1)] || 0) : 0;
      let vi = Array.isArray(s.vowel_i) ? Number(s.vowel_i[Math.min(idx, s.vowel_i.length - 1)] || 0) : 0;
      let vu = Array.isArray(s.vowel_u) ? Number(s.vowel_u[Math.min(idx, s.vowel_u.length - 1)] || 0) : 0;
      let ve = Array.isArray(s.vowel_e) ? Number(s.vowel_e[Math.min(idx, s.vowel_e.length - 1)] || 0) : 0;
      let vo = Array.isArray(s.vowel_o) ? Number(s.vowel_o[Math.min(idx, s.vowel_o.length - 1)] || 0) : 0;

      // Fallback for AIUEO-only models:
      // - If vowel series are missing, or present but effectively empty (e.g. envelope-only mode),
      //   drive a generic open/close on A.
      const vowelSum = Math.abs(va) + Math.abs(vi) + Math.abs(vu) + Math.abs(ve) + Math.abs(vo);
      if (!hasVowelSeries || (vowelSum < 1e-4 && Math.abs(open) > 0.02)) {
        va = open;
        vi = 0;
        vu = 0;
        ve = 0;
        vo = 0;
      }
      return {
        mouthOpen: clamp(open, 0, 1),
        mouthForm: clamp(form, -1, 1),
        mouthSmile: clamp(smile, 0, 1),
        vowelA: clamp(va, 0, 1),
        vowelI: clamp(vi, 0, 1),
        vowelU: clamp(vu, 0, 1),
        vowelE: clamp(ve, 0, 1),
        vowelO: clamp(vo, 0, 1),
      };
    }

    async function loadLipSyncCurve(url, versionKey) {
      const key = `${url}::${String(versionKey || '')}`;
      if (lipsyncCache.has(key)) return lipsyncCache.get(key);
      try {
        const u = `${url}?v=${encodeURIComponent(String(versionKey || Date.now()))}`;
        const j = await safeJsonFetch(u);
        if (!j || typeof j !== 'object' || !j.series) return null;
        lipsyncCache.set(key, j);
        return j;
      } catch {
        return null;
      }
    }

    function setMouthNeutral() {
      const core = getCoreModel();
      if (!core || typeof core.setParameterValueById !== 'function') return;
      try {
        // Use resolved ids when available; otherwise probe candidates.
        if (resolvedParamIds.mouthOpen) {
          core.setParameterValueById(resolvedParamIds.mouthOpen, 0);
        } else {
          for (const id of MOUTH_OPEN_CANDIDATES) {
            if (trySetParam(core, id, 0)) break;
          }
        }
        if (resolvedParamIds.mouthForm) {
          core.setParameterValueById(resolvedParamIds.mouthForm, 0);
        } else {
          for (const id of MOUTH_FORM_CANDIDATES) {
            if (trySetParam(core, id, 0)) break;
          }
        }
        if (resolvedParamIds.mouthSmile) {
          core.setParameterValueById(resolvedParamIds.mouthSmile, 0);
        } else {
          for (const id of MOUTH_SMILE_CANDIDATES) {
            if (trySetParam(core, id, 0)) break;
          }
        }

        // Also neutralize vowel params if they exist.
        const vowelPairs = [
          ['vowelA', VOWEL_A_CANDIDATES],
          ['vowelI', VOWEL_I_CANDIDATES],
          ['vowelU', VOWEL_U_CANDIDATES],
          ['vowelE', VOWEL_E_CANDIDATES],
          ['vowelO', VOWEL_O_CANDIDATES],
        ];
        for (const [key, candidates] of vowelPairs) {
          if (resolvedParamIds[key]) {
            core.setParameterValueById(resolvedParamIds[key], 0);
          } else {
            for (const id of candidates) {
              if (trySetParam(core, id, 0)) {
                resolvedParamIds[key] = id;
                break;
              }
            }
          }
        }

        if (resolvedParamIds.lipSyncDirect) {
          core.setParameterValueById(resolvedParamIds.lipSyncDirect, 0);
        }
      } catch {
        // ignore
      }
    }

    resolveMouthParams();

    function applyMouthSample(core, s) {
      // Boost mouth movement (client-side shaping)
      const open01 = shape01(s.mouthOpen);
      const form11 = clamp(Number(s.mouthForm || 0), -1, 1);
      const smile01 = clamp(Number(s.mouthSmile || 0), 0, 1);
      const a01 = shape01(s.vowelA);
      const i01 = shape01(s.vowelI);
      const u01 = shape01(s.vowelU);
      const e01 = shape01(s.vowelE);
      const o01 = shape01(s.vowelO);

      // Cache the first successful id per parameter.
      if (resolvedParamIds.mouthOpen) {
        tryApplyParam(core, resolvedParamIds.mouthOpen, scale01ToParam(core, resolvedParamIds.mouthOpen, open01));
      } else {
        for (const id of MOUTH_OPEN_CANDIDATES) {
          if (tryApplyParam(core, id, scale01ToParam(core, id, open01))) {
            resolvedParamIds.mouthOpen = id;
            break;
          }
        }
      }

      if (resolvedParamIds.mouthForm) {
        tryApplyParam(core, resolvedParamIds.mouthForm, scale11ToParam(core, resolvedParamIds.mouthForm, form11));
      } else {
        for (const id of MOUTH_FORM_CANDIDATES) {
          if (tryApplyParam(core, id, scale11ToParam(core, id, form11))) {
            resolvedParamIds.mouthForm = id;
            break;
          }
        }
      }

      if (resolvedParamIds.mouthSmile) {
        tryApplyParam(core, resolvedParamIds.mouthSmile, scale01ToParam(core, resolvedParamIds.mouthSmile, smile01));
      } else {
        for (const id of MOUTH_SMILE_CANDIDATES) {
          if (tryApplyParam(core, id, scale01ToParam(core, id, smile01))) {
            resolvedParamIds.mouthSmile = id;
            break;
          }
        }
      }

      // AIUEO vowel parameters (optional; many models expose these).
      const vowelPairs = [
        ['vowelA', VOWEL_A_CANDIDATES, a01],
        ['vowelI', VOWEL_I_CANDIDATES, i01],
        ['vowelU', VOWEL_U_CANDIDATES, u01],
        ['vowelE', VOWEL_E_CANDIDATES, e01],
        ['vowelO', VOWEL_O_CANDIDATES, o01],
      ];
      for (const [key, candidates, value] of vowelPairs) {
        if (resolvedParamIds[key]) {
          tryApplyParam(core, resolvedParamIds[key], scale01ToParam(core, resolvedParamIds[key], value));
        } else {
          for (const id of candidates) {
            if (tryApplyParam(core, id, scale01ToParam(core, id, value))) {
              resolvedParamIds[key] = id;
              break;
            }
          }
        }
      }

      // Absolute fallback: drive the LipSync group parameter declared by model3.json (e.g., ParamMouthOpenY or ParamA).
      if (resolvedParamIds.lipSyncDirect) {
        tryApplyParam(core, resolvedParamIds.lipSyncDirect, scale01ToParam(core, resolvedParamIds.lipSyncDirect, open01));
      }
    }

    // Apply on every tick; audio clock is source of truth.
    // IMPORTANT: run *last* so motions/physics don't overwrite the mouth params.
    const lipsyncPriority = -1000;

    function computeLipSyncSample() {
      if (!audioEl) return null;

      // Determine time source:
      // - Prefer real playback time (audio clock).
      // - If autoplay is blocked, fall back to wall clock so the mouth still moves for OBS.
      let tMs = null;
      const hasAudioTime = !Number.isNaN(audioEl.currentTime) && Number.isFinite(audioEl.currentTime);
      if (!audioEl.paused && hasAudioTime) {
        tMs = audioEl.currentTime * 1000;
      } else if (audioBlockedHint && typeof audioStartPerfMs === 'number') {
        tMs = Math.max(0, performance.now() - audioStartPerfMs);
      }

      if (currentCurve && tMs != null) {
        const s = sampleCurve(currentCurve, tMs);
        if (s) return { s, hasAudioTime, tMs };
      }

      // If there's no curve, fall back to envelope (requires audio actually playing).
      if (!audioEl.paused) {
        ensureAnalyser();
        const open = envelopeOpen01();
        const s = {
          mouthOpen: open,
          mouthForm: 0,
          mouthSmile: 0,
          vowelA: open,
          vowelI: 0,
          vowelU: 0,
          vowelE: 0,
          vowelO: 0,
        };
        return { s, hasAudioTime, tMs };
      }

      // When fully paused and not blocked, keep neutral.
      return null;
    }

    // Preferred hook: runs inside Cubism4InternalModel.update() before the final model update.
    // This is the most reliable place to override mouth params against motions/physics.
    let debugLastMs = 0;
    let hookedBeforeModelUpdate = false;
    try {
      const internal = model && model.internalModel ? model.internalModel : null;
      if (internal && typeof internal.on === 'function') {
        internal.on('beforeModelUpdate', () => {
          try {
            const core = getCoreModel();
            if (!core || typeof core.setParameterValueById !== 'function') return;

            const r = computeLipSyncSample();
            if (!r) {
              if (!audioBlockedHint) setMouthNeutral();
            } else {
              applyMouthSample(core, r.s);
            }

            if (DEBUG) {
              const now = performance.now();
              if (now - debugLastMs > 250) {
                debugLastMs = now;
                const hasAudioTime = r ? r.hasAudioTime : (!Number.isNaN(audioEl.currentTime) && Number.isFinite(audioEl.currentTime));
                const dbg = {
                  hook: 'beforeModelUpdate',
                  audioPaused: !!audioEl.paused,
                  audioTime: hasAudioTime ? Number(audioEl.currentTime).toFixed(3) : 'NaN',
                  tMs: r && r.tMs != null ? Math.round(r.tMs) : null,
                  curve: currentCurve ? 'yes' : 'no',
                  lipsyncDirect: resolvedParamIds.lipSyncDirect,
                  mouthOpen: resolvedParamIds.mouthOpen,
                  vowelA: resolvedParamIds.vowelA,
                  blocked: !!audioBlockedHint,
                };
                setDebugText(JSON.stringify(dbg, null, 2));
              }
            }
          } catch {
            // ignore
          }
        });
        hookedBeforeModelUpdate = true;
      }
    } catch {
      hookedBeforeModelUpdate = false;
    }

    // Fallback: if the event hook is not available, apply in ticker.
    if (!hookedBeforeModelUpdate) {
      app.ticker.add(() => {
        try {
          const core = getCoreModel();
          if (!core || typeof core.setParameterValueById !== 'function') return;
          const r = computeLipSyncSample();
          if (!r) {
            if (!audioBlockedHint) setMouthNeutral();
          } else {
            applyMouthSample(core, r.s);
          }
        } catch {
          // ignore
        }
      }, null, lipsyncPriority);
    }

    // --- Persisted stage transforms ---
    const LS_MODEL_POS = 'aituber.stage.modelPos';
    const LS_MODEL_SCALE = 'aituber.stage.modelScale';
    const LS_CAPTION_POS = 'aituber.stage.captionPos';
    const LS_CAPTION_SCALE = 'aituber.stage.captionScale';

    function loadJson(key) {
      try {
        const s = localStorage.getItem(key);
        return s ? JSON.parse(s) : null;
      } catch {
        return null;
      }
    }

    function saveJson(key, obj) {
      try {
        localStorage.setItem(key, JSON.stringify(obj));
      } catch {
        // ignore
      }
    }

    function applyStoredModelTransform() {
      const pos = loadJson(LS_MODEL_POS);
      if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
        model.x = pos.x * app.renderer.width;
        model.y = pos.y * app.renderer.height;
      }
      const sc = loadJson(LS_MODEL_SCALE);
      if (sc && typeof sc.k === 'number' && sc.k > 0) {
        const k = Math.min(4.0, Math.max(0.2, sc.k));
        model.scale.set(fitScale * k, fitScale * k);
      }
    }

    function persistModelTransform() {
      saveJson(LS_MODEL_POS, {
        x: model.x / Math.max(1, app.renderer.width),
        y: model.y / Math.max(1, app.renderer.height),
      });
      const k = model.scale.x / fitScale;
      saveJson(LS_MODEL_SCALE, { k });
    }

    applyStoredModelTransform();

    // --- Drag model ---
    // Keep model non-interactive to prevent any internal mouse-follow hooks.
    // Drag is implemented via DOM pointer events on the canvas.
    let dragEnabled = false;
    try {
      model.interactive = false;
      model.cursor = 'default';
    } catch {
      // ignore
    }

    if (mouseMode !== 'no_input' && canvas) {
      dragEnabled = true;
      canvas.style.cursor = 'move';

      let dragging = false;
      let dragOffset = { x: 0, y: 0 };
      let dragPointerId = null;

      function toStageXY(clientX, clientY) {
        const rect = canvas.getBoundingClientRect();
        const rx = (clientX - rect.left) / Math.max(1, rect.width);
        const ry = (clientY - rect.top) / Math.max(1, rect.height);
        return {
          x: rx * app.renderer.width,
          y: ry * app.renderer.height,
        };
      }

      canvas.addEventListener('pointerdown', (e) => {
        // Avoid stealing caption drag
        const cap = document.getElementById('overlayText');
        if (cap && (e.target === cap || cap.contains(e.target))) return;

        dragging = true;
        dragPointerId = e.pointerId;
        try {
          canvas.setPointerCapture(e.pointerId);
        } catch {
          // ignore
        }
        const p = toStageXY(e.clientX, e.clientY);
        dragOffset = { x: model.x - p.x, y: model.y - p.y };
        e.preventDefault();
      });

      canvas.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        if (dragPointerId !== null && e.pointerId !== dragPointerId) return;
        const p = toStageXY(e.clientX, e.clientY);
        model.x = p.x + dragOffset.x;
        model.y = p.y + dragOffset.y;
      });

      function endDrag(e) {
        if (!dragging) return;
        dragging = false;
        dragPointerId = null;
        try {
          canvas.releasePointerCapture(e.pointerId);
        } catch {
          // ignore
        }
        persistModelTransform();
      }

      canvas.addEventListener('pointerup', endDrag);
      canvas.addEventListener('pointercancel', endDrag);
    }

    // --- Wheel zoom (on stage) ---
    const rootEl = document.getElementById('root') || document.body;
    if (mouseMode === 'no_input' && rootEl) {
      rootEl.style.pointerEvents = 'none';
    }
    rootEl.addEventListener(
      'wheel',
      (e) => {
        // Wheel: zoom caption when hovering caption, otherwise zoom model.
        e.preventDefault();

        const captionEl = document.getElementById('overlayText');
        const hoveringCaption = captionEl && (e.target === captionEl || captionEl.contains(e.target));

        const delta = Math.sign(e.deltaY || 0);
        const step = 0.08;
        if (hoveringCaption) {
          const sc = loadJson(LS_CAPTION_SCALE) || { k: 1 };
          const cur = typeof sc.k === 'number' ? sc.k : 1;
          const next = Math.min(3.0, Math.max(0.5, cur * (delta > 0 ? 1 - step : 1 + step)));
          saveJson(LS_CAPTION_SCALE, { k: next });
          if (captionEl) {
            captionEl.style.transformOrigin = 'top left';
            captionEl.style.transform = `scale(${next})`;
          }
          return;
        }

        const curK = model.scale.x / fitScale;
        const nextK = Math.min(4.0, Math.max(0.2, curK * (delta > 0 ? 1 - step : 1 + step)));
        model.scale.set(fitScale * nextK, fitScale * nextK);
        persistModelTransform();
      },
      { passive: false }
    );

    // --- Caption drag + scale ---
    const captionEl = document.getElementById('overlayText');
    function applyStoredCaptionPos() {
      const pos = loadJson(LS_CAPTION_POS);
      if (!captionEl || !pos) return;
      if (typeof pos.x !== 'number' || typeof pos.y !== 'number') return;
      captionEl.style.left = `${pos.x * window.innerWidth}px`;
      captionEl.style.top = `${pos.y * window.innerHeight}px`;
      captionEl.style.right = 'auto';
      captionEl.style.bottom = 'auto';
    }

    function persistCaptionPos() {
      if (!captionEl) return;
      const rect = captionEl.getBoundingClientRect();
      saveJson(LS_CAPTION_POS, {
        x: rect.left / Math.max(1, window.innerWidth),
        y: rect.top / Math.max(1, window.innerHeight),
      });
    }

    applyStoredCaptionPos();

    // Apply stored caption scale
    try {
      const sc = loadJson(LS_CAPTION_SCALE);
      const k = sc && typeof sc.k === 'number' ? sc.k : 1;
      if (captionEl) {
        captionEl.style.transformOrigin = 'top left';
        captionEl.style.transform = `scale(${Math.min(3.0, Math.max(0.5, k))})`;
      }
    } catch {
      // ignore
    }

    if (captionEl) {
      let capDrag = false;
      let capOff = { x: 0, y: 0 };
      if (mouseMode !== 'no_input') {
        captionEl.addEventListener('pointerdown', (e) => {
          capDrag = true;
          captionEl.setPointerCapture(e.pointerId);
          const rect = captionEl.getBoundingClientRect();
          capOff = { x: e.clientX - rect.left, y: e.clientY - rect.top };
          captionEl.style.right = 'auto';
          captionEl.style.bottom = 'auto';
          e.preventDefault();
        });
        captionEl.addEventListener('pointermove', (e) => {
          if (!capDrag) return;
          captionEl.style.left = `${e.clientX - capOff.x}px`;
          captionEl.style.top = `${e.clientY - capOff.y}px`;
        });
        captionEl.addEventListener('pointerup', (e) => {
          if (!capDrag) return;
          capDrag = false;
          try {
            captionEl.releasePointerCapture(e.pointerId);
          } catch {
            // ignore
          }
          persistCaptionPos();
        });
        captionEl.addEventListener('pointercancel', () => {
          capDrag = false;
          persistCaptionPos();
        });
      } else {
        captionEl.style.pointerEvents = 'none';
        captionEl.style.cursor = 'default';
      }
    }

    // On resize, re-apply relative positions
    window.addEventListener('resize', () => {
      applyStoredModelTransform();
      applyStoredCaptionPos();
    });

    function playByTag(tag) {
      const key = String(tag || '').trim();
      if (!key) return;

      const mapped = hotkeys[key];
      // If hotkeys.json maps to a motion file path, locate group/index by model3.json.
      if (mapped) {
        const rel = normalizeRelPath(mapped);
        const hit = motionIndex.get(rel);
        if (hit) {
          model.motion(hit.group, hit.index);
          return;
        }
      }

      // Fallback: treat the tag itself as a motion group name.
      model.motion(key);
    }

    // Overlay polling
    let lastTtsVersion = null;
    let lastQueueVersion = null;
    const playedSegs = new Set();
    let playing = false;
    let queued = [];

    function pickNextSegment() {
      // queued is an array of {idx, path, text}
      for (const it of queued) {
        const key = it && it.path ? String(it.path) : '';
        if (!key) continue;
        if (!playedSegs.has(key)) return it;
      }
      return null;
    }

    async function playSegment(it) {
      if (!it || !it.path) return;
      const path = String(it.path);
      const v = it && it.idx != null ? it.idx : Date.now();
      const t0 = performance.now();
      playing = true;
      pendingLipSyncUrl = it && it.lipsync_path ? String(it.lipsync_path) : '';
      audioStartPerfMs = performance.now();
      audioEl.src = `${path}?v=${encodeURIComponent(String(v))}`;

      // Load lipsync curve immediately (even if autoplay is blocked).
      if (pendingLipSyncUrl) {
        const url = pendingLipSyncUrl;
        currentLipSyncUrl = url;
        void (async () => {
          const curve = await loadLipSyncCurve(url, v);
          currentCurve = curve;
          if (!curve) setMouthNeutral();
        })();
      } else {
        currentLipSyncUrl = '';
        currentCurve = null;
        setMouthNeutral();
      }
      try {
        const onPlaying = () => {
          try {
            audioEl.removeEventListener('playing', onPlaying);
          } catch {
            // ignore
          }
          const dt = Math.round(performance.now() - t0);
          // eslint-disable-next-line no-console
          console.log('[aituber/perf] audio_playing', { tts_path: path, idx: it.idx, dt_ms: dt });

          // Load lipsync curve for this segment.
          if (pendingLipSyncUrl) {
            const url = pendingLipSyncUrl;
            pendingLipSyncUrl = '';
            currentLipSyncUrl = url;
            void (async () => {
              const curve = await loadLipSyncCurve(url, v);
              currentCurve = curve;
              if (!curve) setMouthNeutral();
            })();
          } else {
            currentLipSyncUrl = '';
            currentCurve = null;
            setMouthNeutral();
          }
        };
        audioEl.addEventListener('playing', onPlaying);
        await audioEl.play();
        playedSegs.add(path);
        if (audioBlockedHint) {
          audioBlockedHint = false;
          setStatus('');
        }
      } catch {
        // autoplay can be blocked; allow retry later
        playing = false;
        audioBlockedHint = true;
        setStatus('Audio blocked: click/tap once to enable.');
      }
    }

    function ensurePlayback() {
      if (playing) return;
      const next = pickNextSegment();
      if (!next) return;
      void playSegment(next);
    }

    // Retry playback after user interaction (unblocks autoplay in most browsers).
    try {
      const retry = () => ensurePlayback();
      document.addEventListener('pointerdown', retry);
      document.addEventListener('keydown', retry);
      document.addEventListener('click', retry);
    } catch {
      // ignore
    }

    audioEl.addEventListener('ended', () => {
      playing = false;
      currentCurve = null;
      currentLipSyncUrl = '';
      setMouthNeutral();
      ensurePlayback();
    });

    audioEl.addEventListener('error', () => {
      playing = false;
      currentCurve = null;
      currentLipSyncUrl = '';
      setMouthNeutral();
      ensurePlayback();
    });
    async function pollOverlay() {
      try {
        const j = await safeJsonFetch('/overlay_text');
        if (overlayEl) overlayEl.textContent = j.speech_text || j.overlay_text || '';

        // New segmented audio queue path
        const qv = j.tts_queue_version ?? null;
        const q = Array.isArray(j.tts_queue) ? j.tts_queue : [];
        // Always keep the latest queue; retry playback if we have items.
        queued = q;
        if (qv && qv !== lastQueueVersion) lastQueueVersion = qv;
        if (queued && queued.length) ensurePlayback();

        // Legacy single-file playback fallback
        const v = j.tts_version ?? null;
        const ttsPath = j.tts_path || '/audio/tts_latest.wav';
        const lipSyncPath = j.tts_lipsync_path || '';
        if ((!q || !q.length) && v && v !== lastTtsVersion) {
          lastTtsVersion = v;
          const t0 = performance.now();
          pendingLipSyncUrl = lipSyncPath ? String(lipSyncPath) : '';
          audioStartPerfMs = performance.now();
          audioEl.src = `${ttsPath}?v=${encodeURIComponent(String(v))}`;

          // Load lipsync curve immediately (even if autoplay is blocked).
          if (pendingLipSyncUrl) {
            const url = pendingLipSyncUrl;
            currentLipSyncUrl = url;
            void (async () => {
              const curve = await loadLipSyncCurve(url, v);
              currentCurve = curve;
              if (!curve) setMouthNeutral();
            })();
          } else {
            currentLipSyncUrl = '';
            currentCurve = null;
            setMouthNeutral();
          }
          try {
            const onPlaying = () => {
              try {
                audioEl.removeEventListener('playing', onPlaying);
              } catch {
                // ignore
              }
              const dt = Math.round(performance.now() - t0);
              // eslint-disable-next-line no-console
              console.log('[aituber/perf] audio_playing', { tts_version: v, dt_ms: dt, tts_path: ttsPath });

              if (pendingLipSyncUrl) {
                const url = pendingLipSyncUrl;
                pendingLipSyncUrl = '';
                currentLipSyncUrl = url;
                void (async () => {
                  const curve = await loadLipSyncCurve(url, v);
                  currentCurve = curve;
                  if (!curve) setMouthNeutral();
                })();
              } else {
                currentLipSyncUrl = '';
                currentCurve = null;
                setMouthNeutral();
              }
            };
            audioEl.addEventListener('playing', onPlaying);
            await audioEl.play();
          } catch {
            // autoplay can be blocked; ignore
            setStatus('Audio blocked: click/tap once to enable.');
          }
        }
      } catch {
        // ignore
      } finally {
        setTimeout(pollOverlay, POLL_OVERLAY_MS);
      }
    }

    // Live2D state polling (motion triggers)
    let lastSeq = 0;
    async function pollLive2D() {
      try {
        const st = await safeJsonFetch('/state/live2d');
        const seq = Number(st.seq || 0);
        if (seq && seq !== lastSeq) {
          lastSeq = seq;
          if (st.last_tag) {
            playByTag(st.last_tag);
          }
        }
      } catch {
        // ignore
      } finally {
        setTimeout(pollLive2D, POLL_LIVE2D_MS);
      }
    }

    // Hide status by default; show only on errors.
    setStatus('');
    pollOverlay();
    pollLive2D();

    // Quick way to reach settings.
    document.addEventListener('dblclick', (ev) => {
      try {
        // Prevent any default double-click behavior from triggering navigation.
        if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
        if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
        if (ev && typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();

        // Using a real anchor click is more reliable than window.open across browsers.
        const a = document.createElement('a');
        a.href = '/console';
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        a.remove();
      } catch {
        // ignore
      }
    });

    stageLog('mouse setup', {
      mouseMode,
      removedEvents,
      focusPatched,
      modelInteractive: Boolean(model && model.interactive),
      dragEnabled,
      rootPointerEvents: rootEl ? rootEl.style.pointerEvents : '',
    });

    // Expose for manual testing in DevTools
    window.__aituberStage = { playByTag };
  }

  startStage();
})();
