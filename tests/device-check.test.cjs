const { test } = require('node:test');
const assert = require('node:assert/strict');
const D = require('../device-check');
const wall = 1800000000000;
function start() {
  const session = new D.Session();
  session.start({ model: 'Test tablet', heat: 'normal', userAgent: 'Test browser' }, 0, wall);
  return session;
}
function observe(session, now, extra = {}) {
  session.observe({ now, wallTime: wall + now, active: true, visible: true, frameAt: now - 50, frames: 2800, bytes: 8000000, bufferMs: 299900, ...extra });
}
function complete(session) {
  // Simulated monotonic time verifies gating; this is not a real 40-minute run.
  for (let now = 1000; now <= D.DURATION_MS; now += 1000) observe(session, now);
}
function checkAll(session) { for (const id of Object.keys(D.CHECKS)) session.setCheck(id, 'pass'); }

test('forty minutes alone cannot pass without a final heat observation and all teacher checks', () => {
  const session = start(); complete(session);
  assert.equal(session.state.status, 'ready');
  checkAll(session); session.review(wall + D.DURATION_MS);
  assert.equal(session.state.status, 'incomplete');
  session.recordHeat('warm', wall + D.DURATION_MS);
  session.setCheck('offline', 'pending'); session.review(wall + D.DURATION_MS);
  assert.equal(session.state.status, 'incomplete');
  session.setCheck('offline', 'pass'); session.review(wall + D.DURATION_MS);
  assert.equal(session.state.status, 'passed');
  assert.equal(new D.Session(session.snapshot()).state.status, 'passed');
  session.setCheck('controls', 'fail'); session.review(wall + D.DURATION_MS);
  assert.equal(session.state.status, 'failed');
});

test('short runs, backgrounding, camera loss, stale frames and stalled timers never count as forty continuous minutes', () => {
  for (const extra of [{ visible: false }, { active: false }, { frameAt: -5000 }, { frameAt: NaN }, { frameAt: 1001 }]) {
    const session = start(); observe(session, 1000, extra);
    assert.equal(session.state.status, 'interrupted');
    assert.equal(session.state.completedAt, null);
  }
  const stalled = start(); observe(stalled, D.DURATION_MS);
  assert.equal(stalled.state.status, 'interrupted', 'a wall-clock jump must not complete the test');
  const short = start(); observe(short, 1000); checkAll(short); short.recordHeat('normal', wall + 1000);
  short.interrupt('camera stopped'); short.review(wall + 1000);
  assert.equal(short.state.status, 'incomplete');
});

test('reload interrupts a running test; a fresh test resets duration and school checks', () => {
  const session = start(); observe(session, 1000); checkAll(session);
  const restored = new D.Session(session.snapshot());
  assert.equal(restored.state.status, 'interrupted');
  restored.start({ model: 'Test tablet', heat: 'warm' }, 10000, wall + 10000);
  assert.equal(restored.state.elapsedMs, 0);
  assert.ok(Object.values(restored.state.checks).every(value => value === 'pending'));
  observe(restored, 11000); assert.equal(restored.state.elapsedMs, 1000);
  restored.defer(); assert.equal(restored.state.status, 'deferred');
});

test('overheating fails immediately and requires a new test; normal observation cannot erase the issue', () => {
  const session = start(); observe(session, 1000);
  session.recordHeat('hot', wall + 1000);
  assert.equal(session.state.status, 'failed');
  assert.throws(() => session.recordHeat('normal', wall + 2000));
  assert.throws(() => new D.Session().start({ model: 'Test', heat: 'hot' }, 0, wall));
});

test('persisted incomplete or malformed results are not restored as passed', () => {
  const session = start(); complete(session); checkAll(session); session.recordHeat('normal', wall + D.DURATION_MS); session.review(wall + D.DURATION_MS);
  for (const patch of [{ elapsedMs: 5000 }, { completedAt: null }, { thermal: [] }, { checks: {} }]) {
    assert.notEqual(new D.Session({ ...session.snapshot(), ...patch }).state.status, 'passed');
  }
  assert.equal(new D.Session({ schemaVersion: 2, status: 'passed' }).state.status, 'pending');
});

test('bounded heat observations preserve the baseline and buffer metrics do not contain captured data', () => {
  const session = start(); complete(session);
  for (let i = 0; i < 75; i++) session.recordHeat('warm', wall + D.DURATION_MS + i);
  assert.equal(session.state.thermal.length, 50);
  assert.equal(session.state.thermal[0].elapsedMs, 0);
  checkAll(session); session.review(wall + D.DURATION_MS + 100);
  assert.equal(session.state.status, 'passed');
  assert.equal(session.state.peakBytes, 8000000);
  assert.equal(session.state.peakFrames, 2800);
  assert.ok(!/blob|student|image|schoolName/.test(JSON.stringify(session.snapshot())));
});
