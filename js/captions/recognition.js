import {
  transcriptSegments,
  safeCaptions,
  defaultCaptions,
  wordsOf,
  estimatedWords
} from './model.js?v=framing-1';

// Whisper can emit a control label for game sounds or silence. These are not
// recognized dialogue, even when the decoder supplies token timestamps.
const NON_SPEECH =
  /^(?:\s*\[(?:BLANK_AUDIO|NO_SPEECH|SILENCE|MUSIC|APPLAUSE|LAUGHTER)\][\s.!]*)+$/i;
const noSpeech = () =>
  Object.assign(
    Error('The speech model returned no dialogue for this detected region.'),
    { code: 'NO_SPEECH' }
  );
// Never turn missing alignment into invented source-wide speech timing.
export async function recognizeCaptions(
  recognizer,
  audio,
  start,
  duration,
  onProgress = () => {}
) {
  const validate = (segments) =>
    safeCaptions({ ...defaultCaptions(), segments }, start + duration).segments;
  let recognizedText = '',
    processingError;
  for (const timing of ['word', true]) {
    onProgress(
      timing === 'word'
        ? 'Aligning words to speech…'
        : 'Word alignment unavailable. Trying speech phrase timestamps…'
    );
    let result;
    try {
      result = await recognizer(audio, {
        return_timestamps: timing,
        chunk_length_s: timing === 'word' ? 30 : 15,
        stride_length_s: timing === 'word' ? 5 : 2
      });
    } catch (error) {
      processingError = error;
      continue;
    }
    if (NON_SPEECH.test(result.text || '')) continue;
    if (wordsOf(result.text).length) recognizedText = result.text;
    try {
      if (timing === 'word')
        return validate(transcriptSegments(result, start, duration, true));
      // Phrase timestamps must come from the model, never from the selection bounds.
      const chunks = result.chunks || [];
      if (!chunks.length) continue;
      const segments = chunks
        .filter((c) => wordsOf(c.text).length)
        .map((c) => {
          const [a, b] = c.timestamp || [];
          if (
            !Number.isFinite(a) ||
            !Number.isFinite(b) ||
            b <= a ||
            a < 0 ||
            a >= duration
          )
            throw Error('Missing phrase alignment.');
          const cueStart = start + a,
            cueEnd = start + Math.min(duration, b),
            text = wordsOf(c.text).join(' ');
          return {
            start: cueStart,
            end: cueEnd,
            text,
            timing: 'phrase',
            words: estimatedWords(text, cueStart, cueEnd)
          };
        });
      if (!segments.length) continue;
      return validate(segments);
    } catch {
      /* A timing failure must not become evenly distributed captions. */
    }
  }
  if (recognizedText)
    throw Error(
      'Speech was recognized, but reliable speech timestamps were unavailable. No captions were replaced. Try a shorter speech range; manual timing remains available.'
    );
  if (processingError)
    throw Error(`Speech alignment could not run: ${processingError.message}`);
  throw noSpeech();
}

// Region offsets remain tied to the original source, including pauses between
// regions. Never concatenate speech samples and lose their source timestamps.
export async function recognizeSpeechRegions(
  recognizer,
  audio,
  start,
  duration,
  ranges,
  onProgress = () => {}
) {
  const segments = [];
  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i],
      first = Math.max(0, Math.floor(range.start * 16000)),
      last = Math.min(
        audio.length,
        Math.ceil(Math.min(duration, range.end) * 16000)
      );
    if (last <= first) continue;
    onProgress(`Aligning speech region ${i + 1}/${ranges.length}…`);
    try {
      segments.push(
        ...(await recognizeCaptions(
          recognizer,
          audio.subarray(first, last),
          start + first / 16000,
          (last - first) / 16000,
          onProgress
        ))
      );
    } catch (error) {
      if (error.code !== 'NO_SPEECH') throw error;
      onProgress(
        `No dialogue in region ${i + 1}; checking the remaining speech regions…`
      );
    }
  }
  if (!segments.length)
    throw Error(
      'No dialogue was recognized in the detected regions. Check “Audio used for captions”; existing captions were kept.'
    );
  return safeCaptions({ ...defaultCaptions(), segments }, start + duration)
    .segments;
}
