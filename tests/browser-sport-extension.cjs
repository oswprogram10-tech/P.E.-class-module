const assert = require('node:assert/strict');
const { withBrowser } = require('./browser-helper.cjs');
const { pose: base } = require('../scripts/shot-evaluation.cjs');
function pose(phase) {
  const p = base('lower');
  if (phase === 'ready') { p[14] = { x: .7, y: .2, visibility: .95 }; p[16] = { x: .6, y: .15, visibility: .95 }; }
  if (phase === 'swing') { p[14] = { x: .7, y: .31, visibility: .95 }; p[16] = { x: .88, y: .25, visibility: .95 }; }
  return p;
}
withBrowser(async (page, errors) => {
  assert.equal(await page.evaluate(() => poseUI.sport), 'basketball');
  await page.locator('#teacherButton').click();
  await page.locator('#unlockPin').fill('123456'); await page.locator('#unlockButton').click();
  await page.locator('#teacherContentPanel').waitFor({ state: 'visible' });
  await page.locator('#teacherShotEnabled').check(); await page.locator('#saveShotSettings').click();
  const saved = await page.evaluate(() => localStorage.getItem('pe-loop-settings-v1'));
  await page.locator('#teacherMovementSport').selectOption('volleyball');
  await page.locator('#teacherVolleyballEnabled').check(); await page.locator('#applyMovement').click();
  assert.equal(await page.evaluate(() => poseUI.sport), 'volleyball');
  assert.equal(await page.locator('#teacherShotHistoryEnabled').isDisabled(), true);
  assert.equal(await page.evaluate(() => shotHistory.enabled), false);
  assert.equal(await page.locator('#shotPanel').isVisible(), false);
  assert.equal(await page.evaluate(() => localStorage.getItem('pe-loop-settings-v1')), saved);
  await page.locator('#teacherDialog .close-button').click();
  await page.evaluate(() => {
    poseUI.prepared = true;
    poseUI.runtimeFactory = () => ({ closed: false, inflight: false, start: async () => {}, stop() {}, close() { this.closed = true; }, submit(bitmap) { bitmap.close(); return false; } });
    poseUI.setEnabled(true);
    window.cues = []; window.historyCalls = 0;
    const render = poseUI.onCueState;
    poseUI.onCueState = snapshot => { cues.push(snapshot); render(snapshot); };
    shotHistory.record = () => { historyCalls++; };
  });
  await page.locator('#cameraButton').click();
  await page.waitForFunction(() => poseUI.running && cameraStream);
  for (const p of [pose('ready'), pose('ready'), pose('ready'), pose('ready'), pose('swing'), pose('swing')]) {
    await page.evaluate(async landmarks => { await new Promise(r => setTimeout(r, 280)); poseUI.receive({ timestamp: performance.now(), width: 640, height: 480, landmarks: [landmarks] }); }, p);
  }
  const result = await page.evaluate(() => ({ cues: cues.filter(s => s.event).map(s => ({ type: s.type, evidence: s.evidence })), historyCalls, state: poseUI.cueDetector.state, status: $('volleyballStatus').textContent }));
  assert.deepEqual(result.cues, [{ type: 'volleyball-overhead-cue', evidence: undefined }]);
  assert.equal(result.historyCalls, 0); assert.equal(result.state, 'swing'); assert.match(result.status, /유사 동작/);
  await page.locator('#teacherButton').click(); await page.locator('#unlockPin').fill('123456'); await page.locator('#unlockButton').click();
  await page.locator('#teacherContentPanel').waitFor({ state: 'visible' });
  await page.locator('#teacherMovementSport').selectOption('basketball'); await page.locator('#applyMovement').click();
  assert.deepEqual(await page.evaluate(() => ({ sport: poseUI.sport, state: poseUI.shotDetector.state, capture: poseUI.captureEnabled, history: shotHistory.enabled })), { sport: 'basketball', state: 'waiting', capture: false, history: false });
  assert.equal(await page.evaluate(() => localStorage.getItem('pe-loop-settings-v1')), saved);
  assert.equal(await page.evaluate(() => ShotHistoryUI.prototype.record.call({ enabled: true }, { event: true, type: 'volleyball-overhead-cue' })), false);
  const trust = await page.evaluate(() => {
    const rejected = options => { try { new PoseRuntime(options); return false; } catch { return true; } };
    const runtime = new PoseRuntime();
    let immutable = false; try { runtime.assets = {}; } catch {} immutable = runtime.assets.id === ModelProfiles.DEFAULT_ID;
    return { unknown: rejected({ profileId: 'remote-model' }), url: rejected({ profileId: 'https://example.org/model' }), assets: rejected({ assets: PoseAssets }), customUrl: rejected({ url: './custom.task' }), weights: rejected({ modelAssetBuffer: new Uint8Array() }), immutable };
  });
  assert.deepEqual(trust, { unknown: true, url: true, assets: true, customUrl: true, weights: true, immutable: true });
  await page.reload(); await page.waitForFunction(() => appReady);
  assert.deepEqual(await page.evaluate(() => ({ sport: poseUI.sport, enabled: poseUI.cueSettings.enabled, shot: shotSettings })), { sport: 'basketball', enabled: false, shot: { enabled: true, side: 'right', sensitivity: 'normal' } });
  assert.deepEqual(errors, []);
  console.log('PASS session sport/reset, separate synthetic volleyball cue, no basketball history, pinned profile rejection and reload compatibility');
}, { setupTeacher: true }).catch(error => { console.error(error); process.exitCode = 1; });
