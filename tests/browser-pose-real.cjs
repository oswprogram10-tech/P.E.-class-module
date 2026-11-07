const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { withBrowser } = require('./browser-helper.cjs');

// This suite requires the pinned official model. It must never silently pass with a fake worker.
assert.ok(fs.existsSync(path.join(__dirname, '../vendor/pose/pose_landmarker_lite.task')), 'Install the official model before running this suite');

withBrowser(async (page, errors, baseUrl) => {
  const requests = [];
  page.on('request', request => requests.push({ url: request.url(), method: request.method(), type: request.resourceType() }));
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => appReady && navigator.serviceWorker.controller, null, { timeout: 30000 });
  await page.locator('#teacherButton').click();
  await page.locator('#unlockPin').fill('123456'); await page.locator('#unlockButton').click();
  await page.locator('#teacherContentPanel').waitFor({ state: 'visible' });
  await page.locator('#teacherDialog .close-button').click();
  await page.locator('#posePrepare').click();
  await page.waitForFunction(() => poseUI.status === 'ready', null, { timeout: 60000 });
  const sample = fs.readFileSync(path.join(__dirname, 'fixtures/pose-sample.jpg')).toString('base64');
  const infer = async () => page.evaluate(async encoded => {
    const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: 'image/jpeg' });
    const runtime = new PoseRuntime({ minIntervalMs: 0 });
    let resolve, reject;
    try {
      await runtime.prepare();
      await runtime.start({ onResult: result => resolve(result), onError: error => reject(error) });
      const timings = [], gates = []; let result;
      for (let i = 0; i < 5; i++) {
        const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
        if (!runtime.submit(await createImageBitmap(blob), performance.now())) throw new Error('frame rejected');
        if (i === 0 && runtime.submit(await createImageBitmap(blob), performance.now() + 1)) throw new Error('concurrent frame accepted');
        result = await Promise.race([promise, new Promise((_, fail) => setTimeout(() => fail(new Error('inference timeout')), 30000))]);
        timings.push(result.latencyMs);
        const pts = result.landmarks[0];
        gates.push({ gate: PosePresence.analyze(pts), minVisibility: Math.min(...PosePresence.REQUIRED_INDICES.map(i => pts?.[i]?.visibility ?? 0)), minPresence: pts && PosePresence.REQUIRED_INDICES.every(i => Number.isFinite(pts[i]?.presence)) ? Math.min(...PosePresence.REQUIRED_INDICES.map(i => pts[i].presence)) : null });
      }
      const points = result.landmarks[0];
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const context = canvas.getContext('2d'); const imageCases = {};
      for (const name of ['blank', 'cropped']) {
        context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
        if (name === 'cropped') context.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height / 2, 0, 0, canvas.width, canvas.height);
        imageCases[name] = [];
        for (let i = 0; i < 3; i++) {
          const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
          if (!runtime.submit(await createImageBitmap(canvas), performance.now())) throw new Error('image case rejected');
          const frame = await Promise.race([promise, new Promise((_, fail) => setTimeout(() => fail(new Error('case timeout')), 30000))]);
          imageCases[name].push({ count: frame.landmarks[0]?.length || 0, gate: PosePresence.analyze(frame.landmarks[0]) });
        }
      }
      bitmap.close();
      const actual = PosePresence.analyze(points);
      const low = structuredClone(points); low[0].visibility = 0.1;
      const outside = structuredClone(points); for (const i of PosePresence.REQUIRED_INDICES) { outside[i].visibility = .99; if ('presence' in outside[i]) outside[i].presence = .99; outside[i].x = Math.min(.97, Math.max(.03, outside[i].x)); outside[i].y = Math.min(.97, Math.max(.03, outside[i].y)); } outside[31].x = .01;
      const ui = poseUI; ui.enabled = true; ui.stableFrames = 0;
      const feed = landmarks => { ui.receive({ timestamp: performance.now(), landmarks: [landmarks], latencyMs: 0 }); return { state: ui.status, reason: ui.lastResult.reason }; };
      const transitions = [feed(points), feed(points), feed(points), feed(low), feed(points), feed(points), feed(points), feed(outside)];
      ui.enabled = false; ui.suspend(); ui.metrics = { submitted: 0, skipped: 0, results: 0, copiesMs: [], inferenceMs: [] }; ui.state('ready', '준비됐어요.');
      return { count: points?.length || 0, actual, imageCases, transitions, low: PosePresence.analyze(low), outside: PosePresence.analyze(outside), timings, gates };
    } finally { runtime.close(); }
  }, sample);
  const online = await infer();
  assert.equal(online.count, 33); assert.equal(online.actual.usable, true);
  assert.equal(online.imageCases.blank.at(-1).gate.usable, false);
  assert.deepEqual(online.transitions.map(value => value.state), ['recovering', 'recovering', 'present', 'unavailable', 'recovering', 'recovering', 'present', 'unavailable']);
  assert.equal(online.low.reason, 'confidence');
  assert.equal(online.outside.reason, 'out-of-frame');
  console.log('Real fixture inference, actual gate and synthetic perturbations:', JSON.stringify(online));

  await page.evaluate(() => setDelay(1));
  await page.locator('#cameraButton').click();
  await page.waitForFunction(() => lastDrawnFrame && frameHistory.length > 10);
  const baseline = await page.evaluate(async () => {
    const start = performance.now(), count = frameHistory.length;
    await new Promise(resolve => setTimeout(resolve, 4000));
    return { elapsedMs: performance.now() - start, frames: frameHistory.length - count, delayMs: captureNow() - lastDrawnFrame };
  });
  await page.locator('#poseEnabled').check();
  await page.waitForFunction(() => poseUI.running && poseUI.metrics.results >= 3, null, { timeout: 60000 });
  const concurrent = await page.evaluate(async () => {
    const start = performance.now(), count = frameHistory.length, results = poseUI.metrics.results;
    await new Promise(resolve => setTimeout(resolve, 4000));
    return { elapsedMs: performance.now() - start, frames: frameHistory.length - count, delayMs: captureNow() - lastDrawnFrame, results: poseUI.metrics.results - results, inferenceMs: poseUI.metrics.inferenceMs, copiesMs: poseUI.metrics.copiesMs };
  });
  assert.ok(baseline.frames > 0 && concurrent.results > 0);
  assert.ok(concurrent.frames / concurrent.elapsedMs >= .7 * baseline.frames / baseline.elapsedMs, 'concurrent capture rate below 70% of baseline');
  assert.ok(concurrent.delayMs >= 500 && concurrent.delayMs <= 1500, `delay ${concurrent.delayMs}`);
  console.log('Fake camera baseline and actual worker concurrency:', JSON.stringify({ baseline, concurrent }));
  await page.waitForFunction(() => lastDrawnFrame && lastDrawnFrame - frameHistory[0].time >= 5400, null, { timeout: 30000 });
  const displayed = await page.evaluate(() => lastDrawnFrame);
  await page.locator('#openClipButton').click();
  const selection = await page.evaluate(() => ({ opened: clipSelectionOpenedAt, chosen: getSelection().end, running: poseUI.running, worker: !!poseUI.runtime.worker }));
  assert.ok(selection.opened >= displayed && selection.opened - displayed < 1000);
  assert.ok(Math.abs(selection.chosen - selection.opened) < 200);
  assert.equal(selection.running, false); assert.equal(selection.worker, false);
  await page.locator('#clipLength').fill('5'); await page.locator('#clipLength').dispatchEvent('input');
  await page.locator('#studentName').fill('가상학생'); await page.locator('#studentNumber').fill('2');
  await page.evaluate(() => {
    window.realPoseTestExport = ClipExporter.export;
    ClipExporter.export = async options => {
      window.poseTestEncoding = { running: poseUI.running, worker: !!poseUI.runtime.worker, start: options.start, frames: options.frames.length };
      window.poseExpected = [];
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
      const ctx = canvas.getContext('2d', { alpha: false });
      for (const offset of [0, 2, 4.8]) {
        const frame = Timeline.frameAt(options.frames, options.start + offset * 1000);
        const bitmap = await createImageBitmap(frame.blob); ctx.drawImage(bitmap, 0, 0, 640, 360); bitmap.close();
        window.poseExpected.push(ctx.getImageData(0, 0, 640, 360).data);
      }
      return window.realPoseTestExport(options);
    };
  });
  const beforeResume = await page.evaluate(() => poseUI.metrics.results);
  await page.locator('#saveClipButton').click();
  await page.waitForFunction(() => savePhase === 'succeeded' || savePhase === 'failed', null, { timeout: 60000 });
  assert.equal(await page.evaluate(() => savePhase), 'succeeded', await page.locator('#saveProgress').textContent());
  const clip = await page.evaluate(async () => {
    const record = (await allClips())[0], blob = await decryptClip(record);
    const video = document.createElement('video'); video.src = URL.createObjectURL(blob); video.muted = true;
    await new Promise((resolve, reject) => { video.onloadeddata = resolve; video.onerror = reject; });
    const firstFrame = new Promise(resolve => video.requestVideoFrameCallback(resolve));
    await video.play(); await firstFrame; video.pause();
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
    const ctx = canvas.getContext('2d'); const mae = [];
    for (const [index, offset] of [0, 2, 4.8].entries()) {
      if (offset) { const presented = new Promise(resolve => video.requestVideoFrameCallback(resolve)); const seeked = new Promise(resolve => { video.onseeked = resolve; }); video.currentTime = offset; await seeked; await presented; }
      ctx.drawImage(video, 0, 0, 640, 360); const pixels = ctx.getImageData(0, 0, 640, 360).data, expected = window.poseExpected[index];
      let error = 0; for (let i = 0; i < pixels.length; i += 4) for (let c = 0; c < 3; c++) error += Math.abs(pixels[i + c] - expected[i + c]);
      mae.push(error / (640 * 360 * 3));
    }
    const result = { bytes: blob.size, mime: blob.type, width: video.videoWidth, height: video.videoHeight, duration: record.durationSeconds, encoding: window.poseTestEncoding, mae, encoded: Array.from(new Uint8Array(await blob.arrayBuffer())) };
    URL.revokeObjectURL(video.src); return result;
  });
  assert.ok(clip.bytes > 1000 && clip.width > 0 && clip.height > 0); assert.ok(clip.duration >= 4.9 && clip.duration <= 5.1);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pose-clip-')); const file = path.join(dir, 'clip.webm');
  try {
    fs.writeFileSync(file, Buffer.from(clip.encoded)); delete clip.encoded;
    clip.probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,codec_type,width,height', '-of', 'json', file], { encoding: 'utf8' }));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  assert.equal(clip.probe.streams.length, 1); assert.equal(clip.probe.streams[0].codec_type, 'video');
  assert.ok(Number(clip.probe.format.duration) >= 4.9 && Number(clip.probe.format.duration) <= 5.1);
  console.log('Decoded selected-frame RGB mean absolute error at 0, 2, 4.8 seconds:', JSON.stringify(clip.mae));
  assert.ok(clip.mae.every(value => value < 25), 'decoded scene must match selected source frames');
  assert.equal(clip.encoding.running, false); assert.equal(clip.encoding.worker, false); assert.ok(clip.encoding.frames > 0);
  await page.waitForFunction(before => poseUI.running && poseUI.metrics.results > before, beforeResume, { timeout: 60000 });
  await page.evaluate(() => cameraStream.getVideoTracks()[0].dispatchEvent(new Event('ended')));
  assert.equal(await page.evaluate(() => !cameraStream && !poseUI.running && !poseUI.runtime.worker), true);
  const beforeRestart = await page.evaluate(() => poseUI.metrics.results);
  await page.locator('#cameraButton').click();
  await page.waitForFunction(before => poseUI.running && poseUI.metrics.results > before, beforeRestart, { timeout: 60000 });
  await page.evaluate(() => stopCamera());
  console.log('Displayed selection, real encoded/decrypted file, pause and interruption/restart:', JSON.stringify({ selection, clip }));

  const nonlocal = requests.filter(r => !r.url.startsWith(baseUrl + '/') && !r.url.startsWith('blob:') && !r.url.startsWith('data:'));
  const mutations = requests.filter(r => !['GET', 'HEAD'].includes(r.method));
  assert.deepEqual(nonlocal, []); assert.deepEqual(mutations, []);
  await page.context().setOffline(true);
  try {
    await page.reload();
    await page.waitForFunction(() => appReady && navigator.serviceWorker.controller, null, { timeout: 30000 });
    const offline = await infer();
    assert.equal(offline.count, 33);
    console.log('Offline browser reload, controlled shell and real model cache inference:', JSON.stringify(offline));
  } finally { await page.context().setOffline(false); }
  assert.deepEqual(errors, []);
  console.log('PASS real-model suite; network observation covers this browser session only.');
}).catch(error => { console.error(error); process.exitCode = 1; });
