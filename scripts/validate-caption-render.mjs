import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const out =
  process.env.CAPTION_TEST_OUTPUT ||
  new URL('../test-results/captions/', import.meta.url).pathname;
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('ERROR', e.message));
await page.goto(process.env.CAPTION_TEST_ORIGIN || 'http://127.0.0.1:8765');
await page.locator('#file').setInputFiles(out + '/narration.mp4');
await page.waitForFunction(() => document.querySelector('#video').duration > 0);
await page.addScriptTag({ url: '/vendor/ffmpeg/ffmpeg.js' });
await page.evaluate(async () => {
  window.renderEngine = new window.FFmpegWASM.FFmpeg();
  window.renderLogs = [];
  renderEngine.on('log', ({ message }) => renderLogs.push(message));
  const url = (name) => new URL('/vendor/ffmpeg/' + name, location.href).href;
  await renderEngine.load({
    workerURL: url('814.ffmpeg.js'),
    coreURL: url('ffmpeg-core.js'),
    wasmURL: url('ffmpeg-core.wasm')
  });
  await renderEngine.writeFile(
    'input.mp4',
    new Uint8Array(
      await (await fetch(document.querySelector('#video').src)).arrayBuffer()
    )
  );
});
for (const [preset, font] of [
  ['pop', 'anton'],
  ['neon', 'montserrat'],
  ['cinematic', 'bebas'],
  ['pop', 'oswald'],
  ['neon', 'barlow']
]) {
  console.log('RENDER', preset, font);
  const data = await page.evaluate(
    async ({ preset, font, phrase }) => {
      const { defaultCaptions, estimatedWords, PRESETS } = await import(
        '/js/captions/model.js'
      );
      const { prepareCaptionExport, drawCaptions, ensureCaptionFont } =
        await import('/js/captions/render.js');
      const state = {
        ...defaultCaptions(),
        enabled: true,
        style: { preset, ...PRESETS[preset], font },
        segments: [
          {
            start: 0.5,
            end: 3,
            text: 'Drive this amazing car',
            timing: phrase ? 'phrase' : 'estimated',
            words: estimatedWords('Drive this amazing car', 0.5, 3)
          }
        ]
      };
      const clip = {
        start: 0,
        end: 3,
        format: 'original',
        quality: 'source',
        crop: { zoom: 1, x: 50, y: 50 }
      };
      const prepared = await prepareCaptionExport(
        renderEngine,
        state,
        640,
        360
      );
      const filter = await prepared.filter(clip);
      const code = await renderEngine.exec([
        '-i',
        'input.mp4',
        '-t',
        '3',
        '-vf',
        filter,
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-movflags',
        '+faststart',
        '-y',
        'out.mp4'
      ]);
      if (code) throw Error(renderLogs.slice(-15).join('\n'));
      const bytes = await renderEngine.readFile('out.mp4');
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 360;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#182132';
      ctx.fillRect(0, 0, 640, 360);
      drawCaptions(ctx, state, 1.5, 640, 360);
      await prepared.cleanup();
      return {
        bytes: Array.from(bytes),
        preview: canvas.toDataURL().split(',')[1],
        fontLogs: renderLogs.filter((l) => /fontselect/.test(l)).slice(-4)
      };
    },
    { preset, font, phrase: process.env.CAPTION_TEST_PHRASE === '1' }
  );
  await writeFile(`${out}/${preset}-${font}.mp4`, new Uint8Array(data.bytes));
  await writeFile(
    `${out}/${preset}-${font}-preview.png`,
    Buffer.from(data.preview, 'base64')
  );
  console.log(data.fontLogs);
}
await page.evaluate(() => renderEngine.terminate());
await browser.close();
