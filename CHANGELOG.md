## v0.4.6 — ESM core compatibility (awaiting browser validation)
- Deploy the ESM FFmpeg core instead of the UMD core to match the module worker.
- Add workflow check that fails if the wrong core bundle is published.
- Bump application label and cache query to v0.4.6.
- Preserve video import, crop, and clip-management behavior.

# Changelog

## v0.4.5 — Candidate, not user-verified
- Corrected version label shown in the header.
- Deploy from a clean `publish/` directory rather than repository root.
- Explicitly check that all four FFmpeg binaries and v0.4.5 HTML are in the site artifact before deploying.
- Documented the need to see the **named custom GitHub Actions workflow**, not merely any green Pages deployment.
- Kept video import, clip settings, branding, and output controls unchanged.
