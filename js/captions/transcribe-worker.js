import {
  dialogueWords,
  alignTranscript,
  realignEditedCaptions
} from './alignment.js?v=edit-align-1';
let recognizer, aligner;
self.onmessage = async ({ data }) => {
  try {
    const onProgress = (message) =>
      self.postMessage({ type: 'progress', message });

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
    let words;
    if (data.mode !== 'realign') {
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
      onProgress('Transcribing the full audio, including quiet dialogue…');
      const result = await recognizer(data.audio, {
        return_timestamps: 'word',
        chunk_length_s: 30,
        stride_length_s: 5
      });
      words = dialogueWords(result, data.duration);
    }
    onProgress('Loading the local word-alignment model…');
    aligner ||= await pipeline(
      'automatic-speech-recognition',
      'Xenova/wav2vec2-base-960h',
      {
        revision: 'a19f851b3d42865797e410752b4c570c871e4825',
        dtype: 'q8',
        device: 'wasm',
        progress_callback
      }
    );
    const segments =
      data.mode === 'realign'
        ? await realignEditedCaptions(
            aligner,
            data.audio,
            data.start,
            data.duration,
            data.cues,
            onProgress
          )
        : await alignTranscript(
            aligner,
            data.audio,
            words,
            data.start,
            data.duration,
            onProgress
          );
    self.postMessage({ type: 'complete', segments });
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: `${data.mode === 'realign' ? 'Word timing update failed' : 'Local transcription failed'}: ${error.message}`
    });
  }
};
