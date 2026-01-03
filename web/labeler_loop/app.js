let mediaRecorder = null;
let chunks = [];
let isRecording = false;

let currentTurnId = null;
let currentCandidates = null;
let currentSttRef = null;
let currentFewshotUsed = null;
let currentGenRaw = null;

const elStatus = document.getElementById('status');
const elError = document.getElementById('error');
const btnStart = document.getElementById('btnStart');
const btnStop = document.getElementById('btnStop');
const btnSend = document.getElementById('btnSend');
const sttText = document.getElementById('sttText');
const candidatesEl = document.getElementById('candidates');
const reasonTagsEl = document.getElementById('reasonTags');

function setStatus(text) {
  elStatus.textContent = text;
}

function setError(text) {
  if (!text) {
    elError.hidden = true;
    elError.textContent = '';
    return;
  }
  elError.hidden = false;
  elError.textContent = text;
}

function setButtons({ start, stop, send }) {
  btnStart.disabled = !start;
  btnStop.disabled = !stop;
  btnSend.disabled = !send;
}

function clearTurn() {
  currentTurnId = null;
  currentCandidates = null;
  currentSttRef = null;
  currentFewshotUsed = null;
  currentGenRaw = null;
  sttText.value = '';
  candidatesEl.innerHTML = '';
  reasonTagsEl.value = '';
  setError('');
  setStatus('次ターン準備完了');
  setButtons({ start: true, stop: false, send: false });
  btnStart.focus();
}

function renderCandidates(candidates) {
  candidatesEl.innerHTML = '';
  candidates.forEach((c, idx) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'candidate';

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'candidate';
    radio.value = String(idx);
    radio.id = `cand_${idx}`;
    if (idx === 0) radio.checked = true;

    const label = document.createElement('label');
    label.setAttribute('for', radio.id);
    label.textContent = c.text;

    wrapper.appendChild(radio);
    wrapper.appendChild(label);
    candidatesEl.appendChild(wrapper);
  });
}

async function ensureRecorder() {
  if (mediaRecorder) return;

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const options = {};
  const preferred = [
    'audio/webm;codecs=opus',
    'audio/webm',
  ];
  for (const mt of preferred) {
    if (MediaRecorder.isTypeSupported(mt)) {
      options.mimeType = mt;
      break;
    }
  }

  mediaRecorder = new MediaRecorder(stream, options);
  mediaRecorder.addEventListener('dataavailable', (ev) => {
    if (ev.data && ev.data.size > 0) chunks.push(ev.data);
  });
  mediaRecorder.addEventListener('stop', () => {
    const blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'audio/webm' });
    chunks = [];
    onRecorded(blob).catch((e) => {
      setError(String(e?.message || e));
      setButtons({ start: true, stop: false, send: false });
      setStatus('エラー');
    });
  });
}

async function startRecording() {
  setError('');
  await ensureRecorder();
  chunks = [];
  mediaRecorder.start();
  isRecording = true;
  setButtons({ start: false, stop: true, send: false });
  setStatus('録音中…');
}

async function stopRecording() {
  if (!mediaRecorder || !isRecording) return;
  isRecording = false;
  setButtons({ start: false, stop: false, send: false });
  setStatus('処理中…');
  mediaRecorder.stop();
}

async function onRecorded(blob) {
  // 1) upload audio -> transcribe
  const fd = new FormData();
  fd.append('audio', blob, 'audio.webm');

  const tr = await fetch('/api/transcribe', { method: 'POST', body: fd });
  if (!tr.ok) {
    const t = await tr.text();
    throw new Error(`transcribe failed: ${tr.status}\n${t}`);
  }
  const trJson = await tr.json();
  currentTurnId = trJson.turn_id;
  currentSttRef = { audio_path: trJson.audio_path, raw: trJson.stt_raw };

  sttText.value = trJson.text || '';
  sttText.focus();
  sttText.select();

  // 2) generate 5 candidates
  const gen = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ turn_id: currentTurnId, text: sttText.value, meta: { source: 'stt' } }),
  });
  if (!gen.ok) {
    const t = await gen.text();
    throw new Error(`generate failed: ${gen.status}\n${t}`);
  }
  const genJson = await gen.json();
  currentCandidates = genJson.candidates;
  currentFewshotUsed = genJson.fewshot_used;
  currentGenRaw = genJson.gen_raw;

  renderCandidates(currentCandidates);
  setButtons({ start: true, stop: false, send: true });
  setStatus('候補生成完了');
  btnSend.focus();
}

function selectedWinnerIndex() {
  const el = document.querySelector('input[name="candidate"]:checked');
  if (!el) return 0;
  return Number(el.value);
}

function parseReasonTags() {
  const raw = (reasonTagsEl.value || '').trim();
  if (!raw) return [];
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

async function sendLabel() {
  setError('');

  if (!currentTurnId || !currentCandidates || currentCandidates.length !== 5) {
    setError('候補が5つ揃っていません。');
    return;
  }

  const payload = {
    turn_id: currentTurnId,
    input_text: sttText.value || '',
    candidates: currentCandidates,
    winner_index: selectedWinnerIndex(),
    reason_tags: parseReasonTags(),
    stt_ref: currentSttRef,
    fewshot_used: currentFewshotUsed || [],
    gen_ref: currentGenRaw || null,
  };

  const res = await fetch('/api/label', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`label failed: ${res.status}\n${t}`);
  }

  clearTurn();
}

btnStart.addEventListener('click', () => startRecording().catch(e => setError(String(e?.message || e))));
btnStop.addEventListener('click', () => stopRecording().catch(e => setError(String(e?.message || e))));
btnSend.addEventListener('click', () => sendLabel().catch(e => setError(String(e?.message || e))));

window.addEventListener('keydown', (ev) => {
  if (ev.repeat) return;

  if (ev.code === 'Space') {
    ev.preventDefault();
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
    return;
  }

  if (ev.code === 'Enter') {
    if (document.activeElement === sttText) {
      if (ev.shiftKey) return;
      ev.preventDefault();
    }
    if (!btnSend.disabled) {
      sendLabel().catch(e => setError(String(e?.message || e)));
    }
  }
});

clearTurn();
