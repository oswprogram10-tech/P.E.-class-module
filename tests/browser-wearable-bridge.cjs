const { withBrowser } = require('./browser-helper.cjs');
const assert = require('node:assert/strict');

withBrowser(async (page, errors) => {
  await page.locator('#teacherButton').click();
  await page.locator('#unlockPin').fill('123456');
  await page.locator('#unlockButton').click();
  await page.locator('#teacherContentPanel').waitFor({ state: 'visible' });
  await page.locator('[data-panel="classroom"]').click();
  await page.locator('#newClassName').fill('워치 동의 경계 확인반');
  await page.locator('#addClassButton').click();
  await page.locator('#rosterName').fill('가상 학생');
  await page.locator('#rosterNumber').fill('1');
  await page.locator('#addStudentButton').click();

  const wearable = page.locator('.classroom-tool').filter({ hasText: '웨어러블 — 수업 중 심박수 시범 연동 준비' });
  await wearable.locator(':scope > summary').click();
  const studentId = await page.evaluate(() => classroomUI.state.students[0].id);
  await page.selectOption('#wearableConsentStudent', studentId);
  const start = page.getByRole('button', { name: '수업 심박수 연결 QR 만들기' });
  const studentConsent = page.locator('#wearableStudentConsent');
  const guardianConsent = page.locator('#wearableGuardianConsent');
  assert.equal(await start.isDisabled(), true, 'both consents and a native bridge are required');
  await studentConsent.check();
  assert.equal(await start.isDisabled(), true, 'guardian consent is required separately');
  await guardianConsent.check();
  assert.equal(await start.isDisabled(), false, 'the test-only native bridge is available');
  await start.click();
  await page.waitForFunction(() => document.querySelector('#wearableStatus').textContent.includes('PE Loop 앱으로 QR'));

  const bridgeCall = await page.evaluate(() => window.PELoopWearableBridge.__calls.create[0]);
  assert.deepEqual(bridgeCall.dataTypes, ['heartRate']);
  assert.equal(JSON.stringify(bridgeCall).includes(studentId), false, 'student ID is never sent to the bridge');
  assert.equal(await page.locator('#wearablePairingOutput img').count(), 1, 'the temporary invitation is rendered as a QR without exposing its raw secret');
  await page.evaluate(() => window.PELoopWearableBridge.__emit({ type: 'device-ready', sessionId: 'test-session-1', device: { platform: 'galaxy-watch', model: 'Galaxy Watch Test', releaseDate: '2023-07-01', heartRateAvailable: true } }));
  await page.evaluate(() => window.PELoopWearableBridge.__emit({ type: 'sample', sessionId: 'test-session-1', metric: 'heartRate', value: 118, timestamp: Date.now() }));
  await page.waitForFunction(() => !document.querySelector('#wearableLiveValue').hidden && document.querySelector('#wearableLiveValue').textContent.includes('118 bpm'));
  await page.evaluate(() => window.PELoopWearableBridge.__emit({ type: 'disconnected', sessionId: 'test-session-1' }));
  await page.waitForFunction(() => document.querySelector('#wearableLiveValue').hidden && document.querySelector('#wearableStatus').textContent.includes('측정 공백'));
  assert.match(await page.locator('#wearableStatus').textContent(), /수업은 계속/);
  const reconnect = page.getByRole('button', { name: '교사가 연결 QR 다시 만들기' });
  assert.equal(await reconnect.isDisabled(), false, 'reconnect is a teacher action after a gap');
  await reconnect.click();
  await page.waitForFunction(() => window.PELoopWearableBridge.__calls.reconnect.length === 1);
  await page.evaluate(() => window.PELoopWearableBridge.__emit({ type: 'device-ready', sessionId: 'test-session-2', device: { platform: 'galaxy-watch', model: 'Galaxy Watch Test', releaseDate: '2023-07-01', heartRateAvailable: true } }));
  await page.evaluate(() => window.PELoopWearableBridge.__emit({ type: 'sample', sessionId: 'test-session-2', metric: 'heartRate', value: 123, timestamp: Date.now() }));
  await page.waitForFunction(() => !document.querySelector('#wearableLiveValue').hidden && document.querySelector('#wearableLiveValue').textContent.includes('123 bpm'));
  await guardianConsent.uncheck();
  await page.waitForFunction(() => document.querySelector('#wearableLiveValue').hidden && document.querySelector('#wearableStatus').textContent.includes('중단'));
  assert.equal(await page.evaluate(() => window.PELoopWearableBridge.__calls.stop.length), 1, 'revoking either consent stops the native session');
  const persistedKeys = await page.evaluate(() => Object.keys(classroomUI.state).filter(key => /wearable|heartRate|pulse/i.test(key)));
  assert.deepEqual(persistedKeys, [], 'live health readings are not written to encrypted class records');

  await studentConsent.check(); await guardianConsent.check();
  await start.click();
  await page.waitForFunction(() => window.PELoopWearableBridge.__calls.create.length === 2);
  await page.evaluate(() => window.PELoopWearableBridge.__emit({ type: 'permission-unavailable', sessionId: 'test-session-3' }));
  await page.waitForFunction(() => document.querySelector('#wearableStatus').textContent.includes('기록은 비워 둡니다'));
  assert.equal(await page.locator('#wearableLiveValue').isVisible(), false, 'phone-side permission failure leaves the reading blank');
  assert.equal(await page.locator('#routine-stretching').isEnabled(), true, 'class activity remains available after wearable permission denial');
  await start.click();
  await page.waitForFunction(() => window.PELoopWearableBridge.__calls.create.length === 3);
  await page.evaluate(() => window.PELoopWearableBridge.__emit({ type: 'disconnected', sessionId: 'test-session-4' }));
  assert.equal(await reconnect.isDisabled(), false, 'a watch connection gap offers manual retry');
  await page.evaluate(() => { window.PELoopWearableBridge.__failReconnect = true; });
  await reconnect.click();
  await page.waitForFunction(() => document.querySelector('#wearableStatus').textContent.includes('연결에 실패했습니다'));
  const stop = page.getByRole('button', { name: '수업 심박수 측정 종료' });
  assert.equal(await stop.isDisabled(), false, 'a failed native reconnect remains stoppable');
  await stop.click();
  await page.waitForFunction(() => document.querySelector('#wearableStatus').textContent.includes('측정 세션을 종료'));
  await page.evaluate(() => { window.PELoopWearableBridge.__failReconnect = false; });
  await start.click();
  await page.waitForFunction(() => window.PELoopWearableBridge.__calls.create.length === 4);
  await page.evaluate(() => window.PELoopWearableBridge.__emit({ type: 'device-ready', sessionId: 'test-session-5', device: { platform: 'galaxy-watch', model: 'Galaxy Watch Test', releaseDate: '2023-07-01', heartRateAvailable: true } }));
  await page.evaluate(() => window.PELoopWearableBridge.__emit({ type: 'sample', sessionId: 'test-session-5', metric: 'heartRate', value: 117, timestamp: Date.now() }));
  await page.waitForFunction(() => !document.querySelector('#wearableLiveValue').hidden);
  await page.evaluate(() => window.PELoopWearableBridge.__emit({ type: 'disconnected', source: 'network', sessionId: 'test-session-5' }));
  await page.waitForFunction(() => document.querySelector('#wearableLiveValue').hidden && document.querySelector('#wearableStatus').textContent.includes('로컬 Wi-Fi'));
  assert.equal(await reconnect.isDisabled(), true, 'LAN recovery is handled by the phone session rather than a new teacher QR');
  assert.equal(await page.locator('#routine-stretching').isEnabled(), true, 'class activity continues after LAN loss');
  await page.evaluate(() => window.PELoopWearableBridge.__emit({ type: 'network-reconnected', sessionId: 'test-session-5' }));
  await page.waitForFunction(() => document.querySelector('#wearableStatus').textContent.includes('새 심박 측정값'));
  assert.equal(await page.locator('#wearableLiveValue').isVisible(), false, 'automatic reconnection does not restore a pre-gap value');
  await page.evaluate(() => window.PELoopWearableBridge.__emit({ type: 'device-ready', sessionId: 'test-session-5', device: { platform: 'galaxy-watch', model: 'Galaxy Watch Test', releaseDate: '2023-07-01', heartRateAvailable: true } }));
  await page.evaluate(() => window.PELoopWearableBridge.__emit({ type: 'sample', sessionId: 'test-session-5', metric: 'heartRate', value: 122, timestamp: Date.now() }));
  await page.waitForFunction(() => !document.querySelector('#wearableLiveValue').hidden && document.querySelector('#wearableLiveValue').textContent.includes('122 bpm'));
  await page.evaluate(() => classroomUI.closeAll());
  assert.equal(await page.evaluate(() => window.PELoopWearableBridge.__calls.stop.length), 4, 'consent withdrawal, unavailable permission, failed reconnect cleanup, and PIN lock stop their native sessions');
  assert.deepEqual(errors, []);
console.log('consent-gated LAN QR, phone permission failure, in-memory heart-rate display, watch reconnect, automatic LAN recovery and privacy boundaries passed with a test bridge');
}, {
  beforeApp: async page => {
    await page.addInitScript(() => {
      const listeners = new Set();
      const calls = { create: [], reconnect: [], stop: [] };
      let sessionNumber = 0;
      function pairingPayload() {
        const invitation = { v: 1, host: '192.168.1.9', port: 8443, sessionId: '550e8400-e29b-41d4-a716-446655440000', ticket: 'A'.repeat(43), fingerprint: 'b'.repeat(64), expiresAt: Date.now() + 120000 };
        return `PELOOP_PAIR_V1.${btoa(JSON.stringify(invitation)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
      }
      window.PELoopWearableBridge = {
        version: 2,
        __calls: calls,
        __failReconnect: false,
        async createPairingSession(request) { calls.create.push(request); sessionNumber += 1; return { sessionId: `test-session-${sessionNumber}`, pairingPayload: pairingPayload() }; },
        async reconnectSession(request) { calls.reconnect.push(request); if (window.PELoopWearableBridge.__failReconnect) throw new Error('test reconnect failure'); sessionNumber += 1; return { sessionId: `test-session-${sessionNumber}`, pairingPayload: pairingPayload() }; },
        async stopSession(request) { calls.stop.push(request); },
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        __emit(event) { for (const listener of listeners) listener(event); },
      };
    });
  },
});
