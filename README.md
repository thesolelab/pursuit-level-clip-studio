# Pursuit Level Clip Studio

A free, browser-based local video clip selection workspace.

## Version 0.1

- Import a local MP4, MOV, or WebM video (playback depends on browser codecs).
- Preview and seek through source footage.
- Mark clip start/end using the current playhead or editable `HH:MM:SS.mmm` fields.
- Preview selected range and save multiple clip selections.
- Load and delete selections.

No upload or server-side processing occurs. Clips are **timestamp selections**, not exported video files, and are cleared when a new source is loaded or the page is refreshed.

## Deployment

Create a public GitHub repository named `pursuit-level-clip-studio`. Upload the files in this folder to the repository root. In **Settings → Pages**, select **Deploy from a branch**, `main`, and `/ (root)`. The site will be available at `https://YOUR-USERNAME.github.io/pursuit-level-clip-studio/` after deployment.

## Roadmap

Clip naming and management → crop positioning → FFmpeg.wasm MP4 export → batch export.
