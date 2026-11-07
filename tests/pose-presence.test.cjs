const test = require('node:test');
const assert = require('node:assert/strict');
const PosePresence = require('../pose-presence.js');

function fullBody() {
  const points = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1, presence: 1 }));
  const coordinates = {
    0: [0.5, 0.1], 7: [0.44, 0.12], 8: [0.56, 0.12], 11: [0.4, 0.25], 12: [0.6, 0.25],
    13: [0.35, 0.4], 14: [0.65, 0.4], 15: [0.3, 0.52], 16: [0.7, 0.52],
    23: [0.43, 0.48], 24: [0.57, 0.48], 25: [0.43, 0.67], 26: [0.57, 0.67],
    27: [0.43, 0.88], 28: [0.57, 0.88], 31: [0.4, 0.94], 32: [0.6, 0.94],
  };
  for (const [index, [x, y]] of Object.entries(coordinates)) points[index] = { x, y, visibility: 0.9, presence: 0.9 };
  return points;
}

test('합성 전신 관절 좌표는 사용 가능으로 통과한다', () => {
  assert.deepEqual(PosePresence.analyze(fullBody()), { usable: true, reason: null, message: '전신 관절을 확인했어요.' });
});

test('필수 관절 인덱스가 빠지면 missing을 반환한다', () => {
  const landmarks = fullBody();
  landmarks[16] = null;
  assert.equal(PosePresence.analyze(landmarks).reason, 'missing');
  assert.equal(PosePresence.analyze(null).reason, 'missing');
});

test('필수 관절 confidence가 threshold 미만이거나 non-finite면 confidence를 반환한다', () => {
  const lowVisibility = fullBody();
  lowVisibility[12].visibility = 0.59;
  assert.equal(PosePresence.analyze(lowVisibility).reason, 'confidence');
  const lowPresence = fullBody();
  lowPresence[28].presence = 0.59;
  assert.equal(PosePresence.analyze(lowPresence).reason, 'confidence');
  const invalid = fullBody();
  invalid[0].x = NaN;
  assert.equal(PosePresence.analyze(invalid).reason, 'confidence');
});

test('confidence 0.6 경계는 통과한다', () => {
  const landmarks = fullBody();
  landmarks[0].visibility = 0.6;
  landmarks[0].presence = 0.6;
  assert.equal(PosePresence.analyze(landmarks).usable, true);
});

test('SDK 형태처럼 presence가 없어도 visibility가 유효하면 통과한다', () => {
  const landmarks = fullBody();
  for (const index of PosePresence.REQUIRED_INDICES) delete landmarks[index].presence;
  assert.equal(PosePresence.analyze(landmarks).usable, true);
});

test('presence 필드가 있으면 유효한 confidence를 추가로 요구한다', () => {
  const landmarks = fullBody();
  landmarks[0].presence = 0.59;
  assert.equal(PosePresence.analyze(landmarks).reason, 'confidence');
});

test('필수 관절이 frame margin 밖이면 out-of-frame을 반환한다', () => {
  const landmarks = fullBody();
  landmarks[31].x = 0.01;
  assert.equal(PosePresence.analyze(landmarks).reason, 'out-of-frame');
});

test('frame margin 경계는 허용한다', () => {
  const landmarks = fullBody();
  landmarks[31].x = 0.02;
  landmarks[32].y = 0.98;
  assert.equal(PosePresence.analyze(landmarks).usable, true);
});

test('몸통 높이가 최소값보다 작으면 too-small이다', () => {
  const landmarks = fullBody();
  landmarks[23].y = 0.36;
  landmarks[24].y = 0.36;
  assert.equal(PosePresence.analyze(landmarks).reason, 'too-small');
});

test('전체 신체 높이가 최소값보다 작으면 too-small이다', () => {
  const landmarks = fullBody();
  const y = { 0: 0.35, 7: 0.37, 8: 0.37, 11: 0.44, 12: 0.44, 13: 0.47, 14: 0.47, 15: 0.5, 16: 0.5, 23: 0.56, 24: 0.56, 25: 0.6, 26: 0.6, 27: 0.64, 28: 0.64, 31: 0.65, 32: 0.65 };
  for (const [index, value] of Object.entries(y)) landmarks[index].y = value;
  assert.equal(PosePresence.analyze(landmarks).reason, 'too-small');
});

test('실제 33개 중 지정된 관절만 gate에 사용한다', () => {
  const landmarks = fullBody();
  landmarks[1] = { x: NaN, y: NaN, visibility: 0, presence: 0 };
  assert.equal(PosePresence.analyze(landmarks).usable, true);
  assert.deepEqual(PosePresence.REQUIRED_INDICES, [0, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 31, 32]);
});
