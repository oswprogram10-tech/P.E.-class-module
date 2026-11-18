'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const { X509Certificate, createHash } = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { chromium } = require('playwright');

const repo = path.resolve(__dirname, '..');
const builder = path.join(repo, 'scripts/build-release.cjs');
const classroom = 'fixture-classroom';
const teacherSecret = 'fixture-class-key-for-release-rehearsal';
const tacticsSecret = 'fixture-admin-key-for-release-rehearsal';
const releaseId = label => 'rehearsal-' + label;
const cacheName = label => 'pe-loop-shell-release-' + releaseId(label);

async function port() {
  const server = net.createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const number = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return String(number);
}
async function listening(number, child) {
  for (let i = 0; i < 60; i++) {
    assert.equal(child.exitCode, null, 'service exited before binding port ' + number);
    const opened = await new Promise(resolve => {
      const socket = net.createConnection({ host: '127.0.0.1', port: Number(number) });
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', () => resolve(false));
    });
    if (opened) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Service failed to listen on local port ' + number);
}
function start(command, args, env) {
  const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'ignore', 'pipe'] });
  child.stderr.on('data', chunk => process.stderr.write(chunk));
  child.on('error', error => { console.error(error.message); });
  return child;
}
async function stop(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const ended = once(child, 'exit');
  const watchdog = setTimeout(() => child.kill('SIGKILL'), 8000);
  child.kill('SIGTERM');
  try { await ended; } finally { clearTimeout(watchdog); }
}

function makeReleases(temp) {
  const source = path.join(temp, 'source');
  fs.mkdirSync(source);
  for (const item of fs.readdirSync(repo)) {
    if (/\.(js|css|html|svg|png|webmanifest|LICENSE)$/.test(item) || ['docs', 'examples', 'server', 'vendor'].includes(item)) {
      fs.cpSync(path.join(repo, item), path.join(source, item), { recursive: true });
    }
  }
  const html = fs.readFileSync(path.join(source, 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(source, 'app.js'), 'utf8');
  function build(label, behavior) {
    fs.writeFileSync(path.join(source, 'index.html'), html.replace('<head>', `<head><meta name="release-fixture" content="${behavior}">`));
    fs.writeFileSync(path.join(source, 'app.js'), app + `\nwindow.releaseFixture = ${JSON.stringify(behavior)};\n`);
    const output = path.join(temp, 'releases', releaseId(label));
    execFileSync(process.execPath, [builder, releaseId(label), output, source], { stdio: 'inherit' });
    return output;
  }
  return { initial: build('initial', 'old'), update: build('update', 'new'), rollback: build('rollback', 'old') };
}

async function ready(page, marker) {
  try {
    await page.waitForFunction(() => appReady && navigator.serviceWorker.controller, null, { timeout: 20000 });
  } catch (error) {
    console.error('Page state:', await page.evaluate(async () => {
      const worker = await navigator.serviceWorker.getRegistration();
      return {
        url: location.href, app: typeof appReady === 'undefined' ? null : appReady,
        loaded: document.querySelector('meta[name=release-fixture]')?.content,
        controller: navigator.serviceWorker.controller?.state,
        active: worker?.active?.state, caches: await caches.keys(),
      };
    }));
    throw error;
  }
  await page.waitForFunction(() => document.querySelector('#offlineNotice').dataset.state === 'ready');
  assert.deepEqual(await page.evaluate(() => [document.querySelector('meta[name=release-fixture]').content, window.releaseFixture]), [marker, marker]);
}
async function updateWorker(page, desired) {
  await page.evaluate(async desired => {
    const reg = await navigator.serviceWorker.getRegistration();
    window.transition = new Promise((resolve, reject) => {
      const fail = setTimeout(() => reject(new Error('Worker did not reach ' + desired)), 20000);
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        function observe() {
          if (worker.state === desired) { clearTimeout(fail); resolve(); }
        }
        worker.addEventListener('statechange', observe);
        observe();
      }, { once: true });
    });
    await reg.update();
  }, desired);
  await page.evaluate(() => window.transition);
}
async function unlock(page) {
  await page.locator('#teacherButton').click();
  await page.locator('#unlockPin').fill('123456');
  await page.locator('#unlockButton').click();
  await page.locator('#teacherContentPanel').waitFor({ state: 'visible' });
}
async function saveFixtureClip(page) {
  await page.locator('#teacherButton').click();
  await page.locator('#newPin').fill('123456');
  await page.locator('#confirmPin').fill('123456');
  await page.locator('#createPinButton').click();
  await page.locator('#teacherContentPanel').waitFor({ state: 'visible' });
  await page.locator('#teacherDialog .close-button').click();
  await page.evaluate(() => setDelay(1));
  await page.locator('#cameraButton').click();
  await page.waitForFunction(() => lastDrawnFrame && lastDrawnFrame - frameHistory[0].time >= 5400, null, { timeout: 20000 });
  await page.locator('#openClipButton').click();
  await page.locator('#clipLength').fill('5');
  await page.locator('#clipLength').dispatchEvent('input');
  await page.locator('#studentName').fill('검증용 가상 학생');
  await page.locator('#studentNumber').fill('1');
  await page.locator('#saveClipButton').click();
  await page.waitForFunction(() => !$('clipDialog').open, null, { timeout: 30000 });
  await page.locator('#cameraButton').click();
}
async function verifyClip(page) {
  await unlock(page);
  await page.locator('[data-panel="library"]').click();
  await page.locator('.library-play').first().click();
  await page.waitForFunction(() => document.querySelector('.library-video')?.readyState >= 1);
  const clip = await page.evaluate(async () => {
    const records = await allClips();
    const video = document.querySelector('.library-video');
    return { id: records[0].id, count: records.length, duration: video.duration };
  });
  assert.equal(clip.count, 1);
  assert.ok(clip.duration > 4 && clip.duration <= 5.1);
  await page.locator('#teacherDialog .close-button').click();
  return clip.id;
}

