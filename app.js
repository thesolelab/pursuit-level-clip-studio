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
let pendingProject = null;
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
  updateTimelineHandles();
  $('format').value = clip.format || 'vertical';
  $('mute').checked = Boolean(clip.mute);
  $('quality').value = clip.quality || '720';
  applyCrop(clip.crop || defaultCrop());
  updateFormat();
  updateTimelineHandles();
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
    const detail = document.createElement('p'); detail.className = 'clip-times'; detail.textContent = `${stamp(clip.start)} → ${stamp(clip.end)} · ${formats[clip.format || 'vertical']} · ${clip.quality || '720'}${(clip.quality || '720') === 'source' ? '' : 'p'} · ${clip.mute ? 'Muted' : 'Audio on'}`;
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
  $('quality').value = '720';
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
  setupTimeline();
  if (pendingProject) {
    const project = pendingProject; pendingProject = null;
    if (!matchesProjectSource(project.source, sourceFile)) {
      status('This video does not match the saved project. Open the project again and select the original video.');
      return;
    }
    restoreProject(project);
    return;
  }
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
  $('start').value = stamp(video.currentTime); updateTimelineHandles(); status('Start point set.');
});
$('setEnd').addEventListener('click', () => {
  if (!Number.isFinite(video.duration)) return status('Load a video first.');
  $('end').value = stamp(video.currentTime); updateTimelineHandles(); status('End point set.');
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
    const clip = {id: nextId++, name: `Clip ${String(clips.length + 1).padStart(2, '0')}`, start, end, crop: {...crop}, format: $('format').value, quality: $('quality').value, mute: $('mute').checked};
    clips.push(clip); setEdit(null); status('New clip selection added.');
  } catch(error) { status(error.message); }
});
$('update').addEventListener('click', () => {
  try {
    const clip = clips.find(item => item.id === editingId);
    if (!clip) throw Error('Load a clip to edit first.');
    Object.assign(clip, selection(), {crop: {...crop}, format: $('format').value, quality: $('quality').value, mute: $('mute').checked});
    setEdit(null); status(`Saved changes to ${clip.name}.`);
  } catch(error) { status(error.message); }
});
$('cancelEdit').addEventListener('click', () => { setEdit(null); status('Finished editing clip.'); });
window.addEventListener('beforeunload', () => { if (sourceURL) URL.revokeObjectURL(sourceURL); });
render();

applyCrop(defaultCrop());
updateFormat();



// Project files contain only metadata and clip edits, never source video bytes.
function matchesProjectSource(saved, file) {
  return Boolean(saved && file && saved.name === file.name && saved.size === file.size);
}
function currentProject() {
  if (!sourceFile || !Number.isFinite(video.duration)) throw Error('Load a video before saving a project.');
  return {
    type: 'pursuit-level-clip-studio', schemaVersion: 1, title: projectTitle,
    source: {name: sourceFile.name, size: sourceFile.size, lastModified: sourceFile.lastModified, duration: video.duration},
    clips: clips.map(c => ({name:c.name, start:c.start, end:c.end, format:c.format, crop:{...c.crop}, mute:Boolean(c.mute), quality:c.quality || '720'}))
  };
}
function safeProject(raw) {
  if (!raw || raw.type !== 'pursuit-level-clip-studio' || raw.schemaVersion !== 1 || !raw.source || !Array.isArray(raw.clips) || raw.clips.length > 500) throw Error('Invalid or unsupported Clip Studio project.');
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
  return {source:raw.source, clips:cleaned, title:typeof raw.title==='string' ? raw.title.slice(0,100) : 'Pursuit Level Clips'};
}
function restoreProject(project) {
  if (!matchesProjectSource(project.source, sourceFile)) throw Error('Choose the original source video used by this project.');
  if (Math.abs(project.source.duration - video.duration) > .25) throw Error('Source duration differs from project; no clips were restored.');
  clips.length = 0;
  project.clips.forEach(c => clips.push({...c, id:nextId++}));
  projectTitle = project.title;
  editingId = null; $('update').disabled = true; $('cancelEdit').hidden = true;
  if (clips.length) loadSelection(clips[0]); else {render(); exportButtons();}
  status(`Restored ${clips.length} clip${clips.length === 1 ? '' : 's'} from project. Video stays on your device.`);
}
$('saveProject').addEventListener('click', () => {
  try {
    const project = currentProject();
    const blob = new Blob([JSON.stringify(project, null, 2)], {type:'application/json'});
    downloadBlob(blob, `${safeFilename(sourceFile.name.replace(/\.[^.]+$/, ''))}-clips.json`);
    status(`Saved project metadata for ${clips.length} clips as JSON.`);
  } catch(e) {status(e.message);}
});
$('openProject').addEventListener('click', () => projectFileInput.click());
projectFileInput.addEventListener('change', async () => {
  const file = projectFileInput.files?.[0]; projectFileInput.value = '';
  if (!file) return;
  try {
    if (file.size > 1024*1024) throw Error('Project JSON is too large.');
    const project = safeProject(JSON.parse(await file.text()));
    if (matchesProjectSource(project.source, sourceFile) && Number.isFinite(video.duration)) {restoreProject(project); return;}
    pendingProject = project;
    status(`Project loaded. Select the original source video: ${project.source.name} (${(project.source.size/1048576).toFixed(1)} MB).`);
    input.click();
  } catch(e) {pendingProject = null; status(`Could not open project: ${e.message}`);}
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
    $(field).value = stamp(Number($(range).value)); updateTimelineHandles();
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
  $(field).value = stamp(next); updateTimelineHandles();
});

