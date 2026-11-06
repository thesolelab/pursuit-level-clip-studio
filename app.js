'use strict';
const $ = id => document.getElementById(id);
const video = $('video');
const clips = [];
let sourceURL = null;
let previewEnd = null;
const status = message => { $('status').textContent = message; };
function stamp(seconds) {
  const ms = Math.round(seconds * 1000);
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
  return {start,end};
}
function render() {
  $('count').textContent = `${clips.length} clip${clips.length === 1 ? '' : 's'}`;
  const area = $('clips'); area.replaceChildren();
  if (!clips.length) { const p=document.createElement('p');p.className='empty';p.textContent='No clips yet. Set a start and end time, then select Add clip.';area.append(p);return; }
  clips.forEach((clip,index) => {
    const box=document.createElement('div');box.className='clip';
    const top=document.createElement('div');top.className='clip-top';
    const name=document.createElement('strong');name.textContent=clip.name;
    const duration=document.createElement('span');duration.className='muted';duration.textContent=stamp(clip.end-clip.start);
    top.append(name,duration);
    const detail=document.createElement('p');detail.textContent=`${stamp(clip.start)} → ${stamp(clip.end)}`;
    const actions=document.createElement('div');actions.className='clip-actions';
    const jump=document.createElement('button');jump.textContent='Load selection';jump.addEventListener('click',()=>{$('start').value=stamp(clip.start);$('end').value=stamp(clip.end);previewEnd=null;video.currentTime=clip.start;status(`Loaded ${clip.name}.`);});
    const remove=document.createElement('button');remove.textContent='Delete';remove.addEventListener('click',()=>{clips.splice(index,1);render();status('Clip removed.');});
    actions.append(jump,remove);box.append(top,detail,actions);area.append(box);
  });
}
$('file').addEventListener('change',event=>{
  const file=event.target.files?.[0];if(!file)return;
  previewEnd=null;video.pause();if(sourceURL)URL.revokeObjectURL(sourceURL);
  sourceURL=URL.createObjectURL(file);video.src=sourceURL;video.load();clips.length=0;render();
  $('filename').textContent=`${file.name} · ${(file.size/1048576).toFixed(1)} MB`;
  $('start').value='00:00:00.000';$('end').value='00:00:00.000';status('Loading video metadata…');
});
video.addEventListener('loadedmetadata',()=>{if(!Number.isFinite(video.duration)){status('This file does not report a usable duration.');return;}$('end').value=stamp(video.duration);status(`Video ready · ${stamp(video.duration)}. Select your clip range.`);});
video.addEventListener('error',()=>status('This video cannot be played by your browser. MOV and some MP4 codecs may be unsupported; try an H.264 MP4.'));
video.addEventListener('timeupdate',()=>{if(previewEnd!==null && video.currentTime>=previewEnd){video.pause();previewEnd=null;status('Selection preview finished.');}});
$('setStart').addEventListener('click',()=>{if(!Number.isFinite(video.duration))return status('Load a video first.');$('start').value=stamp(video.currentTime);status('Start point set.');});
$('setEnd').addEventListener('click',()=>{if(!Number.isFinite(video.duration))return status('Load a video first.');$('end').value=stamp(video.currentTime);status('End point set.');});
$('preview').addEventListener('click',async()=>{try{const {start,end}=selection();previewEnd=end;video.pause();video.currentTime=start;await video.play();status('Previewing selected range…');}catch(error){previewEnd=null;status(error.message);}});
$('add').addEventListener('click',()=>{try{const {start,end}=selection();clips.push({name:`Clip ${String(clips.length+1).padStart(2,'0')}`,start,end});render();status('Clip selection added.');}catch(error){status(error.message);}});
window.addEventListener('beforeunload',()=>{if(sourceURL)URL.revokeObjectURL(sourceURL);});
render();
