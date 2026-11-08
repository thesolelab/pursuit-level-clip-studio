import test from 'node:test';
import assert from 'node:assert/strict';
import {MAX_CLIPS, MAX_PROJECT_BYTES, safeProject, validateProjectSource, snapshotClips} from '../js/project.js';
import {cropRect, videoFilter} from '../js/export-settings.js';

function project(count = 1) {
  return {type: 'pursuit-level-clip-studio', schemaVersion: 1,
    source: {name: 'sample.mp4', size: 123, duration: 10},
    clips: Array.from({length: count}, () => ({name: 'Clip', start: 1, end: 9,
      format: 'vertical', quality: '720', mute: false, crop: {x: 50, y: 50, zoom: 1}}))};
}
test('a maximum-size saved project round-trips within the import byte limit', () => {
  const raw = project(MAX_CLIPS);
  for (const clip of raw.clips) clip.name = '🎬'.repeat(80);
  const text = JSON.stringify(raw);
  assert.ok(Buffer.byteLength(text) < MAX_PROJECT_BYTES);
  assert.equal(safeProject(JSON.parse(text)).clips.length, MAX_CLIPS);
  assert.throws(() => safeProject(project(MAX_CLIPS + 1)), /Invalid/);
});
test('invalid projects and crop settings are rejected', () => {
  for (const change of [p => p.schemaVersion = 99, p => p.clips[0].end = 0,
    p => p.clips[0].crop.zoom = 3, p => p.source.duration = 'bad']) {
    const raw = project(); change(raw); assert.throws(() => safeProject(raw));
  }
});
test('duration validation uses the actual video, not just saved metadata', () => {
  const raw = project(); raw.source.duration = 10.2; raw.clips[0].end = 10.2;
  const clean = safeProject(raw);
  assert.throws(() => validateProjectSource(clean, raw.source, 10), /beyond/);
  assert.throws(() => validateProjectSource(clean, {...raw.source, name: 'other.mp4'}, 10.2), /original/);
  assert.throws(() => validateProjectSource(clean, raw.source, 9), /duration/);
});
test('sub-millisecond endpoint rounding is clamped to actual media duration', () => {
  const raw = project(); raw.clips[0].end = 10;
  const result = validateProjectSource(safeProject(raw), raw.source, 9.9997);
  assert.equal(result[0].end, 9.9997);
  assert.equal(raw.clips[0].end, 10);
});
test('export snapshots are isolated from subsequent editor mutations', () => {
  const original = project().clips;
  const snapshot = snapshotClips(original);
  original[0].start = 5; original[0].crop.x = 99; original.splice(0, 1);
  assert.equal(snapshot.length, 1); assert.equal(snapshot[0].start, 1); assert.equal(snapshot[0].crop.x, 50);
});
test('crop geometry stays inside the source at every position and zoom', () => {
  for (const [width, height] of [[1920,1080], [1080,1920], [641,479]]) {
    for (const format of ['vertical','landscape']) for (const zoom of [1, 2]) for (const x of [0,50,100]) for (const y of [0,50,100]) {
      const rect = cropRect(width,height,format,{x,y,zoom});
      assert.ok(rect.left >= 0 && rect.top >= 0);
      assert.ok(rect.left + rect.width <= width + 1e-6 && rect.top + rect.height <= height + 1e-6);
      assert.ok(Math.abs(rect.width / rect.height - (format === 'vertical' ? 9/16 : 16/9)) < 1e-6);
    }
  }
});
test('export preserves original framing and produces even cropped dimensions', () => {
  const clip = project().clips[0];
  assert.match(videoFilter({...clip,format:'original'},1080,1920), /scale=720:1280:force_original_aspect_ratio=decrease/);
  const filter = videoFilter({...clip,quality:'source'},641,479);
  const [w,h,x,y] = /crop=(\d+):(\d+):(\d+):(\d+)/.exec(filter).slice(1).map(Number);
  for (const value of [w,h,x,y]) assert.equal(value % 2, 0);
  assert.ok(x+w <= 641 && y+h <= 479);
  assert.ok(!filter.includes('scale='));
});
