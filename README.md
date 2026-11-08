# Pursuit Level Clip Studio v0.6.2

A local-browser video clip editor for Pursuit Level. Import MP4/MOV/WebM, preview and select multiple clips, edit 9:16/16:9/original framing, mute audio, export MP4 or batch ZIP, and save/reopen project JSON.

**Video and project data stay on your device.** FFmpeg runs in a browser worker; there is no application backend or video upload.

## Editing and projects

- Use **Add new clip** to keep a new range. Use **Edit range** to load an existing clip.
- Changes to a loaded clip are included automatically when you save the project or export. **Save loaded clip** also keeps that clip loaded for further editing or export.
- **Save project** downloads JSON containing the saved clips and their settings, not the source video. Keep the original video on your device. A new range must be added as a clip before saving a project.
- **Open project** restores directly if the matching video is already loaded. Otherwise, choose **Choose project source video** and select the original video. Matching checks use name, file size, duration, and clip bounds.
- Replacement videos are checked before current work is cleared. Unsaved work triggers a confirmation before replacement or leaving the page. These warnings are not automatic backups and browsers may suppress exit warnings.
- Projects support at most 500 clips and imports are limited to 1 MiB of JSON.

## Auto Montage

1. Import your video (for example, two minutes of footage).
2. Choose a target length from **45 to 55 seconds**, a segment count from **2 to 12**, **9:16 or 16:9**, **720p or 1080p**, and **Muted** or **Keep original audio**. Defaults are 50 seconds, six segments, 9:16, 720p, and muted audio.
3. Select **Generate segments**. This picks one random clip from each separate source-time window, keeping chronological order and reserving gaps between clips. For a two-minute source with six clips, it picks one range from each 20-second window. Generate again for new picks; the result is multiple source moments joined together, not one continuous range. It asks before replacing existing selections. It does not analyze action, speech, or highlight quality; review the selections yourself.
4. Use **Preview montage** to watch the sequence. Use each segment's **Edit range** to change timestamps or crop positioning, then save the clip. Preview cuts are approximate browser seeks.
5. Select **Export montage MP4** to download **one combined video**. Add your voiceover afterward in CapCut or another editor.

Montage export joins all saved selections in their listed order. It applies the montage's framing, audio, and resolution to every segment, keeping each segment's saved crop position. Normal individual/ZIP clip exports continue to use each clip's own settings. Retained audio follows the cuts; a source with no audio remains silent.

Changing the target length/count affects the next generation. Editing segment ranges affects the current montage: their combined length must remain between 45 and 55 seconds before export. The source must be longer than the target so footage can be skipped between clips. If there is no room for separated clips, choose a shorter montage, fewer segments, or a longer source; the tool does not repeat footage or pad it to reach the target.

Project JSON now includes montage choices as well as the saved selections. Older projects still open with the default montage choices. Montage exports normalize frame rate to 30 fps, join encoded segments with hard cuts, and may differ by a small fraction of a second due to video/audio packet timing. There are no transitions, voiceover recording, or automatic subject tracking in this release.

## Exports and performance

- **Export MP4** and **Export loaded clip** download individual MP4s. **Export all as ZIP** includes all saved clips, even if there is only one.
- 720p, 1080p, and source resolution are saved per clip. Original framing preserves aspect ratio; other modes crop to 9:16 or 16:9.
- Exports capture fixed settings and lock editing until finished. **Cancel export** stops processing and preserves selections. An interrupted or failed engine is recreated for the next attempt.
- The engine downloads on the first export from the same site, then is reused. Where supported, file-backed input reads the original video without copying it entirely into FFmpeg memory; other cores use a copying fallback.
- ZIP checksums and packaging run in a separate worker, receiving one output at a time. The complete archive still needs browser storage/memory. Large or 4K sources and large batches can exceed device limits. Use smaller batches when needed.
- Frame stepping is approximate. The 24/30/60 fps selector does not guarantee frame-accurate decoding.

## Repository structure

- `index.html`: interface and controls.
- `app.js`: editor events, playback, source loading, and export coordination.
- `js/project.js`: project validation and independent export snapshots.
- `js/export-settings.js`: crop geometry and FFmpeg filters.
- `js/montage.js`, `js/montage-export.js`: automatic segment planning, montage validation, and joined MP4 exports.
- `js/zip.js`, `js/zip-worker.js`, `js/zip-client.js`: incremental ZIP writer and worker messaging.
- `style.css`: responsive styles. The existing logo assets are unchanged.
- `scripts/prepare-engine.sh`: pinned self-hosted FFmpeg assets for local development and deployment.
- `tests/`: regression tests and a synthetic WebM fixtures (a two-second blue video with a test tone and a silent two-minute blue video). It contains no user footage.

## Local development

Use Node.js 22 or newer, npm, Python 3, and Bash:

```sh
npm ci
npm run prepare-engine
python3 -m http.server 8000
```

Open `http://localhost:8000`. Serve over HTTP rather than opening `index.html` directly: JavaScript modules and workers require a server. Engine assets are generated into ignored `vendor/ffmpeg/`; there is no application build step or runtime npm dependency.

## Validation

```sh
npm run check
npm test
npx playwright install --with-deps chromium
npm run test:browser
```

Syntax checks and unit tests cover project validation, export snapshots, crop geometry, and ZIP limits. Python's independent `zipfile` reader verifies checksums, file names, and extracted bytes. Browser regression tests use actual WebM video playback (compatible with bundled Chromium) and a mocked encoding engine to check editor workflows, cancellation, locking, the file-copy fallback, and ZIP-worker integration. They do not replace testing actual encoding on supported devices.

If Chromium is already installed, use `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chromium npm run test:browser`.

## GitHub Pages deployment

Set **Settings → Pages → Source** to **GitHub Actions**. The single deployment workflow at `.github/workflows/deploy-pages.yml` checks the application, copies the interface and `js/` modules into a publish directory, and uses the shared preparation script to download the pinned FFmpeg wrapper/core packages (`0.12.10`). It validates all four engine files before publishing.

The separate `checks.yml` workflow runs syntax, unit, and browser regression tests on pull requests and pushes to `main`. Merging a change into `main` triggers deployment; opening a pull request does not deploy it.

Validate actual MP4 playback, audio, crop positioning, and ZIP imports into CapCut when releasing changes to encoding. Browser codec support varies by device and source format.
