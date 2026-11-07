const { withBrowser } = require('./browser-helper.cjs');
const assert = require('node:assert/strict');

withBrowser(async (page, errors) => {
  // Permission and hardware failures must be actionable and retryable.
  for (const [name, expected] of [['NotAllowedError', '권한'], ['NotFoundError', '카메라가 없어요'], ['NotReadableError', '다른 앱']]) {
    await page.evaluate(errorName => {
      window.originalGetUserMedia ||= navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('synthetic failure', errorName); };
    }, name);
    await page.locator('#cameraButton').click();
    await page.waitForFunction(() => !cameraStarting);
    assert.match(await page.locator('#cameraNotice').textContent(), new RegExp(expected));
    assert.equal(await page.locator('#cameraButton').isDisabled(), false);
    assert.equal(await page.evaluate(() => cameraStream), null);
  }
  console.log('Permission / missing / busy camera retries passed');

  // A request completed after interruption must not reopen the camera or append old frames.
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { window.resolvePendingCamera = resolve; });
  });
  await page.locator('#cameraButton').click();
  await page.waitForFunction(() => cameraStarting);
  await page.evaluate(async () => {
    interruptCamera('테스트 중단');
    window.lateStream = await window.originalGetUserMedia({ video: true, audio: false });
    window.resolvePendingCamera(window.lateStream);
  });
  await page.waitForFunction(() => window.lateStream.getTracks().every(track => track.readyState === 'ended'));
  assert.equal(await page.evaluate(() => frameHistory.length), 0);
  assert.equal(await page.evaluate(() => cameraStream), null);
  console.log('Late permission result disposal passed');

  await page.evaluate(() => { navigator.mediaDevices.getUserMedia = window.originalGetUserMedia; setDelay(1); });
  await page.locator('#cameraButton').click();
  await page.waitForFunction(() => frameHistory.length > 0);
  assert.equal(await page.locator('#openClipButton').isDisabled(), true);
  await page.evaluate(() => openClipDialog());
  assert.equal(await page.evaluate(() => $('clipDialog').open), false);
  await page.waitForFunction(() => lastDrawnFrame && lastDrawnFrame - frameHistory[0].time >= 5400);
  // Keep a chosen clip while clearing the live buffer at a capture interruption.
  await page.locator('#openClipButton').click();
  const snapshotEnd = await page.evaluate(() => selectionSnapshot.at(-1).time);
  await page.evaluate(() => cameraStream.getVideoTracks()[0].dispatchEvent(new Event('ended')));
  assert.equal(await page.evaluate(() => cameraStream), null);
  assert.equal(await page.evaluate(() => frameHistory.length), 0);
  assert.equal(await page.evaluate(() => selectionSnapshot.at(-1).time), snapshotEnd);
  assert.match(await page.locator('#cameraNotice').textContent(), /끊겼어요/);
  await page.locator('#clipDialog .close-button').click();
  await page.locator('#cameraButton').click();
  await page.waitForFunction(() => frameHistory.length > 0);
  assert.ok(await page.evaluate(previous => frameHistory[0].time > previous, snapshotEnd));
  console.log('Track interruption and clean restart passed');

  await page.waitForFunction(() => lastDrawnFrame && lastDrawnFrame - frameHistory[0].time >= 5400);
  await page.locator('#openClipButton').click();
  await page.locator('#clipLength').fill('5');
  await page.locator('#clipLength').dispatchEvent('input');
  await page.locator('#studentName').fill('가상학생');
  await page.locator('#studentNumber').fill('2');
  await page.evaluate(() => {
    window.encodeBeforeInterruption = ClipExporter.export;
    ClipExporter.export = options => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    });
  });
  await page.locator('#saveClipButton').click();
  // Deterministic visibility event test; this does not emulate Android OS suspension.
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  assert.equal(await page.evaluate(() => cameraStream), null);
  assert.equal(await page.evaluate(() => frameHistory.length), 0);
  await page.waitForFunction(() => !saving);
  assert.equal(await page.evaluate(() => studioState), 'interrupted');
  assert.equal(await page.evaluate(async () => (await allClips()).length), 0);
  assert.match(await page.locator('#saveProgress').textContent(), /중단/);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  assert.equal(await page.evaluate(() => cameraStream), null, 'must not restart without user action');
  await page.evaluate(() => { ClipExporter.export = window.encodeBeforeInterruption; });
  await page.locator('#saveClipButton').click();
  await page.waitForFunction(() => !$('clipDialog').open, {}, { timeout: 12000 });
  assert.equal(await page.evaluate(async () => (await allClips()).length), 1);
  assert.equal(await page.evaluate(() => cameraStream), null);
  await page.locator('#cameraButton').click();
  await page.waitForFunction(() => frameHistory.length > 0);
  await page.locator('#cameraButton').click();
  assert.equal(await page.evaluate(() => teacherKey), null);
  assert.equal(await page.evaluate(() => frameHistory.length), 0);
  assert.deepEqual(errors, []);
  console.log('Visibility stop, explicit resume, session cleanup passed');
}).catch(error => { console.error(error); process.exitCode = 1; });
