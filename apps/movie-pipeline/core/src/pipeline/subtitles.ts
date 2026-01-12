import type { SubtitleTimeline } from '../types.ts';

function formatSrtTime(ms: number) {
  const total = Math.max(0, Math.round(ms));
  const hours = Math.floor(total / 3600000);
  const mins = Math.floor((total % 3600000) / 60000);
  const secs = Math.floor((total % 60000) / 1000);
  const millis = total % 1000;
  const pad = (n: number, w: number) => String(n).padStart(w, '0');
  return `${pad(hours, 2)}:${pad(mins, 2)}:${pad(secs, 2)},${pad(millis, 3)}`;
}

function formatAssTime(ms: number) {
  const total = Math.max(0, Math.round(ms));
  const cs = Math.floor((total % 1000) / 10);
  const s = Math.floor(total / 1000) % 60;
  const m = Math.floor(total / 60000) % 60;
  const h = Math.floor(total / 3600000);
  const pad = (n: number, w: number) => String(n).padStart(w, '0');
  return `${h}:${pad(m, 2)}:${pad(s, 2)}.${pad(cs, 2)}`;
}

function escapeAssText(text: string) {
  return text.replace(/\r?\n/g, '\\N').replace(/{/g, '\\{').replace(/}/g, '\\}');
}

function wrapText(text: string, maxLen: number) {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return text;
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }
    if ((current + ' ' + word).length > maxLen) {
      lines.push(current);
      current = word;
    } else {
      current += ' ' + word;
    }
  }
  if (current) lines.push(current);
  return lines.join('\n');
}

export function subtitleTimelineToSrt(subtitle: SubtitleTimeline) {
  const lines: string[] = [];
  subtitle.items.forEach((item, index) => {
    lines.push(String(index + 1));
    lines.push(`${formatSrtTime(item.start_ms)} --> ${formatSrtTime(item.end_ms)}`);
    lines.push(wrapText(item.text, 30));
    lines.push('');
  });
  return lines.join('\n');
}

export function subtitleTimelineToAss(subtitle: SubtitleTimeline, opts?: { title?: string; font?: string; fontSize?: number }) {
  const title = opts?.title || 'Movie Pipeline';
  const font = opts?.font || 'Arial';
  const fontSize = opts?.fontSize || 54;
  const lines: string[] = [];
  lines.push('[Script Info]');
  lines.push(`Title: ${title}`);
  lines.push('ScriptType: v4.00+');
  lines.push('PlayResX: 1920');
  lines.push('PlayResY: 1080');
  lines.push('WrapStyle: 0');
  lines.push('ScaledBorderAndShadow: yes');
  lines.push('');

  lines.push('[V4+ Styles]');
  lines.push('Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding');
  lines.push(`Style: Default,${font},${fontSize},&H00FFFFFF,&H000000FF,&H00101010,&H80000000,0,0,0,0,100,100,0,0,1,3,1,2,60,60,60,1`);
  lines.push('');

  lines.push('[Events]');
  lines.push('Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text');
  for (const item of subtitle.items) {
    const start = formatAssTime(item.start_ms);
    const end = formatAssTime(item.end_ms);
    const text = escapeAssText(wrapText(item.text, 30));
    lines.push(`Dialogue: 0,${start},${end},Default,,0,0,0,,${text}`);
  }
  return lines.join('\n') + '\n';
}
