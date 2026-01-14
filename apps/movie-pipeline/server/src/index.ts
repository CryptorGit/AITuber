import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import {
  scanAssets,
  listBgm,
  listCharacters,
  createProjectRecord,
  saveProject,
  loadProject,
  updateProject,
  deleteProject,
  duplicateProject,
  restoreProject,
  listProjects,
  listRuns,
  loadRun,
  runProject,
  ensureProjectDirs,
  projectArtifactPath,
  projectArtifactRel,
  bgmRoot,
  loadCharacter,
  projectsRoot,
  runLogPath,
  mergeSettings,
  doctor,
  listGoogleVoices,
  defaultProjectSettings,
} from '../../core/src/index.ts';
import { requireSafeId } from '../../core/src/utils/ids.ts';
import type { StepName } from '../../core/src/types.ts';
import { dataRoot, repoRoot, assetsRoot as coreAssetsRoot } from '../../core/src/paths.ts';

const MP_SERVER_BUILD_ID = 'mp-server-llm-2026-01-14d';

function resolveRepoRoot(startDir: string) {
  let dir = path.resolve(startDir);
  while (true) {
    const hasReadme = fs.existsSync(path.join(dir, 'README.md'));
    const hasApps = fs.existsSync(path.join(dir, 'apps'));
    const hasWeb = fs.existsSync(path.join(dir, 'web'));
    if (hasReadme && (hasApps || hasWeb)) return dir;
    const parent = path.dirname(dir);
    if (!parent || parent === dir) break;
    dir = parent;
  }
  return path.resolve(startDir);
}

function parseEnvText(text: string) {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

function loadEnvFile(filePath: string, opts?: { override?: boolean }) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, 'utf8');
  const kv = parseEnvText(text);
  for (const [k, v] of Object.entries(kv)) {
    if (!opts?.override && process.env[k] !== undefined) continue;
    process.env[k] = v;
  }
}

function loadRepoEnv() {
  // Prefer existing environment. Only fill missing values.
  const repoRoot = resolveRepoRoot(process.cwd());
  const candidates = [
    path.join(repoRoot, '.env', '.env.main'),
    path.join(repoRoot, 'apps', '.env', '.env.main'),
    path.join(repoRoot, '.env', '.env.labeler-loop'),
  ];
  for (const p of candidates) loadEnvFile(p, { override: false });

  // If GOOGLE_APPLICATION_CREDENTIALS is a relative path, resolve it from repo root.
  const gac = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (gac && !path.isAbsolute(gac)) {
    const abs = path.resolve(repoRoot, gac);
    if (fs.existsSync(abs)) process.env.GOOGLE_APPLICATION_CREDENTIALS = abs;
  }
}

loadRepoEnv();

// Compatibility: reuse the main app's env keys if movie-pipeline specific ones are not set.
if (!process.env.GEMINI_API_KEY && process.env.AITUBER_GEMINI_API_KEY) {
  process.env.GEMINI_API_KEY = process.env.AITUBER_GEMINI_API_KEY;
}
if (!process.env.MP_GEMINI_MODEL && process.env.AITUBER_GEMINI_MODEL) {
  process.env.MP_GEMINI_MODEL = process.env.AITUBER_GEMINI_MODEL;
}

function readTextCapped(filePath: string, maxChars: number) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    if (raw.length <= maxChars) return raw;
    return raw.slice(0, maxChars) + `\n... (truncated to ${maxChars} chars)`;
  } catch {
    return '';
  }
}

function readReplayRecordFromJsonl(jsonlPath: string, battleId: string, opts?: { maxChars?: number }) {
  const maxChars = opts?.maxChars ?? 400_000;
  if (!jsonlPath || !fs.existsSync(jsonlPath)) return '';
  try {
    const raw = fs.readFileSync(jsonlPath, 'utf8');
    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj: any = JSON.parse(trimmed);
        if (String(obj?.battle_id ?? '') === battleId) {
          const pretty = JSON.stringify(obj, null, 2);
          return pretty.length <= maxChars ? pretty : pretty.slice(0, maxChars) + `\n... (truncated to ${maxChars} chars)`;
        }
      } catch {
        // ignore invalid line
      }
    }
    return '';
  } catch {
    return '';
  }
}

