import { CAPTION_FONTS } from './fonts.js';

export const PRESETS = {
  pop: {
    label: 'Pursuit Pop',
    font: 'anton',
    color: '#ffffff',
    highlight: '#ffff00',
    outline: '#000000',
    outlineWidth: 0.1,
    shadow: true,
    fontSize: 6,
    x: 50,
    y: 78,
    maxWords: 4,
    intensity: 1,
    speed: 1
  },
  neon: {
    label: 'Neon Highlight',
    font: 'montserrat',
    color: '#ffffff',
    highlight: '#64e8ce',
    outline: '#000000',
    outlineWidth: 0.08,
    shadow: true,
    fontSize: 6,
    x: 50,
    y: 78,
    maxWords: 5,
    intensity: 1,
    speed: 1
  },
  cinematic: {
    label: 'Cinematic',
    font: 'bebas',
    color: '#ffffff',
    highlight: '#ffa568',
    outline: '#241420',
    outlineWidth: 0.05,
    shadow: true,
    fontSize: 6,
    x: 50,
    y: 78,
    maxWords: 6,
    intensity: 1,
    speed: 1
  }
};
export const MAX_CAPTION_SEGMENTS = 5000;
export const wordsOf = (text) =>
  String(text ?? '')
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
export function defaultCaptions() {
  return {
    enabled: false,
    style: { preset: 'pop', ...PRESETS.pop },
    segments: []
  };
}
const bounded = (v, min, max, label) => {
  if (!Number.isFinite(v) || v < min || v > max)
    throw Error(`Invalid caption ${label}.`);
  return v;
};
export function safeCaptionStyle(raw = {}) {
  const preset = raw.preset || 'pop';
  if (!Object.hasOwn(PRESETS, preset)) throw Error('Unknown caption preset.');
  const style = { preset, ...PRESETS[preset] };
  for (const key of Object.keys(style))
    if (Object.hasOwn(raw, key)) style[key] = raw[key];
  delete style.label;
  if (!CAPTION_FONTS.some((f) => f.key === style.font))
    throw Error('Unknown caption font.');
  for (const key of ['color', 'highlight', 'outline'])
    if (!/^#[\da-f]{6}$/i.test(style[key]))
      throw Error('Use a six-digit caption color.');
  for (const [key, min, max] of [
    ['fontSize', 3, 12],
    ['x', 5, 95],
    ['y', 5, 95],
    ['outlineWidth', 0, 0.2],
    ['intensity', 0, 2],
    ['speed', 0.5, 2],
    ['maxWords', 1, 12]
  ])
    bounded(style[key], min, max, key);
  if (!Number.isInteger(style.maxWords) || typeof style.shadow !== 'boolean')
    throw Error('Invalid caption style.');
  return style;
}
export function estimatedWords(text, start, end) {
  const tokens = wordsOf(text);
  return tokens.map((text, i) => ({
    text,
    start: start + ((end - start) * i) / tokens.length,
    end: start + ((end - start) * (i + 1)) / tokens.length
  }));
}
export function safeCaptions(raw, duration = Infinity) {
  if (raw == null) return defaultCaptions();
  if (
    typeof raw !== 'object' ||
    typeof raw.enabled !== 'boolean' ||
    !Array.isArray(raw.segments) ||
    raw.segments.length > MAX_CAPTION_SEGMENTS
  )
    throw Error('Invalid caption data.');
  const segments = raw.segments
    .map((cue, i) => {
      const start = bounded(cue.start, 0, duration, 'start'),
        // Match the editor/clip validator's 1 ms rounding tolerance.
        end = Math.min(duration, bounded(cue.end, 0, duration + 0.001, 'end'));
      const text = String(cue.text || '').trim();
      if (end <= start || !text || text.length > 800)
        throw Error(`Invalid caption segment ${i + 1}.`);
      const timing = ['word', 'phrase'].includes(cue.timing)
        ? cue.timing
        : 'estimated';
      const tokens = wordsOf(text);
      let words = Array.isArray(cue.words)
        ? cue.words
        : estimatedWords(text, start, end);
      if (words.length !== tokens.length)
        throw Error('Caption words do not match the edited text.');
      words = words.map((word, j) => {
        if (
          typeof word.text !== 'string' ||
          word.text !== tokens[j] ||
          !Number.isFinite(word.start) ||
          !Number.isFinite(word.end) ||
          word.start < start - 0.001 ||
          word.end > end + 0.001 ||
          Math.min(end, word.end) <= Math.max(start, word.start) ||
          (j && word.start < words[j - 1].end - 0.001)
        )
          throw Error('Invalid caption word timing.');
        return {
          text: word.text,
          start: Math.max(start, word.start),
          end: Math.min(end, word.end)
        };
      });
      if (
        cue.needsAlignment !== undefined &&
        typeof cue.needsAlignment !== 'boolean'
      )
        throw Error('Invalid caption timing-update flag.');
      return {
        id: i + 1,
        start,
        end,
        text,
        timing,
        words,
        ...(cue.needsAlignment ? { needsAlignment: true } : {})
      };
    })
    .sort((a, b) => a.start - b.start);
  for (let i = 1; i < segments.length; i++)
    if (segments[i].start < segments[i - 1].end - 0.001)
      throw Error('Caption segments must not overlap.');
  return { enabled: raw.enabled, style: safeCaptionStyle(raw.style), segments };
}
export function correctCaption(cue, text, start = cue.start, end = cue.end) {
  const tokens = wordsOf(text);
  const preserve =
    start === cue.start &&
    end === cue.end &&
    tokens.length === cue.words.length;
  return {
    ...cue,
    text: tokens.join(' '),
    start,
    end,
    timing: preserve ? cue.timing : 'estimated',
    ...(cue.needsAlignment ||
    (cue.timing !== 'estimated' && (!preserve || tokens.join(' ') !== cue.text))
      ? { needsAlignment: true }
      : {}),
    words: preserve
      ? cue.words.map((w, i) => ({ ...w, text: tokens[i] }))
      : estimatedWords(text, start, end)
  };
}
function evenlyTimedSegments(text, start, end) {
  const words = estimatedWords(text, start, end),
    segments = [];
  for (let i = 0; i < words.length; i += 8) {
    const group = words.slice(i, i + 8);
    segments.push({
      start: group[0].start,
      end: group.at(-1).end,
      text: group.map((w) => w.text).join(' '),
      words: group,
      timing: 'estimated'
    });
  }
  return segments;
}
export function transcriptSegments(result, offset, duration, precise = true) {
  const chunks = result.chunks || [];
  const segments = [];
  if (precise) {
    const words = chunks
      .flatMap((c) => {
        const text = wordsOf(c.text);
        const a = c.timestamp?.[0],
          b = c.timestamp?.[1];
        if (
          !Number.isFinite(a) ||
          !Number.isFinite(b) ||
          b <= a ||
          text.length !== 1
        )
          throw Error('Reliable word timestamps were not returned.');
        return [
          {
            text: text[0],
            start: offset + Math.max(0, a),
            end: offset + Math.min(duration, b)
          }
        ];
      })
      .filter((w) => w.end > w.start);
    for (let i = 0; i < words.length; i += 8) {
      const group = words.slice(i, i + 8);
      segments.push({
        start: group[0].start,
        end: group.at(-1).end,
        text: group.map((w) => w.text).join(' '),
        words: group,
        timing: 'word'
      });
    }
  } else {
    const cues = chunks.length
      ? chunks
      : [{ text: result.text, timestamp: [0, duration] }];
    for (const c of cues) {
      const start = offset + Math.max(0, Number(c.timestamp?.[0]) || 0),
        end = offset + Math.min(duration, Number(c.timestamp?.[1]) || duration);
      if (end > start && wordsOf(c.text).length)
        segments.push(...evenlyTimedSegments(c.text, start, end));
    }
  }
  // Some Whisper outputs contain recognized text but no usable timestamp chunks.
  // Keep those words and label the timing honestly instead of calling this silence.
  if (!precise && !segments.length && wordsOf(result.text).length) {
    segments.push(
      ...evenlyTimedSegments(result.text, offset, offset + duration)
    );
  }
  if (!segments.length)
    throw Error(
      'No speech was detected. Check the source audio or add captions manually.'
    );
  return segments;
}
export function srt(segments, start = 0, end = Infinity) {
  const stamp = (t) => {
    const ms = Math.max(0, Math.round(t * 1000));
    return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
  };
  return segments
    .filter((c) => c.end > start && c.start < end)
    .map(
      (c, i) =>
        `${i + 1}\n${stamp(Math.max(c.start, start) - start)} --> ${stamp(Math.min(c.end, end) - start)}\n${c.text}\n`
    )
    .join('\n');
}
export function captionGroups(segments, maxWords) {
  return segments.flatMap((cue) => {
    if (cue.timing === 'phrase')
      return [
        {
          start: cue.start,
          end: cue.end,
          words: cue.words,
          phrase: true,
          maxWords
        }
      ];
    const groups = [];
    for (let i = 0; i < cue.words.length; i += maxWords) {
      const words = cue.words.slice(i, i + maxWords);
      groups.push({
        start: words[0].start,
        end:
          i + maxWords < cue.words.length
            ? cue.words[i + maxWords].start
            : cue.end,
        words
      });
    }
    return groups;
  });
}
