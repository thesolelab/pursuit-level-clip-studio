# Automatic captions — development, not a release

This feature branch implements the requested v0.6.0 caption milestone on the existing **v0.6.4** application. It deliberately keeps the current version and later montage/layout improvements. No release changelog has been finalized. Main and production must remain unchanged until owner validation.

## Creator workflow

1. Import a narrated video and select its start/end range.
2. Open Captions and choose **Generate captions**. First use downloads public model files; allow several minutes. Audio and transcription remain on your device.
3. Review GTA names and every timing. Edit text and source timestamps in seconds; use Jump to check the original footage. Add captions manually, split between words at the playhead, merge with the next segment, or delete. Segments cannot overlap.
4. Choose Pursuit Pop, Neon Highlight, or Cinematic. Customize the font, size, colors, outline, shadow, placement, words per group, intensity, and speed. The existing Output preview shows captions while playing or seeking. The source video stays unaltered.
5. Save the project JSON and keep its original video. Captions are shared across this source, including all saved clips. Generate additional ranges to cover other footage; generation replaces overlapping caption segments after confirmation.
6. Export a clip, ZIP, or shuffled montage normally. The visibility checkbox controls both preview and burned captions. Existing mute choices control source audio. **Download range SRT** exports corrected plain subtitles relative to the selected range, beginning at zero; SRT does not contain styling. A montage's burned captions follow each source cut; the SRT button does not produce a shuffled montage SRT.

Model word times are predictions, not guaranteed frame-accurate alignment. The UI distinguishes **Model word timing**, **Speech phrase timing**, and manually **Estimated word timing**. Replacing words without changing the token count preserves alignment; changing word count while retaining known speech boundaries switches to a phrase caption. Phrase captions appear together at the speech timestamps and do not simulate active-word highlighting. Manual cue timing, splitting, and merging still require review. Older estimated captions must be regenerated to gain speech alignment.

## Architecture and privacy

- `js/captions/model.js`: bounded validation, corrected word alignment, caption grouping, and standard SRT serialization.
- `speech.js`: runs the local Silero V5 speech detector over 16 kHz samples, retaining source-relative speech regions and pauses. It uses short margins around detected speech; this is probabilistic detection, not a frame-accuracy guarantee.
- `transcribe-worker.js`: lazily imports the self-hosted Transformers.js/ONNX browser bundle, downloads a pinned English Whisper Tiny model, and processes mono 16 kHz audio in a dedicated worker. CPU WebAssembly works without a GPU or cross-origin isolation. Threads are limited to one for GitHub Pages compatibility. Browser model caching is used where permitted.
- `workspace.js`: caption editing and style controls. Only 40 segments are rendered at once.
- `render.js`: shared word measurements and layout, Canvas preview, and ASS animation generation. Preview caches layouts and uses binary search to locate the current caption group. Five bundled TTFs are used both by FontFace and FFmpeg/libass; no installed system font is required.
- `app.js`: coordinates selected-range audio extraction using the existing FFmpeg engine and file-backed source mounting, cancellation, project state, and immutable export snapshots.
- `js/montage-export.js`: accepts an optional per-clip filter, so shuffled source timestamps map to the correct burned captions.

Speech model: **Xenova/whisper-tiny.en**, pinned revision `79fb389fc764e7c395bd330e9531d9d32ada7049`, quantized (`q8`). The initially evaluated `onnx-community/whisper-tiny.en` lacked cross-attention outputs. The selected Xenova export returned word timestamps in a real browser test. If word timing fails, phrase transcription is retried inside detected speech regions. Only model-returned phrase bounds are accepted. If neither pass returns usable speech timestamps, the operation reports that limitation and keeps existing captions; recognized text is no longer spread across the selection. Tiny English is fast relative to larger Whisper models but less accurate with music, overlapping voices, and GTA names.

Only public model GET requests go to Hugging Face/CDN hosting. The application sends no media or transcript request body. Speech libraries, WASM, fonts, and FFmpeg are served from the site. Ordinary clipping never loads speech libraries/models. Fonts load only when captions are enabled. Project JSON contains caption text/timings/style, not media or models; projects without captions retain existing behavior. Projects now allow up to 8 MiB to accommodate word timings, with matching save/import limits and validation against actual source duration.

Cancellation terminates the speech worker and any active audio extraction. Existing captions are replaced only after a complete valid result. Export uses a caption snapshot and cleans temporary ASS/font files; terminated engines release their in-memory filesystem. No server processing, accounts, paid APIs, or persistent transcript service is introduced.

## Rendering and dependencies

