import fs from 'node:fs';
import path from 'node:path';
import { bgmRoot, ensureDir } from '../paths.ts';

export type BgmEntry = { name: string; path: string; size_bytes: number };

export function listBgm(): BgmEntry[] {
  const root = bgmRoot();
  ensureDir(root);
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const out: BgmEntry[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.toLowerCase().endsWith('.mp3')) continue;
    const full = path.join(root, entry.name);
    const st = fs.statSync(full);
    out.push({ name: entry.name, path: full, size_bytes: st.size });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
