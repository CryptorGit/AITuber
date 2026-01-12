import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, projectsRoot } from '../paths.ts';
import { readJson, writeJson } from '../utils/io.ts';
import { defaultProjectSettings, mergeSettings } from '../config.ts';
import type { ProjectInputs, ProjectRecord, ProjectSettings, ProjectOutputs, StepStatus, StepName, RunRecord } from '../types.ts';

export type ProjectPaths = {
  root: string;
  projectPath: string;
  artifactsDir: string;
  runsDir: string;
  legacyStatusPath: string;
};

export function projectPaths(projectId: string): ProjectPaths {
  const root = path.join(projectsRoot(), projectId);
  return {
    root,
    projectPath: path.join(root, 'project.json'),
    artifactsDir: path.join(root, 'artifacts'),
    runsDir: path.join(root, 'runs'),
    legacyStatusPath: path.join(root, 'status.json'),
  };
}

export function ensureProjectDirs(projectId: string) {
  const paths = projectPaths(projectId);
  ensureDir(paths.root);
  ensureDir(paths.artifactsDir);
  ensureDir(paths.runsDir);
  return paths;
}

export function emptyStepStatus(): StepStatus {
  return {
    status: 'PENDING',
    started_at: null,
    ended_at: null,
    log_path: null,
    error: null,
    cached: false,
  };
}

export function createProjectRecord(projectId: string, inputs: ProjectInputs, settings?: Partial<ProjectSettings>): ProjectRecord {
  const now = new Date().toISOString();
  return {
    project_id: projectId,
    battle_id: inputs.battle_id,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    inputs,
    settings: mergeSettings(settings),
    outputs: {
      script_json: null,
      script_timed_json: null,
      subtitles_draft_srt: null,
      subtitles_srt: null,
      subtitles_ass: null,
      tts_wav: null,
      tts_mp3: null,
      tts_timing_json: null,
      overlay_webm: null,
      overlay_mp4: null,
      lip_sync_json: null,
      final_mp4: null,
      final_with_subs_mp4: null,
      manifest_json: null,
    },
    steps: {
      ladm: emptyStepStatus(),
      tts: emptyStepStatus(),
      live2d: emptyStepStatus(),
      compose: emptyStepStatus(),
    },
    last_run_id: null,
    hashes: {
      ladm: null,
      tts: null,
      live2d: null,
      compose: null,
    },
  };
}

function migrateLegacyStatus(projectId: string, projectPath: string): ProjectRecord | null {
  const legacyPath = projectPaths(projectId).legacyStatusPath;
  if (!fs.existsSync(legacyPath)) return null;
  const legacy = readJson<any>(legacyPath, null);
  if (!legacy) return null;

  const inputs: ProjectInputs = {
    battle_id: legacy.battle_id || projectId,
    base_mp4: legacy.inputs?.base_mp4 || legacy.inputs?.baseMp4 || legacy.base_mp4 || '',
    battle_log: legacy.inputs?.battle_log || legacy.battle_log || '',
    ts_log: legacy.inputs?.ts_log || legacy.ts_log || null,
    bgm_mp3: legacy.inputs?.bgm_mp3 || legacy.bgm_mp3 || null,
    character_id: null,
  };

  const record = createProjectRecord(projectId, inputs, defaultProjectSettings());
  record.outputs = {
    ...record.outputs,
    script_json: legacy.artifacts?.script_timeline || null,
    subtitles_ass: legacy.artifacts?.subtitles_ass || null,
    tts_mp3: legacy.artifacts?.tts_mp3 || null,
    tts_wav: legacy.artifacts?.tts_wav || null,
    overlay_webm: legacy.artifacts?.overlay_video || null,
    final_mp4: legacy.artifacts?.final_mp4 || null,
  } as ProjectOutputs;

  record.updated_at = new Date().toISOString();
  writeJson(projectPath, record);
  return record;
}

export function saveProject(record: ProjectRecord) {
  const paths = projectPaths(record.project_id);
  record.updated_at = new Date().toISOString();
  ensureProjectDirs(record.project_id);
  writeJson(paths.projectPath, record);
}

