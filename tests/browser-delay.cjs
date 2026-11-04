const { withBrowser } = require('./browser-helper.cjs');
const assert = require('node:assert/strict');

withBrowser(async (page, errors) => {
  const results = [];
  await page.evaluate(() => setDelay(1));
  await page.locator('#cameraButton').click();
  await page.waitForFunction(() => frameHistory.length > 0);
  assert.equal(await page.evaluate(() => $('previewWrap').classList.contains('has-video')), false);

  for (const seconds of [1, 20, 60]) {
    await page.evaluate(async value => { setDelay(value); await drawDelayedFrame(); }, seconds);
    if (seconds > 1) {
      assert.equal(await page.evaluate(() => $('previewWrap').classList.contains('has-video')), false);
      assert.match(await page.locator('#previewEmpty strong').textContent(), /지연 영상 준비 중/);
    }
    await page.waitForFunction(value => frameBuffer.duration >= value * 1000 + 350, seconds, { timeout: 80000 });
    await page.waitForFunction(() => $('previewWrap').classList.contains('has-video'));
    const samples = [];
    for (let index = 0; index < 8; index++) {
      const age = await page.evaluate(() => (captureNow() - lastDrawnFrame) / 1000);
      samples.push(age);
      assert.ok(Math.abs(age - seconds) < 0.5, `${seconds}s delay: frame age ${age}`);
      await page.waitForTimeout(120);
    }
    // Verify that the displayed pixels are those of the chosen stored frame.
    const pixelsMatch = await page.evaluate(async () => {
      const draw = drawDelayedFrame;
      drawDelayedFrame = async () => {};
      while (drawBusy) await new Promise(resolve => setTimeout(resolve, 10));
      await draw();
      const selectedTime = lastDrawnFrame;
      const selected = frameHistory.find(frame => frame.time === selectedTime);
      const reference = document.createElement('canvas');
      reference.width = previewCanvas.width; reference.height = previewCanvas.height;
      const context = reference.getContext('2d');
      await drawFrameToCanvas(selected, reference, context);
      const expected = context.getImageData(0, 0, reference.width, reference.height).data;
      const actual = previewContext.getImageData(0, 0, previewCanvas.width, previewCanvas.height).data;
      const matches = expected.every((value, i) => value === actual[i]);
      drawDelayedFrame = draw;
      return matches;
    });
    assert.equal(pixelsMatch, true, 'selected source frame must match the visible canvas');
    const result = { selectedSeconds: seconds, minAge: Math.min(...samples), maxAge: Math.max(...samples), pixelsMatch };
    results.push(result); console.log(JSON.stringify(result));
  }
  await page.evaluate(async () => { setDelay(1); await drawDelayedFrame(); });
  await page.waitForFunction(() => Math.abs((captureNow() - lastDrawnFrame) / 1000 - 1) < 0.5);
  assert.equal(await page.evaluate(() => $('previewWrap').classList.contains('has-video')), true);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, delayChanges: '1 → 20 → 60 → 1', cases: results.length }));
}).catch(error => { console.error(error); process.exitCode = 1; });
