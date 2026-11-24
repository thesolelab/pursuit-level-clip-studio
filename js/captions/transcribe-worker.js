import {detectSpeech} from './speech.js';
import { recognizeSpeechRegions } from './recognition.js';
let recognizer;
self.onmessage = async ({ data }) => {
  try {
    const onProgress=message=>self.postMessage({type:'progress',message});
    const ranges=await detectSpeech(data.audio,onProgress);
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
    const segments = await recognizeSpeechRegions(
      recognizer,
      data.audio,
      data.start,
      data.duration,
      ranges,
      (message) => self.postMessage({ type: 'progress', message })
    );
    self.postMessage({ type: 'complete', segments });
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: `Local transcription failed: ${error.message}`
    });
  }
};
