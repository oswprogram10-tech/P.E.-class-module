const assert = require('node:assert/strict');
const { withBrowser } = require('./browser-helper.cjs');

withBrowser(async (page, errors) => {
  const result = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
    Object.defineProperties(canvas, { videoWidth: { value: 320 }, videoHeight: { value: 240 }, readyState: { value: 4 } });
    const ctx = canvas.getContext('2d'); let context = 'a', runtime, delivered = [], pendingCopy;
    const pixels = bitmap => { const c = document.createElement('canvas'); c.width = bitmap.width; c.height = bitmap.height; c.getContext('2d').drawImage(bitmap, 0, 0); return [...c.getContext('2d').getImageData(10, 10, 1, 1).data]; };
    class FakeRuntime {
      constructor() { runtime = this; this.inflight = false; }
      async start(callbacks) { this.callbacks = callbacks; }
      submit(bitmap, timestamp) { this.pixel = pixels(bitmap); bitmap.close(); this.time = timestamp; this.inflight = true; return true; }
      emit(timestamp = this.time) { this.inflight = false; this.callbacks.onResult({ timestamp, width: 320, height: 240, landmarks: [body()] }); }
      stop() { this.inflight = false; }
      close() { this.stop(); }
    }
    function body() {
      const p = Array.from({ length: 33 }, () => ({ x: .5, y: .5, visibility: .9 }));
      const coords = { 0:[.5,.1],7:[.44,.12],8:[.56,.12],11:[.4,.25],12:[.6,.25],13:[.35,.4],14:[.65,.4],15:[.3,.52],16:[.7,.52],23:[.43,.48],24:[.57,.48],25:[.43,.67],26:[.57,.67],27:[.43,.88],28:[.57,.88],31:[.4,.94],32:[.6,.94] };
      for (const [i, [x,y]] of Object.entries(coords)) Object.assign(p[i], {x,y}); return p;
    }
    const ui = new PoseUI({ video: canvas, cameraActive: () => true, paused: () => false, shotContext: () => context, runtimeFactory: () => new FakeRuntime(), onShotState: (snapshot, frame) => {
      if (snapshot.event) { delivered.push({ timestamp: snapshot.timestamp, frameTime: frame?.timestamp, pixel: frame ? pixels(frame.bitmap) : null }); frame?.bitmap.close(); }
    } });
    ui.prepared = true; ui.enabled = true; ui.shotSettings.enabled = true; ui.captureEnabled = true;
    ui.shotDetector = { lastTime: null, reset: reason => ({state:'waiting', event:false, reason}), update: () => ({state:'shoot', event:true, reason:null}) };
    ui.schedule = () => {}; await ui.cameraStarted(); ui.stableFrames = 2;
    ctx.fillStyle = 'rgb(230,20,40)'; ctx.fillRect(0, 0, 320, 240);
    await ui.sample(ui.generation);
    const sourcePixel = runtime.pixel, timestamp = runtime.time;
    ctx.fillStyle = 'rgb(10,30,220)'; ctx.fillRect(0, 0, 320, 240);
    runtime.emit();
    const matched = delivered[0];
    await ui.sample(ui.generation); context = 'b'; runtime.emit();
    const contextDiscarded = delivered.length === 1 && !ui.pendingFrame;
    await ui.sample(ui.generation); const invalidated = ui.pendingFrame.bitmap; ui.setCaptureEnabled(false);
    const closedOnDisable = invalidated.width === 0; runtime.emit();
    const invalidatedDiscarded = delivered.length === 1;
    ui.setCaptureEnabled(true);
    await ui.sample(ui.generation); const wrongFrame = ui.pendingFrame.bitmap; runtime.emit(runtime.time + 1);
    const mismatchClosed = wrongFrame.width === 0 && delivered.length === 1;
    await ui.sample(ui.generation); const throwingFrame = ui.pendingFrame.bitmap;
    ui.onShotState = () => { throw new Error('feedback failure'); };
    runtime.emit();
    const callbackIsolated = throwingFrame.width === 0 && ui.status === 'present';
    let nullCapture = false;
    ui.onShotState = (snapshot, frame) => { if (snapshot.event) nullCapture = frame === null && Number.isFinite(snapshot.timestamp); };
    const native = window.createImageBitmap;
    let failCalls = 0;
    window.createImageBitmap = async (...args) => { if (++failCalls === 2) throw new Error('copy failed'); return native(...args); };
    try { await ui.sample(ui.generation); runtime.emit(); } finally { window.createImageBitmap = native; }
    const cloneFailureHandled = nullCapture;
    const noPendingDropped = (() => { nullCapture = false; runtime.emit(); return !nullCapture; })();
    let timeoutCalls = 0, releaseTimed, timedBitmap;
    let timeoutEvents = [];
    ui.onShotState = (snapshot, frame) => { if (snapshot.event) { timeoutEvents.push(Boolean(frame?.bitmap)); frame?.bitmap.close(); } };
    window.createImageBitmap = async (...args) => {
      const bitmap = await native(...args);
      if (++timeoutCalls === 2) { timedBitmap = bitmap; await new Promise(resolve => { releaseTimed = resolve; }); }
      return bitmap;
    };
    let timeoutRecovered;
    try {
      const start = performance.now(); await ui.sample(ui.generation);
      const afterTimeout = performance.now() - start; runtime.emit();
      await ui.sample(ui.generation); runtime.emit();
      const noExtraClone = timeoutCalls === 3;
      releaseTimed();
      await new Promise(resolve => setTimeout(resolve, 20));
      const lateClosed = timedBitmap.width === 0 && !ui.captureCopyPending;
      await ui.sample(ui.generation); runtime.emit();
      timeoutRecovered = afterTimeout >= 200 && afterTimeout < 1000 && noExtraClone && lateClosed && timeoutEvents.join(',') === 'false,false,true';
    } finally { window.createImageBitmap = native; }
    let calls = 0, release, entered;
    const started = new Promise(resolve => { entered = resolve; });
    window.createImageBitmap = async (...args) => { const bitmap = await native(...args); if (++calls === 2) { pendingCopy = bitmap; entered(); await new Promise(resolve => { release = resolve; }); } return bitmap; };
    try {
      const slow = ui.sample(ui.generation); await started; ui.suspend(); release(); await slow;
    } finally { window.createImageBitmap = native; }
    const lateCopyClosed = pendingCopy.width === 0 && !ui.pendingFrame;
    ui.dispose();
    return { sourcePixel, timestamp, matched, contextDiscarded, closedOnDisable, invalidatedDiscarded, mismatchClosed, callbackIsolated, cloneFailureHandled, noPendingDropped, timeoutRecovered, lateCopyClosed };
  });
  assert.deepEqual(result.matched.pixel, result.sourcePixel);
  assert.equal(result.matched.timestamp, result.timestamp); assert.equal(result.matched.frameTime, result.timestamp);
  for (const key of ['contextDiscarded', 'closedOnDisable', 'invalidatedDiscarded', 'mismatchClosed', 'callbackIsolated', 'cloneFailureHandled', 'noPendingDropped', 'timeoutRecovered', 'lateCopyClosed']) assert.equal(result[key], true, key);
  assert.deepEqual(errors, []);
  console.log('PASS input bitmap identity and timestamp, context/reset invalidation, delayed copy cleanup:', JSON.stringify(result));
}).catch(error => { console.error(error); process.exitCode = 1; });
