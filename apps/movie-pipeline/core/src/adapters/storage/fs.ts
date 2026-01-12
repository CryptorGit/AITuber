import fs from 'node:fs';
import path from 'node:path';
import { ensureDir } from '../../paths.ts';

export type StorageAdapter = {
  readText: (filePath: string) => string;
  writeText: (filePath: string, data: string) => void;
  readJson: <T>(filePath: string) => T;
  writeJson: (filePath: string, data: unknown) => void;
  exists: (filePath: string) => boolean;
  copy: (from: string, to: string) => void;
  ensureDir: (dir: string) => void;
};

export const fsStorage: StorageAdapter = {
  readText: (filePath) => fs.readFileSync(filePath, 'utf8'),
  writeText: (filePath, data) => {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, data, 'utf8');
  },
  readJson: (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8')),
  writeJson: (filePath, data) => {
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  },
  exists: (filePath) => fs.existsSync(filePath),
  copy: (from, to) => {
    ensureDir(path.dirname(to));
    fs.copyFileSync(from, to);
  },
  ensureDir,
};
