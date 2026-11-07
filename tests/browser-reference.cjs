const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { withBrowser } = require('./browser-helper.cjs');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-loop-reference-'));
const reference = path.join(directory, 'local-example.webm');
execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:size=160x90:rate=10', '-t', '2', '-c:v', 'libvpx', '-threads', '1', '-an', reference]);

withBrowser(async (page, errors, baseUrl) => {
  const outbound = [];
  page.on('request', request => { if (/^https?:/.test(request.url()) && !request.url().startsWith(baseUrl)) outbound.push(request.url()); });
  await page.evaluate(() => {
    window.revokedReferenceUrls = [];
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = url => { window.revokedReferenceUrls.push(url); revoke(url); };
  });
  await page.locator('#referenceFile').setInputFiles(reference);
  await page.waitForFunction(() => !$('referencePlay').disabled);
  const initialUrl = await page.locator('#referenceVideo').getAttribute('src');
  assert.match(initialUrl, /^blob:/);
  for (const [id, value] of [['referenceOpacity', '0.25'], ['referenceScale', '1.25'], ['referenceX', '20'], ['referenceY', '-10'], ['referenceTime', '0.7']]) {
    await page.locator(`#${id}`).fill(value); await page.locator(`#${id}`).dispatchEvent('input');
  }
  assert.deepEqual(await page.evaluate(() => ({ opacity: getComputedStyle($('referenceVideo')).opacity, scale: $('previewWrap').style.getPropertyValue('--reference-scale'), x: $('previewWrap').style.getPropertyValue('--reference-x'), y: $('previewWrap').style.getPropertyValue('--reference-y'), time: $('referenceVideo').currentTime })), { opacity: '0.25', scale: '1.25', x: '20%', y: '-10%', time: .7 });
  await page.locator('#referenceMode').selectOption('side');
  const side = await page.evaluate(() => { const a = $('previewCanvas').getBoundingClientRect(); const pane = document.querySelector('.reference-pane'); const b = pane.getBoundingClientRect(); return { mode: $('previewWrap').classList.contains('reference-side'), widthA: a.width, widthB: b.width, clipping: getComputedStyle(pane).overflow }; });
  assert.equal(side.mode, true); assert.ok(Math.abs(side.widthA - side.widthB) < 1);
  assert.equal(side.clipping, 'hidden', 'scaling/moving the reference must stay within its comparison pane');
  await page.locator('#referenceMode').selectOption('overlay');
  for (const [id, value] of [['referenceOpacity', '1'], ['referenceScale', '1'], ['referenceX', '0'], ['referenceY', '0']]) {
    await page.locator(`#${id}`).fill(value); await page.locator(`#${id}`).dispatchEvent('input');
  }

  await page.locator('#cameraButton').click();
  await page.waitForFunction(() => frameHistory.length > 0);
  await page.evaluate(async () => {
    captureLoop = false; ++captureGeneration; cancelAnimationFrame(captureRafId);
    drawDelayedFrame = async () => {};
    while (drawBusy) await new Promise(resolve => setTimeout(resolve, 5));
    const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 270;
    const context = canvas.getContext('2d'); context.fillStyle = 'rgb(20,80,200)'; context.fillRect(0, 0, 480, 270);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .95));
    frameBuffer.clear(); const base = captureNow() - 35000;
    for (let index = 0; index <= 350; index++) frameBuffer.add({ time: base + index * 100, blob });
    lastDrawnFrame = frameHistory[300].time;
    await drawFrameToCanvas(frameHistory[300], previewCanvas, previewContext);
    $('previewWrap').classList.add('has-video');
  });
  await page.locator('#openClipButton').click();
  await page.locator('#clipLength').fill('5'); await page.locator('#clipLength').dispatchEvent('input');
  await page.locator('#studentName').fill('가상학생'); await page.locator('#studentNumber').fill('1');
  await page.locator('#saveClipButton').click();
  await page.waitForFunction(() => !$('clipDialog').open, null, { timeout: 30000 });
  const data = await page.evaluate(async () => {
    const blob = await decryptClip((await allClips())[0]);
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
  const saved = path.join(directory, 'student-only.webm'); fs.writeFileSync(saved, Buffer.from(data));
  const pixels = execFileSync('ffmpeg', ['-v', 'error', '-i', saved, '-frames:v', '1', '-vf', 'scale=in_range=pc:out_range=pc:in_color_matrix=bt709,crop=2:2:320:180', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1']);
  [20, 80, 200].forEach((expected, channel) => assert.ok(Math.abs(pixels[channel] - expected) < 15, `reference must not be burned into student clip: ${Array.from(pixels)}`));
  console.log('PASS local reference controls and student-only encoded output');

  await page.evaluate(() => { const old = $('referenceVideo'); old.play = () => new Promise(resolve => { window.releaseOldReferencePlay = resolve; }); $('referencePlay').click(); });
  await page.locator('#referenceClear').click();
  await page.evaluate(() => window.releaseOldReferencePlay());
  assert.equal(await page.locator('#referencePlay').isDisabled(), true);
  assert.equal(await page.locator('#referencePlay').textContent(), '시범 영상 재생');
  assert.ok(await page.evaluate(url => window.revokedReferenceUrls.includes(url), initialUrl));
  await page.locator('#referenceFile').setInputFiles(reference);
  await page.waitForFunction(() => !$('referencePlay').disabled);
  const secondUrl = await page.locator('#referenceVideo').getAttribute('src');
  await page.locator('#referencePlay').click();
  await page.waitForFunction(() => !$('referenceVideo').paused);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  assert.equal(await page.locator('#referenceVideo').evaluate(video => video.paused), true);
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  assert.equal(await page.locator('#referenceVideo').getAttribute('src'), null);
  assert.ok(await page.evaluate(url => window.revokedReferenceUrls.includes(url), secondUrl));
  assert.deepEqual(outbound, []); assert.deepEqual(errors, []);
  console.log('PASS stale play suppression, URL release, background pause, pagehide cleanup and no outbound upload');
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(() => fs.rmSync(directory, { recursive: true, force: true }));
