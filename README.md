# Pursuit Level Clip Studio v0.5.0

A local-browser video clip editor for Pursuit Level. Import MP4/MOV/WebM, preview and select multiple clips, edit 9:16/16:9/original framing, mute audio, export MP4 or batch ZIP, and save/reopen project JSON.

## GitHub Pages deployment

Upload the **six root files** (`index.html`, `style.css`, `app.js`, `pursuit-level-logo.png`, `README.md`, `CHANGELOG.md`) to your existing repository. The existing **validated** `.github/workflows/deploy-pages.yml` stays unchanged and downloads/publishes the correct FFmpeg packages for GitHub Pages. Keep Pages source set to GitHub Actions.

**No video or projects are uploaded to a server.** Processing is local.

## Project files

Click **Save project** to download a JSON file that stores clip names, start/end times, output format, crop, audio and resolution settings. **Open project** to select that JSON and then select the matching source video (same name and file size) from your device. JSON does *not* contain video bytes; keep the source video. Loading a new source normally clears the current clip list.

## Exports

- Individual export: MP4. Batch (two or more selected clips): one ZIP containing separate MP4 files.
- 720p and 1080p presets, or source resolution. Original mode uses aspect-preserving scaling, not cropping. Cropped videos use 9:16 or 16:9 output.
- A frame-step choice of 24/30/60 fps offers approximate seeking, not guaranteed frame-accurate decoding.
- ZIP assembly buffers multiple encoded videos in browser memory; start with small clips. Browser FFmpeg can struggle with long or 4K footage.
- FFmpeg engine is downloaded once from your own published GitHub Pages site and works in browser memory. No paid APIs.

## Validation

Syntax and ZIP structure are checked at build time. **Browser functionality requires user validation**, especially the local FFmpeg export and ZIP file import into CapCut.