// FFmpeg.wasm v0.12 single-threaded build. Dependencies load on first export only.
// Engine files are provided by the validated self-hosted GitHub Pages workflow.
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
// Self-hosted FFmpeg files, included in the GitHub Actions published artifact.
// All paths are relative to the published GitHub Pages application.
async function verifyEngineFile(path) {
  const response = await fetch(path, { method: 'HEAD', cache: 'no-store' });
  if (!response.ok) throw Error(`Required engine file missing: ${path} (HTTP ${response.status}). Verify that the custom Deploy Clip Studio workflow ran successfully.`);
}
async function getFFmpeg() {
  if (ffmpegInstance) return ffmpegInstance;
  reportExport('Checking local FFmpeg files…', 0);
  const root = new URL('./vendor/ffmpeg/', document.baseURI);
  const url = filename => new URL(filename, root).href;
  const paths = ['ffmpeg.js', '814.ffmpeg.js', 'ffmpeg-core.js', 'ffmpeg-core.wasm'];
  try {
    for (const filename of paths) await verifyEngineFile(url(filename));
    if (!window.FFmpegWASM) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = url('ffmpeg.js');
        script.onload = resolve;
        script.onerror = () => reject(Error('Failed to load local ffmpeg.js'));
        document.head.append(script);
      });
    }
    reportExport('Initializing ESM FFmpeg core…', 3);
    const engine = new window.FFmpegWASM.FFmpeg();
    engine.on('log', ({message}) => { lastFFmpegLog = message; });
    engine.on('progress', ({progress}) => {
      if (busy && Number.isFinite(progress) && progress >= 0 && progress <= 1) {
        reportExport('Encoding MP4 locally…', 15 + 80 * progress);
      }
    });
    // The module worker requires the ESM core build. The GitHub workflow publishes it locally.
    await engine.load({
      classWorkerURL: url('814.ffmpeg.js'),
      coreURL: url('ffmpeg-core.js'),
      wasmURL: url('ffmpeg-core.wasm')
    });
    ffmpegInstance = engine;
    return engine;
  } catch (error) {
    throw Error(`FFmpeg engine initialization failed: ${error.message || String(error)}`);
  }
}
function even(number, max) {
  const v = Math.floor(number / 2) * 2;
  return Math.max(2, Math.min(v, Math.floor(max / 2) * 2));
}
function videoFilter(clip) {
  const preset = clip.quality || '720';
  const box = clip.format === 'vertical' ? {720:[720,1280],1080:[1080,1920]} : {720:[1280,720],1080:[1920,1080]};
  if (clip.format === 'original') {
    if (preset === 'source') return 'scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1';
    const verticalSource = video.videoHeight > video.videoWidth;
    const dim = verticalSource ? {720:[720,1280],1080:[1080,1920]}[preset] : {720:[1280,720],1080:[1920,1080]}[preset];
    // Preserve source aspect ratio, including vertical original footage.
    const w = dim[0], h=dim[1];
    return `scale=${w}:${h}:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1`;
  }
  const {left, top, width, height} = cropRect(clip.format, clip.crop);
  const w = even(width, video.videoWidth), h = even(height, video.videoHeight);
  const x = Math.max(0, Math.min(Math.floor(left/2)*2, Math.floor((video.videoWidth-w)/2)*2));
  const y = Math.max(0, Math.min(Math.floor(top/2)*2, Math.floor((video.videoHeight-h)/2)*2));
  const out = preset === 'source' ? '' : `,scale=${box[preset].join(':')}`;
  return `crop=${w}:${h}:${x}:${y}${out},setsar=1`;
}

