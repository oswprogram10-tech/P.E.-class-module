'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const releaseIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const required = [
  'web/index.html', 'web/sw.js', 'server/classroom-hub.js',
  'server/tactics-hub.js', 'examples/classroom-hub.Caddyfile', 'scripts/activate-release.cjs',
];

function readFiles(directory, prefix = '') {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) files.push(...readFiles(path.join(directory, entry.name), relative + '/'));
    else if (entry.isFile()) files.push(relative);
    else throw new Error('Release entry is not a regular file or directory: ' + relative);
  }
  return files;
}

function verifyRelease(directory) {
  const root = fs.realpathSync(directory);
  const actual = new Set(readFiles(root));
  if (!actual.delete('manifest.json')) throw new Error('Release manifest is missing');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  if (manifest.format !== 1 || typeof manifest.releaseId !== 'string' ||
      !releaseIdPattern.test(manifest.releaseId) || !Array.isArray(manifest.files)) {
    throw new Error('Invalid release manifest');
  }
  const listed = new Set();
  for (const entry of manifest.files) {
    const relative = entry?.path;
    if (typeof relative !== 'string' || !actual.has(relative) || listed.has(relative) ||
        !Number.isSafeInteger(entry.size) || entry.size < 0 ||
        typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
      throw new Error('Missing or invalid release file: ' + relative);
    }
    const bytes = fs.readFileSync(path.join(root, relative));
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    if (bytes.length !== entry.size || digest !== entry.sha256) throw new Error('Release file differs from manifest: ' + relative);
    listed.add(relative);
  }
  if (listed.size !== actual.size) throw new Error('Unlisted files found in release');
  if (!required.every(file => listed.has(file))) throw new Error('A required release component is missing');
  const worker = fs.readFileSync(path.join(root, 'web/sw.js'), 'utf8');
  if (!worker.includes(`const CACHE_NAME = 'pe-loop-shell-release-${manifest.releaseId}';`)) {
    throw new Error('Service worker cache name does not match release ID');
  }
  return { root, releaseId: manifest.releaseId, fileCount: listed.size };
}

function linkTarget(link) {
  try {
    if (!fs.lstatSync(link).isSymbolicLink()) throw new Error('Current release path must be a symbolic link: ' + link);
    return fs.readlinkSync(link);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function activateRelease(directory, current) {
  const pointer = path.resolve(current);
  const parent = path.dirname(pointer);
  const name = path.basename(pointer);
  const lock = path.join(parent, `.${name}.activation-lock`);
  const history = path.join(parent, `.${name}.activated`);
  fs.mkdirSync(lock, { mode: 0o700 });
  try {
    const previous = linkTarget(pointer);
    const release = verifyRelease(directory);
    if (pointer === release.root || release.root.startsWith(pointer + path.sep)) {
      throw new Error('Release must be outside the mutable current link');
    }
    fs.mkdirSync(history, { mode: 0o700, recursive: true });
    if (!fs.lstatSync(history).isDirectory()) throw new Error('Activation history must be a real directory');
    const record = path.join(history, release.releaseId);
    try {
      fs.writeFileSync(record, JSON.stringify({ target: release.root, attemptedAt: new Date().toISOString() }) + '\n', { mode: 0o600, flag: 'wx' });
    } catch (error) {
      if (error.code === 'EEXIST') throw new Error('Release ID already used. Build a fresh ID for update or rollback: ' + release.releaseId);
      throw error;
    }
    // The staging link lives on the same filesystem as the entry it replaces.
    const next = path.join(lock, 'next');
    fs.symlinkSync(release.root, next, 'dir');
    fs.renameSync(next, pointer);
    return { ...release, pointer, previous };
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
}

if (require.main === module) {
  const [action, directory, pointer, extra] = process.argv.slice(2);
  if (extra || !directory || (action !== 'check' && action !== 'activate') ||
      (action === 'activate' ? !pointer : pointer !== undefined)) {
    throw new Error('Usage: node scripts/activate-release.cjs check <release-dir> | activate <release-dir> <current-link>');
  }
  const result = action === 'check' ? verifyRelease(directory) : activateRelease(directory, pointer);
  console.log(JSON.stringify(result, null, 2));
}
module.exports = { verifyRelease, activateRelease };
