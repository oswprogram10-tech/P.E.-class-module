const test = require('node:test');
const assert = require('node:assert/strict');
const QR = require('../qr-missions.js');

function ids() {
  let next = 1;
  return () => `00000000-0000-4000-8000-${String(next++).padStart(12, '0')}`;
}
function fixture() {
  const state = QR.createState();
  const createId = ids();
  const made = QR.createMission(state, {
    classId: 'class-context-a',
    title: 'Movement circuit',
    activities: [
      { id: 'station-1', kind: 'station', title: 'Warm up', instructions: 'Move safely.', criteria: 'Teacher observes safe movement.' },
      { id: 'group-1', kind: 'group', groupId: 'blue-group', title: 'Team challenge', instructions: 'Complete the relay.', quiz: { prompt: 'Which direction?', options: [{ id: 'forward', text: 'Forward' }, { id: 'back', text: 'Backward' }], correctOptionId: 'forward' } }
    ]
  }, { idFactory: createId, now: 10 });
  return { state, made, createId };
}

test('teacher mission QR contains only the opaque mission ID and scan checks class context', () => {
  const { state, made, createId } = fixture();
  assert.equal(made.qrPayload, made.mission.id);
  assert.match(made.qrPayload, /^[0-9a-f-]{36}$/i);
  assert.equal(made.qrPayload.includes('class-context-a'), false);
  assert.equal(made.qrPayload.includes('Movement'), false);
  assert.throws(() => QR.scan(state, made.qrPayload, 'class-context-b', null, { idFactory: createId }), /class context/);
  const status = QR.scan(state, made.qrPayload, 'class-context-a', null, { idFactory: createId, now: 11 });
  assert.equal(status.activity.title, 'Warm up');
  assert.equal(status.activityIndex, 0);
  assert.equal(status.phase, 'active');
});

test('responses advance in order, repeated response IDs are idempotent, and competing duplicates fail', () => {
  const { state, made, createId } = fixture();
  const start = QR.scan(state, made.qrPayload, 'class-context-a', null, { idFactory: createId });
  const first = { responseId: createId(), sessionId: start.sessionId, missionId: made.mission.id, classId: 'class-context-a', activityId: 'station-1', completed: true };
  const accepted = QR.respond(state, first, { now: 20 });
  assert.equal(accepted.status.activityIndex, 1);
  const replay = QR.respond(state, first, { now: 21 });
  assert.equal(replay.duplicate, true);
  assert.equal(replay.status.activityIndex, 1);
  assert.throws(() => QR.respond(state, { ...first, responseId: createId() }), /out of order/);
  const second = { responseId: createId(), sessionId: start.sessionId, missionId: made.mission.id, classId: 'class-context-a', activityId: 'group-1', groupId: 'blue-group', completed: true, answerOptionId: 'forward' };
  const completed = QR.respond(state, second, { now: 22 });
  assert.equal(completed.response.correct, true);
  assert.equal(completed.status.phase, 'completed');
  assert.equal(completed.status.completed, true);
  assert.throws(() => QR.respond(state, { ...second, responseId: createId(), answerOptionId: 'back' }), /out of order/);
});

test('quiz and group responses are validated against the active activity and mission class', () => {
  const { state, made, createId } = fixture();
  const start = QR.scan(state, made.qrPayload, 'class-context-a', null, { idFactory: createId });
  assert.throws(() => QR.respond(state, { responseId: createId(), sessionId: start.sessionId, missionId: made.mission.id, classId: 'class-context-b', activityId: 'station-1', completed: true }), /class context/);
  QR.respond(state, { responseId: createId(), sessionId: start.sessionId, missionId: made.mission.id, classId: 'class-context-a', activityId: 'station-1', completed: true });
  const wrongGroup = { responseId: createId(), sessionId: start.sessionId, missionId: made.mission.id, classId: 'class-context-a', activityId: 'group-1', groupId: 'red-group', completed: true, answerOptionId: 'forward' };
  assert.throws(() => QR.respond(state, wrongGroup), /group/);
  const noAnswer = { ...wrongGroup, responseId: createId(), groupId: 'blue-group', answerOptionId: undefined };
  assert.throws(() => QR.respond(state, noAnswer), /quiz option|Quiz response/);
  const noGroup = { ...wrongGroup, responseId: createId(), groupId: 'blue-group' };
  assert.equal(QR.respond(state, noGroup).status.completed, true);
});

test('pause, resume, restart, and JSON serialization preserve resumable local state', () => {
  const { state, made, createId } = fixture();
  const start = QR.scan(state, made.qrPayload, 'class-context-a', null, { idFactory: createId, now: 100 });
  QR.respond(state, { responseId: createId(), sessionId: start.sessionId, missionId: made.mission.id, classId: 'class-context-a', activityId: 'station-1', completed: true }, { now: 101 });
  assert.equal(QR.pause(state, start.sessionId, { now: 102 }).phase, 'paused');
  assert.throws(() => QR.scan(state, made.qrPayload, 'class-context-a', start.sessionId), /Resume/);
  const restored = QR.deserialize(QR.serialize(state));
  assert.equal(QR.resume(restored, start.sessionId, { now: 103 }).activity.id, 'group-1');
  const restarted = QR.restart(restored, start.sessionId, { now: 104 });
  assert.equal(restarted.activityIndex, 0);
  assert.equal(restarted.activity.id, 'station-1');
  const resumedAgain = QR.deserialize(QR.serialize(restored));
  assert.equal(QR.scan(resumedAgain, made.qrPayload, 'class-context-a', start.sessionId).activity.id, 'station-1');
  assert.equal(resumedAgain.responses.length, 1);
});

test('serialization rejects malformed or oversized JSON input', () => {
  assert.throws(() => QR.deserialize('{'), /serialization/);
  assert.throws(() => QR.deserialize(' '.repeat(8_000_001)), /serialization/);
  assert.throws(() => QR.deserialize(JSON.stringify({ version: 99, missions: [], sessions: [], responses: [] })), /state/);
});
