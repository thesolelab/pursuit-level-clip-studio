# Pursuit Level Clip Studio

Free, self-hosted, browser-based video clip selection workspace. No sign-in, cloud upload, database or subscriptions.

## v0.3 development build

- Import one local MP4, MOV or WebM video using file picker or drag and drop (codec support depends on browser).
- Preview and seek, mark precise start/end times, preview the range, save multiple clips, rename, jump, delete and edit selections.
- Live 9:16 vertical crop preview using browser canvas. Adjust horizontal position, vertical position and zoom (1.00×–2.00×). Zoom makes both axes adjustable even when the source's native aspect ratio otherwise locks one axis.
- Each saved clip stores its own crop settings **in page memory**. Click **Edit range** on a clip to recall them, and **Save loaded clip** to retain edits.
- Official Pursuit Level sunset six-star logo is provided under `pursuit-level-logo.png`.

## Current limitations

**This version does not export, render, or download clips.** The 9:16 canvas is a preview, not a transformed video file. All clips/settings are cleared on refresh, and importing another file clears the selections. Only one source video is loaded at a time. The exact crop framing may differ from eventual FFmpeg exports until export processing is integrated and tested.

Preview performance and supported codecs depend on browser/device. Large/4K videos may require substantial memory. No source footage leaves the browser.

## GitHub Pages setup/update

Upload **all** root files and the `assets` folder to the repository root (not an enclosing `pursuit-level-clip-studio-v0.3` folder). Result:

```
index.html
style.css
app.js
README.md
CHANGELOG.md
assets/
  pursuit-level-logo.webp
```

Settings → Pages → Deploy from a branch → `main` → `/ (root)`.

On updates, replace the existing root files, add the new `pursuit-level-logo.png`, and commit. If using GitHub's browser uploader, drag the *contents* of the extracted package (including the `assets` folder) into the upload area. Verify the logo shows after GitHub Pages deployment.

## Next

Integrate FFmpeg.wasm for local MP4 trimming, cropping, optional mute and individual/batch export with processing progress and browser limits.
