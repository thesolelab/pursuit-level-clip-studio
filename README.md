# Pursuit Level Clip Studio — v0.4.4 deployment test

**Single-upload source package.** The FFmpeg processing files are **not** in this ZIP. A GitHub Actions deployment automatically downloads pinned versions of the four FFmpeg files, includes them inside the published site under `vendor/ffmpeg/`, and deploys the finished website to GitHub Pages. No individual vendor file uploads are required.

## Installation

1. Extract the ZIP on your computer.
2. Upload **all included files and the `.github` folder** into the root of your existing GitHub repository. Confirm `.github/workflows/deploy-pages.yml` appears in the repository; the workflow is essential.
3. Commit the files to your `main` branch.
4. In your repository's **Settings → Pages**, change **Build and deployment → Source** to **GitHub Actions** (instead of Deploy from a branch).
5. Open the **Actions** tab, select **Deploy Clip Studio with self-hosted FFmpeg**, and, if needed, choose **Run workflow** on `main`.
6. Wait for the workflow to succeed, then open the live GitHub Pages URL and hard-refresh (Ctrl+Shift+R). Try exporting a small H.264 MP4.

The deployed engine is served by GitHub Pages alongside the app. Video processing remains on your own device. This is an **unverified export fix**: deployment and in-browser FFmpeg initialization still need live testing.

If a workflow fails, open **Actions → failed run → deploy** and copy the failing step's log. If the deployed app still fails to export, use Chrome **F12 → Console** to capture the error.

Do not upload `FILES_TO_ADD.txt`, a `vendor` directory, or the individual FFmpeg files. This workflow handles them automatically during deployment.
