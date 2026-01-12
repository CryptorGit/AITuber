import fs from 'node:fs';
import path from 'node:path';
import { ensureDir } from '../paths.ts';

export type StepLogger = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  logPath: string;
};

function writeLine(logPath: string, level: string, msg: string) {
  ensureDir(path.dirname(logPath));
  const ts = new Date().toISOString();
  fs.appendFileSync(logPath, `[${ts}] [${level}] ${msg}\n`, 'utf8');
}

export function createStepLogger(logPath: string): StepLogger {
  return {
    logPath,
    info: (msg) => writeLine(logPath, 'INFO', msg),
    warn: (msg) => writeLine(logPath, 'WARN', msg),
    error: (msg) => writeLine(logPath, 'ERROR', msg),
  };
}
