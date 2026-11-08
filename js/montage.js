export const MIN_MONTAGE_SECONDS = 45;
export const MAX_MONTAGE_SECONDS = 55;

export function montageSettings(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('Invalid montage settings.');
  if (raw.mute !== undefined && typeof raw.mute !== 'boolean') throw Error('Choose mute or keep audio.');
  const duration = Number(raw.duration ?? 50);
  const count = Number(raw.count ?? 6);
  const format = raw.format ?? 'vertical';
  const quality = raw.quality ?? '720';
  if (!Number.isFinite(duration) || duration < MIN_MONTAGE_SECONDS || duration > MAX_MONTAGE_SECONDS) throw Error('Choose a montage length from 45 to 55 seconds.');
  if (!Number.isInteger(count) || count < 2 || count > 12) throw Error('Choose between 2 and 12 segments.');
  if (!['vertical', 'landscape'].includes(format)) throw Error('Choose 9:16 or 16:9 framing.');
  if (!['720', '1080'].includes(quality)) throw Error('Choose 720p or 1080p montage resolution.');
  return {duration, count, format, quality, mute: raw.mute ?? true};
}

// Pick one random range within each distinct source-time window, with gaps on both sides.
export function autoMontage(sourceDuration, raw, random = Math.random) {
  const settings = montageSettings(raw);
  const sourceMs = Math.floor(sourceDuration * 1000);
  const totalMs = Math.round(settings.duration * 1000);
  if (!Number.isFinite(sourceMs) || sourceMs < totalMs) throw Error(`Load a playable video at least ${settings.duration} seconds long, or choose a shorter montage length.`);
  const base = Math.floor(totalMs / settings.count), remainder = totalMs % settings.count;
  const selected = Array.from({length: settings.count}, (_, i) => {
    const length = base + (i < remainder ? 1 : 0);
    const windowStart = Math.floor(i * sourceMs / settings.count);
    const windowEnd = Math.floor((i + 1) * sourceMs / settings.count);
    const spare = windowEnd - windowStart - length;
    const margin = Math.min(500, Math.floor(spare / 2));
    if (margin < 1) throw Error('The source needs extra footage between montage clips. Choose a shorter montage, fewer segments, or a longer source.');
    const start = windowStart + margin + Math.floor(random() * (spare - 2 * margin + 1));
    return {name: `Montage ${String(i + 1).padStart(2, '0')}`, start: start / 1000, end: (start + length) / 1000,
      format: settings.format, quality: settings.quality, mute: settings.mute, crop: {x: 50, y: 50, zoom: 1}};
  });
  return shuffleMontage(selected, random).map((clip, i) => ({...clip, name: `Montage ${String(i + 1).padStart(2, '0')}`}));
}

export function shuffleMontage(clips, random = Math.random) {
  const result = [...clips];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  // Avoid accidentally returning source-timeline order after a random shuffle.
  if (result.length > 1 && result.every((clip, i) => !i || clip.start >= result[i - 1].start)) {
    result.push(result.shift());
  }
  return result;
}

export function montageClips(clips, raw, sourceDuration) {
  const settings = montageSettings(raw);
  if (clips.length < 2) throw Error('Generate or save at least two segments for a montage.');
  const result = clips.map(clip => {
    if (!Number.isFinite(clip.start) || !Number.isFinite(clip.end) || clip.start < 0 || clip.end <= clip.start || clip.end > sourceDuration + .001) throw Error('A montage segment is outside the source video. Edit its range first.');
    return {...clip, crop: {...clip.crop}, end: Math.min(clip.end, sourceDuration), format: settings.format, quality: settings.quality, mute: settings.mute};
  });
  const total = result.reduce((sum, clip) => sum + clip.end - clip.start, 0);
  if (total < MIN_MONTAGE_SECONDS - .001 || total > MAX_MONTAGE_SECONDS + .001) throw Error(`Saved segments total ${total.toFixed(1)} seconds. Adjust them to total 45–55 seconds, or generate a new montage.`);
  return result;
}
