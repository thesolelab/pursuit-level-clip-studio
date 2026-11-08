import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {ZipArchive} from '../js/zip.js';

test('Python zipfile independently verifies checksums, UTF-8 names and payloads', async () => {
  const zip = new ZipArchive();
  zip.add('01-clip.mp4', new Uint8Array([0, 1, 2, 255]));
  zip.add('02-🎬.mp4', new TextEncoder().encode('sample data'));
  const bytes = Buffer.from(await zip.finish().arrayBuffer());
  const verify = spawnSync('python3', ['-c', `
import io,sys,zipfile
with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as z:
 assert z.testzip() is None
 assert z.namelist() == ['01-clip.mp4','02-🎬.mp4']
 assert z.read('01-clip.mp4') == bytes([0,1,2,255])
 assert z.read('02-🎬.mp4') == b'sample data'
 assert z.getinfo('01-clip.mp4').date_time == (1980,1,1,0,0,0)
`], {input: bytes});
  assert.equal(verify.status, 0, verify.stderr?.toString() || String(verify.error));
});
test('ZIP limits reject overflow before accepting an entry', () => {
  const zip = new ZipArchive();
  zip.offset = 0xffffffff - 50;
  assert.throws(() => zip.add('clip.mp4', new Uint8Array(1)), /4 GB/);
  assert.equal(zip.directory.length, 0);
});
