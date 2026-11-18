const { withBrowser } = require('./browser-helper.cjs');
const assert = require('node:assert/strict');

async function openCheck(page) {
  await page.locator('#deviceCheckOpen').click();
  await page.locator('#unlockPin').fill('123456');
  await page.locator('#unlockButton').click();
  await page.locator('#deviceCheckPanel').waitFor({ state: 'visible' });
}
async function begin(page) {
  await page.locator('#deviceCheckModel').fill('가상 카메라 테스트 기기');
  await page.locator('#deviceCheckTestOnly').check();
  await page.selectOption('#deviceCheckHeat', 'normal');
  await page.locator('#deviceCheckStart').click();
  await page.waitForFunction(() => deviceCheckUI.session.state.status === 'running');
  await page.waitForFunction(() => frameHistory.length > 0);
}
function setupTarget(page, id) {
  return page.locator(`[data-teacher-setup-target="${id}"]`);
}
async function openSetupTarget(page, id) {
  const target = setupTarget(page, id);
  if (!await target.isVisible()) await page.locator('#teacherUnimplementedFeatures > summary').click();
  await target.click();
}
async function openSetup(page) {
  await page.locator('[data-panel="device-check"]').click();
  await page.locator('#deviceCheckPanel').waitFor({ state: 'visible' });
}

