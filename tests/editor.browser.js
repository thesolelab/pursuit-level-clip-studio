import {before, after, test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';

const root = new URL('../', import.meta.url);
const fixture = await readFile(new URL('./fixtures/sample.webm', import.meta.url));
const longFixture = await readFile(new URL('./fixtures/two-minutes.webm', import.meta.url));
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

async function editor(t, fakeEngine = false, source = fixture) {
  const context = await browser.newContext({acceptDownloads: true});
  t.after(() => context.close());
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, []));
  if (fakeEngine) {
    await page.route('**/vendor/ffmpeg/*', route => route.fulfill({status: 200, body: ''}));
    await page.addInitScript(() => {
      window.calls = []; window.writes = []; window.writeContents = {}; window.mounts = 0; window.engines = 0;
      window.FFmpegWASM = {FFmpeg: class {
        constructor() {window.engines++; this.handlers = {};}
        on(event, handler) {this.handlers[event] = handler;}
        async load() {}
        async createDir() {}
        async deleteDir() {}
        async mount() {window.mounts++; if (window.noMount) throw Error('unsupported'); return true;}
        async unmount() {}
        async writeFile(name, bytes) {window.writes.push(name); if (name.endsWith('.txt')) window.writeContents[name] = new TextDecoder().decode(bytes);}
        async deleteFile() {}
        async exec(args) {
          window.calls.push(args);
          if (window.holdExport || (window.holdJoin && args.includes('concat'))) await new Promise((resolve, reject) => {window.releaseExport = resolve; this.reject = reject;});
          for (const progress of [.8, .1, 1]) this.handlers.progress?.({progress});
          return 0;
        }
        async readFile() {return new Uint8Array([0,1,2,3]);}
        terminate() {this.reject?.(Error('terminated'));}
      }};
    });
  }
  await page.goto(origin);
  await page.locator('#file').setInputFiles({name: 'sample.webm', mimeType: 'video/webm', buffer: source});
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

async function generate(page, count = 6) {
  await page.locator('#montageCount').fill(String(count));
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#generateMontage').click();
  await page.waitForFunction(count => document.querySelector('#count').textContent === `${count} clips`, count);
}

test('auto montage generates six segments totaling 50 seconds and exports one muted vertical MP4', async t => {
  const page = await editor(t, true, longFixture);
  await generate(page);
  assert.match(await page.locator('#montageSummary').textContent(), /50.0 seconds/);
  assert.match(await page.locator('#start').inputValue(),/^00:/);
  await page.evaluate(()=>{window.holdExport = true;});
  let downloads=0;page.on('download',()=>downloads++);
  const downloading=page.waitForEvent('download');
  await page.locator('#exportMontage').click();
  await page.waitForFunction(()=>window.calls.length===1);
  assert.equal(await page.locator('#montageFormat').isDisabled(),true);
  await page.evaluate(()=>{window.holdExport=false;window.releaseExport();});
  const download=await downloading;
  assert.match(download.suggestedFilename(),/-montage.mp4$/);
  await page.waitForFunction(()=>document.querySelector('#cancelExport').hidden);
  const result=await page.evaluate(()=>({calls:window.calls,list:window.writeContents['montage_list.txt']}));
  assert.equal(result.calls.length,7);assert.equal(downloads,1);
  for(const args of result.calls.slice(0,6)) {assert.ok(args.includes('-an'));assert.match(args[args.indexOf('-vf')+1],/scale=720:1280/);}
  assert.match(result.list,/montage_part_0.mp4/);assert.match(result.list,/montage_part_5.mp4/);
  assert.ok(result.calls.at(-1).includes('concat'));
  assert.equal(await page.locator('#progress').getAttribute('value'),'100');
});

test('montage export supports retained audio and 16:9 without overwriting segment settings', async t => {
  const page=await editor(t,true,longFixture);await generate(page);
  await page.locator('#montageFormat').selectOption('landscape');
  await page.locator('#montageAudio').selectOption('keep');
  await page.locator('#montageQuality').selectOption('1080');
  const downloading=page.waitForEvent('download');await page.locator('#exportMontage').click();await downloading;
  const args=await page.evaluate(()=>window.calls[0]);
  assert.match(args[args.indexOf('-vf')+1],/scale=1920:1080/);
  assert.ok(!args.includes('-an'));assert.equal(args[args.indexOf('-c:a')+1],'aac');
  assert.match(await page.locator('.clip-times').first().textContent(),/9:16/);
});

