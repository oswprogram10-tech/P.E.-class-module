'use strict';
const assert = require('node:assert/strict');
const { withBrowser } = require('./browser-helper.cjs');

withBrowser(async (page, errors) => {
  await page.evaluate(async () => {
    await classroomUI.write(state => {
      const cls = ClassroomModel.add(state, 'classes', { name: 'QR 검증' });
      const student = ClassroomModel.add(state, 'students', { classId: cls.id, name: '학생', number: '1' });
      const lesson = ClassroomModel.add(state, 'lessons', { classId: cls.id, name: '수업', unit: '활동', sport: '농구' });
      const device = ClassroomModel.add(state, 'devices', { classId: cls.id, name: '기기' });
      state.binding = { classId: cls.id, studentId: student.id, lessonId: lesson.id, deviceId: device.id, mode: 'student' };
    });
    await classroomUI.renderStudent();
  });
  const panel = page.locator('#studentClassroomRoot .classroom-tool').filter({ has: page.locator('#qrStudentPayload') });
  await panel.locator(':scope > summary').click();
  const scan = panel.getByRole('button', { name: '카메라로 QR 스캔' });
  await page.evaluate(() => {
    window.BarcodeDetector = class { static async getSupportedFormats() { return ['ean_13']; } };
  });
  await scan.click();
  await page.waitForFunction(() => document.querySelector('#classroomStatus').textContent.includes('무작위 ID'));
  await page.evaluate(() => {
    window.BarcodeDetector = class { static async getSupportedFormats() { return ['qr_code']; } };
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('denied', 'NotAllowedError'); };
  });
  await scan.click();
  await page.waitForFunction(() => document.querySelector('#classroomStatus').textContent.includes('권한이 거부'));

  await page.evaluate(() => {
    window.qrStops = 0;
    window.BarcodeDetector = class {
      static async getSupportedFormats() { return ['qr_code']; }
      async detect() { return [{ rawValue: 'synthetic-id' }]; }
    };
    navigator.mediaDevices.getUserMedia = async () => ({
      getTracks: () => [{ stop: () => { window.qrStops++; } }],
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', { configurable: true, set() {} });
    HTMLMediaElement.prototype.play = async () => {};
  });
  await scan.click();
  await page.waitForFunction(() => document.querySelector('#qrStudentPayload').value === 'synthetic-id');
  assert.equal(await page.evaluate(() => qrStops), 1);

  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { window.releaseQrPermission = resolve; });
  });
  await scan.click();
  await page.waitForFunction(() => typeof window.releaseQrPermission === 'function');
  await page.evaluate(() => {
    ClassroomToolsUI.stopScanner(classroomUI);
    window.releaseQrPermission({ getTracks: () => [{ stop: () => { window.qrStops++; } }] });
  });
  await page.waitForFunction(() => window.qrStops === 2);
  assert.equal(await page.evaluate(() => classroomUI.qrCameraStream), null);
  await page.evaluate(() => {
    window.BarcodeDetector = class {
      static async getSupportedFormats() { return ['qr_code']; }
      async detect() { return []; }
    };
    navigator.mediaDevices.getUserMedia = async () => ({
      getTracks: () => [{ stop: () => { window.qrStops++; } }],
    });
  });
  await scan.click();
  await page.waitForFunction(() => Boolean(classroomUI.qrCameraStream));
  await panel.locator(':scope > summary').click();
  await page.waitForFunction(() => window.qrStops === 3);
  assert.equal(await page.evaluate(() => classroomUI.qrCameraVideo), null);
  await panel.locator(':scope > summary').click();
  await scan.click();
  await page.waitForFunction(() => Boolean(classroomUI.qrCameraStream));
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    delete document.hidden;
  });
  assert.equal(await page.evaluate(() => qrStops), 4);
  assert.deepEqual(errors, []);
  console.log('PASS QR unsupported format, denied permission, decoded ID and camera cleanup on panel close or app background');
}).catch(error => { console.error(error); process.exitCode = 1; });
