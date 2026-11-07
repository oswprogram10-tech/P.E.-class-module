const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { withBrowser } = require('./browser-helper.cjs');

const fixture = fs.readFileSync(path.join(__dirname, 'fixtures/pose-sample.jpg')).toString('base64');
assert.ok(fs.existsSync(path.join(__dirname, '../vendor/pose/pose_landmarker_lite.task')), 'official model required');

withBrowser(async (page, errors, baseUrl) => {
  const requests = [];
  page.on('request', r => requests.push({ url: r.url(), method: r.method() }));
  const defaults = () => page.evaluate(() => ({ toggles: ['shotVisualEnabled', 'shotSoundEnabled', 'shotCaptureEnabled'].map(id => $(id).checked), options: { ...shotFeedback.options }, capture: poseUI.captureEnabled }));
  const checkDefaults = async () => assert.deepEqual(await defaults(), { toggles: [false, false, false], options: { visual: false, sound: false, capture: false }, capture: false });
  const unlock = async () => {
    await page.locator('#teacherButton').click(); await page.locator('#unlockPin').fill('123456');
    await page.locator('#unlockButton').click(); await page.locator('#teacherContentPanel').waitFor({ state: 'visible' });
  };
  await checkDefaults(); await unlock();
  await page.locator('#teacherShotEnabled').check(); await page.locator('#saveShotSettings').click();
  await page.waitForFunction(() => shotSettings.enabled); await page.locator('#teacherDialog .close-button').click();
  await page.locator('#posePrepare').click(); await page.waitForFunction(() => poseUI.prepared, null, { timeout: 60000 });
  await page.evaluate(() => navigator.serviceWorker.ready);

  async function runPhase(label) {
    await page.locator('#cameraButton').click();
    await page.waitForFunction(() => cameraStream && captureLoop && lastDrawnFrame, null, { timeout: 30000 });
    await page.locator('#shotVisualEnabled').check(); await page.locator('#shotCaptureEnabled').check();
    await page.locator('#poseEnabled').check();
    await page.waitForFunction(() => poseUI.running && poseUI.runtime.ready, null, { timeout: 60000 });
    assert.equal(await page.evaluate(() => shotFeedback.available()), true, 'real application active predicate');
    await page.evaluate(async encoded => {
      clearTimeout(poseUI.timer); poseUI.schedule = () => {};
      while (poseUI.copying || poseUI.runtime.inflight) await new Promise(resolve => setTimeout(resolve, 10));
      const image = new Image(); image.src = 'data:image/jpeg;base64,' + encoded; await image.decode();
      Object.defineProperties(image, { videoWidth: { value: image.naturalWidth }, videoHeight: { value: image.naturalHeight }, readyState: { value: 4 } });
      poseUI.video = image; poseUI.stableFrames = 0; poseUI.resetShot('fixture-test');
      window.fixtureFrames = []; window.fixtureEvents = [];
      const process = poseUI.processResult.bind(poseUI);
      poseUI.processResult = (result, frame) => {
        window.fixtureFrames.push({ timestamp: result.timestamp, count: result.landmarks[0]?.length || 0, gate: PosePresence.analyze(result.landmarks[0]), width: result.width, height: result.height });
        return process(result, frame);
      };
      const previousUpdate = poseUI.shotDetector.update.bind(poseUI.shotDetector); let eventIssued = false;
      poseUI.shotDetector.update = args => {
        const natural = previousUpdate(args);
        if (!eventIssued) { eventIssued = true; return { state: 'shoot', angle: natural.angle, event: true, reason: null }; }
        return natural;
      };
      const output = poseUI.onShotState.bind(poseUI);
      poseUI.onShotState = (snapshot, frame) => {
        if (snapshot.event) {
          let pixels = null;
          if (frame?.bitmap) {
            const canvas = document.createElement('canvas'); canvas.width = frame.bitmap.width; canvas.height = frame.bitmap.height;
            const ctx = canvas.getContext('2d'); ctx.drawImage(frame.bitmap, 0, 0); pixels = Array.from(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
          }
          window.fixtureEvents.push({ timestamp: snapshot.timestamp, frameTime: frame?.timestamp ?? null, width: frame?.bitmap.width ?? null, height: frame?.bitmap.height ?? null, pixels });
        }
        output(snapshot, frame);
      };
    }, fixture);
    for (let i = 0; i < 5; i++) {
      const count = await page.evaluate(() => fixtureFrames.length);
      await page.evaluate(() => poseUI.sample(poseUI.generation));
      await page.waitForFunction(before => fixtureFrames.length > before, count, { timeout: 30000 });
      if (await page.evaluate(() => fixtureEvents.length)) break;
      await page.waitForTimeout(320);
    }
    const observed = await page.evaluate(() => ({ frames: fixtureFrames, events: fixtureEvents.map(({pixels, ...rest}) => rest), pending: !!poseUI.pendingFrame }));
    assert.ok(observed.frames.length > 0 && observed.frames.every(frame => frame.count === 33));
    const fullBody = observed.frames.some(frame => frame.gate.usable);
    if (!fullBody || !observed.events.length) {
      console.log(`${label}: real worker input and 33 landmarks observed; 320px fixture did not produce stable gate/event`, JSON.stringify(observed));
      await page.evaluate(() => stopCamera());
      return { fullBody, event: false };
    }
    await page.waitForFunction(() => shotFeedback.lastCapture && !$('shotCaptureFigure').hidden && !shotFeedback.encoding, null, { timeout: 30000 });
    const captured = await page.evaluate(async () => {
      await $('shotCaptureImage').decode();
      const img = $('shotCaptureImage'); const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0); const actual = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const expected = fixtureEvents[0].pixels; let sum = 0;
      for (let i = 0; i < actual.length; i += 4) for (let c = 0; c < 3; c++) sum += Math.abs(actual[i + c] - expected[i + c]);
      return { timestamp: shotFeedback.lastCapture.timestamp, shown: Number($('shotFeedbackTime').dataset.timestamp), width: canvas.width, height: canvas.height, mae: sum / (canvas.width * canvas.height * 3), figureVisible: !$('shotCaptureFigure').hidden, active: shotFeedback.available(), pending: !!poseUI.pendingFrame };
    });
    const event = observed.events[0];
    assert.equal(event.timestamp, event.frameTime); assert.equal(captured.timestamp, event.timestamp); assert.equal(captured.shown, event.timestamp);
    assert.equal(captured.width, event.width); assert.equal(captured.height, event.height); assert.ok(captured.mae < 15, `JPEG pixel MAE ${captured.mae}`);
    assert.equal(captured.figureVisible, true); assert.equal(captured.active, true); assert.equal(captured.pending, false);
    console.log(`${label}: real model fixture with stubbed event, same input bitmap/time and actual app capture:`, JSON.stringify({ ...observed, captured }));
    await page.evaluate(() => stopCamera());
    return { fullBody, event: true };
  }

  const online = await runPhase('online');
  await page.context().setOffline(true);
  let offline;
  try {
    await page.reload(); await page.waitForFunction(() => appReady && navigator.serviceWorker.controller, null, { timeout: 30000 });
    await checkDefaults(); await unlock(); await page.locator('#teacherDialog .close-button').click();
    assert.equal(await page.evaluate(() => shotSettings.enabled), true);
    await page.locator('#posePrepare').click(); await page.waitForFunction(() => poseUI.prepared, null, { timeout: 30000 });
    offline = await runPhase('offline');
  } finally { await page.context().setOffline(false); }
  const nonlocal = requests.filter(r => !r.url.startsWith(baseUrl + '/') && !r.url.startsWith('blob:') && !r.url.startsWith('data:'));
  const writes = requests.filter(r => !['GET', 'HEAD'].includes(r.method));
  assert.deepEqual(nonlocal, []); assert.deepEqual(writes, []); assert.deepEqual(errors, []);
  assert.ok(online.event && offline.event, 'real model fixture did not complete stable gate/capture; no synthetic substitution');
  console.log('PASS online and offline real-worker-to-app capture bridge; event was deliberately stubbed, not a real shot detection.');
}).catch(error => { console.error(error); process.exitCode = 1; });