function resolveVgcDemoReplaysJsonlForBattle(battleId: string): string | null {
  try {
    const root = coreAssetsRoot();
    // Only attempt this heuristic when assets root looks like vgc-demo exports.
    if (path.basename(root).toLowerCase() !== 'exports') return null;
    const vgcDir = path.resolve(root, '..');
    const indexPath = path.join(vgcDir, 'index.json');
    if (fs.existsSync(indexPath)) {
      const raw = fs.readFileSync(indexPath, 'utf8');
      const indexAny: any = JSON.parse(raw);
      const entriesArr = Array.isArray(indexAny) ? indexAny : Array.isArray(indexAny?.entries) ? indexAny.entries : [];
      const hit = Array.isArray(entriesArr) ? entriesArr.find((e: any) => String(e?.battle_id ?? '') === battleId) : null;
      const trainDir = String(hit?.train_dir ?? '').trim();
      const replaysPath = trainDir ? path.join(vgcDir, trainDir, 'replays.jsonl') : '';
      if (replaysPath && fs.existsSync(replaysPath)) return replaysPath;
    }

    // Fallback: scan train_*/replays.jsonl.
    const dirs = fs
      .readdirSync(vgcDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.toLowerCase().startsWith('train_'))
      .map((e) => e.name)
      .sort();
    for (const d of dirs) {
      const candidate = path.join(vgcDir, d, 'replays.jsonl');
      if (!fs.existsSync(candidate)) continue;
      try {
        const raw = fs.readFileSync(candidate, 'utf8');
        if (raw.includes(battleId)) return candidate;
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
  return null;
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.get('/api/mp/_build', (req, res) => {
  res.json({ build_id: MP_SERVER_BUILD_ID, pid: process.pid });
});

app.get('/api/mp/llm/system_prompt', (req, res) => {
  const text = readMpLlmSystemPrompt();
  res.json({ text });
});

app.put('/api/mp/llm/system_prompt', (req, res) => {
  const text = String(req.body?.text ?? '');
  writeMpLlmSystemPrompt(text);
  res.json({ ok: true });
});

app.get('/api/mp/llm/prompts', (req, res) => {
  res.json({
    script: readMpLlmPrompt('script'),
    subtitles: readMpLlmPrompt('subtitles'),
    live2d_motion: readMpLlmPrompt('live2d_motion'),
  });
});

app.put('/api/mp/llm/prompts', (req, res) => {
  const body = req.body ?? {};
  const keys: Array<'script' | 'subtitles' | 'live2d_motion'> = ['script', 'subtitles', 'live2d_motion'];
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(body, k)) {
      writeMpLlmPrompt(k, String((body as any)[k] ?? ''));
    }
  }
  res.json({ ok: true });
});

app.get('/api/mp/llm/config', (req, res) => {
  const defaultModel = String(process.env.MP_GEMINI_MODEL || process.env.AITUBER_GEMINI_MODEL || 'gemini-2.0-flash').trim();
  const hasApiKey = Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.AITUBER_GEMINI_API_KEY);
  res.json({ default_model: defaultModel, has_api_key: hasApiKey });
});

const running = new Set<string>();

function isWithinRoot(root: string, target: string) {
  const rel = path.relative(root, target);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function isStepName(step: string): step is StepName {
  return step === 'ladm' || step === 'tts' || step === 'live2d' || step === 'compose';
}

function readLogTail(filePath: string, maxBytes: number) {
  if (!fs.existsSync(filePath)) return '';
  const st = fs.statSync(filePath);
  if (st.size <= maxBytes) return fs.readFileSync(filePath, 'utf8');
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(maxBytes);
  fs.readSync(fd, buf, 0, maxBytes, st.size - maxBytes);
  fs.closeSync(fd);
  return buf.toString('utf8');
}

// --- LLM (Gemini) helpers ---

const MP_LLM_SYSTEM_PROMPT_REL = path.join('config', 'movie-pipeline', 'llm_system_prompt.txt');
const MP_LLM_PROMPT_REL: Record<'script' | 'subtitles' | 'live2d_motion', string> = {
  script: path.join('config', 'movie-pipeline', 'llm_prompt_script.txt'),
  subtitles: path.join('config', 'movie-pipeline', 'llm_prompt_subtitles.txt'),
  live2d_motion: path.join('config', 'movie-pipeline', 'llm_prompt_live2d_motion.txt'),
};

function mpLlmSystemPromptPath() {
  return path.join(repoRoot(), MP_LLM_SYSTEM_PROMPT_REL);
}

function ensureMpLlmSystemPromptFile() {
  const p = mpLlmSystemPromptPath();
  if (fs.existsSync(p)) return;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const defaultText = [
    'You are a strict JSON generator.',
    'Output ONLY valid JSON, no markdown, no commentary.',
    'Use double quotes for all strings and keys.',
    'Do not include trailing commas.',
  ].join('\n');
  fs.writeFileSync(p, defaultText + '\n', 'utf8');
}

function mpLlmPromptPath(kind: 'script' | 'subtitles' | 'live2d_motion') {
  return path.join(repoRoot(), MP_LLM_PROMPT_REL[kind]);
}

function ensureMpLlmPromptFile(kind: 'script' | 'subtitles' | 'live2d_motion') {
  const p = mpLlmPromptPath(kind);
  if (fs.existsSync(p)) return;
  fs.mkdirSync(path.dirname(p), { recursive: true });

  const defaults: Record<'script' | 'subtitles' | 'live2d_motion', string> = {
    script:
      'ts_log/battle_log を参考に、短い実況の台本を JSON で出力してください。出力は必ず {"battle_id": string, "lines": [{"id": string, "text": string}]} の形式にしてください。',
    subtitles:
      '台本（script.json）を参考に、字幕タイムライン（秒）を JSON で出力してください。出力は必ず {"battle_id": string, "version": 1, "items": [{"id": string, "start": number, "end": number, "text": string, "kind": "subtitle"}]} の形式にしてください。',
    live2d_motion:
      '台本/字幕を参考に、Live2D 用モーションの上書き（overrides）を JSON で出力してください。出力は必ず {"overrides": [{"id": string, "expression"?: string|null, "motion"?: string|null}]} の形式にしてください。',
  };

  fs.writeFileSync(p, defaults[kind] + '\n', 'utf8');
}

function readMpLlmPrompt(kind: 'script' | 'subtitles' | 'live2d_motion') {
  ensureMpLlmPromptFile(kind);
  return fs.readFileSync(mpLlmPromptPath(kind), 'utf8');
}

function writeMpLlmPrompt(kind: 'script' | 'subtitles' | 'live2d_motion', text: string) {
  ensureMpLlmPromptFile(kind);
  fs.writeFileSync(mpLlmPromptPath(kind), String(text ?? ''), 'utf8');
}

function readMpLlmSystemPrompt() {
  ensureMpLlmSystemPromptFile();
  return fs.readFileSync(mpLlmSystemPromptPath(), 'utf8');
}

function writeMpLlmSystemPrompt(text: string) {
  ensureMpLlmSystemPromptFile();
  fs.writeFileSync(mpLlmSystemPromptPath(), String(text ?? ''), 'utf8');
}

function _tryParseJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function _extractFromFences(text: string) {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (!m) return null;
  return _tryParseJson(String(m[1] ?? '').trim());
}

function _extractBalancedJson(text: string) {
  const s = String(text ?? '');
  const start = s.search(/[\[{]/);
  if (start < 0) return null;
  const open = s[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) {
        esc = false;
        continue;
      }
      if (ch === '\\') {
        esc = true;
        continue;
      }
      if (ch === '"') {
        inStr = false;
      }
      continue;
    }

    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === open) depth++;
    if (ch === close) depth--;
    if (depth === 0) {
      return _tryParseJson(s.slice(start, i + 1).trim());
    }
  }
  return null;
}

function extractFirstJson(text: string) {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) return null;
  const direct = _tryParseJson(trimmed);
  if (direct) return direct;
  const fenced = _extractFromFences(trimmed);
  if (fenced) return fenced;
  return _extractBalancedJson(trimmed);
}

