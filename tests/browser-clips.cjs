const { withBrowser } = require('./browser-helper.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const color = second => [(second * 31) % 200 + 20, (second * 59) % 200 + 20, (second * 83) % 200 + 20];
const hasCommand = command => {
  try { execFileSync(command, ['-version'], { stdio: 'ignore' }); return true; } catch { return false; }
};
const hasMediaTools = hasCommand('ffprobe') && hasCommand('ffmpeg');

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

  async function saveAndVerify(duration, expectedCount) {
    if (!(await page.evaluate(() => $('clipDialog').open))) await page.locator('#openClipButton').click();
    await page.locator('#clipLength').fill(String(duration));
    await page.locator('#clipLength').dispatchEvent('input');
    await page.locator('#studentName').fill('가상학생');
    await page.locator('#studentNumber').fill('1');
    await page.evaluate(() => { window.__f02Start = getSelection().start; });
    await page.locator('#saveClipButton').click();
    await page.waitForFunction(() => !$('clipDialog').open, {}, { timeout: 40000 });
    const saved = await page.evaluate(async duration => {
      const records = await allClips();
      // getAll() is ordered by key, not creation time. Select the clip written by this save.
      const record = records.slice().sort((left, right) => right.createdAt - left.createdAt)[0];
      const blob = await decryptClip(record);
      const dataUrl = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(blob); });
      const video = document.createElement('video'); video.muted = true; video.playsInline = true;
      const url = URL.createObjectURL(blob); video.src = url;
      await new Promise((resolve, reject) => { video.onloadeddata = resolve; video.onerror = reject; });
      const start = window.__f02Start;
      const base = frameHistory[0].time;
      const startSeconds = (start - base) / 1000;
      const endSeconds = startSeconds + duration;
      // Sample the middle of a source second so a one-frame seek difference cannot cross a color boundary.
      const startSource = Math.floor(startSeconds) + 0.5 < startSeconds ? Math.floor(startSeconds) + 1.5 : Math.floor(startSeconds) + 0.5;
      const midSource = Math.floor((startSeconds + endSeconds) / 2) + 0.5;
      const endSource = Math.floor(endSeconds) + 0.5 >= endSeconds ? Math.floor(endSeconds) - 0.5 : Math.floor(endSeconds) + 0.5;
      const targets = [startSource, midSource, endSource].map(sourceSeconds => ({ at: sourceSeconds - startSeconds, second: Math.floor(sourceSeconds) }));
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
      const context = canvas.getContext('2d');
      const readFrame = async ({ at, second }) => {
        let removeSeeked = () => {};
        const reached = new Promise((resolve, reject) => {
          const timer = setTimeout(() => { removeSeeked(); reject(new Error(`seek timeout at ${at}s`)); }, 8000);
          const onSeeked = () => {
            if (video.seeking) { clearTimeout(timer); removeSeeked(); reject(new Error(`seeked fired while still seeking at ${at}s`)); return; }
            clearTimeout(timer); removeSeeked();
            if (Math.abs(video.currentTime - at) > 0.1) { reject(new Error(`seek at ${at}s landed at ${video.currentTime}s`)); return; }
            resolve();
          };
          removeSeeked = () => video.removeEventListener('seeked', onSeeked);
          video.addEventListener('seeked', onSeeked);
        });
        const presented = new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`frame presentation timeout at ${at}s`)), 8000);
          const onFrame = (now, metadata) => {
            if (Number.isFinite(metadata.mediaTime) && Math.abs(metadata.mediaTime - at) > 0.2) {
              video.requestVideoFrameCallback(onFrame);
              return;
            }
            clearTimeout(timer); resolve(metadata);
          };
          video.requestVideoFrameCallback(onFrame);
        });
        // Register both handlers before seeking so a fast seek cannot resolve unseen.
        video.currentTime = at;
        const [, metadata] = await Promise.all([reached, presented]);
        if (video.seeking) throw new Error(`video still seeking at ${at}s`);
        if (Math.abs(video.currentTime - at) > 0.1) throw new Error(`seek verification failed at ${at}s: ${video.currentTime}s`);
        context.drawImage(video, 0, 0);
        return { at, second, currentTime: video.currentTime, mediaTime: metadata.mediaTime, pixel: [...context.getImageData(320, 180, 1, 1).data] };
      };
      const samples = [];
      for (const target of targets) samples.push(await readFrame(target));
      const videoDuration = video.duration;
      video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url);
      return { count: records.length, duration: record.durationSeconds, videoDuration, base64: dataUrl.split(',')[1], samples };
    }, duration);
    const checks = saved.samples;
    for (const [index, check] of checks.entries()) {
      const actual = check.pixel;
      assert.equal(actual[3], 255);
      for (let channel = 0; channel < 3; channel++) assert.ok(Math.abs(actual[channel] - color(check.second)[channel]) < 10, `Chrome playback at ${check.at}s (source ${check.second}s, currentTime ${check.currentTime}, mediaTime ${check.mediaTime}): ${actual.slice(0, 3)} vs ${color(check.second)}`);
    }
    assert.equal(saved.count, expectedCount);
    assert.ok(Math.abs(saved.duration - duration) < 0.4);
    assert.ok(Number.isFinite(saved.videoDuration) && Math.abs(saved.videoDuration - duration) < 0.2, `Chrome duration ${saved.videoDuration} for ${duration}s`);
    if (hasMediaTools) {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-loop-scene-'));
      try {
        const file = path.join(directory, `${duration}.webm`);
        fs.writeFileSync(file, Buffer.from(saved.base64, 'base64'));
        const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=color_range,color_space,color_transfer,color_primaries', '-of', 'json', file], { encoding: 'utf8' }));
        assert.equal(probe.streams[0].color_range, 'pc');
        assert.equal(probe.streams[0].color_space, 'bt709');
        for (const check of checks) {
          const pixels = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ss', String(check.at), '-frames:v', '1', '-vf', 'scale=in_range=pc:out_range=pc:in_color_matrix=bt709,crop=2:2:320:180', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1']);
          assert.equal(pixels.length, 12);
          const expected = color(check.second);
          for (let channel = 0; channel < 3; channel++) assert.ok(Math.abs(pixels[channel] - expected[channel]) < 15, `scene at ${check.at}s, channel ${channel}: ${pixels[channel]}, expected ${expected[channel]}`);
        }
      } finally { fs.rmSync(directory, { recursive: true, force: true }); }
    } else {
      console.log(JSON.stringify({ duration, ffprobe: 'skipped', chromePlayback: 'passed' }));
    }
    console.log(JSON.stringify({ duration, count: saved.count, videoDuration: saved.videoDuration, samples: checks.map(({ at, second, currentTime, mediaTime, pixel }) => ({ at, second, currentTime, mediaTime, pixel: pixel.slice(0, 3) })), passed: true }));
  }

  for (const [duration, expectedCount] of [[5, 1], [15, 2], [30, 3]]) await saveAndVerify(duration, expectedCount);

  // 기존 클립이 있는 상태에서 저장소 오류·트랜잭션 중단이 불완전한 레코드를 남기지 않는지 확인한다.
  const beforeFailure = await page.evaluate(async () => (await allClips()).length);
  await page.locator('#openClipButton').click();
  await page.locator('#clipLength').fill('5');
  await page.locator('#clipLength').dispatchEvent('input');
  await page.locator('#studentName').fill('가상학생');
  await page.locator('#studentNumber').fill('2');
  await page.evaluate(() => {
    window.realStore = repository.put.bind(repository);
    repository.put = async () => { throw new DOMException('synthetic quota failure', 'QuotaExceededError'); };
  });
  await page.locator('#saveClipButton').click();
  await page.waitForFunction(() => !saving);
  assert.equal(await page.evaluate(() => savePhase), 'failed');
  assert.equal(await page.evaluate(async () => (await allClips()).length), beforeFailure);
  await page.evaluate(() => { repository.put = window.realStore; });
  await page.locator('#clipDialog .close-button').click();
  const abortedWithExisting = await page.evaluate(async () => {
    const controller = new AbortController();
    return withStore('readwrite', store => {
      store.put({ id: 'partial-existing-test', createdAt: Date.now() });
      controller.abort();
    }, { signal: controller.signal }).then(() => false, () => true);
  });
  assert.equal(abortedWithExisting, true);
  assert.equal(await page.evaluate(async () => (await allClips()).length), beforeFailure);
  assert.deepEqual(errors, []);
  console.log('Storage failure/retry and encoded start/middle/end scene match passed');
}).catch(error => { console.error(error); process.exitCode = 1; });
