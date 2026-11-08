import {autoMontage, montageSettings, montageClips, shuffleMontage, MIN_MONTAGE_SECONDS, MAX_MONTAGE_SECONDS} from './js/montage.js?v=0.6.4';
import {encodeMontage} from './js/montage-export.js?v=0.6.4';
import {MAX_CLIPS, MAX_PROJECT_BYTES, matchesProjectSource, safeProject, validateProjectSource, snapshotClips} from './js/project.js?v=0.6.4';
import {cropRect as calculateCrop, videoFilter} from './js/export-settings.js';
import {ZipWorker} from './js/zip-client.js';

'use strict';
const $ = id => document.getElementById(id);
const video = $('video');
const input = $('file');
const dropzone = $('dropzone');
const clips = [];
let sourceURL = null;
let sourceFile = null;
let busy = false;
let loading = false;
let projectDirty = false;
let editorDirty = false;
let activeEngine = null;
let activeZip = null;
let cancelRequested = false;
let exportProgress = null;
let exportAbort = null;
const lockedControls = new Map();

function lockWorkspace(locked) {
  if (locked) {
    for (const control of document.querySelectorAll('main button, main input, main select')) {
      if (control.id === 'cancelExport') continue;
      if (!lockedControls.has(control)) lockedControls.set(control, control.disabled);
      control.disabled = true;
    }
  } else {
    for (const [control, disabled] of lockedControls) control.disabled = disabled;
    lockedControls.clear();
  }
  dropzone.setAttribute('aria-disabled', String(locked));
  dropzone.tabIndex = locked ? -1 : 0;
  document.querySelector('main').setAttribute('aria-busy', String(locked));
  $('cancelExport').hidden = !busy;
}
function unsavedWork() { return projectDirty || editorDirty; }
function confirmReplacement() {
  return !unsavedWork() || confirm('Replace your current work? Save your project first if you want to keep unsaved changes.');
}
function confirmEditorChange() {
  return !editorDirty || confirm('Discard changes to the current range? Save the loaded clip or add a new clip to keep them.');
}
function updateEditNotice() {
  $('editStatus').textContent = editorDirty
    ? (editingId === null ? 'Unsaved new range. Add it as a new clip to keep it.' : 'Unsaved clip changes. Saving the project or exporting will include these changes.')
    : (projectDirty ? 'Project has unsaved changes. Download Save project to keep them.' : '');
}
function markEditorDirty() {
  if (busy || loading || !sourceFile || !Number.isFinite(video.duration)) return;
  editorDirty = true;
  updateEditNotice();
}
function editorSettings() {
  return {...selection(), crop: {...crop}, format: $('format').value, quality: $('quality').value, mute: $('mute').checked};
}
function savePendingEdits() {
  if (!editorDirty || editingId === null) return;
  const clip = clips.find(item => item.id === editingId);
  if (!clip) throw Error('Load a clip to edit first.');
  Object.assign(clip, editorSettings());
  editorDirty = false;
  projectDirty = true;
  render();
  updateEditNotice();
}

let ffmpegInstance = null;
let lastFFmpegLog = '';
const formats = {vertical: '9:16 Shorts', landscape: '16:9 Widescreen', original: 'Original'};
let previewEnd = null;
let montagePlayback = null;
let editingId = null;
let nextId = 1;
let dragDepth = 0;
const cropCanvas = $('cropCanvas');
const cropCtx = cropCanvas.getContext('2d');
const defaultCrop = () => ({x: 50, y: 50, zoom: 1});
let crop = defaultCrop();
let cropFrame = null;
let pendingProject = null;
function setPendingProject(project) {
  pendingProject = project;
  $('chooseProjectSource').hidden = $('cancelProject').hidden = !project;
}

