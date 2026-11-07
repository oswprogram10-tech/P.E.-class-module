const test = require('node:test');
const assert = require('node:assert/strict');
const { Detector } = require('../basketball-shot.js');

function pose(phase, side = 'right') {
  const points = Array.from({ length: 33 }, () => ({ x: .5, y: .5, visibility: .95 }));
  const xy = { 0:[.5,.12], 7:[.44,.15], 8:[.56,.15], 11:[.4,.34], 12:[.6,.34], 13:[.35,.45], 14:[.65,.45], 15:[.3,.55], 16:[.7,.55], 23:[.43,.60], 24:[.57,.60], 25:[.43,.72], 26:[.57,.72], 27:[.43,.88], 28:[.57,.88], 31:[.4,.94], 32:[.6,.94] };
  for (const [i, [x,y]] of Object.entries(xy)) Object.assign(points[i], { x, y });
  const [elbow, wrist, shoulder] = side === 'left' ? [13,15,.4] : [14,16,.6];
  const sign = side === 'left' ? -1 : 1;
  if (phase === 'ready') { Object.assign(points[elbow], { x: shoulder + sign * .06, y: .25 }); Object.assign(points[wrist], { x: shoulder, y: .17 }); }
  if (phase === 'shoot') { Object.assign(points[elbow], { x: shoulder, y: .22 }); Object.assign(points[wrist], { x: shoulder, y: .08 }); }
  return points;
}
function send(detector, points, timestamp, width = 640, height = 480) { return detector.update({ landmarks: points, timestamp, width, height }); }
function hold(detector, points, time) { send(detector, points, time); return send(detector, points, time + 300); }

test('READY와 SHOOT은 각각 연속 프레임과 시간 조건을 요구하고 한 동작당 한번만 발생한다', () => {
  const d = new Detector(), ready = pose('ready'), shoot = pose('shoot'), lower = pose('lower');
  assert.equal(send(d, ready, 100).state, 'waiting');
  assert.equal(send(d, ready, 200).state, 'waiting');
  assert.equal(send(d, ready, 400).state, 'ready');
  assert.equal(send(d, shoot, 500).event, false);
  const result = send(d, shoot, 800); assert.equal(result.state, 'shoot'); assert.equal(result.event, true); assert.ok(result.angle > 175);
  assert.equal(send(d, shoot, 1100).event, false); assert.equal(hold(d, ready, 1200).event, false);
  assert.equal(hold(d, lower, 1900).state, 'waiting');
  assert.equal(hold(d, ready, 2300).state, 'ready'); assert.equal(hold(d, shoot, 2700).event, true);
});

test('좌우를 분리하고 화면비를 반영한 2D 각도를 제공한다', () => {
  const d = new Detector({ side: 'left', sensitivity: 'normal' });
  assert.equal(hold(d, pose('ready', 'right'), 100).state, 'waiting');
  assert.equal(hold(d, pose('ready', 'left'), 500).state, 'ready');
  assert.equal(hold(d, pose('shoot', 'left'), 900).event, true);
  const p = pose('ready'); const one = send(new Detector(), p, 100, 640, 640).angle;
  const two = send(new Detector(), p, 100, 1280, 640).angle;
  assert.ok(Math.abs(one - two) > 5);
});

test('신뢰도·전신 누락·오래된 프레임과 설정 변경은 이전 동작을 이어 붙이지 않는다', () => {
  for (const mode of ['confidence', 'missing', 'gap', 'timestamp', 'settings']) {
    const d = new Detector(); hold(d, pose('ready'), 100);
    if (mode === 'confidence') { const p = pose('ready'); p[8].visibility = .1; assert.equal(send(d, p, 500).reason, 'confidence'); }
    if (mode === 'missing') assert.equal(send(d, null, 500).reason, 'missing');
    if (mode === 'gap') send(d, pose('shoot'), 1600);
    if (mode === 'timestamp') send(d, pose('shoot'), 300);
    if (mode === 'settings') d.configure({ side: 'left', sensitivity: 'high' });
    assert.equal(hold(d, pose('shoot', mode === 'settings' ? 'left' : 'right'), 1700).event, false, mode);
  }
});

