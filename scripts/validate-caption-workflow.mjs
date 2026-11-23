import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
const out =
  process.env.CAPTION_TEST_OUTPUT ||
  new URL('../test-results/captions/', import.meta.url).pathname;
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined
});
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
const requests = [];
page.on('request', (r) => requests.push({ method: r.method(), url: r.url() }));
page.on('pageerror', (e) => console.log('ERROR', e.message));
await page.goto(process.env.CAPTION_TEST_ORIGIN || 'http://127.0.0.1:8765');
await page.locator('#file').setInputFiles(out + '/narration.mp4');
await page.waitForFunction(() => document.querySelector('#video').duration > 0);
const project = JSON.parse(
  await readFile(out + '/generated-project.json', 'utf8')
);
project.clips = [
  {
    name: 'Narrated short',
    start: 0.5,
    end: 4,
    format: 'vertical',
    quality: '720',
    mute: false,
    crop: { x: 50, y: 50, zoom: 1 }
  }
];
await page.locator('#projectFile').setInputFiles({
  name: 'captions.json',
  mimeType: 'application/json',
  buffer: Buffer.from(JSON.stringify(project))
});
await page.waitForFunction(
  () => document.querySelectorAll('.caption-row').length > 0
);
const download = page.waitForEvent('download', { timeout: 120000 });
await page.locator('#exportLoaded').click();
const mp4 = await download;
await mp4.saveAs(out + '/workflow-vertical720.mp4');
console.log('EXPORT', await page.locator('#exportStatus').textContent());
await page.locator('#video').evaluate((v) => {
  v.currentTime = 1.5;
});
await page.waitForTimeout(300);
await page.screenshot({ path: out + '/workflow.png', fullPage: true });
console.log(
  'Unexpected network',
  requests.filter((r) => r.method !== 'GET' && r.method !== 'HEAD')
);
// Check the actual exported MP4 with Chromium's media decoder.
const playback = await context.newPage();
await playback.goto(process.env.CAPTION_TEST_ORIGIN || 'http://127.0.0.1:8765');
await playback
  .locator('#file')
  .setInputFiles(out + '/workflow-vertical720.mp4');
await playback.waitForFunction(
  () => document.querySelector('#video').videoWidth === 720
);
await playback.locator('#video').evaluate(async (v) => {
  v.muted = true;
  await v.play();
});
await playback.waitForTimeout(500);
if ((await playback.locator('#video').evaluate((v) => v.currentTime)) < 0.2)
  throw Error('Exported video did not play.');
await playback.close();
await page.selectOption('#format', 'landscape');
await page.locator('#mute').check();
const muted = page.waitForEvent('download', { timeout: 120000 });
await page.locator('#exportLoaded').click();
await (await muted).saveAs(out + '/workflow-landscape720-muted.mp4');
console.log(
  'Muted landscape export completed; retained-audio vertical MP4 played in Chromium.'
);
if (requests.some((r) => !['GET', 'HEAD'].includes(r.method)))
  throw Error('Unexpected upload request.');
await browser.close();
