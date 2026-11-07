const { withBrowser } = require('./browser-helper.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

withBrowser(async page => {
  await page.locator('#cameraButton').click();
  await page.waitForFunction(() => frameHistory.length > 0);
  await page.evaluate(async () => {
    captureLoop = false; ++captureGeneration; cancelAnimationFrame(captureRafId);
    const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 270;
    const ctx = canvas.getContext('2d');
    const blobs = [];
    for (let i = 0; i <= 50; i++) {
      ctx.fillStyle = `rgb(${(i * 31) % 220 + 20},${(i * 59) % 220 + 20},${(i * 83) % 220 + 20})`;
      ctx.fillRect(0, 0, 480, 270);
      blobs.push(await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .92)));
    }
    frameBuffer.clear();
    const base = captureNow() - 50000;
    for (let i = 0; i <= 500; i++) frameBuffer.add({ time: base + (i === 448 ? 44750 : i * 100), blob: blobs[Math.floor(i / 10)] });
    frameHistory.splice(0, frameHistory.length, ...frameBuffer.frames);
    const displayed = frameHistory.at(-1);
    lastDrawnFrame = displayed.time;
    await drawFrameToCanvas(displayed, previewCanvas, previewContext, () => true);
    previewWrap.classList.add('has-video');
  });
  const initial = await page.evaluate(() => {
    const displayed = lastDrawnFrame;
    openClipDialog();
    return { displayed, end: selectionSnapshot[Number($('clipEndFrame').value)]?.time, openedAt: clipSelectionOpenedAt, count: selectionSnapshot.length };
  });
  assert.equal(initial.end, initial.displayed, 'default selection end must be the displayed delayed frame');
  assert.ok(initial.count > 50);

  // Advance the live frame buffer while the selector remains open. Its snapshot and selected end must stay fixed.
  const originalEnd = initial.end;
  await page.evaluate(() => {
    frameBuffer.add({ time: captureNow() + 1000, blob: frameHistory.at(-1).blob });
    frameHistory.splice(0, frameHistory.length, ...frameBuffer.frames);
  });
  assert.equal(await page.evaluate(() => selectionSnapshot[Number($('clipEndFrame').value)].time), originalEnd);

  await page.locator('#clipStartFrame').fill('0');
  await page.locator('#clipStartFrame').dispatchEvent('input');
  await page.locator('#clipEndFrame').fill('500');
  await page.locator('#clipEndFrame').dispatchEvent('input');
  const invalid = await page.evaluate(() => ({ disabled: $('saveClipButton').disabled, text: $('clipSelectionTime').textContent }));
  assert.equal(invalid.disabled, true, 'a range longer than 30 seconds must not be saved');
  assert.match(invalid.text, /5~30|30초|길이/);

  // Select a 5.25-second interval by captured frame indices and verify actual muxed packets.
  const indices = await page.evaluate(() => {
    const end = Number($('clipEndFrame').value);
    const target = selectionSnapshot[end].time - 5250;
    let start = 0;
    for (let i = 0; i < selectionSnapshot.length; i++) if (selectionSnapshot[i].time <= target) start = i;
    $('clipStartFrame').value = String(start); $('clipStartFrame').dispatchEvent(new Event('input'));
    $('studentName').value = '검증학생'; $('studentNumber').value = '1';
    return { start, end, startTime: selectionSnapshot[start].time, endTime: selectionSnapshot[end].time, actual: (selectionSnapshot[end].time - selectionSnapshot[start].time) / 1000 };
  });
  assert.equal(indices.actual, 5.25, `selected timestamps must be exactly 5.25s, got ${indices.actual}`);
  const sourceColors = await page.evaluate(() => {
    const selection = getSelection();
    return [0, 2, 5.2].map(offset => {
      const frame = Timeline.frameAt(selection.frames, selection.start + offset * 1000);
      const second = Math.floor(selectionSnapshot.indexOf(frame) / 10);
      return [(second * 31) % 220 + 20, (second * 59) % 220 + 20, (second * 83) % 220 + 20];
    });
  });
  console.log(`Selected ${indices.actual}s, expected RGB ${JSON.stringify(sourceColors)}`);
  await page.locator('#reflectionGood').fill('실제 입력에서 균형을 유지함');
  await page.locator('#reflectionRetry').fill('다음에는 팔을 더 들어보기');
  await page.locator('#saveClipButton').click();
  await page.waitForFunction(() => !saving, null, { timeout: 30000 });
  const saved = await page.evaluate(async () => {
    const clip = (await allClips()).sort((a,b) => b.createdAt - a.createdAt)[0];
    const blob = await decryptClip(clip);
    const data = await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(blob); });
    const metadata = await decryptMetadata(clip);
    return { duration: clip.durationSeconds, base64: data.split(',')[1], metadata, plain: JSON.stringify(clip).includes('실제 입력에서 균형을 유지함') || JSON.stringify(clip).includes('다음에는 팔을 더 들어보기') };
  });
  assert.equal(saved.metadata.reflectionGood, '실제 입력에서 균형을 유지함');
  assert.equal(saved.metadata.reflectionRetry, '다음에는 팔을 더 들어보기');
  assert.equal(saved.plain, false, 'actual textarea save must encrypt reflection metadata');
  assert.ok(saved.duration <= 30 && Math.abs(saved.duration - indices.actual) < .001, `stored duration ${saved.duration}, selected ${indices.actual}`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-loop-review-'));
  try {
    const file = path.join(dir, 'fractional.webm');
    fs.writeFileSync(file, Buffer.from(saved.base64, 'base64'));
    const probe = JSON.parse(execFileSync('ffprobe', ['-v','error','-show_packets','-show_streams','-of','json',file]));
    assert.ok(probe.streams.length > 0 && probe.streams.every(stream => stream.codec_type === 'video'), 'review export must be silent');
    const packetStart = Math.min(...probe.packets.map(packet => Number(packet.pts_time)));
    const end = Math.max(...probe.packets.map(packet => Number(packet.pts_time) + Number(packet.duration_time || 0)));
    assert.ok(end <= indices.actual + .001001, `muxed duration ${end} exceeds selected ${indices.actual}`);
    assert.ok(Math.abs(end - indices.actual) < .0011, `muxed duration ${end} should truncate by less than 1ms from ${indices.actual}`);
    assert.ok(packetStart >= -0.001, `unexpected negative packet start ${packetStart}`);
    console.log(`Fractional WebM probe: ${probe.packets.length} packets, ${end}s, silent`);

    console.log(`Chrome fractional playback and seeks: expected RGB ${JSON.stringify(sourceColors)}`);
    // Draw after seeked: requestVideoFrameCallback on a paused video may never fire.
    const playback = await page.evaluate(async ({ base64 }) => {
      const video = document.createElement('video'); video.muted = true; video.playsInline = true;
      video.src = URL.createObjectURL(new Blob([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], { type: 'video/webm' }));
      video.style.cssText = 'position:fixed;left:0;bottom:0;width:20px;height:20px;z-index:10000';
      document.body.append(video);
      const waitEvent = (name) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timed out waiting for video ${name} at ${video.currentTime}`)), 8000);
        video.addEventListener(name, () => { clearTimeout(timer); resolve(); }, { once: true });
        video.addEventListener('error', () => { clearTimeout(timer); reject(new Error('saved WebM failed to load in Chrome')); }, { once: true });
      });
      await waitEvent('loadeddata');
      await video.play();
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('video did not present a playing frame')), 8000);
        video.requestVideoFrameCallback(() => { clearTimeout(timer); resolve(); });
      });
      video.pause();
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 20;
      const ctx = canvas.getContext('2d');
      async function at(time) {
        const seeked = waitEvent('seeked');
        video.currentTime = time;
        await seeked;
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error(`timed out drawing seek frame at ${time}`)), 8000);
          requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timer); resolve(); }));
        });
        ctx.drawImage(video, 0, 0, 20, 20);
        return [...ctx.getImageData(10, 10, 1, 1).data].slice(0, 3);
      }
      const samples = [];
      for (const time of [.03, 2.03, 5.23]) samples.push(await at(time));
      const duration = video.duration; const url = video.src;
      video.removeAttribute('src'); video.load(); video.remove(); URL.revokeObjectURL(url);
      return { duration, samples };
    }, { base64: saved.base64 });
    assert.ok(Math.abs(playback.duration - saved.duration) < .02, `Chrome duration ${playback.duration} != ${saved.duration}`);
    for (const [sampleIndex, actual] of playback.samples.entries()) {
      for (let channel = 0; channel < 3; channel++) assert.ok(Math.abs(actual[channel] - sourceColors[sampleIndex][channel]) <= 15, `sample ${sampleIndex}, channel ${channel}: ${actual[channel]}, expected ${sourceColors[sampleIndex][channel]}`);
    }
    console.log(`Chrome playback and seek colors matched: ${JSON.stringify(playback.samples)}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }

  await page.evaluate(() => { lastDrawnFrame = frameHistory[0].time - 1000; openClipDialog(); });
  assert.equal(await page.locator('#clipDialog').evaluate(el => el.open), false, 'unavailable displayed frame must not open a silently shifted selection');
  console.log('Delayed-frame anchor, frozen snapshot, precision controls, fractional silent WebM and unavailable-frame refusal passed');
});
