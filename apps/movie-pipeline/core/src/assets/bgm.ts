import fs from 'node:fs';
import path from 'node:path';
import { bgmRoot, ensureDir } from '../paths.ts';

export type BgmLoopPoints = { start_sec: number; end_sec: number };
export type BgmEntry = { name: string; path: string; size_bytes: number; loop?: BgmLoopPoints | null };

function readLoopPoints(root: string): Record<string, BgmLoopPoints> {
  const p = path.join(root, 'loop_points.json');
  try {
    if (!fs.existsSync(p)) return {};
    const raw = fs.readFileSync(p, 'utf8');
    const json: any = JSON.parse(raw);
    if (!json || typeof json !== 'object') return {};
    const out: Record<string, BgmLoopPoints> = {};
    for (const [k, v] of Object.entries(json)) {
      const start = Number((v as any)?.start_sec);
      const end = Number((v as any)?.end_sec);
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      if (start < 0 || end <= start) continue;
      out[String(k)] = { start_sec: start, end_sec: end };
    }
    return out;
  } catch {
    return {};
  }
}

export function listBgm(): BgmEntry[] {
  const root = bgmRoot();
  ensureDir(root);
  const loops = readLoopPoints(root);
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const out: BgmEntry[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.toLowerCase().endsWith('.mp3')) continue;
    const full = path.join(root, entry.name);
    const st = fs.statSync(full);
    out.push({ name: entry.name, path: full, size_bytes: st.size, loop: loops[entry.name] ?? null });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
