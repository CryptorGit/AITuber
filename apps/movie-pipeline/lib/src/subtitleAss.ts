import type { SubtitleTimeline } from './types.ts';

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

export function subtitleTimelineToAss(subtitle: SubtitleTimeline, opts?: { title?: string }) {
  const title = opts?.title || 'Movie Pipeline';
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
  lines.push('Style: Default,Arial,54,&H00FFFFFF,&H000000FF,&H00101010,&H80000000,0,0,0,0,100,100,0,0,1,3,1,2,60,60,60,1');
  lines.push('');

  lines.push('[Events]');
  lines.push('Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text');
  for (const item of subtitle.items) {
    const start = formatAssTime(item.start_ms);
    const end = formatAssTime(item.end_ms);
    const text = escapeAssText(item.text);
    lines.push(`Dialogue: 0,${start},${end},Default,,0,0,0,,${text}`);
  }
  return lines.join('\n') + '\n';
}
