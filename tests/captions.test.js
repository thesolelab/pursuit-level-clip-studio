import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultCaptions,
  safeCaptions,
  estimatedWords,
  correctCaption,
  srt,
  transcriptSegments,
  captionGroups
} from '../js/captions/model.js';
import { animatedASS, outputDimensions } from '../js/captions/render.js';
const cue = (text = 'Drive this car', start = 1, end = 4) => ({
  text,
  start,
  end,
  timing: 'estimated',
  words: estimatedWords(text, start, end)
});
test('caption edits preserve word timing only when alignment remains valid', () => {
  const c = { ...cue(), timing: 'word' };
  assert.equal(correctCaption(c, 'Drive that car').timing, 'word');
  assert.equal(correctCaption(c, 'Drive that amazing car').timing, 'estimated');
  assert.equal(correctCaption(c, 'Drive this car', 2, 5).words[0].start, 2);
});
test('invalid, overlapping and mismatched captions cannot replace a project', () => {
  const state = { ...defaultCaptions(), segments: [cue()] };
  assert.equal(safeCaptions(state, 5).segments.length, 1);
  assert.throws(
    () =>
      safeCaptions({ ...state, segments: [cue(), cue('Overlap', 2, 3)] }, 5),
    /overlap/
  );
  assert.throws(() => safeCaptions({ ...state, segments: [cue()] }, 2), /end/);
  assert.throws(
    () => safeCaptions({ ...state, style: { ...state.style, font: 'system' } }),
    /font/
  );
  assert.throws(
    () =>
      safeCaptions({ ...state, segments: [{ ...cue(), text: 'Different' }] }),
    /words/
  );
});
test('SRT clips and shifts source times without losing corrections', () => {
  assert.equal(
    srt([cue('Los Santos', 10, 13)], 11, 12),
    '1\n00:00:00,000 --> 00:00:01,000\nLos Santos\n'
  );
  assert.equal(srt([cue()], 5, 6), '');
});
test('word transcription and explicitly estimated fallback use source timestamps', () => {
  const result = {
    chunks: [
      { text: ' Hello', timestamp: [0, 0.5] },
      { text: ' world', timestamp: [0.5, 1] }
    ]
  };
  assert.equal(transcriptSegments(result, 12, 2)[0].words[0].start, 12);
  assert.equal(
    transcriptSegments({ text: 'Hello world' }, 12, 2, false)[0].timing,
    'estimated'
  );
  assert.throws(
    () =>
      transcriptSegments(
        { chunks: [{ text: 'two words', timestamp: [0, 1] }] },
        0,
        2
      ),
    /Reliable/
  );
  assert.equal(captionGroups([cue()], 2).length, 2);
});
test('ASS uses clipped relative timing, font embedding names, animation and escaped text', () => {
  const state = {
    ...defaultCaptions(),
    enabled: true,
    segments: [cue('{Drive} \\car', 10, 13)]
  };
  const ctx = { measureText: (t) => ({ width: t.length * 20 }) };
  for (const preset of ['pop', 'neon', 'cinematic']) {
    const ass = animatedASS(
      ctx,
      { ...state, style: { ...state.style, preset } },
      { start: 11, end: 12 },
      720,
      1280
    );
    assert.match(ass, /PlayResX: 720/);
    assert.match(ass, /\\t\(/);
    assert.doesNotMatch(ass, /\{Drive\}/);
    assert.match(ass, /0:00:00\.00/);
    assert.doesNotMatch(ass, /0:00:10/);
  }
});
test('caption output geometry matches crop formats and source quality', () => {
  const crop = { zoom: 1, x: 50, y: 50 };
  assert.deepEqual(
    outputDimensions({ format: 'vertical', quality: '720', crop }, 1920, 1080),
    [720, 1280]
  );
  assert.deepEqual(
    outputDimensions({ format: 'original', quality: '720', crop }, 1000, 1000),
    [720, 720]
  );
  assert.deepEqual(
    outputDimensions(
      { format: 'landscape', quality: 'source', crop },
      1920,
      1080
    ),
    [1920, 1080]
  );
});

test('shuffled montage caption filters keep each original source range', async () => {
  const { encodeMontage } = await import('../js/montage-export.js');
  const calls = [],
    seen = [];
  const engine = {
    exec: async (args) => {
      calls.push(args);
      return 0;
    },
    writeFile: async () => {},
    readFile: async () => new Uint8Array([1]),
    deleteFile: async () => {}
  };
  const clips = [
    { start: 20, end: 23, mute: true },
    { start: 5, end: 8, mute: true }
  ];
  await encodeMontage(engine, 'source.mp4', clips, {
    width: 640,
    height: 360,
    filterForClip: async (clip) => {
      seen.push(clip.start);
      return 'ass=source_' + clip.start + '.ass';
    }
  });
  assert.deepEqual(seen, [20, 5]);
  assert.equal(calls[0][calls[0].indexOf('-vf') + 1], 'ass=source_20.ass');
  assert.equal(calls[1][calls[1].indexOf('-vf') + 1], 'ass=source_5.ass');
});

test('recognized text survives unusable timestamp chunks instead of reporting no speech', () => {
  const segments = transcriptSegments(
    {
      text: 'Clearly audible dialogue',
      chunks: [{ text: '', timestamp: [0, 0] }]
    },
    12,
    3,
    false
  );
  assert.equal(segments[0].text, 'Clearly audible dialogue');
  assert.equal(segments[0].timing, 'estimated');
  assert.equal(segments[0].start, 12);
  assert.equal(segments[0].end, 15);
});

test('recognition retries without timestamps when timed decoders return no words', async () => {
  const { recognizeCaptions } = await import('../js/captions/recognition.js');
  const modes = [];
  const segments = await recognizeCaptions(
    async (audio, options) => {
      modes.push(options.return_timestamps);
      return options.return_timestamps === false
        ? { text: 'Dialogue from the original video' }
        : { text: '', chunks: [] };
    },
    new Float32Array(16000),
    8,
    1
  );
  assert.deepEqual(modes, ['word', true, false]);
  assert.equal(segments[0].text, 'Dialogue from the original video');
  assert.equal(segments[0].timing, 'estimated');
  assert.equal(segments[0].start, 8);
});

test('a correct transcript with broken word alignment is kept without another inference', async () => {
  const { recognizeCaptions } = await import('../js/captions/recognition.js');
  let calls = 0;
  const segments = await recognizeCaptions(
    async () => {
      calls++;
      return {
        text: 'Los Santos',
        chunks: [{ text: 'Los', timestamp: [null, null] }]
      };
    },
    new Float32Array(16000),
    0,
    1
  );
  assert.equal(calls, 1);
  assert.equal(segments[0].text, 'Los Santos');
  assert.equal(segments[0].timing, 'estimated');
});

test('empty recognition never fabricates captions or replaces work with an empty result', async () => {
  const { recognizeCaptions } = await import('../js/captions/recognition.js');
  let calls = 0;
  await assert.rejects(
    recognizeCaptions(
      async () => {
        calls++;
        return { chunks: [] };
      },
      new Float32Array(10),
      0,
      1
    ),
    /model returned no words/
  );
  assert.equal(calls, 3);
});

test('diagnostic WAV retains the exact source range and standard mono sample rate', async () => {
  const { captionAudioWav } = await import('../js/captions/audio.js');
  const bytes = captionAudioWav(new Float32Array([0, 0.5, -0.5, 1, -1]));
  const view = new DataView(bytes);
  assert.equal(new TextDecoder().decode(bytes.slice(0, 4)), 'RIFF');
  assert.equal(view.getUint32(24, true), 16000);
  assert.equal(view.getUint32(40, true), 10);
  assert.equal(view.getInt16(46, true), 16384);
  assert.equal(view.getInt16(48, true), -16384);
});

test('long transcripts without timestamps are split into valid editable segments', async () => {
  const { recognizeCaptions } = await import('../js/captions/recognition.js');
  const text = Array(300).fill('dialogue').join(' ');
  const segments = await recognizeCaptions(
    async () => ({ text, chunks: [] }),
    new Float32Array(10),
    5,
    120
  );
  assert.equal(segments.length, 38);
  assert.equal(segments[0].start, 5);
  assert.equal(segments.at(-1).end, 125);
  assert.equal(segments.map((c) => c.text).join(' '), text);
});
