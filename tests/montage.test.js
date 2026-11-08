import test from 'node:test';
import assert from 'node:assert/strict';
import {autoMontage, montageClips, montageSettings} from '../js/montage.js';
import {encodeMontage, montagePartArgs} from '../js/montage-export.js';
import {safeProject} from '../js/project.js';

test('two-minute footage produces a 50-second random montage without fixed endpoints', () => {
  let n = 0;
  const clips = autoMontage(120, {}, () => [.8,.2,.6,.4,.9,.1][n++]);
  assert.equal(clips.length, 6); assert.ok(clips[0].start > 0); assert.ok(clips.at(-1).end < 120);
  assert.ok(Math.abs(clips.reduce((n,c) => n+c.end-c.start,0)-50)<1e-8);
  for (let i=1;i<clips.length;i++) assert.ok(clips[i].start>clips[i-1].end);
  assert.ok(clips.every(c=>c.format==='vertical' && c.mute));
});
test('all supported lengths and segment counts stay in bounds without duplicated footage', () => {
  for (const duration of [45,50,55]) for (const count of [2,6,12]) for (const source of [duration,120.1234]) {
    const clips = autoMontage(source,{duration,count,format:'landscape',mute:false});
    assert.ok(Math.abs(clips.reduce((n,c)=>n+c.end-c.start,0)-duration)<1e-8);
    for (let i=0;i<clips.length;i++) {
      assert.ok(clips[i].end<=source && clips[i].end>clips[i].start);
      if(i) assert.ok(clips[i].start>=clips[i-1].end);
    }
    assert.ok(clips.every(c=>c.format==='landscape' && !c.mute));
  }
});
test('short sources and invalid choices are rejected instead of looping or padding', () => {
  for (const duration of [NaN,Infinity,-1,44.9]) assert.throws(()=>autoMontage(duration,{}));
  for (const settings of [{duration:56},{duration:44},{count:1},{count:13},{format:'original'},{quality:'source'},{mute:'false'}]) assert.throws(()=>montageSettings(settings));
});
test('montage export applies one format/audio/size without changing saved selections', () => {
  const source = autoMontage(120,{});
  const result = montageClips(source,{format:'landscape',mute:false,quality:'1080'},120);
  assert.ok(result.every(c=>c.format==='landscape' && !c.mute && c.quality==='1080'));
  result[0].crop.x = 10; assert.equal(source[0].crop.x,50); assert.equal(source[0].format,'vertical');
  assert.throws(()=>montageClips(source.slice(0,2),{},120),/total/);
  source[0].end=121; assert.throws(()=>montageClips(source,{},120),/outside/);
});
test('montage settings round-trip alongside clips, while old project files remain supported', () => {
  const raw={type:'pursuit-level-clip-studio',schemaVersion:1,source:{name:'x.mp4',size:1,duration:120},clips:autoMontage(120,{}),montage:{duration:55,count:8,format:'landscape',mute:false,quality:'1080'}};
  assert.deepEqual(safeProject(JSON.parse(JSON.stringify(raw))).montage,raw.montage);
  delete raw.montage; assert.equal(safeProject(raw).montage,null);
});
test('parts normalize frame rate and audio layout for concatenation', () => {
  const clip=autoMontage(120,{mute:false})[0];
  const args=montagePartArgs('input',clip,'part.mp4',1920,1080);
  assert.equal(args[args.indexOf('-r')+1],'30'); assert.equal(args[args.indexOf('-ar')+1],'48000'); assert.equal(args[args.indexOf('-ac')+1],'2');
  assert.ok(montagePartArgs('input',{...clip,mute:true},'part.mp4',1920,1080).includes('-an'));
});
test('encoder joins parts in list order, caps duration, and cleans temporary files', async () => {
  const calls=[],deleted=[],written=[];
  const engine={exec:async args=>{calls.push(args);return 0;},writeFile:async(name,bytes)=>written.push([name,new TextDecoder().decode(bytes)]),readFile:async()=>new Uint8Array([1,2]),deleteFile:async name=>deleted.push(name)};
  const bytes=await encodeMontage(engine,'input',autoMontage(120,{}),{width:1920,height:1080});
  assert.equal(bytes.length,2); assert.equal(calls.length,7);
  assert.match(written[0][1],/^file 'montage_part_0.mp4'\nfile 'montage_part_1.mp4'/);
  assert.equal(calls.at(-1)[calls.at(-1).indexOf('-t')+1],'50.000');
  assert.ok(deleted.includes('montage_final.mp4')); assert.equal(deleted.length,8);
});
test('an encoding error cleans up parts and never attempts a join', async () => {
  let calls=0; const deleted=[];
  const engine={exec:async()=>{calls++;return 1;},deleteFile:async n=>deleted.push(n)};
  await assert.rejects(encodeMontage(engine,'input',autoMontage(120,{}),{width:1920,height:1080}),/segment 1/);
  assert.equal(calls,1);assert.equal(deleted.length,8);
});

test('new random draws yield different selections without changing duration or overlap rules', () => {
  const first = autoMontage(120, {}, () => .2);
  const second = autoMontage(120, {}, () => .8);
  assert.notDeepEqual(first, second);
  assert.equal(first[0].start,14); assert.equal(second[0].start,56);
  for (const random of [() => 0, () => .999999999, Math.random]) {
    for (let n=0;n<100;n++) {
      const clips=autoMontage(120.123,{duration:55,count:12},random);
      assert.ok(Math.abs(clips.reduce((sum,c)=>sum+c.end-c.start,0)-55)<1e-8);
      assert.ok(clips[0].start>=0 && clips.at(-1).end<=120.123);
      for(let i=1;i<clips.length;i++) assert.ok(clips[i].start>=clips[i-1].end);
    }
  }
});
test('a source exactly the target length remains fully covered', () => {
  const clips=autoMontage(50,{},()=>.8);
  assert.equal(clips[0].start,0); assert.equal(clips.at(-1).end,50);
  for(let i=1;i<clips.length;i++) assert.equal(clips[i].start,clips[i-1].end);
});
