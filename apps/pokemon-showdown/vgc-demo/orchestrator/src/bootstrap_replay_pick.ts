import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Module = require('module');

const srcDir = fileURLToPath(new URL('.', import.meta.url));
const orchestratorRoot = path.join(srcDir, '..');
const nodeModulesDir = path.join(orchestratorRoot, 'node_modules');

process.env.NODE_PATH = process.env.NODE_PATH
  ? `${process.env.NODE_PATH}${path.delimiter}${nodeModulesDir}`
  : nodeModulesDir;

if (Module?.Module?._initPaths) {
  Module.Module._initPaths();
}

await import('./replay_pick.ts');