FFmpeg wrapper/core stay pinned at **0.12.10**. The actual existing core was probed and includes `ass`, `subtitles`, libass, FreeType, and HarfBuzz. Caption filters run **after** crop/scale. ASS positions and per-word pop/color/slide/fade intervals use the same measured layout as Canvas. Intervals clip to the requested source range without restarting the animation. ASS timing quantizes to centiseconds; video frames, font rasterization, outline/shadow edges, and colors can differ slightly from Canvas. Font Win/HHEA metric compensation aligns glyph size and placement. User text is escaped against ASS override injection.

Pinned build dependencies include `@huggingface/transformers` 3.8.1, esbuild 0.25.12, and `@ricky0123/vad-web` 0.0.30. The last package supplies only the Silero V5 ONNX model; its microphone/worklet code and nested ONNX runtime are not bundled. The detector uses the existing pinned ONNX runtime with a separate CPU WASM loader. The lockfile pins the ONNX browser runtime. `npm run prepare-captions` bundles the browser module, copies its matching JSEP WASM/loader and license notices to ignored `vendor/captions/`. `npm ci --ignore-scripts` avoids installing an irrelevant native GPU backend. The browser bundle does not use onnxruntime-node.

The proposed Pages workflow copies `fonts/`, creates the caption bundle, and includes notices. Existing FFmpeg preparation and deployment triggers remain unchanged. CI builds caption assets as a check. These workflow changes take effect only after a future approved merge; no production deployment is performed on this branch.

Licenses: model card declares Apache-2.0; original OpenAI Whisper code is MIT. Transformers.js is Apache-2.0, ONNX Runtime MIT, esbuild MIT, the vad-web build distribution ISC, the Silero model MIT, and fonts SIL OFL 1.1. The Silero license is copied alongside the self-hosted model. See `licenses/`, `fonts/*-OFL.txt`, bundled JS legal notices, and `fonts/README.md`. ONNX runtime notices are from upstream v1.22.0, the matching release family of the pinned browser prerelease; its shortened prerelease commit was unavailable through the public source mirror. Models remain downloaded from their public host rather than redistributed inside projects.

## Resource limits

First use downloads approximately 120 MB including the speech model, browser runtime, and FFmpeg; exact transfer and cache sizes vary. Processing can require hundreds of MB of memory and be slower than real time on older devices. Select short ranges first; transcription is limited to ten minutes per request. A GPU is not required. Cache eviction, private browsing, unavailable downloads, disabled WASM/SIMD, unsupported browsers, and memory pressure can cause failures; errors keep current work and manual captions remain available. Long/4K source files can still exceed FFmpeg/browser limits, especially where file-backed mounting is unavailable. Preview never re-encodes video.

Current implementation is English only. There is no speaker detection, automatic emphasis-word selection, rich punctuation alignment editor, SRT import, or karaoke accuracy guarantee. Presets use readable deterministic animation; Pursuit Pop highlights the spoken word, Neon shows the phrase with active-word transitions, and Cinematic accents the first word while sliding/fading the phrase.

## Validation and remaining acceptance

Run routine checks:

```sh
npm ci --ignore-scripts
npm run prepare-captions
npm run prepare-engine
npm run check
npm test
npx playwright install --with-deps chromium
npm run test:browser
```

The normal browser suite uses real video playback and a fake encoding engine for editor/export coordination. Slow, real-model/real-FFmpeg checks are separate and require a local server with prepared assets:

```sh
python3 -m http.server 8765
# In another terminal, with Chromium installed:
node scripts/validate-captions.mjs
node scripts/validate-caption-render.mjs
node scripts/validate-caption-workflow.mjs
```

Use `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` for an existing browser, `CAPTION_TEST_ORIGIN` for a different server, and `CAPTION_TEST_OUTPUT` for an output directory. Default outputs go to ignored `test-results/captions/`. The narrated fixture is synthetic (FFmpeg flite voice over a flat color), with known words. It contains no creator footage. In a test environment with an intercepting certificate proxy only, `CAPTION_TEST_IGNORE_HTTPS_ERRORS=1` applies to the transcription test browser; the application itself never disables TLS validation.

Recorded development evidence:

