const assert = require('node:assert/strict');
const fs = require('node:fs');
const { withBrowser } = require('./browser-helper.cjs');

// Deliberately uses real elapsed time and a fake camera, never synthetic timestamps.
withBrowser(async (page, errors) => {
  await page.evaluate(() => setDelay(300));
  assert.equal(await page.evaluate(() => delaySeconds), 300);
  await page.locator('#cameraButton').click();
  await page.waitForFunction(() => frameHistory.length > 0);
  const first = await page.evaluate(() => frameHistory[0].time);
  const samples = [];
  for (const elapsed of [60, 120, 180, 240, 300, 310]) {
    await page.waitForFunction(({ first, elapsed }) => captureNow() - first >= elapsed * 1000, { first, elapsed }, { timeout: 70000 });
    const sample = await page.evaluate(() => {
      const gaps = frameHistory.slice(1).map((frame, index) => frame.time - frameHistory[index].time);
      const now = captureNow();
      return { frames: frameHistory.length, bytes: frameBuffer.bytes, spanSeconds: frameBuffer.duration / 1000, oldestAgeSeconds: (now - frameHistory[0].time) / 1000, averageGapMs: gaps.reduce((sum, value) => sum + value, 0) / gaps.length, maximumGapMs: Math.max(...gaps), capacityLimited: frameBuffer.capacityLimited, visible: $('previewWrap').classList.contains('has-video'), displayedAgeSeconds: lastDrawnFrame ? (now - lastDrawnFrame) / 1000 : null, jsHeapBytes: performance.memory?.usedJSHeapSize ?? null };
    });
    samples.push({ elapsedSeconds: elapsed, ...sample });
    console.log(JSON.stringify(samples.at(-1)));
    fs.writeFileSync(process.env.S2_BUFFER_REPORT || '/tmp/pe-loop-s2-buffer-current.json', JSON.stringify({ environment: 'Linux Chromium fake camera; real 310-second elapsed capture', samples, errors }, null, 2));
    assert.ok(sample.frames <= 3001 && sample.bytes <= 80 * 1024 * 1024 && sample.spanSeconds <= 300);
    if (elapsed < 300) assert.equal(sample.visible, false, '300-second replay must not appear before 300 real seconds');
  }
  await page.waitForFunction(() => $('previewWrap').classList.contains('has-video'), null, { timeout: 3000 });
  const ages = [];
  for (let index = 0; index < 8; index++) {
    const age = await page.evaluate(() => (captureNow() - lastDrawnFrame) / 1000);
    ages.push(age);
    assert.ok(Math.abs(age - 300) < 0.5, `300-second display outside 0.5-second validation tolerance: ${age}`);
    await page.waitForTimeout(120);
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, delaySeconds: 300, actualCaptureSeconds: 310, minimumDisplayedAge: Math.min(...ages), maximumDisplayedAge: Math.max(...ages), limitation: 'Fake camera and Linux only; not Android or 40-minute validation.' }));
}).catch(error => { console.error(error); process.exitCode = 1; });
