const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Core = require('../wearable-bridge.js');

const nowAt = Date.parse('2026-11-07T12:00:00Z');
const consent = { student: true, guardian: true, heartRate: true };
const galaxy = { platform: 'galaxy-watch', model: 'Galaxy Watch Test', releaseDate: '2023-07-01', heartRateAvailable: true };
function pairingPayload(now = nowAt, overrides = {}) {
  const invitation = { v: 1, host: '192.168.1.9', port: 8443, sessionId: '550e8400-e29b-41d4-a716-446655440000', ticket: 'A'.repeat(43), fingerprint: 'b'.repeat(64), expiresAt: now + Core.PAIRING_TTL_MS, ...overrides };
  return `${Core.PAIRING_PREFIX}${Buffer.from(JSON.stringify(invitation)).toString('base64url')}`;
}

function fakeBridge() {
  const fake = { device: { ...galaxy }, starts: [], reconnects: [], stops: [], listener: null };
  fake.api = {
    version: 2,
    async createPairingSession(request) { fake.starts.push(request); return { sessionId: `native-${fake.starts.length}`, pairingPayload: pairingPayload() }; },
    async reconnectSession(request) { fake.reconnects.push(request); return { sessionId: `native-reconnect-${fake.reconnects.length}`, pairingPayload: pairingPayload() }; },
    async stopSession(request) { fake.stops.push(request); },
    subscribe(listener) { fake.listener = listener; return () => { fake.listener = null; }; },
  };
  fake.emit = event => fake.listener?.(event);
  return fake;
}

test('four-year model cutoff and heart-rate capability are enforced', () => {
  assert.equal(Core.MIN_RELEASE_DATE, '2022-11-07');
  assert.throws(() => Core.validateDevice({ ...galaxy, releaseDate: '2022-11-06' }, nowAt), /출시일/);
  assert.throws(() => Core.validateDevice({ ...galaxy, platform: 'generic-watch' }, nowAt), /지원 대상으로/);
  assert.throws(() => Core.validateDevice({ ...galaxy, heartRateAvailable: false }, nowAt), /심박수/);
  assert.throws(() => Core.validateDevice({ ...galaxy, releaseDate: '2027-01-01' }, nowAt), /출시일/);
  assert.deepEqual({ ...Core.validateDevice(galaxy, nowAt) }, { platform: 'galaxy-watch', model: 'Galaxy Watch Test', releaseDate: '2023-07-01' });
});

test('pairing QR accepts only private-LAN, pinned, short-lived one-time invitations', () => {
  const valid = pairingPayload();
  assert.deepEqual({ ...Core.validatePairingPayload(valid, nowAt) }, { v: 1, host: '192.168.1.9', port: 8443, sessionId: '550e8400-e29b-41d4-a716-446655440000', ticket: 'A'.repeat(43), fingerprint: 'b'.repeat(64), expiresAt: nowAt + Core.PAIRING_TTL_MS });
  assert.throws(() => Core.validatePairingPayload(pairingPayload(nowAt, { host: '8.8.8.8' }), nowAt), /로컬 네트워크/);
  assert.throws(() => Core.validatePairingPayload(pairingPayload(nowAt, { expiresAt: nowAt + Core.PAIRING_TTL_MS + 1 }), nowAt), /유효 시간이/);
  assert.throws(() => Core.validatePairingPayload(pairingPayload(nowAt, { expiresAt: nowAt }), nowAt), /만료/);
  assert.throws(() => Core.validatePairingPayload(pairingPayload(nowAt, { sessionId: 'student-1' }), nowAt), /세션 식별자/);
  assert.throws(() => Core.validatePairingPayload(pairingPayload(nowAt, { studentId: 'student-1' }), nowAt), /허용되지 않은 정보/);
  assert.throws(() => Core.validatePairingPayload('https://example.com/pair', nowAt), /형식/);
});

test('both student and guardian consent are required before creating a phone pairing invitation', async () => {
  const fake = fakeBridge(); const controller = Core.createController({ bridge: fake.api, now: () => nowAt, createId: () => 'opaque-session-token' });
  await assert.rejects(controller.start({ student: true, guardian: false, heartRate: true }), /학생 본인과 보호자/);
  assert.equal(fake.starts.length, 0);
  await controller.start(consent);
  assert.equal(fake.starts.length, 1);
  assert.equal(controller.getState().status, 'pairing');
  assert.equal(controller.getState().pairingPayload, pairingPayload());
});