function safeFilename(name) {
  return (name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '-').trim().replace(/[. ]+$/, '').slice(0, 65) || 'clip');
}

// ZIP STORE writer (no compression; MP4 is already compressed). No third-party dependency.
const crcTable = (() => {
  const t = new Uint32Array(256);
  for(let n=0;n<256;n++) {let c=n;for(let k=0;k<8;k++) c=c&1 ? (0xedb88320^(c>>>1)) : (c>>>1);t[n]=c>>>0;}
  return t;
})();
function crc32(bytes) {let c=0xffffffff;for(let i=0;i<bytes.length;i++) c=crcTable[(c^bytes[i])&255]^(c>>>8);return (c^0xffffffff)>>>0;}
function makeZip(entries) {
  const enc=new TextEncoder(), chunks=[], directory=[];
  let offset=0;
  for(const {filename,bytes} of entries) {
    const name=enc.encode(filename), crc=crc32(bytes);
    if (name.length>65535 || bytes.length>0xffffffff) throw Error('ZIP entry too large.');
    const header=new ArrayBuffer(30+name.length),v=new DataView(header);
    v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x0800,true);v.setUint16(8,0,true);
    v.setUint32(14,crc,true);v.setUint32(18,bytes.length,true);v.setUint32(22,bytes.length,true);v.setUint16(26,name.length,true);
    new Uint8Array(header,30).set(name);chunks.push(header,bytes);
    const cd=new ArrayBuffer(46+name.length),d=new DataView(cd);
    d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint16(8,0x0800,true);
    d.setUint32(16,crc,true);d.setUint32(20,bytes.length,true);d.setUint32(24,bytes.length,true);
    d.setUint16(28,name.length,true);d.setUint32(42,offset,true);
    new Uint8Array(cd,46).set(name);directory.push(cd);offset+=header.byteLength+bytes.length;
    if (offset>0xffffffff) throw Error('Batch ZIP exceeds 4 GB; export fewer clips.');
  }
  const size=directory.reduce((n,b)=>n+b.byteLength,0);
  const footer=new ArrayBuffer(22),f=new DataView(footer);
  f.setUint32(0,0x06054b50,true);f.setUint16(8,entries.length,true);f.setUint16(10,entries.length,true);
  f.setUint32(12,size,true);f.setUint32(16,offset,true);
  return new Blob([...chunks,...directory,footer], {type:'application/zip'});
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function exportClips(selected, forceZip = false) {
  if (busy) return;
  if (!sourceFile || !video.videoWidth) return reportExport('Load a playable video first.', 0);
  if (!selected.length) return reportExport('Save at least one clip first.', 0);
  // A practical warning rather than a promise of a universal browser file-size limit.
  if (sourceFile.size > 450 * 1048576 && !confirm('This source file is over 450 MB. Browser-based encoding may run out of memory or crash. Try a shorter source file if it fails. Continue?')) return;
  busy = true; exportButtons();
  const inputName = `source.${(sourceFile.name.split('.').pop() || 'mp4').toLowerCase()}`;
  const isBatch = forceZip || selected.length > 1;
  const packaged = [];
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
        const name = `${String(i+1).padStart(2,'0')}-${safeFilename(clip.name)}.mp4`;
        if (isBatch) {packaged.push({filename:name,bytes:result});reportExport(`Prepared ${i + 1}/${selected.length}: ${clip.name}`, Math.min(98, 15+80*(i+1)/selected.length));}
        else {downloadBlob(new Blob([result], {type:'video/mp4'}), `${safeFilename(clip.name)}.mp4`);reportExport(`Downloaded ${clip.name}`,100);}
      } finally { try {await engine.deleteFile(outputName);} catch {} }
    }
    if (isBatch) {
      reportExport('Packaging MP4 clips into a ZIP…',98);
      const archive=makeZip(packaged);
      downloadBlob(archive, `${safeFilename(sourceFile.name.replace(/\.[^.]+$/, ''))}-clips.zip`);
      reportExport(`Downloaded ZIP with ${selected.length} MP4 clips.`,100);
    } else reportExport('MP4 downloaded to your device.',100);
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
$('exportAll').addEventListener('click', () => exportClips([...clips], true));
exportButtons();
