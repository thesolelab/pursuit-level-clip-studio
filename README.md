# Pursuit Level Clip Studio v0.4.2 — FFmpeg loading test

This update addresses the `failed to import ffmpeg-core.js` error seen in v0.4.1. It retains all existing Clip Studio features.

## Update GitHub Pages

Upload these six files to the **root** of your existing repository (not a nested folder), replace the old versions, commit, then hard-refresh using Ctrl+Shift+R.

## Test

Use a short, playable H.264 MP4 and export a saved clip. The loader now downloads FFmpeg core JavaScript and WASM (~30 MB) from jsDelivr, converts them to temporary browser object URLs, then initializes the worker. The **video stays on your device**. The export may still fail if CDN access is restricted or the browser cannot allocate enough memory. If it fails, capture the console error (F12 > Console) and the red message.

## Status

JavaScript syntax checked, but FFmpeg initialization and encoding have not been verified end-to-end in Chrome/GitHub Pages. Do not consider export production-ready until the user confirms both MP4 playback and CapCut import.
