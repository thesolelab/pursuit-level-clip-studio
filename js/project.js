import {montageSettings} from './montage.js?v=0.6.4';

export const MAX_CLIPS = 500;
export const MAX_PROJECT_BYTES = 1024 * 1024;

export function matchesProjectSource(saved, file) {
  return Boolean(saved && file && saved.name === file.name && saved.size === file.size);
}
export function safeProject(raw) {
  if (!raw || raw.type !== 'pursuit-level-clip-studio' || raw.schemaVersion !== 1 || !raw.source || !Array.isArray(raw.clips) || raw.clips.length > MAX_CLIPS) throw Error('Invalid or unsupported Clip Studio project.');
  if (typeof raw.source.name !== 'string' || !Number.isFinite(raw.source.size) || raw.source.size < 0) throw Error('Invalid project source information.');
  const duration = Number(raw.source.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw Error('Invalid source duration in project.');
  const allowedFormat = new Set(['vertical','landscape','original']);
  const allowedQuality = new Set(['720','1080','source']);
  const cleaned = raw.clips.map((c, i) => {
    if (!c || !Number.isFinite(c.start) || !Number.isFinite(c.end) || c.start < 0 || c.end <= c.start || c.end > duration + .01 || !allowedFormat.has(c.format)) throw Error(`Invalid saved clip #${i+1}.`);
    const z = Number(c.crop?.zoom), x = Number(c.crop?.x), y = Number(c.crop?.y);
    if (![x,y,z].every(Number.isFinite) || x < 0 || x > 100 || y < 0 || y > 100 || z < 1 || z > 2) throw Error(`Invalid crop settings in clip #${i+1}.`);
    return {name:String(c.name || `Clip ${i+1}`).slice(0,80), start:c.start, end:c.end, format:c.format, crop:{x,y,zoom:z}, mute:Boolean(c.mute), quality:allowedQuality.has(c.quality) ? c.quality : '720'};
  });
  return {source:{...raw.source, duration}, clips:cleaned, montage:raw.montage ? montageSettings(raw.montage) : null, title:typeof raw.title==='string' ? raw.title.slice(0,100) : 'Pursuit Level Clips'};
}

// Validate against the actual media before replacing any existing selections.
export function validateProjectSource(project, file, duration) {
  if (!matchesProjectSource(project.source, file)) throw Error('Choose the original source video used by this project.');
  if (!Number.isFinite(duration) || duration <= 0 || Math.abs(project.source.duration - duration) > .25) {
    throw Error('Source duration differs from project; no clips were restored.');
  }
  return project.clips.map(clip => {
    if (clip.start >= duration || clip.end > duration + .001) throw Error('A saved clip extends beyond this video; no clips were restored.');
    return {...clip, end: Math.min(clip.end, duration), crop: {...clip.crop}};
  });
}

export function snapshotClips(clips) {
  return clips.map(clip => ({...clip, crop: {...clip.crop}}));
}