async function geminiGenerateJson(opts: {
  prompt: string;
  model: string;
  context?: string;
  schemaHint: string;
  maxOutputTokens?: number;
}) {
  // Compatibility: reuse the main app's env keys if movie-pipeline specific ones are not set.
  if (!process.env.GEMINI_API_KEY && process.env.AITUBER_GEMINI_API_KEY) {
    process.env.GEMINI_API_KEY = process.env.AITUBER_GEMINI_API_KEY;
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('Missing GEMINI_API_KEY (or GOOGLE_API_KEY) in environment');

  const normalizeModelId = (m: string) => {
    const raw = String(m || '').trim().replace(/^models\//i, '');
    // v1beta generateContent does NOT support the "-latest" suffix for some models.
    return raw.replace(/-latest$/i, '');
  };

  const modelId = normalizeModelId(opts.model);
  const fallbackModelId = 'gemini-2.0-flash';
  const makeUrl = (mid: string) =>
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(mid)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  // IMPORTANT: When Gemini returns finishReason=MAX_TOKENS, the output is often truncated mid-JSON.
  // Bump output tokens by default and allow overriding via env for local tuning.
  const envMaxOutputTokensRaw =
    process.env.MOVIE_PIPELINE_GEMINI_MAX_OUTPUT_TOKENS ||
    process.env.MP_GEMINI_MAX_OUTPUT_TOKENS ||
    process.env.GEMINI_MAX_OUTPUT_TOKENS ||
    '';
  const envMaxOutputTokens = Number.parseInt(String(envMaxOutputTokensRaw), 10);

  const reqMaxOutputTokens = Number.parseInt(String(opts.maxOutputTokens ?? ''), 10);
  const maxOutputTokens = Number.isFinite(reqMaxOutputTokens)
    ? Math.max(512, Math.min(32768, reqMaxOutputTokens))
    : Number.isFinite(envMaxOutputTokens)
      ? Math.max(512, Math.min(32768, envMaxOutputTokens))
      : 16384;

  const baseInstruction = 'You are a strict JSON generator. Output ONLY valid JSON, no markdown, no commentary.';

  const buildPrompt = (extraInstruction?: string) =>
    [
      baseInstruction,
      'Return ONLY a complete JSON document (no code fences, no commentary).',
      `Schema: ${opts.schemaHint}`,
      opts.context ? `Context:\n${opts.context}` : '',
      `User instruction:\n${opts.prompt}`,
      extraInstruction ? `\nIMPORTANT:\n${extraInstruction}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

  const callGemini = async (args: { modelId: string; fullPrompt: string; generationConfig: any }) => {
    const body = {
      contents: [
        {
          role: 'user',
          parts: [{ text: args.fullPrompt }],
        },
      ],
      generationConfig: args.generationConfig,
    };

    const resp = await fetch(makeUrl(args.modelId), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    const jsonAny: any = await resp.json().catch(() => null);
    if (!resp.ok) {
      throw new Error(`Gemini API error (${resp.status}): ${JSON.stringify(jsonAny)}`);
    }

    const cand = jsonAny?.candidates?.[0] ?? null;
    const finishReason = cand?.finishReason ?? cand?.finish_reason ?? null;
    const text =
      cand?.content?.parts?.map((p: any) => String(p?.text ?? '')).join('') || cand?.content?.parts?.[0]?.text || '';
    return { text: String(text || ''), finishReason: finishReason ? String(finishReason) : null };
  };

  const attempts: Array<{ name: string; fullPrompt: string; generationConfig: any }> = [
    {
      name: 'json_mode',
      fullPrompt: buildPrompt(),
      generationConfig: {
        temperature: 0.2,
        topP: 0.95,
        maxOutputTokens,
        responseMimeType: 'application/json',
      },
    },
    {
      name: 'retry_strict',
      fullPrompt: buildPrompt(
        'Your output MUST be a complete, valid JSON document matching the schema. Do not stop early. Ensure all strings are properly closed and the JSON ends with the final closing bracket/brace.'
      ),
      generationConfig: {
        temperature: 0.0,
        topP: 1.0,
        maxOutputTokens,
        responseMimeType: 'application/json',
      },
    },
    {
      name: 'fallback_no_json_mode',
      fullPrompt: buildPrompt('Output ONLY complete valid JSON matching the schema.'),
      generationConfig: { temperature: 0.0, topP: 1.0, maxOutputTokens },
    },
  ];

  let lastAttempt = '';
  let lastFinishReason: string | null = null;
  let lastRaw = '';
  let lastErr = '';

  for (const attempt of attempts) {
    lastAttempt = attempt.name;
    try {
      let resp: { text: string; finishReason: string | null } | null = null;
      try {
        resp = await callGemini({ modelId, fullPrompt: attempt.fullPrompt, generationConfig: attempt.generationConfig });
      } catch (errAny: any) {
        const msg = String(errAny?.message || errAny || '');
        // Common failure mode: user supplies an older/unsupported model name (404 NOT_FOUND).
        // Retry once with a known-good default model.
        if (/Gemini API error \(404\)/.test(msg) && /NOT_FOUND/.test(msg) && fallbackModelId && fallbackModelId !== modelId) {
          resp = await callGemini({
            modelId: fallbackModelId,
            fullPrompt: attempt.fullPrompt,
            generationConfig: attempt.generationConfig,
          });
        } else {
          throw errAny;
        }
      }

      const { text, finishReason } = resp!;

      lastRaw = text;
      lastFinishReason = finishReason;

      const parsed = extractFirstJson(String(text || ''));
      if (parsed) return { raw: String(text || ''), json: parsed };
    } catch (err: any) {
      lastErr = String(err?.message || err || '');
      continue;
    }
  }

  if (!lastRaw && lastErr) {
    throw new Error(`Gemini call failed after retries. attempt=${lastAttempt}. Last error: ${lastErr}`);
  }

  const raw = String(lastRaw || '');
  const head = raw.slice(0, 800);
  const tail = raw.length > 1000 ? raw.slice(-200) : '';
  const preview = tail ? `${head}\n... (truncated; tail) ...\n${tail}` : head;
  const fr = lastFinishReason ? ` finishReason=${String(lastFinishReason)}` : '';
  throw new Error(`Gemini did not return parseable JSON.${fr} attempt=${lastAttempt}. Raw preview:\n${preview}`);
}

function sendFileSafe(res: express.Response, absPath: string, mime: string) {
  if (!absPath || !fs.existsSync(absPath)) {
    res.status(404).json({ error: 'file not found' });
    return;
  }
  res.type(mime);
  res.setHeader('cache-control', 'no-store');
  res.sendFile(absPath);
}

function modelsRoot() {
  return path.join(dataRoot(), 'models');
}

app.get('/api/mp/assets', (req, res) => {
  const refresh = String(req.query.refresh ?? '').toLowerCase();
  const doRefresh = refresh === '1' || refresh === 'true' || refresh === 'yes';
  const registry = scanAssets({ refresh: doRefresh });
  const bgm = listBgm();
  const characters = listCharacters();
  res.json({ registry, bgm, characters });
});

// Stream base mp4 or return logs for an asset by battle_id.
// This avoids exposing arbitrary file paths to the browser.
app.get('/api/mp/assets/:battleId/media', (req, res) => {
  const battleId = requireSafeId(String(req.params.battleId ?? '').trim(), 'battle_id');
  const kind = String(req.query.kind ?? 'base_mp4').trim();
  const registry = scanAssets();
  const asset = registry.assets.find((a) => a.battle_id === battleId);
  if (!asset) return res.status(404).json({ error: 'asset not found' });

  if (kind === 'base_mp4') {
    if (!asset.base_mp4) return res.status(404).json({ error: 'base_mp4 missing' });
    return sendFileSafe(res, asset.base_mp4, 'video/mp4');
  }
  if (kind === 'battle_log') {
    res.type('text/plain');
    res.setHeader('cache-control', 'no-store');
    const battleLogPath = asset.battle_log || resolveVgcDemoReplaysJsonlForBattle(battleId);
    if (!battleLogPath) return res.status(404).json({ error: 'battle_log missing' });

    // If battle_log is the vgc-demo raw replay record container (train_*/replays.jsonl),
    // return the specific battle_id row (replay record raw).
    if (path.basename(battleLogPath).toLowerCase() === 'replays.jsonl') {
      const text = readReplayRecordFromJsonl(battleLogPath, battleId, { maxChars: 400_000 });
      if (!text) return res.status(404).json({ error: 'replay record not found in replays.jsonl' });
      return res.send(text);
    }
    return res.send(readTextCapped(battleLogPath, 400_000));
  }
  if (kind === 'ts_log') {
    if (!asset.ts_log) return res.status(404).json({ error: 'ts_log missing' });
    res.type('text/plain');
    res.setHeader('cache-control', 'no-store');
    return res.send(readTextCapped(asset.ts_log, 400_000));
  }

  return res.status(400).json({ error: 'kind must be base_mp4|battle_log|ts_log' });
});

// Stream a BGM mp3 by name (no absolute paths in the browser).
app.get('/api/mp/bgm/:name', (req, res) => {
  const name = String(req.params.name ?? '').trim();
  if (!name) return res.status(400).json({ error: 'missing bgm name' });
  // Simple safe-name constraint (avoid path traversal).
  if (name.includes('/') || name.includes('\\') || name.includes('..')) {
    return res.status(400).json({ error: 'invalid bgm name' });
  }
  const entry = listBgm().find((b) => b.name === name);
  if (!entry) return res.status(404).json({ error: 'bgm not found' });
  if (!isWithinRoot(bgmRoot(), entry.path)) return res.status(400).json({ error: 'bgm path not under root' });
  return sendFileSafe(res, entry.path, 'audio/mpeg');
});

// --- Live2D model preview (shared with stream-studio demo scripts) ---
// lipsync_demo.js expects:
//   - GET /api/models/index -> { ok: true, items: [ '...model3.json' ] }
//   - GET /models/<relpath> -> serves model json and referenced assets
app.get('/api/models/index', (req, res) => {
  const root = modelsRoot();
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return res.json({ ok: true, items: [] });

  const out: string[] = [];
  const walk = (dir: string) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.isFile() && ent.name.toLowerCase().endsWith('.model3.json')) {
        out.push(path.relative(root, p).replace(/\\/g, '/'));
      }
    }
  };

  try {
    walk(root);
  } catch {
    // ignore
  }
  res.json({ ok: true, items: Array.from(new Set(out)).sort() });
});

app.use('/models', (req, res, next) => {
  const root = modelsRoot();
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return res.status(404).json({ error: 'models root not found' });
  return express.static(root, {
    fallthrough: false,
    index: false,
    setHeaders: (r) => {
      r.setHeader('cache-control', 'no-store');
    },
  })(req, res, next);
});

app.get('/api/mp/live2d/preview', (req, res) => {
  const characterId = String(req.query.character_id ?? '').trim();
  const char = characterId ? loadCharacter(characterId) : null;

  // Try to pick a model3.json for this character (based on character.model_dir).
  let modelPath = '';
  const mdRaw = String((char as any)?.model_dir ?? '').replace(/\\/g, '/');
  const md = mdRaw.replace(/^\/?/, '').replace(/^models\//, '');
  const root = modelsRoot();

  const findFirstModel = (dirAbs: string) => {
    const found: string[] = [];
    const walk = (d: string) => {
      for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, ent.name);
        if (ent.isDirectory()) walk(p);
        else if (ent.isFile() && ent.name.toLowerCase().endsWith('.model3.json')) {
          found.push(path.relative(root, p).replace(/\\/g, '/'));
        }
      }
    };
    walk(dirAbs);
    return found.sort()[0] || '';
  };

  try {
    if (md) {
      const dirAbs = path.join(root, md);
      if (isWithinRoot(root, dirAbs) && fs.existsSync(dirAbs) && fs.statSync(dirAbs).isDirectory()) {
        modelPath = findFirstModel(dirAbs);
      }
    }
    if (!modelPath && fs.existsSync(root) && fs.statSync(root).isDirectory()) {
      modelPath = findFirstModel(root);
    }
  } catch {
    modelPath = '';
  }

  res.type('text/html');
  res.setHeader('cache-control', 'no-store');
  res.send(`<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="Cache-Control" content="no-store" />
    <meta http-equiv="Pragma" content="no-cache" />
    <meta http-equiv="Expires" content="0" />
    <title>Live2D Preview</title>
    <style>
      html, body { margin:0; padding:0; background:#000; overflow:hidden; }
      #root { position:relative; width:100vw; height:100vh; background:#000; }
      #l2dCanvas { position:absolute; inset:0; width:100%; height:100%; background:transparent; }
      #hud { position:absolute; left:10px; top:10px; padding:8px 10px; font:12px/1.4 monospace; color:rgba(255,255,255,.95); background:rgba(0,0,0,.55); border-radius:8px; max-width:70vw; white-space:pre; }
      #bar { position:absolute; left:10px; bottom:10px; right:10px; padding:8px 10px; font:12px/1.4 system-ui; color:rgba(255,255,255,.9); background:rgba(0,0,0,.35); border-radius:8px; }
      #bar input { width:100%; padding:8px; box-sizing:border-box; border-radius:8px; border:1px solid rgba(255,255,255,.2); background:rgba(0,0,0,.4); color:#fff; outline:none; }
    </style>
  </head>
  <body>
    <div id="root">
      <canvas id="l2dCanvas"></canvas>
      <div id="hud"></div>
      <div id="bar">
        <div style="margin-bottom: 6px; opacity: 0.85">Preview: type text and press Enter.</div>
        <input id="text" placeholder="譌･譛ｬ隱槭ユ繧ｭ繧ｹ繝茨ｼ井ｾ具ｼ壹％繧薙↓縺｡縺ｯ縲√ｈ繧阪＠縺上・・・ />
      </div>
    </div>

    <script>
      try {
        const modelPath = ${JSON.stringify(modelPath)};
        if (modelPath) localStorage.setItem('aituber.modelPath', modelPath);
      } catch {}
    </script>

    <script src="/api/mp/live2d/vendor/live2dcubismcore.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/pixi.js@6.5.10/dist/browser/pixi.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/pixi-live2d-display/dist/cubism4.min.js"></script>
    <script src="/api/mp/live2d/lipsync_text_engine.js"></script>
    <script src="/api/mp/live2d/lipsync_demo.js"></script>
  </body>
</html>`);
});

app.get('/api/mp/live2d/vendor/live2dcubismcore.min.js', (req, res) => {
  const abs = path.join(repoRoot(), 'web', 'stream-studio', 'vendor', 'live2dcubismcore.min.js');
  return sendFileSafe(res, abs, 'application/javascript');
});

app.get('/api/mp/live2d/lipsync_text_engine.js', (req, res) => {
  const abs = path.join(repoRoot(), 'web', 'stream-studio', 'lipsync_text_engine.js');
  return sendFileSafe(res, abs, 'application/javascript');
});

app.get('/api/mp/live2d/lipsync_demo.js', (req, res) => {
  const abs = path.join(repoRoot(), 'web', 'stream-studio', 'lipsync_demo.js');
  return sendFileSafe(res, abs, 'application/javascript');
});

app.get('/api/mp/projects', (req, res) => {
  const includeDeleted = String(req.query.include_deleted ?? '').toLowerCase() === 'true';
  const projects = listProjects({ includeDeleted });
  res.json({ projects });
});

app.post('/api/mp/projects', (req, res) => {
  const body = req.body ?? {};
  const battleId = requireSafeId(String(body.battle_id ?? '').trim(), 'battle_id');

  const registry = scanAssets();
  const asset = registry.assets.find((a) => a.battle_id === battleId);
  if (!asset?.base_mp4 || (!asset?.battle_log && !asset?.ts_log)) {
    return res.status(400).json({ error: 'asset missing base_mp4 and (battle_log or ts_log)' });
  }

  const projectId = String(body.project_id ?? '').trim() || `${battleId}_${Date.now()}`;
  requireSafeId(projectId, 'project_id');
  if (loadProject(projectId)) {
    return res.status(400).json({ error: 'project_id already exists' });
  }

  const characterId = String(body.character_id ?? '').trim() || 'builtin_simple';
  requireSafeId(characterId, 'character_id');

  const bgmPathRaw = String(body.bgm_path ?? '').trim();
  const bgmName = String(body.bgm_name ?? '').trim();
  let bgmPath: string | null = null;
  if (bgmPathRaw && fs.existsSync(bgmPathRaw)) {
    if (!isWithinRoot(bgmRoot(), bgmPathRaw)) {
      return res.status(400).json({ error: 'bgm_path must be under bgm root' });
    }
    bgmPath = bgmPathRaw;
  } else if (bgmName) {
    const entry = listBgm().find((b) => b.name === bgmName);
    if (entry) bgmPath = entry.path;
  }

  const settings = mergeSettings(body.settings || undefined);
  const character = loadCharacter(characterId);
  settings.render.width = character.width || settings.render.width;
  settings.render.height = character.height || settings.render.height;
  settings.render.fps = character.fps || settings.render.fps;
  settings.render.chroma_key = character.chroma_key || settings.render.chroma_key;

  const project = createProjectRecord(projectId, {
    battle_id: battleId,
    base_mp4: asset.base_mp4,
    battle_log: asset.battle_log || null,
    ts_log: asset.ts_log || null,
    bgm_mp3: bgmPath,
    character_id: characterId,
  }, settings);

  ensureProjectDirs(projectId);
  saveProject(project);
  res.json(project);
});

app.get('/api/mp/projects/:id', (req, res) => {
  const id = requireSafeId(String(req.params.id ?? '').trim(), 'project_id');
  const project = loadProject(id);
  if (!project) return res.status(404).json({ error: 'not found' });
  res.json(project);
});

app.get('/api/mp/projects/:id/artifacts', (req, res) => {
  const id = requireSafeId(String(req.params.id ?? '').trim(), 'project_id');
  const project = loadProject(id);
  if (!project) return res.status(404).json({ error: 'not found' });
  res.json(project.outputs);
});

app.patch('/api/mp/projects/:id', (req, res) => {
  const id = requireSafeId(String(req.params.id ?? '').trim(), 'project_id');
  try {
    const updated = updateProject(id, (project) => {
      const settings = mergeSettings({ ...project.settings, ...(req.body?.settings || {}) });
      project.settings = settings;
      if (req.body?.bgm_path !== undefined) {
        const nextPath = req.body.bgm_path || null;
        if (nextPath && !isWithinRoot(bgmRoot(), nextPath)) {
          throw new Error('bgm_path must be under bgm root');
        }
        project.inputs.bgm_mp3 = nextPath;
      }
      if (req.body?.character_id !== undefined) project.inputs.character_id = req.body.character_id || null;
      const character = loadCharacter(project.inputs.character_id || null);
      project.settings.render.width = character.width || project.settings.render.width;
      project.settings.render.height = character.height || project.settings.render.height;
      project.settings.render.fps = character.fps || project.settings.render.fps;
      project.settings.render.chroma_key = character.chroma_key || project.settings.render.chroma_key;
      return project;
    });
    res.json(updated);
  } catch (e: any) {
    res.status(400).json({ error: String(e?.message ?? e) });
  }
});

app.post('/api/mp/projects/:id/script', (req, res) => {
  const id = requireSafeId(String(req.params.id ?? '').trim(), 'project_id');
  const project = loadProject(id);
  if (!project) return res.status(404).json({ error: 'not found' });
  const script = req.body?.script;
  const hasSegments = Boolean(script?.segments && Array.isArray(script.segments));
  const hasLines = Boolean(script?.lines && Array.isArray(script.lines));
  if (!hasSegments && !hasLines) {
    return res.status(400).json({ error: 'script.lines (preferred) or script.segments required' });
  }

  const scriptRel = projectArtifactRel('script.json');
  fs.writeFileSync(projectArtifactPath(id, scriptRel), JSON.stringify(script, null, 2), 'utf8');

  const updated = updateProject(id, (rec) => {
    rec.outputs.script_json = scriptRel;
    rec.outputs.narration_timeline_json = null;
    rec.outputs.subtitle_timeline_json = null;
    rec.outputs.tts_wav = null;
    rec.outputs.tts_mp3 = null;
    rec.outputs.tts_timing_json = null;
    rec.outputs.script_timed_json = null;
    rec.outputs.subtitles_srt = null;
    rec.outputs.subtitles_ass = null;
    rec.outputs.live2d_motion_json = null;
    rec.outputs.overlay_webm = null;
    rec.outputs.final_mp4 = null;
    rec.outputs.final_with_subs_mp4 = null;
    rec.steps.tts.status = 'PENDING';
    rec.steps.live2d.status = 'PENDING';
    rec.steps.compose.status = 'PENDING';
    rec.hashes.tts = null;
    rec.hashes.live2d = null;
    rec.hashes.compose = null;
    return rec;
  });

  res.json(updated);
});

// NOTE: /api/mp/projects/:id/llm/generate is implemented later (single source of truth).

app.post('/api/mp/projects/:id/subtitle_timeline', (req, res) => {
  const id = requireSafeId(String(req.params.id ?? '').trim(), 'project_id');
  const project = loadProject(id);
  if (!project) return res.status(404).json({ error: 'not found' });
  const timeline = req.body?.timeline;
  if (!timeline || typeof timeline !== 'object' || !Array.isArray((timeline as any).items)) {
    return res.status(400).json({ error: 'timeline.items required' });
  }

  const rel = projectArtifactRel('subtitle_timeline.json');
  fs.writeFileSync(projectArtifactPath(id, rel), JSON.stringify(timeline, null, 2), 'utf8');

  const updated = updateProject(id, (rec) => {
    rec.outputs.subtitle_timeline_json = rel;
    rec.outputs.tts_wav = null;
    rec.outputs.tts_mp3 = null;
    rec.outputs.tts_timing_json = null;
    rec.outputs.script_timed_json = null;
    rec.outputs.subtitles_srt = null;
    rec.outputs.subtitles_ass = null;
    rec.outputs.final_mp4 = null;
    rec.outputs.final_with_subs_mp4 = null;
    rec.steps.tts.status = 'PENDING';
    rec.steps.live2d.status = 'PENDING';
    rec.steps.compose.status = 'PENDING';
    rec.hashes.tts = null;
    rec.hashes.live2d = null;
    rec.hashes.compose = null;
    return rec;
  });

  res.json(updated);
});

app.post('/api/mp/projects/:id/live2d_motion', (req, res) => {
  const id = requireSafeId(String(req.params.id ?? '').trim(), 'project_id');
  const project = loadProject(id);
  if (!project) return res.status(404).json({ error: 'not found' });
  const motion = req.body?.motion;
  if (!motion || typeof motion !== 'object' || !Array.isArray((motion as any).items)) {
    return res.status(400).json({ error: 'motion.items required' });
  }

  const rel = projectArtifactRel('live2d_motion.json');
  fs.writeFileSync(projectArtifactPath(id, rel), JSON.stringify(motion, null, 2), 'utf8');

  const updated = updateProject(id, (rec) => {
    rec.outputs.live2d_motion_json = rel;
    rec.outputs.overlay_webm = null;
    rec.outputs.lip_sync_json = null;
    rec.outputs.final_mp4 = null;
    rec.outputs.final_with_subs_mp4 = null;
    rec.steps.live2d.status = 'PENDING';
    rec.steps.compose.status = 'PENDING';
    rec.hashes.live2d = null;
    rec.hashes.compose = null;
    return rec;
  });

  res.json(updated);
});

app.post('/api/mp/projects/:id/llm/generate', async (req, res) => {
  const id = requireSafeId(String(req.params.id ?? '').trim(), 'project_id');
  const project = loadProject(id);
  if (!project) return res.status(404).json({ error: 'not found' });

  const kind = String(req.body?.kind ?? '').trim();
  const prompt = String(req.body?.prompt ?? '').trim();
  const model = String(req.body?.model ?? process.env.MP_GEMINI_MODEL ?? 'gemini-2.0-flash').trim();
  const maxOutputTokens = Number.parseInt(String(req.body?.max_output_tokens ?? ''), 10);
  if (!prompt) return res.status(400).json({ error: 'prompt required' });
  if (!['script', 'subtitles', 'live2d_motion'].includes(kind)) {
    return res.status(400).json({ error: 'kind must be script|subtitles|live2d_motion' });
  }

  const ctxParts: string[] = [`battle_id: ${project.battle_id}`];
  // If we have a subtitle timeline already, include it because many prompts expect it as the primary input.
  // Keep it capped to avoid runaway prompt size.
  if ((kind === 'script' || kind === 'subtitles') && project.outputs.subtitle_timeline_json) {
    try {
      const p = projectArtifactPath(project.project_id, project.outputs.subtitle_timeline_json);
      if (fs.existsSync(p)) {
        ctxParts.push('subtitle_timeline_json (truncated):');
        ctxParts.push(readTextCapped(p, 120_000));
      }
    } catch {
      // ignore
    }
  }

  if (project.inputs.ts_log && fs.existsSync(project.inputs.ts_log)) {
    ctxParts.push('ts_log (truncated):');
    ctxParts.push(readTextCapped(project.inputs.ts_log, 120_000));
  } else if (project.inputs.battle_log && fs.existsSync(project.inputs.battle_log)) {
    ctxParts.push('battle_log (truncated):');
    ctxParts.push(readTextCapped(project.inputs.battle_log, 120_000));
  }

  let schemaHint = '';
  if (kind === 'script') {
    schemaHint = '{battle_id:string, lines:[{id:string, text:string}] }';
  } else if (kind === 'subtitles') {
    schemaHint = '{battle_id:string, version:1, items:[{id:string,start:number,end:number,text:string,kind:"subtitle"}] }';
  } else {
    // Reduce token usage: ask for compact overrides only, and we will merge into a full live2d_motion.json.
    schemaHint = '{overrides:[{id:string, expression?:string|null, motion?:string|null}] }';
  }

  try {
    const out = await geminiGenerateJson({
      prompt,
      model,
      context: ctxParts.join('\n'),
      schemaHint,
      maxOutputTokens: Number.isFinite(maxOutputTokens) && maxOutputTokens > 0 ? maxOutputTokens : undefined,
    });

    // Normalize and post-process outputs so UI can reliably apply them.
    if (kind === 'script') {
      const raw = out.json as any;
      const lines = Array.isArray(raw?.lines)
        ? raw.lines
        : Array.isArray(raw?.script?.lines)
          ? raw.script.lines
          : Array.isArray(raw?.segments)
            ? raw.segments
            : Array.isArray(raw?.script?.segments)
              ? raw.script.segments
              : Array.isArray(raw?.narration_timeline?.items)
                ? raw.narration_timeline.items
                : [];

      const normalized = {
        battle_id: project.battle_id,
        lines: (lines || []).map((l: any, i: number) => ({
          id: String(l?.id || `line_${String(i).padStart(3, '0')}`),
          text: String(l?.text || ''),
        })),
      };
      return res.json({ raw: out.raw, json: normalized });
    }

    if (kind === 'subtitles') {
      const raw = out.json as any;
      const items = Array.isArray(raw?.items)
        ? raw.items
        : Array.isArray(raw?.subtitle_timeline?.items)
          ? raw.subtitle_timeline.items
          : Array.isArray(raw?.narration_timeline?.items)
            ? raw.narration_timeline.items
            : [];
      const normalized = {
        battle_id: project.battle_id,
        version: 1,
        items: items.map((it: any, i: number) => ({
          id: String(it?.id || `line_${String(i).padStart(3, '0')}`),
          start: Number(it?.start ?? 0),
          end: Number(it?.end ?? 0),
          text: String(it?.text || ''),
          kind: 'subtitle',
        })),
      };
      return res.json({ raw: out.raw, json: normalized });
    }

    // live2d_motion: merge overrides into a full motion file based on an existing timeline.
    const overridesRaw = out.json as any;
    const overrides = Array.isArray(overridesRaw?.overrides) ? overridesRaw.overrides : Array.isArray(overridesRaw?.items) ? overridesRaw.items : [];

    let timeline: any = null;
    try {
      const rel = project.outputs.narration_timeline_json || project.outputs.subtitle_timeline_json;
      if (rel) {
        timeline = JSON.parse(fs.readFileSync(projectArtifactPath(project.project_id, rel), 'utf8'));
      }
    } catch {
      timeline = null;
    }

    const baseItems: any[] = Array.isArray(timeline?.items) ? timeline.items : [];
    const byId = new Map<string, any>();
    for (const o of overrides) {
      const oid = String(o?.id || '').trim();
      if (!oid) continue;
      byId.set(oid, o);
    }

    const merged = {
      battle_id: project.battle_id,
      version: 1,
      items: baseItems.map((it: any, i: number) => {
        const id = String(it?.id || `line_${String(i).padStart(3, '0')}`);
        const ov = byId.get(id);
        const expression = ov?.expression === undefined ? null : ov.expression;
        const motion = ov?.motion === undefined ? null : ov.motion;
        return {
          id,
          start: Number(it?.start ?? 0),
          end: Number(it?.end ?? 0),
          expression: expression ?? null,
          motion: motion ?? null,
        };
      }),
    };

    return res.json({ raw: out.raw, json: merged });
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

app.get('/api/mp/projects/:id/runs', (req, res) => {
  const id = requireSafeId(String(req.params.id ?? '').trim(), 'project_id');
  const runs = listRuns(id);
  res.json({ runs });
});

app.get('/api/mp/projects/:id/runs/:runId', (req, res) => {
  const id = requireSafeId(String(req.params.id ?? '').trim(), 'project_id');
  const runId = requireSafeId(String(req.params.runId ?? '').trim(), 'run_id');
  const run = loadRun(id, runId);
  if (!run) return res.status(404).json({ error: 'not found' });
  res.json(run);
});

app.post('/api/mp/projects/:id/run', (req, res) => {
  const id = requireSafeId(String(req.params.id ?? '').trim(), 'project_id');
  const project = loadProject(id);
  if (!project) return res.status(404).json({ error: 'not found' });

  if (running.has(id)) {
    return res.status(409).json({ error: 'project already running' });
  }

  const stepRaw = String(req.query.step ?? 'all').trim().toLowerCase();
  const force = String(req.query.force ?? '').toLowerCase() === 'true';

  if (stepRaw !== 'all' && !isStepName(stepRaw)) {
    return res.status(400).json({ error: 'invalid step' });
  }

  running.add(id);
  setTimeout(() => {
    runProject(id, { step: stepRaw === 'all' ? 'all' : (stepRaw as StepName), force })
      .catch((e: any) => {
        console.error(`[movie-pipeline] run failed (${id}):`, e);
      })
      .finally(() => {
        running.delete(id);
      });
  }, 10);

  res.json(loadProject(id));
});

app.get('/api/mp/projects/:id/logs/:step', (req, res) => {
  const id = requireSafeId(String(req.params.id ?? '').trim(), 'project_id');
  const step = String(req.params.step ?? '').trim();
  if (!isStepName(step)) return res.status(400).json({ error: 'invalid step' });
  const project = loadProject(id);
  if (!project) return res.status(404).json({ error: 'not found' });

  const runId = req.query.run_id ? String(req.query.run_id) : project.last_run_id;
  if (!runId) return res.status(404).json({ error: 'no run' });
  const logPath = runLogPath(id, runId, step as StepName);
  const tail = Math.max(256, Math.min(20000, Number(req.query.tail ?? 8000)));
  const text = readLogTail(logPath, tail);
  res.type('text/plain').send(text);
});

app.delete('/api/mp/projects/:id', (req, res) => {
  const id = requireSafeId(String(req.params.id ?? '').trim(), 'project_id');
  const hard = String(req.query.hard ?? '').toLowerCase() === 'true';
  const project = deleteProject(id, { hard });
  res.json({ deleted: true, project });
});

app.post('/api/mp/projects/:id/duplicate', (req, res) => {
  const id = requireSafeId(String(req.params.id ?? '').trim(), 'project_id');
  const newId = requireSafeId(String(req.body?.new_project_id ?? `${id}_copy`), 'project_id');
  try {
    const copy = duplicateProject(id, newId);
    res.json(copy);
  } catch (e: any) {
    res.status(400).json({ error: String(e?.message ?? e) });
  }
});

app.post('/api/mp/projects/:id/restore', (req, res) => {
  const id = requireSafeId(String(req.params.id ?? '').trim(), 'project_id');
  const project = restoreProject(id);
  res.json(project);
});

app.get('/api/mp/doctor', async (req, res) => {
  const statuses = await doctor();
  res.json({ statuses });
});

app.get('/api/mp/voices', async (req, res) => {
  const raw = String(req.query.language_code ?? '').trim();
  const fallback = defaultProjectSettings().tts.google.language_code;
  const languageCode = raw || fallback;
  try {
    const voices = await listGoogleVoices(languageCode);
    res.json({ voices });
  } catch (e: any) {
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

app.use('/projects', express.static(projectsRoot()));

const port = Number(process.env.MP_PORT ?? 8788);

process.on('uncaughtException', (err) => {
  console.error('[movie-pipeline] uncaughtException:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[movie-pipeline] unhandledRejection:', reason);
});

process.on('beforeExit', (code) => {
  console.error('[movie-pipeline] beforeExit code=', code);
});

process.on('exit', (code) => {
  console.error('[movie-pipeline] exit code=', code);
});

process.on('SIGINT', () => {
  console.error('[movie-pipeline] SIGINT');
});

process.on('SIGTERM', () => {
  console.error('[movie-pipeline] SIGTERM');
});

const server = app.listen(port, '127.0.0.1', () => {
  console.log(`[movie-pipeline] build=${MP_SERVER_BUILD_ID} listening on http://127.0.0.1:${port}`);
});

server.on('error', (err) => {
  console.error('[movie-pipeline] server error:', err);
});

server.on('close', () => {
  console.error('[movie-pipeline] server closed');
});
