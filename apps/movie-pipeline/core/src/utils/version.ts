import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../paths.ts';

export function pipelineVersion() {
  if (process.env.MP_VERSION) return process.env.MP_VERSION;
  try {
    const headPath = path.join(repoRoot(), '.git', 'HEAD');
    if (!fs.existsSync(headPath)) return 'unknown';
    const head = fs.readFileSync(headPath, 'utf8').trim();
    if (head.startsWith('ref:')) {
      const ref = head.replace('ref:', '').trim();
      const refPath = path.join(repoRoot(), '.git', ref);
      if (fs.existsSync(refPath)) return fs.readFileSync(refPath, 'utf8').trim();
    }
    if (head.length >= 7) return head;
  } catch {
    return 'unknown';
  }
  return 'unknown';
}
