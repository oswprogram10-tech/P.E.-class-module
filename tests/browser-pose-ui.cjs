const { withBrowser } = require('./browser-helper.cjs');
const assert = require('node:assert/strict');

withBrowser(async (page, errors) => {
  assert.equal(await page.locator('#poseEnabled').isChecked(), false);
  assert.equal(await page.locator('#poseSpeech').isChecked(), false);
  assert.equal(await page.locator('#poseEnabled').isDisabled(), true);
  assert.equal(await page.evaluate(() => poseUI.status), 'unprepared');
  // Force only the optional asset request to fail; base camera must keep working.
  await page.route('**/vendor/pose/**', route => route.fulfill({ status: 503, body: 'optional asset unavailable' }));
  await page.locator('#posePrepare').click();
  await page.waitForFunction(() => poseUI.status === 'error');
  assert.match(await page.locator('#poseStatus').textContent(), /기본 촬영은 계속/);
  await page.evaluate(() => setDelay(1)); await page.locator('#cameraButton').click();
  await page.waitForFunction(() => lastDrawnFrame && frameHistory.length > 10);
  const frames = await page.evaluate(() => frameHistory.length);
  await page.waitForFunction(before => frameHistory.length > before + 4, frames);
  await page.evaluate(() => stopCamera());
  await page.unroute('**/vendor/pose/**');

  const result = await page.evaluate(async () => {
    const outcomes = {};
    let active = false, paused = false, instance, holdPreparation = null, prepareStarted = false;
    class FakeRuntime {
      constructor() { instance = this; this.closed = false; this.stops = 0; }
      async prepare() { prepareStarted = true; if (holdPreparation) await holdPreparation.promise; }
      async start(callbacks) { this.callbacks = callbacks; }
      stop() { this.stops++; }
      submit(bitmap) { bitmap.close(); return false; }
      async clear() { this.cleared = true; }
      close() { this.closed = true; }
    }
    const ui = new PoseUI({ video: document.querySelector('#cameraVideo'), cameraActive: () => active, paused: () => paused, runtimeFactory: () => new FakeRuntime() });
    await ui.prepare(); outcomes.prepared = ui.status === 'ready';
    ui.setEnabled(true); outcomes.waiting = ui.status === 'waiting-camera';
    active = true; await ui.cameraStarted(); outcomes.running = ui.running;
    const sample = () => ({ timestamp: performance.now(), landmarks: [Array.from({ length: 33 }, (_, index) => {
      const p = { x: .5, y: .5, visibility: .9 };
      const coords = { 0:[.5,.1],7:[.44,.12],8:[.56,.12],11:[.4,.25],12:[.6,.25],13:[.35,.4],14:[.65,.4],15:[.3,.52],16:[.7,.52],23:[.43,.48],24:[.57,.48],25:[.43,.67],26:[.57,.67],27:[.43,.88],28:[.57,.88],31:[.4,.94],32:[.6,.94] };
      if (coords[index]) [p.x,p.y] = coords[index]; return p;
    })] });
    const emit = data => instance.callbacks.onResult(data);
    const reasons = [];
    for (const reason of ['missing', 'confidence', 'out-of-frame']) {
      const data = sample();
      if (reason === 'missing') data.landmarks = [[]];
      if (reason === 'confidence') data.landmarks[0][0].visibility = .2;
      if (reason === 'out-of-frame') data.landmarks[0][31].x = .01;
      emit(data); reasons.push({ state: ui.status, reason: ui.lastResult.reason, usable: ui.lastResult.usable });
    }
    outcomes.reasons = reasons;
    const recovery = []; for (let n = 0; n < 3; n++) { emit(sample()); recovery.push(ui.status); }
    outcomes.recovery = recovery; outcomes.usable = ui.lastResult.usable;
    const stale = sample(); stale.timestamp -= 3000; emit(stale); outcomes.stale = !ui.lastResult.usable && ui.lastResult.reason === 'stale';
    for (let n = 0; n < 3; n++) emit(sample());
    paused = true; await ui.sample(ui.generation); outcomes.paused = !ui.running && ui.lastResult === null;
    paused = false; await ui.cameraStarted();
    const oldCallbacks = instance.callbacks; ui.setEnabled(false); oldCallbacks.onResult(sample()); outcomes.lateIgnored = ui.lastResult === null && !ui.running;
    active = false; ui.setEnabled(true); outcomes.stopped = ui.status === 'waiting-camera';
    active = true; await ui.cameraStarted();
    const descriptor = Object.getOwnPropertyDescriptor(document, 'hidden');
    Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange'));
    outcomes.hidden = !ui.running && ui.lastResult === null;
    if (descriptor) Object.defineProperty(document, 'hidden', descriptor); else delete document.hidden;
    ui.setEnabled(false);
    holdPreparation = {}; holdPreparation.promise = new Promise(resolve => holdPreparation.resolve = resolve);
    prepareStarted = false; const pending = ui.prepare();
    while (!prepareStarted) await new Promise(resolve => setTimeout(resolve, 0));
    ui.cancelPreparation(); holdPreparation.resolve(); await pending; holdPreparation = null;
    outcomes.cancelled = !ui.prepared && ui.status === 'unprepared';
    await ui.prepare(); await ui.clear(); outcomes.cleared = instance.cleared && !ui.prepared && ui.status === 'unprepared';
    ui.dispose();
    const originalWorker = window.Worker;
    try { window.Worker = undefined; const unsupported = new PoseUI({ video: document.querySelector('#cameraVideo'), cameraActive: () => false, paused: () => false }); outcomes.unsupported = unsupported.status === 'unsupported' && document.querySelector('#posePrepare').disabled; unsupported.dispose(); } finally { window.Worker = originalWorker; }
    return outcomes;
  });
  assert.equal(result.prepared, true); assert.equal(result.waiting, true); assert.equal(result.running, true);
  assert.deepEqual(result.reasons, ['missing', 'confidence', 'out-of-frame'].map(reason => ({ state: 'unavailable', reason, usable: false })));
  assert.deepEqual(result.recovery, ['recovering', 'recovering', 'present']); assert.equal(result.usable, true);
  for (const key of ['stale', 'paused', 'lateIgnored', 'stopped', 'hidden', 'cancelled', 'cleared', 'unsupported']) assert.equal(result[key], true, key);
  assert.deepEqual(errors, []);
  console.log('PASS actual optional preparation failure leaves camera/delay usable');
  console.log('PASS FAKE runtime UI only: gate, recovery, stale/paused rejection, late callbacks, interruption, cancellation and clear; no model inference claimed');
}).catch(error => { console.error(error); process.exitCode = 1; });
