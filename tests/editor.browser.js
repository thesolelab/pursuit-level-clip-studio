import {before, after, test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';

const root = new URL('../', import.meta.url);
const fixture = await readFile(new URL('./fixtures/sample.webm', import.meta.url));
let browser, server, origin;
before(async () => {
  server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      const file = new URL('.' + (path === '/' ? '/index.html' : path), root);
      if (!file.href.startsWith(root.href)) throw Error('Invalid path');
      const bytes = await readFile(file);
      const type = path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : path.endsWith('.webm') ? 'video/webm' : 'text/html';
      res.writeHead(200, {'Content-Type': type}); res.end(bytes);
    } catch {res.writeHead(404); res.end();}
  }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined});
});
after(async () => {await browser?.close(); if (server) await new Promise(resolve => server.close(resolve));});

async function editor(t, fakeEngine = false) {
  const context = await browser.newContext({acceptDownloads: true});
  t.after(() => context.close());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  if (fakeEngine) {
    await page.route('**/vendor/ffmpeg/*', route => route.fulfill({status: 200, body: ''}));
    await page.addInitScript(() => {
      window.calls = []; window.writes = []; window.mounts = 0; window.engines = 0;
      window.FFmpegWASM = {FFmpeg: class {
        constructor() {window.engines++; this.handlers = {};}
        on(event, handler) {this.handlers[event] = handler;}
        async load() {}
        async createDir() {}
        async deleteDir() {}
        async mount() {window.mounts++; if (window.noMount) throw Error('unsupported'); return true;}
        async unmount() {}
        async writeFile(name) {window.writes.push(name);}
        async deleteFile() {}
        async exec(args) {
          window.calls.push(args);
          if (window.holdExport) await new Promise((resolve, reject) => {window.releaseExport = resolve; this.reject = reject;});
          for (const progress of [.8, .1, 1]) this.handlers.progress?.({progress});
          return 0;
        }
        async readFile() {return new Uint8Array([0,1,2,3]);}
        terminate() {this.reject?.(Error('terminated'));}
      }};
    });
  }
  await page.goto(origin);
  await page.locator('#file').setInputFiles({name: 'sample.webm', mimeType: 'video/webm', buffer: fixture});
  await page.waitForFunction(() => document.querySelector('#video').videoWidth > 0 && document.querySelector('main').getAttribute('aria-busy') === 'false', null, {timeout:10000});
  await page.locator('#end').fill('00:00:01.000');
  await page.locator('#add').click();
  return page;
}
async function textDownload(download) {
  const chunks = []; for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  return Buffer.concat(chunks);
}
function project(overrides = {}, count = 1) {
  return {type:'pursuit-level-clip-studio', schemaVersion:1,
    source:{name:'sample.webm',size:fixture.length,duration:2,...overrides},
    clips:Array.from({length:count}, (_, i) => ({name:`Restored ${i}`,start:0,end:1,format:'vertical',quality:'720',mute:false,crop:{x:50,y:50,zoom:1}}))};
}
async function openProject(page, raw) {
  await page.locator('#projectFile').setInputFiles({name:'project.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(raw))});
}

test('bad videos and cancelled replacements preserve current clips and pending edits', async t => {
  const page = await editor(t);
  await page.getByRole('button', {name:'Edit range', exact:true}).click();
  await page.locator('#end').fill('00:00:00.750');
  await page.locator('#file').setInputFiles({name:'broken.webm',mimeType:'video/webm',buffer:Buffer.from('invalid')});
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Current work was kept'));
  assert.equal(await page.locator('#count').textContent(), '1 clip');
  assert.equal(await page.locator('#end').inputValue(), '00:00:00.750');
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('#file').setInputFiles({name:'other.webm',mimeType:'video/webm',buffer:fixture});
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Replacement cancelled'));
  assert.match(await page.locator('#filename').textContent(), /^sample.webm/);
  assert.equal(await page.locator('#count').textContent(), '1 clip');
  assert.equal(await page.locator('#end').inputValue(), '00:00:00.750');
});

test('project source mismatches report errors without losing current work', async t => {
  const page = await editor(t);
  await openProject(page, project({duration:10}));
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Source duration differs'));
  assert.equal(await page.locator('#count').textContent(), '1 clip');
  await openProject(page, project({name:'other.webm'}));
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Select the original'));
  await page.locator('#file').setInputFiles({name:'wrong.webm',mimeType:'video/webm',buffer:fixture});
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('does not match'));
  assert.equal(await page.locator('#count').textContent(), '1 clip');
  assert.match(await page.locator('#filename').textContent(), /^sample.webm/);
});

test('project save includes pending loaded-clip edits and reopens them', async t => {
  const page = await editor(t);
  await page.getByRole('button', {name:'Edit range',exact:true}).click();
  await page.locator('#end').fill('00:00:00.750');
  await page.locator('#format').selectOption('landscape');
  await page.locator('#quality').selectOption('1080');
  const downloading = page.waitForEvent('download');
  await page.locator('#saveProject').click();
  const bytes = await textDownload(await downloading);
  const saved = JSON.parse(bytes);
  assert.equal(saved.clips[0].end, .75); assert.equal(saved.clips[0].format, 'landscape'); assert.equal(saved.clips[0].quality, '1080');
  await openProject(page, saved);
  await page.waitForFunction(() => document.querySelector('#status').textContent.includes('Restored 1 clips'));
  assert.equal(await page.locator('#end').inputValue(), '00:00:00.750');
  assert.equal(await page.locator('#quality').inputValue(), '1080');
});

test('export includes pending edits, locks mutations, and packages batch outputs in a worker', async t => {
  const page = await editor(t, true);
  await page.locator('#add').click();
  await page.getByRole('button', {name:'Edit range',exact:true}).first().click();
  await page.locator('#end').fill('00:00:00.500');
  await page.locator('#format').selectOption('landscape');
  await page.evaluate(() => {window.holdExport = true; window.progressValues = [];
    new MutationObserver(() => window.progressValues.push(Number(document.querySelector('#progress').value)))
      .observe(document.querySelector('#progress'), {attributes:true, attributeFilter:['value']});
  });
  const downloading = page.waitForEvent('download');
  await page.locator('#exportAll').click();
  await page.waitForFunction(() => window.calls.length === 1);
  assert.equal(await page.locator('#openProject').isDisabled(), true);
  assert.equal(await page.locator('#update').isDisabled(), true);
  assert.equal(await page.locator('.clip-name').first().isDisabled(), true);
  assert.equal(await page.locator('#cancelExport').isVisible(), true);
  await page.evaluate(() => {window.holdExport = false; window.releaseExport();});
  const download = await downloading;
  assert.match(download.suggestedFilename(), /\.zip$/);
  const bytes = await textDownload(download);
  assert.equal(bytes.readUInt32LE(0), 0x04034b50);
  assert.equal(bytes.readUInt16LE(bytes.length - 12), 2);
  await page.waitForFunction(() => document.querySelector('#cancelExport').hidden);
  const results = await page.evaluate(() => ({calls:window.calls,mounts:window.mounts,writes:window.writes,progress:window.progressValues}));
  assert.equal(results.calls[0][results.calls[0].indexOf('-t')+1], '0.500');
  assert.match(results.calls[0][results.calls[0].indexOf('-vf')+1], /scale=1280:720/);
  assert.equal(results.mounts, 1); assert.deepEqual(results.writes, []);
  for (let i=1; i<results.progress.length; i++) assert.ok(results.progress[i] >= results.progress[i-1], JSON.stringify(results.progress));
  assert.equal(await page.locator('#openProject').isDisabled(), false);
});

test('cancelling export preserves selections and a later export gets a fresh engine', async t => {
  const page = await editor(t, true);
  await page.evaluate(() => {window.holdExport = true;});
  await page.getByRole('button', {name:'Export MP4', exact:true}).click();
  await page.waitForFunction(() => window.calls.length === 1);
  await page.locator('#cancelExport').click();
  await page.waitForFunction(() => document.querySelector('#exportStatus').textContent.includes('Your selections were kept'));
  assert.equal(await page.locator('#count').textContent(), '1 clip');
  await page.evaluate(() => {window.holdExport = false;});
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', {name:'Export MP4',exact:true}).click();
  await downloading;
  assert.equal(await page.evaluate(() => window.engines), 2);
});

test('cores without file-backed input use the copy fallback', async t => {
  const page = await editor(t, true);
  await page.evaluate(() => {window.noMount = true;});
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', {name:'Export MP4',exact:true}).click();
  await downloading;
  assert.deepEqual(await page.evaluate(() => window.writes), ['source.webm']);
});

test('the clip creation limit matches the project import limit', async t => {
  const page = await editor(t);
  page.once('dialog', dialog => dialog.accept());
  await openProject(page, project({}, 500));
  await page.waitForFunction(() => document.querySelector('#count').textContent === '500 clips');
  await page.locator('#add').click();
  assert.equal(await page.locator('#count').textContent(), '500 clips');
  assert.match(await page.locator('#status').textContent(), /at most 500/);
});

test('a project with a different matching source restores only after confirmation', async t => {
  const page = await editor(t);
  const raw = project({name:'other.webm'}); raw.clips[0].format = 'landscape'; raw.clips[0].end = .5;
  await openProject(page, raw);
  await page.waitForFunction(() => !document.querySelector('#chooseProjectSource').hidden);
  assert.equal(await page.locator('#count').textContent(), '1 clip');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#file').setInputFiles({name:'other.webm',mimeType:'video/webm',buffer:fixture});
  await page.waitForFunction(() => document.querySelector('#format').value === 'landscape');
  assert.match(await page.locator('#filename').textContent(), /^other.webm/);
  assert.equal(await page.locator('.clip-name').inputValue(), 'Restored 0');
  assert.equal(await page.locator('#end').inputValue(), '00:00:00.500');
  assert.equal(await page.locator('#chooseProjectSource').isVisible(), false);
});

test('cancelling project opening keeps the old project usable', async t => {
  const page = await editor(t);
  await openProject(page, project({name:'other.webm'}));
  await page.waitForFunction(() => !document.querySelector('#cancelProject').hidden);
  await page.locator('#cancelProject').click();
  assert.equal(await page.locator('#count').textContent(), '1 clip');
  assert.equal(await page.locator('#chooseProjectSource').isVisible(), false);
  assert.equal(await page.locator('#saveProject').isDisabled(), false);
});

test('cancellation during engine download promptly unlocks the workspace', async t => {
  const page = await editor(t, true);
  // Leave HEAD requests pending to model an unavailable engine host.
  await page.route('**/vendor/ffmpeg/*', () => {});
  await page.getByRole('button', {name:'Export MP4',exact:true}).click();
  await page.locator('#cancelExport').click();
  await page.waitForFunction(() => document.querySelector('#cancelExport').hidden, null, {timeout:2000});
  assert.match(await page.locator('#exportStatus').textContent(), /Export cancelled/);
  assert.equal(await page.locator('#openProject').isDisabled(), false);
});