test('withdrawing either consent while the invitation is being created cancels the session', async () => {
  const fake = fakeBridge(); let releaseInvitation; let valid = true;
  fake.api.createPairingSession = () => new Promise(resolve => { releaseInvitation = resolve; });
  const controller = Core.createController({ bridge: fake.api, now: () => nowAt, createId: () => 'opaque-session-token' });
  const pending = controller.start({ ...consent, isStillValid: () => valid });
  valid = false; releaseInvitation({ sessionId: 'native-pending', pairingPayload: pairingPayload() });
  await assert.rejects(pending, /동의 확인이 해제/);
  assert.deepEqual(fake.stops, [{ sessionId: 'native-pending' }]);
  assert.equal(controller.getState().bpm, null);
  assert.equal(controller.getState().pairingPayload, null);
});

test('the teacher bridge creates an opaque phone pairing invitation without student or class identifiers', async () => {
  const fake = fakeBridge(); const controller = Core.createController({ bridge: fake.api, now: () => nowAt, createId: () => 'opaque-session-token' });
  await controller.start(consent);
  assert.deepEqual(fake.starts[0], { participantToken: 'opaque-session-token', dataTypes: ['heartRate'] });
  assert.equal(controller.getState().status, 'pairing');
  assert.equal(JSON.stringify(controller.getState()).includes('studentId'), false);
  assert.equal(JSON.stringify(controller.getState()).includes('classId'), false);
  assert.equal(Core.supportedBridge({ ...fake.api, version: 1 }), false);
});

