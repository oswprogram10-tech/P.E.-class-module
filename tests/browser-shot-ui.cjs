const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { withBrowser } = require('./browser-helper.cjs');

async function unlockSettings(page) {
  await page.locator('#teacherButton').click();
  await page.locator('#unlockPin').fill('123456');
  await page.locator('#unlockButton').click();
  await page.locator('#teacherContentPanel').waitFor({ state: 'visible' });
}

async function inject(page, frames, side = 'right', delayMs = 280) {
  return page.evaluate(async ({ frames, side, delayMs }) => {
    const makePose = phase => {
      const points = Array.from({ length: 33 }, () => ({ x: .5, y: .5, visibility: .95 }));
      const coords = { 0:[.5,.12], 7:[.44,.15], 8:[.56,.15], 11:[.4,.34], 12:[.6,.34], 13:[.35,.45], 14:[.65,.45], 15:[.3,.55], 16:[.7,.55], 23:[.43,.60], 24:[.57,.60], 25:[.43,.72], 26:[.57,.72], 27:[.43,.88], 28:[.57,.88], 31:[.4,.94], 32:[.6,.94] };
      for (const [index, [x, y]] of Object.entries(coords)) Object.assign(points[index], { x, y });
      if (phase === 'missing') return [];
      if (phase === 'low') points[side === 'left' ? 7 : 8].visibility = .1;
      const [elbow, wrist, shoulder] = side === 'left' ? [13, 15, .4] : [14, 16, .6];
      const sign = side === 'left' ? -1 : 1;
      if (phase === 'ready') { Object.assign(points[elbow], { x: shoulder + sign * .06, y: .25 }); Object.assign(points[wrist], { x: shoulder, y: .17 }); }
      if (phase === 'shoot') { Object.assign(points[elbow], { x: shoulder, y: .22 }); Object.assign(points[wrist], { x: shoulder, y: .08 }); }
      return points;
    };
    for (const phase of frames) {
      if (delayMs) await new Promise(resolve => setTimeout(resolve, delayMs));
      poseUI.receive({ timestamp: performance.now(), width: 640, height: 480, landmarks: [makePose(phase)] });
    }
    return { state: $('shotPanel').dataset.state, status: $('shotStatus').textContent, angle: $('shotAngle').textContent, readyFrames: poseUI.stableFrames };
  }, { frames, side, delayMs });
}

