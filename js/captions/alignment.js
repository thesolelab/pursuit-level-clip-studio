import {
  safeCaptions,
  defaultCaptions,
  wordsOf
} from './model.js?v=frame-align-1';

const SMALL = [
  'ZERO',
  'ONE',
  'TWO',
  'THREE',
  'FOUR',
  'FIVE',
  'SIX',
  'SEVEN',
  'EIGHT',
  'NINE',
  'TEN',
  'ELEVEN',
  'TWELVE',
  'THIRTEEN',
  'FOURTEEN',
  'FIFTEEN',
  'SIXTEEN',
  'SEVENTEEN',
  'EIGHTEEN',
  'NINETEEN'
];
const TENS = [
  '',
  '',
  'TWENTY',
  'THIRTY',
  'FORTY',
  'FIFTY',
  'SIXTY',
  'SEVENTY',
  'EIGHTY',
  'NINETY'
];
function numberWords(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n >= 1e9)
    return [...value].map((d) => SMALL[Number(d)]).join(' ');
  if (n < 20) return SMALL[n];
  if (n < 100)
    return TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + SMALL[n % 10] : '');
  for (const [size, name] of [
    [1000000, 'MILLION'],
    [1000, 'THOUSAND'],
    [100, 'HUNDRED']
  ])
    if (n >= size)
      return (
        numberWords(String(Math.floor(n / size))) +
        ' ' +
        name +
        (n % size ? ' ' + numberWords(String(n % size)) : '')
      );
}
export function alignmentText(text) {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/(\d),(?=\d)/g, '$1')
    .replace(/\d+(?:\.\d+)?/g, (value) => {
      const [whole, fraction] = value.split('.');
      return (
        ' ' +
        numberWords(whole) +
        (fraction
          ? ' POINT ' + [...fraction].map((d) => SMALL[Number(d)]).join(' ')
          : '') +
        ' '
      );
    })
    .toUpperCase()
    .replace(/[^A-Z' ]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}
// Remove complete bracketed non-dialogue annotations, including labels split
// across multiple Whisper chunks. Keep each remaining chunk's source timestamps.
export function dialogueWords(result, duration) {
  const chunks = result.chunks || [],
    joined = chunks.map((c) => c.text || '').join('');
  const labels = [...joined.matchAll(/\[[^\]\r\n]{1,100}\]/gu)].map((m) => [
    m.index,
    m.index + m[0].length
  ]);
  let cursor = 0,
    last = 0;
  const words = [];
  for (const chunk of chunks) {
    const raw = chunk.text || '';
    let text = '';
    for (let i = 0; i < raw.length; i++)
      if (!labels.some(([a, b]) => cursor + i >= a && cursor + i < b))
        text += raw[i];
    cursor += raw.length;
    const tokens = wordsOf(text);
    if (!tokens.length) continue;
    const [a, b] = chunk.timestamp || [];
    // These are window-selection hints only; they are never published as timing.
    const start = Number.isFinite(a)
      ? Math.max(0, Math.min(duration, a))
      : last;
    const end = Number.isFinite(b)
      ? Math.max(start, Math.min(duration, b))
      : start;
    for (const token of tokens)
      if (/[A-Za-z0-9]/.test(token)) words.push({ text: token, start, end });
    last = end;
  }
  if (!words.length)
    throw Error('No dialogue was recognized. Existing captions were kept.');
  return words;
}

export function alignmentWindows(words, duration) {
  const groups = [];
  let group = [];
  for (const word of words) {
    if (
      group.length &&
      (word.start - group[0].start >= 8 || group.length >= 28)
    ) {
      groups.push(group);
      group = [];
    }
    group.push(word);
  }
  if (group.length) groups.push(group);
  return groups.map((words) => ({
    words,
    start: Math.max(0, words[0].start - 1.5),
    end: Math.min(duration, Math.max(...words.map((w) => w.end)) + 1.5)
  }));
}

// Standard CTC Viterbi alignment. Free leading/trailing context is allowed; the
// transcript must pass through every token in order. Timing comes from acoustic
// frames, not token count, guessed duration, or a voice-detector threshold.
export function ctcTokenFrames(data, frames, classes, target, blank = 0) {
  if (
    !frames ||
    !target.length ||
    target.some((id) => !Number.isInteger(id) || id < 0 || id >= classes)
  )
    throw Error(
      'The transcript cannot be aligned with the English audio model.'
    );
  const labels = [blank];
  for (const id of target) labels.push(id, blank);
  const states = labels.length;
  if (frames * states > 4_000_000)
    throw Error('Alignment window is too large. Select a shorter range.');
  const back = new Int32Array(frames * states);
  let previous = new Float64Array(states).fill(-Infinity);
  previous[0] = 0;
  let best = -Infinity,
    bestFrame = -1,
    bestState = -1;
  for (let t = 0; t < frames; t++) {
    let max = -Infinity;
    for (let k = 0; k < classes; k++)
      max = Math.max(max, data[t * classes + k]);
    let sum = 0;
    for (let k = 0; k < classes; k++)
      sum += Math.exp(data[t * classes + k] - max);
    const normal = max + Math.log(sum),
      next = new Float64Array(states).fill(-Infinity);
    for (let j = 0; j < states; j++) {
      let score = previous[j],
        parent = j;
      if (j && previous[j - 1] > score) {
        score = previous[j - 1];
        parent = j - 1;
      }
      if (
        j > 1 &&
        labels[j] !== blank &&
        labels[j] !== labels[j - 2] &&
        previous[j - 2] > score
      ) {
        score = previous[j - 2];
        parent = j - 2;
      }
      next[j] = score + data[t * classes + labels[j]] - normal;
      back[t * states + j] = parent;
    }
    next[0] = 0;
    previous = next;
    for (const j of [states - 1, states - 2])
      if (next[j] > best) {
        best = next[j];
        bestFrame = t;
        bestState = j;
      }
  }
  if (!Number.isFinite(best) || bestFrame < 0)
    throw Error(
      'Speech and transcript could not be aligned. Existing captions were kept.'
    );
  const spans = target.map(() => ({ start: Infinity, end: -Infinity }));
  let j = bestState;
  for (let t = bestFrame; t >= 0; t--) {
    if (j % 2 === 1) {
      const span = spans[(j - 1) / 2];
      span.start = Math.min(span.start, t);
      span.end = Math.max(span.end, t + 1);
    }
    j = back[t * states + j];
    if (j === 0) break;
  }
  if (spans.some((s) => !Number.isFinite(s.start) || s.end <= s.start))
    throw Error('Incomplete speech alignment. Existing captions were kept.');
  return spans;
}

export async function alignTranscript(
  aligner,
  audio,
  words,
  sourceStart,
  duration,
  onProgress = () => {}
) {
  const windows = alignmentWindows(words, duration),
    aligned = [];
  for (let i = 0; i < windows.length; i++) {
    const window = windows[i],
      first = Math.floor(window.start * 16000),
      last = Math.min(audio.length, Math.ceil(window.end * 16000));
    if (last <= first || (last - first) / 16000 > 18)
      throw Error(
        'The alignment window is too large or invalid. Select a shorter range.'
      );
    onProgress(`Matching words to audio: ${i + 1}/${windows.length}…`);
    const normalized = window.words.map((w) => alignmentText(w.text));
    if (normalized.some((w) => !w))
      throw Error(
        'Some transcript words cannot be aligned as English text. Edit the wording or choose another range.'
      );
    const separator = Number(
        aligner.tokenizer.encode('A A', { add_special_tokens: false })[1]
      ),
      target = [],
      letters = [];
    if (!Number.isInteger(separator))
      throw Error('The alignment model has no word separator.');
    for (const word of normalized) {
      if (target.length) target.push(separator);
      const ids = aligner.tokenizer
          .encode(word, { add_special_tokens: false })
          .map(Number),
        first = target.length;
      target.push(...ids);
      letters.push([first, target.length - 1]);
    }
    if (target.includes(aligner.model.config.unk_token_id ?? 3))
      throw Error(
        'Some transcript characters cannot be aligned by the English model.'
      );
    const inputs = await aligner.processor(audio.subarray(first, last));
    const output = await aligner.model(inputs);
    try {
      const [, frames, classes] = output.logits.dims;
      const spans = ctcTokenFrames(
        output.logits.data,
        frames,
        classes,
        target,
        aligner.model.config.pad_token_id || 0
      );
      const step = (aligner.model.config.inputs_to_logits_ratio || 320) / 16000;
      letters.forEach((tokens, k) => {
        const start =
          sourceStart + first / 16000 + spans[tokens[0]].start * step;
        const end = Math.min(
          sourceStart + last / 16000,
          sourceStart + first / 16000 + spans[tokens[1]].end * step
        );
        aligned.push({ text: window.words[k].text, start, end });
      });
    } finally {
      output.logits.dispose?.();
      for (const value of Object.values(inputs)) value.dispose?.();
    }
  }
  const segments = [];
  for (let i = 0; i < aligned.length; i += 8) {
    const group = aligned.slice(i, i + 8);
    segments.push({
      start: group[0].start,
      end: group.at(-1).end,
      text: group.map((w) => w.text).join(' '),
      words: group,
      timing: 'word'
    });
  }
  return safeCaptions(
    { ...defaultCaptions(), segments },
    sourceStart + duration
  ).segments;
}