let projectTitle = 'Pursuit Level Clips';
const projectFileInput = $('projectFile');
function readCrop() {
  return {x: Number($('cropX').value), y: Number($('cropY').value), zoom: Number($('cropZoom').value)};
}
function applyCrop(settings) {
  crop = {...defaultCrop(), ...settings};
  $('cropX').value = crop.x;
  $('cropY').value = crop.y;
  $('cropZoom').value = crop.zoom;
  $('cropXValue').textContent = `${crop.x}%`;
  $('cropYValue').textContent = `${crop.y}%`;
  $('cropZoomValue').textContent = `${crop.zoom.toFixed(2)}×`;
  drawCrop();
}
function cropRect(fmt = $('format').value, settings = crop) {
  return calculateCrop(video.videoWidth, video.videoHeight, fmt, settings);
}
function updateFormat() {
  const fmt = $('format').value;
  const size = fmt === 'vertical' ? [270, 480] : fmt === 'landscape' ? [480, 270] :
    (video.videoWidth ? (video.videoWidth >= video.videoHeight ? [480, Math.round(480 * video.videoHeight / video.videoWidth)] : [270, Math.round(270 * video.videoHeight / video.videoWidth)]) : [480, 270]);
  cropCanvas.width = size[0]; cropCanvas.height = size[1];
  $('formatPill').textContent = formats[fmt].toUpperCase();
  $('cropCaption').textContent = `${formats[fmt].toUpperCase()} · OUTPUT PREVIEW`;
  $('cropX').disabled = $('cropY').disabled = $('cropZoom').disabled = $('resetCrop').disabled = fmt === 'original';
  $('cropX').closest('.crop-controls').classList.toggle('crop-disabled', fmt === 'original');
  drawCrop();
}
function drawCrop() {
  const w = cropCanvas.width, h = cropCanvas.height;
  cropCtx.fillStyle = '#08070d'; cropCtx.fillRect(0, 0, w, h);
  if (!video.videoWidth || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    cropCtx.fillStyle = '#b0a7b6'; cropCtx.font = '15px system-ui'; cropCtx.textAlign = 'center';
    cropCtx.fillText('Load video to preview', w / 2, h / 2); return;
  }
  const rect = cropRect();
  try { cropCtx.drawImage(video, rect.left, rect.top, rect.width, rect.height, 0, 0, w, h); }
  catch { /* Draw again on the next available frame. */ }
}
function animateCrop() {
  drawCrop();
  if (!video.paused && !video.ended) cropFrame = video.requestVideoFrameCallback
    ? video.requestVideoFrameCallback(animateCrop) : requestAnimationFrame(animateCrop);
  else cropFrame = null;
}
function stopCropAnimation() {
  if (cropFrame !== null) {
    if (video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(cropFrame);
    else cancelAnimationFrame(cropFrame);
  }
  cropFrame = null;
  drawCrop();
}
['cropX', 'cropY', 'cropZoom'].forEach(id => $(id).addEventListener('input', () => applyCrop(readCrop())));
$('format').addEventListener('change', updateFormat);
$('resetCrop').addEventListener('click', () => { applyCrop(defaultCrop()); markEditorDirty(); status('Crop reset to center.'); });
video.addEventListener('play', () => { if (cropFrame === null) animateCrop(); });
video.addEventListener('pause', stopCropAnimation);
video.addEventListener('seeked', drawCrop);
video.addEventListener('loadeddata', drawCrop);

const status = message => { $('status').textContent = message; };

function stamp(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const hours = Math.floor(ms / 3600000);
  const mins = Math.floor(ms % 3600000 / 60000);
  const secs = Math.floor(ms % 60000 / 1000);
  return `${String(hours).padStart(2,'0')}:${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}.${String(ms % 1000).padStart(3,'0')}`;
}
function parseStamp(value) {
  const match = /^(\d+):([0-5]\d):([0-5]\d)(?:\.(\d{1,3}))?$/.exec(value.trim());
  if (!match) return NaN;
  return Number(match[1])*3600 + Number(match[2])*60 + Number(match[3]) + Number((match[4] || '0').padEnd(3,'0'))/1000;
}
function selection() {
  const start = parseStamp($('start').value);
  const end = parseStamp($('end').value);
  if (!Number.isFinite(video.duration)) throw Error('Load a playable video first.');
  if (!Number.isFinite(start) || !Number.isFinite(end)) throw Error('Use timestamps in HH:MM:SS.mmm format.');
  if (start < 0 || end > video.duration + 0.001 || start >= end) throw Error('Start must be before end, within the video duration.');
  return {start, end};
}
function setEdit(id = null) {
  editingId = id;
  editorDirty = false;
  updateEditNotice();
  $('update').disabled = id === null;
  $('cancelEdit').hidden = id === null;
  $('add').textContent = '+ Add new clip';
  render();
  exportButtons();
}
function loadSelection(clip) {
  if (busy || loading || !confirmEditorChange()) return;
  $('start').value = stamp(clip.start);
  $('end').value = stamp(clip.end);
  previewEnd = null;
  video.pause();
  video.currentTime = clip.start;
  updateTimelineHandles();
  $('format').value = clip.format || 'vertical';
  $('mute').checked = Boolean(clip.mute);
  $('quality').value = clip.quality || '720';
  applyCrop(clip.crop || defaultCrop());
  updateFormat();
  updateTimelineHandles();
  setEdit(clip.id);
  status(`Editing ${clip.name}. Adjust timestamps and select Save loaded clip.`);
  return true;
}
function actionButton(label, handler, className = '') {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  if (className) button.className = className;
  button.addEventListener('click', handler);
  return button;
}
function render() {
  updateMontageSummary();
  $('count').textContent = `${clips.length} clip${clips.length === 1 ? '' : 's'}`;
  const area = $('clips');
  area.replaceChildren();
  if (!clips.length) {
    const p = document.createElement('p'); p.className = 'empty';
    p.textContent = 'No clips yet. Select a range and add your first clip.';
    area.append(p); return;
  }
  clips.forEach((clip, index) => {
    const card = document.createElement('article');
    card.className = `clip${editingId === clip.id ? ' clip-active' : ''}`;
    const top = document.createElement('div'); top.className = 'clip-top';
    const title = document.createElement('span'); title.className = 'clip-index'; title.textContent = String(index + 1).padStart(2, '0');
    const name = document.createElement('input'); name.className = 'clip-name'; name.type = 'text'; name.value = clip.name;
    name.maxLength = 80; name.setAttribute('aria-label', `Rename clip ${index + 1}`);
    name.addEventListener('change', () => {
      projectDirty = true; updateEditNotice();
      clip.name = name.value.trim() || `Clip ${String(index + 1).padStart(2, '0')}`;
      name.value = clip.name; status(`Renamed clip to ${clip.name}.`);
    });
    const duration = document.createElement('span'); duration.className = 'clip-duration'; duration.textContent = stamp(clip.end - clip.start);
    top.append(title, name, duration);
    const detail = document.createElement('p'); detail.className = 'clip-times'; detail.textContent = `${stamp(clip.start)} → ${stamp(clip.end)} · ${formats[clip.format || 'vertical']} · ${clip.quality || '720'}${(clip.quality || '720') === 'source' ? '' : 'p'} · ${clip.mute ? 'Muted' : 'Audio on'}`;
    const actions = document.createElement('div'); actions.className = 'clip-actions';
    actions.append(
      actionButton('Edit range', () => {if (loadSelection(clip)) video.scrollIntoView({block: 'start'});}),
      actionButton('Export MP4', () => exportClips([clip])),
      actionButton('Jump to', () => { previewEnd = null; video.pause(); video.currentTime = clip.start; status(`Playhead moved to ${clip.name}.`); }),
      actionButton('Delete', () => {
        if (busy || loading || (editingId === clip.id && !confirmEditorChange())) return;
        projectDirty = true;
        if (editingId === clip.id) editorDirty = false;
        updateEditNotice();
        const at = clips.findIndex(item => item.id === clip.id);
        if (at !== -1) clips.splice(at, 1);
        if (editingId === clip.id) editingId = null;
        $('update').disabled = editingId === null;
        $('cancelEdit').hidden = editingId === null;
        render(); exportButtons(); status('Clip removed.');
      }, 'danger')
    );
    card.append(top, detail, actions); area.append(card);
  });
}
function supportedType(file) {
  return /\.(mp4|mov|webm)$/i.test(file.name) || ['video/mp4', 'video/quicktime', 'video/webm'].includes(file.type);
}
// Probe on a detached player: rejected or cancelled replacements leave current work intact.
function inspectVideo(file) {
  return new Promise((resolve, reject) => {
    const probe = document.createElement('video');
    const url = URL.createObjectURL(file);
    const timeout = setTimeout(() => finish(Error('Video loading timed out. Try an H.264 MP4.')), 20000);
    function finish(error) {
      clearTimeout(timeout);
      probe.onloadeddata = probe.onerror = null;
      const duration = probe.duration;
      probe.removeAttribute('src'); probe.load(); URL.revokeObjectURL(url);
      if (error) reject(error); else resolve(duration);
    }
    probe.preload = 'auto'; probe.muted = true;
    probe.onloadeddata = () => finish(Number.isFinite(probe.duration) && probe.duration > 0 && probe.videoWidth
      ? null : Error('This video does not report usable video dimensions and duration.'));
    probe.onerror = () => finish(Error('This video cannot be played. Try an H.264 MP4.'));
    probe.src = url;
  });
}
async function loadFile(file) {
  if (!file || busy || loading) return;
  const project = pendingProject;
  setPendingProject(null);
  if (!supportedType(file)) return status('Unsupported file type. Choose an MP4, MOV, or WebM video.');
  if (project && !matchesProjectSource(project.source, file)) return status('This video does not match the project. Current work was kept. Open the project again to retry.');
  loading = true; lockWorkspace(true);
  let restored = null;
  try {
    status('Checking video before replacing current work…');
    const duration = await inspectVideo(file);
    if (project) restored = validateProjectSource(project, file, duration);
    if (!confirmReplacement()) { status('Replacement cancelled. Current work was kept.'); return; }
    previewEnd = null; video.pause();
    if (sourceURL) URL.revokeObjectURL(sourceURL);
    sourceFile = file;
    sourceURL = URL.createObjectURL(file);
    clips.length = 0; nextId = 1; editingId = null;
    editorDirty = projectDirty = false;
    projectTitle = project?.title || 'Pursuit Level Clips';
    applyMontageSettings(project?.montage);
    if (restored) restored.forEach(clip => clips.push({...clip, id: nextId++}));
    $('filename').textContent = `${file.name} · ${(file.size / 1048576).toFixed(1)} MB`;
    $('format').value = 'vertical'; $('mute').checked = false; $('quality').value = '720';
    $('start').value = '00:00:00.000'; $('end').value = stamp(duration);
    applyCrop(defaultCrop());
    video.src = sourceURL; video.load();
    status(project ? `Restored ${clips.length} clips. Video stays on your device.` : 'Loading video preview…');
  } catch (error) {
    status(`${error.message} Current work was kept.`);
  } finally {
    loading = false; lockWorkspace(false);
    $('update').disabled = editingId === null;
    $('cancelEdit').hidden = editingId === null;
    updateEditNotice(); render(); exportButtons(); updateFormat();
  }
}
input.addEventListener('change', event => {
  loadFile(event.target.files?.[0]);
  input.value = '';
});
input.addEventListener('cancel', () => {
  if (pendingProject) {setPendingProject(null); status('Project opening cancelled. Current work was kept.');}
});
dropzone.addEventListener('click', event => { if (!busy && !loading && event.target !== input) input.click(); });
dropzone.addEventListener('keydown', event => {
  if (!busy && !loading && event.target === dropzone && (event.key === 'Enter' || event.key === ' ')) {
    event.preventDefault(); input.click();
  }
});
dropzone.addEventListener('dragenter', event => {
  event.preventDefault(); dragDepth++; dropzone.classList.add('drag-active');
});
dropzone.addEventListener('dragover', event => {
  event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; dropzone.classList.add('drag-active');
});
dropzone.addEventListener('dragleave', event => {
  event.preventDefault(); dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropzone.classList.remove('drag-active');
});
dropzone.addEventListener('drop', event => {
  event.preventDefault(); dragDepth = 0; dropzone.classList.remove('drag-active');
  if (event.dataTransfer.files.length !== 1) return status('Drop one video file at a time.');
  loadFile(event.dataTransfer.files[0]);
});
// Prevent the browser navigating away when a file misses the drop target.
window.addEventListener('dragover', event => event.preventDefault());
window.addEventListener('drop', event => { event.preventDefault(); dragDepth = 0; dropzone.classList.remove('drag-active'); });
video.addEventListener('loadedmetadata', () => {
  if (!Number.isFinite(video.duration)) return status('This file does not report a usable duration.');
  $('end').value = stamp(video.duration);
  updateFormat();
  setupTimeline(); exportButtons();
  if (clips.length) { loadSelection(clips[0]); return; }
  status(`Video ready · ${stamp(video.duration)}. Select your clip range.`);
});
video.addEventListener('error', () => status('This video cannot be played by your browser. MOV and some MP4 codecs may be unsupported; try an H.264 MP4.'));
video.addEventListener('timeupdate', () => {
  if (montagePlayback) {
    const current = montagePlayback;
    if (!current.advancing && video.currentTime >= current.clips[current.index].end) nextMontageSegment();
    return;
  }
  if (previewEnd !== null && video.currentTime >= previewEnd) {
    video.pause(); previewEnd = null; status('Selection preview finished.');
  }
});
$('setStart').addEventListener('click', () => {
  if (!Number.isFinite(video.duration)) return status('Load a video first.');
  $('start').value = stamp(video.currentTime); markEditorDirty(); updateTimelineHandles(); status('Start point set.');
});
$('setEnd').addEventListener('click', () => {
  if (!Number.isFinite(video.duration)) return status('Load a video first.');
  $('end').value = stamp(video.currentTime); markEditorDirty(); updateTimelineHandles(); status('End point set.');
});
$('preview').addEventListener('click', async () => {
  try {
    const {start, end} = selection();
    previewEnd = end;
    video.pause(); video.currentTime = start;
    await video.play();
    video.scrollIntoView({block: 'start'});
    status('Previewing selected range…');
  } catch(error) { previewEnd = null; status(error.message); }
});
$('add').addEventListener('click', () => {
  try {
    if (busy || loading) return;
    if (clips.length >= MAX_CLIPS) throw Error(`A project can contain at most ${MAX_CLIPS} clips.`);
    const {start, end} = selection();
    const clip = {id: nextId++, name: `Clip ${String(clips.length + 1).padStart(2, '0')}`, start, end, crop: {...crop}, format: $('format').value, quality: $('quality').value, mute: $('mute').checked};
    clips.push(clip); projectDirty = true; setEdit(null); status('New clip selection added.');
  } catch(error) { status(error.message); }
});
$('update').addEventListener('click', () => {
  try {
    const clip = clips.find(item => item.id === editingId);
    if (!clip) throw Error('Load a clip to edit first.');
    Object.assign(clip, editorSettings());
    projectDirty = true;
    setEdit(clip.id); status(`Saved changes to ${clip.name}.`);
  } catch(error) { status(error.message); }
});
$('cancelEdit').addEventListener('click', () => { if (!confirmEditorChange()) return; setEdit(null); status('Finished editing clip.'); });
window.addEventListener('beforeunload', event => {
  if (unsavedWork() || busy) { event.preventDefault(); event.returnValue = ''; }
});
window.addEventListener('pagehide', event => { if (!event.persisted && sourceURL) URL.revokeObjectURL(sourceURL); });


function readMontageSettings() {
  return montageSettings({duration: Number($('montageLength').value), count: Number($('montageCount').value),
    format: $('montageFormat').value, quality: $('montageQuality').value, mute: $('montageAudio').value === 'mute'});
}
function applyMontageSettings(raw) {
  const settings = montageSettings(raw || {});
  $('montageLength').value = settings.duration; $('montageCount').value = settings.count;
  $('montageFormat').value = settings.format; $('montageQuality').value = settings.quality;
  $('montageAudio').value = settings.mute ? 'mute' : 'keep';
}
function updateMontageSummary() {
  const total = clips.reduce((sum, clip) => sum + clip.end - clip.start, 0);
  $('montageSummary').textContent = clips.length
    ? `${clips.length} saved segments · ${total.toFixed(1)} seconds combined. Montage export requires a total of ${MIN_MONTAGE_SECONDS}–${MAX_MONTAGE_SECONDS} seconds.`
    : 'Load a video, then generate segments. A 2-minute source can become a 50-second montage.';
}
$('generateMontage').addEventListener('click', () => {
  if (busy || loading || !sourceFile) return;
  try {
    const planned = autoMontage(video.duration, readMontageSettings());
    if ((clips.length || editorDirty) && !confirm('Replace the current saved selections with new montage segments? Save your project first to keep them.')) return;
    stopMontagePreview(); previewEnd = null; video.pause();
    clips.length = 0;
    planned.forEach(clip => clips.push({...clip, id: nextId++}));
    editorDirty = false; projectDirty = true;
    loadSelection(clips[0]);
    updateMontageSummary();
    status(`Generated ${planned.length} clips from separate timestamps in shuffled playback order. Review the order below, then use Export montage MP4 to join all clips.`);
  } catch (error) {status(error.message);}
});
$('shuffleMontage').addEventListener('click', () => {
  if (busy || loading || clips.length < 2) return;
  try {
    stopMontagePreview();
    if (editorDirty && editingId === null) throw Error('Add your current range as a clip before shuffling.');
    savePendingEdits();
    const reordered = shuffleMontage(clips);
    clips.splice(0, clips.length, ...reordered);
    projectDirty = true;
    loadSelection(clips[0]);
    status('Shuffled playback order. Preview and export follow the list below.');
  } catch (error) {status(error.message);}
});
$('exportMontage').addEventListener('click', () => {
  try { exportClips([...clips], false, readMontageSettings()); }
  catch (error) {reportExport(error.message, 0);}
});
for (const id of ['montageLength', 'montageCount', 'montageFormat', 'montageAudio', 'montageQuality']) {
  $(id).addEventListener('change', () => {
    if (sourceFile) {projectDirty = true; updateEditNotice();}
  });
}
function stopMontagePreview() {
  const playback = montagePlayback;
  if (!playback) return;
  montagePlayback = null;
  video.pause(); video.muted = playback.originalMuted;
  $('format').value = playback.originalFormat;
  applyCrop(playback.originalCrop); updateFormat();
  $('previewMontage').textContent = 'Preview montage';
}
async function nextMontageSegment() {
  const playback = montagePlayback;
  if (!playback || playback.advancing) return;
  playback.advancing = true; playback.index++;
  if (playback.index >= playback.clips.length) {
    stopMontagePreview(); status('Montage preview finished. Export to create one MP4.'); return;
  }
  const clip = playback.clips[playback.index];
  $('format').value = clip.format; applyCrop(clip.crop); updateFormat();
  video.currentTime = clip.start; video.muted = clip.mute;
  try {
    await video.play();
    if (montagePlayback === playback) {
      playback.advancing = false;
      status(`Previewing montage segment ${playback.index + 1}/${playback.clips.length}. Playback cuts are approximate; export creates the joined video.`);
    }
  } catch (error) {
    if (montagePlayback === playback) {stopMontagePreview(); status(error.message);}
  }
}
$('previewMontage').addEventListener('click', () => {
  if (montagePlayback) {stopMontagePreview(); status('Montage preview stopped.'); return;}
  if (busy || loading) return;
  try {
    if (editorDirty && editingId === null) throw Error('Add your current range as a clip before previewing the montage.');
    savePendingEdits();
    const planned = montageClips(clips, readMontageSettings(), video.duration);
    previewEnd = null; video.pause();
    montagePlayback = {clips: planned, index: -1, advancing: false, originalMuted: video.muted,
      originalFormat: $('format').value, originalCrop: {...crop}};
    $('previewMontage').textContent = 'Stop montage preview';
    nextMontageSegment();
  } catch (error) {status(error.message);}
});
video.addEventListener('ended', () => {if (montagePlayback) nextMontageSegment();});
video.addEventListener('pause', () => {
  if (montagePlayback && !montagePlayback.advancing && !video.ended) stopMontagePreview();
});
// Any editing or source interaction stops the temporary playback preview first.
for (const event of ['pointerdown', 'focusin', 'input', 'change', 'click']) {
  document.querySelector('main').addEventListener(event, e => {
    if (montagePlayback && e.target.id !== 'previewMontage' && e.target.matches('button,input,select,video')) stopMontagePreview();
  }, true);
}

render();

applyCrop(defaultCrop());
updateFormat();



// Project files contain only metadata and clip edits, never source video bytes.
function currentProject() {
  if (!sourceFile || !Number.isFinite(video.duration)) throw Error('Load a video before saving a project.');
  return {
    type: 'pursuit-level-clip-studio', schemaVersion: 1, title: projectTitle, montage: readMontageSettings(),
    source: {name: sourceFile.name, size: sourceFile.size, lastModified: sourceFile.lastModified, duration: video.duration},
    clips: clips.map(c => ({name:c.name, start:c.start, end:c.end, format:c.format, crop:{...c.crop}, mute:Boolean(c.mute), quality:c.quality || '720'}))
  };
}
function restoreProject(project) {
  const restored = validateProjectSource(project, sourceFile, video.duration);
  if (!confirmReplacement()) return false;
  clips.length = 0;
  restored.forEach(clip => clips.push({...clip, id: nextId++}));
  projectTitle = project.title;
  applyMontageSettings(project.montage);
  editorDirty = projectDirty = false;
  setEdit(null);
  if (clips.length) loadSelection(clips[0]);
  updateEditNotice();
  status(`Restored ${clips.length} clips from project. Video stays on your device.`);
  return true;
}
$('saveProject').addEventListener('click', () => {
  try {
    if (busy || loading) return;
    if (editingId === null && editorDirty) throw Error('Add your current range as a new clip before saving the project.');
    savePendingEdits();
    const project = currentProject();
    safeProject(project);
    const blob = new Blob([JSON.stringify(project, null, 2)], {type:'application/json'});
    downloadBlob(blob, `${safeFilename(sourceFile.name.replace(/\.[^.]+$/, ''))}-clips.json`);
    projectDirty = false; updateEditNotice();
    status(`Saved project metadata for ${clips.length} clips as JSON.`);
  } catch(e) {status(e.message);}
});
$('openProject').addEventListener('click', () => { if (!busy && !loading) projectFileInput.click(); });
$('chooseProjectSource').addEventListener('click', () => {if (!busy && !loading && pendingProject) input.click();});
$('cancelProject').addEventListener('click', () => {setPendingProject(null); status('Project opening cancelled. Current work was kept.');});
projectFileInput.addEventListener('change', async () => {
  const file = projectFileInput.files?.[0]; projectFileInput.value = '';
  if (!file || busy || loading) return;
  setPendingProject(null);
  loading = true; lockWorkspace(true);
  try {
    if (file.size > MAX_PROJECT_BYTES) throw Error('Project JSON is too large.');
    const project = safeProject(JSON.parse(await file.text()));
    loading = false; lockWorkspace(false);
    if (matchesProjectSource(project.source, sourceFile) && Number.isFinite(video.duration)) {restoreProject(project); return;}
    setPendingProject(project);
    status(`Project loaded. Select the original source video: ${project.source.name} (${(project.source.size/1048576).toFixed(1)} MB).`);
  } catch(e) {setPendingProject(null); status(`Could not open project: ${e.message}`);}
  finally { loading = false; lockWorkspace(false); exportButtons(); }
});
// Simple, seekable timeline. FPS is user-selected; browser frame stepping is approximate.
function setupTimeline() {
  const duration = video.duration;
  for(const id of ['playhead','rangeStart','rangeEnd']) {
    $(id).disabled = false; $(id).max = String(duration);
  }
  $('playhead').value = '0'; $('rangeStart').value='0'; $('rangeEnd').value=String(duration);
  updateTimelineHandles();
}
function updateTimelineHandles() {
  if (!Number.isFinite(video.duration)) return;
  const s = parseStamp($('start').value), e = parseStamp($('end').value);
  if (Number.isFinite(s)) $('rangeStart').value = String(Math.min(video.duration, Math.max(0,s)));
  if (Number.isFinite(e)) $('rangeEnd').value = String(Math.min(video.duration, Math.max(0,e)));
  $('playhead').value = String(Math.min(video.duration,Math.max(0,video.currentTime||0)));
  $('playheadTime').textContent = stamp(video.currentTime || 0);
  const low = Math.min(100,Math.max(0,(Number.isFinite(s)?s:0)/video.duration*100));
  const high = Math.min(100,Math.max(low,(Number.isFinite(e)?e:0)/video.duration*100));
  $('playhead').style.background = `linear-gradient(90deg,#273347 ${low}%,#822b48 ${low}%,#822b48 ${high}%,#273347 ${high}%)`;
}
$('playhead').addEventListener('input', () => {if(Number.isFinite(video.duration)) video.currentTime=Number($('playhead').value);updateTimelineHandles();});
for(const [range,field] of [['rangeStart','start'],['rangeEnd','end']]) {
  $(range).addEventListener('input', () => {
    const other = Number($(range==='rangeStart'?'rangeEnd':'rangeStart').value);
    const selected = Number($(range).value);
    if (range==='rangeStart' && selected >= other) $(range).value = Math.max(0,other-.001);
    if (range==='rangeEnd' && selected <= other) $(range).value = Math.min(video.duration,other+.001);
    $(field).value = stamp(Number($(range).value)); markEditorDirty(); updateTimelineHandles();
  });
}
for(const id of ['start','end']) $(id).addEventListener('input',updateTimelineHandles);
video.addEventListener('timeupdate',updateTimelineHandles);
for (const [id,dir] of [['frameBack',-1],['frameForward',1]]) $(id).addEventListener('click', () => {
  if (!Number.isFinite(video.duration)) return;
  video.pause(); video.currentTime = Math.max(0,Math.min(video.duration,video.currentTime + dir/Number($('fps').value)));
  updateTimelineHandles();
});
for(const [id,field,dir] of [['startBack','start',-1],['startForward','start',1],['endBack','end',-1],['endForward','end',1]]) $(id).addEventListener('click', () => {
  if (!Number.isFinite(video.duration)) return;
  const current = parseStamp($(field).value), opposite = parseStamp($(field === 'start' ? 'end' : 'start').value);
  if(!Number.isFinite(current)||!Number.isFinite(opposite)) return;
  const next = Math.round((current+dir*.1)*1000)/1000;
  if (next < 0 || next > video.duration || (field==='start' && next >= opposite) || (field==='end' && next <= opposite)) return;
  $(field).value = stamp(next); markEditorDirty(); updateTimelineHandles();
});

for (const id of ['start', 'end', 'cropX', 'cropY', 'cropZoom']) $(id).addEventListener('input', markEditorDirty);
for (const id of ['format', 'quality', 'mute']) $(id).addEventListener('change', markEditorDirty);

// FFmpeg.wasm v0.12 single-threaded build. Dependencies load on first export only.
// Engine files are provided by the validated self-hosted GitHub Pages workflow.
function exportButtons() {
  $('exportLoaded').disabled = busy || loading || editingId === null || !sourceFile;
  $('exportAll').disabled = busy || loading || !clips.length || !sourceFile;
  $('generateMontage').disabled = busy || loading || !sourceFile || !Number.isFinite(video.duration);
  $('shuffleMontage').disabled = $('previewMontage').disabled = $('exportMontage').disabled = busy || loading || !sourceFile || clips.length < 2;
}
function reportExport(message, percent = null) {
  $('exportStatus').textContent = message;
  if (percent !== null) {
    if (exportProgress) { percent = Math.max(exportProgress.percent, percent); exportProgress.percent = percent; }
    $('progress').value = Math.max(0, Math.min(100, percent));
    $('progressText').textContent = `${Math.round($('progress').value)}%`;
  } else $('progressText').textContent = 'Working…';
}
// Self-hosted FFmpeg files, included in the GitHub Actions published artifact.
// All paths are relative to the published GitHub Pages application.
async function verifyEngineFile(path) {
  const response = await fetch(path, { method: 'HEAD', cache: 'no-store', signal: exportAbort?.signal });
  if (!response.ok) throw Error(`Required engine file missing: ${path} (HTTP ${response.status}). Verify that the custom Deploy Clip Studio workflow ran successfully.`);
}
async function getFFmpeg() {
  if (ffmpegInstance) return ffmpegInstance;
  reportExport('Checking local FFmpeg files…', 0);
  const root = new URL('./vendor/ffmpeg/', document.baseURI);
  const url = filename => new URL(filename, root).href;
  const paths = ['ffmpeg.js', '814.ffmpeg.js', 'ffmpeg-core.js', 'ffmpeg-core.wasm'];
  try {
    await Promise.all(paths.map(filename => verifyEngineFile(url(filename))));
    if (cancelRequested) throw Error('Export cancelled.');
    if (!window.FFmpegWASM) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = url('ffmpeg.js');
        const signal = exportAbort.signal;
        const abort = () => { script.remove(); reject(Error('Export cancelled.')); };
        const finish = callback => { signal.removeEventListener('abort', abort); callback(); };
        script.onload = () => finish(resolve);
        script.onerror = () => finish(() => reject(Error('Failed to load local ffmpeg.js')));
        signal.addEventListener('abort', abort, {once: true});
        document.head.append(script);
      });
    }
    reportExport('Initializing ESM FFmpeg core…', 3);
    if (cancelRequested) throw Error('Export cancelled.');
    const engine = new window.FFmpegWASM.FFmpeg();
    activeEngine = engine;
    engine.on('log', ({message}) => { lastFFmpegLog = message; });
    engine.on('progress', ({progress}) => {
      if (busy && exportProgress && Number.isFinite(progress) && progress >= 0 && progress <= 1) {
        reportExport(exportProgress.label || `Encoding ${exportProgress.index + 1}/${exportProgress.total} locally…`, 10 + 85 * (exportProgress.index + progress) / exportProgress.total);
      }
    });
    // The module worker requires the ESM core build. The GitHub workflow publishes it locally.
    await engine.load({
      classWorkerURL: url('814.ffmpeg.js'),
      coreURL: url('ffmpeg-core.js'),
      wasmURL: url('ffmpeg-core.wasm')
    }, {signal: exportAbort.signal});
    if (cancelRequested) throw Error('Export cancelled.');
    ffmpegInstance = engine;
    return engine;
  } catch (error) {
    activeEngine?.terminate(); activeEngine = null; ffmpegInstance = null;
    throw Error(`FFmpeg engine initialization failed: ${error.message || String(error)}`);
  }
}
function safeFilename(name) {
  return (name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '-').trim().replace(/[. ]+$/, '').slice(0, 65) || 'clip');
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
// WORKERFS lets supported cores read a local File without copying it in full.
async function attachSource(engine, file) {
  const path = '/source';
  try {
    await engine.createDir(path);
    if (!await engine.mount('WORKERFS', {files: [file]}, path)) throw Error('WORKERFS unavailable');
    return {inputName: `${path}/${file.name}`, cleanup: async () => {
      await engine.unmount(path); await engine.deleteDir(path);
    }};
  } catch (error) {
    if (cancelRequested) throw error;
    try { await engine.deleteDir(path); } catch {}
    reportExport('Copying source into processing memory (file-backed input unavailable)…', 5);
    const inputName = `source.${(file.name.split('.').pop() || 'mp4').toLowerCase()}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (cancelRequested) throw Error('Export cancelled.');
    await engine.writeFile(inputName, bytes);
    return {inputName, cleanup: () => engine.deleteFile(inputName)};
  }
}
async function exportClips(selected, forceZip = false, montage = null) {
  if (busy || loading) return;
  if (!sourceFile || !video.videoWidth) return reportExport('Load a playable video first.', 0);
  if (!selected.length) return reportExport('Save at least one clip first.', 0);
  stopMontagePreview();
  try {
    if (montage && editorDirty && editingId === null) throw Error('Add your current range as a clip before exporting the montage.');
    savePendingEdits();
    if (montage) selected = montageClips(selected, montage, video.duration);
  }
  catch (error) { return reportExport(error.message, 0); }
  if (sourceFile.size > 450 * 1048576 && !confirm('This source file is over 450 MB. Browser-based encoding may run out of memory or crash. Continue?')) return;
  // Capture everything before the first await; exports never observe later edits.
  const job = {clips: snapshotClips(selected), file: sourceFile, width: video.videoWidth, height: video.videoHeight};
  busy = true; cancelRequested = false; exportAbort = new AbortController();
  exportProgress = {index: 0, total: job.clips.length + (montage ? 1 : 0), percent: 0};
  lockWorkspace(true); exportButtons();
  const isBatch = !montage && (forceZip || job.clips.length > 1);
  let source = null;
  let engine = null;
  try {
    engine = await getFFmpeg(); activeEngine = engine;
    if (cancelRequested) throw Error('Export cancelled.');
    source = await attachSource(engine, job.file);
    if (cancelRequested) throw Error('Export cancelled.');
    if (montage) {
      const result = await encodeMontage(engine, source.inputName, job.clips, {
        width: job.width, height: job.height, signal: exportAbort.signal,
        onStep: (index, label) => {
          exportProgress.index = index; exportProgress.label = label;
          reportExport(label, 10 + 85 * index / exportProgress.total);
        }
      });
      if (cancelRequested) throw Error('Export cancelled.');
      downloadBlob(new Blob([result], {type:'video/mp4'}), `${safeFilename(job.file.name.replace(/\.[^.]+$/, ''))}-montage.mp4`);
      reportExport('Montage MP4 downloaded. Ready for your voiceover.', 100);
      return;
    }
    if (isBatch) activeZip = new ZipWorker();
    for (let i = 0; i < job.clips.length; i++) {
      if (cancelRequested) throw Error('Export cancelled.');
      exportProgress.index = i;
      const clip = job.clips[i];
      const outputName = `output_${clip.id}.mp4`;
      reportExport(`Encoding ${i + 1}/${job.clips.length}: ${clip.name}`, 10 + 85 * i / job.clips.length);
      lastFFmpegLog = '';
      const args = ['-ss', clip.start.toFixed(3), '-i', source.inputName, '-t', (clip.end - clip.start).toFixed(3),
        '-vf', videoFilter(clip, job.width, job.height), '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p'];
      if (clip.mute) args.push('-an');
      else args.push('-c:a', 'aac', '-b:a', '128k');
      args.push('-movflags', '+faststart', '-y', outputName);
      try {
        const exitCode = await engine.exec(args);
        if (exitCode !== 0) throw Error(`FFmpeg exited with code ${exitCode}. ${lastFFmpegLog}`);
        const result = await engine.readFile(outputName);
        if (!result.length) throw Error('FFmpeg returned an empty file.');
        if (isBatch) {
          await activeZip.add(`${String(i+1).padStart(2,'0')}-${safeFilename(clip.name)}.mp4`, result);
          reportExport(`Prepared ${i + 1}/${job.clips.length}: ${clip.name}`, 10 + 85 * (i + 1) / job.clips.length);
        } else downloadBlob(new Blob([result], {type:'video/mp4'}), `${safeFilename(clip.name)}.mp4`);
      } finally { if (!cancelRequested) try {await engine.deleteFile(outputName);} catch {} }
    }
    if (isBatch) {
      reportExport('Finishing ZIP download…', 98);
      const archive = await activeZip.finish();
      if (cancelRequested) throw Error('Export cancelled.');
      downloadBlob(archive, `${safeFilename(job.file.name.replace(/\.[^.]+$/, ''))}-clips.zip`);
      reportExport(`Downloaded ZIP with ${job.clips.length} MP4 clips.`, 100);
    } else reportExport('MP4 downloaded to your device.', 100);
  } catch (error) {
    exportProgress = null;
    reportExport(cancelRequested ? 'Export cancelled. Your selections were kept.' : `Export failed: ${error.message || String(error)}. Try a shorter video or lower resolution.`, 0);
    // A failed worker may be unusable. Retry with a fresh engine instead of a stale instance.
    activeEngine?.terminate(); ffmpegInstance = null;
    if (!cancelRequested) console.error('Clip Studio export error', error);
  } finally {
    activeZip?.close(); activeZip = null;
    if (source && !cancelRequested && ffmpegInstance) try {await source.cleanup();} catch {ffmpegInstance?.terminate(); ffmpegInstance = null;}
    activeEngine = null; exportProgress = null; exportAbort = null;
    busy = false; lockWorkspace(false); exportButtons(); updateFormat();
  }
}
$('cancelExport').addEventListener('click', () => {
  cancelRequested = true;
  exportAbort?.abort();
  activeEngine?.terminate(); ffmpegInstance = null;
  activeZip?.close();
  reportExport('Cancelling export…');
});
$('exportLoaded').addEventListener('click', () => {
  const clip = clips.find(item => item.id === editingId);
  if (clip) exportClips([clip]);
});
$('exportAll').addEventListener('click', () => exportClips([...clips], true));
exportButtons();
