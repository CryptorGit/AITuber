import path from 'node:path';
import fs from 'node:fs';
import { ensureDir, projectsRoot } from './paths.ts';
import { readJson, writeJson } from './io.ts';
import type { ProjectStatus, StepName, StepStatus, ProjectInputs } from './types.ts';

export type ProjectPaths = {
  root: string;
  artifactsDir: string;
  logsDir: string;
  statusPath: string;
};

export function projectPaths(projectId: string): ProjectPaths {
  const root = path.join(projectsRoot(), projectId);
  return {
    root,
    artifactsDir: path.join(root, 'artifacts'),
    logsDir: path.join(root, 'logs'),
    statusPath: path.join(root, 'status.json'),
  };
}

export function ensureProjectDirs(projectId: string) {
  const paths = projectPaths(projectId);
  ensureDir(paths.root);
  ensureDir(paths.artifactsDir);
  ensureDir(paths.logsDir);
  return paths;
}

export function createProjectStatus(projectId: string, inputs: ProjectInputs): ProjectStatus {
  const now = new Date().toISOString();
  const makeStep = (): StepStatus => ({
    status: 'PENDING',
    started_at: null,
    ended_at: null,
    log_path: null,
    error: null,
  });
  return {
    project_id: projectId,
    battle_id: inputs.battle_id,
    created_at: now,
    updated_at: now,
    inputs,
    steps: {
      ladm: makeStep(),
      tts: makeStep(),
      live2d: makeStep(),
      compose: makeStep(),
    },
    artifacts: {
      script_timeline: null,
      subtitle_timeline: null,
      motion_timeline: null,
      tts_mp3: null,
      tts_wav: null,
      overlay_video: null,
      subtitles_ass: null,
      final_mp4: null,
    },
  };
}

export function saveProjectStatus(projectId: string, status: ProjectStatus) {
  const paths = projectPaths(projectId);
  status.updated_at = new Date().toISOString();
  ensureDir(paths.root);
  writeJson(paths.statusPath, status);
}

export function loadProjectStatus(projectId: string): ProjectStatus | null {
  const paths = projectPaths(projectId);
  if (!fs.existsSync(paths.statusPath)) return null;
  return readJson<ProjectStatus | null>(paths.statusPath, null);
}

export function updateProjectStatus(
  projectId: string,
  updater: (status: ProjectStatus) => ProjectStatus
): ProjectStatus {
  const existing = loadProjectStatus(projectId);
  if (!existing) throw new Error(`Project not found: ${projectId}`);
  const updated = updater(existing);
  saveProjectStatus(projectId, updated);
  return updated;
}

export function setStepStatus(
  projectId: string,
  step: StepName,
  patch: Partial<StepStatus>
): ProjectStatus {
  return updateProjectStatus(projectId, (status) => {
    status.steps[step] = { ...status.steps[step], ...patch };
    return status;
  });
}

export function setArtifactPath(
  projectId: string,
  key: keyof ProjectStatus['artifacts'],
  relPath: string
): ProjectStatus {
  return updateProjectStatus(projectId, (status) => {
    status.artifacts[key] = relPath;
    return status;
  });
}

export function projectArtifactPath(projectId: string, relPath: string) {
  return path.join(projectPaths(projectId).root, relPath);
}

export function projectLogPath(projectId: string, step: StepName) {
  return path.join('logs', `${step}.log`);
}

export function projectArtifactRel(name: string) {
  return path.join('artifacts', name);
}

export function generateProjectId(battleId: string) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '');
  return `${battleId}_${stamp}`;
}