function sendClassroom(page, route, data, token) {
  return page.evaluate(async ({ route, data, token }) => {
    const response = await fetch('/classroom-api/' + route, {
      method: data ? 'POST' : 'GET',
      headers: { ...(data ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    return { status: response.status, body: await response.json() };
  }, { route, data, token });
}
async function login(page) {
  const result = await sendClassroom(page, 'teacher', { classId: classroom, secret: teacherSecret });
  assert.equal(result.status, 200);
  return result.body.token;
}
function operation(id) {
  return {
    id: 'submit-' + id,
    kind: 'submit',
    payload: {
      id, classId: classroom, studentId: 'fixture-student', lessonId: 'fixture-lesson',
      clipId: 'clip-' + id, clipData: 'data:video/webm;base64,YQ==', clipExpiresAt: Date.now() + 3600000, expiresAt: Date.now() + 1800000,
    },
  };
}
async function state(page, auth) {
  const { status, body } = await sendClassroom(page, 'state', null, auth);
  assert.equal(status, 200);
  return body.items.map(item => item.id).sort();
}

async function openActivated(context, origin, marker, label) {
  const page = await context.newPage();
  await page.goto(origin);
  await ready(page, marker);
  assert.deepEqual(await page.evaluate(() => caches.keys()), [cacheName(label)]);
  return page;
}

async function run() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-release-rehearsal-'));
  const current = path.join(temporary, 'current');
  let browser, proxy, hubs = [];
  try {
    const releases = makeReleases(temporary);
    const activator = path.join(releases.initial, 'scripts/activate-release.cjs');
    const activate = release => execFileSync(process.execPath, [activator, 'activate', release, current], { encoding: 'utf8' });
    activate(releases.initial);
    const numbers = new Set();
    while (numbers.size < 3) numbers.add(await port());
    const [appPort, classroomPort, tacticsPort] = numbers;
    const origin = `https://127.0.0.1:${appPort}`;
    const cert = path.join(temporary, 'cert.pem'), key = path.join(temporary, 'key.pem');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1',
      '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', key, '-out', cert], { stdio: 'ignore' });
    const spki = new X509Certificate(fs.readFileSync(cert)).publicKey.export({ type: 'spki', format: 'der' });
    const fingerprint = createHash('sha256').update(spki).digest('base64');
    const data = path.join(temporary, 'private');
    fs.mkdirSync(data, { mode: 0o700 });
    const teacherFile = path.join(data, 'teachers.json');
    fs.writeFileSync(teacherFile, JSON.stringify({ [classroom]: teacherSecret }), { mode: 0o600 });
    const env = {
      PE_HUB_HOST: origin, PE_WEB_ROOT: path.join(current, 'web'), PE_HUB_PORT: classroomPort, PE_TACTICS_PORT: tacticsPort,
      PE_HUB_MODE: 'production', PE_HUB_ORIGIN: origin, PE_HUB_DB: path.join(data, 'classroom.sqlite'),
      PE_HUB_DATA_KEY: '27'.repeat(32), PE_HUB_TEACHER_SECRETS_FILE: teacherFile,
      PE_TACTICS_PUBLIC_ORIGIN: origin, PE_TACTICS_DB: path.join(data, 'tactics.sqlite'), PE_TACTICS_ADMIN_TOKEN: tacticsSecret,
      PE_TACTICS_LLM_MODEL: '', XDG_DATA_HOME: data, XDG_CONFIG_HOME: data,
    };
    async function restartHubs() {
      await Promise.all(hubs.map(stop));
      hubs = ['classroom', 'tactics'].map(name => start(process.execPath, [path.join(current, 'server', name + '-hub.js')], env));
      await Promise.all([listening(classroomPort, hubs[0]), listening(tacticsPort, hubs[1])]);
    }
    const caddy = path.join(temporary, 'Caddyfile');
    const template = fs.readFileSync(path.join(current, 'examples/classroom-hub.Caddyfile'), 'utf8');
    fs.writeFileSync(caddy, '{\n admin off\n auto_https disable_redirects\n}\n' +
      template.replace('{$PE_HUB_HOST} {', '{$PE_HUB_HOST} {\n tls ' + cert + ' ' + key));
    await restartHubs();
    proxy = start(process.env.CADDY_BIN || 'caddy', ['run', '--adapter', 'caddyfile', '--config', caddy], env);
    await listening(appPort, proxy);

    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
      args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
        '--ignore-certificate-errors-spki-list=' + fingerprint],
    });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    let page = await context.newPage();
    await page.goto(origin);
    const deferredServices = await page.evaluate(async secret => {
      const headers = { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' };
      const request = { method: 'POST', headers, body: '{}' };
      return Promise.all(['/tactics/v1/suggestions', '/tactics/v1/training-examples'].map(async route => (await fetch(route, request)).status));
    }, tacticsSecret);
    assert.deepEqual(deferredServices, [404, 404], 'the school proxy serves board sharing only');
    console.log('PASS school HTTPS excludes AI and training routes');
    await page.waitForFunction(async () => (await navigator.serviceWorker.getRegistration())?.active?.state === 'activated');
    await page.close();
    page = await openActivated(context, origin, 'old', 'initial');
    for (const privatePath of ['/manifest.json', '/server/classroom-hub.js', '/docs/tactics-pilot-status.json']) {
      assert.equal(await page.evaluate(async route => (await fetch(route)).status, privatePath), 404);
    }
    await saveFixtureClip(page);
    const fromInstall = await verifyClip(page);
    let auth = await login(page);
    const keep = operation('kept-submission'), withdraw = operation('withdrawn-submission');
    for (const op of [keep, withdraw]) assert.equal((await sendClassroom(page, 'operations', op, auth)).status, 200);
    const share = await page.evaluate(async secret => {
      const board = TacticsBoard.createBoard(), team = TacticsBoard.addTeam(board);
      TacticsBoard.addToken(board, { teamId: team.id, x: 160, y: 150 });
      return TacticsSharing.create(location.origin, secret, board);
    }, tacticsSecret);
    console.log('PASS clean deployment, HTTPS and service-worker cache, PIN, WebM, private runtime files and both services');

    activate(releases.update);
    await restartHubs();
    const wrongAsset = path.join(releases.update, 'web/app.js');
    const expected = fs.readFileSync(wrongAsset);
    try {
      // Simulate one successful HTTP response containing the previous version's bytes during worker install.
      fs.copyFileSync(path.join(releases.initial, 'web/app.js'), wrongAsset);
      assert.equal(await page.evaluate(async () => (await fetch('/app.js?check-mixed')).status), 200);
      await updateWorker(page, 'redundant');
      assert.equal(await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()).waiting), false);
      await page.reload(); await ready(page, 'old');
    } finally { fs.writeFileSync(wrongAsset, expected); }
    console.log('PASS mixed asset rejected by content integrity even with HTTP 200; existing app preserved');

    await updateWorker(page, 'installed');
    const held = await context.newPage();
    await held.goto(origin);
    await ready(held, 'old');
    await page.close();
    assert.ok(await held.evaluate(async () => (await navigator.serviceWorker.getRegistration()).waiting));
    await held.close();
    page = await openActivated(context, origin, 'new', 'update');
    assert.equal(await verifyClip(page), fromInstall);
    auth = await login(page);
    assert.deepEqual(await state(page, auth), ['kept-submission', 'withdrawn-submission']);
    assert.equal((await sendClassroom(page, 'operations', {
      id: 'withdraw-op', kind: 'delete', payload: { id: 'withdrawn-submission', classId: classroom },
    }, auth)).status, 200);
    assert.deepEqual(await page.evaluate(async share => {
      const { board, version } = await TacticsSharing.read(share);
      assertVersion(version);
      board.tokens[0].x = 278;
      const result = await TacticsSharing.publish({ ...share, version }, board);
      return { version: result.version };
      function assertVersion(value) { if (value !== 1) throw new Error('Share changed during update'); }
    }, share), { version: 2 });

    activate(releases.rollback);
    await restartHubs();
    await updateWorker(page, 'installed');
    await page.close();
    page = await openActivated(context, origin, 'old', 'rollback');
    await context.setOffline(true);
    await page.reload(); await ready(page, 'old');
    assert.equal(await verifyClip(page), fromInstall);
    await context.setOffline(false);
    auth = await login(page);
    assert.deepEqual(await state(page, auth), ['kept-submission']);
    assert.equal((await sendClassroom(page, 'operations', { ...withdraw, id: 'delayed-submit' }, auth)).status, 409);
    assert.deepEqual(await page.evaluate(async share => {
      const latest = await TacticsSharing.read(share);
      return { version: latest.version, x: latest.board.tokens[0].x };
    }, share), { version: 2, x: 278 });
    const checkReuse = require('node:child_process').spawnSync(process.execPath, [activator, 'activate', releases.initial, current], { encoding: 'utf8' });
    assert.notEqual(checkReuse.status, 0);
    assert.match(checkReuse.stderr, /Release ID already used/);
    assert.equal(fs.realpathSync(current), releases.rollback);
    console.log('PASS update and rollback with fresh caches, offline original PIN and clip, retained server records, revocation and newer shared board');
  } finally {
    await browser?.close();
    await Promise.all([proxy, ...hubs].map(stop));
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
