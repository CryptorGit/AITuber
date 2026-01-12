import fs from 'node:fs';
import path from 'node:path';
import { assetsRoot, ensureDir, registryPath } from '../paths.ts';
import { readJson, writeJson } from '../utils/io.ts';
import type { AssetEntry, AssetRegistry } from '../types.ts';
import { parseBattleLogMeta } from './battleMeta.ts';

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

function readDirMtimeMs(dir: string) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let max = 0;
  for (const entry of entries) {
    const p = path.join(dir, entry.name);
    try {
      const st = fs.statSync(p);
      if (st.mtimeMs > max) max = st.mtimeMs;
    } catch {
      // ignore
    }
  }
  return max;
}

function listFiles(dir: string) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.filter((e) => e.isFile()).map((e) => e.name).sort();
}

function registryIsFresh(registry: AssetRegistry, current: Record<string, { dir_mtime_ms: number; files: string[] }>) {
  const prev = registry.scan_meta.entries || {};
  const prevKeys = Object.keys(prev).sort();
  const curKeys = Object.keys(current).sort();
  if (prevKeys.length !== curKeys.length) return false;
  for (let i = 0; i < prevKeys.length; i++) {
    if (prevKeys[i] !== curKeys[i]) return false;
  }
  for (const key of curKeys) {
    const p = prev[key];
    const c = current[key];
    if (!p || !c) return false;
    if (p.dir_mtime_ms !== c.dir_mtime_ms) return false;
    if (p.files.join('|') !== c.files.join('|')) return false;
  }
  return true;
}

export function scanAssets(opts?: { refresh?: boolean }) {
  const root = assetsRoot();
  ensureDir(root);

  const cached = readJson<AssetRegistry | null>(registryPath(), null);
  const dirEntries = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory());
  const currentMeta: Record<string, { dir_mtime_ms: number; files: string[] }> = {};
  for (const entry of dirEntries) {
    const dirPath = path.join(root, entry.name);
    currentMeta[entry.name] = {
      dir_mtime_ms: readDirMtimeMs(dirPath),
      files: listFiles(dirPath),
    };
  }

  if (!opts?.refresh && cached && registryIsFresh(cached, currentMeta)) {
    return cached;
  }

  const assets: AssetEntry[] = [];
  for (const entry of dirEntries) {
    const battleId = entry.name;
    const dir = path.join(root, battleId);
    const base_mp4 = findBaseMp4(dir);
    const battle_log = findBattleLog(dir);
    const ts_log = findTsLog(dir);
    const meta = battle_log ? parseBattleLogMeta(battle_log) : { turns: null, winner: null, tags: [] };
    assets.push({
      battle_id: battleId,
      dir,
      base_mp4,
      battle_log,
      ts_log,
      updated_at: new Date(currentMeta[battleId]?.dir_mtime_ms || Date.now()).toISOString(),
      turns: meta.turns,
      winner: meta.winner,
      tags: meta.tags,
    });
  }

  const registry: AssetRegistry = {
    version: 2,
    updated_at: new Date().toISOString(),
    assets,
    scan_meta: {
      root,
      scanned_at: new Date().toISOString(),
      entries: currentMeta,
    },
  };
  ensureDir(path.dirname(registryPath()));
  writeJson(registryPath(), registry);
  return registry;
}
