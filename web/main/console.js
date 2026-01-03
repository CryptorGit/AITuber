(() => {
  const el = {
    cameraSelect: document.getElementById('cameraSelect'),
    micSelect: document.getElementById('micSelect'),
    sttEnabled: document.getElementById('sttEnabled'),
    video: document.getElementById('video'),
    frameCanvas: document.getElementById('frameCanvas'),
    vlmStatus: document.getElementById('vlmStatus'),
    manualText: document.getElementById('manualText'),
    sendManual: document.getElementById('sendManual'),
    speechStatus: document.getElementById('speechStatus'),
    sttText: document.getElementById('sttText'),
    motionSelect: document.getElementById('motionSelect'),
    motionSend: document.getElementById('motionSend'),
    motionStatus: document.getElementById('motionStatus'),
    outOverlay: document.getElementById('outOverlay'),
    outSpeech: document.getElementById('outSpeech'),
    outMeta: document.getElementById('outMeta'),
    modelPath: document.getElementById('modelPath'),
    modelSelect: document.getElementById('modelSelect'),
    browseModelFolder: document.getElementById('browseModelFolder'),
    modelFolderPicker: document.getElementById('modelFolderPicker'),
    refreshModels: document.getElementById('refreshModels'),
    applyModel: document.getElementById('applyModel'),
    stageBg: document.getElementById('stageBg'),
    overlayFont: document.getElementById('overlayFont'),
    mouseMode: document.getElementById('mouseMode'),
    vadEnabled: document.getElementById('vadEnabled'),
    vadThreshold: document.getElementById('vadThreshold'),
    vlmEnabled: document.getElementById('vlmEnabled'),
    ragEnabled: document.getElementById('ragEnabled'),
    shortTermMaxEvents: document.getElementById('shortTermMaxEvents'),
    ragReload: document.getElementById('ragReload'),
    ragStatus: document.getElementById('ragStatus'),
    ragShortTableBody: document.getElementById('ragShortTableBody'),
    ragLongTableBody: document.getElementById('ragLongTableBody'),
    ragItemType: document.getElementById('ragItemType'),
    ragItemTitle: document.getElementById('ragItemTitle'),
    ragItemText: document.getElementById('ragItemText'),
    ragItemAdd: document.getElementById('ragItemAdd'),

    shortTermEnabled: document.getElementById('shortTermEnabled'),
    shortTermTurnsToPrompt: document.getElementById('shortTermTurnsToPrompt'),

    turnsReload: document.getElementById('turnsReload'),
    turnsClear: document.getElementById('turnsClear'),
    turnsTableBody: document.getElementById('turnsTableBody'),

    // Prompts / params
    llmSystemPrompt: document.getElementById('llmSystemPrompt'),
    llmModel: document.getElementById('llmModel'),
    llmTemp: document.getElementById('llmTemp'),
    llmMaxTokens: document.getElementById('llmMaxTokens'),
    llmSave: document.getElementById('llmSave'),
    llmStatus: document.getElementById('llmStatus'),
    saveAllSettings: document.getElementById('saveAllSettings'),
    saveAllStatus: document.getElementById('saveAllStatus'),

    vlmSystemPrompt: document.getElementById('vlmSystemPrompt'),
    vlmModel: document.getElementById('vlmModel'),
    vlmTemp: document.getElementById('vlmTemp'),
    vlmMaxTokens: document.getElementById('vlmMaxTokens'),
    vlmSave: document.getElementById('vlmSave'),
    vlmPromptStatus: document.getElementById('vlmPromptStatus'),

    providerPreset: document.getElementById('providerPreset'),
    sttProvider: document.getElementById('sttProvider'),
    llmProvider: document.getElementById('llmProvider'),
    ttsProvider: document.getElementById('ttsProvider'),
  };

  let mediaStream = null;
  let recorder = null;
  let audioCtx = null;
  let audioSource = null;
  let audioProcessor = null;
  let pcmChunks = [];
  let pcmSampleRate = 48000;
  let sttTimer = null;
  let sttBusy = false;
  let sttBuffer = '';
  let sttAbortController = null;
  let submitBusy = false;

  // Last VLM summary shown in UI
  let lastVlmSummary = '';

  // Client-side timing / last-seen state for polling
  let lastSeenRunId = '';
  let lastSeenTtsVersion = null;

  function setVlmStatus(msg) {
    if (el.vlmStatus) el.vlmStatus.textContent = msg || '';
  }

  async function getVlmSummaryFromCamera() {
    const dataUrl = captureFrameDataUrl();
    if (!dataUrl) {
      return { ok: false, summary: '', error: 'camera_not_ready' };
    }
    try {
      const form = new FormData();
      form.append('image_base64', dataUrl);
      const j = await formPost('/vlm/frame', form, { method: 'POST' });
      if (j && j.ok && j.summary) {
        return { ok: true, summary: String(j.summary || '').trim(), error: null };
      }
      return { ok: false, summary: '', error: (j && j.error) || 'vlm_failed' };
    } catch (e) {
      return { ok: false, summary: '', error: e && e.message ? e.message : String(e) };
    }
  }

  function resetSttBuffer() {
    sttBuffer = '';
    if (el.sttText) el.sttText.value = '';
  }

  function appendSttText(part) {
    const t = String(part || '').trim();
    if (!t) return;
    if (sttBuffer && !sttBuffer.endsWith(' ')) sttBuffer += ' ';
    sttBuffer += t;
    if (el.sttText) el.sttText.value = sttBuffer;
  }

  function isGoogleStt() {
    return String(getSttProvider() || '').trim().toLowerCase() === 'google';
  }

  function encodeWavFloat32Mono(chunks, sampleRate) {
    let length = 0;
    for (const c of chunks) length += c.length;
    const pcm = new Float32Array(length);
    let offset = 0;
    for (const c of chunks) {
      pcm.set(c, offset);
      offset += c.length;
    }

    const bytesPerSample = 2;
    const blockAlign = 1 * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = pcm.length * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    function writeStr(off, s) {
      for (let i = 0; i < s.length; i += 1) view.setUint8(off + i, s.charCodeAt(i));
    }

    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true); // bits
    writeStr(36, 'data');
    view.setUint32(40, dataSize, true);

    let p = 44;
    for (let i = 0; i < pcm.length; i += 1) {
      let s = pcm[i];
      if (s > 1) s = 1;
      if (s < -1) s = -1;
      const v = s < 0 ? s * 0x8000 : s * 0x7fff;
      view.setInt16(p, v, true);
      p += 2;
    }

    return new Blob([buffer], { type: 'audio/wav' });
  }

  async function postSttWavAndSubmit(wav) {
    if (!wav || wav.size < 4000) return;
    if (sttBusy) return;
    sttBusy = true;
    try {
      if (el.speechStatus) el.speechStatus.textContent = 'STT: sending audio...';
      const form = new FormData();
      form.append('lang', 'ja-JP');
      form.append('file', wav, 'mic.wav');
      const vadOn = el.vadEnabled && el.vadEnabled.checked ? '1' : '0';
      const vadThr = el.vadThreshold ? String(el.vadThreshold.value || '0.01') : '0.01';
      form.append('vad_enabled', vadOn);
      form.append('vad_threshold', vadThr);
      form.append('stt_provider', getSttProvider());
      form.append('stt_enabled', el.sttEnabled && el.sttEnabled.checked ? '1' : '0');
      const vlmForce = el.vlmEnabled && el.vlmEnabled.checked ? '1' : '0';
      form.append('vlm_force', vlmForce);

      sttAbortController = new AbortController();
      const j = await formPost('/stt/audio', form, { signal: sttAbortController.signal });
      const text = j && j.ok ? String(j.text || '').trim() : '';
      const vlmSummary = j && j.vlm_summary ? String(j.vlm_summary || '').trim() : '';
      if (!text) {
        if (el.speechStatus) el.speechStatus.textContent = `STT: ${(j && j.error) || 'no_transcript'}`;
        return;
      }

      // Replace previous recognition (requested behavior for streaming).
      resetSttBuffer();
      appendSttText(text);
      if (el.speechStatus) el.speechStatus.textContent = `STT: ${text}`;
      await submitText(text, { vlmSummary });
    } catch (e) {
      if (e && e.name === 'AbortError') {
        if (el.speechStatus) el.speechStatus.textContent = 'STT: canceled.';
        return;
      }
      if (el.speechStatus) el.speechStatus.textContent = `STT error: ${e && e.message ? e.message : e}`;
    } finally {
      sttBusy = false;
      sttAbortController = null;
    }
  }

  async function stopRecorderAndMaybeSendFinal() {
    // Google STT: non-streaming (send once at the end).
    if (isGoogleStt() && pcmChunks && pcmChunks.length) {
      const chunks = pcmChunks;
      pcmChunks = [];
      const sr = pcmSampleRate;
      const wav = encodeWavFloat32Mono(chunks, sr);
      stopRecorder();
      await postSttWavAndSubmit(wav);
      return;
    }
    stopRecorder();
  }

  const PROVIDER_PRESETS = {
    local: { stt: 'local', llm: 'gemini', tts: 'google' },
    google: { stt: 'google', llm: 'gemini', tts: 'google' },
  };

  function getProviderValue(node, fallback) {
    if (!node) return fallback;
    const v = String(node.value || '').trim();
    return v || fallback;
  }

  function getSttProvider() {
    return getProviderValue(el.sttProvider, 'local');
  }

  function getLlmProvider() {
    return 'gemini';
  }

  function getTtsProvider() {
    return 'google';
  }

  function shouldIncludeVlm(_text, _summary) {
    return Boolean(el.vlmEnabled && el.vlmEnabled.checked);
  }

  function syncPresetFromProviders() {
    if (!el.providerPreset) return;
    const stt = getSttProvider();
    const llm = getLlmProvider();
    const tts = getTtsProvider();
    for (const key of Object.keys(PROVIDER_PRESETS)) {
      const p = PROVIDER_PRESETS[key];
      if (p.stt === stt && p.llm === llm && p.tts === tts) {
        el.providerPreset.value = key;
        return;
      }
    }
    el.providerPreset.value = '';
  }

  function applyProviderPreset(key) {
    const preset = PROVIDER_PRESETS[key];
    if (!preset) return;
    if (el.sttProvider) el.sttProvider.value = preset.stt;
    if (el.llmProvider) el.llmProvider.value = preset.llm;
    if (el.ttsProvider) el.ttsProvider.value = preset.tts;
  }

  async function syncProvidersToEnv() {
    try {
      await jsonFetch('/config/providers', {
        method: 'POST',
        body: JSON.stringify({
          stt_provider: getSttProvider(),
          llm_provider: getLlmProvider(),
          tts_provider: getTtsProvider(),
        }),
      });
    } catch {
      // ignore
    }
  }

  function setOutput({ overlay, speech, meta }) {
    if (el.outOverlay) el.outOverlay.textContent = overlay || '';
    if (el.outSpeech) el.outSpeech.textContent = speech || '';
    if (el.outMeta) el.outMeta.textContent = meta || '';
  }
  function renderState(state) {
    const st = state || {};
    const speech = st.speech_text || '';
    const overlay = speech || st.overlay_text || '';
    const provider = st.tts && st.tts.provider ? st.tts.provider : '';
    const ttsErr = st.tts && st.tts.error ? st.tts.error : '';
    const runId = st.last_run_id || '';
    lastSeenRunId = runId;
    lastSeenTtsVersion = st.tts_version ?? null;
    const meta = [
      runId ? `run_id=${runId}` : null,
      provider ? `tts=${provider}` : null,
      ttsErr ? `tts_error=${ttsErr}` : null,
    ]
      .filter(Boolean)
      .join(' / ');
    setOutput({ overlay, speech, meta });
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function pollForStateChange(prevRunId, prevVersion, trace) {
    const started = Date.now();
    while (Date.now() - started < 15000) {
      await sleep(250);
      try {
        const j = await jsonFetch('/state', { method: 'GET' });
        const st = j && j.ok ? j.state || {} : {};
        const nextRunId = st.last_run_id || '';
        const nextVersion = st.tts_version ?? null;
        if ((nextRunId && nextRunId !== prevRunId) || (nextVersion && nextVersion !== prevVersion)) {
          renderState(st);
          // Turns are inserted at the end of the server pipeline; refresh shortly after render.
          try {
            await sleep(500);
            await loadTurnsTable();
          } catch {
            // ignore
          }
          if (trace && trace.t0 != null) {
            const dt = Math.round(performance.now() - trace.t0);
            console.log(`[aituber/perf] click->full_render ${dt}ms`, {
              request_id: trace.request_id || '',
              last_run_id: nextRunId,
              tts_version: nextVersion,
            });
          }
          return;
        }
      } catch {
        // ignore
      }
    }

    // Timeout: render whatever we have so the UI doesn't stay stuck.
    try {
      const j = await jsonFetch('/state', { method: 'GET' });
      const st = j && j.ok ? j.state || {} : {};
      renderState(st);
      setOutput({ overlay: st.speech_text || st.overlay_text || '', speech: st.speech_text || '', meta: '応答待ちタイムアウト（stateを表示）' });
    } catch {
      setOutput({ overlay: '', speech: '', meta: '応答待ちタイムアウト（state取得失敗）' });
    }

    // No state change observed within window; surface it to the user.
    try {
      const rid = trace && trace.request_id ? String(trace.request_id) : '';
      const hint = rid ? ` (request_id=${rid})` : '';
      setOutput({ overlay: '', speech: '', meta: `タイムアウト: 返答が来ませんでした${hint}` });
    } catch {
      // ignore
    }
  }


  async function jsonFetch(url, opts) {
    const res = await fetch(url, {
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      ...opts,
    });
    return res.json();
  }

  async function formPost(url, form, opts = {}) {
    const res = await fetch(url, { method: 'POST', body: form, cache: 'no-store', ...opts });
    return res.json();
  }

  function persistStagePrefs() {
    const color = el.stageBg && el.stageBg.value ? el.stageBg.value : '#000000';
    try {
      localStorage.setItem('aituber.stage.bgColor', color);
      // legacy key for backward compatibility
      localStorage.setItem('aituber.stage.bg', color);
    } catch {
      // ignore
    }
  }

  function persistStageFont() {
    const v = el.overlayFont && el.overlayFont.value ? String(el.overlayFont.value) : 'system-ui';
    try {
      localStorage.setItem('aituber.stage.fontFamily', v);
    } catch {
      // ignore
    }
  }

  function loadPrefs() {
    // Manual input is intentionally NOT persisted.
    if (el.manualText) el.manualText.value = '';
    if (el.sttEnabled) el.sttEnabled.checked = localStorage.getItem('aituber.sttEnabled') === '1';
    if (el.modelPath) el.modelPath.value = localStorage.getItem('aituber.modelPath') || '';

    const legacyBg = localStorage.getItem('aituber.stage.bg') || '';
    const bgColor = localStorage.getItem('aituber.stage.bgColor') || legacyBg || '#000000';
    if (el.stageBg) el.stageBg.value = bgColor;

    const font = localStorage.getItem('aituber.stage.fontFamily') || 'system-ui';
    if (el.overlayFont) el.overlayFont.value = font;

    const mouseMode = localStorage.getItem('aituber.stage.mouseMode') || 'no_follow';
    if (el.mouseMode) el.mouseMode.value = mouseMode === 'no_input' ? 'no_input' : 'no_follow';

    const vadEnabled = localStorage.getItem('aituber.stt.vadEnabled');
    if (el.vadEnabled) el.vadEnabled.checked = vadEnabled !== '0';
    if (el.vadThreshold) {
      el.vadThreshold.value = localStorage.getItem('aituber.stt.vadThreshold') || '0.01';
    }
    if (el.vlmEnabled) {
      el.vlmEnabled.checked = localStorage.getItem('aituber.vlm.enabled') === '1';
    }
    if (el.ragEnabled) {
      el.ragEnabled.checked = localStorage.getItem('aituber.rag.enabled') === '1';
    }
    if (el.shortTermMaxEvents) {
      el.shortTermMaxEvents.value = localStorage.getItem('aituber.rag.shortTermMaxEvents') || '50';
    }

    if (el.sttProvider) el.sttProvider.value = localStorage.getItem('aituber.provider.stt') || 'local';
    if (el.llmProvider) el.llmProvider.value = localStorage.getItem('aituber.provider.llm') || 'gemini';
    if (el.ttsProvider) el.ttsProvider.value = localStorage.getItem('aituber.provider.tts') || 'google';
    if (el.providerPreset) el.providerPreset.value = localStorage.getItem('aituber.provider.preset') || '';
    syncPresetFromProviders();
  }

  function savePrefs() {
    if (el.modelPath) localStorage.setItem('aituber.modelPath', String(el.modelPath.value || '').trim());
    persistStagePrefs();
    persistStageFont();
    if (el.mouseMode) {
      localStorage.setItem('aituber.stage.mouseMode', String(el.mouseMode.value || 'no_follow'));
    }
    if (el.vadEnabled) {
      localStorage.setItem('aituber.stt.vadEnabled', el.vadEnabled.checked ? '1' : '0');
    }
    if (el.vadThreshold) {
      localStorage.setItem('aituber.stt.vadThreshold', String(el.vadThreshold.value || '0.01'));
    }
    if (el.sttProvider) {
      localStorage.setItem('aituber.provider.stt', String(el.sttProvider.value || 'local'));
    }
    if (el.llmProvider) {
      localStorage.setItem('aituber.provider.llm', String(el.llmProvider.value || 'gemini'));
    }
    if (el.ttsProvider) {
      localStorage.setItem('aituber.provider.tts', String(el.ttsProvider.value || 'google'));
    }
    if (el.providerPreset) {
      localStorage.setItem('aituber.provider.preset', String(el.providerPreset.value || ''));
    }
  }

  function setModelPath(p) {
    const v = String(p || '').trim();
    if (el.modelPath) el.modelPath.value = v;
    try {
      localStorage.setItem('aituber.modelPath', v);
    } catch {
      // ignore
    }
  }

  async function refreshModelIndex(selectPath) {
    if (!el.modelSelect) return;
    try {
      const j = await jsonFetch('/api/models/index', { method: 'GET' });
      const items = (j && j.ok && Array.isArray(j.items) ? j.items : []).filter(Boolean);

      el.modelSelect.innerHTML = '';
      for (const it of items) {
        const opt = document.createElement('option');
        opt.value = it;
        opt.textContent = it;
        el.modelSelect.appendChild(opt);
      }

      const desired = (selectPath || (el.modelPath && el.modelPath.value) || '').trim();
      if (desired && items.includes(desired)) {
        el.modelSelect.value = desired;
        setModelPath(desired);
      } else if ((!desired || !(items || []).includes(desired)) && items.length) {
        // Auto pick first if nothing is set
        el.modelSelect.value = items[0];
        setModelPath(items[0]);
      } else if (!items.length) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = '(web/models に .model3.json が見つかりません)';
        el.modelSelect.appendChild(opt);
      }
    } catch (e) {
      el.modelSelect.innerHTML = '';
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = `一覧取得失敗: ${e && e.message ? e.message : e}`;
      el.modelSelect.appendChild(opt);
    }
  }

  async function refreshDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams = devices.filter((d) => d.kind === 'videoinput');
    const mics = devices.filter((d) => d.kind === 'audioinput');

    if (el.cameraSelect) {
      el.cameraSelect.innerHTML = '';
      for (const c of cams) {
        const opt = document.createElement('option');
        opt.value = c.deviceId;
        opt.textContent = c.label || `camera:${c.deviceId.slice(0, 8)}`;
        el.cameraSelect.appendChild(opt);
      }
    }

    if (el.micSelect) {
      el.micSelect.innerHTML = '';
      for (const m of mics) {
        const opt = document.createElement('option');
        opt.value = m.deviceId;
        opt.textContent = m.label || `mic:${m.deviceId.slice(0, 8)}`;
        el.micSelect.appendChild(opt);
      }
    }
  }

  async function startPreview() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    if (mediaStream) {
      mediaStream.getTracks().forEach((t) => t.stop());
      mediaStream = null;
    }

    const camId = (el.cameraSelect && el.cameraSelect.value) || undefined;
    const micId = (el.micSelect && el.micSelect.value) || undefined;

    const constraints = {
      video: camId ? { deviceId: { exact: camId }, width: 640, height: 360 } : true,
      audio: micId ? { deviceId: { exact: micId } } : true,
    };

    mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
    if (el.video) el.video.srcObject = mediaStream;

    try {
      if (camId) localStorage.setItem('aituber.cameraId', camId);
      if (micId) localStorage.setItem('aituber.micId', micId);
    } catch {
      // ignore
    }
  }

  function captureFrameDataUrl() {
    if (!el.video || !el.frameCanvas || !el.video.videoWidth || !el.video.videoHeight) return '';
    const w = 640;
    const h = Math.round((el.video.videoHeight / el.video.videoWidth) * w);
    el.frameCanvas.width = w;
    el.frameCanvas.height = h;
    const ctx = el.frameCanvas.getContext('2d');
    ctx.drawImage(el.video, 0, 0, w, h);
    return el.frameCanvas.toDataURL('image/jpeg', 0.75);
  }

  async function submitText(text, opts = {}) {
    const t = String(text || '').trim();
    if (!t) return;
    if (submitBusy) return;
    submitBusy = true;

    const trace = { t0: performance.now(), request_id: '' };
    const prevRunId = lastSeenRunId;
    const prevVersion = lastSeenTtsVersion;

    setVlmStatus('');
    setOutput({ overlay: '', speech: '', meta: '生成中...' });

    try {
      let vlmSummary = String((opts && opts.vlmSummary) || '').trim();
      const includeVlm = shouldIncludeVlm(t, vlmSummary);
      const llmProvider = 'gemini';
      const ttsProvider = 'google';

      if (includeVlm && !vlmSummary) {
        setVlmStatus('VLM: capturing frame...');
        const r = await getVlmSummaryFromCamera();
        if (r.ok && r.summary) {
          vlmSummary = r.summary;
          lastVlmSummary = vlmSummary;
          setVlmStatus('VLM: ' + vlmSummary);
        } else {
          setVlmStatus('VLM: failed (' + (r.error || 'unknown') + ')');
        }
      } else if (includeVlm && vlmSummary) {
        lastVlmSummary = vlmSummary;
        setVlmStatus('VLM: ' + vlmSummary);
      } else {
        // VLM disabled
        if (lastVlmSummary) {
          setVlmStatus('VLM: off (last summary kept)');
        } else {
          setVlmStatus('');
        }
      }

      const j = await jsonFetch('/web/submit', {
        method: 'POST',
        body: JSON.stringify({
          text: t,
          include_vlm: includeVlm,
          // We summarize via /vlm/frame; send summary to the server pipeline.
          vlm_image_base64: null,
          vlm_summary: vlmSummary || null,
          llm_provider: 'gemini',
          tts_provider: 'google',
        }),
      });

      const t1 = performance.now();

      if (!j || !j.ok) {
        setOutput({ overlay: '', speech: '', meta: `送信失敗: ${(j && j.error) || 'unknown'}` });
        return;
      }

      trace.request_id = (j.request_id || '') + '';
      console.log(`[aituber/perf] click->submit_ack ${Math.round(t1 - trace.t0)}ms`, {
        request_id: trace.request_id,
        llm_provider: llmProvider,
        tts_provider: ttsProvider,
      });

      if (includeVlm) {
        setVlmStatus(vlmSummary ? 'VLM: ' + vlmSummary : 'VLM: requested (no summary)');
      }

      // ACK is abolished: keep "生成中..." and wait for state change.
      void pollForStateChange(prevRunId, prevVersion, trace);
    } catch (e) {
      setOutput({ overlay: '', speech: '', meta: `エラー: ${e && e.message ? e.message : e}` });
    } finally {
      submitBusy = false;
    }
  }

  function stopRecorder() {
    // Stop old MediaRecorder path (kept for safety)
    try {
      if (recorder && recorder.state !== 'inactive') recorder.stop();
    } catch {
      // ignore
    }
    recorder = null;

    // Stop WebAudio capture
    try {
      if (sttTimer) clearInterval(sttTimer);
    } catch {
      // ignore
    }
    sttTimer = null;
    if (sttAbortController) {
      try {
        sttAbortController.abort();
      } catch {
        // ignore
      }
      sttAbortController = null;
    }

    try {
      if (audioProcessor) audioProcessor.disconnect();
      if (audioSource) audioSource.disconnect();
    } catch {
      // ignore
    }
    audioProcessor = null;
    audioSource = null;
    pcmChunks = [];

    try {
      if (audioCtx && audioCtx.state !== 'closed') audioCtx.close();
    } catch {
      // ignore
    }
    audioCtx = null;
  }

  async function startRecorder() {
    if (!el.speechStatus) return;
    if (!mediaStream) {
      el.speechStatus.textContent = 'STT: mediaStream not ready.';
      return;
    }
    const tracks = mediaStream.getAudioTracks();
    if (!tracks || !tracks.length) {
      el.speechStatus.textContent = 'STT: no audio track (check mic permission/selection).';
      return;
    }
    resetSttBuffer();

    // WebAudio PCM capture -> WAV (no ffmpeg required)
    if (!window.AudioContext && !window.webkitAudioContext) {
      el.speechStatus.textContent = 'STT: AudioContext not supported.';
      return;
    }

    const AC = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AC();
    pcmSampleRate = audioCtx.sampleRate || 48000;
    const audioOnly = new MediaStream([tracks[0]]);
    audioSource = audioCtx.createMediaStreamSource(audioOnly);

    // ScriptProcessor is deprecated but works widely and is enough here.
    const bufferSize = 4096;
    audioProcessor = audioCtx.createScriptProcessor(bufferSize, 1, 1);
    pcmChunks = [];

    audioProcessor.onaudioprocess = (e) => {
      if (!el.sttEnabled || !el.sttEnabled.checked) return;
      const input = e.inputBuffer.getChannelData(0);
      pcmChunks.push(new Float32Array(input));
    };

    // Keep processor alive.
    const gain = audioCtx.createGain();
    gain.gain.value = 0;
    audioSource.connect(audioProcessor);
    audioProcessor.connect(gain);
    gain.connect(audioCtx.destination);

    async function flushChunk() {
      if (!el.sttEnabled || !el.sttEnabled.checked) return;
      if (sttBusy) return;
      if (!pcmChunks.length) return;

      // google: do not stream; send once when recording stops.
      if (isGoogleStt()) return;

      // Take snapshot and clear
      const chunks = pcmChunks;
      pcmChunks = [];
      const wav = encodeWavFloat32Mono(chunks, pcmSampleRate);
      await postSttWavAndSubmit(wav);
    }

    // Send chunk every ~0.8s (except google: non-stream)
    if (isGoogleStt()) {
      sttTimer = null;
      el.speechStatus.textContent = 'STT: recording started (google, non-stream).';
    } else {
      sttTimer = setInterval(flushChunk, 800);
      el.speechStatus.textContent = 'STT: recording started (streaming).';
    }
  }

  async function loadHotkeysAndRenderSelect() {
    if (!el.motionSelect) return;
    try {
      const hotkeys = await jsonFetch('./hotkeys.json', { method: 'GET' });
      const tags = Object.keys(hotkeys || {});
      el.motionSelect.innerHTML = '';
      for (const tag of tags) {
        const opt = document.createElement('option');
        opt.value = tag;
        opt.textContent = tag;
        el.motionSelect.appendChild(opt);
      }
      if (!tags.length) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = '(hotkeys.json が空)';
        el.motionSelect.appendChild(opt);
      }
    } catch {
      el.motionSelect.innerHTML = '';
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'hotkeys.json load failed.';
      el.motionSelect.appendChild(opt);
    }
  }

  function setStatusEl(statusEl, msg) {
    if (statusEl) statusEl.textContent = msg || '';
  }

  function toNumber(val) {
    const n = Number(val);
    return Number.isFinite(n) ? n : null;
  }

  function toInt(val) {
    const n = parseInt(String(val || ''), 10);
    return Number.isFinite(n) ? n : null;
  }

  function buildSettingsPayload() {
    const llmTemp = toNumber(el.llmTemp && el.llmTemp.value);
    const llmMax = toInt(el.llmMaxTokens && el.llmMaxTokens.value);
    const vlmTemp = toNumber(el.vlmTemp && el.vlmTemp.value);
    const vlmMax = toInt(el.vlmMaxTokens && el.vlmMaxTokens.value);
    const shortMax = toInt(el.shortTermMaxEvents && el.shortTermMaxEvents.value);
    const turnsToPrompt = toInt(el.shortTermTurnsToPrompt && el.shortTermTurnsToPrompt.value);

    return {
      providers: {
        stt: getSttProvider(),
        llm: getLlmProvider(),
        tts: getTtsProvider(),
      },
      llm: {
        system_prompt: String((el.llmSystemPrompt && el.llmSystemPrompt.value) || ''),
        model: String((el.llmModel && el.llmModel.value) || ''),
        temperature: llmTemp ?? 0.7,
        max_output_tokens: llmMax ?? 1024,
      },
      vlm: {
        system_prompt: String((el.vlmSystemPrompt && el.vlmSystemPrompt.value) || ''),
        model: String((el.vlmModel && el.vlmModel.value) || ''),
        temperature: vlmTemp ?? 0.2,
        max_output_tokens: vlmMax ?? 256,
      },
      toggles: {
        stt: Boolean(el.sttEnabled && el.sttEnabled.checked),
        vlm: Boolean(el.vlmEnabled && el.vlmEnabled.checked),
        rag: Boolean(el.ragEnabled && el.ragEnabled.checked),
        short_term: Boolean(el.shortTermEnabled && el.shortTermEnabled.checked),
      },
      rag: {
        short_term_max_events: shortMax ?? 50,
        short_term_turns_to_prompt: turnsToPrompt ?? 8,
      },
    };
  }

  async function saveAllSettings() {
    if (!el.saveAllStatus) return;
    setStatusEl(el.saveAllStatus, 'saving...');
    try {
      const payload = buildSettingsPayload();
      const j = await jsonFetch('/config/save_all', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (j && j.ok) {
        setStatusEl(el.saveAllStatus, 'saved');
      } else {
        setStatusEl(el.saveAllStatus, `save failed: ${(j && j.error) || 'unknown'}`);
      }
    } catch (e) {
      setStatusEl(el.saveAllStatus, `save error: ${e && e.message ? e.message : e}`);
    }
  }

  function applySettings(settings) {
    const s = settings || {};
    const providers = s.providers || {};
    if (el.sttProvider) el.sttProvider.value = String(providers.stt || 'local');
    if (el.llmProvider) el.llmProvider.value = String(providers.llm || 'gemini');
    if (el.ttsProvider) el.ttsProvider.value = String(providers.tts || 'google');

    const llm = s.llm || {};
    if (el.llmSystemPrompt) el.llmSystemPrompt.value = String(llm.system_prompt || '');
    if (el.llmModel) el.llmModel.value = String(llm.model || '');
    if (el.llmTemp && llm.temperature != null) el.llmTemp.value = String(llm.temperature);
    if (el.llmMaxTokens && llm.max_output_tokens != null) el.llmMaxTokens.value = String(llm.max_output_tokens);

    const vlm = s.vlm || {};
    if (el.vlmSystemPrompt) el.vlmSystemPrompt.value = String(vlm.system_prompt || '');
    if (el.vlmModel) el.vlmModel.value = String(vlm.model || '');
    if (el.vlmTemp && vlm.temperature != null) el.vlmTemp.value = String(vlm.temperature);
    if (el.vlmMaxTokens && vlm.max_output_tokens != null) el.vlmMaxTokens.value = String(vlm.max_output_tokens);

    const toggles = s.toggles || {};
    if (el.sttEnabled) el.sttEnabled.checked = Boolean(toggles.stt);
    if (el.vlmEnabled) el.vlmEnabled.checked = Boolean(toggles.vlm);
    if (el.ragEnabled) el.ragEnabled.checked = Boolean(toggles.rag);
    if (el.shortTermEnabled) el.shortTermEnabled.checked = Boolean(toggles.short_term);

    const rag = s.rag || {};
    if (el.shortTermMaxEvents) {
      const v = rag.short_term_max_events != null ? rag.short_term_max_events : 50;
      el.shortTermMaxEvents.value = String(v);
    }
    if (el.shortTermTurnsToPrompt) {
      const v = rag.short_term_turns_to_prompt != null ? rag.short_term_turns_to_prompt : 8;
      el.shortTermTurnsToPrompt.value = String(v);
    }
  }

  async function loadAllSettings() {
    if (el.saveAllStatus) setStatusEl(el.saveAllStatus, 'loading...');
    try {
      const j = await jsonFetch('/config/load_all', { method: 'GET' });
      if (j && j.ok) {
        applySettings(j.settings || {});
        if (el.saveAllStatus) setStatusEl(el.saveAllStatus, 'loaded');
        syncPresetFromProviders();
      } else if (el.saveAllStatus) {
        setStatusEl(el.saveAllStatus, `load failed: ${(j && j.error) || 'unknown'}`);
      }
    } catch (e) {
      if (el.saveAllStatus) setStatusEl(el.saveAllStatus, `load error: ${e && e.message ? e.message : e}`);
    }
  }

  function renderRagTable(bodyEl, items) {
    if (!bodyEl) return;
    bodyEl.innerHTML = '';
    const rows = Array.isArray(items) ? items : [];
    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      td.textContent = 'No records.';
      tr.appendChild(td);
      bodyEl.appendChild(tr);
      return;
    }
    for (const item of rows) {
      const tr = document.createElement('tr');
      const rowId = String((item && item.id) || '');
      const title = String((item && item.title) || '');
      const created = String((item && item.created_at) || '');
      const preview = String((item && item.text) || '');

      const tdId = document.createElement('td');
      tdId.textContent = rowId;
      const tdTitle = document.createElement('td');
      tdTitle.textContent = title;
      const tdCreated = document.createElement('td');
      tdCreated.textContent = created;
      const tdPreview = document.createElement('td');
      tdPreview.textContent = preview;
      const tdActions = document.createElement('td');
      const delBtn = document.createElement('button');
      delBtn.textContent = 'Delete';
      delBtn.className = 'btn-inline';
      delBtn.onclick = async () => deleteRagItem(rowId);
      tdActions.appendChild(delBtn);

      tr.appendChild(tdId);
      tr.appendChild(tdTitle);
      tr.appendChild(tdCreated);
      tr.appendChild(tdPreview);
      tr.appendChild(tdActions);
      bodyEl.appendChild(tr);
    }
  }

  async function deleteRagItem(id) {
    if (!id) return;
    setStatusEl(el.ragStatus, 'deleting...');
    try {
      const j = await jsonFetch('/rag/delete', {
        method: 'POST',
        body: JSON.stringify({ id }),
      });
      if (j && j.ok) {
        setStatusEl(el.ragStatus, 'deleted');
        await loadRagTable();
      } else {
        setStatusEl(el.ragStatus, `delete failed: ${(j && j.error) || 'unknown'}`);
      }
    } catch (e) {
      setStatusEl(el.ragStatus, `delete error: ${e && e.message ? e.message : e}`);
    }
  }

  async function addRagItem() {
    const ragType = String((el.ragItemType && el.ragItemType.value) || 'short');
    const title = String((el.ragItemTitle && el.ragItemTitle.value) || '');
    const text = String((el.ragItemText && el.ragItemText.value) || '');
    if (!text.trim()) return;
    setStatusEl(el.ragStatus, 'adding...');
    try {
      const j = await jsonFetch('/rag/add', {
        method: 'POST',
        body: JSON.stringify({ rag_type: ragType, title, text }),
      });
      if (j && j.ok) {
        setStatusEl(el.ragStatus, `added (id=${j.id})`);
        if (el.ragItemTitle) el.ragItemTitle.value = '';
        if (el.ragItemText) el.ragItemText.value = '';
        await loadRagTables();
      } else {
        setStatusEl(el.ragStatus, `add failed: ${(j && j.error) || 'unknown'}`);
      }
    } catch (e) {
      setStatusEl(el.ragStatus, `add error: ${e && e.message ? e.message : e}`);
    }
  }

  async function loadRagTables() {
    setStatusEl(el.ragStatus, 'loading...');
    try {
      const js = await jsonFetch('/rag/list?type=short', { method: 'GET' });
      const jl = await jsonFetch('/rag/list?type=long', { method: 'GET' });
      if (js && js.ok) renderRagTable(el.ragShortTableBody, js.items || []);
      if (jl && jl.ok) renderRagTable(el.ragLongTableBody, jl.items || []);
      setStatusEl(el.ragStatus, 'loaded');
    } catch {
      renderRagTable(el.ragShortTableBody, []);
      renderRagTable(el.ragLongTableBody, []);
      setStatusEl(el.ragStatus, 'load failed');
    }
    await loadTurnsTable();
  }

  function renderTurnsTable(items) {
    if (!el.turnsTableBody) return;
    el.turnsTableBody.innerHTML = '';
    const rows = Array.isArray(items) ? items : [];
    if (!rows.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      td.textContent = 'No turns.';
      tr.appendChild(td);
      el.turnsTableBody.appendChild(tr);
      return;
    }
    for (const item of rows) {
      const tr = document.createElement('tr');
      const rowId = String((item && item.id) || '');
      const created = String((item && item.created_at) || '');
      const userText = String((item && item.user_text) || '');
      const assistantText = String((item && item.assistant_text) || '');

      const tdId = document.createElement('td');
      tdId.textContent = rowId;
      const tdCreated = document.createElement('td');
      tdCreated.textContent = created;
      const tdUser = document.createElement('td');
      tdUser.textContent = userText;
      const tdAsst = document.createElement('td');
      tdAsst.textContent = assistantText;
      const tdActions = document.createElement('td');
      const delBtn = document.createElement('button');
      delBtn.textContent = 'Delete';
      delBtn.className = 'btn-inline';
      delBtn.onclick = async () => deleteTurnRow(rowId);
      tdActions.appendChild(delBtn);

      tr.appendChild(tdId);
      tr.appendChild(tdCreated);
      tr.appendChild(tdUser);
      tr.appendChild(tdAsst);
      tr.appendChild(tdActions);
      el.turnsTableBody.appendChild(tr);
    }
  }

  async function deleteTurnRow(rowId) {
    if (!rowId) return;
    setStatusEl(el.ragStatus, 'deleting turn...');
    try {
      const j = await jsonFetch('/turns/delete', {
        method: 'POST',
        body: JSON.stringify({ id: rowId }),
      });
      if (j && j.ok) {
        setStatusEl(el.ragStatus, 'turn deleted');
        await loadTurnsTable();
      } else {
        setStatusEl(el.ragStatus, `delete failed: ${(j && j.error) || 'unknown'}`);
      }
    } catch (e) {
      setStatusEl(el.ragStatus, `delete error: ${e && e.message ? e.message : e}`);
    }
  }

  async function loadTurnsTable() {
    if (!el.turnsTableBody) return;
    try {
      const j = await jsonFetch('/turns/list?limit=200', { method: 'GET' });
      if (j && j.ok) renderTurnsTable(j.items || []);
      else renderTurnsTable([]);
    } catch {
      renderTurnsTable([]);
    }
  }

  async function main() {
    loadPrefs();
    await loadAllSettings();

    await refreshModelIndex();
    if (el.refreshModels) el.refreshModels.onclick = () => refreshModelIndex();
    if (el.modelSelect) {
      el.modelSelect.onchange = () => {
        const p = String(el.modelSelect.value || '').trim();
        if (p) setModelPath(p);
      };
    }

    if (el.browseModelFolder && el.modelFolderPicker) {
      el.browseModelFolder.onclick = () => el.modelFolderPicker.click();
      el.modelFolderPicker.onchange = async () => {
        const files = Array.from(el.modelFolderPicker.files || []);
        if (!files.length) return;

        const form = new FormData();
        for (const f of files) {
          const rel = f.webkitRelativePath || f.name;
          form.append('files', f, rel);
        }

        setOutput({ overlay: '', speech: '', meta: `モデルアップロード中... (${files.length} files)` });
        try {
          const up = await formPost('/api/models/upload', form);
          if (!up || !up.ok) {
            setOutput({ overlay: '', speech: '', meta: `アップロード失敗: ${(up && up.error) || 'unknown'}` });
            return;
          }
          const rels = files.map((f) => (f.webkitRelativePath || f.name || '').replace(/\\/g, '/'));
          const model3 = rels.filter((p) => p.toLowerCase().endsWith('.model3.json')).sort((a, b) => a.length - b.length);
          const picked = model3[0] ? model3[0].replace(/^\//, '') : '';
          await refreshModelIndex(picked);
          if (picked) setModelPath(picked);
          setOutput({ overlay: '', speech: '', meta: picked ? `モデル選択: ${picked}` : 'アップロード完了（model3.json 未検出）' });
        } catch (e) {
          setOutput({ overlay: '', speech: '', meta: `アップロードエラー: ${e && e.message ? e.message : e}` });
        } finally {
          el.modelFolderPicker.value = '';
        }
      };
    }

    if (el.applyModel) {
      el.applyModel.onclick = () => {
        savePrefs();
        alert('Saved. Open /stage to see the model.');
      };
    }

    if (el.stageBg) el.stageBg.onchange = () => persistStagePrefs();
    if (el.overlayFont) el.overlayFont.onchange = () => persistStageFont();

    if (el.mouseMode) {
      el.mouseMode.onchange = () => {
        try {
          localStorage.setItem('aituber.stage.mouseMode', String(el.mouseMode.value || 'no_follow'));
        } catch {
          // ignore
        }
      };
    }

    if (el.vadEnabled) {
      el.vadEnabled.onchange = () => {
        try {
          localStorage.setItem('aituber.stt.vadEnabled', el.vadEnabled.checked ? '1' : '0');
        } catch {
          // ignore
        }
      };
    }

    if (el.vadThreshold) {
      el.vadThreshold.onchange = () => {
        try {
          localStorage.setItem('aituber.stt.vadThreshold', String(el.vadThreshold.value || '0.01'));
        } catch {
          // ignore
        }
      };
    }

    if (el.vlmEnabled) {
      el.vlmEnabled.onchange = () => {
        try {
          localStorage.setItem('aituber.vlm.enabled', el.vlmEnabled.checked ? '1' : '0');
        } catch {
          // ignore
        }
      };
    }

    if (el.providerPreset) {
      el.providerPreset.onchange = () => {
        const key = String(el.providerPreset.value || '').trim();
        if (key) applyProviderPreset(key);
        savePrefs();
        syncPresetFromProviders();
        syncProvidersToEnv();
      };
    }

    if (el.sttProvider) {
      el.sttProvider.onchange = () => {
        savePrefs();
        syncPresetFromProviders();
        syncProvidersToEnv();
      };
    }

    if (el.llmProvider) {
      el.llmProvider.onchange = () => {
        savePrefs();
        syncPresetFromProviders();
        syncProvidersToEnv();
      };
    }

    if (el.ttsProvider) {
      el.ttsProvider.onchange = () => {
        savePrefs();
        syncPresetFromProviders();
        syncProvidersToEnv();
      };
    }

    if (el.saveAllSettings) {
      el.saveAllSettings.onclick = async () => {
        await saveAllSettings();
      };
    }
    if (el.llmSave) {
      el.llmSave.onclick = async () => {
        await saveAllSettings();
      };
    }
    if (el.vlmSave) {
      el.vlmSave.onclick = async () => {
        await saveAllSettings();
      };
    }
    if (el.ragReload) {
      el.ragReload.onclick = async () => {
        await loadRagTables();
      };
    }

    if (el.ragItemAdd) {
      el.ragItemAdd.onclick = async () => {
        await addRagItem();
      };
    }

    if (el.turnsReload) {
      el.turnsReload.onclick = async () => {
        await loadTurnsTable();
      };
    }

    if (el.turnsClear) {
      el.turnsClear.onclick = async () => {
        try {
          await jsonFetch('/turns/clear', { method: 'POST', body: JSON.stringify({}) });
        } catch {
          // ignore
        }
        await loadTurnsTable();
      };
    }
    if (el.ragEnabled) {
      el.ragEnabled.onchange = () => {
        try {
          localStorage.setItem('aituber.rag.enabled', el.ragEnabled.checked ? '1' : '0');
        } catch {
          // ignore
        }
      };
    }
    if (el.shortTermEnabled) {
      el.shortTermEnabled.onchange = () => {
        try {
          localStorage.setItem('aituber.shortTerm.enabled', el.shortTermEnabled.checked ? '1' : '0');
        } catch {
          // ignore
        }
      };
    }
    if (el.shortTermMaxEvents) {
      el.shortTermMaxEvents.onchange = () => {
        try {
          localStorage.setItem('aituber.rag.shortTermMaxEvents', String(el.shortTermMaxEvents.value || '50'));
        } catch {
          // ignore
        }
        loadTurnsTable();
      };
    }
    if (el.shortTermTurnsToPrompt) {
      el.shortTermTurnsToPrompt.onchange = () => {
        try {
          localStorage.setItem('aituber.rag.shortTermTurnsToPrompt', String(el.shortTermTurnsToPrompt.value || '8'));
        } catch {
          // ignore
        }
      };
    }

    // Manual input is not persisted.

    // Ask permission so labels are visible.
    try {
      await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch {
      // ignore
    }

    await refreshDevices();
    try {
      const savedCam = localStorage.getItem('aituber.cameraId');
      const savedMic = localStorage.getItem('aituber.micId');
      if (savedCam && el.cameraSelect) el.cameraSelect.value = savedCam;
      if (savedMic && el.micSelect) el.micSelect.value = savedMic;
    } catch {
      // ignore
    }

    if (el.cameraSelect) el.cameraSelect.onchange = () => startPreview();
    if (el.micSelect) {
      el.micSelect.onchange = async () => {
        await startPreview();
        if (el.sttEnabled && el.sttEnabled.checked) {
          stopRecorder();
          startRecorder();
        }
      };
    }

    await startPreview();

    if (el.sendManual) {
      el.sendManual.onclick = async () => {
        const text = (el.manualText && el.manualText.value ? el.manualText.value : '').trim();
        if (!text) return;
        await submitText(text);
      };
    }

    if (el.sttEnabled) {
      el.sttEnabled.onchange = () => {
        try {
          localStorage.setItem('aituber.sttEnabled', el.sttEnabled.checked ? '1' : '0');
        } catch {
          // ignore
        }
        if (el.sttEnabled.checked) {
          stopRecorder();
          startRecorder();
        } else {
          void stopRecorderAndMaybeSendFinal();
          if (el.speechStatus) el.speechStatus.textContent = 'STT stopped.';
        }
      };
    }

    if (el.motionSend) {
      el.motionSend.onclick = async () => {
        const tag = String((el.motionSelect && el.motionSelect.value) || '').trim();
        if (!tag) return;
        if (el.motionStatus) el.motionStatus.textContent = 'sending...';
        try {
          const j = await jsonFetch('/motion', { method: 'POST', body: JSON.stringify({ tag }) });
          if (el.motionStatus) el.motionStatus.textContent = j && j.ok ? `ok (seq=${j.seq})` : `error: ${(j && j.error) || 'unknown'}`;
        } catch (e) {
          if (el.motionStatus) el.motionStatus.textContent = `error: ${e && e.message ? e.message : e}`;
        }
      };
    }

    await loadHotkeysAndRenderSelect();

    await loadRagTables();

    // Default OFF, but resume if user saved ON
    if (el.sttEnabled && el.sttEnabled.checked) startRecorder();
  }

  main();
})();
