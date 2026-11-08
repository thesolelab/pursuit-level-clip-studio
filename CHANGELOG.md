Pursuit Level Clip Studio — Changelog
v0.5.1 — Project safety and export reliability
- Validate replacement footage and project bounds before clearing current work; warn about unsaved changes.
- Include pending loaded-clip edits in project saves and exports, and apply one consistent 500-clip limit.
- Snapshot export settings, lock conflicting controls, add cancellation, and report overall batch progress.
- Read file-backed input when supported, package ZIPs in a worker, and draw previews on decoded video frames.
- Extract project, geometry, and ZIP modules; format the stylesheet for readability.
- Add syntax, project, ZIP interoperability, and browser regression checks; share the pinned engine preparation script between local development and deployment.
- Remove the obsolete root workflow copy. Preserve existing logo assets and their interface reference.
Known limitations
- Work still requires explicit JSON saves; exit warnings do not provide crash recovery.
- ZIP output still needs space for the complete archive. Large videos and batches can exceed browser limits.
v0.5.0 — Project workflow and editing improvements (2026-11-07)
Status: Validated — all five release tests passed in user testing.
Improvements
- Save clip selections as a portable JSON project file and reopen a project with its matching local source video.
- Export multiple saved clips together as a single ZIP containing MP4 files, while retaining individual MP4 exports.
- Select 720p, 1080p, or source output resolution for each saved clip.
- Navigate footage with a seekable timeline and drag controls for the playhead and selection boundaries.
- Use approximate 24/30/60 fps frame stepping and ±0.1-second adjustments to refine clip boundaries.
- Preserve official Pursuit Level branding and the established self-hosted FFmpeg GitHub Pages deployment.
Confirmed validation
1. Saved a project JSON and reopened it with the source video.
2. Batch-exported multiple clips as one ZIP and extracted the MP4 files.
3. Exported individual clips using both 720p and 1080p presets.
4. Used the timeline and frame-step controls successfully.
5. Confirmed exported MP4 files work in CapCut.
Known limitations
- Project JSON files contain editing settings, not video footage; the matching local source must be selected when reopening.
- Frame stepping uses approximate frame durations rather than frame-accurate decoding.
- FFmpeg.wasm can be slow or exceed browser memory limits with large or 4K sources; compatibility varies by device and codec.
- Project files must be explicitly saved; this release does not establish automatic crash recovery.
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
