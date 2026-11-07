const assert = require('node:assert/strict');
const { withBrowser } = require('./browser-helper.cjs');

withBrowser(async (page, errors) => {
  await page.waitForFunction(() => typeof shotFeedback !== 'undefined' && shotFeedback && typeof poseUI !== 'undefined' && poseUI);
  const initial = await page.evaluate(() => ({
    options: { ...shotFeedback.options },
    toggles: ['shotVisualEnabled', 'shotSoundEnabled', 'shotCaptureEnabled'].map(id => $(id).checked),
    figureHidden: $('shotCaptureFigure').hidden,
    time: $('shotFeedbackTime').textContent,
  }));
  assert.deepEqual(initial.options, { visual: false, sound: false, capture: false });
  assert.deepEqual(initial.toggles, [false, false, false]);
  assert.equal(initial.figureHidden, true);

  // All feedback remains optional and ephemeral; defaults never persist.
  const persistedBefore = await page.evaluate(() => localStorage.getItem('pe-loop-settings-v1'));
  await page.locator('#shotVisualEnabled').check();
  await page.locator('#shotCaptureEnabled').check();
  await page.waitForFunction(() => shotFeedback.options.visual && shotFeedback.options.capture);
  assert.equal(await page.evaluate(() => localStorage.getItem('pe-loop-settings-v1')), persistedBefore);

  // clear releases the current image/notice but retains the session toggles.
  await page.evaluate(() => shotFeedback.clear());
  assert.deepEqual(await page.evaluate(() => ({ ...shotFeedback.options })), { visual: true, sound: false, capture: true });
  await page.evaluate(() => {
    window.feedbackUrls = { created: [], revoked: [] };
    window.nativeCreateURL = URL.createObjectURL.bind(URL); window.nativeRevokeURL = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => { const url = window.nativeCreateURL(blob); window.feedbackUrls.created.push(url); return url; };
    URL.revokeObjectURL = url => { window.feedbackUrls.revoked.push(url); return window.nativeRevokeURL(url); };
  });
  await page.locator('#shotVisualEnabled').uncheck();
  await page.locator('#shotCaptureEnabled').uncheck();

  const first = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 24;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#e02010'; ctx.fillRect(0, 0, 32, 24);
    const bitmap = await createImageBitmap(canvas);
    const timestamp = performance.now();
    shotFeedback.active = () => true;
    shotFeedback.setOptions({ visual: true, sound: false, capture: true });
    const snapshot = { event: true, timestamp, side: 'left', angle: 167 };
    shotFeedback.consume(snapshot, { timestamp, bitmap });
    snapshot.side = 'right'; snapshot.angle = 99;
    return { timestamp, width: bitmap.width, height: bitmap.height };
  });
  await page.waitForFunction(() => !shotFeedback.encoding && !$('shotCaptureFigure').hidden, null, { timeout: 10000 });
  const capture1 = await page.evaluate(() => ({
    timestamp: shotFeedback.lastCapture?.timestamp,
    side: shotFeedback.lastCapture?.side,
    angle: shotFeedback.lastCapture?.angle,
    shownTimestamp: Number($('shotFeedbackTime').dataset.timestamp),
    caption: $('shotCaptureCaption').textContent,
    url: shotFeedback.imageUrl,
    visible: !$('shotCaptureFigure').hidden,
    image: $('shotCaptureImage').src,
  }));
  assert.deepEqual([capture1.timestamp, capture1.side, capture1.angle, capture1.shownTimestamp], [first.timestamp, 'left', 167, first.timestamp]);
  assert.match(capture1.caption, /왼팔/);
  assert.ok(capture1.visible && capture1.image.startsWith('blob:') && capture1.url === capture1.image);
  const pixel = await page.evaluate(async () => {
    const bitmap = await createImageBitmap(await (await fetch($('shotCaptureImage').src)).blob());
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0); const data = [...ctx.getImageData(4, 4, 1, 1).data]; bitmap.close(); return data;
  });
  assert.ok(pixel[0] > 150 && pixel[1] < 80 && pixel[2] < 80, `captured input is red: ${pixel}`);
  assert.equal(await page.evaluate(() => $('shotCaptureCaption').textContent.includes('왼팔') && $('shotCaptureCaption').textContent.includes('167°')), true, 'caption remains tied to event snapshot');

  // Duplicate and stale event tokens cannot replace the newest image or timestamp.
  await page.evaluate(async timestamp => {
    const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 24;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#1040e0'; ctx.fillRect(0, 0, 32, 24);
    const bitmap = await createImageBitmap(canvas);
    shotFeedback.consume({ event: true, timestamp, side: 'right', angle: 177 }, { timestamp, bitmap });
  }, first.timestamp);
  await page.waitForTimeout(50);
  assert.equal(await page.evaluate(() => shotFeedback.lastCapture?.timestamp), first.timestamp);

  // Replacing the image releases its prior object URL.
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 16;
    canvas.getContext('2d').fillRect(0, 0, 16, 16);
    const bitmap = await createImageBitmap(canvas), timestamp = performance.now();
    shotFeedback.consume({ event: true, timestamp, side: 'right', angle: 170 }, { timestamp, bitmap });
  });
  await page.waitForFunction(() => !shotFeedback.encoding && shotFeedback.lastCapture?.side === 'right');
  assert.equal(await page.evaluate(url => feedbackUrls.revoked.includes(url), capture1.url), true, 'replacing the latest image revokes its prior object URL');
  const contextUrl = await page.evaluate(() => shotFeedback.imageUrl);

  // A context change alone invalidates delayed encode completion.
  const delayed = await page.evaluate(() => {
    window.feedbackContext = 'class-a/student-a'; shotFeedback.currentContext = () => window.feedbackContext;
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, ...args) { window.delayedBlobCallback = callback; window.restoreToBlob = original; };
    const canvas = document.createElement('canvas'); canvas.width = 48; canvas.height = 36;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#15c040'; ctx.fillRect(0, 0, 48, 36);
    const bitmapPromise = createImageBitmap(canvas);
    return bitmapPromise.then(bitmap => { const timestamp = performance.now(); shotFeedback.consume({ event: true, timestamp, side: 'right', angle: 160 }, { timestamp, bitmap }); return timestamp; });
  });
  await page.waitForFunction(() => shotFeedback.encoding);
  await page.evaluate(() => { window.feedbackContext = 'class-a/student-b'; HTMLCanvasElement.prototype.toBlob = window.restoreToBlob; });
  await page.evaluate(async () => { window.delayedBlobCallback(new Blob(['late'], { type: 'image/jpeg' })); });
  await page.waitForFunction(() => !shotFeedback.encoding);
  const contextResult = await page.evaluate(() => ({ visible: !$('shotCaptureFigure').hidden, last: shotFeedback.lastCapture, timestamp: $('shotFeedbackTime').dataset.timestamp ?? null }));
  assert.equal(contextResult.visible, false);
  assert.equal(contextResult.last, null);
  assert.equal(Number(contextResult.timestamp) > first.timestamp, true);
  assert.equal(await page.evaluate(url => feedbackUrls.revoked.includes(url), contextUrl), true, 'context change released the previous image');
  assert.ok(delayed > first.timestamp);
  assert.equal(await page.evaluate(() => feedbackUrls.created.length), 2, 'discarded delayed encoding creates no object URL');

  // clear invalidates a second delayed encode generation and releases the current image URL.
  await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 18; canvas.height = 18;
    window.nativeToBlob = window.restoreToBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback) { window.clearBlobCallback = callback; };
  });
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 18; canvas.height = 18;
    const bitmap = await createImageBitmap(canvas), timestamp = performance.now();
    shotFeedback.consume({ event: true, timestamp, side: 'left', angle: 165 }, { timestamp, bitmap });
  });
  await page.waitForFunction(() => shotFeedback.encoding);
  const currentUrl = contextUrl;
  await page.evaluate(() => { shotFeedback.clear(); HTMLCanvasElement.prototype.toBlob = window.nativeToBlob; });
  await page.evaluate(() => window.clearBlobCallback(new Blob(['late'], { type: 'image/jpeg' })));
  await page.waitForFunction(() => !shotFeedback.encoding);
  assert.equal(await page.evaluate(url => feedbackUrls.revoked.includes(url), currentUrl), true, 'clear revokes the current image URL');
  assert.equal(await page.evaluate(() => !$('shotCaptureFigure').hidden), false, 'clear hides the capture');

  // Audio unlock failure is contained; the camera and UI remain operational.
  if (!(await page.evaluate(() => Boolean(cameraStream)))) {
    await page.locator('#cameraButton').click();
    await page.waitForFunction(() => cameraStream && frameHistory.length > 3, null, { timeout: 20000 });
  }
  const framesBeforeAudio = await page.evaluate(() => frameHistory.length);
  await page.evaluate(() => {
    shotFeedback.audio = { state: 'suspended', resume: () => Promise.reject(new Error('blocked')), close: () => Promise.resolve() };
    shotFeedback.options.sound = true;
  });
  assert.equal(await page.evaluate(() => shotFeedback.unlockAudio()), false);
  await page.waitForFunction(before => Boolean(cameraStream) && frameHistory.length > before, framesBeforeAudio, { timeout: 10000 });
  assert.equal(await page.evaluate(() => Boolean(cameraStream)), true);
  assert.equal(await page.evaluate(url => feedbackUrls.revoked.includes(url), capture1.url), true, 'clear/dispose releases the object URL');
  await page.evaluate(() => { shotFeedback.setOptions({ visual: false, sound: false, capture: false }); shotFeedback.dispose(); });
  assert.deepEqual(errors, []);
  console.log('PASS optional feedback defaults, exact input frame/time, duplicate suppression, delayed context cleanup, audio failure and disposal');
}).catch(error => { console.error(error); process.exitCode = 1; });
