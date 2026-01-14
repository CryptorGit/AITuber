import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeTimings } from '../pipeline/timing.ts';
import { buildFilterComplex } from '../pipeline/ffmpeg.ts';
import { probeDurationSec, runFfmpeg } from '../pipeline/ffmpeg.ts';
import { defaultProjectSettings } from '../config.ts';
import { buildSsmlWithMarks, timepointsToTiming } from '../adapters/tts/googleTts.ts';
import { hashTts } from '../pipeline/hashes.ts';
import { createProjectRecord, ensureProjectDirs, projectArtifactPath, projectArtifactRel } from '../project/store.ts';
import type { ScriptDraft, TtsTiming } from '../types.ts';
import { runComposeStep, runLadmStep, runLive2dStep, runTtsStep } from '../pipeline/steps.ts';

function testTimingNormalize() {
  const script: ScriptDraft = {
    battle_id: 'test',
    version: 1,
    segments: [
      { id: 'seg_001', start_hint_ms: 0, end_hint_ms: 500, text: 'Hello', speaker: 'n', emotion_tag: 'neutral', reason_tags: [], source_refs: [] },
      { id: 'seg_002', start_hint_ms: 500, end_hint_ms: 1000, text: 'World', speaker: 'n', emotion_tag: 'neutral', reason_tags: [], source_refs: [] },
    ],
  };
  const tts: TtsTiming = {
    battle_id: 'test',
    version: 1,
    total_ms: 2000,
    segments: [
      { id: 'seg_001', text: 'Hello', start_ms: 0, end_ms: 900, moras: [] },
      { id: 'seg_002', text: 'World', start_ms: 900, end_ms: 1900, moras: [] },
    ],
  };

  const { script_timed } = normalizeTimings(script, tts, { pad_start_ms: 0, pad_end_ms: 0, min_gap_ms: 0 });
  assert.equal(script_timed.segments.length, 2);
  assert.equal(script_timed.segments[0].start_ms, 0);
  assert.equal(script_timed.segments[1].start_ms >= script_timed.segments[0].end_ms, true);
  assert.equal(script_timed.segments[1].end_ms <= tts.total_ms, true);
}

function testFilterBuilder() {
  const settings = defaultProjectSettings();
  const filter = buildFilterComplex({
    base_mp4: 'base.mp4',
    overlay: { path: 'ov.webm', chroma_key: '#00ff00', scale: 1, x: '10', y: '20' },
    tts_audio: 'tts.wav',
    bgm_audio: 'bgm.mp3',
    subtitles_ass: 'subs.ass',
    output_mp4: 'out.mp4',
    output_with_subs_mp4: 'out_sub.mp4',
    tts_volume: settings.audio.tts_volume,
    bgm_volume: settings.audio.bgm_volume,
    ducking: true,
  }, true);
  assert.ok(filter.includes('chromakey'));
  assert.ok(filter.includes('overlay='));
  assert.ok(filter.includes('subtitles='));
  assert.ok(filter.includes('sidechaincompress'));
}

function testSettings() {
  const settings = defaultProjectSettings();
  assert.equal(settings.tts.provider, 'google');
  assert.ok(settings.render.width > 0);
}

function testSsmlMarks() {
  const script: ScriptDraft = {
    battle_id: 'test',
    version: 1,
    segments: [
      { id: 'seg_001', start_hint_ms: null, end_hint_ms: null, text: 'Hello', speaker: 'n', emotion_tag: 'neutral', reason_tags: [], source_refs: [] },
      { id: 'seg_002', start_hint_ms: null, end_hint_ms: null, text: 'World', speaker: 'n', emotion_tag: 'neutral', reason_tags: [], source_refs: [] },
    ],
  };
  const { ssml, marks } = buildSsmlWithMarks(script, 'segment_start');
  assert.ok(ssml.includes('seg_001_start'));
  assert.ok(ssml.includes('seg_002_start'));
  assert.ok(ssml.includes('end'));
  assert.equal(marks.length, 3);
}

function testTimepointMapping() {
  const script: ScriptDraft = {
    battle_id: 'test',
    version: 1,
    segments: [
      { id: 'seg_001', start_hint_ms: null, end_hint_ms: null, text: 'Hello', speaker: 'n', emotion_tag: 'neutral', reason_tags: [], source_refs: [] },
      { id: 'seg_002', start_hint_ms: null, end_hint_ms: null, text: 'World', speaker: 'n', emotion_tag: 'neutral', reason_tags: [], source_refs: [] },
    ],
  };
  const timing = timepointsToTiming(
    script,
    [
      { markName: 'seg_001_start', timeSeconds: 0.0 },
      { markName: 'seg_002_start', timeSeconds: 1.2 },
      { markName: 'end', timeSeconds: 2.4 },
    ],
    2400
  );
  assert.equal(timing.segments.length, 2);
  assert.equal(timing.segments[0].start_ms, 0);
  assert.equal(timing.segments[0].end_ms, 1200);
  assert.equal(timing.total_ms, 2400);
}