test('short footage is rejected and out-of-range edited totals cannot export', async t => {
  const short=await editor(t,true);
  await short.locator('#generateMontage').click();
  assert.match(await short.locator('#status').textContent(),/at least 50 seconds/);
  assert.equal(await short.locator('#count').textContent(),'1 clip');
  const page=await editor(t,true,longFixture);await generate(page);
  const startSeconds=(await page.locator('#start').inputValue()).split(':').reduce((sum,part)=>sum*60+Number(part),0);
  await page.locator('#end').fill(new Date(Math.round((startSeconds+.5)*1000)).toISOString().slice(11,23));
  await page.locator('#update').click();
  await page.locator('#exportMontage').click();
  assert.match(await page.locator('#exportStatus').textContent(),/total.*45–60/);
  assert.equal(await page.evaluate(()=>window.calls.length),0);
});

test('montage choices and generated segments survive project save and reopen', async t => {
  const page=await editor(t,false,longFixture);
  await page.locator('#montageLength').fill('55');
  await page.locator('#montageFormat').selectOption('landscape');
  await page.locator('#montageAudio').selectOption('keep');
  await generate(page);
  const downloading=page.waitForEvent('download');await page.locator('#saveProject').click();
  const saved=JSON.parse(await textDownload(await downloading));
  assert.equal(saved.clips.length,6);assert.equal(saved.montage.duration,55);assert.equal(saved.montage.mute,false);
  await page.locator('#montageAudio').selectOption('mute');page.once('dialog',dialog=>dialog.accept());
  await openProject(page,saved);
  await page.waitForFunction(()=>document.querySelector('#montageAudio').value==='keep');
  assert.equal(await page.locator('#montageFormat').inputValue(),'landscape');
  assert.match(await page.locator('#montageSummary').textContent(),/55.0 seconds/);
});

test('montage playback previews cuts and restores the editor framing and mute state', async t => {
  const page=await editor(t,false,longFixture);await generate(page);
  await page.locator('#montageFormat').selectOption('landscape');
  await page.locator('#previewMontage').click();
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('segment 1/6'));
  assert.equal(await page.locator('#format').inputValue(),'landscape');
  assert.equal(await page.locator('#video').evaluate(v=>v.muted),true);
  const seconds = value => value.trim().split(':').reduce((sum,part)=>sum*60+Number(part),0);
  const firstEnd=seconds(await page.locator('#end').inputValue());
  const secondStart=seconds((await page.locator('.clip-times').nth(1).textContent()).split(' → ')[0]);
  await page.locator('#video').evaluate((v,time)=>{v.currentTime=time;},firstEnd+.1);
  await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('segment 2/6'));
  assert.ok(await page.locator('#video').evaluate((v,time)=>v.currentTime>=time && v.currentTime<time+2,secondStart));
  await page.locator('#previewMontage').click();
  assert.equal(await page.locator('#format').inputValue(),'vertical');
  assert.equal(await page.locator('#video').evaluate(v=>v.muted),false);
});

test('cancelling during the join keeps every montage selection', async t => {
  const page=await editor(t,true,longFixture);await generate(page);
  await page.evaluate(()=>{window.holdJoin=true;});
  await page.locator('#exportMontage').click();
  await page.waitForFunction(()=>window.calls.length===7);
  await page.locator('#cancelExport').click();
  await page.waitForFunction(()=>document.querySelector('#exportStatus').textContent.includes('Your selections were kept'));
  assert.equal(await page.locator('#count').textContent(),'6 clips');
  assert.equal(await page.locator('#exportMontage').isDisabled(),false);
});


test('montage export asks to save a new draft range instead of silently omitting it', async t => {
  const page=await editor(t,true,longFixture);await generate(page);
  await page.locator('#cancelEdit').click();
  await page.locator('#end').fill('00:00:00.500');
  await page.locator('#exportMontage').click();
  assert.match(await page.locator('#exportStatus').textContent(),/Add your current range/);
  assert.equal(await page.evaluate(()=>window.calls.length),0);
});

test('regenerating montage draws fresh random ranges instead of anchoring the first clip at zero', async t => {
  const page=await editor(t,true,longFixture);
  await page.evaluate(()=>{let seed=123;Math.random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};});
  await generate(page);
  const first=await page.locator('.clip-times').allTextContents();
  assert.notEqual(await page.locator('#start').inputValue(),'00:00:00.000');
  await generate(page);
  assert.notDeepEqual(await page.locator('.clip-times').allTextContents(),first);
  assert.match(await page.locator('#montageSummary').textContent(),/50.0 seconds/);
});


