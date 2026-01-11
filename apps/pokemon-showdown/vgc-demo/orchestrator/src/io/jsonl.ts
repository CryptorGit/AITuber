import { mkdirSync, appendFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';

export function appendJsonl(filePath: string, obj: unknown) {
  mkdirSync(dirname(filePath), { recursive: true });
  appendFileSync(filePath, JSON.stringify(obj) + '\n', { encoding: 'utf8' });
}

// Appends a gzip member per line. This keeps append-only semantics while still
// producing a valid .gz file (as a concatenation of gzip members).
export function appendJsonlGz(filePath: string, obj: unknown) {
  mkdirSync(dirname(filePath), { recursive: true });
  const line = JSON.stringify(obj) + '\n';
  const buf = gzipSync(Buffer.from(line, 'utf8'));
  appendFileSync(filePath, buf);
}

export function readJsonlMaybeGz(filePath: string): any[] {
  if (!existsSync(filePath)) return [];
  const raw = readFileSync(filePath);
  const txt = filePath.endsWith('.gz') ? gunzipSync(raw).toString('utf8') : raw.toString('utf8');
  return txt
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function getLastJsonlObjectMaybeGz(filePath: string): any | null {
  const rows = readJsonlMaybeGz(filePath);
  if (rows.length === 0) return null;
  return rows[rows.length - 1];
}
