const { withBrowser } = require('./browser-helper.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const color = second => [(second * 31) % 200 + 20, (second * 59) % 200 + 20, (second * 83) % 200 + 20];

withBrowser(async (page, errors) => {
  await page.locator('#cameraButton').click();
  await page.waitForFunction(() => frameHistory.length > 0);
  await page.evaluate(async () => {
    captureLoop = false; ++captureGeneration; cancelAnimationFrame(captureRafId);
    const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 270;
    const context = canvas.getContext('2d');
    const blobs = [];
    for (let second = 0; second <= 35; second++) {
      context.fillStyle = `rgb(${(second * 31) % 200 + 20},${(second * 59) % 200 + 20},${(second * 83) % 200 + 20})`;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#fff'; context.font = '20px sans-serif';
      context.fillText(`source ${second}.0s`, 20, 30);
      blobs.push(await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .95)));
    }
    frameBuffer.clear();
    const base = captureNow() - 35000;
    for (let index = 0; index <= 350; index++) frameBuffer.add({ time: base + index * 100, blob: blobs[Math.floor(index / 10)] });
  });
  await page.locator('#openClipButton').click();
  await page.locator('#clipLength').fill('5'); await page.locator('#clipLength').dispatchEvent('input');
  await page.waitForTimeout(80);
  // Delay an old preview decode, then change the selected scene before it completes.
  await page.evaluate(() => {
    window.nativeBitmap = createImageBitmap;
    window.oldPreviewBlob = getSelection().frames[0].blob;
    window.heldPreview = false;
    createImageBitmap = async (blob, ...rest) => {
      if (blob === window.oldPreviewBlob && !window.heldPreview) {
        window.heldPreview = true;
        await new Promise(resolve => { window.releaseOldPreview = resolve; });
      }
      return window.nativeBitmap(blob, ...rest);
    };
    previewSelection();
  });
  await page.waitForFunction(() => window.heldPreview);
  await page.locator('#clipOffset').fill('2'); await page.locator('#clipOffset').dispatchEvent('input');
  await page.waitForTimeout(60);
  const before = await page.evaluate(() => [...clipContext.getImageData(320, 180, 1, 1).data]);
  await page.evaluate(() => window.releaseOldPreview());
  await page.waitForTimeout(50);
  const after = await page.evaluate(() => [...clipContext.getImageData(320, 180, 1, 1).data]);
  assert.deepEqual(after, before, 'late old decode must not overwrite the new selection');
  await page.evaluate(() => { createImageBitmap = window.nativeBitmap; });
  assert.match(await page.locator('#clipSelectionTime').textContent(), /5초 구간 고정/);
  const encoderFailures = await page.evaluate(async () => {
    const selected = getSelection();
    const bitmap = createImageBitmap;
    let release;
    let entered;
    const decoding = new Promise(resolve => { entered = resolve; });
    createImageBitmap = async (...args) => {
      entered();
      await new Promise(resolve => { release = resolve; });
      return bitmap(...args);
    };
    const controller = new AbortController();
    const operation = ClipExporter.export({ frames: selected.frames, start: selected.start, durationSeconds: 5, signal: controller.signal }).then(() => 'unexpected success', error => error.name);
    await decoding;
    controller.abort(); release();
    const aborted = await operation;
    createImageBitmap = bitmap;
    const broken = await ClipExporter.export({ frames: [{ time: selected.start, blob: new Blob(['not an image']) }], start: selected.start, durationSeconds: 5 }).then(() => false, () => true);
    return { aborted, broken };
  });
  assert.equal(encoderFailures.aborted, 'AbortError');
  assert.equal(encoderFailures.broken, true);

  await page.locator('#saveClipButton').click();
  assert.match(await page.locator('#clipError').textContent(), /이름/);
  await page.locator('#studentName').fill('가상학생');
  await page.locator('#studentNumber').fill('0');
  await page.locator('#saveClipButton').click();
  assert.match(await page.locator('#clipError').textContent(), /1~9999/);
  await page.locator('#studentNumber').fill('3');
  await page.evaluate(() => {
    window.realExport = ClipExporter.export;
    window.exportAttempts = 0;
    ClipExporter.export = options => {
      window.exportAttempts++;
      return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
    };
  });
  await page.locator('#saveClipButton').click();
  await page.evaluate(() => saveSelectedClip());
  assert.equal(await page.evaluate(() => window.exportAttempts), 1);
  await page.locator('#cancelSaveButton').click();
  await page.waitForFunction(() => !saving);
  assert.equal(await page.evaluate(() => savePhase), 'cancelled');
  assert.match(await page.locator('#saveProgress').textContent(), /취소/);
  assert.equal(await page.evaluate(async () => (await allClips()).length), 0);
  assert.equal(await page.locator('#clipLength').isDisabled(), false);
  console.log('Input validation, late preview, duplicate save and user cancellation passed');
  await page.evaluate(() => {
    ClipExporter.export = window.realExport;
    window.realCodecSupport = VideoEncoder.isConfigSupported.bind(VideoEncoder);
    VideoEncoder.isConfigSupported = async () => ({ supported: false });
  });
  await page.locator('#saveClipButton').click();
  await page.waitForFunction(() => !saving);
  assert.match(await page.locator('#saveProgress').textContent(), /인코더/);
  assert.equal(await page.evaluate(async () => (await allClips()).length), 0);
  await page.evaluate(() => { VideoEncoder.isConfigSupported = window.realCodecSupport; });


  await page.evaluate(() => {
    ClipExporter.export = async options => { const output = await window.realExport(options); window.lastClipColor = output.colorSpace; return output; };
    window.realStore = repository.put.bind(repository);
    repository.put = async () => { throw new DOMException('synthetic quota failure', 'QuotaExceededError'); };
  });
  await page.locator('#saveClipButton').click();
  await page.waitForFunction(() => !saving);
  assert.equal(await page.evaluate(() => savePhase), 'failed');
  assert.match(await page.locator('#saveProgress').textContent(), /공간이 부족/);
  assert.equal(await page.evaluate(async () => (await allClips()).length), 0);
  await page.evaluate(() => { repository.put = window.realStore; });
  const transactionAborted = await page.evaluate(async () => {
    const controller = new AbortController();
    return withStore('readwrite', store => {
      store.put({ id: 'partial-test-entry', createdAt: Date.now() });
      controller.abort();
    }, { signal: controller.signal }).then(() => false, () => true);
  });
  assert.equal(transactionAborted, true);
  assert.equal(await page.evaluate(async () => (await allClips()).length), 0);

  await page.locator('#saveClipButton').click();
  await page.waitForFunction(() => !$('clipDialog').open, {}, { timeout: 20000 });
  const saved = await page.evaluate(async () => {
    const records = await allClips();
    const blob = await decryptClip(records[0]);
    const dataUrl = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(blob); });
    const video = document.createElement('video'); video.muted = true; video.playsInline = true;
    const url = URL.createObjectURL(blob); video.src = url;
    await new Promise((resolve, reject) => { video.onloadeddata = resolve; video.onerror = reject; });
    const firstFrame = new Promise(resolve => video.requestVideoFrameCallback(resolve));
    await video.play(); await firstFrame; video.pause();
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
    const context = canvas.getContext('2d'); const decoded = [];
    for (const at of [0, 2, 4.9]) {
      if (at) { video.currentTime = at; await new Promise(resolve => { video.onseeked = resolve; }); }
      context.drawImage(video, 0, 0); decoded.push([...context.getImageData(320, 180, 1, 1).data]);
    }
    video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url);
    return { count: records.length, duration: records[0].durationSeconds, base64: dataUrl.split(',')[1], decoded };
  });
  for (const [index, second] of [28, 30, 32].entries()) {
    assert.equal(saved.decoded[index][3], 255);
    for (let channel = 0; channel < 3; channel++) assert.ok(Math.abs(saved.decoded[index][channel] - color(second)[channel]) < 10, 'Chrome playback must preserve selected scene colors');
  }
  assert.equal(saved.count, 1);
  assert.equal(saved.duration, 5);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-loop-scene-'));
  try {
    const file = path.join(directory, 'selected.webm');
    fs.writeFileSync(file, Buffer.from(saved.base64, 'base64'));
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=color_range,color_space,color_transfer,color_primaries', '-of', 'json', file], { encoding: 'utf8' }));
    assert.equal(probe.streams[0].color_range, 'pc');
    assert.equal(probe.streams[0].color_space, 'bt709');
    for (const [at, second] of [[0, 28], [2, 30], [4.9, 32]]) {
      const pixels = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ss', String(at), '-frames:v', '1', '-vf', 'scale=in_range=pc:out_range=pc:in_color_matrix=bt709,crop=2:2:320:180', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1']);
      assert.equal(pixels.length, 12);
      const expected = color(second);
      for (let channel = 0; channel < 3; channel++) assert.ok(Math.abs(pixels[channel] - expected[channel]) < 15, `scene at ${at}s, channel ${channel}: ${pixels[channel]}, expected ${expected[channel]}`);
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  assert.deepEqual(errors, []);
  console.log('Storage failure/retry and encoded start/middle/end scene match passed');
}).catch(error => { console.error(error); process.exitCode = 1; });