- Actual selected-model English narration transcription returned source-relative word timestamps and corrected text was saved in project JSON. The fallback was also exercised using the evaluated model lacking attention outputs.
- Actual FFmpeg.wasm encoded all three presets and all five bundled fonts; font-selection logs confirmed the intended font files. Preview/export glyph extents matched within a few pixels at 640×360 before final baseline compensation.
- Pre-caption frames were blank and frames during pop/highlight/slide-fade differed as expected. Native FFmpeg decoded exported frames without errors.
- Full editor/project-to-export path produced a 720×1280 H.264/yuv420p + AAC MP4, trimmed from source 0.5–4 seconds. Video and audio both started at zero and lasted 3.5 seconds. Decoded source/output audio correlation at the same timestamps was 0.9999.
- Automated editor checks cover corrections/styles, project round-trip, SRT clipping, cancellation retaining captions, and caption filters in batch export, alongside existing crop/montage/export regressions.
- A second full editor export produced a muted 1280×720 MP4 with no audio stream. The retained-audio vertical MP4 played successfully through Chromium’s media decoder.
- Observed actual transcription and export workflow network requests had no non-GET/HEAD uploads. Source and transcript handling stays local by implementation.

**Still required before release:** owner import/playback in CapCut, real GTA narration/gameplay review, longer videos and low-memory devices, Safari/Firefox/mobile validation, live GitHub Pages deployment after approval, and subjective animation/readability review on phones. Automated encoding and codec checks do not prove CapCut import. Keep this as development and do not merge or publish as a completed release until those checks are accepted.

### Speech synchronization correction

The earlier text-recovery fallback could distribute recognized words across an entire selection, including silence. That automatic estimate is removed. Silero V5 detects speech regions locally before Whisper runs. Each region is transcribed separately and its original source offset is retained, so pauses are not removed from the caption timeline. Word timing is preferred; when only phrase timestamps are available, the full phrase appears during its speech interval, with no invented word-by-word progression. Text-only corrections with a different word count retain known phrase boundaries. Existing estimated captions are not retroactively aligned: regenerate them. The entry point, caption modules, project validator, and speech worker use a shared cache version so an update does not mix old estimated-timing code with the new speech-alignment pipeline.

The speech detector and its additional 11 MB CPU WASM runtime load only during generation; the V5 model is about 2.3 MB. Cancellation terminates both speech detection and recognition. No external service, microphone, or voiceover is involved. Unsupported/failed detection keeps existing captions rather than replacing them with guessed timing. Speech detection and Whisper can still make mistakes with music, multiple voices, or unclear audio; review the result.

Actual Chrome validation used synthetic narration with 2.5 seconds of added leading silence. Native decoding measured voice onset at 2.7206 seconds; generated speech captions started at 2.752 seconds. The previous phrase-only fallback started at zero on this same input. With a continuous quiet background tone added, word timing was returned and the first caption started at 2.688 seconds (about 0.033 seconds before the known voice onset). This checks that the detector is not simply treating every audible sound as speech. All three presets and five fonts were rendered through real FFmpeg.wasm in phrase mode; frame checks found no captions before the phrase onset and the whole phrase visible afterward. Real GTA footage still needs creator review.

For repeatable silence tests, `scripts/validate-captions.mjs` accepts `CAPTION_TEST_SOURCE` and `CAPTION_EXPECTED_SPEECH_START` (a 0.2-second test tolerance). Set `CAPTION_TEST_PHRASE=1` for the real rendering script to test phrase mode.

### Caption endpoint rounding correction

Caption ends now use the same one-millisecond tolerance as clip ranges and are clamped to the exact media duration, including their final word timestamps. Larger overruns and words that would become zero-length remain invalid. Selected ranges are capped before transcription; text-only corrections preserve original timestamps when the millisecond fields are unchanged. Regression cases reproduce the former `Invalid caption end` error with a 1.23456-second source displayed as 1.235 seconds and with floating-point arithmetic at the source boundary.

### Gameplay non-dialogue recovery

A user-supplied gameplay sample reproduced the speech-timestamp failure. Its first detected region was 0.352 seconds long; Whisper returned the control label `[BLANK_AUDIO]` with unusable token times, then an empty phrase result. This label had been treated as recognized dialogue, causing the entire transcription to abort before later speech.

Known non-dialogue labels are now excluded from dialogue recognition. An empty/non-dialogue region is skipped and later regions continue, while genuine processing/alignment errors still fail without replacing existing captions. A selection containing only non-dialogue also keeps existing work. No timing is invented and no speech detector/model is changed. The module cache version advances together so deployed clients receive the correction.

The full supplied clip was successfully transcribed into six word-timed segments and exported through the actual browser FFmpeg workflow. The output retains the source framing and audio duration, and decoded audio correlation at original timestamps was approximately 0.999. User footage and transcripts remain private local test artifacts and are not added to repository fixtures. Recognition wording remains subject to manual review; successful processing is not a guarantee that every word is correct.
