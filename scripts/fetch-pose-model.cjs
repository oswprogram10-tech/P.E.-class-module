'use strict';
// Only run after the environment allows the official host. TLS/proxy settings are inherited.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const SOURCE = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const MODEL_FILES = ['pose_detector.tflite', 'pose_landmarks_detector.tflite'];
const MAX_ARCHIVE = 30 * 1024 * 1024;

function inspectArchive(filename) {
  const stat = fs.statSync(filename);
  if (stat.size < 1024 || stat.size > MAX_ARCHIVE) throw new Error('Model archive size is invalid.');
  execFileSync('unzip', ['-tqq', filename], { stdio: 'pipe', timeout: 30000 });
  const list = execFileSync('unzip', ['-Z1', filename], { encoding: 'utf8', maxBuffer: 1024 * 1024 }).trim().split(/\r?\n/);
  for (const name of MODEL_FILES) {
    if (list.filter(item => item === name).length !== 1) throw new Error(`Expected exactly one ${name}.`);
    const data = execFileSync('unzip', ['-p', filename, name], { maxBuffer: MAX_ARCHIVE, timeout: 30000 });
    if (data.length < 1024 || data.subarray(4, 8).toString('ascii') !== 'TFL3') throw new Error(`Invalid TFLite identifier in ${name}.`);
  }
  return crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
}
function installModel(root, sourceFile) {
  const digest = inspectArchive(sourceFile);
  const manifestPath = path.join(root, 'docs/pose-assets.json');
  const assetsPath = path.join(root, 'pose-assets.js');
  const output = path.join(root, 'vendor/pose/pose_landmarker_lite.task');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.model?.source !== SOURCE) throw new Error('Unexpected model source in manifest.');
  if (manifest.model.sha256 && manifest.model.sha256 !== digest) throw new Error('Downloaded model differs from the existing SHA-256 pin.');
  const oldAssets = fs.readFileSync(assetsPath, 'utf8');
  const pattern = /(name: 'model', url: '\.\/vendor\/pose\/pose_landmarker_lite\.task', sha256: )(null|'[a-f0-9]{64}')/g;
  const matches = [...oldAssets.matchAll(pattern)];
  if (matches.length !== 1) throw new Error('Cannot safely update the model asset pin.');
  if (matches[0][2] !== 'null' && matches[0][2] !== `'${digest}'`) throw new Error('Existing runtime model pin differs.');
  const newAssets = oldAssets.replace(pattern, `$1'${digest}'`);
  manifest.model.sha256 = digest; manifest.model.status = 'downloaded from official HTTPS source; local SHA-256 pinned';
  // Reinstalling the same pinned artifact must preserve separately reviewed
  // model-card evidence; downloading bytes alone cannot establish a license.
  manifest.model.license ||= 'unverified: official model card and model-specific license require confirmation';
  manifest.model.verification = 'Official HTTPS with inherited proxy and CA trust; structure checks and a locally recorded SHA-256 pin. No provider signature or independently published model digest has been verified.';
  const targets = [[output, fs.readFileSync(sourceFile)], [assetsPath, Buffer.from(newAssets)]];
  if (matches[0][2] === 'null') {
    const serviceWorkerPath = path.join(root, 'sw.js');
    const serviceWorker = fs.readFileSync(serviceWorkerPath, 'utf8');
    const versionPattern = /^(const CACHE_NAME = ['"]pe-loop-shell-v)(\d+)(['"];\s*)$/gm;
    const versions = [...serviceWorker.matchAll(versionPattern)];
    if (versions.length !== 1) throw new Error('Cannot safely identify the service-worker shell cache version.');
    const version = Number(versions[0][2]);
    if (!Number.isSafeInteger(version) || version < 0 || !Number.isSafeInteger(version + 1)) throw new Error('Invalid service-worker shell cache version.');
    const updated = serviceWorker.replace(versionPattern, (_, prefix, _version, suffix) => prefix + (version + 1) + suffix);
    targets.push([serviceWorkerPath, Buffer.from(updated)]);
  }
  targets.push([manifestPath, Buffer.from(JSON.stringify(manifest, null, 2) + '\n')]);
  const originals = new Map(), temporary = [];
  try {
    for (const [target, bytes] of targets) {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      originals.set(target, fs.existsSync(target) ? fs.readFileSync(target) : null);
      const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${crypto.randomUUID()}.tmp`);
      fs.writeFileSync(tmp, bytes, { flag: 'wx', mode: 0o644 }); temporary.push([tmp, target]);
    }
    for (const [tmp, target] of temporary) fs.renameSync(tmp, target);
  } catch (error) {
    for (const [target, old] of originals) {
      if (old === null) { try { fs.unlinkSync(target); } catch {} }
      else { const restore = `${target}.${crypto.randomUUID()}.restore`; fs.writeFileSync(restore, old); fs.renameSync(restore, target); }
    }
    throw error;
  } finally { for (const [tmp] of temporary) { try { fs.unlinkSync(tmp); } catch {} } }
  return digest;
}
function main() {
  if (process.argv.length !== 2) throw new Error('This command accepts no arguments and downloads only the fixed official model URL.');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-pose-download-'));
  try {
    const filename = path.join(dir, 'model.task');
    execFileSync('curl', ['--disable', '--fail', '--silent', '--show-error', '--proto', '=https', '--proto-redir', '=https', '--max-redirs', '0', '--connect-timeout', '20', '--max-time', '120', '--max-filesize', String(MAX_ARCHIVE), '--output', filename, SOURCE], { stdio: 'inherit', timeout: 130000 });
    const digest = installModel(path.resolve(__dirname, '..'), filename);
    console.log(`Official pose model installed; SHA-256 ${digest}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
if (require.main === module) { try { main(); } catch (error) { console.error('Pose model installation failed:', error.message); process.exitCode = 1; } }
module.exports = { inspectArchive, installModel };
