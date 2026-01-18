(() => {
  const el = {
    tabs: document.querySelectorAll('.tabs button'),
    tabPanels: {
      checkpoints: document.getElementById('tab-checkpoints'),
      episodes: document.getElementById('tab-episodes'),
      metrics: document.getElementById('tab-metrics'),
    },
    reloadCheckpoints: document.getElementById('reloadCheckpoints'),
    checkpointTable: document.getElementById('checkpointTable'),
    selectedCheckpoint: document.getElementById('selectedCheckpoint'),
    reloadEpisodes: document.getElementById('reloadEpisodes'),
    episodeGrid: document.getElementById('episodeGrid'),
    episodeVideo: document.getElementById('episodeVideo'),
    frameCanvas: document.getElementById('frameCanvas'),
    framePrev: document.getElementById('framePrev'),
    frameNext: document.getElementById('frameNext'),
    frameStatus: document.getElementById('frameStatus'),
    frameStats: document.getElementById('frameStats'),
    metricsRun: document.getElementById('metricsRun'),
    reloadMetrics: document.getElementById('reloadMetrics'),
    metricsCanvas: document.getElementById('metricsCanvas'),
  };

  let checkpoints = [];
  let selectedCheckpointId = '';
  let frames = [];
  let frameIdx = 0;

  function setTab(name) {
    for (const btn of el.tabs) {
      btn.classList.toggle('active', btn.dataset.tab === name);
    }
    Object.keys(el.tabPanels).forEach((key) => {
      el.tabPanels[key].classList.toggle('active', key === name);
    });
  }

  for (const btn of el.tabs) {
    btn.addEventListener('click', () => setTab(btn.dataset.tab));
  }

  async function jsonFetch(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} ${res.status}`);
    return await res.json();
  }

  function renderCheckpoints() {
    el.checkpointTable.innerHTML = '';
    for (const ckpt of checkpoints) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><button class="btn" data-id="${ckpt.id}">${ckpt.id}</button></td>
        <td>${ckpt.step ?? ''}</td>
        <td>${(ckpt.summary && ckpt.summary.mean_lines != null) ? ckpt.summary.mean_lines.toFixed(2) : ''}</td>
        <td>${(ckpt.summary && ckpt.summary.mean_reward != null) ? ckpt.summary.mean_reward.toFixed(2) : ''}</td>
        <td>${ckpt.created_at || ''}</td>
      `;
      tr.querySelector('button').addEventListener('click', () => {
        selectedCheckpointId = ckpt.id;
        el.selectedCheckpoint.textContent = ckpt.id;
        loadEpisodes();
        setTab('episodes');
      });
      el.checkpointTable.appendChild(tr);
    }
  }

  async function loadCheckpoints() {
    const data = await jsonFetch('/api/tetris/checkpoints');
    checkpoints = data.items || [];
    renderCheckpoints();

    // Populate metrics runs
    const runIds = Array.from(new Set(checkpoints.map((c) => c.run_id).filter(Boolean)));
    el.metricsRun.innerHTML = '';
    for (const runId of runIds) {
      const opt = document.createElement('option');
      opt.value = runId;
      opt.textContent = runId;
      el.metricsRun.appendChild(opt);
    }
  }

  function decodeBoard(payload, width, height) {
    if (!payload || payload.format !== 'rle') return Array.from({ length: height }, () => Array(width).fill(0));
    const flat = [];
    for (const [val, cnt] of payload.data || []) {
      for (let i = 0; i < cnt; i += 1) flat.push(val);
    }
    while (flat.length < width * height) flat.push(0);
    const out = [];
    for (let y = 0; y < height; y += 1) {
      out.push(flat.slice(y * width, (y + 1) * width));
    }
    return out;
  }

  function drawFrame(idx) {
    const ctx = el.frameCanvas.getContext('2d');
    const cell = 24;
    const colors = {
      0: '#101010',
      1: '#00ffff',
      2: '#ffff00',
      3: '#a000f0',
      4: '#00f000',
      5: '#f00000',
      6: '#0000f0',
      7: '#f0a000',
    };
    const frame = frames[idx];
    if (!frame) return;
    const board = decodeBoard(frame.board, 10, 20);
    ctx.clearRect(0, 0, el.frameCanvas.width, el.frameCanvas.height);
    for (let y = 0; y < 20; y += 1) {
      for (let x = 0; x < 10; x += 1) {
        ctx.fillStyle = colors[board[y][x]] || '#ccc';
        ctx.fillRect(x * cell, y * cell, cell - 1, cell - 1);
      }
    }
    el.frameStatus.textContent = `${idx + 1} / ${frames.length}`;
    el.frameStats.textContent = `lines=${frame.lines_cleared ?? ''} reward=${(frame.reward ?? '').toString()}`;
  }

  async function loadEpisodeReplay(episodeId) {
    const res = await fetch(`/api/tetris/episodes/${episodeId}`);
    if (!res.ok) throw new Error('replay load failed');
    const text = await res.text();
    frames = text
      .split('\n')
      .map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter((obj) => obj && obj.type === 'step');
    frameIdx = 0;
    drawFrame(frameIdx);
  }

  async function loadEpisodes() {
    if (!selectedCheckpointId) return;
    const data = await jsonFetch(`/api/tetris/checkpoints/${selectedCheckpointId}/episodes`);
    const episodes = (data.items || data.episodes || []);
    el.episodeGrid.innerHTML = '';
    for (const ep of episodes) {
      const card = document.createElement('div');
      card.className = 'episodeCard';
      card.innerHTML = `
        <img src="${ep.thumb ? `/api/tetris/videos/${ep.thumb}` : ''}" alt="thumb" />
        <div>Ep ${ep.episode}</div>
        <div class="muted">lines ${ep.lines ?? ''}</div>
      `;
      card.addEventListener('click', async () => {
        if (ep.video) {
          el.episodeVideo.src = `/api/tetris/videos/${ep.video}`;
        } else {
          el.episodeVideo.removeAttribute('src');
        }
        await loadEpisodeReplay(ep.id);
      });
      el.episodeGrid.appendChild(card);
    }
  }

  async function loadMetrics() {
    const runId = el.metricsRun.value;
    if (!runId) return;
    const data = await jsonFetch(`/api/tetris/metrics?run_id=${encodeURIComponent(runId)}`);
    const events = data.items || [];
    const ctx = el.metricsCanvas.getContext('2d');
    ctx.clearRect(0, 0, el.metricsCanvas.width, el.metricsCanvas.height);

    const evals = events.filter((e) => e.type === 'eval');
    if (!evals.length) return;
    const maxLines = Math.max(...evals.map((e) => e.mean_lines || 0), 1);
    ctx.strokeStyle = '#1f2937';
    ctx.beginPath();
    evals.forEach((e, i) => {
      const x = (i / Math.max(evals.length - 1, 1)) * (el.metricsCanvas.width - 20) + 10;
      const y = el.metricsCanvas.height - (e.mean_lines / maxLines) * (el.metricsCanvas.height - 20) - 10;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.fillStyle = '#111';
    ctx.fillText('mean_lines', 10, 12);
  }

  el.reloadCheckpoints.addEventListener('click', loadCheckpoints);
  el.reloadEpisodes.addEventListener('click', loadEpisodes);
  el.reloadMetrics.addEventListener('click', loadMetrics);
  el.framePrev.addEventListener('click', () => { frameIdx = Math.max(0, frameIdx - 1); drawFrame(frameIdx); });
  el.frameNext.addEventListener('click', () => { frameIdx = Math.min(frames.length - 1, frameIdx + 1); drawFrame(frameIdx); });

  loadCheckpoints().catch(() => {});
})();
