'use strict';
const $ = id => document.getElementById(id);
const video = $('video');
const input = $('file');
const dropzone = $('dropzone');
const clips = [];
let sourceURL = null;
let previewEnd = null;
let editingId = null;
let nextId = 1;
let dragDepth = 0;
const cropCanvas = $('cropCanvas');
const cropCtx = cropCanvas.getContext('2d');
const defaultCrop = () => ({x: 50, y: 50, zoom: 1});
let crop = defaultCrop();
let cropFrame = null;
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
function drawCrop() {
  const w = cropCanvas.width, h = cropCanvas.height;
  cropCtx.fillStyle = '#08070d';
  cropCtx.fillRect(0, 0, w, h);
  if (!video.videoWidth || !video.videoHeight || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    cropCtx.fillStyle = '#b0a7b6';
    cropCtx.font = '15px system-ui';
    cropCtx.textAlign = 'center';
    cropCtx.fillText('Load video to preview', w / 2, h / 2);
    return;
  }
  // Largest source rectangle with 9:16 aspect ratio, then zoom into it.
  const vw = video.videoWidth, vh = video.videoHeight;
  const baseW = Math.min(vw, vh * 9 / 16);
  const baseH = baseW * 16 / 9;
  const sourceW = baseW / crop.zoom;
  const sourceH = baseH / crop.zoom;
  const left = (vw - sourceW) * crop.x / 100;
  const top = (vh - sourceH) * crop.y / 100;
  try { cropCtx.drawImage(video, left, top, sourceW, sourceH, 0, 0, w, h); }
  catch { /* Frame not decoded yet; next seek/frame will update. */ }
}
function animateCrop() {
  drawCrop();
  if (!video.paused && !video.ended) cropFrame = requestAnimationFrame(animateCrop);
  else cropFrame = null;
}
function stopCropAnimation() {
  if (cropFrame !== null) cancelAnimationFrame(cropFrame);
  cropFrame = null;
  drawCrop();
}
['cropX', 'cropY', 'cropZoom'].forEach(id => $(id).addEventListener('input', () => applyCrop(readCrop())));
$('resetCrop').addEventListener('click', () => { applyCrop(defaultCrop()); status('Vertical crop reset to center.'); });
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
  $('update').disabled = id === null;
  $('cancelEdit').hidden = id === null;
  $('add').textContent = '+ Add new clip';
  render();
}
function loadSelection(clip) {
  $('start').value = stamp(clip.start);
  $('end').value = stamp(clip.end);
  previewEnd = null;
  video.pause();
  video.currentTime = clip.start;
  applyCrop(clip.crop || defaultCrop());
  setEdit(clip.id);
  status(`Editing ${clip.name}. Adjust timestamps and select Save loaded clip.`);
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
      clip.name = name.value.trim() || `Clip ${String(index + 1).padStart(2, '0')}`;
      name.value = clip.name; status(`Renamed clip to ${clip.name}.`);
    });
    const duration = document.createElement('span'); duration.className = 'clip-duration'; duration.textContent = stamp(clip.end - clip.start);
    top.append(title, name, duration);
    const detail = document.createElement('p'); detail.className = 'clip-times'; detail.textContent = `${stamp(clip.start)} → ${stamp(clip.end)} · 9:16 / X ${clip.crop?.x ?? 50}% / Y ${clip.crop?.y ?? 50}% / ${Number(clip.crop?.zoom ?? 1).toFixed(2)}×`;
    const actions = document.createElement('div'); actions.className = 'clip-actions';
    actions.append(
      actionButton('Edit range', () => loadSelection(clip)),
      actionButton('Jump to', () => { previewEnd = null; video.pause(); video.currentTime = clip.start; status(`Playhead moved to ${clip.name}.`); }),
      actionButton('Delete', () => {
        const at = clips.findIndex(item => item.id === clip.id);
        if (at !== -1) clips.splice(at, 1);
        if (editingId === clip.id) editingId = null;
        $('update').disabled = editingId === null;
        $('cancelEdit').hidden = editingId === null;
        render(); status('Clip removed.');
      }, 'danger')
    );
    card.append(top, detail, actions); area.append(card);
  });
}
function supportedType(file) {
  return /\.(mp4|mov|webm)$/i.test(file.name) || ['video/mp4', 'video/quicktime', 'video/webm'].includes(file.type);
}
function loadFile(file) {
  if (!file) return;
  if (!supportedType(file)) { status('Unsupported file type. Choose an MP4, MOV, or WebM video.'); return; }
  previewEnd = null;
  video.pause();
  if (sourceURL) URL.revokeObjectURL(sourceURL);
  sourceURL = URL.createObjectURL(file);
  video.src = sourceURL;
  video.load();
  clips.length = 0;
  nextId = 1;
  editingId = null;
  $('update').disabled = true;
  $('cancelEdit').hidden = true;
  $('filename').textContent = `${file.name} · ${(file.size / 1048576).toFixed(1)} MB`;
  applyCrop(defaultCrop());
  $('start').value = '00:00:00.000';
  $('end').value = '00:00:00.000';
  status('Loading video metadata…');
  render();
}
input.addEventListener('change', event => {
  loadFile(event.target.files?.[0]);
  input.value = '';
});
dropzone.addEventListener('click', event => { if (event.target !== input) input.click(); });
dropzone.addEventListener('keydown', event => {
  if (event.target === dropzone && (event.key === 'Enter' || event.key === ' ')) {
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
  status(`Video ready · ${stamp(video.duration)}. Select your clip range.`);
});
video.addEventListener('error', () => status('This video cannot be played by your browser. MOV and some MP4 codecs may be unsupported; try an H.264 MP4.'));
video.addEventListener('timeupdate', () => {
  if (previewEnd !== null && video.currentTime >= previewEnd) {
    video.pause(); previewEnd = null; status('Selection preview finished.');
  }
});
$('setStart').addEventListener('click', () => {
  if (!Number.isFinite(video.duration)) return status('Load a video first.');
  $('start').value = stamp(video.currentTime); status('Start point set.');
});
$('setEnd').addEventListener('click', () => {
  if (!Number.isFinite(video.duration)) return status('Load a video first.');
  $('end').value = stamp(video.currentTime); status('End point set.');
});
$('preview').addEventListener('click', async () => {
  try {
    const {start, end} = selection();
    previewEnd = end;
    video.pause(); video.currentTime = start;
    await video.play();
    status('Previewing selected range…');
  } catch(error) { previewEnd = null; status(error.message); }
});
$('add').addEventListener('click', () => {
  try {
    const {start, end} = selection();
    const clip = {id: nextId++, name: `Clip ${String(clips.length + 1).padStart(2, '0')}`, start, end, crop: {...crop}};
    clips.push(clip); setEdit(null); status('New clip selection added.');
  } catch(error) { status(error.message); }
});
$('update').addEventListener('click', () => {
  try {
    const clip = clips.find(item => item.id === editingId);
    if (!clip) throw Error('Load a clip to edit first.');
    Object.assign(clip, selection(), {crop: {...crop}});
    setEdit(null); status(`Saved changes to ${clip.name}.`);
  } catch(error) { status(error.message); }
});
$('cancelEdit').addEventListener('click', () => { setEdit(null); status('Finished editing clip.'); });
window.addEventListener('beforeunload', () => { if (sourceURL) URL.revokeObjectURL(sourceURL); });
render();

applyCrop(defaultCrop());
