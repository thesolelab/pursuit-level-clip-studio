const RATE = 16000,
  FRAME = 512;
// Thresholds classify speech probabilities, not waveform loudness/music peaks.
export function speechRegions(scores, sampleCount) {
  const regions = [];
  let first = -1,
    last = -1,
    quiet = 0;
  const close = () => {
    if (first >= 0 && last - first + 1 >= 3) {
      const start = Math.max(0, ((first - 2) * FRAME) / RATE),
        end = Math.min(sampleCount / RATE, ((last + 3) * FRAME) / RATE);
      if (regions.length && start <= regions.at(-1).end)
        regions.at(-1).end = end;
      else regions.push({ start, end });
    }
    first = last = -1;
    quiet = 0;
  };
  for (let i = 0; i < scores.length; i++) {
    if (first < 0) {
      if (scores[i] >= 0.5) {
        first = last = i;
        quiet = 0;
      }
    } else if (scores[i] >= 0.35) {
      last = i;
      quiet = 0;
    } else if (++quiet >= 8) close();
  }
  close();
  return regions;
}
export async function detectSpeech(audio, onProgress = () => {}) {
  onProgress('Locating speech in the source audio…');
  const { InferenceSession, Tensor, env } = await import(
    '../../vendor/captions/vad-runtime.js'
  );
  env.wasm.numThreads = 1;
  env.wasm.wasmPaths = new URL('../../vendor/captions/', import.meta.url).href;
  const session = await InferenceSession.create(
    new URL('../../vendor/captions/silero-v5.onnx', import.meta.url).href,
    { executionProviders: ['wasm'] }
  );
  let state = new Tensor('float32', new Float32Array(256), [2, 1, 128]);
  const sr = new Tensor('int64', new BigInt64Array([16000n]), []),
    scores = [];
  try {
    for (let offset = 0; offset < audio.length; offset += FRAME) {
      let samples = audio.subarray(offset, offset + FRAME);
      if (samples.length < FRAME) {
        const padded = new Float32Array(FRAME);
        padded.set(samples);
        samples = padded;
      }
      const input = new Tensor('float32', samples, [1, FRAME]);
      const result = await session.run({ input, state, sr });
      input.dispose();
      state.dispose();
      state = result.stateN;
      scores.push(Number(result.output.data[0]));
      result.output.dispose();
      if (scores.length % 64 === 0)
        onProgress(
          `Locating speech: ${Math.min(100, Math.round(((offset + FRAME) / audio.length) * 100))}%`
        );
    }
  } finally {
    state.dispose();
    sr.dispose();
    await session.release();
  }
  const ranges = speechRegions(scores, audio.length);
  if (!ranges.length)
    throw Error(
      'The speech detector found no speech regions. Check “Audio used for captions”; no captions were replaced.'
    );
  return ranges;
}
