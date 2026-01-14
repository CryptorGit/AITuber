import fs from 'node:fs';
import path from 'node:path';
import type { ProjectRecord, RunRecord, StepName, StepStatus } from '../types.ts';
import { loadProject, saveProject, saveRun, runLogPath, ensureProjectDirs } from '../project/store.ts';
import { emptyStepStatus } from '../project/store.ts';
import { runLadmStep, runTtsStep, runLive2dStep, runComposeStep } from '../pipeline/steps.ts';
import { hashLadm, hashTts, hashLive2d, hashCompose } from '../pipeline/hashes.ts';
import { pipelineVersion } from '../utils/version.ts';
import { projectArtifactPath } from '../project/store.ts';
import { writeJson } from '../utils/io.ts';

// Source-of-Truth flow wants motion+overlay rendered before TTS.
const ORDER: StepName[] = ['ladm', 'live2d', 'tts', 'compose'];

function nowIso() {
  return new Date().toISOString();
}

function generateRunId(projectId: string) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '');
  return `${projectId}_${stamp}`;
}

function stepOutputsReady(project: ProjectRecord, step: StepName) {
  const exists = (rel: string | null) => {
    if (!rel) return false;
    const abs = projectArtifactPath(project.project_id, rel);
    return fs.existsSync(abs);
  };

  if (step === 'ladm') return Boolean(project.outputs.script_json && exists(project.outputs.script_json));
  if (step === 'live2d') return Boolean(project.outputs.overlay_webm && project.outputs.live2d_motion_json && exists(project.outputs.overlay_webm));
  if (step === 'tts') return Boolean(project.outputs.tts_mp3 && project.outputs.subtitles_ass && exists(project.outputs.tts_mp3));
  if (step === 'compose') return Boolean(project.outputs.final_mp4 && exists(project.outputs.final_mp4));
  return false;
}

async function computeHash(project: ProjectRecord, step: StepName) {
  if (step === 'ladm') return hashLadm(project);
  if (step === 'tts') return hashTts(project);
  if (step === 'live2d') return hashLive2d(project);
  if (step === 'compose') return hashCompose(project);
  return '';
}

function updateStepStatus(status: StepStatus, patch: Partial<StepStatus>): StepStatus {
  return { ...status, ...patch };
}

function buildRunRecord(project: ProjectRecord, runId: string): RunRecord {
  return {
    run_id: runId,
    project_id: project.project_id,
    status: 'RUNNING',
    started_at: nowIso(),
    ended_at: null,
    steps: {
      ladm: { ...emptyStepStatus() },
      tts: { ...emptyStepStatus() },
      live2d: { ...emptyStepStatus() },
      compose: { ...emptyStepStatus() },
    },
    inputs: project.inputs,
    settings: project.settings,
    outputs: project.outputs,
    version: pipelineVersion(),
    metrics: {},
  };
}

function writeManifest(project: ProjectRecord, run: RunRecord) {
  const manifest = {
    project_id: project.project_id,
    battle_id: project.battle_id,
    run_id: run.run_id,
    created_at: run.started_at,
    version: run.version,
    inputs: project.inputs,
    settings: project.settings,
    outputs: project.outputs,
  };
  const rel = path.join('artifacts', 'manifest.json');
  const abs = projectArtifactPath(project.project_id, rel);
  writeJson(abs, manifest);
  project.outputs.manifest_json = rel;
}

export async function runProject(projectId: string, opts?: { step?: StepName | 'all'; force?: boolean }) {
  const project = loadProject(projectId);
  if (!project) throw new Error(`Project not found: ${projectId}`);

  ensureProjectDirs(projectId);

  const runId = generateRunId(projectId);
  const run = buildRunRecord(project, runId);
  saveRun(run);

  project.last_run_id = runId;
  saveProject(project);

  const stepsToRun = opts?.step && opts.step !== 'all' ? [opts.step] : ORDER;

  for (const step of ORDER) {
    if (!stepsToRun.includes(step)) continue;

    const logPath = runLogPath(projectId, runId, step);
    const start = nowIso();
    const startMs = Date.now();

    run.steps[step] = updateStepStatus(run.steps[step], {
      status: 'RUNNING',
      started_at: start,
      ended_at: null,
      log_path: logPath,
      error: null,
      cached: false,
    });
    project.steps[step] = { ...run.steps[step] };
    saveRun(run);
    saveProject(project);

    const hash = await computeHash(project, step);
    const prevHash = project.hashes[step];

    if (!opts?.force && hash && prevHash === hash && stepOutputsReady(project, step)) {
      run.steps[step] = updateStepStatus(run.steps[step], {
        status: 'SUCCESS',
        ended_at: nowIso(),
        cached: true,
        metrics: { duration_ms: 0 },
      });
      project.steps[step] = { ...run.steps[step] };
      saveRun(run);
      saveProject(project);
      continue;
    }

    try {
      let result: { outputs: Partial<ProjectRecord['outputs']>; metrics?: Record<string, any> } | null = null;
      if (step === 'ladm') result = await runLadmStep({ project, runId, logPath });
      if (step === 'tts') result = await runTtsStep({ project, runId, logPath });
      if (step === 'live2d') result = await runLive2dStep({ project, runId, logPath });
      if (step === 'compose') result = await runComposeStep({ project, runId, logPath });

      if (result?.outputs) {
        project.outputs = { ...project.outputs, ...result.outputs };
        run.outputs = project.outputs;
      }

      const durationMs = Date.now() - startMs;
      run.steps[step].metrics = { duration_ms: durationMs, ...(result?.metrics || {}) };

      project.hashes[step] = hash;

      run.steps[step] = updateStepStatus(run.steps[step], {
        status: 'SUCCESS',
        ended_at: nowIso(),
        cached: false,
      });
      project.steps[step] = { ...run.steps[step] };
      saveRun(run);
      saveProject(project);
    } catch (e: any) {
      const message = String(e?.message ?? e);
      const durationMs = Date.now() - startMs;
      run.steps[step] = updateStepStatus(run.steps[step], {
        status: 'FAILED',
        ended_at: nowIso(),
        error: message,
        metrics: { duration_ms: durationMs },
      });
      project.steps[step] = { ...run.steps[step] };
      run.status = 'FAILED';
      run.ended_at = nowIso();
      saveRun(run);
      saveProject(project);
      throw e;
    }
  }

  run.status = 'SUCCESS';
  run.ended_at = nowIso();
  writeManifest(project, run);
  run.outputs = project.outputs;
  saveRun(run);
  saveProject(project);
  return run;
}
