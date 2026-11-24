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

test('failed word alignment retries phrase timestamps and leaves leading silence empty', async () => {
  const { recognizeCaptions } = await import('../js/captions/recognition.js');
  const modes = [];
  const segments = await recognizeCaptions(
    async (audio, options) => {
      modes.push(options.return_timestamps);
      return options.return_timestamps === 'word'
        ? {
            text: 'Dialogue from video',
            chunks: [{ text: 'Dialogue', timestamp: [null, null] }]
          }
        : {
            text: 'Dialogue from video',
            chunks: [{ text: 'Dialogue from video', timestamp: [2, 4] }]
          };
    },
    new Float32Array(16000),
    10,
    8
  );
  assert.deepEqual(modes, ['word', true]);
  assert.equal(segments[0].start, 12);
  assert.equal(segments[0].end, 14);
  assert.equal(segments[0].timing, 'phrase');
  const groups = captionGroups(segments, 1);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].start, 12);
  assert.equal(groups[0].end, 14);
  assert.equal(groups[0].words.length, 3);
});

test('recognized text without speech timestamps is never spread across the selection', async () => {
  const { recognizeCaptions } = await import('../js/captions/recognition.js');
  let calls = 0;
  await assert.rejects(
    recognizeCaptions(
      async () => {
        calls++;
        return {
          text: 'Los Santos',
          chunks: [{ text: 'Los Santos', timestamp: [null, null] }]
        };
      },
      new Float32Array(16000),
      0,
      8
    ),
    /reliable speech timestamps were unavailable/
  );
  assert.equal(calls, 2);
});

