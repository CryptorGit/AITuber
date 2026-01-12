import fs from 'node:fs';
import path from 'node:path';

function pushTag(tags: Set<string>, tag: string) {
  tags.add(tag);
}

function parseWinnerFromLine(line: string) {
  const winMatch = line.match(/\|win\|([^|]+)/);
  if (winMatch) return winMatch[1].trim();
  const txtMatch = line.match(/won the battle!?/i);
  if (txtMatch) return line.replace(/.*?([A-Za-z0-9 _-]+)\s+won the battle!.*/i, '$1').trim();
  return null;
}

function parseTurnFromLine(line: string) {
  const turnMatch = line.match(/\|turn\|(\d+)/);
  if (turnMatch) return Number(turnMatch[1]);
  const alt = line.match(/Turn\s+(\d+)/i);
  if (alt) return Number(alt[1]);
  return null;
}

export function parseBattleLogMeta(filePath: string) {
  const tags = new Set<string>();
  let winner: string | null = null;
  let turns: number | null = null;

  const ext = path.extname(filePath).toLowerCase();
  const raw = fs.readFileSync(filePath, 'utf8');

  const scanLine = (line: string) => {
    if (!line) return;
    const low = line.toLowerCase();
    const t = parseTurnFromLine(line);
    if (t != null) turns = Math.max(turns || 0, t);

    const win = parseWinnerFromLine(line);
    if (win && !winner) winner = win;

    if (low.includes('|faint|') || low.includes('fainted')) pushTag(tags, 'faint');
    if (low.includes('trick room')) pushTag(tags, 'trick-room');
    if (low.includes('tailwind')) pushTag(tags, 'tailwind');
    if (low.includes('tera') || low.includes('terastall')) pushTag(tags, 'tera');
    if (low.includes('|move|')) pushTag(tags, 'moves');
  };

  if (ext === '.jsonl') {
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed);
        const text = typeof obj === 'string' ? obj : String(obj?.text ?? obj?.message ?? obj?.line ?? '');
        scanLine(text);
      } catch {
        scanLine(trimmed);
      }
    }
  } else if (ext === '.json') {
    try {
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        for (const item of data) {
          const text = typeof item === 'string' ? item : String(item?.text ?? item?.message ?? '');
          scanLine(text);
        }
      } else if (data?.events && Array.isArray(data.events)) {
        for (const item of data.events) {
          const text = typeof item === 'string' ? item : String(item?.text ?? item?.message ?? '');
          scanLine(text);
        }
      } else {
        scanLine(JSON.stringify(data));
      }
    } catch {
      raw.split(/\r?\n/).forEach(scanLine);
    }
  } else {
    raw.split(/\r?\n/).forEach(scanLine);
  }

  return { turns, winner, tags: Array.from(tags) };
}
