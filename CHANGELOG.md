# Changelog

## v0.4.1 — Test build (not yet confirmed)

- Correct FFmpeg worker initialization approach: worker remains a local Blob URL; the core script and WASM use direct HTTPS URLs instead of temporary Blob URLs.
- Improve diagnostics for FFmpeg initialization failures.
- Preserve all existing v0.4 interface and clip editing features.

## v0.4 — Previous development build

- Source/output previews above clip range.
- Three per-clip output formats, crop controls, audio choice and experimental individual/batch MP4 export.
