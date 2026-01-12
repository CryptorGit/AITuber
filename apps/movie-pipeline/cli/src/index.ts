import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

import {
  scanAssets,
  listProjects,
  createProjectRecord,
  saveProject,
  loadProject,
  runProject,
  listRuns,
  ensureProjectDirs,
  doctor,
  mergeSettings,
  projectsRoot,
  assetsRoot,
  bgmRoot,
  loadCharacter,
} from '../../core/src/index.ts';
import { requireSafeId } from '../../core/src/utils/ids.ts';
import type { StepName } from '../../core/src/types.ts';

function readArg(name: string) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return null;
  return process.argv[idx + 1] ?? null;
}

function hasArg(name: string) {
  return process.argv.includes(name);
}

function help() {
  console.log('movie-pipeline CLI');
  console.log('Commands:');
  console.log('  scan');
  console.log('  projects');
  console.log('  create --battle-id <id> [--bgm <path|name>] [--character <id>] [--project-id <id>]');
  console.log('  run --project-id <id> [--step ladm|tts|live2d|compose|all] [--force]');
  console.log('  doctor');
  console.log('  export --project-id <id> --out <path>');
  console.log('  sample --battle-id <id>');
  process.exit(1);
}

function resolveBgm(bgmArg: string | null) {
  if (!bgmArg) return null;
  if (fs.existsSync(bgmArg)) return bgmArg;
  const entry = fs.readdirSync(bgmRoot(), { withFileTypes: true })
    .filter((e) => e.isFile() && e.name === bgmArg)
    .map((e) => path.join(bgmRoot(), e.name))[0];
  return entry || null;
}

async function createProjectFromBattle(battleId: string, bgmArg: string | null, characterId?: string | null, projectId?: string) {
  const registry = scanAssets();
  const asset = registry.assets.find((a) => a.battle_id === battleId);
  if (!asset?.base_mp4 || !asset?.battle_log) {
    throw new Error('asset missing base_mp4/battle_log');
  }

  const resolvedId = projectId || `${battleId}_${Date.now()}`;
  requireSafeId(resolvedId, 'project_id');
  if (loadProject(resolvedId)) throw new Error('project_id already exists');

  const settings = mergeSettings();
  const characterProfile = loadCharacter(characterId || null);
  settings.render.width = characterProfile.width || settings.render.width;
  settings.render.height = characterProfile.height || settings.render.height;
  settings.render.fps = characterProfile.fps || settings.render.fps;
  settings.render.chroma_key = characterProfile.chroma_key || settings.render.chroma_key;
  const project = createProjectRecord(
    resolvedId,
    {
      battle_id: battleId,
      base_mp4: asset.base_mp4,
      battle_log: asset.battle_log,
      ts_log: asset.ts_log || null,
      bgm_mp3: resolveBgm(bgmArg),
      character_id: characterId || null,
    },
    settings
  );
  ensureProjectDirs(resolvedId);
  saveProject(project);
  return project;
}

async function generateSample(battleId: string) {
  const sampleDir = path.join(assetsRoot(), battleId);
  fs.mkdirSync(sampleDir, { recursive: true });
  const mp4Path = path.join(sampleDir, 'replay.mp4');
  const logPath = path.join(sampleDir, 'battle_log.txt');
  const tsLogPath = path.join(sampleDir, 'ts_log.json');

  if (!fs.existsSync(mp4Path)) {
    await new Promise<void>((resolve, reject) => {
      const args = ['-y', '-f', 'lavfi', '-i', 'color=c=gray:s=1280x720:d=6', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-shortest', mp4Path];
      const proc = spawn('ffmpeg', args, { stdio: 'ignore' });
      proc.on('error', (err) => reject(err));
      proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error('ffmpeg failed'))));
    });
  }

  if (!fs.existsSync(logPath)) {
    fs.writeFileSync(logPath, 'Battle started between Alpha and Beta!\n|turn|1\n|move|p1a: Alpha|Thunderbolt\n|faint|p2a: Beta\n|win|Alpha\n', 'utf8');
  }

  if (!fs.existsSync(tsLogPath)) {
    const ts = { events: [{ t_ms: 0, turn: 1, type: 'turn' }, { t_ms: 4000, type: 'win' }] };
    fs.writeFileSync(tsLogPath, JSON.stringify(ts, null, 2), 'utf8');
  }

  console.log(`Sample data created: ${sampleDir}`);
}

async function main() {
  const cmd = process.argv[2];
  if (!cmd) help();

  if (cmd === 'scan') {
    const registry = scanAssets({ refresh: true });
    console.log(`assets: ${registry.assets.length}`);
    return;
  }

  if (cmd === 'projects') {
    const projects = listProjects();
    for (const p of projects) {
      console.log(`${p.project_id} (battle=${p.battle_id}) last_run=${p.last_run_id || '-'}`);
    }
    return;
  }

  if (cmd === 'create') {
    const battleId = readArg('--battle-id');
    if (!battleId) throw new Error('--battle-id required');
    const projectId = readArg('--project-id') || undefined;
    const bgm = readArg('--bgm');
    const character = readArg('--character');
    const project = await createProjectFromBattle(battleId, bgm, character, projectId);
    console.log(`created project: ${project.project_id}`);
    return;
  }

  if (cmd === 'run') {
    const projectId = readArg('--project-id');
    if (!projectId) throw new Error('--project-id required');
    const stepRaw = readArg('--step') || 'all';
    const step = stepRaw === 'all' ? 'all' : (stepRaw as StepName);
    const force = hasArg('--force');
    const run = await runProject(projectId, { step, force });
    console.log(`run complete: ${run.run_id} status=${run.status}`);
    return;
  }

  if (cmd === 'doctor') {
    const statuses = await doctor();
    for (const s of statuses) {
      console.log(`${s.ok ? 'OK' : 'NG'} ${s.name}: ${s.message}`);
    }
    return;
  }

  if (cmd === 'export') {
    const projectId = readArg('--project-id');
    const outPath = readArg('--out');
    if (!projectId || !outPath) throw new Error('--project-id and --out required');
    const project = loadProject(projectId);
    if (!project?.outputs.final_mp4) throw new Error('final_mp4 missing');
    const src = path.join(projectsRoot(), projectId, project.outputs.final_mp4);
    fs.copyFileSync(src, outPath);
    const metaPath = outPath.replace(/\.mp4$/, '.json');
    fs.writeFileSync(metaPath, JSON.stringify({ project_id: projectId, battle_id: project.battle_id, source: src }, null, 2), 'utf8');
    console.log(`exported to ${outPath}`);
    return;
  }

  if (cmd === 'sample') {
    const battleId = readArg('--battle-id') || `sample_${Date.now()}`;
    await generateSample(battleId);
    return;
  }

  help();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
