# Pursuit Level Clip Studio v0.4.1 — Export loader fix (test build)

This release is a targeted fix to v0.4's FFmpeg.wasm initialization error. It retains the branded UI, drag-and-drop import, output preview, clip management, crop settings and export controls.

## Changes

- Keeps FFmpeg's class worker in an origin-compatible Blob URL.
- Loads `ffmpeg-core.js` and `ffmpeg-core.wasm` from real HTTPS URLs rather than ephemeral Blob URLs, avoiding a likely failed `importScripts()` path in the worker.
- Shows a more specific initialization error if loading still fails.

## How to update

Extract and upload all six files to the root of your existing GitHub repository. Replace the previous files and commit, then hard-refresh the GitHub Pages website (Ctrl+Shift+R).

## Test

Import a small, browser-playable H.264 MP4, save a short clip, and choose Export loaded clip. Confirm the MP4 downloads, plays and imports into CapCut. If there is still an error, send its exact text and the browser console details.

## Limitations

The fix has passed JavaScript syntax validation, but the FFmpeg engine has **not** been verified end-to-end on a live GitHub Pages site. Network availability and CDN browser policies can still prevent loading. Browser memory and codec restrictions remain, particularly with larger videos. Video files continue to be processed locally; remote CDNs supply only the processing code.
