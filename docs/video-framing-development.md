# Video framing development and validation

The requested v0.6.0 framing label is applied to this development change. The existing repository had already used v0.6.4 for montage/caption work; those features remain included. The release changelog is deliberately unchanged pending owner validation.

## Controls and saved data

Video Framing supports Fill, Fit and Custom Zoom for 9:16 and 16:9. Original output continues to preserve the source shape and hides framing controls. New manual clips default to 1080p; montage resolution keeps its existing independent choice. 720p and Source remain selectable. Source-sized canvas uses the largest output-shaped canvas inside the source dimensions (even-rounded); Fit/Custom scale within that fixed canvas instead of changing the canvas with zoom. Original/Source preserves the source dimensions with even rounding.

Each clip's `crop` object now stores `mode` (`fill`, `fit`, `custom`), `background` (`blur`, `black`), `zoom` (1–3), and `x`/`y` percentages (0–100). Missing mode/background fields in older projects mean Fill/Blur, retaining the old zoom and position. Schema version remains 1 for backward-compatible reads in this application. Older application versions cannot render the new modes correctly.

Fill zoom is relative to filling the frame, retaining legacy behavior. Custom zoom is relative to fitting the full source. Changing mode starts at 100% to avoid carrying zoom between those different meanings; saved clips restore their exact settings. Position 0/50/100 means first edge/center/opposite edge of available travel. Axes without travel are disabled. Reset Position centers only; Reset Framing restores Fill/Blur/100%/center. Fit ignores stored zoom.

Individual and ZIP exports use each saved clip's settings. Montage still applies its shared output aspect, resolution and audio choices, while retaining each segment's mode, background, zoom and position. Captions render above the completed composition.

## Implementation and limits

`js/export-settings.js` owns output dimensions, integer geometry and FFmpeg filters; the canvas and caption exporter consume that geometry. All output dimensions are even for H.264/yuv420p. Fit and Custom use scaling, cropping/padding or split/blur/overlay; their foreground is sharp and undistorted apart from negligible even-pixel rounding. Original and Fill retain the existing export path.

Blur uses the same decoded source frame for both layers, with a slightly enlarged background to prevent blurred edges from exposing black. The background is darkened by 15%. Preview blur runs on a reused small offscreen canvas and follows decoded video frames; it does not create a second video decoder or initialize FFmpeg. The browser blur and FFmpeg box blur have slightly different kernels, so blur texture and color conversion may differ slightly; composition boundaries and foreground positioning share exact output geometry.

1080p blur requires more encoding work and memory than Fill. 4K decoding and long batches can still exceed browser limits; use 720p, Black or shorter clips on slower devices. Custom 300% starts from the fitted source, so very wide footage may still leave background visible. Audio is copied through the existing AAC option or removed with `-an`. All video processing remains local; there are no new services, accounts or paid dependencies.

FFmpeg wrapper/core remain pinned to 0.12.10. Deployment workflow and branding assets are unchanged. This PR does not publish to Pages; publishing occurs after the owner merges it.

## Manual release checklist

1. Import a landscape 1920×1080 gameplay MP4 by picker and drag/drop. Check MOV/WebM supported by your browser too.
2. Keep 9:16 Fill, move Horizontal Position to both ends, and verify no blank space. Try Fill zoom and Reset Position.
3. Switch to Fit/Black: confirm both left/right source edges remain visible. Move the video vertically and reset position.
4. Select Fit/Blur: check the background follows the same moment, is soft/darker, and the foreground stays sharp. Play and seek.
5. Select Custom Zoom at 100%, 150%, 200% and 300%; move both axes and compare with the preview. Switch modes and check the zoom explanation.
6. Make several short clips with different modes/backgrounds/positions. Switch between them, save/reopen the JSON, and verify every setting.
7. Export an individual 1080p clip and a ZIP of mixed modes. Play each MP4 and compare its framing against the preview. Confirm 1080×1920 dimensions and test import into CapCut.
8. Export once with retained speech/audio and once with Remove original audio. Confirm the correct audio track is present/absent.
9. Check 16:9 and Original at 720p/1080p/Source. Verify source shape and captions remain correct.
10. Repeat with 3840×2160 footage, portrait footage, odd source dimensions, a silent WebM and subsecond clips.
11. Generate a montage, change individual segment framing, and export. Check the joined order, backgrounds, caption effects and audio settings. Cancel an export and retry.
12. Test your desktop Chrome and intended mobile device. After merging, check the Pages deployment and live controls. Deployment failures are not evidence of a successful publication.

## Automated and actual-engine evidence

Validation results are recorded in the pull request. Repository tests cover geometry for 1920×1080, 3840×2160, portrait and odd resolutions; legacy project loading, invalid settings, saved per-clip modes, reset/disabled controls, and different filters in one ZIP job. Existing caption, montage and cancellation regressions remain part of the suite.

Actual pinned FFmpeg.wasm checks use synthetic footage with colored edges and a tone, not private user video. A six-clip 1920×1080 batch exercises Fill positioning, Fit/Black, Fit/Blur, Custom 150%/Blur, Custom 300%/Black, and 16:9 at 1080p. Stream inspection checks H.264 dimensions, duration and retained/removed AAC. Separate checks exercise 4K, portrait, odd-dimension input and captions on a mixed-framing montage. These desktop checks do not replace CapCut or mobile-device validation above.

Validation on this branch: syntax checks, 56 unit tests and 35 browser tests passed. All ten real-engine outputs (six in a ZIP, three source edge cases, and one captioned montage) played in Chromium; `ffprobe` confirmed H.264, expected dimensions/durations and audio presence/absence. MOV drag/drop loaded, and desktop/mobile-width controls had no horizontal overflow. The existing deployment packaging steps completed locally with the pinned engine. The current main deployment was successful when inspected; this new framing branch still needs owner merge and a successful Pages run before it is live. CapCut import and physical mobile-device validation remain manual release checks.
