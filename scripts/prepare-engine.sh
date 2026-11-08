#!/usr/bin/env bash
# Shared by local development and GitHub Pages; never fetch dependencies at runtime from a CDN.
set -euo pipefail
engine_destination="${1:-vendor/ffmpeg}"
mkdir -p "$engine_destination"
engine_destination="$(cd "$engine_destination" && pwd)"
engine_scratch="$(mktemp -d)"
trap 'rm -rf "$engine_scratch"' EXIT
npm pack @ffmpeg/ffmpeg@0.12.10 --pack-destination "$engine_scratch" --silent
npm pack @ffmpeg/core@0.12.10 --pack-destination "$engine_scratch" --silent
mkdir -p "$engine_scratch/wrapper" "$engine_scratch/core"
tar -xzf "$engine_scratch/ffmpeg-ffmpeg-0.12.10.tgz" -C "$engine_scratch/wrapper"
tar -xzf "$engine_scratch/ffmpeg-core-0.12.10.tgz" -C "$engine_scratch/core"
cp "$engine_scratch/wrapper/package/dist/umd/ffmpeg.js" "$engine_destination/"
cp "$engine_scratch/wrapper/package/dist/umd/814.ffmpeg.js" "$engine_destination/"
cp "$engine_scratch/core/package/dist/esm/ffmpeg-core.js" "$engine_destination/"
cp "$engine_scratch/core/package/dist/esm/ffmpeg-core.wasm" "$engine_destination/"
for file in ffmpeg.js 814.ffmpeg.js ffmpeg-core.js ffmpeg-core.wasm; do
  test -s "$engine_destination/$file"
done
test "$(wc -c < "$engine_destination/ffmpeg-core.wasm")" -gt 30000000
grep -Eq 'export[[:space:]]*(default|\{)' "$engine_destination/ffmpeg-core.js"
echo 'Verified all four self-hosted FFmpeg engine files.'
