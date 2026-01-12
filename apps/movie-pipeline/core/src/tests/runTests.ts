import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeTimings } from '../pipeline/timing.ts';
import { buildFilterComplex } from '../pipeline/ffmpeg.ts';
import { defaultProjectSettings } from '../config.ts';
import { buildSsmlWithMarks, timepointsToTiming } from '../adapters/tts/googleTts.ts';
import { hashTts } from '../pipeline/hashes.ts';
import { createProjectRecord, projectArtifactPath, projectArtifactRel } from '../project/store.ts';
import type { ScriptDraft, TtsTiming } from '../types.ts';

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
  const tmpRoot = path.join(process.cwd(), 'src', 'tests', 'fixtures', 'tmp_data');
  process.env.MP_DATA_ROOT = tmpRoot;
  const settings = defaultProjectSettings();
  const project = createProjectRecord(
    'hash_project',
    { battle_id: 'battle', base_mp4: 'base.mp4', battle_log: 'log.txt', ts_log: null, bgm_mp3: null, character_id: null },
    settings
  );
  const scriptRel = projectArtifactRel('script.json');
  project.outputs.script_json = scriptRel;
  const scriptPath = projectArtifactPath(project.project_id, scriptRel);
  fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
  fs.writeFileSync(
    scriptPath,
    JSON.stringify({ battle_id: 'battle', version: 1, segments: [{ id: 'seg_001', start_hint_ms: null, end_hint_ms: null, text: 'Hi', speaker: 'n', emotion_tag: 'neutral', reason_tags: [], source_refs: [] }] }, null, 2),
    'utf8'
  );

  const hash1 = await hashTts(project);
  project.settings.tts.google.voice_name = 'ja-JP-Standard-B';
  const hash2 = await hashTts(project);
  assert.notEqual(hash1, hash2);
}

async function run() {
  testTimingNormalize();
  testFilterBuilder();
  testSettings();
  testSsmlMarks();
  testTimepointMapping();
  await testTtsHashDiff();
  console.log('All tests passed');
}

void run();
