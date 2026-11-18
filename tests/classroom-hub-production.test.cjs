'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { backup, DatabaseSync } = require('node:sqlite');
const { createHub } = require('../server/classroom-hub');

async function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'classroom-prod-'));
  const cfg = {
    origin: 'https://school.example', dbPath: path.join(dir, 'hub.sqlite'), dataKey: 'ab'.repeat(32),
    teacherSecrets: { ['__proto__']: 'first-synthetic-secret-123', other: 'second-synthetic-secret-456' },
  };
  let hub, now = Date.now();
  const stop = async () => {
    if (hub?.server.listening) await new Promise(resolve => hub.server.close(resolve));
  };
  t.after(async () => { await stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  const start = async () => {
    hub = createHub({ production: cfg, clock: () => now });
    await new Promise((resolve, reject) => {
      hub.server.once('error', reject);
      hub.server.listen(0, '127.0.0.1', resolve);
    });
  };
  function request(route, data, token, headers = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1', port: hub.server.address().port, path: route, method: data ? 'POST' : 'GET',
        headers: { host: 'school.example', origin: cfg.origin, 'x-forwarded-proto': 'https',
          ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      }, res => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body), cache: res.headers['cache-control'] }));
      });
      req.on('error', reject);
      req.end(data ? JSON.stringify(data) : undefined);
    });
  }
  const login = async (classId = '__proto__') => {
    const result = await request('/teacher', { classId, secret: cfg.teacherSecrets[classId] });
    assert.equal(result.status, 200);
    return result.body.token;
  };
  const feedback = { id: 'constructor', kind: 'feedback', payload: { id: '__proto__', lessonId: 'lesson',
    text: 'private-message-xyz', expiresAt: now + 60000 } };
  await start();
  return { dir, cfg, stop, start, request, login, feedback, advance: ms => { now += ms; } };
}

test('production authenticates each class and persists encrypted records and withdrawals across restart', async t => {
  const h = await setup(t);
  const { cfg, request, feedback } = h;
  const credentials = { classId: '__proto__', secret: cfg.teacherSecrets.__proto__ };
  assert.equal((await request('/teacher', credentials, null, { host: 'other.example' })).status, 403);
  assert.equal((await request('/teacher', credentials, null, { origin: 'https://other.example' })).status, 403);
  assert.equal((await request('/teacher', credentials, null, { 'x-forwarded-proto': 'http' })).status, 403);
  assert.equal((await request('/teacher', { ...credentials, secret: cfg.teacherSecrets.other })).status, 403);
  const teacher = await h.login();
  const other = await h.login('other');
  assert.equal((await request('/operations', feedback, teacher)).status, 200);
  assert.deepEqual((await request('/state', null, other)).body.items, []);
  assert.equal((await request('/state', null, teacher)).cache, 'no-store');
  await h.stop();
  assert.equal(fs.readFileSync(cfg.dbPath).includes(Buffer.from('private-message-xyz')), false);
  assert.throws(() => createHub({ production: { ...cfg, dataKey: '01'.repeat(32) } }));

  await h.start();
  assert.equal((await request('/state', null, teacher)).status, 401);
  let renewed = await h.login();
  assert.equal((await request('/state', null, renewed)).body.items[0].text, 'private-message-xyz');
  assert.equal((await request('/operations', feedback, renewed)).status, 200);
  assert.equal((await request('/operations', { ...feedback, payload: { ...feedback.payload, text: 'changed' } }, renewed)).status, 409);
  assert.equal((await request('/operations', { id: 'remove', kind: 'delete', payload: { id: '__proto__' } }, renewed)).status, 200);
  await h.stop();
  await h.start();
  renewed = await h.login();
  assert.deepEqual((await request('/state', null, renewed)).body.items, []);
  assert.equal((await request('/operations', { ...feedback, id: 'late-replay' }, renewed)).status, 409);
});

test('production rolls back failed writes and recovers an encrypted maintenance snapshot', async t => {
  const h = await setup(t);
  const { cfg, request, feedback } = h;
  let teacher = await h.login();
  const db = new DatabaseSync(cfg.dbPath);
  try {
    db.exec(`CREATE TRIGGER simulate_write_failure BEFORE INSERT ON records
      WHEN NEW.bucket = 'operations' BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END`);
    assert.equal((await request('/operations', feedback, teacher)).status, 503);
    assert.deepEqual((await request('/state', null, teacher)).body.items, []);
    db.exec('DROP TRIGGER simulate_write_failure');
    assert.equal((await request('/operations', feedback, teacher)).status, 200);
  } finally {
    db.close();
  }

  await h.stop();
  const snapshot = path.join(h.dir, 'maintenance.sqlite');
  const source = new DatabaseSync(cfg.dbPath, { readOnly: true });
  try { await backup(source, snapshot); } finally { source.close(); }
  assert.equal(fs.readFileSync(snapshot).includes(Buffer.from('private-message-xyz')), false);
  fs.renameSync(snapshot, cfg.dbPath);
  await h.start();
  teacher = await h.login();
  assert.equal((await request('/state', null, teacher)).body.items[0].text, 'private-message-xyz');
  h.advance(60001);
  assert.deepEqual((await request('/state', null, teacher)).body.items, []);
  const cap = await request('/capabilities', { studentId: 'student', lessonId: 'lesson', deviceId: 'device', mode: 'student' }, teacher);
  h.advance(600001);
  assert.equal((await request('/join', { capability: cap.body.capability })).status, 403);
});
