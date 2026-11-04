const { withBrowser } = require('./browser-helper.cjs');
const assert = require('node:assert/strict');

withBrowser(async (page, errors) => {
  assert.equal(await page.evaluate(() => window.__getUserMediaCalls), 0, 'camera must not start before an explicit action');
  assert.equal(await page.locator('#prepStatusTitle').textContent(), '카메라 시작 전');
  assert.equal(await page.locator('#prepDelay').textContent(), '20초');

  // Permission is requested by the start action; the connecting state is explicit.
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = () => {
      window.__getUserMediaCalls += 1;
      return new Promise((resolve) => { window.__resolveCamera = resolve; });
    };
  });
  await page.locator('#cameraButton').click();
  await page.waitForFunction(() => cameraStarting);
  assert.equal(await page.evaluate(() => window.__getUserMediaCalls), 1);
  assert.equal(await page.locator('#prepStatusTitle').textContent(), '카메라 연결 중');
  assert.match(await page.locator('#prepStatusDetail').textContent(), /권한|허용/);

  await page.evaluate(async () => {
    navigator.mediaDevices.getUserMedia = window.__originalGetUserMedia;
    window.__resolveCamera(await window.__originalGetUserMedia({ video: { facingMode: 'user' }, audio: false }));
  });
  await page.waitForFunction(() => cameraStream && frameHistory.length > 0);
  await page.evaluate(() => setDelay(20));
  assert.equal(await page.locator('#prepStatusTitle').textContent(), '지연 영상 준비 중');
  assert.match(await page.locator('#prepStatusDetail').textContent(), /초 더 모이면/);
  assert.equal(await page.locator('#prepDelay').textContent(), '20초');

  await page.evaluate(() => setDelay(1));
  await page.waitForFunction(() => $('previewWrap').classList.contains('has-video'));
  assert.equal(await page.locator('#prepStatusTitle').textContent(), '지연 영상 재생 가능');
  assert.match(await page.locator('#prepStatusDetail').textContent(), /1초 전 장면/);

  await page.evaluate(() => cameraStream.getVideoTracks()[0].dispatchEvent(new Event('ended')));
  assert.equal(await page.evaluate(() => cameraStream), null);
  assert.equal(await page.locator('#prepStatusTitle').textContent(), '촬영 중단');
  assert.match(await page.locator('#prepStatusDetail').textContent(), /끊겼어요/);
  assert.equal(await page.locator('#cameraButton').isDisabled(), false);

  // Explicit retry is still the only way back to camera start.
  await page.locator('#cameraButton').click();
  await page.waitForFunction(() => cameraStream && frameHistory.length > 0);
  assert.equal(await page.evaluate(() => studioState), 'capturing');
  assert.equal(await page.locator('#cameraButton').isEnabled(), true);
  console.log('Teacher prep states: idle → connecting → warming → live → interrupted → explicit retry passed');
  assert.deepEqual(errors, []);
}, {
  beforeApp: async (page) => {
    await page.addInitScript(() => {
      window.__getUserMediaCalls = 0;
      const original = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
      window.__originalGetUserMedia = original;
      if (original) navigator.mediaDevices.getUserMedia = (...args) => {
        window.__getUserMediaCalls += 1;
        return original(...args);
      };
    });
  },
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
