# Pursuit Level — Clip Studio

A browser-based video clipping workspace, hosted on GitHub Pages. All source video processing stays local to the browser.

## v0.4 development build

- Drag/drop or browse for MP4, MOV, WebM video.
- Preview, select precise start and end times, name and manage clips.
- Source and output previews appear together, ahead of Clip Range.
- Pick an output format per clip: 9:16 Shorts (720×1280), 16:9 landscape (1280×720), or original dimensions (no crop, except ensuring even dimensions for H.264).
- Adjust crop X/Y and zoom for 9:16 or 16:9; remove audio per clip.
- Use **Add new clip**, or **Save loaded clip** after changing saved settings.
- Click **Export MP4** on a clip, **Export loaded clip**, or **Export all clips**. Downloads go to your browser's download destination.
- FFmpeg.wasm v0.12.10 single-threaded dependency is downloaded from jsDelivr on first export; **internet is required for this download**, but source video is not uploaded.

## Deploy to GitHub Pages

1. Upload the 6 extracted files into the root of the existing `pursuit-level-clip-studio` repository, replacing the previous files.
2. Settings → Pages → Deploy from a branch → main → / (root).
3. Open the published URL and hard refresh if the old version appears.

## Test order

1. Import a short H.264 MP4 (try under 50 MB), check the logo and drag-and-drop.
2. Change from 9:16 to 16:9 to Original and inspect the preview.
3. Add two saved clips with different formats; load each and verify format, crop, and audio settings.
4. Export a short clip and check it plays in a local player and imports into CapCut.
5. Try Export all; allow multiple downloads if Chrome prompts.

## Limitations

- FFmpeg wasm is significantly slower than desktop FFmpeg; it copies the **entire source file into WASM memory**, even for short clips. Some large or 4K sources will fail. There is no universal reliable maximum size. For a first try, use a short source under 50 MB.
- Some MOV, WebM and MP4 codecs cannot play in every browser. MP4 exports are H.264/AAC (or H.264 only if muted), subject to the encoders compiled into the FFmpeg core.
- Export is **experimental** and cannot be confirmed on live GitHub Pages from this environment; if the FFmpeg worker or encoder fails, keep using v0.3.1 and report the error from the Export Status line or browser console.
- A browser may block repeated download prompts during batch export. It downloads clips individually, not as a ZIP.
- Cropping uses integer/even pixel rounding for H.264, so it can vary slightly from the on-screen preview.
- Saved selections are not persisted across reloads; source files are never sent to a server.
- Hosting application files is free, but the first export depends on jsDelivr CDN availability. To remove that dependency later, vendor the engine assets in the repository (separate milestone).

## Code map

- `index.html`: markup, controls
- `style.css`: branding, layout
- `app.js`: file handling, clip management, previews and FFmpeg export
- `pursuit-level-logo.png`: official logo
- `CHANGELOG.md`: confirmed changes and release candidates
