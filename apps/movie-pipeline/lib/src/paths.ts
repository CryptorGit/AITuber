import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function repoRoot() {
  return path.resolve(__dirname, '..', '..', '..', '..');
}

export function dataRoot() {
  return path.join(repoRoot(), 'data', 'movie-pipeline');
}

export function assetsRoot() {
  return path.join(repoRoot(), 'data', 'replays');
}

export function registryPath() {
  return path.join(dataRoot(), 'registry.json');
}

export function projectsRoot() {
  return path.join(dataRoot(), 'projects');
}

export function bgmRoot() {
  return path.join(dataRoot(), 'bgm');
}

export function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}
