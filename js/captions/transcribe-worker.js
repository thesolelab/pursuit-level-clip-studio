import { transcriptSegments, safeCaptions, defaultCaptions } from './model.js';
let recognizer;
self.onmessage = async ({ data }) => {
  try {
    const { pipeline, env } = await import(
      '../../vendor/captions/transformers.js'
    );
    env.allowLocalModels = false;
    env.backends.onnx.wasm.wasmPaths = new URL(
      '../../vendor/captions/',
      import.meta.url
    ).href;
    env.backends.onnx.wasm.numThreads = 1;
    const progress_callback = (p) =>
      self.postMessage({
        type: 'progress',
        message:
          p.status === 'progress'
            ? `Downloading speech model: ${Math.round(p.progress || 0)}%`
            : p.status
      });
    recognizer ||= await pipeline(
      'automatic-speech-recognition',
      'Xenova/whisper-tiny.en',
      {
        revision: '79fb389fc764e7c395bd330e9531d9d32ada7049',
        dtype: 'q8',
        device: 'wasm',
        progress_callback
      }
    );
    self.postMessage({
      type: 'progress',
      message: 'Listening locally… This can take several minutes.'
    });
    let segments;
    try {
      const result = await recognizer(data.audio, {
        return_timestamps: 'word',
        chunk_length_s: 30,
        stride_length_s: 5
      });
      segments = transcriptSegments(result, data.start, data.duration, true);
      segments = safeCaptions(
        { ...defaultCaptions(), segments },
        data.start + data.duration
      ).segments;
    } catch (error) {
      self.postMessage({
        type: 'progress',
        message: `Word timing unavailable (${error.message}). Using estimated word timing…`
      });
      const result = await recognizer(data.audio, {
        return_timestamps: true,
        chunk_length_s: 30,
        stride_length_s: 5
      });
      segments = transcriptSegments(result, data.start, data.duration, false);
    }
    self.postMessage({ type: 'complete', segments });
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: `Local transcription failed: ${error.message}. Try a shorter range or add captions manually.`
    });
  }
};
