const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../classroom-model.js');
const H = require('../shot-history.js');

function setup() {
  const state = M.createState();
  const classroom = M.add(state, 'classes', { name: 'class' });
  const student = M.add(state, 'students', { classId: classroom.id, name: 'student' });
  const lesson = M.add(state, 'lessons', { classId: classroom.id, name: 'lesson', unit: 'unit', sport: 'basketball' });
  const device = M.add(state, 'devices', { classId: classroom.id, name: 'device' });
  const binding = { classId: classroom.id, studentId: student.id, lessonId: lesson.id, deviceId: device.id };
  state.binding = { ...binding, mode: 'student' };
  const now = Date.now() + 20;
  const event = { id: crypto.randomUUID(), contextKey: JSON.stringify(Object.values(binding)), inputAt: now, side: 'right', sensitivity: 'normal', elbowAngle: 160,
    ruleVersion: 'basketball-shot-2d-v1', thresholds: { readyAngle: 140, shootAngle: 160, wristAboveEar: .1 }, fullBodyUsable: true,
    wristToEar: .15, wristToShoulder: .7, minVisibility: .7, minPresence: null, modelVersion: 'mediapipe-tasks-vision-0.10.21-pose-lite-v1', frameWidth: 320, frameHeight: 213 };
  return { state, binding, event, now, classroom, student, lesson, device };
}

test('동작 근거는 허용된 필드만 저장하고 유효한 범위에서 조회한다', () => {
  const { state, binding, event, now } = setup();
  delete state.shotAttempts; event.landmarks = [{ x: 1 }]; event.rawFrame = 'secret'; event.name = 'student'; event.pin = '123456';
  const item = H.add(state, event, now); const stored = JSON.stringify(item);
  for (const forbidden of ['landmarks', 'rawFrame', 'name', 'pin', 'contextKey']) assert.equal(stored.includes(forbidden), false);
  assert.equal(item.fullBodyUsable, true); assert.equal(item.wristToEar, .15); assert.equal(item.minPresence, null);
  assert.equal(H.list(state, binding, now).length, 1); assert.equal(state.outbox.length, 0);
  const copy = H.list(state, binding, now); copy[0].thresholds.readyAngle = 1; assert.equal(item.thresholds.readyAngle, 140);
  assert.throws(() => H.list(state, { classId: binding.classId }, now));
});

test('중복 ID는 같은 이벤트만 멱등이며 맥락·학급 소속 및 근거를 검증한다', () => {
  const { state, event, now, binding } = setup();
  const first = H.add(state, event, now); assert.equal(H.add(state, event, now + 1), first); assert.equal(state.shotAttempts.length, 1);
  assert.throws(() => H.add(state, { ...event, elbowAngle: 166 }, now + 1));
  const next = { ...event, id: crypto.randomUUID() };
  state.binding.studentId = crypto.randomUUID(); assert.throws(() => H.add(state, next, now + 1)); state.binding = { ...binding };
  state.devices[0].classId = crypto.randomUUID(); assert.throws(() => H.add(state, next, now + 1)); state.devices[0].classId = binding.classId;
  state.classes[0].pendingDelete = true; assert.throws(() => H.add(state, next, now + 1));
  state.classes[0].pendingDelete = false;
  for (const patch of [{ fullBodyUsable: false }, { minVisibility: .59 }, { wristToEar: NaN }, { inputAt: now + 5000 }, { frameWidth: 321 }]) assert.throws(() => H.add(state, { ...next, ...patch }, now + 1));
});

test('기록과 부모 유효기간 중 가장 이른 때 만료되고 고아·삭제 부모는 제거된다', () => {
  for (const type of ['classes', 'students', 'lessons', 'devices']) {
    const { state, event, now } = setup(); state[type][0].expiresAt = now + 1000;
    const record = H.add(state, event, now); assert.equal(record.expiresAt, now + 1000);
    M.expire(state, now + 1001); assert.equal(state.shotAttempts.length, 0, type);
  }
  const { state, event, now } = setup(); H.add(state, event, now); state.devices = []; M.expire(state, now + 1); assert.equal(state.shotAttempts.length, 0);
});

test('기존 부모에 expiresAt이 없으면 createdAt 7일 상한을 쓴다', () => {
  const { state, event, now, device } = setup(); delete device.expiresAt;
  const record = H.add(state, event, now); assert.ok(record.expiresAt <= device.createdAt + M.MAX_RETENTION);
  device.createdAt = now - M.MAX_RETENTION; assert.throws(() => H.add(state, { ...event, id: crypto.randomUUID() }, now));
});

test('명시한 같은 연결의 유효 클립만 연결하고 삭제 시 연결된 기록만 제거한다', () => {
  const { state, event, now, binding } = setup();
  const linked = H.add(state, event, now); const standalone = H.add(state, { ...event, id: crypto.randomUUID() }, now);
  const clip = { id: crypto.randomUUID(), ...binding, expiresAt: now + 500 };
  assert.throws(() => H.linkClip(state, linked.id, { ...clip, deviceId: crypto.randomUUID() }, now));
  assert.throws(() => H.linkClip(state, linked.id, { ...clip, expiresAt: now }, now));
  H.linkClip(state, linked.id, clip, now); assert.equal(linked.expiresAt, clip.expiresAt); assert.equal(linked.clipId, clip.id);
  assert.throws(() => H.linkClip(state, linked.id, { ...clip, id: crypto.randomUUID() }, now));
  M.removeClip(state, clip.id, now); assert.deepEqual(state.shotAttempts.map(item => item.id), [standalone.id]); assert.equal(state.outbox.length, 0);
  assert.equal(H.remove(state, standalone.id), true); assert.equal(H.remove(state, standalone.id), false);
});

test('기록이 가득 차면 만료 전 항목은 삭제하지 않으며 만료 항목만 제거 후 기록한다', () => {
  const { state, event, now } = setup(); const item = H.add(state, event, now);
  state.shotAttempts = Array.from({ length: H.MAX_ATTEMPTS }, () => ({ ...item, id: crypto.randomUUID() }));
  assert.throws(() => H.add(state, { ...event, id: crypto.randomUUID() }, now + 1)); assert.equal(state.shotAttempts.length, H.MAX_ATTEMPTS);
  state.shotAttempts[0].expiresAt = now; H.add(state, { ...event, id: crypto.randomUUID() }, now + 1); assert.equal(state.shotAttempts.length, H.MAX_ATTEMPTS);
});
