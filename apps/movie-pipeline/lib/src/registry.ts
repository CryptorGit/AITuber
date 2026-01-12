import fs from 'node:fs';
import path from 'node:path';
import { assetsRoot, registryPath, ensureDir, bgmRoot } from './paths.ts';
import { readJson, writeJson } from './io.ts';
import type { AssetEntry, AssetRegistry } from './types.ts';

function isFile(p: string) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function findFirstFileByNames(dir: string, names: string[]) {
  for (const name of names) {
    const candidate = path.join(dir, name);
    if (isFile(candidate)) return candidate;
  }
  return null;
}

function findFirstByExt(dir: string, ext: string) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name.toLowerCase().endsWith(ext)) {
      return path.join(dir, entry.name);
    }
  }
  return null;
}

function findBattleLog(dir: string) {
  const direct = findFirstFileByNames(dir, ['battle_log.json', 'battle_log.jsonl', 'battle_log.txt']);
  if (direct) return direct;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const name = entry.name.toLowerCase();
    if (name.includes('battle') && (name.endsWith('.json') || name.endsWith('.jsonl') || name.endsWith('.txt'))) {
      return path.join(dir, entry.name);
    }
  }
  return null;
}

function findTsLog(dir: string) {
  const direct = findFirstFileByNames(dir, ['ts_log.json', 'ts_log.jsonl', 'timestamps.json']);
  if (direct) return direct;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const name = entry.name.toLowerCase();
    if (name.includes('ts') && name.includes('log') && name.endsWith('.json')) {
      return path.join(dir, entry.name);
    }
  }
  return null;
}

function findBaseMp4(dir: string) {
  const direct = findFirstFileByNames(dir, ['replay.mp4', 'base.mp4']);
  if (direct) return direct;
  return findFirstByExt(dir, '.mp4');
}

export function scanAssets(): AssetRegistry {
  const root = assetsRoot();
  ensureDir(root);

  const assets: AssetEntry[] = [];
  const entries = fs.readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const battleId = entry.name;
    const dir = path.join(root, entry.name);
    const base_mp4 = findBaseMp4(dir);
    const battle_log = findBattleLog(dir);
    const ts_log = findTsLog(dir);
    assets.push({
      battle_id: battleId,
      dir,
      base_mp4,
      battle_log,
      ts_log,
    });
  }

  const registry: AssetRegistry = {
    version: 1,
    updated_at: new Date().toISOString(),
    assets,
  };
  ensureDir(path.dirname(registryPath()));
  writeJson(registryPath(), registry);
  return registry;
}

export function loadRegistry(opts?: { refresh?: boolean }) {
  if (opts?.refresh) return scanAssets();
  return readJson<AssetRegistry>(registryPath(), scanAssets());
}

export type BgmEntry = { name: string; path: string; size_bytes: number };

export function listBgm(): BgmEntry[] {
  const root = bgmRoot();
  ensureDir(root);
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const out: BgmEntry[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const name = entry.name;
    if (!name.toLowerCase().endsWith('.mp3')) continue;
    const p = path.join(root, name);
    const st = fs.statSync(p);
    out.push({ name, path: p, size_bytes: st.size });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
