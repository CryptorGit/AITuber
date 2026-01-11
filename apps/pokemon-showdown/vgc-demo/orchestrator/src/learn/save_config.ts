export type SaveConfig = {
  saveDir: string;
  saveTrainLog: boolean;
  saveReplay: boolean;
  sampleRate: number;
  obsMode: 'full' | 'features';
  compress: boolean;
};

function boolEnv(name: string, def = false): boolean {
  const v = String(process.env[name] ?? '').trim().toLowerCase();
  if (!v) return def;
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function numEnv(name: string, def: number): number {
  const raw = String(process.env[name] ?? '').trim();
  if (!raw) return def;
  const n = Number(raw);
  return Number.isFinite(n) ? n : def;
}

export function readSaveConfig(defaultOutDir: string): SaveConfig {
  const saveTrainLog = boolEnv('VGC_SAVE_TRAIN_LOG', false);
  const saveReplay = boolEnv('VGC_SAVE_REPLAY', false);
  const sampleRate = Math.min(1, Math.max(0, numEnv('VGC_SAVE_SAMPLE_RATE', 1)));
  const obsModeRaw = String(process.env.VGC_OBS_MODE ?? '').trim().toLowerCase();
  const obsMode: 'full' | 'features' = obsModeRaw === 'full' ? 'full' : 'features';
  const compress = boolEnv('VGC_SAVE_COMPRESS', false);
  const saveDir = String(process.env.VGC_SAVE_DIR ?? '').trim() || defaultOutDir;

  return { saveDir, saveTrainLog, saveReplay, sampleRate, obsMode, compress };
}
