/* global PIXI */

(function () {
  const overlayEl = document.getElementById('overlayText');
  const statusEl = document.getElementById('status');
  const audioEl = document.getElementById('ttsAudio');
  const canvas = document.getElementById('l2dCanvas');

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
      audioEl.src = `${path}?v=${encodeURIComponent(String(v))}`;
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
      ensurePlayback();
    });

    audioEl.addEventListener('error', () => {
      playing = false;
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
        if ((!q || !q.length) && v && v !== lastTtsVersion) {
          lastTtsVersion = v;
          const t0 = performance.now();
          audioEl.src = `${ttsPath}?v=${encodeURIComponent(String(v))}`;
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
