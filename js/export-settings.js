export function cropRect(vw, vh, fmt, settings) {
  if (!vw || !vh) return null;
  if (fmt === 'original') return {left: 0, top: 0, width: vw, height: vh};
  const ratio = fmt === 'landscape' ? 16 / 9 : 9 / 16;
  const baseW = Math.min(vw, vh * ratio);
  const baseH = baseW / ratio;
  const width = baseW / settings.zoom, height = baseH / settings.zoom;
  return {left: (vw - width) * settings.x / 100, top: (vh - height) * settings.y / 100, width, height};
}

function even(number, max) {
  const v = Math.floor(number / 2) * 2;
  return Math.max(2, Math.min(v, Math.floor(max / 2) * 2));
}
export function videoFilter(clip, width, height) {
  const preset = clip.quality || '720';
  const box = clip.format === 'vertical' ? {720:[720,1280],1080:[1080,1920]} : {720:[1280,720],1080:[1920,1080]};
  if (clip.format === 'original') {
    if (preset === 'source') return 'scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1';
    const verticalSource = height > width;
    const dim = verticalSource ? {720:[720,1280],1080:[1080,1920]}[preset] : {720:[1280,720],1080:[1920,1080]}[preset];
    // Preserve source aspect ratio, including vertical original footage.
    const w = dim[0], h=dim[1];
    return `scale=${w}:${h}:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1`;
  }
  const rect = cropRect(width, height, clip.format, clip.crop);
  const {left, top} = rect;
  const w = even(rect.width, width), h = even(rect.height, height);
  const x = Math.max(0, Math.min(Math.floor(left/2)*2, Math.floor((width-w)/2)*2));
  const y = Math.max(0, Math.min(Math.floor(top/2)*2, Math.floor((height-h)/2)*2));
  const out = preset === 'source' ? '' : `,scale=${box[preset].join(':')}`;
  return `crop=${w}:${h}:${x}:${y}${out},setsar=1`;
}
