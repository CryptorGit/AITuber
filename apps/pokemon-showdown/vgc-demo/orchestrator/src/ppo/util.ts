export function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

export function parseHpFraction(condition: unknown): number {
  const s = String(condition ?? '').trim();
  if (!s) return 1;
  if (s === '0 fnt' || s === '0fnt') return 0;
  const first = s.split(' ')[0];
  const m = /^(\d+)\/(\d+)$/.exec(first);
  if (!m) return 1;
  const cur = Number(m[1]);
  const max = Number(m[2]);
  if (!Number.isFinite(cur) || !Number.isFinite(max) || max <= 0) return 1;
  return clamp01(cur / max);
}

export function isFaintedFromCondition(condition: unknown): boolean {
  const s = String(condition ?? '').trim();
  if (!s) return false;
  if (s === '0 fnt' || s === '0fnt') return true;
  if (s.endsWith(' fnt')) return true;
  return false;
}

export function parseSpeciesFromDetails(details: unknown): string {
  // e.g. "Landorus-Therian, L50, M" => "Landorus-Therian"
  const s = String(details ?? '').trim();
  if (!s) return '';
  const idx = s.indexOf(',');
  return (idx >= 0 ? s.slice(0, idx) : s).trim();
}

export function parseSpeciesFromSwitchDetails(details: unknown): string {
  // switch line details is similar to req.side.pokemon[i].details
  return parseSpeciesFromDetails(details);
}

export function make2d(rows: number, cols: number, fill: number): number[][] {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => fill));
}

export function rotatePush<T>(arr: T[], value: T, maxLen: number): void {
  arr.push(value);
  while (arr.length > maxLen) arr.shift();
}
