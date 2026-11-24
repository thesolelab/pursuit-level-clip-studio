# Automatic captions — development, not a release

This feature branch implements the requested v0.6.0 caption milestone on the existing **v0.6.4** application. It deliberately keeps the current version and later montage/layout improvements. No release changelog has been finalized. Main and production must remain unchanged until owner validation.

## Creator workflow

1. Import a narrated video and select its start/end range.
2. Open Captions and choose **Generate captions**. First use downloads public model files; allow several minutes. Audio and transcription remain on your device.
3. Review GTA names and every timing. Edit text and source timestamps in seconds; use Jump to check the original footage. Add captions manually, split between words at the playhead, merge with the next segment, or delete. Segments cannot overlap.
4. Choose Pursuit Pop, Neon Highlight, or Cinematic. Customize the font, size, colors, outline, shadow, placement, words per group, intensity, and speed. The existing Output preview shows captions while playing or seeking. The source video stays unaltered.
5. Save the project JSON and keep its original video. Captions are shared across this source, including all saved clips. Generate additional ranges to cover other footage; generation replaces overlapping caption segments after confirmation.
6. Export a clip, ZIP, or shuffled montage normally. The visibility checkbox controls both preview and burned captions. Existing mute choices control source audio. **Download range SRT** exports corrected plain subtitles relative to the selected range, beginning at zero; SRT does not contain styling. A montage's burned captions follow each source cut; the SRT button does not produce a shuffled montage SRT.

Model word times are predictions, not guaranteed frame-accurate alignment. The UI distinguishes **Model word timing** from **Estimated word timing**. Replacing words without changing the token count preserves alignment; changing word count or cue timing distributes words evenly over the edited segment. Splitting and merging also estimates word timing. Review these edits against speech before export.

## Architecture and privacy

- `js/captions/model.js`: bounded validation, corrected word alignment, caption grouping, and standard SRT serialization.
- `transcribe-worker.js`: lazily imports the self-hosted Transformers.js/ONNX browser bundle, downloads a pinned English Whisper Tiny model, and processes mono 16 kHz audio in a dedicated worker. CPU WebAssembly works without a GPU or cross-origin isolation. Threads are limited to one for GitHub Pages compatibility. Browser model caching is used where permitted.
- `workspace.js`: caption editing and style controls. Only 40 segments are rendered at once.
- `render.js`: shared word measurements and layout, Canvas preview, and ASS animation generation. Preview caches layouts and uses binary search to locate the current caption group. Five bundled TTFs are used both by FontFace and FFmpeg/libass; no installed system font is required.
- `app.js`: coordinates selected-range audio extraction using the existing FFmpeg engine and file-backed source mounting, cancellation, project state, and immutable export snapshots.
- `js/montage-export.js`: accepts an optional per-clip filter, so shuffled source timestamps map to the correct burned captions.

Speech model: **Xenova/whisper-tiny.en**, pinned revision `79fb389fc764e7c395bd330e9531d9d32ada7049`, quantized (`q8`). The initially evaluated `onnx-community/whisper-tiny.en` lacked cross-attention outputs. The selected Xenova export returned word timestamps in a real browser test. If word timing fails, sentence transcription is retried with evenly estimated word times and explicitly labeled. Tiny English is fast relative to larger Whisper models but less accurate with music, overlapping voices, and GTA names.

Only public model GET requests go to Hugging Face/CDN hosting. The application sends no media or transcript request body. Speech libraries, WASM, fonts, and FFmpeg are served from the site. Ordinary clipping never loads speech libraries/models. Fonts load only when captions are enabled. Project JSON contains caption text/timings/style, not media or models; projects without captions retain existing behavior. Projects now allow up to 8 MiB to accommodate word timings, with matching save/import limits and validation against actual source duration.

Cancellation terminates the speech worker and any active audio extraction. Existing captions are replaced only after a complete valid result. Export uses a caption snapshot and cleans temporary ASS/font files; terminated engines release their in-memory filesystem. No server processing, accounts, paid APIs, or persistent transcript service is introduced.

## Rendering and dependencies

FFmpeg wrapper/core stay pinned at **0.12.10**. The actual existing core was probed and includes `ass`, `subtitles`, libass, FreeType, and HarfBuzz. Caption filters run **after** crop/scale. ASS positions and per-word pop/color/slide/fade intervals use the same measured layout as Canvas. Intervals clip to the requested source range without restarting the animation. ASS timing quantizes to centiseconds; video frames, font rasterization, outline/shadow edges, and colors can differ slightly from Canvas. Font Win/HHEA metric compensation aligns glyph size and placement. User text is escaped against ASS override injection.

New pinned build dependencies are `@huggingface/transformers` 3.8.1 and esbuild 0.25.12. The lockfile pins the ONNX browser runtime. `npm run prepare-captions` bundles the browser module, copies its matching JSEP WASM/loader and license notices to ignored `vendor/captions/`. `npm ci --ignore-scripts` avoids installing an irrelevant native GPU backend. The browser bundle does not use onnxruntime-node.

The proposed Pages workflow copies `fonts/`, creates the caption bundle, and includes notices. Existing FFmpeg preparation and deployment triggers remain unchanged. CI builds caption assets as a check. These workflow changes take effect only after a future approved merge; no production deployment is performed on this branch.

Licenses: model card declares Apache-2.0; original OpenAI Whisper code is MIT. Transformers.js is Apache-2.0, ONNX Runtime MIT, esbuild MIT, fonts SIL OFL 1.1. See `licenses/`, `fonts/*-OFL.txt`, bundled JS legal notices, and `fonts/README.md`. ONNX runtime notices are from upstream v1.22.0, the matching release family of the pinned browser prerelease; its shortened prerelease commit was unavailable through the public source mirror. Models remain downloaded from their public host rather than redistributed inside projects.

## Resource limits

First use downloads approximately 100 MB including the speech model, browser runtime, and FFmpeg; exact transfer and cache sizes vary. Processing can require hundreds of MB of memory and be slower than real time on older devices. Select short ranges first; transcription is limited to ten minutes per request. A GPU is not required. Cache eviction, private browsing, unavailable downloads, disabled WASM/SIMD, unsupported browsers, and memory pressure can cause failures; errors keep current work and manual captions remain available. Long/4K source files can still exceed FFmpeg/browser limits, especially where file-backed mounting is unavailable. Preview never re-encodes video.

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

### Recognition recovery follow-up

Recognized text is now retained when Whisper supplies empty or invalid timestamp chunks; those captions explicitly use estimated timing. When timed recognition returns no words, the worker retries phrase timing and then plain transcription without timestamps. It no longer equates unusable timestamps with silent source audio. Completely empty results retain existing captions and explain that the model returned no words.

After extraction, **Audio used for captions** plays a local WAV copy of the exact selected mono 16 kHz audio given to recognition. This helps distinguish a wrong/empty extracted track from a recognition failure even when the source player sounds fine. The preview is cleared when replacing the source or regenerating, stays local, and is never saved in project JSON. It does not add a voiceover or affect export audio. These changes improve recovery and diagnosis; a creator's particular failing video still needs retesting and is not proven fixed by the synthetic fixture.

### Caption endpoint rounding correction

Caption ends now use the same one-millisecond tolerance as clip ranges and are clamped to the exact media duration, including their final word timestamps. Larger overruns and words that would become zero-length remain invalid. Selected ranges are capped before transcription; text-only corrections preserve original timestamps when the millisecond fields are unchanged. Regression cases reproduce the former `Invalid caption end` error with a 1.23456-second source displayed as 1.235 seconds and with floating-point arithmetic at the source boundary.