withBrowser(async (page, errors) => {
  assert.equal(await page.locator('#deviceCheckNotice').isVisible(), true);
  assert.equal(await page.locator('#deviceCheckPanel').isVisible(), false);
  await page.locator('#teacherButton').click();
  await page.locator('#newPin').fill('123456'); await page.locator('#confirmPin').fill('123456');
  await page.locator('#createPinButton').click();
  await page.locator('#deviceCheckPanel').waitFor({ state: 'visible' });
  assert.match(await page.locator('.teacher-setup-guide').textContent(), /교사 기기에 정보 저장 · 학교 서버 운영/);
  assert.match(await page.locator('#teacherUnimplementedFeatures').textContent(), /나이스 연동은 미구현/);
  assert.equal(await setupTarget(page, 'wearableModelReference').isVisible(), false);
  await page.setViewportSize({ width: 360, height: 800 });
  for (const selector of ['[data-teacher-setup-target="teacherDelay"]', '[data-teacher-setup-target="qrMissionTitle"]', '#deviceCheckModel', '#deviceCheckHeat', '#deviceCheckStart', '#deviceCheckSave', '#deviceCheckLater', '#deviceCheck-offline']) {
    await page.locator(selector).scrollIntoViewIfNeeded();
    const box = await page.locator(selector).boundingBox();
    assert.ok(box && box.width >= 48 && box.height >= 48, `${selector} must remain usable on a narrow screen`);
  }
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.locator('#teacherContentTitle').scrollIntoViewIfNeeded();
  await page.screenshot({ path: '/tmp/pe-loop-first-use-check.png' });
  await page.setViewportSize({ width: 1280, height: 900 });
  await setupTarget(page, 'deviceCheckTitle').click();
  await page.waitForFunction(() => document.activeElement?.id === 'deviceCheckTitle');
  await openSetupTarget(page, 'teacherMovementSport');
  await page.waitForFunction(() => document.activeElement?.id === 'teacherMovementSport');
  await page.locator('#teacherSetupGuideButton').click();
  await setupTarget(page, 'teacherDelay').click();
  await page.waitForFunction(() => document.activeElement?.id === 'teacherDelay');
  await page.locator('#teacherSetupGuideButton').click();
  await setupTarget(page, 'papsProgramSelectionPanel').click();
  await page.waitForFunction(() => document.activeElement?.id === 'newClassName');
  assert.match(await page.locator('#teacherSetupClassNotice').textContent(), /먼저 학급/);
  await page.locator('#newClassName').fill('첫 사용 검증반');
  await page.locator('#addClassButton').click();
  await page.locator('#papsProgramSelectionPanel').waitFor({ state: 'attached' });
  for (const id of ['newClassName', 'teacherHubUrl', 'papsProgramSelectionPanel', 'rubricTitle', 'routineGoal', 'qrMissionTitle', 'tacticsConnectedTools', 'tacticsDevicePanel', 'wearableModelReference']) {
    await openSetup(page);
    await openSetupTarget(page, id);
    const target = page.locator(`#${id}`);
    await target.waitFor({ state: 'visible' });
    assert.equal(await target.evaluate(node => node === document.activeElement || node.contains(document.activeElement)), true, id);
  }
  assert.equal(await page.evaluate(() => deviceCheckUI.session.state.status), 'pending', 'opening setup pages does not complete the device check');
  assert.equal(await page.evaluate(() => cameraStream), null, 'setup does not start the camera');
  await page.locator('#teacherDialog .close-button').click();
  await page.evaluate(() => deviceCheckUI.guarded(() => deviceCheckUI.session.defer()));
  assert.equal(await page.evaluate(() => deviceCheckUI.session.state.status), 'pending', 'locked callers cannot change the result');
  await openCheck(page);
  await page.locator('#deviceCheckLater').click();
  await page.locator('#teacherDialog .close-button').click();
  await page.reload(); await page.waitForFunction(() => appReady);
  assert.match(await page.locator('#deviceCheckSummary').textContent(), /나중에/);
  await openCheck(page);
  await page.locator('#deviceCheckStart').click();
  assert.match(await page.locator('#deviceCheckError').textContent(), /테스트 자료/);
  await begin(page);
  assert.equal(await page.locator('#teacherDialog').evaluate(el => el.open), false);
  await page.waitForFunction(() => deviceCheckUI.session.state.elapsedMs >= 1000);
  await page.locator('#cameraButton').click();
  assert.equal(await page.evaluate(() => deviceCheckUI.session.state.status), 'interrupted');
  await openCheck(page);
  await page.locator('#deviceCheckSave').click();
  assert.match(await page.locator('#deviceCheckStatus').textContent(), /40분 연속 촬영이 아직/);
  await begin(page);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    delete document.hidden;
  });
  assert.equal(await page.evaluate(() => deviceCheckUI.session.state.status), 'interrupted');
  assert.equal(await page.evaluate(() => cameraStream === null), true);
  await openCheck(page); await begin(page);
  await page.reload(); await page.waitForFunction(() => appReady);
  assert.equal(await page.evaluate(() => deviceCheckUI.session.state.status), 'interrupted');
  await openCheck(page); await begin(page);
  await openCheck(page);
  await page.selectOption('#deviceCheckHeat', 'hot');
  await page.locator('#deviceCheckHeatRecord').click();
  assert.equal(await page.evaluate(() => deviceCheckUI.session.state.status), 'failed');
  assert.equal(await page.evaluate(() => cameraStream === null), true, 'overheating observation stops capture');
  await begin(page);
  // Exercise final review with synthetic time, not a real 40-minute device test.
  await page.evaluate(() => {
    const session = deviceCheckUI.session, start = performance.now(), wall = Date.now();
    for (let elapsed = 1000; elapsed <= DeviceCheck.DURATION_MS; elapsed += 1000) session.observe({ now: start + elapsed, wallTime: wall + elapsed, active: true, visible: true, frameAt: start + elapsed - 10, frames: 100, bytes: 500000, bufferMs: 5000 });
    deviceCheckUI.persist(); deviceCheckUI.render();
  });
  await openCheck(page);
  for (const id of ['placement', 'visibility', 'controls', 'clips', 'offline']) await page.selectOption(`#deviceCheck-${id}`, 'pass');
  await page.locator('#deviceCheckSave').click();
  assert.match(await page.locator('#deviceCheckStatus').textContent(), /미확인/);
  await page.selectOption('#deviceCheckHeat', 'warm');
  await page.locator('#deviceCheckHeatRecord').click();
  await page.locator('#deviceCheckSave').click();
  assert.match(await page.locator('#deviceCheckStatus').textContent(), /교사 기기·현장 점검 완료/);
  await page.locator('#teacherDialog .close-button').click();
  await page.reload(); await page.waitForFunction(() => appReady);
  assert.equal(await page.locator('#deviceCheckNotice').isHidden(), true);
  await page.locator('#teacherButton').click();
  await page.locator('#unlockPin').fill('123456'); await page.locator('#unlockButton').click();
  await page.locator('#teacherSetupGuideButton').click();
  await page.selectOption('#deviceCheck-controls', 'fail');
  await page.locator('#deviceCheckSave').click();
  assert.match(await page.locator('#deviceCheckStatus').textContent(), /문제 발견/);
  await page.evaluate(() => { Storage.prototype.setItem = function () { throw new DOMException('test quota', 'QuotaExceededError'); }; });
  await page.locator('#deviceCheckSave').click();
  assert.match(await page.locator('#deviceCheckError').textContent(), /저장하지 못했어요/);
  assert.deepEqual(errors, []);
  console.log('First-run teacher setup, focused tool navigation, PIN gate, deferral, actual camera interruption/reload, synthetic-time review gating, persistence and quota failure passed.');
}, { setupTeacher: false }).catch(error => { console.error(error); process.exitCode = 1; });
