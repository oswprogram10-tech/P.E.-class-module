'use strict';
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { createHub } = require('../server/classroom-hub');

const listen = server => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const close = server => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
const root = path.resolve(__dirname, '..');
const types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json' };
const secret = 'synthetic-class-credential-for-test';

async function newPage(browser, origin, errors) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, serviceWorkers: 'block' });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await page.waitForFunction(() => appReady);
  await page.locator('#teacherButton').click();
  await page.locator('#newPin').fill('123456');
  await page.locator('#confirmPin').fill('123456');
  await page.locator('#createPinButton').click();
  await page.locator('#teacherContentPanel').waitFor();
  return { context, page };
}

async function openClassroom(page) {
  await page.locator('[data-panel="classroom"]').click();
  await page.locator('#newClassName').waitFor();
}

async function teacherLogin(page, origin) {
  assert.equal(await page.locator('#teacherHubUrl').inputValue(), origin + '/classroom-api');
  assert.equal(await page.locator('#teacherHubUrl').getAttribute('readonly'), '');
  await page.locator('#hubSecret').fill(secret);
  await page.locator('#connectTeacherHub').click();
  await page.waitForFunction(() => Boolean(classroomUI.teacherClient));
}

async function joinCode(teacher, studentId, lessonId, deviceId) {
  await teacher.selectOption('#bindStudent', studentId);
  await teacher.selectOption('#bindLesson', lessonId);
  await teacher.selectOption('#bindDevice', deviceId);
  const priorCode = teacher.locator('#joinPayload');
  const previous = await priorCode.count() ? await priorCode.inputValue() : '';
  await teacher.locator('#createJoinButton').click();
  await teacher.waitForFunction(old => {
    const input = document.querySelector('#joinPayload');
    return input && input.value !== old;
  }, previous);
  return teacher.locator('#joinPayload').inputValue();
}

async function join(page, code) {
  const response = page.waitForResponse(result => result.url().endsWith('/classroom-api/join'));
  await page.locator('#studentJoinPayload').fill(code);
  await page.locator('#joinStudentHub').click();
  assert.equal((await response).status(), 200);
  await page.waitForFunction(() => !!classroomUI.connection && document.querySelector('#classroomStatus')?.textContent === '동기화했어요.', null, { timeout: 8000 })
    .catch(async error => { console.error('Student join status:', await page.locator('#classroomStatus').textContent()); throw error; });
}

