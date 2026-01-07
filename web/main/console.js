(() => {
  const STT_GOOGLE_VALUE = '__google__';

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
    whisperDevice: document.getElementById('whisperDevice'),
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
    vlmModelAdd: document.getElementById('vlmModelAdd'),
    vlmModelAddBtn: document.getElementById('vlmModelAddBtn'),
    vlmModelRemoveBtn: document.getElementById('vlmModelRemoveBtn'),
    vlmTemp: document.getElementById('vlmTemp'),
    vlmMaxTokens: document.getElementById('vlmMaxTokens'),
    vlmSave: document.getElementById('vlmSave'),
    vlmPromptStatus: document.getElementById('vlmPromptStatus'),

    llmModelAdd: document.getElementById('llmModelAdd'),
    llmModelAddBtn: document.getElementById('llmModelAddBtn'),
    llmModelRemoveBtn: document.getElementById('llmModelRemoveBtn'),

    sttModel: document.getElementById('sttModel'),
    sttModelAdd: document.getElementById('sttModelAdd'),
    sttModelAddBtn: document.getElementById('sttModelAddBtn'),
    sttModelRemoveBtn: document.getElementById('sttModelRemoveBtn'),
    sttLanguage: document.getElementById('sttLanguage'),

    vadThreshold: document.getElementById('vadThreshold'),
    vadSilenceThreshold: document.getElementById('vadSilenceThreshold'),
    vadMinSpeechMs: document.getElementById('vadMinSpeechMs'),
    vadMinSilenceMs: document.getElementById('vadMinSilenceMs'),
    vadSpeechPadMs: document.getElementById('vadSpeechPadMs'),
    vadFrameMs: document.getElementById('vadFrameMs'),
    vadSampleRate: document.getElementById('vadSampleRate'),
    vadMaxBufferMs: document.getElementById('vadMaxBufferMs'),
    vadModelPath: document.getElementById('vadModelPath'),
    vadDevice: document.getElementById('vadDevice'),
    vadFallbackMinAmp: document.getElementById('vadFallbackMinAmp'),
    vadFallbackMinRms: document.getElementById('vadFallbackMinRms'),

    sttVoiceRmsThreshold: document.getElementById('sttVoiceRmsThreshold'),
    sttSilenceMs: document.getElementById('sttSilenceMs'),
    sttMinUtteranceMs: document.getElementById('sttMinUtteranceMs'),
    sttMaxUtteranceMs: document.getElementById('sttMaxUtteranceMs'),
    sttPreRollMs: document.getElementById('sttPreRollMs'),
    sttTickMs: document.getElementById('sttTickMs'),
    sttBufferSize: document.getElementById('sttBufferSize'),
    sttSubmitTimeoutMs: document.getElementById('sttSubmitTimeoutMs'),

    ttsProvider: document.getElementById('ttsProvider'),
    ttsVoice: document.getElementById('ttsVoice'),
    ttsVoiceAdd: document.getElementById('ttsVoiceAdd'),
    ttsVoiceAddBtn: document.getElementById('ttsVoiceAddBtn'),
    ttsVoiceRemoveBtn: document.getElementById('ttsVoiceRemoveBtn'),
  };

  let mediaStream = null;
  let recorder = null;
  let audioCtx = null;
  let audioSource = null;
  let audioProcessor = null;
  let pcmChunks = [];
  let pcmSampleRate = 48000;
  let sttResumePointerHandler = null;
  let sttTimer = null;
  let sttBusy = false;
  // Client-side utterance buffering (silence-based segmentation)
  let sttPreRollChunks = [];
  let sttPreRollSamples = 0;
  let sttUtteranceChunks = [];
  let sttUtteranceSamples = 0;
  let sttSpeechStarted = false;
  let sttSpeechStartAt = 0;
  let sttLastVoiceAt = 0;
  let sttBuffer = '';
  let sttAbortController = null;
  let submitBusy = false;

  // Last VLM summary shown in UI
  let lastVlmSummary = '';

  // Client-side timing / last-seen state for polling
  let lastSeenRunId = '';
  let lastSeenTtsVersion = null;

  let currentSettings = {};
  const modelLists = {
    stt: [],
    llm: [],
    vlm: [],
    tts: [],
  };

  function renderSttSelectOptions(selectEl, whisperModels, selectedModel, selectedProvider) {
    if (!selectEl) return;
    const cleaned = normalizeList(whisperModels || []);
    const selectedIsGoogle = String(selectedProvider || '').trim().toLowerCase() === 'google';
    const selectedWhisperModel = String(selectedModel || '').trim();

    // Ensure current selection is visible even if not in the list.
    const items = cleaned.slice();
    if (selectedWhisperModel && !items.includes(selectedWhisperModel)) items.unshift(selectedWhisperModel);

    selectEl.innerHTML = '';

    // Google option
    {
      const opt = document.createElement('option');
      opt.value = STT_GOOGLE_VALUE;
      opt.textContent = 'Google';
      selectEl.appendChild(opt);
    }

    if (!items.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Whisper-(no models)';
      selectEl.appendChild(opt);
    } else {
      for (const m of items) {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = `Whisper-${m}`;
        selectEl.appendChild(opt);
      }
    }

    if (selectedIsGoogle) {
      selectEl.value = STT_GOOGLE_VALUE;
    } else if (selectedWhisperModel) {
      selectEl.value = selectedWhisperModel;
    } else if (items.length) {
      selectEl.value = items[0];
    } else {
      selectEl.value = STT_GOOGLE_VALUE;
    }
  }

  function getSelectedSttProvider() {
    const v = el.sttModel ? String(el.sttModel.value || '').trim() : '';
    return v === STT_GOOGLE_VALUE ? 'google' : 'local';
  }

  function getSelectedWhisperModel() {
    const v = el.sttModel ? String(el.sttModel.value || '').trim() : '';
    if (!v || v === STT_GOOGLE_VALUE) return '';
    return v;
  }

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

  function _rmsOfFloat32(buf) {
    if (!buf || !buf.length) return 0;
    let sum = 0;
    for (let i = 0; i < buf.length; i += 1) {
      const v = buf[i];
      sum += v * v;
    }
    return Math.sqrt(sum / buf.length);
  }

  function _resetSttSegmentation() {
    sttPreRollChunks = [];
    sttPreRollSamples = 0;
    sttUtteranceChunks = [];
    sttUtteranceSamples = 0;
    sttSpeechStarted = false;
    sttSpeechStartAt = 0;
    sttLastVoiceAt = 0;
    pcmChunks = [];
  }

  function setSttText(text) {
    const t = String(text || '').trim();
    sttBuffer = t;
    if (el.sttText) el.sttText.value = t;
  }

  function appendSttText(part) {
    const t = String(part || '').trim();
    if (!t) return;
    if (sttBuffer && !sttBuffer.endsWith(' ')) sttBuffer += ' ';
    sttBuffer += t;
    if (el.sttText) el.sttText.value = sttBuffer;
  }

  function getWhisperDevice() {
    const v = el.whisperDevice ? String(el.whisperDevice.value || '') : String(localStorage.getItem('aituber.whisper_device') || 'cpu');
    const s = v.trim().toLowerCase();
    return s === 'gpu' || s === 'cuda' ? 'gpu' : 'cpu';
  }

  function getSttLanguage() {
    const v = el.sttLanguage ? String(el.sttLanguage.value || '') : '';
    return v.trim() || 'ja-JP';
  }

  function getSttClientConfig() {
    const cfg = {
      voiceRmsThreshold: clampNumber(toNumber(el.sttVoiceRmsThreshold && el.sttVoiceRmsThreshold.value), 0, 1, 0.006),
      silenceMs: clampInt(toInt(el.sttSilenceMs && el.sttSilenceMs.value), 0, 60000, 700),
      minUtteranceMs: clampInt(toInt(el.sttMinUtteranceMs && el.sttMinUtteranceMs.value), 0, 60000, 350),
      maxUtteranceMs: clampInt(toInt(el.sttMaxUtteranceMs && el.sttMaxUtteranceMs.value), 1000, 600000, 12000),
      preRollMs: clampInt(toInt(el.sttPreRollMs && el.sttPreRollMs.value), 0, 2000, 350),
      tickMs: clampInt(toInt(el.sttTickMs && el.sttTickMs.value), 50, 5000, 200),
      bufferSize: clampInt(toInt(el.sttBufferSize && el.sttBufferSize.value), 256, 16384, 4096),
      submitTimeoutMs: clampInt(toInt(el.sttSubmitTimeoutMs && el.sttSubmitTimeoutMs.value), 1000, 600000, 15000),
    };
    // Ensure ScriptProcessor buffer size is a power of two.
    const pow2 = 1 << Math.round(Math.log2(cfg.bufferSize));
    cfg.bufferSize = clampInt(pow2, 256, 16384, 4096);
    return cfg;
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
    let timeoutId = null;
    try {
      const clientCfg = getSttClientConfig();
      // Clear previous text immediately so it never lingers between recognitions.
      resetSttBuffer();
      if (el.speechStatus) el.speechStatus.textContent = 'STT: sending audio...';
      const form = new FormData();
      form.append('lang', getSttLanguage());
      form.append('file', wav, 'mic.wav');
      form.append('whisper_device', getWhisperDevice());
      form.append('stt_enabled', el.sttEnabled && el.sttEnabled.checked ? '1' : '0');
      const vlmForce = el.vlmEnabled && el.vlmEnabled.checked ? '1' : '0';
      form.append('vlm_force', vlmForce);

      sttAbortController = new AbortController();

      // If Whisper is still loading/downloading, the request can take a long time.
      // Some browser/network edge-cases can ignore AbortController; race with a timeout
      // so the UI always recovers.
      const timeoutMs = clampInt(toInt(clientCfg.submitTimeoutMs), 1000, 600000, 15000);
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          try {
            if (sttAbortController) sttAbortController.abort();
          } catch {
            // ignore
          }
          let err = null;
          try {
            err = new DOMException('timeout', 'AbortError');
          } catch {
            err = new Error('timeout');
            err.name = 'AbortError';
          }
          reject(err);
        }, timeoutMs);
      });

      const j = await Promise.race([
        formPost('/stt/audio', form, { signal: sttAbortController.signal }),
        timeoutPromise,
      ]);
      const text = j && j.ok ? String(j.text || '').trim() : '';
      const vlmSummary = j && j.vlm_summary ? String(j.vlm_summary || '').trim() : '';
      if (!text) {
        const err = (j && j.error) || 'no_transcript';
        const dbg = j && j.debug ? j.debug : null;
        if (el.speechStatus) {
          const dbgStr = dbg ? ` (audio_ms=${dbg.audio_ms ?? '?'}, max_amp=${dbg.max_amp ?? '?'}, rms=${dbg.rms ?? '?'})` : '';
          el.speechStatus.textContent = `STT: ${err}${dbgStr}`;
        }
        return;
      }

      // Always overwrite previous recognition.
      setSttText(text);
      if (el.speechStatus) el.speechStatus.textContent = `STT: ${text}`;
      await submitText(text, { vlmSummary });
    } catch (e) {
      if (e && e.name === 'AbortError') {
        if (el.speechStatus) el.speechStatus.textContent = 'STT: timeout/canceled (still listening).';
        return;
      }
      if (el.speechStatus) el.speechStatus.textContent = `STT error: ${e && e.message ? e.message : e}`;
    } finally {
      if (timeoutId) {
        try {
          clearTimeout(timeoutId);
        } catch {
          // ignore
        }
      }
      sttBusy = false;
      sttAbortController = null;
    }
  }

  async function warmupStt() {
    try {
      await jsonFetch('/stt/warmup', {
        method: 'POST',
        body: JSON.stringify({ whisper_device: getWhisperDevice() }),
      });
    } catch {
      // ignore
    }
  }

  async function ensureAudioContextRunning(ctx) {
    if (!ctx) return false;
    if (ctx.state === 'running') return true;

    try {
      await ctx.resume();
    } catch {
      // ignore
    }
    if (ctx.state === 'running') return true;

    // If STT auto-starts on page load, many browsers keep AudioContext suspended
    // until the next user gesture. Set up a one-shot resume handler.
    if (!sttResumePointerHandler) {
      sttResumePointerHandler = async () => {
        if (!audioCtx) return;
        try {
          await audioCtx.resume();
        } catch {
          // ignore
        }
        if (audioCtx && audioCtx.state === 'running') {
          if (el.speechStatus) el.speechStatus.textContent = 'STT: recording started.';
          try {
            document.removeEventListener('pointerdown', sttResumePointerHandler, true);
          } catch {
            // ignore
          }
          sttResumePointerHandler = null;
        } else {
          if (el.speechStatus) el.speechStatus.textContent = 'STT: AudioContext suspended (click to enable audio).';
        }
      };
      try {
        document.addEventListener('pointerdown', sttResumePointerHandler, true);
      } catch {
        // ignore
      }
    }
    return ctx.state === 'running';
  }

  async function stopRecorderAndMaybeSendFinal() {
    // Best-effort: send any buffered utterance before tearing down audio.
    try {
      if (sttSpeechStarted && sttUtteranceChunks && sttUtteranceChunks.length && !sttBusy) {
        const wav = encodeWavFloat32Mono(sttUtteranceChunks, pcmSampleRate);
        _resetSttSegmentation();
        await postSttWavAndSubmit(wav);
      }
    } catch {
      // ignore
    }
    stopRecorder();
  }

  function shouldIncludeVlm(_text, _summary) {
    return Boolean(el.vlmEnabled && el.vlmEnabled.checked);
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
    try {
      return await res.json();
    } catch {
      // Surface non-JSON responses (e.g. proxy errors) instead of hanging UI logic.
      let bodyText = '';
      try {
        bodyText = await res.text();
      } catch {
        // ignore
      }
      return { ok: false, error: `non_json_response:${res.status}`, debug: { status: res.status, body: bodyText.slice(0, 200) } };
    }
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

    if (el.whisperDevice) {
      el.whisperDevice.value = localStorage.getItem('aituber.whisper_device') || 'cpu';
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

    if (el.whisperDevice) {
      el.whisperDevice.value = getWhisperDevice();
    }
  }

  function savePrefs() {
    if (el.modelPath) localStorage.setItem('aituber.modelPath', String(el.modelPath.value || '').trim());
    persistStagePrefs();
    persistStageFont();
    if (el.mouseMode) {
      localStorage.setItem('aituber.stage.mouseMode', String(el.mouseMode.value || 'no_follow'));
    }
    if (el.whisperDevice) {
      localStorage.setItem('aituber.whisper_device', getWhisperDevice());
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
        opt.textContent = '(/models に .model3.json が見つかりません)';
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
      const providers = (currentSettings && currentSettings.providers) || {};
      const llmProvider = String(providers.llm || 'gemini');
      const ttsProvider = String((el.ttsProvider && el.ttsProvider.value) || providers.tts || 'google');

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
          llm_provider: llmProvider,
          tts_provider: ttsProvider,
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

    if (sttResumePointerHandler) {
      try {
        document.removeEventListener('pointerdown', sttResumePointerHandler, true);
      } catch {
        // ignore
      }
      sttResumePointerHandler = null;
    }
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
    _resetSttSegmentation();

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
    // Clear previous recognition immediately when starting.
    resetSttBuffer();
    _resetSttSegmentation();

    // WebAudio PCM capture -> WAV (no ffmpeg required)
    if (!window.AudioContext && !window.webkitAudioContext) {
      el.speechStatus.textContent = 'STT: AudioContext not supported.';
      return;
    }

    const AC = window.AudioContext || window.webkitAudioContext;
    audioCtx = new AC();
    const ok = await ensureAudioContextRunning(audioCtx);
    if (!ok && el.speechStatus) el.speechStatus.textContent = 'STT: AudioContext suspended (click to enable audio).';
    pcmSampleRate = audioCtx.sampleRate || 48000;
    const audioOnly = new MediaStream([tracks[0]]);
    audioSource = audioCtx.createMediaStreamSource(audioOnly);

    const clientCfg = getSttClientConfig();
    // ScriptProcessor is deprecated but works widely and is enough here.
    const bufferSize = clientCfg.bufferSize;
    audioProcessor = audioCtx.createScriptProcessor(bufferSize, 1, 1);
    pcmChunks = [];

    // Segmentation params
    const VOICE_RMS_THRESHOLD = clientCfg.voiceRmsThreshold;
    const SILENCE_MS = clientCfg.silenceMs;
    const MIN_UTTERANCE_MS = clientCfg.minUtteranceMs;
    const MAX_UTTERANCE_MS = clientCfg.maxUtteranceMs;
    const PRE_ROLL_MS = clientCfg.preRollMs;
    const preRollMaxSamples = Math.max(0, Math.floor(pcmSampleRate * (PRE_ROLL_MS / 1000)));

    function pushPreRoll(chunk) {
      if (!preRollMaxSamples) return;
      sttPreRollChunks.push(chunk);
      sttPreRollSamples += chunk.length;
      while (sttPreRollSamples > preRollMaxSamples && sttPreRollChunks.length) {
        const dropped = sttPreRollChunks.shift();
        sttPreRollSamples -= dropped ? dropped.length : 0;
      }
    }

    async function flushUtterance(reason) {
      if (!el.sttEnabled || !el.sttEnabled.checked) return;
      if (sttBusy) return;
      if (!sttSpeechStarted) return;
      if (!sttUtteranceChunks.length) return;

      const utteranceMs = (sttUtteranceSamples / pcmSampleRate) * 1000;
      if (utteranceMs < MIN_UTTERANCE_MS) {
        _resetSttSegmentation();
        return;
      }

      const chunks = sttUtteranceChunks;
      _resetSttSegmentation();
      if (el.speechStatus) el.speechStatus.textContent = `STT: sending (${reason || 'silence'})...`;
      const wav = encodeWavFloat32Mono(chunks, pcmSampleRate);
      await postSttWavAndSubmit(wav);
    }

    audioProcessor.onaudioprocess = (e) => {
      if (!el.sttEnabled || !el.sttEnabled.checked) return;
      const input = e.inputBuffer.getChannelData(0);
      const chunk = new Float32Array(input);
      const now = performance.now();
      const rms = _rmsOfFloat32(chunk);

      if (rms >= VOICE_RMS_THRESHOLD) {
        sttLastVoiceAt = now;
        if (!sttSpeechStarted) {
          sttSpeechStarted = true;
          sttSpeechStartAt = now;
          sttUtteranceChunks = sttPreRollChunks.slice();
          sttUtteranceSamples = sttPreRollSamples;
          sttPreRollChunks = [];
          sttPreRollSamples = 0;
        }
      }

      if (sttSpeechStarted) {
        sttUtteranceChunks.push(chunk);
        sttUtteranceSamples += chunk.length;
      } else {
        pushPreRoll(chunk);
      }
    };

    // Keep processor alive.
    const gain = audioCtx.createGain();
    gain.gain.value = 0;
    audioSource.connect(audioProcessor);
    audioProcessor.connect(gain);
    gain.connect(audioCtx.destination);

    async function tickSegmentation() {
      if (!el.sttEnabled || !el.sttEnabled.checked) return;
      if (!sttSpeechStarted) return;
      const now = performance.now();
      const sinceVoice = now - (sttLastVoiceAt || sttSpeechStartAt || now);
      const utteranceMs = (sttUtteranceSamples / pcmSampleRate) * 1000;

      if (utteranceMs >= MAX_UTTERANCE_MS) {
        await flushUtterance('max_len');
        return;
      }
      if (sinceVoice >= SILENCE_MS) {
        await flushUtterance('silence');
      }
    }

    // Check frequently; actual POST is gated by sttBusy.
    sttTimer = setInterval(() => {
      void tickSegmentation();
    }, clientCfg.tickMs);
    if (el.speechStatus && (!audioCtx || audioCtx.state === 'running')) el.speechStatus.textContent = 'STT: recording started.';

    // Warm up the Whisper model in the background (prevents first request from feeling stuck).
    warmupStt();
  }

  function setStatusEl(statusEl, msg) {
    if (statusEl) statusEl.textContent = msg || '';
  }

  function clampNumber(val, min, max, fallback) {
    if (!Number.isFinite(val)) return fallback;
    return Math.max(min, Math.min(max, val));
  }

  function clampInt(val, min, max, fallback) {
    if (!Number.isFinite(val)) return fallback;
    return Math.max(min, Math.min(max, Math.trunc(val)));
  }

  function toNumber(val) {
    const n = Number(val);
    return Number.isFinite(n) ? n : null;
  }

  function toInt(val) {
    const n = parseInt(String(val || ''), 10);
    return Number.isFinite(n) ? n : null;
  }

  function normalizeList(val) {
    if (!Array.isArray(val)) return [];
    const out = [];
    const seen = new Set();
    for (const item of val) {
      const s = String(item || '').trim();
      if (!s || seen.has(s)) continue;
      seen.add(s);
      out.push(s);
    }
    return out;
  }

  function renderSelectOptions(selectEl, items, selected, emptyLabel) {
    if (!selectEl) return;
    selectEl.innerHTML = '';
    const displayItems = items.slice();
    if (selected && !displayItems.includes(selected)) {
      displayItems.unshift(selected);
    }
    if (!displayItems.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = emptyLabel || '(empty)';
      selectEl.appendChild(opt);
      return;
    }
    for (const item of displayItems) {
      const opt = document.createElement('option');
      opt.value = item;
      opt.textContent = item;
      selectEl.appendChild(opt);
    }
    if (selected && displayItems.includes(selected)) {
      selectEl.value = selected;
    } else {
      selectEl.value = displayItems[0];
    }
  }

  function modelSelectForKind(kind) {
    if (kind === 'stt') return el.sttModel;
    if (kind === 'llm') return el.llmModel;
    if (kind === 'vlm') return el.vlmModel;
    if (kind === 'tts') return el.ttsVoice;
    return null;
  }

  function emptyLabelForKind(kind) {
    if (kind === 'tts') return '(no voices)';
    return '(no models)';
  }

  function setModelList(kind, list, selected) {
    const cleaned = normalizeList(list);
    modelLists[kind] = cleaned;
    if (kind === 'stt') {
      const providers = (currentSettings && currentSettings.providers) || {};
      renderSttSelectOptions(modelSelectForKind(kind), cleaned, selected, providers.stt);
      return;
    }
    renderSelectOptions(modelSelectForKind(kind), cleaned, selected, emptyLabelForKind(kind));
  }

  function addModelToList(kind, value) {
    const v = String(value || '').trim();
    if (!v) return;
    const list = modelLists[kind] || [];
    if (!list.includes(v)) list.push(v);
    modelLists[kind] = list;
    if (kind === 'stt') {
      const providers = (currentSettings && currentSettings.providers) || {};
      renderSttSelectOptions(modelSelectForKind(kind), list, v, providers.stt);
      return;
    }
    renderSelectOptions(modelSelectForKind(kind), list, v, emptyLabelForKind(kind));
  }

  function removeModelFromList(kind, value) {
    const v = String(value || '').trim();
    const list = modelLists[kind] || [];
    if (!list.includes(v)) {
      if (kind === 'stt') {
        const providers = (currentSettings && currentSettings.providers) || {};
        renderSttSelectOptions(modelSelectForKind(kind), list, '', providers.stt);
        return;
      }
      renderSelectOptions(modelSelectForKind(kind), list, '', emptyLabelForKind(kind));
      return;
    }
    const next = list.filter((item) => item !== v);
    modelLists[kind] = next;
    if (kind === 'stt') {
      const providers = (currentSettings && currentSettings.providers) || {};
      renderSttSelectOptions(modelSelectForKind(kind), next, '', providers.stt);
      return;
    }
    renderSelectOptions(modelSelectForKind(kind), next, '', emptyLabelForKind(kind));
  }

  function buildSettingsPayload() {
    const llmTemp = toNumber(el.llmTemp && el.llmTemp.value);
    const llmMax = toInt(el.llmMaxTokens && el.llmMaxTokens.value);
    const vlmTemp = toNumber(el.vlmTemp && el.vlmTemp.value);
    const vlmMax = toInt(el.vlmMaxTokens && el.vlmMaxTokens.value);
    const shortMax = toInt(el.shortTermMaxEvents && el.shortTermMaxEvents.value);
    const turnsToPrompt = toInt(el.shortTermTurnsToPrompt && el.shortTermTurnsToPrompt.value);
    const vadThreshold = toNumber(el.vadThreshold && el.vadThreshold.value);
    const vadSilenceThreshold = toNumber(el.vadSilenceThreshold && el.vadSilenceThreshold.value);
    const vadMinSpeechMs = toInt(el.vadMinSpeechMs && el.vadMinSpeechMs.value);
    const vadMinSilenceMs = toInt(el.vadMinSilenceMs && el.vadMinSilenceMs.value);
    const vadSpeechPadMs = toInt(el.vadSpeechPadMs && el.vadSpeechPadMs.value);
    const vadFrameMs = toInt(el.vadFrameMs && el.vadFrameMs.value);
    const vadSampleRate = toInt(el.vadSampleRate && el.vadSampleRate.value);
    const vadMaxBufferMs = toInt(el.vadMaxBufferMs && el.vadMaxBufferMs.value);
    const vadFallbackMinAmp = toNumber(el.vadFallbackMinAmp && el.vadFallbackMinAmp.value);
    const vadFallbackMinRms = toNumber(el.vadFallbackMinRms && el.vadFallbackMinRms.value);

    const clientCfg = getSttClientConfig();
    const sttLang = getSttLanguage();
    const sttProvider = getSelectedSttProvider();
    const sttModel = getSelectedWhisperModel();
    const ttsProvider = el.ttsProvider ? String(el.ttsProvider.value || '').trim().toLowerCase() : '';
    const ttsVoice = String((el.ttsVoice && el.ttsVoice.value) || '').trim();
    const providers = (currentSettings && currentSettings.providers) || {};

    // Preserve settings for fields whose inputs are not rendered.
    // This prevents hidden defaults from unintentionally overwriting server config.
    const existingStt = (currentSettings && currentSettings.stt) || {};
    const existingVad = existingStt.vad || {};
    const existingClient = existingStt.client || {};
    const existingFallback = existingStt.fallback || {};

    const nextVad = {
      ...existingVad,
      threshold: vadThreshold ?? existingVad.threshold ?? 0.5,
      silence_threshold: vadSilenceThreshold ?? existingVad.silence_threshold ?? null,
      min_speech_ms: vadMinSpeechMs ?? existingVad.min_speech_ms ?? 200,
      min_silence_ms: vadMinSilenceMs ?? existingVad.min_silence_ms ?? 350,
      speech_pad_ms: vadSpeechPadMs ?? existingVad.speech_pad_ms ?? 120,
    };
    if (el.vadFrameMs) nextVad.frame_ms = vadFrameMs ?? existingVad.frame_ms ?? 32;
    if (el.vadSampleRate) nextVad.vad_sample_rate = vadSampleRate ?? existingVad.vad_sample_rate ?? 16000;
    if (el.vadMaxBufferMs) nextVad.max_buffer_ms = vadMaxBufferMs ?? existingVad.max_buffer_ms ?? 30000;
    if (el.vadModelPath) nextVad.model_path = String((el.vadModelPath && el.vadModelPath.value) || '');
    if (el.vadDevice) nextVad.device = String((el.vadDevice && el.vadDevice.value) || '');

    const nextClient = {
      ...existingClient,
      voice_rms_threshold: clientCfg.voiceRmsThreshold,
      silence_ms: clientCfg.silenceMs,
      min_utterance_ms: clientCfg.minUtteranceMs,
      max_utterance_ms: clientCfg.maxUtteranceMs,
      pre_roll_ms: clientCfg.preRollMs,
      submit_timeout_ms: clientCfg.submitTimeoutMs,
    };
    if (el.sttTickMs) nextClient.tick_ms = clientCfg.tickMs;
    if (el.sttBufferSize) nextClient.buffer_size = clientCfg.bufferSize;

    const nextFallback = { ...existingFallback };
    if (el.vadFallbackMinAmp) nextFallback.min_amp = vadFallbackMinAmp ?? existingFallback.min_amp ?? 0.008;
    if (el.vadFallbackMinRms) nextFallback.min_rms = vadFallbackMinRms ?? existingFallback.min_rms ?? 0.0015;

    return {
      providers: {
        stt: sttProvider,
        llm: String(providers.llm || 'gemini').trim().toLowerCase() || 'gemini',
        tts: ttsProvider || String(providers.tts || 'google').trim().toLowerCase() || 'google',
      },
      llm: {
        system_prompt: String((el.llmSystemPrompt && el.llmSystemPrompt.value) || ''),
        model: String((el.llmModel && el.llmModel.value) || ''),
        model_list: modelLists.llm || [],
        temperature: llmTemp ?? 0.7,
        max_output_tokens: llmMax ?? 1024,
      },
      vlm: {
        system_prompt: String((el.vlmSystemPrompt && el.vlmSystemPrompt.value) || ''),
        model: String((el.vlmModel && el.vlmModel.value) || ''),
        model_list: modelLists.vlm || [],
        temperature: vlmTemp ?? 0.2,
        max_output_tokens: vlmMax ?? 256,
      },
      stt: {
        model: sttModel,
        model_list: modelLists.stt || [],
        language: sttLang,
        vad: nextVad,
        client: nextClient,
        fallback: nextFallback,
      },
      tts: {
        provider: ttsProvider || 'google',
        voice: ttsVoice,
        voice_list: modelLists.tts || [],
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
        currentSettings = payload;
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
    currentSettings = s;

    const llm = s.llm || {};
    if (el.llmSystemPrompt) el.llmSystemPrompt.value = String(llm.system_prompt || '');
    setModelList('llm', llm.model_list || [], String(llm.model || ''));
    if (el.llmTemp && llm.temperature != null) el.llmTemp.value = String(llm.temperature);
    if (el.llmMaxTokens && llm.max_output_tokens != null) el.llmMaxTokens.value = String(llm.max_output_tokens);

    const vlm = s.vlm || {};
    if (el.vlmSystemPrompt) el.vlmSystemPrompt.value = String(vlm.system_prompt || '');
    setModelList('vlm', vlm.model_list || [], String(vlm.model || ''));
    if (el.vlmTemp && vlm.temperature != null) el.vlmTemp.value = String(vlm.temperature);
    if (el.vlmMaxTokens && vlm.max_output_tokens != null) el.vlmMaxTokens.value = String(vlm.max_output_tokens);

    const stt = s.stt || {};
    const providers = s.providers || {};
    setModelList('stt', stt.model_list || [], String(stt.model || ''));
    if (el.sttModel) {
      // Re-render with provider so Google can be selected even if not present in model list.
      renderSttSelectOptions(el.sttModel, stt.model_list || [], String(stt.model || ''), providers.stt);
    }
    if (el.sttLanguage) el.sttLanguage.value = String(stt.language || 'ja-JP');

    const vad = stt.vad || {};
    if (el.vadThreshold) el.vadThreshold.value = vad.threshold != null ? String(vad.threshold) : '0.5';
    if (el.vadSilenceThreshold) el.vadSilenceThreshold.value = vad.silence_threshold != null ? String(vad.silence_threshold) : '';
    if (el.vadMinSpeechMs) el.vadMinSpeechMs.value = vad.min_speech_ms != null ? String(vad.min_speech_ms) : '200';
    if (el.vadMinSilenceMs) el.vadMinSilenceMs.value = vad.min_silence_ms != null ? String(vad.min_silence_ms) : '350';
    if (el.vadSpeechPadMs) el.vadSpeechPadMs.value = vad.speech_pad_ms != null ? String(vad.speech_pad_ms) : '120';
    if (el.vadFrameMs) el.vadFrameMs.value = vad.frame_ms != null ? String(vad.frame_ms) : '32';
    if (el.vadSampleRate) el.vadSampleRate.value = vad.vad_sample_rate != null ? String(vad.vad_sample_rate) : '16000';
    if (el.vadMaxBufferMs) el.vadMaxBufferMs.value = vad.max_buffer_ms != null ? String(vad.max_buffer_ms) : '30000';
    if (el.vadModelPath) el.vadModelPath.value = String(vad.model_path || '');
    if (el.vadDevice) el.vadDevice.value = String(vad.device || '');

    const fallback = stt.fallback || {};
    if (el.vadFallbackMinAmp) el.vadFallbackMinAmp.value = fallback.min_amp != null ? String(fallback.min_amp) : '0.008';
    if (el.vadFallbackMinRms) el.vadFallbackMinRms.value = fallback.min_rms != null ? String(fallback.min_rms) : '0.0015';

    const client = stt.client || {};
    if (el.sttVoiceRmsThreshold) {
      el.sttVoiceRmsThreshold.value = client.voice_rms_threshold != null ? String(client.voice_rms_threshold) : '0.006';
    }
    if (el.sttSilenceMs) el.sttSilenceMs.value = client.silence_ms != null ? String(client.silence_ms) : '700';
    if (el.sttMinUtteranceMs) {
      el.sttMinUtteranceMs.value = client.min_utterance_ms != null ? String(client.min_utterance_ms) : '350';
    }
    if (el.sttMaxUtteranceMs) {
      el.sttMaxUtteranceMs.value = client.max_utterance_ms != null ? String(client.max_utterance_ms) : '12000';
    }
    if (el.sttPreRollMs) el.sttPreRollMs.value = client.pre_roll_ms != null ? String(client.pre_roll_ms) : '350';
    if (el.sttTickMs) el.sttTickMs.value = client.tick_ms != null ? String(client.tick_ms) : '200';
    if (el.sttBufferSize) el.sttBufferSize.value = client.buffer_size != null ? String(client.buffer_size) : '4096';
    if (el.sttSubmitTimeoutMs) {
      el.sttSubmitTimeoutMs.value = client.submit_timeout_ms != null ? String(client.submit_timeout_ms) : '15000';
    }

    const tts = s.tts || {};
    if (el.ttsProvider) {
      el.ttsProvider.value = String(tts.provider || providers.tts || 'google');
    }
    setModelList('tts', tts.voice_list || [], String(tts.voice || ''));

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

    if (el.llmModelAddBtn) {
      el.llmModelAddBtn.onclick = () => {
        addModelToList('llm', el.llmModelAdd && el.llmModelAdd.value);
        if (el.llmModelAdd) el.llmModelAdd.value = '';
      };
    }
    if (el.llmModelRemoveBtn) {
      el.llmModelRemoveBtn.onclick = () => {
        removeModelFromList('llm', el.llmModel && el.llmModel.value);
      };
    }
    if (el.vlmModelAddBtn) {
      el.vlmModelAddBtn.onclick = () => {
        addModelToList('vlm', el.vlmModelAdd && el.vlmModelAdd.value);
        if (el.vlmModelAdd) el.vlmModelAdd.value = '';
      };
    }
    if (el.vlmModelRemoveBtn) {
      el.vlmModelRemoveBtn.onclick = () => {
        removeModelFromList('vlm', el.vlmModel && el.vlmModel.value);
      };
    }
    if (el.sttModelAddBtn) {
      el.sttModelAddBtn.onclick = () => {
        addModelToList('stt', el.sttModelAdd && el.sttModelAdd.value);
        if (el.sttModelAdd) el.sttModelAdd.value = '';
      };
    }
    if (el.sttModelRemoveBtn) {
      el.sttModelRemoveBtn.onclick = () => {
        removeModelFromList('stt', el.sttModel && el.sttModel.value);
      };
    }
    if (el.ttsVoiceAddBtn) {
      el.ttsVoiceAddBtn.onclick = () => {
        addModelToList('tts', el.ttsVoiceAdd && el.ttsVoiceAdd.value);
        if (el.ttsVoiceAdd) el.ttsVoiceAdd.value = '';
      };
    }
    if (el.ttsVoiceRemoveBtn) {
      el.ttsVoiceRemoveBtn.onclick = () => {
        removeModelFromList('tts', el.ttsVoice && el.ttsVoice.value);
      };
    }

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

    if (el.whisperDevice) {
      el.whisperDevice.onchange = () => {
        savePrefs();
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

    await loadRagTables();

    // Default OFF, but resume if user saved ON
    if (el.sttEnabled && el.sttEnabled.checked) startRecorder();
  }

  main();
})();