test('추적 대상의 큰 이동과 좌우 뒤바뀜은 준비 상태를 버린다', () => {
  const d = new Detector(); hold(d, pose('ready'), 100);
  const swapped = pose('shoot'); for (const [a,b] of [[7,8],[11,12],[13,14],[15,16],[23,24],[25,26],[27,28],[31,32]]) [swapped[a], swapped[b]] = [swapped[b], swapped[a]];
  assert.equal(send(d, swapped, 500).state, 'waiting');
  assert.equal(send(d, swapped, 800).event, false);
  const moved = new Detector(); hold(moved, pose('ready'), 100);
  const p = pose('shoot'); for (const point of p) point.x = point.x * .45 + .03;
  assert.equal(send(moved, p, 500).state, 'waiting');
});

test('민감도와 잘못된 입력을 구분한다', () => {
  const p = pose('ready'); p[14].x = .75; p[14].y = .22;
  const low = new Detector({ side: 'right', sensitivity: 'low' });
  const high = new Detector({ side: 'right', sensitivity: 'high' });
  // Height threshold is stricter for low sensitivity on this same raised pose.
  hold(low, pose('ready'), 100); hold(high, pose('ready'), 100);
  const raised = pose('shoot'); raised[16].y = .135;
  assert.equal(hold(low, raised, 500).event, false);
  assert.equal(hold(high, raised, 500).event, true);
  assert.throws(() => new Detector({ side: 'auto', sensitivity: 'normal' }), TypeError);
  assert.equal(send(new Detector(), p, 100, 0, 480).reason, 'invalid-frame');
});

test('동일한 자세를 화면에서 축소·이동해도 몸통 정규화와 각도가 유지된다', () => {
  const original = pose('ready');
  const changed = original.map(p => ({ ...p, x: .5 + (p.x - .5) * .8, y: .5 + (p.y - .5) * .8 }));
  const a = new Detector(), b = new Detector();
  const first = hold(a, original, 100), second = hold(b, changed, 100);
  assert.equal(first.state, 'ready'); assert.equal(second.state, 'ready');
  assert.ok(Math.abs(first.angle - second.angle) < 1e-8);
});

test('한 프레임 잡음과 중단은 진행 중인 발사를 유지하지 않는다', () => {
  const d = new Detector(); hold(d, pose('ready'), 100);
  send(d, pose('shoot'), 500);
  const low = pose('shoot'); low[16].visibility = .1;
  assert.equal(send(d, low, 600).state, 'waiting');
  assert.equal(hold(d, pose('shoot'), 700).event, false);
  hold(d, pose('ready'), 1100); send(d, pose('shoot'), 1500); d.reset('suspended');
  assert.equal(hold(d, pose('shoot'), 1600).event, false);
});

test('READY 진입과 유지의 서로 다른 높이 경계는 작은 흔들림을 허용한다', () => {
  const entry = pose('ready'); const jitter = pose('ready'); jitter[16].y = .14;
  const fresh = new Detector(); assert.equal(hold(fresh, jitter, 100).state, 'waiting');
  const continued = new Detector(); send(continued, entry, 100);
  assert.equal(send(continued, jitter, 400).state, 'ready');
});

test('손목을 높이더라도 팔꿈치가 더 굽혀지면 SHOOT하지 않는다', () => {
  const d = new Detector({ side: 'right', sensitivity: 'high' });
  const ready = pose('ready'); ready[14] = { x: .65, y: .40, visibility: .95 }; ready[16] = { x: .70, y: .17, visibility: .95 };
  const initial = hold(d, ready, 100); assert.equal(initial.state, 'ready');
  const bent = structuredClone(ready); bent[16].y = .08;
  const result = hold(d, bent, 500);
  assert.ok(result.angle < initial.angle, `${result.angle} < ${initial.angle}`);
  assert.equal(result.state, 'ready'); assert.equal(result.event, false);
  assert.equal(hold(d, pose('shoot'), 900).event, true);
});

test('차원과 타임스탬프의 누락 또는 비유한값은 상태를 비운다', () => {
  for (const patch of [{ width: undefined }, { height: Infinity }, { timestamp: NaN }]) {
    const d = new Detector(); hold(d, pose('ready'), 100);
    const result = d.update({ landmarks: pose('shoot'), timestamp: 500, width: 640, height: 480, ...patch });
    assert.equal(result.reason, 'invalid-frame'); assert.equal(result.state, 'waiting'); assert.equal(result.angle, null);
  }
});
