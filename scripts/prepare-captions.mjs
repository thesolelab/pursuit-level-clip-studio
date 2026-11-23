import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
const out = process.argv[2] || 'vendor/captions';
await mkdir(out, { recursive: true });
await build({
  entryPoints: [
    'node_modules/@huggingface/transformers/dist/transformers.web.js'
  ],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  conditions: ['browser'],
  outfile: `${out}/transformers.js`,
  minify: true
});
for (const ext of ['mjs', 'wasm'])
  await copyFile(
    `node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.${ext}`,
    `${out}/ort-wasm-simd-threaded.jsep.${ext}`
  );

for (const name of [
  'transformers-Apache-2.0.txt',
  'onnxruntime-MIT.txt',
  'onnxruntime-ThirdPartyNotices.txt'
])
  await copyFile('licenses/' + name, out + '/' + name);
