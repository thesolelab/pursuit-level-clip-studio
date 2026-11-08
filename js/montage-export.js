import {videoFilter} from './export-settings.js';

// Uniform codecs, dimensions, frame rate and audio layout make the pieces join cleanly.
export function montagePartArgs(input, clip, output, width, height) {
  const args = ['-ss', clip.start.toFixed(3), '-i', input, '-t', (clip.end - clip.start).toFixed(3),
    '-vf', videoFilter(clip, width, height), '-r', '30', '-c:v', 'libx264', '-preset', 'ultrafast',
    '-crf', '23', '-pix_fmt', 'yuv420p', '-video_track_timescale', '90000'];
  if (clip.mute) args.push('-an');
  else args.push('-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2');
  args.push('-y', output);
  return args;
}

export async function encodeMontage(engine, input, clips, {width, height, signal, onStep = () => {}}) {
  const parts = clips.map((_, i) => `montage_part_${i}.mp4`);
  const list = 'montage_list.txt', output = 'montage_final.mp4';
  const check = () => {if (signal?.aborted) throw Error('Export cancelled.');};
  try {
    for (let i = 0; i < clips.length; i++) {
      check(); onStep(i, `Encoding montage segment ${i + 1}/${clips.length}…`);
      const exitCode = await engine.exec(montagePartArgs(input, clips[i], parts[i], width, height));
      if (exitCode !== 0) throw Error(`Could not encode montage segment ${i + 1}.`);
    }
    check(); onStep(clips.length, 'Joining montage into one MP4…');
    await engine.writeFile(list, new TextEncoder().encode(parts.map(name => `file '${name}'`).join('\n')));
    const duration = clips.reduce((sum, clip) => sum + clip.end - clip.start, 0);
    const exitCode = await engine.exec(['-f', 'concat', '-safe', '0', '-i', list, '-t', duration.toFixed(3),
      '-c', 'copy', '-movflags', '+faststart', '-y', output]);
    if (exitCode !== 0) throw Error('Could not join the montage segments.');
    check();
    const bytes = await engine.readFile(output);
    if (!bytes.length) throw Error('The montage export was empty.');
    return bytes;
  } finally {
    // Cancellation terminates the engine; its in-memory filesystem is released with it.
    if (!signal?.aborted) for (const name of [...parts, list, output]) {
      try {await engine.deleteFile(name);} catch {}
    }
  }
}
