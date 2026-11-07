# Changelog

## v0.4.2 — Export loader test build (awaiting browser confirmation)

- Align FFmpeg loading with official ffmpeg.wasm guidance: fetch the core JavaScript and WASM, then provide origin-compatible Blob URLs to the worker.
- Preserve source import, crop editor, clip selections, output formats and branding.
- Show separate download/initialization status.

## v0.4.1 — Unsuccessful loader test

- Direct cross-origin core URL caused `failed to import ffmpeg-core.js` in user testing.

## v0.4 — Development build

- Three output formats and experimental MP4 export.