test('empty timed recognition preserves existing work without untimed fallback', async () => {
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
    { code: 'NO_SPEECH' }
  );
  assert.equal(calls, 2);
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

test('rounded caption endpoints clamp to the exact video boundary within one millisecond', () => {
  const duration = 1.23456,
    state = { ...defaultCaptions(), segments: [cue('Final word', 0, 1.235)] };
  const result = safeCaptions(state, duration);
  assert.equal(result.segments[0].end, duration);
  assert.equal(result.segments[0].words.at(-1).end, duration);
  assert.throws(
    () =>
      safeCaptions(
        { ...state, segments: [cue('Too far', 0, duration + 0.002)] },
        duration
      ),
    /Invalid caption end/
  );
});

test('floating-point arithmetic at the source end does not invalidate generated captions', () => {
  const end = 0.1 + 0.2,
    state = { ...defaultCaptions(), segments: [cue('Last word', 0.1, end)] };
  assert.equal(safeCaptions(state, 0.3).segments[0].end, 0.3);
});

test('clamping cannot leave a zero-length final word outside the video', () => {
  const duration = 1.23456;
  assert.throws(
    () =>
      safeCaptions(
        { ...defaultCaptions(), segments: [cue('After end', 1.2345, 1.2354)] },
        duration
      ),
    /word timing/
  );
});

test('phrase captions show all words together within speech boundaries in ASS', async () => {
  const { wordAppearance } = await import('../js/captions/render.js');
  const c = { ...cue('Drive this amazing car', 12, 14), timing: 'phrase' },
    groups = captionGroups([c], 2),
    group = groups[0];
  const state = { ...defaultCaptions(), enabled: true, segments: [c] },
    ctx = { measureText: (t) => ({ width: t.length * 20 }) };
  for (const preset of ['pop', 'neon', 'cinematic']) {
    const style = { ...state.style, preset };
    const ass = animatedASS(
      ctx,
      { ...state, style },
      { start: 10, end: 18 },
      720,
      1280
    );
    const events = ass.split('\n').filter((l) => l.startsWith('Dialogue:'));
    assert.ok(events.length > 0);
    assert.ok(
      events.every((l) => {
        const start = l.split(',')[1];
        return start >= '0:00:02.00';
      })
    );
    const lateWord = { ...c.words.at(-1), index: 3, y: 100 };
    assert.ok(wordAppearance(lateWord, group, style, 12.2, 40).alpha > 0);
  }
  assert.equal(safeCaptions(state, 20).segments[0].timing, 'phrase');
});

test('speech detection preserves leading silence and separate pause boundaries', async () => {
  const { speechRegions } = await import('../js/captions/speech.js');
  const scores = [
    ...Array(20).fill(0.01),
    ...Array(10).fill(0.9),
    ...Array(15).fill(0.02),
    ...Array(8).fill(0.8),
    ...Array(10).fill(0.01)
  ];
  const ranges = speechRegions(scores, scores.length * 512);
  assert.equal(ranges.length, 2);
  assert.equal(ranges[0].start, (18 * 512) / 16000);
  assert.equal(ranges[0].end, (32 * 512) / 16000);
  assert.equal(ranges[1].start, (43 * 512) / 16000);
  assert.ok(ranges[0].end < ranges[1].start);
  assert.deepEqual(speechRegions(Array(100).fill(0.01), 51200), []);
});

test('transcription keeps original source offsets when silence is skipped', async () => {
  const { recognizeSpeechRegions } = await import(
    '../js/captions/recognition.js'
  );
  const segments = await recognizeSpeechRegions(
    async (audio, options) => ({
      text: 'Speech',
      chunks: [{ text: 'Speech', timestamp: [0, audio.length / 16000] }]
    }),
    new Float32Array(160000),
    30,
    10,
    [
      { start: 2, end: 3 },
      { start: 7, end: 8 }
    ]
  );
  assert.equal(segments[0].start, 32);
  assert.equal(segments[0].end, 33);
  assert.equal(segments[1].start, 37);
  assert.equal(segments[1].end, 38);
  assert.equal(segments[0].timing, 'word');
});

test('Whisper blank-audio tokens do not become dialogue or timestamp failures', async () => {
  const { recognizeCaptions } = await import('../js/captions/recognition.js');
  await assert.rejects(
    recognizeCaptions(
      async (audio, options) =>
        options.return_timestamps === 'word'
          ? {
              text: ' [BLANK_AUDIO]',
              chunks: [
                { text: ' [BLANK', timestamp: [0, 0.68] },
                { text: '_AUDIO]', timestamp: [0.68, 0.68] }
              ]
            }
          : { text: '', chunks: [] },
      new Float32Array(5632),
      3.04,
      0.352
    ),
    { code: 'NO_SPEECH' }
  );
});

test('a nonspeech detection cannot abort later genuine dialogue', async () => {
  const { recognizeSpeechRegions } = await import(
    '../js/captions/recognition.js'
  );
  let calls = 0;
  const segments = await recognizeSpeechRegions(
    async (audio, options) => {
      calls++;
      return calls <= 2
        ? { text: ' [BLANK_AUDIO]', chunks: [] }
        : {
            text: 'Actual dialogue',
            chunks: [
              { text: 'Actual', timestamp: [0, 0.25] },
              { text: 'dialogue', timestamp: [0.25, 0.5] }
            ]
          };
    },
    new Float32Array(160000),
    10,
    10,
    [
      { start: 3.04, end: 3.392 },
      { start: 5, end: 6 }
    ]
  );
  assert.equal(segments.length, 1);
  assert.equal(segments[0].start, 15);
  assert.equal(segments[0].text, 'Actual dialogue');
  assert.equal(segments[0].timing, 'word');
});

test('nonspeech-only selections cannot clear existing caption work', async () => {
  const { recognizeSpeechRegions } = await import(
    '../js/captions/recognition.js'
  );
  await assert.rejects(
    recognizeSpeechRegions(
      async () => ({ text: '[MUSIC]', chunks: [] }),
      new Float32Array(16000),
      0,
      1,
      [{ start: 0, end: 1 }]
    ),
    /existing captions were kept/
  );
});

test('skipping nonspeech never hides a genuine speech-alignment failure', async () => {
  const { recognizeSpeechRegions } = await import(
    '../js/captions/recognition.js'
  );
  let calls = 0;
  await assert.rejects(
    recognizeSpeechRegions(
      async () => {
        calls++;
        return calls === 1
          ? {
              text: 'Speech',
              chunks: [{ text: 'Speech', timestamp: [0, 0.5] }]
            }
          : { text: 'Actual spoken words', chunks: [] };
      },
      new Float32Array(64000),
      0,
      4,
      [
        { start: 0, end: 1 },
        { start: 2, end: 3 }
      ]
    ),
    /reliable speech timestamps/
  );
});

test('word-count edits retain animated preview timing and persist a pending alignment flag', () => {
  const original = { ...cue('Original words', 1, 2), timing: 'word' };
  const edited = correctCaption(original, 'Corrected additional words');
  assert.equal(edited.timing, 'estimated');
  assert.equal(edited.needsAlignment, true);
  assert.equal(edited.words.length, 3);
  const restored = safeCaptions(
    { ...defaultCaptions(), segments: [edited] },
    3
  );
  assert.equal(restored.segments[0].needsAlignment, true);
  assert.throws(
    () =>
      safeCaptions(
        {
          ...defaultCaptions(),
          segments: [{ ...edited, needsAlignment: 'yes' }]
        },
        3
      ),
    /timing-update flag/
  );
});
