# Pursuit Level Clip Studio v0.5.1

A local-browser video clip editor for Pursuit Level. Import MP4/MOV/WebM, preview and select multiple clips, edit 9:16/16:9/original framing, mute audio, export MP4 or batch ZIP, and save/reopen project JSON.

**Video and project data stay on your device.** FFmpeg runs in a browser worker; there is no application backend or video upload.

## Editing and projects

- Use **Add new clip** to keep a new range. Use **Edit range** to load an existing clip.
- Changes to a loaded clip are included automatically when you save the project or export. **Save loaded clip** also keeps that clip loaded for further editing or export.
- **Save project** downloads JSON containing the saved clips and their settings, not the source video. Keep the original video on your device. A new range must be added as a clip before saving a project.
- **Open project** restores directly if the matching video is already loaded. Otherwise, choose **Choose project source video** and select the original video. Matching checks use name, file size, duration, and clip bounds.
- Replacement videos are checked before current work is cleared. Unsaved work triggers a confirmation before replacement or leaving the page. These warnings are not automatic backups and browsers may suppress exit warnings.
- Projects support at most 500 clips and imports are limited to 1 MiB of JSON.

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
- `js/zip.js`, `js/zip-worker.js`, `js/zip-client.js`: incremental ZIP writer and worker messaging.
- `style.css`: responsive styles. The existing logo assets are unchanged.
- `scripts/prepare-engine.sh`: pinned self-hosted FFmpeg assets for local development and deployment.
- `tests/`: regression tests and a synthetic two-second blue video with a test tone. It contains no user footage.

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

Syntax checks and unit tests cover project validation, export snapshots, crop geometry, and ZIP limits. Python's independent `zipfile` reader verifies checksums, file names, and extracted bytes. Browser regression tests use actual video playback and a mocked encoding engine to check editor workflows, cancellation, locking, the file-copy fallback, and ZIP-worker integration. They do not replace testing actual encoding on supported devices.

If Chromium is already installed, use `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chromium npm run test:browser`.

## GitHub Pages deployment

Set **Settings → Pages → Source** to **GitHub Actions**. The single deployment workflow at `.github/workflows/deploy-pages.yml` checks the application, copies the interface and `js/` modules into a publish directory, and uses the shared preparation script to download the pinned FFmpeg wrapper/core packages (`0.12.10`). It validates all four engine files before publishing.

The separate `checks.yml` workflow runs syntax, unit, and browser regression tests on pull requests and pushes to `main`. Merging a change into `main` triggers deployment; opening a pull request does not deploy it.

Validate actual MP4 playback, audio, crop positioning, and ZIP imports into CapCut when releasing changes to encoding. Browser codec support varies by device and source format.