test('the joined montage encodes separate ranges from all six source-time windows', async t => {
  const page=await editor(t,true,longFixture);await generate(page);
  const downloading=page.waitForEvent('download');await page.locator('#exportMontage').click();await downloading;
  const args=await page.evaluate(()=>window.calls.slice(0,6));
  assert.equal(args.length,6);
  const starts=args.map(a=>Number(a[a.indexOf('-ss')+1]));
  assert.ok(starts.some((start,i)=>i && start<starts[i-1]));
  const ordered=[...args].sort((a,b)=>Number(a[a.indexOf('-ss')+1])-Number(b[b.indexOf('-ss')+1]));
  let previousEnd=-1;
  for(let i=0;i<ordered.length;i++) {
    const start=Number(ordered[i][ordered[i].indexOf('-ss')+1]);
    const duration=Number(ordered[i][ordered[i].indexOf('-t')+1]);
    assert.ok(start>=i*20+.5 && start+duration<=(i+1)*20-.499);
    if(i) assert.ok(start-previousEnd>=.999);
    previousEnd=start+duration;
  }
});

test('shuffle order preserves ranges and project/export order includes backward jumps', async t => {
  const page=await editor(t,true,longFixture);await generate(page);
  const before=await page.locator('.clip-times').allTextContents();
  await page.locator('#shuffleMontage').click();
  const after=await page.locator('.clip-times').allTextContents();
  assert.deepEqual([...after].sort(),[...before].sort());
  const saving=page.waitForEvent('download');await page.locator('#saveProject').click();
  const saved=JSON.parse(await textDownload(await saving));
  assert.ok(saved.clips.some((c,i)=>i && c.start<saved.clips[i-1].start));
  const downloading=page.waitForEvent('download');await page.locator('#exportMontage').click();await downloading;
  assert.deepEqual(await page.evaluate(()=>window.calls.slice(0,6).map(a=>Number(a[a.indexOf('-ss')+1]))),saved.clips.map(c=>c.start));
});

test('range preview and timestamps stay beside the player on laptop and mobile layouts', async t => {
  const page=await editor(t);
  for(const viewport of [{width:1366,height:768},{width:390,height:844}]) {
    await page.setViewportSize(viewport);
    await page.getByRole('button',{name:'Edit range',exact:true}).click();
    await page.locator('#preview').click();
    await page.waitForFunction(()=>!document.querySelector('#video').paused);
    const layout=await page.evaluate(()=>{
      const box=id=>{const r=document.getElementById(id).getBoundingClientRect();return {top:r.top,bottom:r.bottom};};
      return {video:box('video'),preview:box('preview'),end:box('end'),crop:document.querySelector('.crop-section').getBoundingClientRect().top,
        range:box('rangeEditor'),height:innerHeight,width:innerWidth,scrollWidth:document.documentElement.scrollWidth};
    });
    assert.ok(layout.video.top>=0 && layout.video.bottom<=layout.height);
    assert.ok(layout.preview.top>=layout.video.bottom && layout.preview.bottom<=layout.height);
    assert.ok(layout.end.bottom<=layout.height);
    assert.ok(layout.range.bottom<layout.crop);
    assert.equal(layout.width,layout.scrollWidth);
    await page.locator('#video').evaluate(v=>v.pause());
  }
  assert.equal(await page.locator('.timeline-tools').getAttribute('open'),null);
  await page.locator('.timeline-tools summary').click();
  assert.equal(await page.locator('#frameBack').isVisible(),true);
  await page.locator('#frameBack').click();
});

test('news montage defaults to 15 clips and exports the 60-second upper boundary', async t => {
  const page=await editor(t,true,longFixture);
  assert.equal(await page.locator('#montageCount').inputValue(),'15');
  assert.equal(await page.locator('#montageLength').getAttribute('max'),'60');
  assert.equal(await page.locator('#montageCount').getAttribute('max'),'30');
  await page.locator('#montageLength').fill('60');await generate(page,15);
  assert.match(await page.locator('#montageSummary').textContent(),/15 saved segments.*60.0 seconds/);
  const saving=page.waitForEvent('download');await page.locator('#saveProject').click();
  const project=JSON.parse(await textDownload(await saving));
  assert.equal(project.montage.count,15);assert.equal(project.montage.duration,60);
  await openProject(page,project);
  await page.waitForFunction(()=>document.querySelector('#montageCount').value==='15');
  const downloading=page.waitForEvent('download');await page.locator('#exportMontage').click();await downloading;
  const calls=await page.evaluate(()=>window.calls);
  assert.equal(calls.length,16);assert.equal(calls.at(-1)[calls.at(-1).indexOf('-t')+1],'60.000');
});
test('30 clips can be generated and exported as one montage', async t => {
  const page=await editor(t,true,longFixture);await generate(page,30);
  assert.match(await page.locator('#montageSummary').textContent(),/30 saved segments.*50.0 seconds/);
  const downloading=page.waitForEvent('download');await page.locator('#exportMontage').click();await downloading;
  assert.equal(await page.evaluate(()=>window.calls.length),31);
});