export function loadProject(projectId: string): ProjectRecord | null {
  const paths = projectPaths(projectId);
  if (fs.existsSync(paths.projectPath)) {
    const record = readJson<ProjectRecord | null>(paths.projectPath, null);
    if (!record) return null;
    record.settings = mergeSettings(record.settings);
    return record;
  }
  return migrateLegacyStatus(projectId, paths.projectPath);
}

export function updateProject(projectId: string, updater: (record: ProjectRecord) => ProjectRecord) {
  const existing = loadProject(projectId);
  if (!existing) throw new Error(`Project not found: ${projectId}`);
  const updated = updater(existing);
  saveProject(updated);
  return updated;
}

export function listProjects(opts?: { includeDeleted?: boolean }) {
  ensureDir(projectsRoot());
  const entries = fs.readdirSync(projectsRoot(), { withFileTypes: true });
  const out: ProjectRecord[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const projectId = entry.name;
    const record = loadProject(projectId);
    if (!record) continue;
    if (!opts?.includeDeleted && record.deleted_at) continue;
    out.push(record);
  }
  return out.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function deleteProject(projectId: string, opts?: { hard?: boolean }) {
  const paths = projectPaths(projectId);
  if (opts?.hard) {
    fs.rmSync(paths.root, { recursive: true, force: true });
    return null;
  }
  return updateProject(projectId, (record) => {
    record.deleted_at = new Date().toISOString();
    return record;
  });
}

export function restoreProject(projectId: string) {
  return updateProject(projectId, (record) => {
    record.deleted_at = null;
    return record;
  });
}

export function duplicateProject(projectId: string, newId: string) {
  const src = loadProject(projectId);
  if (!src) throw new Error(`Project not found: ${projectId}`);
  const copy: ProjectRecord = {
    ...src,
    project_id: newId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null,
    last_run_id: null,
    steps: {
      ladm: emptyStepStatus(),
      tts: emptyStepStatus(),
      live2d: emptyStepStatus(),
      compose: emptyStepStatus(),
    },
    outputs: {
      script_json: null,
      script_timed_json: null,
      subtitles_draft_srt: null,
      subtitles_srt: null,
      subtitles_ass: null,
      tts_wav: null,
      tts_mp3: null,
      tts_timing_json: null,
      overlay_webm: null,
      overlay_mp4: null,
      lip_sync_json: null,
      final_mp4: null,
      final_with_subs_mp4: null,
      manifest_json: null,
    },
    hashes: {
      ladm: null,
      tts: null,
      live2d: null,
      compose: null,
    },
  };
  saveProject(copy);
  return copy;
}

export function runPaths(projectId: string, runId: string) {
  const root = path.join(projectPaths(projectId).runsDir, runId);
  return {
    root,
    runPath: path.join(root, 'run.json'),
    stepsDir: path.join(root, 'steps'),
  };
}

export function projectArtifactPath(projectId: string, relPath: string) {
  return path.join(projectPaths(projectId).root, relPath);
}

export function projectArtifactRel(fileName: string) {
  return path.join('artifacts', fileName);
}

export function runLogPath(projectId: string, runId: string, step: StepName) {
  return path.join(runPaths(projectId, runId).stepsDir, `${step}.log`);
}

export function saveRun(run: RunRecord) {
  const paths = runPaths(run.project_id, run.run_id);
  ensureDir(paths.root);
  ensureDir(paths.stepsDir);
  writeJson(paths.runPath, run);
}

export function loadRun(projectId: string, runId: string): RunRecord | null {
  const paths = runPaths(projectId, runId);
  if (!fs.existsSync(paths.runPath)) return null;
  return readJson<RunRecord | null>(paths.runPath, null);
}

export function listRuns(projectId: string) {
  const root = projectPaths(projectId).runsDir;
  if (!fs.existsSync(root)) return [];
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const out: RunRecord[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const runId = entry.name;
    const run = loadRun(projectId, runId);
    if (run) out.push(run);
  }
  return out.sort((a, b) => b.started_at.localeCompare(a.started_at));
}
