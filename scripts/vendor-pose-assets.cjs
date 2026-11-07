'use strict';
// Usage: node scripts/vendor-pose-assets.cjs /path/to/tasks-vision-0.10.21.tgz
// The tarball is obtained from the npm registry URL in docs/pose-assets.json.
const fs = require('node:fs');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const path = require('node:path');
const archive = process.argv[2];
if (!archive) throw new Error('Provide the official npm tarball path.');
const expected = 'sha512-TuhKH+credq4zLksGbYrnvJ1aLIWMc5r0UHwzxzql4BHECJwIAoBR61ZrqwGOW6ZmSBIzU1t4VtKj8hbxFaKeA==';
const data = fs.readFileSync(archive);
if ('sha512-' + crypto.createHash('sha512').update(data).digest('base64') !== expected) throw new Error('Registry integrity check failed.');
const root = path.resolve(__dirname, '..');
const files = ['package/vision_bundle.mjs', 'package/wasm/vision_wasm_nosimd_internal.js', 'package/wasm/vision_wasm_nosimd_internal.wasm'];
for (const file of files) {
  const bytes = cp.execFileSync('tar', ['-xOf', archive, file], { maxBuffer: 20 * 1024 * 1024 });
  const output = path.join(root, 'vendor/pose', path.basename(file));
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, bytes);
  console.log(path.relative(root, output), crypto.createHash('sha256').update(bytes).digest('hex'));
}
