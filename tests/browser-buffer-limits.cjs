const assert = require('node:assert/strict');
const { withBrowser } = require('./browser-helper.cjs');

withBrowser(async (page, errors) => {
  await page.locator('#cameraButton').click();
  await page.waitForFunction(() => frameHistory.length > 0);
  const result = await page.evaluate(async () => {
    captureLoop = false; ++captureGeneration; cancelAnimationFrame(captureRafId);
    while (drawBusy) await new Promise(resolve => setTimeout(resolve, 5));
    const draw = drawDelayedFrame;
    drawDelayedFrame = async () => {}; // Isolate the real draw from the periodic UI timer.
    const blob = frameHistory[0].blob;
    const now = captureNow();
    setDelay(300);
    frameBuffer.clear();
    for (let time = now - 299900; time <= now - 50; time += 100) frameBuffer.add({ time, blob });
    frameBuffer.add({ time: now - 10, blob });
    firstCapturedAt = now - 299900;
    await draw(now);
    const before = $('previewWrap').classList.contains('has-video');
    firstCapturedAt = now - 300000;
    await draw(now);
    const after = { visible: $('previewWrap').classList.contains('has-video'), age: (now - lastDrawnFrame) / 1000 };
    frameBuffer.clear();
    frameBuffer.maxBytes = blob.size * 100;
    for (let index = 0; index < 1000; index++) frameBuffer.add({ time: now - 100000 + index * 100, blob });
    firstCapturedAt = now - 400000;
    await draw(now);
    return { before, after, capacityLimited: frameBuffer.capacityLimited, visibleLimited: $('previewWrap').classList.contains('has-video'), message: $('previewEmpty').querySelector('strong').textContent, span: frameBuffer.duration, bytes: frameBuffer.bytes, limit: frameBuffer.maxBytes };
  });
  assert.equal(result.before, false, 'sampling tolerance must not begin before 300 elapsed seconds');
  assert.equal(result.after.visible, true);
  assert.ok(Math.abs(result.after.age - 300) <= .15);
  assert.equal(result.capacityLimited, true);
  assert.equal(result.visibleLimited, false, 'elapsed time alone must not hide a memory-limited buffer shortage');
  assert.match(result.message, /보관 공간이 부족/);
  assert.ok(result.span < 15000 && result.bytes <= result.limit);
  assert.deepEqual(errors, []);
  console.log('300-second sampling tolerance, elapsed-time gate and byte-limited shortage passed (synthetic timestamps).');
}).catch(error => { console.error(error); process.exitCode = 1; });
