# Pursuit Level Clip Studio

A free local-first video clip selection workspace hosted on GitHub Pages. No accounts, upload servers, APIs, or subscriptions.

## Development build v0.2

- Open local MP4, MOV, or WebM footage with the file picker **or drag and drop it onto the source area**.
- Preview and seek through video. Native browser playback requires supported codecs; some MOV and MP4 files may not play.
- Mark clip start/end using the playhead or `HH:MM:SS.mmm` timestamps; preview the range.
- Add multiple selections; rename, jump to, delete, and revise their time ranges.
- Desktop and mobile responsive dark Pursuit Level branding, including the six wanted stars.

Clip selections are not output video files. No files are uploaded to a server. Selections are cleared when a new video is loaded or the page is refreshed. The app supports **one source video at a time**. The video may consume browser memory even though it is loaded locally.

## Deploy

Upload `index.html`, `style.css`, `app.js`, `README.md`, and `CHANGELOG.md` to the root of a public GitHub repo named `pursuit-level-clip-studio`. GitHub → Settings → Pages → Deploy from a branch → main → / (root).

For updates, replace the existing root files with the matching files from this version (GitHub's **Add file → Upload files** can overwrite existing filenames when committing).

## Roadmap

9:16 crop preview and positioning → FFmpeg.wasm trimming/crop/mute/export → individual and batch MP4 exports with progress.
