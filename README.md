# Pursuit Level Clip Studio v0.4.5

This package contains the app and a GitHub Actions deployment that obtains and publishes the pinned FFmpeg files automatically. It does **not** include the WebAssembly binary.

## Upload and deploy

1. Extract the ZIP. In GitHub, upload `index.html`, `app.js`, `style.css`, `pursuit-level-logo.png`, `README.md`, `CHANGELOG.md`, plus `.github/workflows/deploy-pages.yml` in that **exact nested path**. Note: Windows may hide folders beginning with a dot; turn on View > Show > Hidden items, or copy the `.github` folder via File Explorer.
2. Commit to `main` and set Settings > Pages > Source to **GitHub Actions**.
3. In Actions, look for the workflow named **Deploy Clip Studio with FFmpeg (v0.4.5)**. A green check on any other workflow does not count.
4. Open the published page and verify the header says `v0.4.5`.
5. Before testing export, navigate to `https://YOUR-USERNAME.github.io/pursuit-level-clip-studio/vendor/ffmpeg/ffmpeg.js`. It should display minified JavaScript, not 404. Then attempt short MP4 export.

If the named workflow is absent, the `.github/workflows` file was not uploaded at the correct path. If the named workflow fails, inspect its failing step in Actions.

The FFmpeg initialization/export fix is not yet verified in a live browser. Processing stays local; FFmpeg dependencies are downloaded by GitHub Actions during publishing.
