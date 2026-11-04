const { withBrowser } = require('./browser-helper.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

withBrowser(async (page, errors) => {
  await page.evaluate(() => setDelay(2));
  await page.locator('#cameraButton').click();
  await page.waitForFunction(() => frameHistory.length > 0);
  assert.equal(await page.evaluate(() => $('previewWrap').classList.contains('has-video')), false);
  await page.waitForFunction(() => $('previewWrap').classList.contains('has-video'));
  await page.evaluate(() => {
    const encode = ClipExporter.export;
    ClipExporter.export = async options => {
      await new Promise((resolve, reject) => {
        window.releaseClipExport = resolve;
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
      });
      return encode(options);
    };
  });
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-loop-clips-'));
  try {
    for (const duration of [5, 15, 30]) {
      await page.waitForFunction(seconds => frameBuffer.duration >= seconds * 1000 + 300, duration, { timeout: 45000 });
      await page.locator('#openClipButton').click();
      await page.locator('#clipLength').fill(String(duration));
      await page.locator('#clipLength').dispatchEvent('input');
      await page.locator('#studentName').fill('가상학생');
      await page.locator('#studentNumber').fill('1');
      const selectedEnd = await page.evaluate(() => getSelectionFrames().at(-1).time);
      await page.waitForTimeout(200);
      assert.equal(await page.evaluate(() => getSelectionFrames().at(-1).time), selectedEnd);
      await page.locator('#saveClipButton').click();
      assert.equal(await page.locator('#clipLength').isDisabled(), true);
      assert.equal(await page.locator('#clipDialog .close-button').isDisabled(), true);
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => $('clipDialog').open), true);
      await page.evaluate(() => window.releaseClipExport());
      await page.waitForFunction(() => !$('clipDialog').open, {}, { timeout: 40000 });
      const result = await page.evaluate(async () => {
        const clips = (await allClips()).sort((a, b) => b.createdAt - a.createdAt);
        const blob = await decryptClip(clips[0]);
        const dataUrl = await new Promise(resolve => {
          const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(blob);
        });
        return { count: clips.length, measuredDuration: clips[0].durationSeconds, size: blob.size, state: studioState, base64: dataUrl.split(',')[1] };
      });
      assert.ok(result.size > 1000);
      assert.ok(Math.abs(result.measuredDuration - duration) < 0.4);
      assert.equal(result.state, 'capturing');
      const file = path.join(outputDir, `${duration}.webm`);
      fs.writeFileSync(file, Buffer.from(result.base64, 'base64'));
      const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_packets', '-show_streams', '-of', 'json', file]));
      assert.ok(probe.streams.every(stream => stream.codec_type === 'video'), 'clip must have no audio');
      const packetEnd = Math.max(...probe.packets.map(packet => Number(packet.pts_time) + Number(packet.duration_time || 0)));
      assert.ok(packetEnd <= duration + 0.000001, `clip exceeds selected duration: ${packetEnd}`);
      assert.ok(Math.abs(packetEnd - duration) < 0.15, `encoded duration ${packetEnd}, expected ${duration}`);
      console.log(JSON.stringify({ selectedSeconds: duration, encodedSeconds: packetEnd, measuredSeconds: result.measuredDuration, bytes: result.size, passed: true }));
    }
    assert.deepEqual(errors, []);
  } finally { fs.rmSync(outputDir, { recursive: true, force: true }); }
}).catch(error => { console.error(error); process.exitCode = 1; });
