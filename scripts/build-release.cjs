'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const [id, destination, source] = process.argv.slice(2);
const root = source ? path.resolve(source) : path.resolve(__dirname, '..');
if (![4, 5].includes(process.argv.length) || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(id || '') || !destination) {
  throw new Error('Usage: node scripts/build-release.cjs <release-id> <new-output-directory> [source-directory]');
}
const output = path.resolve(destination);
const parent = path.dirname(output);
fs.mkdirSync(parent, { recursive: true });
fs.mkdirSync(output, { mode: 0o700 });
const staging = fs.mkdtempSync(path.join(parent, '.release-staging-'));
const reservation = fs.lstatSync(output);
const files = new Set();
function add(source, target = source, sourceRoot = root) {
  if (path.isAbsolute(source) || source.split('/').includes('..') || path.isAbsolute(target) || target.split('/').includes('..')) throw new Error('Invalid package path');
  const input = path.join(sourceRoot, source);
  const stat = fs.lstatSync(input);
  if (!stat.isFile() || fs.realpathSync(input) !== input) throw new Error('Expected regular source file: ' + source);
  const name = path.join(staging, target);
  if (files.has(target)) return;
  fs.mkdirSync(path.dirname(name), { recursive: true });
  fs.copyFileSync(input, name, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(name, 0o644);
  files.add(target);
}
try {
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const match = sw.match(/const APP_SHELL = (\[[^\n]+\]);/);
  if (!match) throw new Error('Cannot parse app shell');
  const literal = match[1].slice(1, -1).trim();
  if (!/^(?:'[^'\\]*'\s*,\s*)*'[^'\\]*'\s*,?$/.test(literal)) throw new Error('Invalid shell literal');
  const shell = [...literal.matchAll(/'([^']*)'/g)].map(item => item[1]);
  if (!Array.isArray(shell) || !shell.includes('./index.html')) throw new Error('Invalid app shell');
  for (const asset of shell) {
    if (asset === './') continue;
    if (typeof asset !== 'string' || !/^\.\/(?:[a-zA-Z0-9._-]+\/)*[a-zA-Z0-9._-]+$/.test(asset) || asset.split('/').includes('..')) throw new Error('Invalid shell path');
    add(asset.slice(2), 'web/' + asset.slice(2));
  }
  add('sw.js', 'web/sw.js');
  const releaseSw = sw.replace(/const CACHE_NAME = '[^']+';/, `const CACHE_NAME = 'pe-loop-shell-release-${id}';`);
  if (releaseSw === sw) throw new Error('Cannot set cache version');
  const integrity = {};
  for (const asset of shell) {
    const relative = asset === './' ? 'index.html' : asset.slice(2);
    const bytes = fs.readFileSync(path.join(staging, 'web', relative));
    integrity[asset] = 'sha256-' + crypto.createHash('sha256').update(bytes).digest('base64');
  }
  const request = "APP_SHELL.map(path => new Request(path, { cache: 'reload' }))";
  if (!releaseSw.includes(request)) throw new Error('Cannot enforce shell integrity');
  const protectedSw = releaseSw.replace(request, "APP_SHELL.map(path => new Request(path, { cache: 'reload', integrity: RELEASE_INTEGRITY[path] }))");
  fs.writeFileSync(path.join(staging, 'web/sw.js'), 'const RELEASE_INTEGRITY = ' + JSON.stringify(integrity) + ';\n' + protectedSw);
  for (const item of ['vendor/pose/LICENSE', 'vendor/pose/vision_bundle.mjs', 'vendor/pose/vision_wasm_nosimd_internal.js', 'vendor/pose/vision_wasm_nosimd_internal.wasm', 'vendor/pose/pose_landmarker_lite.task', 'vendor/wllama-v3/LICENSE', 'vendor/hf-tokenizers/LICENSE', 'vendor/qwen-tokenizer/LICENSE', 'vendor/qwen-tokenizer/NOTICE', 'vendor/noble-hashes/LICENSE', 'qrcode-generator.LICENSE', 'docs/soccer-tactics-reference.md', 'docs/tactics-ai-research-catalog.md']) add(item, 'web/' + item);
  for (const item of ['server/classroom-hub.js', 'server/classroom-hub-store.js', 'server/tactics-hub.js', 'server/tactics-llm.js', 'server/tactics-pilot-loader.js', 'server/tactics-relevance.js', 'server/tactics-knowledge.json', 'tactics-board.js', 'examples/classroom-hub.Caddyfile']) add(item);
  for (const item of ['scripts/activate-release.cjs', 'docs/release-runbook.md']) {
    add(item, item, path.resolve(__dirname, '..'));
  }
  const manifestPath = 'docs/tactics-pilot-status.json';
  add(manifestPath);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, manifestPath)));
  for (const bundle of manifest.acceptedResearchBundles || []) {
    for (const name of [bundle.caseFile, bundle.linkFile]) {
      if (typeof name !== 'string' || path.basename(name) !== name) throw new Error('Invalid pilot data path');
      add('docs/' + name);
    }
  }
  require(path.join(staging, 'server/tactics-llm')).createLocalAdvisor();
  const entries = [...files].sort().map(name => {
    const bytes = fs.readFileSync(path.join(staging, name));
    return { path: name, size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  });
  fs.writeFileSync(path.join(staging, 'manifest.json'), JSON.stringify({ format: 1, releaseId: id, files: entries }, null, 2) + '\n', { flag: 'wx' });
  function makeReleaseReadable(dir) {
    fs.chmodSync(dir, 0o755);
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const child = path.join(dir, item.name);
      if (item.isDirectory()) makeReleaseReadable(child);
      else fs.chmodSync(child, 0o644);
    }
  }
  makeReleaseReadable(staging);
  const current = fs.lstatSync(output);
  if (!current.isDirectory() || current.ino !== reservation.ino || current.dev !== reservation.dev || fs.readdirSync(output).length) throw new Error('Output reservation changed');
  fs.renameSync(staging, output);
  console.log(`Built ${id}: ${entries.length} files at ${output}`);
} catch (error) {
  fs.rmSync(staging, { recursive: true, force: true });
  try { const current = fs.lstatSync(output); if (current.isDirectory() && current.ino === reservation.ino && current.dev === reservation.dev) fs.rmdirSync(output); } catch {}
  throw error;
}
