import test from 'node:test';
import assert from 'node:assert/strict';
import {autoMontage, montageClips, montageSettings, shuffleMontage} from '../js/montage.js';
import {encodeMontage, montagePartArgs} from '../js/montage-export.js';
import {safeProject} from '../js/project.js';

test('two-minute footage produces a 50-second random montage without fixed endpoints', () => {
  let n = 0;
  const clips = autoMontage(120, {count:6}, () => [.8,.2,.6,.4,.9,.1][(n++)%6]);
  assert.equal(clips.length, 6); assert.ok(clips[0].start > 0); assert.ok(clips.at(-1).end < 120);
  assert.ok(Math.abs(clips.reduce((n,c) => n+c.end-c.start,0)-50)<1e-8);
  const ordered=[...clips].sort((a,b)=>a.start-b.start);
  for (let i=1;i<ordered.length;i++) assert.ok(ordered[i].start>ordered[i-1].end);
  assert.ok(clips.every(c=>c.format==='vertical' && c.mute));
});
test('all supported lengths and segment counts stay in bounds without duplicated footage', () => {
  for (const duration of [45,50,55,60]) for (const count of [2,6,12,15,30]) for (const source of [duration + count,120.1234]) {
    const clips = autoMontage(source,{duration,count,format:'landscape',mute:false}).sort((a,b)=>a.start-b.start);
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
  for (const settings of [{duration:61},{duration:44},{count:1},{count:31},{format:'original'},{quality:'source'},{mute:'false'}]) assert.throws(()=>montageSettings(settings));
});
test('montage export applies one format/audio/size without changing saved selections', () => {
  const source = autoMontage(120,{count:6});
  const result = montageClips(source,{format:'landscape',mute:false,quality:'1080'},120);
  assert.ok(result.every(c=>c.format==='landscape' && !c.mute && c.quality==='1080'));
  result[0].crop.x = 10; assert.equal(source[0].crop.x,50); assert.equal(source[0].format,'vertical');
  assert.throws(()=>montageClips(source.slice(0,2),{},120),/total/);
  source[0].end=121; assert.throws(()=>montageClips(source,{},120),/outside/);
});
test('montage settings round-trip alongside clips, while old project files remain supported', () => {
  const raw={type:'pursuit-level-clip-studio',schemaVersion:1,source:{name:'x.mp4',size:1,duration:120},clips:autoMontage(120,{count:6}),montage:{duration:55,count:8,format:'landscape',mute:false,quality:'1080'}};
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
  const bytes=await encodeMontage(engine,'input',autoMontage(120,{count:6}),{width:1920,height:1080});
  assert.equal(bytes.length,2); assert.equal(calls.length,7);
  assert.match(written[0][1],/^file 'montage_part_0.mp4'\nfile 'montage_part_1.mp4'/);
  assert.equal(calls.at(-1)[calls.at(-1).indexOf('-t')+1],'50.000');
  assert.ok(deleted.includes('montage_final.mp4')); assert.equal(deleted.length,8);
});
test('an encoding error cleans up parts and never attempts a join', async () => {
  let calls=0; const deleted=[];
  const engine={exec:async()=>{calls++;return 1;},deleteFile:async n=>deleted.push(n)};
  await assert.rejects(encodeMontage(engine,'input',autoMontage(120,{count:6}),{width:1920,height:1080}),/segment 1/);
  assert.equal(calls,1);assert.equal(deleted.length,8);
});

test('new random draws yield different selections without changing duration or overlap rules', () => {
  const first = autoMontage(120, {count:6}, () => .2);
  const second = autoMontage(120, {count:6}, () => .8);
  assert.notDeepEqual(first, second);
  assert.ok(Math.min(...first.map(c=>c.start)) < Math.min(...second.map(c=>c.start)));
  for (const random of [() => 0, () => .999999999, Math.random]) {
    for (let n=0;n<100;n++) {
      const clips=autoMontage(120.123,{duration:55,count:12},random).sort((a,b)=>a.start-b.start);
      assert.ok(Math.abs(clips.reduce((sum,c)=>sum+c.end-c.start,0)-55)<1e-8);
      assert.ok(clips[0].start>=0 && clips.at(-1).end<=120.123);
      for(let i=1;i<clips.length;i++) assert.ok(clips[i].start>=clips[i-1].end);
    }
  }
});
test('a source without spare footage cannot silently produce a continuous passage', () => {
  assert.throws(()=>autoMontage(50,{},()=>.8),/extra footage/);
});
test('every generated clip comes from a different source window with a visible gap', () => {
  for (const random of [()=>0,()=>.999999999,Math.random]) {
    for(let attempt=0;attempt<100;attempt++) {
      const clips=autoMontage(120,{count:6},random).sort((a,b)=>a.start-b.start);
      for(let i=0;i<clips.length;i++) {
        assert.ok(clips[i].start>=i*20+.5);
        assert.ok(clips[i].end<=(i+1)*20-.5);
        if(i) assert.ok(clips[i].start-clips[i-1].end>=.999);
      }
      assert.ok(Math.abs(clips.reduce((sum,c)=>sum+c.end-c.start,0)-50)<1e-8);
    }
  }
});

test('generated order includes backward jumps, even if the random shuffle would be identity', () => {
  for(const count of [2,6,12,15,30]) for(const random of [()=>0,()=>.999999999,Math.random]) {
    const clips=autoMontage(120,{count},random);
    assert.ok(clips.some((c,i)=>i && c.start<clips[i-1].start));
    assert.equal(new Set(clips.map(c=>c.start)).size,count);
  }
});
test('shuffling reorders existing clips without changing or dropping their ranges and names', () => {
  const original=[{id:1,name:'A',start:5,end:8},{id:2,name:'B',start:20,end:26},{id:3,name:'C',start:33,end:38}];
  const result=shuffleMontage(original,()=>.999999999);
  assert.deepEqual(original.map(c=>c.id),[1,2,3]);
  assert.deepEqual(result.map(c=>c.id),[2,3,1]);
  assert.deepEqual([...result].sort((a,b)=>a.id-b.id),original);
});

test('news defaults produce 15 shuffled clips averaging 3–4 seconds across 45–60-second targets', () => {
  assert.equal(montageSettings().count,15);
  for(const duration of [45,50,60]) {
    const clips=autoMontage(120,{duration});
    assert.equal(clips.length,15);
    assert.ok(clips.every(c=>c.end-c.start>=2.999 && c.end-c.start<=4.001));
    assert.ok(Math.abs(clips.reduce((sum,c)=>sum+c.end-c.start,0)-duration)<1e-8);
    assert.ok(clips.some((c,i)=>i && c.start<clips[i-1].start));
    assert.equal(montageClips(clips,{duration},120).length,15);
  }
});
test('30 clips and saved legacy counts are supported, while over-limit totals are rejected', () => {
  const raw={type:'pursuit-level-clip-studio',schemaVersion:1,source:{name:'x.mp4',size:1,duration:120},clips:autoMontage(120,{duration:60,count:30}),montage:{duration:60,count:30}};
  const restored=safeProject(JSON.parse(JSON.stringify(raw)));
  assert.equal(restored.clips.length,30);assert.equal(restored.montage.count,30);assert.equal(restored.montage.duration,60);
  raw.montage={duration:50,count:6};assert.equal(safeProject(raw).montage.count,6);
  const tooLong=raw.clips.map(c=>({...c,end:c.end+.1}));
  assert.throws(()=>montageClips(tooLong,{},120),/45–60/);
});
