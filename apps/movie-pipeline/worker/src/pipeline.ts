import { runProject } from '../../core/src/runner/jobRunner.ts';
import type { StepName } from '../../core/src/types.ts';

export async function runProjectStep(projectId: string, step: StepName) {
  await runProject(projectId, { step });
}

export async function runProjectAll(projectId: string) {
  await runProject(projectId, { step: 'all' });
}
