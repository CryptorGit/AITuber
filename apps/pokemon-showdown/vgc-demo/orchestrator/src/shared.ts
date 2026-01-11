import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type JsonRow = Record<string, unknown>;

export function repoRoot(): string {
  const here = fileURLToPath(new URL('.', import.meta.url));
  return join(here, '../../../../..');
}

export function parseArgs(argv: string[]) {
  const out: Record<string, string> = {};
  const positional: string[] = [];

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
      out[k] = v;
    } else {
      positional.push(a);
    }
  }

  // npm on some versions may consume unknown "--flag" options and leave only values.
  // Support positional fallback.
  // Common shapes observed:
  // - [n_battles, format, p1_policy, p2_policy, python_url?, seed?]
  // - [n_battles, format, python_url, p1_policy, p2_policy, seed?] (when npm eats the flags)
  const looksLikeUrl = (s: string | undefined) => !!s && /^https?:\/\//i.test(s);
  if (!out['n_battles'] && positional[0]) out['n_battles'] = positional[0];
  if (!out['format'] && positional[1]) out['format'] = positional[1];

  if (looksLikeUrl(positional[2])) {
    if (!out['python_url'] && positional[2]) out['python_url'] = positional[2];
    if (!out['p1_policy'] && positional[3]) out['p1_policy'] = positional[3];
    if (!out['p2_policy'] && positional[4]) out['p2_policy'] = positional[4];
    if (!out['seed'] && positional[5]) out['seed'] = positional[5];
  } else {
    if (!out['p1_policy'] && positional[2]) out['p1_policy'] = positional[2];
    if (!out['p2_policy'] && positional[3]) out['p2_policy'] = positional[3];
    if (!out['python_url'] && positional[4]) out['python_url'] = positional[4];
    if (!out['seed'] && positional[5]) out['seed'] = positional[5];
  }

  return out;
}

export function isoNow() {
  return new Date().toISOString();
}

export function makeRunId() {
  const ts = new Date().toISOString().replace(/[-:.TZ]/g, '');
  const rand = randomBytes(4).toString('hex');
  return `${ts}_${rand}`;
}

export function sha256Hex(s: string) {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

export function hashToUnitInterval(s: string): number {
  const h = sha256Hex(s).slice(0, 8);
  const n = parseInt(h, 16) >>> 0;
  return n / 0x1_0000_0000;
}

export function readJsonl(filePath: string): JsonRow[] {
  if (!existsSync(filePath)) return [];
  const txt = readFileSync(filePath, 'utf8');
  const lines = txt.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const rows: JsonRow[] = [];
  for (const line of lines) {
    try {
      rows.push(JSON.parse(line));
    } catch {
      // ignore malformed lines
    }
  }
  return rows;
}

export function aggregateSummary(rows: JsonRow[]) {
  const n = rows.length;
  let p1wins = 0;
  let p2wins = 0;
  let ties = 0;
  let errors = 0;
  let totalTurns = 0;
  let totalSimMs = 0;
  let totalBattleMs = 0;
  let format: string | null = null;
  let runId: string | null = null;

  const asNum = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const asStr = (v: unknown) => (typeof v === 'string' ? v : null);

  for (const r of rows) {
    const w = asStr(r['winner']);
    if (w === 'p1') p1wins++;
    else if (w === 'p2') p2wins++;
    else if (w === 'tie' || w === null) ties++;
    else if (w === 'error') errors++;

    totalTurns += asNum(r['turns']);
    totalSimMs += asNum(r['sim_ms'] ?? r['ms']);
    totalBattleMs += asNum(r['battle_total_ms'] ?? r['duration_ms']);

    if (!format) format = asStr(r['format']);
    if (!runId) runId = asStr(r['run_id']);
  }

  return {
    run_id: runId,
    format,
    n_battles: n,
    p1wins,
    p2wins,
    ties,
    winrate_p1: n ? p1wins / n : 0,
    avg_turns: n ? totalTurns / n : 0,
    avg_ms: n ? totalSimMs / n : 0,
    avg_sim_ms: n ? totalSimMs / n : 0,
    avg_battle_total_ms: n ? totalBattleMs / n : 0,
    error_rate: n ? errors / n : 0,
  };
}
