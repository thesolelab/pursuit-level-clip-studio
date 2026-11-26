export function cropRect(vw, vh, fmt, settings) {
  if (!vw || !vh) return null;
  if (fmt === 'original') return {left: 0, top: 0, width: vw, height: vh};
  const ratio = fmt === 'landscape' ? 16 / 9 : 9 / 16;
  const baseW = Math.min(vw, vh * ratio);
  const baseH = baseW / ratio;
  const width = baseW / settings.zoom, height = baseH / settings.zoom;
  return {left: (vw - width) * settings.x / 100, top: (vh - height) * settings.y / 100, width, height};
}

export const defaultFraming = () => ({mode: 'fill', background: 'blur', x: 50, y: 50, zoom: 1});

export function outputDimensions(clip, width, height) {
  const preset = clip.quality || '720';
  if (clip.format === 'original') {
    if (preset === 'source') return [even(width, width), even(height, height)];
    const box = height > width ? [720,1280] : [1280,720];
    const scale = Math.min(box[0] / width, box[1] / height) * (preset === '1080' ? 1.5 : 1);
    return [even(width * scale, Infinity), even(height * scale, Infinity)];
  }
  if (preset !== 'source') return clip.format === 'vertical'
    ? (preset === '1080' ? [1080,1920] : [720,1280])
    : (preset === '1080' ? [1920,1080] : [1280,720]);
  const settings = {...defaultFraming(), ...clip.crop};
  const rect = cropRect(width, height, clip.format, {...settings, zoom: settings.mode === 'fill' ? settings.zoom : 1});
  return [even(rect.width, width), even(rect.height, height)];
}

// One geometry calculation drives canvas composition and FFmpeg's integer pixels.
export function framingLayout(clip, width, height) {
  const [w,h] = outputDimensions(clip,width,height);
  const settings = {...defaultFraming(), ...clip.crop};
  const mode = clip.format === 'original' ? 'original' : settings.mode;
  if (mode === 'original') return {width:w,height:h,mode,source:{width,height,left:0,top:0}};
  if (mode === 'fill') {
    const rect = cropRect(width,height,clip.format,settings);
    const sw = even(rect.width,width), sh = even(rect.height,height);
    return {width:w, height:h, mode, source:{width:sw,height:sh,
      left:Math.max(0,Math.min(Math.floor(rect.left/2)*2,Math.floor((width-sw)/2)*2)),
      top:Math.max(0,Math.min(Math.floor(rect.top/2)*2,Math.floor((height-sh)/2)*2))}};
  }
  const scale = Math.min(w/width,h/height) * (mode === 'custom' ? settings.zoom : 1);
  const fw = even(width*scale,Infinity), fh = even(height*scale,Infinity);
  const bgScale = Math.max(w/width,h/height) * 1.12;
  // Round background upward so it always covers the output canvas.
  const bw = Math.ceil(width*bgScale/2)*2, bh = Math.ceil(height*bgScale/2)*2;
  return {width:w,height:h,mode,background:settings.background,
    foreground:{width:fw,height:fh,left:Math.round((w-fw)*settings.x/100),top:Math.round((h-fh)*settings.y/100)},
    backdrop:{width:bw,height:bh,left:Math.floor((bw-w)/4)*2,top:Math.floor((bh-h)/4)*2},
    blur:Math.max(1,Math.round(w/90))};
}

function even(number, max) {
  const v = Math.floor(number / 2) * 2;
  return Math.max(2, Math.min(v, Math.floor(max / 2) * 2));
}
export function videoFilter(clip, width, height) {
  const preset = clip.quality || '720';
  if (clip.format === 'original') {
    if (preset === 'source') return 'scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1';
    const verticalSource = height > width;
    const dim = verticalSource ? {720:[720,1280],1080:[1080,1920]}[preset] : {720:[1280,720],1080:[1920,1080]}[preset];
    // Preserve source aspect ratio, including vertical original footage.
    const w = dim[0], h=dim[1];
    return `scale=${w}:${h}:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1`;
  }
  const layout = framingLayout(clip,width,height);
  if (layout.mode !== 'fill') {
    const {width:w,height:h,foreground:f,backdrop:b} = layout;
    const foreground = `scale=${f.width}:${f.height},setsar=1,format=yuv444p`;
    if (layout.background === 'black') {
      const cw = Math.min(w,f.width), ch = Math.min(h,f.height);
      return `${foreground},crop=${cw}:${ch}:${Math.max(0,-f.left)}:${Math.max(0,-f.top)}:exact=1,pad=${w}:${h}:${Math.max(0,f.left)}:${Math.max(0,f.top)}:black,setsar=1`;
    }
    return `split[frame_bg][frame_fg];[frame_bg]scale=${b.width}:${b.height},crop=${w}:${h}:${b.left}:${b.top},boxblur=${layout.blur}:2,colorchannelmixer=rr=0.85:gg=0.85:bb=0.85,setsar=1[frame_back];[frame_fg]${foreground}[frame_front];[frame_back][frame_front]overlay=${f.left}:${f.top}:shortest=1:format=auto,setsar=1`;
  }
  const {left:x,top:y,width:w,height:h} = layout.source;
  const out = preset === 'source' ? '' : `,scale=${layout.width}:${layout.height}`;
  return `crop=${w}:${h}:${x}:${y}${out},setsar=1`;
}
