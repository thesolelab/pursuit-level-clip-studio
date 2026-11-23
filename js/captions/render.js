import { CAPTION_FONTS } from './fonts.js';
import { captionGroups } from './model.js';
import { cropRect, videoFilter } from '../export-settings.js';
const loaded = new Map(),
  ready = new Set(),
  groupCache = new WeakMap(),
  layoutCache = new WeakMap();
export function ensureCaptionFont(key) {
  if (!loaded.has(key))
    loaded.set(
      key,
      (async () => {
        const font = CAPTION_FONTS.find((f) => f.key === key);
        const face = await new FontFace(
          font.family,
          `url(${new URL('../../fonts/' + font.file, import.meta.url)})`
        ).load();
        document.fonts.add(face);
        ready.add(key);
        return font;
      })().catch((error) => {
        loaded.delete(key);
        throw error;
      })
    );
  return loaded.get(key);
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mix = (a, b, t) =>
  '#' +
  [1, 3, 5]
    .map((i) =>
      Math.round(
        parseInt(a.slice(i, i + 2), 16) * (1 - t) +
          parseInt(b.slice(i, i + 2), 16) * t
      )
        .toString(16)
        .padStart(2, '0')
    )
    .join('');
// Layout once per group and output size. Both Canvas and ASS use these measured coordinates.
export function layout(ctx, group, style, width, height) {
  const key = [
    style.font,
    style.fontSize,
    style.x,
    style.y,
    style.intensity,
    style.preset,
    width,
    height
  ].join(':');
  const cache = layoutCache.get(group) || new Map();
  layoutCache.set(group, cache);
  if (cache.has(key)) return cache.get(key);
  const font = CAPTION_FONTS.find((f) => f.key === style.font);
  let size = (Math.min(width, height) * style.fontSize) / 100;
  const measure = () => {
    ctx.font = `${size}px "${font.family}"`;
    return group.words.map((w) => ctx.measureText(w.text).width);
  };
  let widths = measure(),
    space = size * 0.25;
  const available = width * 0.88;
  // Wrap phrases into lines; shrink unusually long individual words to fit.
  const longest = Math.max(...widths);
  if (longest > available) {
    size *= available / longest;
    widths = measure();
    space = size * 0.25;
  }
  let lines = [[]],
    totals = [0];
  widths.forEach((w, i) => {
    let n = lines.length - 1;
    if (totals[n] + (lines[n].length ? space : 0) + w > available) {
      lines.push([]);
      totals.push(0);
      n++;
    }
    totals[n] += w + (lines[n].length ? space : 0);
    lines[n].push(i);
  });
  const lineHeight = size * font.assScale,
    blockHeight = lineHeight * lines.length;
  if (blockHeight > height * 0.8) {
    size *= (height * 0.8) / blockHeight;
    return layout(
      ctx,
      group,
      { ...style, fontSize: (size / Math.min(width, height)) * 100 },
      width,
      height
    );
  }
  const cy = clamp(
    (height * style.y) / 100,
    blockHeight / 2 + height * 0.03,
    height -
      blockHeight / 2 -
      height * 0.03 -
      (style.preset === 'cinematic' ? size * 0.25 * style.intensity : 0)
  );
  const items = [];
  lines.forEach((line, n) => {
    const center = clamp(
      (width * style.x) / 100,
      totals[n] / 2 + width * 0.04,
      width - totals[n] / 2 - width * 0.04
    );
    let x = center - totals[n] / 2;
    const y = cy + (n - (lines.length - 1) / 2) * lineHeight;
    line.forEach((i) => {
      items.push({ ...group.words[i], index: i, x: x + widths[i] / 2, y });
      x += widths[i] + space;
    });
  });
  const result = { items, size, font };
  cache.set(key, result);
  return result;
}
export function wordAppearance(word, group, style, t, size) {
  let scale = 1,
    alpha = 1,
    y = word.y,
    color = style.color;
  if (style.preset === 'pop') {
    if (t < word.start) return { alpha: 0, scale: 1, y, color };
    scale =
      1 -
      0.15 *
        style.intensity *
        (1 - clamp(((t - word.start) * style.speed) / 0.12, 0, 1));
    if (t < word.end) color = style.highlight;
  } else if (style.preset === 'neon') {
    if (t >= word.start && t < word.end)
      color = mix(
        style.color,
        style.highlight,
        clamp(((t - word.start) * style.speed) / 0.06, 0, 1)
      );
  } else {
    const phase = clamp(((t - group.start) * style.speed) / 0.15, 0, 1);
    alpha = phase;
    y += size * 0.25 * style.intensity * (1 - phase);
    if (word.index === 0) color = style.highlight;
  }
  return { alpha, scale, y, color };
}
export function drawCaptions(ctx, state, time, width, height) {
  if (!state.enabled || !ready.has(state.style.font)) return;
  let cache = groupCache.get(state.segments);
  if (!cache) {
    cache = new Map();
    groupCache.set(state.segments, cache);
  }
  if (!cache.has(state.style.maxWords))
    cache.set(
      state.style.maxWords,
      captionGroups(state.segments, state.style.maxWords)
    );
  const groups = cache.get(state.style.maxWords);
  let low = 0,
    high = groups.length - 1,
    group;
  while (low <= high) {
    const middle = (low + high) >> 1,
      candidate = groups[middle];
    if (time < candidate.start) high = middle - 1;
    else if (time >= candidate.end) low = middle + 1;
    else {
      group = candidate;
      break;
    }
  }
  if (!group) return;
  const { items, size, font } = layout(ctx, group, state.style, width, height),
    s = state.style;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  for (const word of items) {
    const a = wordAppearance(word, group, s, time, size);
    if (!a.alpha) continue;
    ctx.save();
    ctx.globalAlpha = a.alpha;
    ctx.translate(word.x, a.y);
    ctx.scale(a.scale, a.scale);
    ctx.font = `${size}px "${font.family}"`;
    ctx.shadowColor = s.shadow ? '#000000aa' : 'transparent';
    ctx.shadowBlur = s.shadow ? size * 0.08 : 0;
    ctx.shadowOffsetY = s.shadow ? size * 0.06 : 0;
    const baseline = ((font.ascent + font.descent) * size) / 2;
    ctx.strokeStyle = s.outline;
    ctx.lineWidth = size * s.outlineWidth * 2;
    if (s.outlineWidth) ctx.strokeText(word.text, 0, baseline);
    ctx.fillStyle = a.color;
    ctx.fillText(word.text, 0, baseline);
    ctx.restore();
  }
  ctx.restore();
}
const assColor = (c) =>
  '&H' + c.slice(5, 7) + c.slice(3, 5) + c.slice(1, 3) + '&';
const assTime = (t) => {
  const n = Math.max(0, Math.round(t * 100));
  return `${Math.floor(n / 360000)}:${String(Math.floor(n / 6000) % 60).padStart(2, '0')}:${String(Math.floor(n / 100) % 60).padStart(2, '0')}.${String(n % 100).padStart(2, '0')}`;
};
const escapeText = (t) =>
  t
    .replaceAll('\\', '＼')
    .replaceAll('{', '｛')
    .replaceAll('}', '｝')
    .replace(/[\r\n]/g, ' ');
export function animatedASS(ctx, state, clip, width, height) {
  const s = state.style,
    font = CAPTION_FONTS.find((f) => f.key === s.font);
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,${font.assFamily},40,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,1,5,0,0,0,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  const events = [];
  for (const group of captionGroups(state.segments, s.maxWords)) {
    if (group.end <= clip.start || group.start >= clip.end) continue;
    const { items, size } = layout(ctx, group, s, width, height);
    for (const word of items) {
      const start = Math.max(
          clip.start,
          s.preset === 'pop' ? word.start : group.start
        ),
        end = Math.min(clip.end, group.end);
      // Small linear intervals also reproduce clipped animation phases without restarting them.
      const cuts = [
        start,
        end,
        word.start,
        word.end,
        word.start + 0.12 / s.speed,
        word.start + 0.06 / s.speed,
        group.start + 0.15 / s.speed
      ]
        .filter((t) => t >= start && t <= end)
        .sort((a, b) => a - b);
      for (let i = 0; i < cuts.length - 1; i++) {
        const a = cuts[i],
          b = cuts[i + 1];
        if (b - a < 0.009) continue;
        const from = wordAppearance(word, group, s, a + 0.00001, size),
          to = wordAppearance(word, group, s, b - 0.00001, size);
        from.y += size * font.assOffset;
        to.y += size * font.assOffset;
        const alpha = (v) =>
          Math.round((1 - v) * 255)
            .toString(16)
            .padStart(2, '0');
        const anim = (v) =>
          `\\fscx${(v.scale * 100).toFixed(2)}\\fscy${(v.scale * 100).toFixed(2)}\\1c${assColor(v.color)}\\alpha&H${alpha(v.alpha)}&`;
        const pos =
          Math.abs(from.y - to.y) > 0.001
            ? `\\move(${word.x.toFixed(2)},${from.y.toFixed(2)},${word.x.toFixed(2)},${to.y.toFixed(2)},0,${Math.round((b - a) * 1000)})`
            : `\\pos(${word.x.toFixed(2)},${from.y.toFixed(2)})`;
        const tags = `\\an5\\fs${(size * font.assScale).toFixed(3)}\\bord${(size * s.outlineWidth).toFixed(2)}\\shad${s.shadow ? (size * 0.06).toFixed(2) : 0}\\3c${assColor(s.outline)}${pos}${anim(from)}\\t(0,${Math.round((b - a) * 1000)},${anim(to)})`;
        events.push(
          `Dialogue: 0,${assTime(a - clip.start)},${assTime(b - clip.start)},Default,,0,0,0,,{${tags}}${escapeText(word.text)}`
        );
      }
    }
  }
  return header + events.join('\n') + '\n';
}
export function outputDimensions(clip, width, height) {
  let w = width,
    h = height;
  if (clip.format !== 'original') {
    const r = cropRect(width, height, clip.format, clip.crop);
    w = Math.floor(r.width / 2) * 2;
    h = Math.floor(r.height / 2) * 2;
  }
  if (clip.quality !== 'source') {
    const tall =
        clip.format === 'vertical' ||
        (clip.format === 'original' && height > width),
      box = clip.quality === '1080' ? [1080, 1920] : [720, 1280];
    const [bw, bh] = tall ? box : [box[1], box[0]];
    if (clip.format !== 'original') return [bw, bh];
    const factor = Math.min(bw / w, bh / h);
    w *= factor;
    h *= factor;
  }
  return [
    Math.max(2, Math.floor(w / 2) * 2),
    Math.max(2, Math.floor(h / 2) * 2)
  ];
}
function abortable(promise, signal) {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const abort = () => reject(Error('Export cancelled.'));
    if (signal.aborted) {
      promise.catch(() => {});
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', abort));
  });
}
export async function prepareCaptionExport(
  engine,
  state,
  width,
  height,
  { signal } = {}
) {
  if (!state.enabled || !state.segments.length)
    return {
      filter: (clip) => videoFilter(clip, width, height),
      cleanup: async () => {}
    };
  const font = await abortable(ensureCaptionFont(state.style.font), signal);
  await engine.createDir('caption_fonts');
  const fontPath = `caption_fonts/${font.file}`,
    files = [];
  const response = await fetch(
    new URL('../../fonts/' + font.file, import.meta.url),
    { signal }
  );
  if (!response.ok)
    throw Error('Caption font download failed. Please retry the export.');
  await engine.writeFile(
    fontPath,
    new Uint8Array(await response.arrayBuffer())
  );
  const ctx = document.createElement('canvas').getContext('2d');
  return {
    filter: async (clip) => {
      const name = `caption_${files.length}.ass`;
      files.push(name);
      const [w, h] = outputDimensions(clip, width, height);
      await engine.writeFile(
        name,
        new TextEncoder().encode(animatedASS(ctx, state, clip, w, h))
      );
      return (
        videoFilter(clip, width, height) + `,ass=${name}:fontsdir=caption_fonts`
      );
    },
    cleanup: async () => {
      for (const name of [...files, fontPath])
        try {
          await engine.deleteFile(name);
        } catch {}
      try {
        await engine.deleteDir('caption_fonts');
      } catch {}
    }
  };
}
