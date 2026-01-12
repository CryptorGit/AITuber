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

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

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

app.get('/api/mp/assets', (req, res) => {
  const refresh = String(req.query.refresh ?? '').toLowerCase();
  const doRefresh = refresh === '1' || refresh === 'true' || refresh === 'yes';
  const registry = scanAssets({ refresh: doRefresh });
  const bgm = listBgm();
  const characters = listCharacters();
  res.json({ registry, bgm, characters });
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
  if (!asset?.base_mp4 || !asset?.battle_log) {
    return res.status(400).json({ error: 'asset missing base_mp4/battle_log' });
  }

  const projectId = String(body.project_id ?? '').trim() || `${battleId}_${Date.now()}`;
  requireSafeId(projectId, 'project_id');
  if (loadProject(projectId)) {
    return res.status(400).json({ error: 'project_id already exists' });
  }

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

  const characterId = body.character_id ? String(body.character_id) : null;
  const settings = mergeSettings(body.settings || undefined);
  const character = loadCharacter(characterId);
  settings.render.width = character.width || settings.render.width;
  settings.render.height = character.height || settings.render.height;
  settings.render.fps = character.fps || settings.render.fps;
  settings.render.chroma_key = character.chroma_key || settings.render.chroma_key;

  const project = createProjectRecord(projectId, {
    battle_id: battleId,
    base_mp4: asset.base_mp4,
    battle_log: asset.battle_log,
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
  if (!script?.segments || !Array.isArray(script.segments)) {
    return res.status(400).json({ error: 'script.segments required' });
  }

  const scriptRel = projectArtifactRel('script.json');
  fs.writeFileSync(projectArtifactPath(id, scriptRel), JSON.stringify(script, null, 2), 'utf8');

  const updated = updateProject(id, (rec) => {
    rec.outputs.script_json = scriptRel;
    rec.outputs.tts_wav = null;
    rec.outputs.tts_mp3 = null;
    rec.outputs.tts_timing_json = null;
    rec.outputs.script_timed_json = null;
    rec.outputs.subtitles_srt = null;
    rec.outputs.subtitles_ass = null;
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
app.listen(port, '127.0.0.1', () => {
  console.log(`[movie-pipeline] server listening on http://127.0.0.1:${port}`);
});
