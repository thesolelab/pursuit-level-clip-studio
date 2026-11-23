import {
  transcriptSegments,
  safeCaptions,
  defaultCaptions,
  wordsOf
} from './model.js';

// Separate text recognition from timestamp extraction: missing alignment must not
// erase a successful transcript. Only call the model again when necessary.
export async function recognizeCaptions(
  recognizer,
  audio,
  start,
  duration,
  onProgress = () => {}
) {
  const validate = (segments) =>
    safeCaptions({ ...defaultCaptions(), segments }, start + duration).segments;
  let recognizedText = '';
  for (const timing of ['word', true, false]) {
    onProgress(
      timing === 'word'
        ? 'Recognizing speech and word timing…'
        : timing === true
          ? 'Retrying speech recognition with phrase timing…'
          : 'Retrying speech recognition without timestamps…'
    );
    let result;
    try {
      result = await recognizer(audio, {
        return_timestamps: timing,
        chunk_length_s: 30,
        stride_length_s: 5
      });
    } catch (error) {
      if (timing === false && !recognizedText) throw error;
      continue;
    }
    if (wordsOf(result.text).length) recognizedText = result.text;
    try {
      return validate(
        transcriptSegments(result, start, duration, timing === 'word')
      );
    } catch {
      if (recognizedText) {
        onProgress(
          'Speech recognized. Word timing is estimated; review it against the audio.'
        );
        return validate(
          transcriptSegments({ text: recognizedText }, start, duration, false)
        );
      }
    }
  }
  if (recognizedText)
    return validate(
      transcriptSegments({ text: recognizedText }, start, duration, false)
    );
  throw Error(
    'Audio was extracted, but the speech model returned no words. Play “Audio used for captions” below to check what it received. Your existing captions were kept.'
  );
}