test('phone-side permission failure stops collection and leaves the live record blank', async () => {
  const fake = fakeBridge(); const controller = Core.createController({ bridge: fake.api, now: () => nowAt, createId: () => 'opaque-session-token' });
  await controller.start(consent);
  fake.emit({ type: 'permission-unavailable', sessionId: 'native-1' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(controller.getState().status, 'denied');
  assert.equal(controller.getState().bpm, null);
  assert.equal(controller.getState().pairingPayload, null);
  assert.deepEqual(fake.stops, [{ sessionId: 'native-1' }]);
});

test('an unused pairing invitation expires and clears the active measurement session', async () => {
  const fake = fakeBridge(); const controller = Core.createController({ bridge: fake.api, now: () => nowAt, createId: () => 'opaque-session-token' });
  await controller.start(consent);
  fake.emit({ type: 'invitation-expired', sessionId: 'native-1' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(controller.getState().status, 'expired');
  assert.equal(controller.getState().pairingPayload, null);
  assert.equal(controller.getState().bpm, null);
  assert.deepEqual(fake.stops, [{ sessionId: 'native-1' }]);
});

test('the Android WebMessage host adapter returns native results and forwards subscribed events', async () => {
  const calls = []; let subscriber = null;
  const host = {
    postMessage(value) {
      const request = JSON.parse(value); calls.push(request);
      if (request.method === 'subscribe') subscriber = request.payload.listenerId;
      setImmediate(() => host.onmessage?.({ data: JSON.stringify({ id: request.id, ok: true, data: request.method === 'createPairingSession' ? { sessionId: 'host-session', pairingPayload: pairingPayload() } : null }) }));
    },
  };
  const bridge = Core.createNativeBridge(host);
  assert.equal(bridge.version, 2);
  const started = await bridge.createPairingSession({ participantToken: 'opaque-session-token', dataTypes: ['heartRate'] });
  assert.equal(started.sessionId, 'host-session');
  assert.equal(JSON.stringify(calls[0].payload).includes('studentId'), false);
  let received = null;
  const unsubscribe = bridge.subscribe(event => { received = event; });
  const listenerId = subscriber;
  await new Promise(resolve => setImmediate(resolve));
  host.onmessage({ data: JSON.stringify({ type: 'event', listenerId, event: { type: 'participant-connected', sessionId: 'host-session' } }) });
  assert.deepEqual(received, { type: 'participant-connected', sessionId: 'host-session' });
  unsubscribe();
  host.onmessage({ data: JSON.stringify({ type: 'event', listenerId, event: { type: 'sample' } }) });
  assert.deepEqual(received, { type: 'participant-connected', sessionId: 'host-session' });
  assert.ok(calls.some(call => call.method === 'unsubscribe'));
  delete globalThis.PELoopWearableBridge;
});

test('disconnect hides the last value, marks a gap and waits for teacher initiated reconnect', async () => {
  let now = nowAt; const fake = fakeBridge();
  const controller = Core.createController({ bridge: fake.api, now: () => now, createId: () => 'opaque-session-token' });
  await controller.start(consent);
  fake.emit({ type: 'device-ready', sessionId: 'native-1', device: galaxy });
  fake.emit({ type: 'sample', sessionId: 'native-1', metric: 'heartRate', value: 117, timestamp: now });
  assert.equal(controller.getState().bpm, 117);
  now += 1200;
  fake.emit({ type: 'disconnected', sessionId: 'native-1' });
  assert.equal(controller.getState().status, 'disconnected');
  assert.equal(controller.getState().bpm, null);
  assert.equal(controller.getState().sampledAt, null);
  assert.equal(controller.getState().gapStartedAt, now);
  await controller.reconnect(consent);
  assert.equal(controller.getState().status, 'pairing');
  assert.deepEqual(fake.reconnects[0], { participantToken: 'opaque-session-token', dataTypes: ['heartRate'] });
  assert.equal(controller.getState().pairingPayload, pairingPayload());
  fake.emit({ type: 'device-ready', sessionId: 'native-reconnect-1', device: galaxy });
  now += 900;
  fake.emit({ type: 'sample', sessionId: 'native-reconnect-1', metric: 'heartRate', value: 121, timestamp: now });
  assert.equal(controller.getState().status, 'active');
  assert.equal(controller.getState().bpm, 121);
  assert.equal(controller.getState().gapCount, 1);
  assert.equal(controller.getState().lastGapDurationMs, 900);
  await controller.stop();
});

test('LAN disconnection hides the value and waits for phone-led automatic recovery', async () => {
  const fake = fakeBridge(); const controller = Core.createController({ bridge: fake.api, now: () => nowAt, createId: () => 'opaque-session-token' });
  await controller.start(consent);
  fake.emit({ type: 'device-ready', sessionId: 'native-1', device: galaxy });
  fake.emit({ type: 'sample', sessionId: 'native-1', metric: 'heartRate', value: 116, timestamp: nowAt });
  fake.emit({ type: 'disconnected', source: 'network', sessionId: 'native-1' });
  assert.equal(controller.getState().status, 'network-disconnected');
  assert.equal(controller.getState().bpm, null);
  assert.equal(controller.getState().pairingPayload, null);
  fake.emit({ type: 'sample', sessionId: 'native-1', metric: 'heartRate', value: 119, timestamp: nowAt + 1000 });
  assert.equal(controller.getState().bpm, null, 'late samples do not silently resume after a network loss');
  await assert.rejects(controller.reconnect(consent), /다시 연결할 측정 세션/);
  assert.equal(fake.reconnects.length, 0, 'the teacher QR action is not used for a LAN interruption');
  await controller.stop();
});

test('LAN recovery resumes only after a fresh device announcement and sample', async () => {
  let now = nowAt; const fake = fakeBridge();
  const controller = Core.createController({ bridge: fake.api, now: () => now, createId: () => 'opaque-session-token' });
  await controller.start(consent);
  fake.emit({ type: 'device-ready', sessionId: 'native-1', device: galaxy });
  fake.emit({ type: 'sample', sessionId: 'native-1', metric: 'heartRate', value: 114, timestamp: now });
  now += 900;
  fake.emit({ type: 'disconnected', source: 'network', sessionId: 'native-1' });
  assert.equal(controller.getState().status, 'network-disconnected');
  assert.equal(controller.getState().bpm, null);
  now += 2000;
  fake.emit({ type: 'network-reconnected', sessionId: 'native-1' });
  assert.equal(controller.getState().status, 'waiting-data');
  assert.equal(controller.getState().bpm, null);
  fake.emit({ type: 'sample', sessionId: 'native-1', metric: 'heartRate', value: 125, timestamp: now + 100 });
  assert.equal(controller.getState().bpm, null, 'samples stay ignored until the companion re-announces the watch');
  fake.emit({ type: 'device-ready', sessionId: 'native-1', device: galaxy });
  fake.emit({ type: 'sample', sessionId: 'native-1', metric: 'heartRate', value: 130, timestamp: now - 1000 });
  assert.equal(controller.getState().bpm, null, 'a recent sample recorded during the disconnected gap must not fill it');
  now += 100;
  fake.emit({ type: 'sample', sessionId: 'native-1', metric: 'heartRate', value: 119, timestamp: now });
  assert.equal(controller.getState().status, 'active');
  assert.equal(controller.getState().bpm, 119);
  assert.equal(controller.getState().gapCount, 1);
  assert.equal(controller.getState().lastGapDurationMs, 2100);
  await controller.stop();
});

test('old, future, malformed, duplicate and wrong-session values are never displayed', async () => {
  const fake = fakeBridge(); const controller = Core.createController({ bridge: fake.api, now: () => nowAt, createId: () => 'opaque-session-token' });
  await controller.start(consent);
  fake.emit({ type: 'device-ready', sessionId: 'native-1', device: galaxy });
  fake.emit({ type: 'sample', sessionId: 'other-session', metric: 'heartRate', value: 110, timestamp: nowAt });
  fake.emit({ type: 'sample', sessionId: 'native-1', metric: 'heartRate', value: 251, timestamp: nowAt });
  fake.emit({ type: 'sample', sessionId: 'native-1', metric: 'heartRate', value: 110, timestamp: nowAt + 30001 });
  assert.equal(controller.getState().bpm, null);
  fake.emit({ type: 'sample', sessionId: 'native-1', metric: 'heartRate', value: 110, timestamp: nowAt - 6000 });
  assert.equal(controller.getState().status, 'stale');
  assert.equal(controller.getState().bpm, null);
  fake.emit({ type: 'sample', sessionId: 'native-1', metric: 'heartRate', value: 110, timestamp: nowAt + 1 });
  fake.emit({ type: 'sample', sessionId: 'native-1', metric: 'heartRate', value: 111, timestamp: nowAt - 6000 });
  assert.equal(controller.getState().bpm, 110);
  assert.equal(controller.getState().status, 'active');
  await controller.stop();
});

test('a fresh reading that does not arrive on time clears the value and opens a gap', async () => {
  let now = nowAt; let timer;
  const fake = fakeBridge();
  const controller = Core.createController({ bridge: fake.api, now: () => now, createId: () => 'opaque-session-token', schedule: callback => { timer = callback; return 1; }, cancel: () => { timer = null; } });
  await controller.start(consent);
  fake.emit({ type: 'device-ready', sessionId: 'native-1', device: galaxy });
  fake.emit({ type: 'sample', sessionId: 'native-1', metric: 'heartRate', value: 99, timestamp: now });
  assert.equal(controller.getState().bpm, 99);
  now += Core.HEART_RATE_STALE_MS;
  timer();
  assert.equal(controller.getState().status, 'stale');
  assert.equal(controller.getState().bpm, null);
  assert.equal(controller.getState().gapStartedAt, now);
});

test('stop and permission revocation immediately erase the live measurement', async () => {
  const fake = fakeBridge(); const controller = Core.createController({ bridge: fake.api, now: () => nowAt, createId: () => 'opaque-session-token' });
  await controller.start(consent);
  fake.emit({ type: 'device-ready', sessionId: 'native-1', device: galaxy });
  fake.emit({ type: 'sample', sessionId: 'native-1', metric: 'heartRate', value: 120, timestamp: nowAt });
  await controller.stop();
  assert.equal(controller.getState().status, 'ended'); assert.equal(controller.getState().bpm, null);
  assert.deepEqual(fake.stops.at(-1), { sessionId: 'native-1' });
  await controller.start(consent);
  fake.emit({ type: 'device-ready', sessionId: 'native-2', device: galaxy });
  fake.emit({ type: 'sample', sessionId: 'native-2', metric: 'heartRate', value: 120, timestamp: nowAt });
  fake.emit({ type: 'permission-revoked', sessionId: 'native-2' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(controller.getState().status, 'denied'); assert.equal(controller.getState().bpm, null);
  assert.equal(fake.listener, null);
});

test('the same API is exposed to browsers without dependencies', () => {
  const context = vm.createContext({ setTimeout, clearTimeout });
  vm.runInContext(fs.readFileSync(require.resolve('../wearable-bridge.js'), 'utf8'), context);
  assert.equal(context.WearableBridge.MIN_RELEASE_DATE, '2022-11-07');
  assert.equal(context.WearableBridge.supportedBridge(null), false);
});