async function testTtsHashDiff() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mp_test_hash_'));
  process.env.MP_DATA_ROOT = tmpRoot;
  const settings = defaultProjectSettings();
  const project = createProjectRecord(
    'hash_project',
    { battle_id: 'battle', base_mp4: 'base.mp4', battle_log: 'log.txt', ts_log: null, bgm_mp3: null, character_id: null },
    settings
  );
  try {
    const scriptRel = projectArtifactRel('script.json');
    project.outputs.script_json = scriptRel;
    const scriptPath = projectArtifactPath(project.project_id, scriptRel);
    fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
    fs.writeFileSync(
      scriptPath,
      JSON.stringify(
        {
          battle_id: 'battle',
          version: 1,
          segments: [{ id: 'seg_001', start_hint_ms: null, end_hint_ms: null, text: 'Hi', speaker: 'n', emotion_tag: 'neutral', reason_tags: [], source_refs: [] }],
        },
        null,
        2
      ),
      'utf8'
    );

    const narrationRel = projectArtifactRel('narration_timeline.json');
    const subtitleRel = projectArtifactRel('subtitle_timeline.json');
    project.outputs.narration_timeline_json = narrationRel;
    project.outputs.subtitle_timeline_json = subtitleRel;
    fs.writeFileSync(
      projectArtifactPath(project.project_id, narrationRel),
      JSON.stringify({ battle_id: 'battle', version: 1, items: [{ id: 'seg_001', start: 0, end: 1.0, text: 'Hi', kind: 'narration' }] }, null, 2),
      'utf8'
    );
    fs.writeFileSync(
      projectArtifactPath(project.project_id, subtitleRel),
      JSON.stringify({ battle_id: 'battle', version: 1, items: [{ id: 'seg_001', start: 0, end: 1.0, text: 'Hi', kind: 'subtitle' }] }, null, 2),
      'utf8'
    );

    const hash1 = await hashTts(project);
    project.settings.tts.google.voice_name = 'ja-JP-Standard-B';
    const hash2 = await hashTts(project);
    assert.notEqual(hash1, hash2);
  } finally {
    const keep = String(process.env.MP_KEEP_TEST_TMP || '').toLowerCase();
    if (!(keep === '1' || keep === 'true' || keep === 'yes')) {
      try {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
      } catch {}
    }
  }
}

async function maybeRunE2E() {
  const flag = String(process.env.MP_E2E || '').toLowerCase();
  if (!(flag === '1' || flag === 'true' || flag === 'yes')) return;

  // Make Live2D renderer deterministic and avoid Playwright.
  process.env.MP_MOCK_LIVE2D = '1';

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mp_e2e_'));
  process.env.MP_DATA_ROOT = tmpRoot;

  const baseMp4 = path.join(tmpRoot, 'input_battle.mp4');
  const bgmMp3 = path.join(tmpRoot, 'input_bgm.mp3');
  const tsLog = path.join(tmpRoot, 'input_timestamp_log.jsonl');

  // Generate a base video long enough for the timeline.
  await runFfmpeg(
    ['-y', '-f', 'lavfi', '-i', 'color=c=black:s=640x360:d=6', '-r', '30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', baseMp4],
    undefined
  );
  // Generate BGM (sine tone).
  await runFfmpeg(['-y', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=10', '-c:a', 'libmp3lame', '-q:a', '4', bgmMp3], undefined);
  // Minimal timestamp log (seconds + event_type).
  fs.writeFileSync(
    tsLog,
    ['{"t":0.1,"event_type":"turn","text":"Turn 1"}', '{"t":1.2,"event_type":"event","text":"Action"}', '{"t":2.4,"event_type":"event","text":"Result"}'].join('\n'),
    'utf8'
  );

  const settings = defaultProjectSettings();
  settings.tts.provider = 'mock';
  settings.ladm.max_segments = 3;
  settings.ladm.min_segment_ms = 1000;
  settings.render.width = 320;
  settings.render.height = 320;
  settings.render.fps = 15;

  const projectId = `e2e_${Date.now()}`;
  const project = createProjectRecord(
    projectId,
    { battle_id: 'battle_e2e', base_mp4: baseMp4, battle_log: null, ts_log: tsLog, bgm_mp3: bgmMp3, character_id: null },
    settings
  );

  ensureProjectDirs(projectId);

  const runId = `e2e_${Date.now()}`;
  const logPath = projectArtifactPath(projectId, projectArtifactRel('e2e.log'));

  const ladm = await runLadmStep({ project, runId, logPath });
  Object.assign(project.outputs, ladm.outputs);

  const live2d = await runLive2dStep({ project, runId, logPath });
  Object.assign(project.outputs, live2d.outputs);

  const tts = await runTtsStep({ project, runId, logPath });
  Object.assign(project.outputs, tts.outputs);

  const compose = await runComposeStep({ project, runId, logPath });
  Object.assign(project.outputs, compose.outputs);

  const narrationTl = JSON.parse(
    fs.readFileSync(projectArtifactPath(projectId, project.outputs.narration_timeline_json!), 'utf8')
  ) as { items: Array<{ end: number }> };
  const targetSec = Math.max(0, ...narrationTl.items.map((i) => Number(i.end) || 0));

  const ttsSec = await probeDurationSec(projectArtifactPath(projectId, project.outputs.tts_mp3!));
  assert.ok(Math.abs(ttsSec - targetSec) <= 0.3, `tts duration mismatch: ttsSec=${ttsSec} targetSec=${targetSec}`);

  const finalPath = projectArtifactPath(projectId, project.outputs.final_mp4!);
  assert.ok(fs.existsSync(finalPath), 'final.mp4 missing');
  const finalSec = await probeDurationSec(finalPath);
  assert.ok(finalSec > 0.1, 'final.mp4 duration too short');

  const keep = String(process.env.MP_KEEP_E2E || '').toLowerCase();
  if (!(keep === '1' || keep === 'true' || keep === 'yes')) {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {}
  }
}

async function run() {
  testTimingNormalize();
  testFilterBuilder();
  testSettings();
  testSsmlMarks();
  testTimepointMapping();
  await testTtsHashDiff();
  await maybeRunE2E();
  console.log('All tests passed');
}

void run();