async function run() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-classroom-https-'));
  let browser, edge, hub;
  let dropNextCommit = false;
  const errors = [];
  try {
    const key = path.join(temp, 'tls.key'), cert = path.join(temp, 'tls.crt');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
      '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', key, '-out', cert], { stdio: 'ignore' });
    edge = https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (req, res) => {
      const url = new URL(req.url, 'https://localhost');
      if (!url.pathname.startsWith('/classroom-api/')) {
        const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        if (!/^[\w.-]+$/.test(name)) return res.writeHead(404).end();
        try {
          const file = fs.readFileSync(path.join(root, name));
          return res.writeHead(200, { 'Content-Type': types[path.extname(name)] || 'application/octet-stream' }).end(file);
        } catch { return res.writeHead(404).end(); }
      }
      if (!hub?.server.listening) return res.writeHead(503).end();
      const route = url.pathname.slice('/classroom-api'.length);
      const upstream = http.request({
        hostname: '127.0.0.1', port: hub.server.address().port, path: route, method: req.method,
        headers: { ...req.headers, 'x-forwarded-proto': 'https' },
      }, result => {
        if (dropNextCommit && route === '/operations' && result.statusCode === 200) {
          dropNextCommit = false;
          result.resume();
          return result.once('end', () => res.writeHead(502).end());
        }
        res.writeHead(result.statusCode, result.headers);
        result.pipe(res);
      });
      upstream.on('error', () => { if (!res.headersSent && !res.destroyed) res.writeHead(503).end(); });
      req.pipe(upstream);
    });
    await listen(edge);
    const origin = `https://127.0.0.1:${edge.address().port}`;
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
    const { page: teacher } = await newPage(browser, origin, errors);
    await openClassroom(teacher);
    await teacher.locator('#newClassName').fill('검증 학급');
    await teacher.locator('#addClassButton').click();
    const classId = await teacher.locator('#hubClassId').inputValue();
    const config = { origin, dbPath: path.join(temp, 'hub.sqlite'), dataKey: '38'.repeat(32), teacherSecrets: { [classId]: secret } };
    const start = async () => { hub = createHub({ production: config }); await listen(hub.server); };
    await start();

    for (const name of ['가상 학생 A', '가상 학생 B']) {
      const count = await teacher.evaluate(() => classroomUI.state.students.length);
      await teacher.locator('#rosterName').fill(name);
      await teacher.locator('#rosterNumber').fill(String(count + 1));
      await teacher.locator('#addStudentButton').click();
      await teacher.waitForFunction(n => classroomUI.state.students.length === n, count + 1);
    }
    await teacher.locator('#newLessonName').fill('수업');
    await teacher.locator('#newLessonUnit').fill('연습');
    await teacher.locator('#newLessonSport').fill('농구');
    await teacher.locator('#addLessonButton').click();
    await teacher.waitForFunction(() => classroomUI.state.lessons.length === 1);
    await teacher.locator('#newDeviceName').fill('기기');
    await teacher.locator('#addDeviceButton').click();
    await teacher.waitForFunction(() => classroomUI.state.devices.length === 1);
    const ids = await teacher.evaluate(() => ({
      students: classroomUI.state.students.map(s => s.id),
      lesson: classroomUI.state.lessons[0].id,
      device: classroomUI.state.devices[0].id,
    }));
    await teacherLogin(teacher, origin);
    const a = await newPage(browser, origin, errors), b = await newPage(browser, origin, errors);
    for (const { page } of [a, b]) await page.locator('#teacherDialog .close-button').click();

    const outsider = await a.page.evaluate(async () => {
      try { await classroomUI.join({ hubUrl: 'https://other.invalid/classroom-api', capability: 'fixture' }); }
      catch (error) { return error.message; }
    });
    assert.match(outsider, /같은 HTTPS 주소/);
    await join(a.page, await joinCode(teacher, ids.students[0], ids.lesson, ids.device));
    await join(b.page, await joinCode(teacher, ids.students[1], ids.lesson, ids.device));
    await a.page.evaluate(async () => {
      const encrypted = await encryptBlob(new Blob(['synthetic-student-a-clip'], { type: 'video/webm' }), teacherKey);
      const metadata = await encryptMetadata({ ...classroomUI.metadata(), studentName: '가상 학생 A', studentNumber: '1' }, teacherKey);
      await repository.put({ id: 'production-clip-fixture', createdAt: Date.now(), expiresAt: Date.now() + RETENTION_MS,
        durationSeconds: 5, mimeType: 'video/webm', iv: encrypted.iv, ciphertext: encrypted.ciphertext,
        metadataIv: metadata.iv, metadataCiphertext: metadata.ciphertext }, vaultConfig.revision);
      await classroomUI.renderStudent();
    });
    await a.context.setOffline(true);
    await a.page.selectOption('#representativeClip', 'production-clip-fixture');
    await a.page.locator('#includeReflection').uncheck();
    await a.page.locator('#submitRepresentative').click();
    await a.page.waitForFunction(() => classroomUI.state.outbox[0]?.status === 'failed' && !classroomUI.busy);
    dropNextCommit = true;
    await a.context.setOffline(false);
    await a.page.waitForFunction(() => classroomUI.state.outbox[0]?.attempts === 2 && classroomUI.state.outbox[0]?.status === 'failed' && !classroomUI.busy, null, { timeout: 8000 })
      .catch(async error => {
        console.error('Reconnect:', await a.page.evaluate(() => ({
          online: navigator.onLine, status: classroomUI.state.outbox[0]?.status,
          attempts: classroomUI.state.outbox[0]?.attempts, message: document.querySelector('#classroomStatus').textContent,
        })), 'upstream result lost:', !dropNextCommit);
        throw error;
      });
    assert.equal(dropNextCommit, false, 'the backend committed before the lost response');
    await close(hub.server);
    await start();
    await teacher.locator('#teacherDialog .close-button').click();
    await teacher.locator('#teacherButton').click();
    await teacher.locator('#unlockPin').fill('123456');
    await teacher.locator('#unlockButton').click();
    await openClassroom(teacher);
    await teacherLogin(teacher, origin);
    await join(a.page, await joinCode(teacher, ids.students[0], ids.lesson, ids.device));
    const submission = await a.page.evaluate(() => classroomUI.state.submissions[0]);
    assert.equal(submission.status, 'sent');
    assert.equal(submission.clipData, undefined);
    await teacher.locator('#refreshTeacherHub').click();
    await teacher.locator('#hubTeacherItems video').waitFor();
    assert.equal(await teacher.locator('#hubTeacherItems video').count(), 1);

    await join(b.page, await joinCode(teacher, ids.students[1], ids.lesson, ids.device));
    assert.deepEqual(await b.page.evaluate(() => classroomUI.remote), []);
    await teacher.locator('#hubTeacherItems').getByRole('button', { name: '허브 자료 삭제' }).click();
    await teacher.locator('#hubTeacherItems video').waitFor({ state: 'detached' });
    await a.page.locator('#syncClassroomButton').click();
    await a.page.waitForFunction(() => !!classroomUI.state.submissions[0]?.deletedAt);
    assert.equal(await a.page.locator('#submissionList article').count(), 0);
    assert.equal(await a.page.locator('#representativeClip option[value="production-clip-fixture"]').count(), 1);
    assert.deepEqual(errors, []);
    console.log('PASS HTTPS, separate teacher and two student profiles, offline queue, lost response, durable retry, student isolation and withdrawal');
  } finally {
    await browser?.close();
    if (edge?.listening) await close(edge);
    if (hub?.server.listening) await close(hub.server);
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