withBrowser(async (page, errors) => {
  const initial = await page.evaluate(() => ({ ...shotSettings, shotState: $('shotPanel').dataset.state, teacherDialogOpen: $('teacherDialog').open }));
  assert.deepEqual(initial, { enabled: false, side: 'right', sensitivity: 'normal', shotState: 'waiting', teacherDialogOpen: false });
  assert.equal(await page.locator('#teacherShotEnabled').isVisible(), false, 'settings must remain behind teacher PIN access');

  // Saving is guarded by the open, PIN-unlocked teacher settings dialog.
  const unchanged = await page.evaluate(() => localStorage.getItem('pe-loop-settings-v1'));
  assert.equal(await page.evaluate(() => saveShotSettings()), false);
  assert.equal(await page.evaluate(() => localStorage.getItem('pe-loop-settings-v1')), unchanged);

  await unlockSettings(page);
  assert.deepEqual(await page.evaluate(() => ({ enabled: $('teacherShotEnabled').checked, side: $('teacherShotSide').value, sensitivity: $('teacherShotSensitivity').value })), { enabled: false, side: 'right', sensitivity: 'normal' });
  await page.locator('#teacherShotEnabled').check();
  await page.locator('#teacherShotSide').selectOption('right');
  await page.locator('#teacherShotSensitivity').selectOption('normal');
  await page.locator('#saveShotSettings').click();
  await page.waitForFunction(() => shotSettings.enabled && shotSettings.side === 'right' && shotSettings.sensitivity === 'normal');
  assert.match(await page.locator('#shotSettingsStatus').textContent(), /저장했어요/);

  await page.evaluate(() => {
    const side = $('teacherShotSide');
    side.add(new Option('invalid test value', 'auto'));
    side.value = 'auto'; side.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.locator('#saveShotSettings').click();
  assert.match(await page.locator('#shotSettingsStatus').textContent(), /올바르지 않아/);
  assert.equal(await page.evaluate(() => shotSettings.side), 'right');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('pe-loop-settings-v1')).shot.side), 'right');

  // A storage error must leave the previous validated setting intact.
  await page.locator('#teacherShotSide').selectOption('left');
  await page.locator('#teacherShotSensitivity').selectOption('high');
  await page.evaluate(() => {
    window.restoreSettingsStorage = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'pe-loop-settings-v1') throw new DOMException('full', 'QuotaExceededError');
      return window.restoreSettingsStorage.call(this, key, value);
    };
  });
  await page.locator('#saveShotSettings').click();
  await page.waitForFunction(() => /저장하지 못해/.test($('shotSettingsStatus').textContent));
  assert.deepEqual(await page.evaluate(() => ({ ...shotSettings, sideInput: $('teacherShotSide').value, sensitivityInput: $('teacherShotSensitivity').value })), { enabled: true, side: 'right', sensitivity: 'normal', sideInput: 'right', sensitivityInput: 'normal' });
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('pe-loop-settings-v1')).shot.side), 'right');
  await page.evaluate(() => { Storage.prototype.setItem = window.restoreSettingsStorage; });

  await page.locator('#teacherShotSide').selectOption('left');
  await page.locator('#teacherShotSensitivity').selectOption('high');
  await page.locator('#saveShotSettings').click();
  await page.waitForFunction(() => shotSettings.side === 'left' && shotSettings.sensitivity === 'high');
  await page.locator('#teacherDelay').fill('1');
  await page.locator('#teacherDelay').dispatchEvent('input');
  let saved = await page.evaluate(() => JSON.parse(localStorage.getItem('pe-loop-settings-v1')));
  assert.equal(saved.delaySeconds, 1);
  assert.deepEqual(saved.shot, { enabled: true, side: 'left', sensitivity: 'high' }, 'delay changes preserve shot settings');
  const validStored = await page.evaluate(() => localStorage.getItem('pe-loop-settings-v1'));
  await page.locator('#teacherDialog .close-button').click();

  // Malformed persisted options fail closed to the safe, disabled defaults.
  await page.evaluate(() => {
    const value = JSON.parse(localStorage.getItem('pe-loop-settings-v1'));
    value.shot = { enabled: true, side: 'auto', sensitivity: 'sensitive' };
    localStorage.setItem('pe-loop-settings-v1', JSON.stringify(value));
  });
  await page.reload(); await page.waitForFunction(() => appReady);
  assert.deepEqual(await page.evaluate(() => ({ ...shotSettings, issue: /저장된 농구 설정/.test(shotSettingsIssue) })), { enabled: false, side: 'right', sensitivity: 'normal', issue: true });
  await page.evaluate(valid => localStorage.setItem('pe-loop-settings-v1', valid), validStored);
  await page.reload(); await page.waitForFunction(() => appReady);
  await unlockSettings(page);
  assert.deepEqual(await page.evaluate(() => ({ enabled: $('teacherShotEnabled').checked, side: $('teacherShotSide').value, sensitivity: $('teacherShotSensitivity').value })), { enabled: true, side: 'left', sensitivity: 'high' });
  await page.locator('#teacherDialog .close-button').click();

  // Warm the pinned assets online, then verify the controlled app and real worker again offline.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => appReady && navigator.serviceWorker.controller, null, { timeout: 30000 });
  await page.locator('#posePrepare').click();
  await page.waitForFunction(() => poseUI.prepared, null, { timeout: 60000 });
  await page.context().setOffline(true);
  try {
    await page.reload();
    await page.waitForFunction(() => appReady && navigator.serviceWorker.controller, null, { timeout: 30000 });
    await unlockSettings(page);
    await page.locator('#teacherDialog .close-button').click();
    await page.locator('#posePrepare').click();
    await page.waitForFunction(() => poseUI.prepared, null, { timeout: 30000 });
    await page.locator('#cameraButton').click();
    await page.waitForFunction(() => cameraStream && lastDrawnFrame, null, { timeout: 20000 });
    await page.locator('#poseEnabled').check();
    await page.waitForFunction(() => poseUI.running && poseUI.metrics.results > 0, null, { timeout: 60000 });
    const offlineWorker = await page.evaluate(() => ({ results: poseUI.metrics.results, runtimeReady: poseUI.runtime.ready, serviceWorker: Boolean(navigator.serviceWorker.controller) }));
    assert.ok(offlineWorker.results > 0 && offlineWorker.runtimeReady && offlineWorker.serviceWorker, JSON.stringify(offlineWorker));

    // A real official fixture result reaches the pure detector with its source dimensions.
    const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/pose-sample.jpg')).toString('base64');
    const actualFrame = await page.evaluate(async encoded => {
      const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
      const runtime = new PoseRuntime({ minIntervalMs: 0 });
      let resolveResult;
      try {
        await runtime.prepare();
        await runtime.start({ onResult: resolve => resolveResult(resolve) });
        const result = new Promise(resolve => { resolveResult = resolve; });
        if (!runtime.submit(bitmap, performance.now())) throw new Error('fixture frame rejected');
        const frame = await Promise.race([result, new Promise((_, reject) => setTimeout(() => reject(new Error('fixture inference timeout')), 30000))]);
        const detector = new BasketballShot.Detector({ side: 'left', sensitivity: 'high' });
        const detected = detector.update({ landmarks: frame.landmarks[0], timestamp: frame.timestamp, width: frame.width, height: frame.height });
        return { count: frame.landmarks[0]?.length || 0, width: frame.width, height: frame.height, gate: PosePresence.analyze(frame.landmarks[0]).usable, detected };
      } finally { runtime.close(); }
    }, fixture);
    assert.deepEqual({ count: actualFrame.count, gate: actualFrame.gate }, { count: 33, gate: true });
    assert.ok(actualFrame.width > 0 && actualFrame.height > 0 && Number.isFinite(actualFrame.detected.angle));
    assert.equal(actualFrame.detected.event, false, 'one static fixture frame is not a shot event');

    // Freeze actual camera submissions and inject only synthetic full-body landmarks below.
    await page.evaluate(() => {
      window.realShotSubmit = poseUI.runtime.submit.bind(poseUI.runtime);
      poseUI.runtime.submit = bitmap => { bitmap.close(); return false; };
      window.shotEvents = [];
      const render = poseUI.onShotState.bind(poseUI);
      poseUI.onShotState = snapshot => { render(snapshot); window.shotEvents.push(snapshot); };
      window.syntheticShotContext = 'class-1|student-1|lesson-1|device-1';
      poseUI.shotContext = () => window.syntheticShotContext;
    });
    await page.waitForFunction(() => !poseUI.runtime.inflight, null, { timeout: 10000 });
    await page.evaluate(() => { poseUI.resetShot('synthetic-test'); poseUI.stableFrames = 0; window.shotEvents = []; });

    // A bent, raised arm reaches READY; extension over frames/time emits only one event.
    await inject(page, ['ready', 'ready', 'ready', 'ready', 'shoot', 'shoot'], 'left');
    assert.equal(await page.locator('#shotPanel').getAttribute('data-state'), 'shoot');
    assert.match(await page.locator('#shotStatus').textContent(), /팔 펴기 동작을 감지/);
    assert.equal(await page.evaluate(() => shotEvents.filter(event => event.event).length), 1);
    await inject(page, ['shoot', 'shoot', 'shoot'], 'left');
    assert.equal(await page.evaluate(() => shotEvents.filter(event => event.event).length), 1, 'held extension is not counted repeatedly');

    // A tracking loss and low-confidence frame reset READY; extension alone cannot fire.
    await inject(page, ['missing'], 'left', 0);
    assert.equal(await page.locator('#shotPanel').getAttribute('data-state'), 'waiting');
    await inject(page, ['shoot', 'shoot', 'shoot'], 'left');
    assert.equal(await page.evaluate(() => shotEvents.filter(event => event.event).length), 1);
    await inject(page, ['ready', 'ready', 'ready', 'ready', 'shoot', 'shoot'], 'left');
    assert.equal(await page.evaluate(() => shotEvents.filter(event => event.event).length), 2);
    await inject(page, ['low'], 'left', 0);
    assert.equal(await page.locator('#shotPanel').getAttribute('data-state'), 'waiting');
    assert.equal(await page.locator('#shotAngle').textContent(), '—');

    // Waiting more than the detector gap clears its prior phase.
    await inject(page, ['ready', 'ready', 'ready', 'ready'], 'left');
    assert.equal(await page.locator('#shotPanel').getAttribute('data-state'), 'ready');
    await page.waitForTimeout(1200);
    await page.waitForFunction(() => $('shotPanel').dataset.state === 'waiting', null, { timeout: 2500 });
    await inject(page, ['shoot', 'shoot'], 'left');
    assert.equal(await page.evaluate(() => shotEvents.filter(event => event.event).length), 2, 'a gap cannot continue READY');

    // A class/student binding change discards READY too.
    await inject(page, ['ready', 'ready', 'ready', 'ready'], 'left');
    assert.equal(await page.locator('#shotPanel').getAttribute('data-state'), 'ready');
    await page.evaluate(() => { window.syntheticShotContext = 'class-1|student-2|lesson-1|device-1'; });
    await inject(page, ['shoot', 'shoot'], 'left');
    assert.equal(await page.evaluate(() => shotEvents.filter(event => event.event).length), 2, 'student context change cannot continue a prior READY');
    assert.equal(await page.locator('#shotPanel').getAttribute('data-state'), 'waiting');
    await inject(page, ['ready', 'ready', 'ready', 'ready', 'shoot', 'shoot'], 'left');
    assert.equal(await page.evaluate(() => shotEvents.filter(event => event.event).length), 3);

    // Selection suspends/reset detection; the camera resumes with a fresh READY requirement.
    await inject(page, ['lower', 'lower', 'ready', 'ready'], 'left');
    assert.equal(await page.locator('#shotPanel').getAttribute('data-state'), 'ready');
    await page.waitForFunction(() => !$('openClipButton').disabled, null, { timeout: 20000 });
    await page.locator('#openClipButton').click();
    await page.waitForFunction(() => $('clipDialog').open);
    assert.equal(await page.locator('#shotPanel').getAttribute('data-state'), 'waiting');
    assert.equal(await page.evaluate(() => poseUI.running), false);
    await page.locator('#clipDialog .close-button').click();
    await page.waitForFunction(() => poseUI.running, null, { timeout: 30000 });
    await inject(page, ['shoot', 'shoot', 'shoot'], 'left');
    assert.equal(await page.evaluate(() => shotEvents.filter(event => event.event).length), 3, 'clip selection cannot reuse READY');
    await inject(page, ['ready', 'ready', 'ready', 'ready'], 'left');
    assert.equal(await page.locator('#shotPanel').getAttribute('data-state'), 'ready');

    // Opening settings suspends/reset detection; the new handedness applies only after a fresh READY.
    await page.locator('#teacherButton').click();
    assert.equal(await page.locator('#shotPanel').getAttribute('data-state'), 'waiting');
    await page.locator('#unlockPin').fill('123456'); await page.locator('#unlockButton').click();
    await page.locator('#teacherContentPanel').waitFor({ state: 'visible' });
    await page.locator('#teacherShotSide').selectOption('right');
    await page.locator('#teacherShotSensitivity').selectOption('normal');
    await page.locator('#saveShotSettings').click();
    await page.waitForFunction(() => shotSettings.side === 'right' && shotSettings.sensitivity === 'normal');
    await page.locator('#teacherDialog .close-button').click();
    await page.waitForFunction(() => poseUI.running, null, { timeout: 30000 });
    await inject(page, ['shoot', 'shoot', 'shoot']);
    assert.equal(await page.evaluate(() => shotEvents.filter(event => event.event).length), 3, 'settings change requires a fresh READY');
    await inject(page, ['ready', 'ready', 'ready', 'ready', 'shoot', 'shoot']);
    assert.equal(await page.evaluate(() => shotEvents.filter(event => event.event).length), 4);

    // The document visibility event stops camera analysis and clears any ready phase.
    await inject(page, ['lower', 'lower', 'ready', 'ready']);
    assert.equal(await page.locator('#shotPanel').getAttribute('data-state'), 'ready');
    const hiddenDescriptor = await page.evaluate(() => Object.getOwnPropertyDescriptor(document, 'hidden'));
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForFunction(() => !cameraStream && !poseUI.running, null, { timeout: 15000 });
    assert.equal(await page.locator('#shotPanel').getAttribute('data-state'), 'waiting');
    await page.evaluate(descriptor => { if (descriptor) Object.defineProperty(document, 'hidden', descriptor); else delete document.hidden; }, hiddenDescriptor);
    await page.locator('#cameraButton').click();
    await page.waitForFunction(() => cameraStream && poseUI.running, null, { timeout: 60000 });
    await inject(page, ['shoot', 'shoot', 'shoot']);
    assert.equal(await page.evaluate(() => shotEvents.filter(event => event.event).length), 4, 'visibility stop cannot reuse READY');
    await inject(page, ['ready', 'ready', 'ready', 'ready', 'shoot', 'shoot']);
    assert.equal(await page.evaluate(() => shotEvents.filter(event => event.event).length), 5);

    // A real camera interruption stops the worker and clears the ready phase before restart.
    await page.evaluate(() => cameraStream.getVideoTracks()[0].dispatchEvent(new Event('ended')));
    await page.waitForFunction(() => !cameraStream && !poseUI.running && !poseUI.runtime.worker, null, { timeout: 15000 });
    assert.equal(await page.locator('#shotPanel').getAttribute('data-state'), 'waiting');
    await page.evaluate(() => { poseUI.runtime.submit = window.realShotSubmit; });
    const resultsBeforeRestart = await page.evaluate(() => poseUI.metrics.results);
    await page.locator('#cameraButton').click();
    await page.waitForFunction(before => cameraStream && poseUI.running && poseUI.metrics.results > before, resultsBeforeRestart, { timeout: 60000 });
    const resultsAfterRestart = await page.evaluate(() => poseUI.metrics.results);
    assert.ok(resultsAfterRestart > resultsBeforeRestart, 'cached model worker resumes after interruption');
    await page.evaluate(() => { poseUI.runtime.submit = bitmap => { bitmap.close(); return false; }; });
    await page.waitForFunction(() => !poseUI.runtime.inflight, null, { timeout: 10000 });
    await page.evaluate(() => { poseUI.resetShot('synthetic-test'); poseUI.stableFrames = 0; });
    await inject(page, ['shoot', 'shoot', 'shoot']);
    assert.equal(await page.evaluate(() => shotEvents.filter(event => event.event).length), 5, 'restart cannot reuse pre-interruption READY');

    const persisted = await page.evaluate(async () => ({
      shot: JSON.parse(localStorage.getItem('pe-loop-settings-v1')).shot,
      clips: await repository.count(),
      shotEventStored: Object.keys(JSON.parse(localStorage.getItem('pe-loop-settings-v1'))).some(key => /event|attempt|score|angle/i.test(key)),
    }));
    assert.deepEqual(persisted, { shot: { enabled: true, side: 'right', sensitivity: 'normal' }, clips: 0, shotEventStored: false });
    console.log('PASS teacher PIN guard, validated settings persistence and write-failure recovery');
    console.log('PASS offline cached model worker, synthetic READY/SHOOT re-arm, confidence/tracking/context/settings/interruption resets');
    console.log('Evidence distinction: cached worker inference responds to fake-camera frames; a separate real fixture inference produced 33 landmarks and a finite detector angle without a shot event; READY/SHOOT sequences use synthetic landmarks and do not establish shot accuracy.');
  } finally {
    await page.context().setOffline(false);
  }

  // PIN reset must keep its existing delete-all semantics and restore shot detection to disabled defaults.
  await page.locator('#cameraButton').click().catch(() => {});
  await page.locator('#teacherButton').click();
  await page.locator('#forgotPinButton').click();
  await page.locator('#resetNewPin').fill('654321');
  await page.locator('#resetConfirmPin').fill('654321');
  await page.locator('#resetPhrase').fill('모두 삭제');
  await page.locator('#confirmResetButton').click();
  await page.waitForFunction(() => !$('resetDialog').open);
  assert.deepEqual(await page.evaluate(() => ({ ...shotSettings, stored: JSON.parse(localStorage.getItem('pe-loop-settings-v1')).shot })), {
    enabled: false, side: 'right', sensitivity: 'normal', stored: { enabled: false, side: 'right', sensitivity: 'normal' },
  });
  assert.deepEqual(errors, []);
  console.log('PASS local PIN/data reset returns basketball settings to disabled defaults');
}).catch(error => { console.error(error); process.exitCode = 1; });
