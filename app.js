'use strict';
const $ = id => document.getElementById(id);
const video = $('video');
const input = $('file');
const dropzone = $('dropzone');
const clips = [];
let sourceURL = null;
let sourceFile = null;
let busy = false;
let ffmpegInstance = null;
let lastFFmpegLog = '';
const formats = {vertical: '9:16 Shorts', landscape: '16:9 Widescreen', original: 'Original'};
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
function cropRect(fmt = $('format').value, settings = crop) {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return null;
  if (fmt === 'original') return {left: 0, top: 0, width: vw, height: vh};
  const ratio = fmt === 'landscape' ? 16 / 9 : 9 / 16;
  const baseW = Math.min(vw, vh * ratio);
  const baseH = baseW / ratio;
  const width = baseW / settings.zoom, height = baseH / settings.zoom;
  return {left: (vw - width) * settings.x / 100, top: (vh - height) * settings.y / 100, width, height};
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
  if (!video.paused && !video.ended) cropFrame = requestAnimationFrame(animateCrop);
  else cropFrame = null;
}
function stopCropAnimation() {
  if (cropFrame !== null) cancelAnimationFrame(cropFrame);
  cropFrame = null;
  drawCrop();
}
['cropX', 'cropY', 'cropZoom'].forEach(id => $(id).addEventListener('input', () => applyCrop(readCrop())));
$('format').addEventListener('change', updateFormat);
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
  exportButtons();
}
function loadSelection(clip) {
  $('start').value = stamp(clip.start);
  $('end').value = stamp(clip.end);
  previewEnd = null;
  video.pause();
  video.currentTime = clip.start;
  $('format').value = clip.format || 'vertical';
  $('mute').checked = Boolean(clip.mute);
  applyCrop(clip.crop || defaultCrop());
  updateFormat();
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
    const detail = document.createElement('p'); detail.className = 'clip-times'; detail.textContent = `${stamp(clip.start)} → ${stamp(clip.end)} · ${formats[clip.format || 'vertical']} · ${clip.mute ? 'Muted' : 'Audio on'}`;
    const actions = document.createElement('div'); actions.className = 'clip-actions';
    actions.append(
      actionButton('Edit range', () => loadSelection(clip)),
      actionButton('Export MP4', () => exportClips([clip])),
      actionButton('Jump to', () => { previewEnd = null; video.pause(); video.currentTime = clip.start; status(`Playhead moved to ${clip.name}.`); }),
      actionButton('Delete', () => {
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
function loadFile(file) {
  if (!file) return;
  if (!supportedType(file)) { status('Unsupported file type. Choose an MP4, MOV, or WebM video.'); return; }
  if (busy) return status('Export in progress. Wait before switching source files.');
  previewEnd = null;
  video.pause();
  sourceFile = file;
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
  $('format').value = 'vertical';
  $('mute').checked = false;
  applyCrop(defaultCrop());
  updateFormat();
  exportButtons();
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
  updateFormat();
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
    const clip = {id: nextId++, name: `Clip ${String(clips.length + 1).padStart(2, '0')}`, start, end, crop: {...crop}, format: $('format').value, mute: $('mute').checked};
    clips.push(clip); setEdit(null); status('New clip selection added.');
  } catch(error) { status(error.message); }
});
$('update').addEventListener('click', () => {
  try {
    const clip = clips.find(item => item.id === editingId);
    if (!clip) throw Error('Load a clip to edit first.');
    Object.assign(clip, selection(), {crop: {...crop}, format: $('format').value, mute: $('mute').checked});
    setEdit(null); status(`Saved changes to ${clip.name}.`);
  } catch(error) { status(error.message); }
});
$('cancelEdit').addEventListener('click', () => { setEdit(null); status('Finished editing clip.'); });
window.addEventListener('beforeunload', () => { if (sourceURL) URL.revokeObjectURL(sourceURL); });
render();

applyCrop(defaultCrop());
updateFormat();


// FFmpeg.wasm v0.12 single-threaded build. Dependencies load on first export only.
// We use an object-URL worker to keep GitHub Pages' worker same-origin.
function exportButtons() {
  $('exportLoaded').disabled = busy || editingId === null || !sourceFile;
  $('exportAll').disabled = busy || !clips.length || !sourceFile;
}
function reportExport(message, percent = null) {
  $('exportStatus').textContent = message;
  if (percent !== null) {
    $('progress').value = Math.max(0, Math.min(100, percent));
    $('progressText').textContent = `${Math.round($('progress').value)}%`;
  } else $('progressText').textContent = 'Working…';
}
async function fileAsBlobURL(url, mime) {
  const response = await fetch(url);
  if (!response.ok) throw Error(`Couldn't load FFmpeg dependency (${response.status}).`);
  return URL.createObjectURL(new Blob([await response.arrayBuffer()], {type: mime}));
}
async function getFFmpeg() {
  if (ffmpegInstance) return ffmpegInstance;
  reportExport('Loading FFmpeg processing engine…', 0);
  const version = '0.12.10';
  const library = `https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@${version}/dist/umd`;
  const core = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd';
  if (!window.FFmpegWASM) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `${library}/ffmpeg.js`;
      script.onload = resolve;
      script.onerror = () => reject(Error('FFmpeg library could not load from the CDN. Check the network or browser extensions.'));
      document.head.append(script);
    });
  }
  // The FFmpeg class worker must run on an origin-compatible Blob URL.
  // Both core files must also use Blob URLs: importScripts() inside a worker
  // cannot reliably import a cross-origin CDN script directly.
  const temporaryURLs = [];
  try {
    reportExport('Downloading FFmpeg worker…', 1);
    const classWorkerURL = await fileAsBlobURL(`${library}/814.ffmpeg.js`, 'text/javascript');
    temporaryURLs.push(classWorkerURL);
    reportExport('Downloading FFmpeg core (~30 MB)…', 2);
    const coreURL = await fileAsBlobURL(`${core}/ffmpeg-core.js`, 'text/javascript');
    temporaryURLs.push(coreURL);
    const wasmURL = await fileAsBlobURL(`${core}/ffmpeg-core.wasm`, 'application/wasm');
    temporaryURLs.push(wasmURL);
    const engine = new window.FFmpegWASM.FFmpeg();
    engine.on('log', ({message}) => { lastFFmpegLog = message; });
    engine.on('progress', ({progress}) => {
      if (busy && Number.isFinite(progress) && progress >= 0 && progress <= 1) {
        reportExport('Encoding MP4 locally…', 15 + 80 * progress);
      }
    });
    reportExport('Initializing FFmpeg core…', 3);
    await engine.load({ classWorkerURL, coreURL, wasmURL });
    ffmpegInstance = engine;
    // The worker may reference these Blob URLs for its lifetime.
    window.__clipStudioEngineURLs = [...(window.__clipStudioEngineURLs || []), ...temporaryURLs];
    return engine;
  } catch (error) {
    for (const url of temporaryURLs) URL.revokeObjectURL(url);
    throw Error(`FFmpeg engine initialization failed: ${error.message || String(error)}`);
  }
}
function even(number, max) {
  const v = Math.floor(number / 2) * 2;
  return Math.max(2, Math.min(v, Math.floor(max / 2) * 2));
}
function videoFilter(clip) {
  if (clip.format === 'original') return 'scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1';
  const {left, top, width, height} = cropRect(clip.format, clip.crop);
  // Guarantee even crop sizes and in-bounds even offsets for 4:2:0 H.264.
  const w = even(width, video.videoWidth), h = even(height, video.videoHeight);
  const x = Math.max(0, Math.min(Math.floor(left / 2) * 2, Math.floor((video.videoWidth - w) / 2) * 2));
  const y = Math.max(0, Math.min(Math.floor(top / 2) * 2, Math.floor((video.videoHeight - h) / 2) * 2));
  const dimension = clip.format === 'landscape' ? '1280:720' : '720:1280';
  return `crop=${w}:${h}:${x}:${y},scale=${dimension},setsar=1`;
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
async function exportClips(selected) {
  if (busy) return;
  if (!sourceFile || !video.videoWidth) return reportExport('Load a playable video first.', 0);
  if (!selected.length) return reportExport('Save at least one clip first.', 0);
  // A practical warning rather than a promise of a universal browser file-size limit.
  if (sourceFile.size > 450 * 1048576 && !confirm('This source file is over 450 MB. Browser-based encoding may run out of memory or crash. Try a shorter source file if it fails. Continue?')) return;
  busy = true; exportButtons();
  const inputName = `source.${(sourceFile.name.split('.').pop() || 'mp4').toLowerCase()}`;
  let engine = null;
  try {
    engine = await getFFmpeg();
    reportExport('Copying source video into local processing memory…', 5);
    const bytes = new Uint8Array(await sourceFile.arrayBuffer());
    await engine.writeFile(inputName, bytes);
    // Source file is copied once and reused for batch exports.
    for (let i = 0; i < selected.length; i++) {
      const clip = selected[i];
      const outputName = `output_${clip.id}.mp4`;
      reportExport(`Encoding ${i + 1}/${selected.length}: ${clip.name}`, 15);
      const args = ['-ss', clip.start.toFixed(3), '-i', inputName, '-t', (clip.end - clip.start).toFixed(3),
        '-vf', videoFilter(clip), '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', 'yuv420p'];
      if (clip.mute) args.push('-an');
      else args.push('-c:a', 'aac', '-b:a', '128k');
      args.push('-movflags', '+faststart', '-y', outputName);
      try {
        const exitCode = await engine.exec(args);
        if (exitCode !== 0) throw Error(`FFmpeg exited with code ${exitCode}. ${lastFFmpegLog}`);
        const result = await engine.readFile(outputName);
        if (!result.length) throw Error('FFmpeg returned an empty file.');
        downloadBlob(new Blob([result], {type:'video/mp4'}), `${safeFilename(clip.name)}.mp4`);
        reportExport(`Downloaded ${i + 1}/${selected.length}: ${clip.name}`, 100);
      } finally { try {await engine.deleteFile(outputName);} catch {} }
    }
    reportExport(`Finished. Downloaded ${selected.length} MP4 clip${selected.length === 1 ? '' : 's'} to your device.`, 100);
  } catch (error) {
    reportExport(`Export failed: ${error.message || String(error)}. See browser console for technical details.`, 0);
    console.error('Clip Studio export error', error);
  } finally {
    if (engine) try {await engine.deleteFile(inputName);} catch {}
    busy = false; exportButtons();
  }
}
$('exportLoaded').addEventListener('click', () => {
  const clip = clips.find(item => item.id === editingId);
  if (clip) exportClips([clip]);
});
$('exportAll').addEventListener('click', () => exportClips([...clips]));
exportButtons();
