import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function repoRoot() {
  return path.resolve(__dirname, '..', '..', '..', '..');
}

export function dataRoot() {
  if (process.env.MP_DATA_ROOT) return path.resolve(process.env.MP_DATA_ROOT);
  return path.join(repoRoot(), 'data', 'movie-pipeline');
}

export function assetsRoot() {
  if (process.env.MP_ASSETS_ROOT) return path.resolve(process.env.MP_ASSETS_ROOT);

  const defaultReplays = path.join(dataRoot(), 'replays');
  const vgcExports = path.join(repoRoot(), 'data', 'pokemon-showdown', 'vgc-demo', 'exports');

  const dirHasTopLevelMatch = (dirPath: string, re: RegExp) => {
    try {
      if (!fs.existsSync(dirPath)) return false;
      for (const name of fs.readdirSync(dirPath)) {
        if (re.test(name)) return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  // Prefer the default replays dir only if it actually contains exports.
  if (dirHasTopLevelMatch(defaultReplays, /\.(mp4|webm|mkv)$/i) || dirHasTopLevelMatch(defaultReplays, /\.battlelog\.jsonl$/i)) {
    return defaultReplays;
  }
  // Common local dev source of exports.
  if (dirHasTopLevelMatch(vgcExports, /\.(mp4|webm|mkv)$/i) || dirHasTopLevelMatch(vgcExports, /\.battlelog\.jsonl$/i)) {
    return vgcExports;
  }

  return defaultReplays;
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
  return process.env.MP_BGM_ROOT ? path.resolve(process.env.MP_BGM_ROOT) : path.join(dataRoot(), 'bgm');
}

export function registryPath() {
  return path.join(dataRoot(), 'registry.json');
}

export function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

