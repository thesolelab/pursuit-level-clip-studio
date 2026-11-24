// Optional slow, real-engine smoke test. Run against a prepared local server.
import { chromium } from 'playwright';
import { mkdir, copyFile, readFile } from 'node:fs/promises';
const out =
  process.env.CAPTION_TEST_OUTPUT ||
  new URL('../test-results/captions/', import.meta.url).pathname;
await mkdir(out, { recursive: true });
await copyFile(
  process.env.CAPTION_TEST_SOURCE ||
    new URL('../tests/fixtures/narration.mp4', import.meta.url),
  out + '/narration.mp4'
);
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined
});
const context = await browser.newContext({
  acceptDownloads: true,
  ignoreHTTPSErrors: process.env.CAPTION_TEST_IGNORE_HTTPS_ERRORS === '1'
});
const page = await context.newPage();
const uploads = [];
page.on('request', (r) => {
  if (!['GET', 'HEAD'].includes(r.method())) uploads.push(r.url());
});
page.on('requestfailed', (r) =>
  console.log('REQUEST FAILED', r.url(), r.failure())
);
page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 300));
});
await page.goto(process.env.CAPTION_TEST_ORIGIN || 'http://127.0.0.1:8765');
await page.locator('#file').setInputFiles(out + '/narration.mp4');
await page.waitForFunction(() => document.querySelector('#video').duration > 0);
await page.locator('#generateCaptions').click();
let last = '';
const deadline = Date.now() + 600000;
while (Date.now() < deadline) {
  const text = await page.locator('#captionStatus').textContent();
  if (text !== last) {
    console.log(text);
    last = text;
  }
  if (await page.locator('#cancelCaptions').isHidden()) break;
  await page.waitForTimeout(1000);
}
if (Date.now() >= deadline) throw Error('Transcription timed out.');
console.log('ROWS', await page.locator('.caption-row').count());
await page.screenshot({ path: out + '/editor.png', fullPage: true });
if (!(await page.locator('.caption-row').count()))
  throw Error('No transcript generated: ' + last);
await page.waitForFunction(() =>
  Number.isFinite(document.querySelector('#captionAudio').duration)
);
const audioDuration = await page
  .locator('#captionAudio')
  .evaluate((a) => a.duration);
const sourceDuration = await page.locator('#video').evaluate((v) => v.duration);
if (Math.abs(audioDuration - sourceDuration) > 0.1)
  throw Error(
    'Extracted audio preview duration differs from the selected range.'
  );
await page.locator('#captionAudio').evaluate(async (a) => {
  a.muted = true;
  await a.play();
});
await page.waitForTimeout(300);
if ((await page.locator('#captionAudio').evaluate((a) => a.currentTime)) < 0.1)
  throw Error('Extracted audio preview could not play.');
console.log('Local extracted audio preview decoded and played.', audioDuration);
const save = page.waitForEvent('download');
await page.locator('#saveProject').click();
await (await save).saveAs(out + '/generated-project.json');
if (process.env.CAPTION_EXPECTED_SPEECH_START) {
  const project = JSON.parse(
    await readFile(out + '/generated-project.json', 'utf8')
  );
  const onset = project.captions.segments[0]?.start,
    expected = Number(process.env.CAPTION_EXPECTED_SPEECH_START);
  if (!Number.isFinite(onset) || Math.abs(onset - expected) > 0.2)
    throw Error(
      `Caption onset ${onset} differs from expected speech onset ${expected}.`
    );
  console.log('Caption onset matches the known speech onset:', onset);
}

if (uploads.length)
  throw Error('Unexpected upload requests: ' + uploads.join(', '));
console.log('No audio/transcript upload requests observed.');
await browser.close();
