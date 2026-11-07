Pursuit Level Clip Studio — Changelog
v0.4.6 — Export milestone validated (2026-11-07)
Status: User-tested and confirmed working in Chrome on GitHub Pages.
- Corrected the FFmpeg.wasm worker/core compatibility by deploying the ES module (ESM) version of ffmpeg-core.js.
- Fixed GitHub Actions workflow packaging and validation; the final workflow successfully publishes the required FFmpeg files.
- Confirmed that local MP4 exports complete successfully.
- Validated all five export checks:
  - Export a 9:16 vertical clip and verify the crop.
  - Adjust crop positioning and export again.
  - Export a 16:9 landscape clip.
  - Export multiple saved clips in a batch.
  - Import an exported MP4 into CapCut.
- Existing local import, drag-and-drop, preview, timestamp selection, clip management, output-format controls, and official Pursuit Level branding remain operational.
Known limitations
- Clip selections remain in browser memory and are lost when the page reloads.
- FFmpeg.wasm may process large/4K videos slowly or exceed available browser memory.
- Batch export downloads separate MP4 files rather than one ZIP archive.
- Browser codec support and encoding performance vary by device and source format.
v0.4.5 — Deployment candidate (superseded)
- Prepared clean GitHub Pages deployment artifact and explicit file checks.
- Deployment and version-label issues discovered during testing; not a validated export release.
v0.4.4 — Deployment automation candidate (superseded)
- Introduced GitHub Actions workflow to obtain and publish FFmpeg engine files.
- Browser export not verified at this stage.
v0.4.3 — Self-hosted engine candidate (superseded)
- Introduced self-hosted FFmpeg paths; package initially lacked engine files.
v0.4.2 / v0.4.1 / v0.4 — Export prototypes (superseded)
- Introduced individual and batch MP4 exports and attempted FFmpeg loader fixes.
- Export initialization failed in browser testing until the later compatibility and deployment corrections.
v0.3.1 / v0.3 — Crop and branding
- Integrated official Pursuit Level logo and repaired the logo asset path.
- Added 9:16 crop preview, positioning, zoom, and per-clip crop settings.
v0.2 — Clip management
- Added drag-and-drop video import, renaming, timestamp editing, and jump-to-clip controls.
- Drag-and-drop confirmed working.
v0.1 — First working build
- Added local video import, preview, timestamp selection, and multiple saved clip selections.
- Initial five feature checks confirmed working.
