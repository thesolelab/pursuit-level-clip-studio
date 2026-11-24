import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ctcTokenFrames,
  dialogueWords,
  alignmentWindows,
  alignmentText
} from '../js/captions/alignment.js';
test('acoustic frames anchor tokens after quiet context, without a speech gate', () => {
  const ids = [0, 0, 0, 1, 0, 2, 0, 0],
    classes = 3,
    data = new Float32Array(ids.length * classes).fill(-12);
  ids.forEach((id, t) => (data[t * classes + id] = 12));
  assert.deepEqual(ctcTokenFrames(data, ids.length, classes, [1, 2]), [
    { start: 3, end: 4 },
    { start: 5, end: 6 }
  ]);
});
test('repeated CTC labels require a separating blank', () => {
  const ids = [0, 1, 0, 1, 0],
    data = new Float32Array(ids.length * 2).fill(-12);
  ids.forEach((id, t) => (data[t * 2 + id] = 12));
  assert.deepEqual(ctcTokenFrames(data, ids.length, 2, [1, 1]), [
    { start: 1, end: 2 },
    { start: 3, end: 4 }
  ]);
});
test('split music labels are removed without discarding the opening dialogue', () => {
  const words = dialogueWords(
    {
      chunks: [
        { text: ' [dramatic', timestamp: [0, 4] },
        { text: ' music]', timestamp: [4, 4] },
        { text: ' Hit', timestamp: [4, 6] },
        { text: ' the', timestamp: [6, 6.2] }
      ]
    },
    30
  );
  assert.deepEqual(
    words.map((w) => w.text),
    ['Hit', 'the']
  );
  assert.equal(words[0].start, 4);
});
test('alignment windows retain context and original offsets around missed speech', () => {
  const windows = alignmentWindows(
    [
      { text: 'Hit', start: 4.18, end: 5.92 },
      { text: 'Really?', start: 8.5, end: 8.8 },
      { text: 'Later', start: 17, end: 18 }
    ],
    30
  );
  assert.equal(windows.length, 2);
  assert.ok(windows[0].start < 5.75 && windows[0].end > 8.8);
  assert.equal(windows[1].start, 15.5);
});
test('numbers and punctuation normalize to English acoustic tokens without changing display text', () => {
  assert.equal(alignmentText('GTA6!'), 'GTA SIX');
  assert.equal(alignmentText('80'), 'EIGHTY');
  assert.equal(alignmentText('3.5'), 'THREE POINT FIVE');
  assert.equal(alignmentText('1,200'), 'ONE THOUSAND TWO HUNDRED');
});

test('alignment preserves display words, internal number tokens, and the source offset', async () => {
  const { alignTranscript } = await import('../js/captions/alignment.js');
  const chars = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    encode = (text) => [...text].map((c) => chars.indexOf(c) + 1);
  const target = encode('A TWENTY ONE'),
    ids = [0, 0, ...target.flatMap((id) => [id, 0]), 0],
    classes = chars.length + 1,
    data = new Float32Array(ids.length * classes).fill(-12);
  ids.forEach((id, t) => (data[t * classes + id] = 12));
  const model = Object.assign(
    async () => ({
      logits: { dims: [1, ids.length, classes], data, dispose() {} }
    }),
    {
      config: { pad_token_id: 0, unk_token_id: 99, inputs_to_logits_ratio: 320 }
    }
  );
  const aligner = { tokenizer: { encode }, processor: async () => ({}), model };
  const result = await alignTranscript(
    aligner,
    new Float32Array(32000),
    [
      { text: 'A', start: 0, end: 0.2 },
      { text: '21', start: 0.2, end: 1 }
    ],
    10,
    2
  );
  assert.equal(result[0].text, 'A 21');
  assert.equal(result[0].words.length, 2);
  assert.equal(result[0].words[0].start, 10.04);
  assert.equal(result[0].timing, 'word');
});

test('edited captions align supplied text without recognition and clear pending timing atomically', async () => {
  const { realignEditedCaptions } = await import('../js/captions/alignment.js');
  const chars = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    encode = (text) => [...text].map((c) => chars.indexOf(c) + 1),
    target = encode('A B');
  const ids = [0, 0, ...target.flatMap((id) => [id, 0]), 0],
    classes = chars.length + 1,
    data = new Float32Array(ids.length * classes).fill(-12);
  ids.forEach((id, t) => (data[t * classes + id] = 12));
  const model = Object.assign(
    async () => ({
      logits: { dims: [1, ids.length, classes], data, dispose() {} }
    }),
    {
      config: { pad_token_id: 0, unk_token_id: 99, inputs_to_logits_ratio: 320 }
    }
  );
  const updates = await realignEditedCaptions(
    { tokenizer: { encode }, processor: async () => ({}), model },
    new Float32Array(32000),
    10,
    2,
    [
      {
        id: 7,
        text: 'A B',
        start: 10,
        end: 11,
        contextStart: 10,
        contextEnd: 12,
        needsAlignment: true
      }
    ]
  );
  assert.equal(updates[0].id, 7);
  assert.equal(updates[0].text, 'A B');
  assert.equal(updates[0].timing, 'word');
  assert.equal(updates[0].needsAlignment, false);
  assert.equal(updates[0].words[0].start, 10.04);
});
