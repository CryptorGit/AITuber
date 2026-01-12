import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function repoRoot() {
  return path.resolve(__dirname, '..', '..', '..', '..');
}

export function dataRoot() {
  return process.env.MP_DATA_ROOT ? path.resolve(process.env.MP_DATA_ROOT) : path.join(repoRoot(), 'data', 'movie-pipeline');
}

export function assetsRoot() {
  return process.env.MP_ASSETS_ROOT ? path.resolve(process.env.MP_ASSETS_ROOT) : path.join(repoRoot(), 'data', 'replays');
}

export function charactersRoot() {
  return process.env.MP_CHARACTERS_ROOT
    ? path.resolve(process.env.MP_CHARACTERS_ROOT)
    : path.join(dataRoot(), 'characters');
}

export function projectsRoot() {
  return path.join(dataRoot(), 'projects');
}

export function bgmRoot() {
  return path.join(dataRoot(), 'bgm');
}

export function registryPath() {
  return path.join(dataRoot(), 'registry.json');
}

export function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}
