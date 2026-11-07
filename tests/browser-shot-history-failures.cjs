const assert = require('node:assert/strict');
const { withBrowser } = require('./browser-helper.cjs');

withBrowser(async (page, errors) => {
  const open = async () => {
    await page.locator('#teacherButton').click(); await page.locator('#unlockPin').fill('123456'); await page.locator('#unlockButton').click();
    await page.locator('#teacherContentPanel').waitFor({ state: 'visible' });
  };
  await open();
  await page.evaluate(async () => {
    await classroomUI.write(s => {
      const c = ClassroomModel.add(s, 'classes', { name: '합성 검증 학급' });
      const student = ClassroomModel.add(s, 'students', { classId: c.id, name: '가상 학생' });
      const lesson = ClassroomModel.add(s, 'lessons', { classId: c.id, name: '수업', sport: '농구', unit: '슛' });
      const device = ClassroomModel.add(s, 'devices', { classId: c.id, name: '기기' });
      s.binding = { classId: c.id, studentId: student.id, lessonId: lesson.id, deviceId: device.id };
    });
    await shotHistory.refresh();
  });
  await page.locator('#teacherShotEnabled').check(); await page.locator('#saveShotSettings').click();
  await page.locator('#teacherShotHistoryEnabled').check();
  await page.locator('#teacherDialog .close-button').click();
  await page.evaluate(async () => {
    class FakeRuntime {
      async prepare() {} async start(callbacks) { this.callbacks = callbacks; }
      submit(bitmap) { bitmap.close(); return false; } stop() {} close() {}
    }
    poseUI.runtimeFactory = () => new FakeRuntime(); await poseUI.prepare();
  });
  await page.locator('#cameraButton').click(); await page.waitForFunction(() => cameraStream && frameHistory.length > 2);
  await page.locator('#poseEnabled').check(); await page.waitForFunction(() => poseUI.running);
  await page.evaluate(async () => {
    const pose = phase => {
      const points = Array.from({ length: 33 }, () => ({ x: .5, y: .5, visibility: .95 }));
      const coords = { 0:[.5,.12],7:[.44,.15],8:[.56,.15],11:[.4,.34],12:[.6,.34],13:[.35,.45],14:[.65,.45],15:[.3,.55],16:[.7,.55],23:[.43,.60],24:[.57,.60],25:[.43,.72],26:[.57,.72],27:[.43,.88],28:[.57,.88],31:[.4,.94],32:[.6,.94] };
      for (const [i, xy] of Object.entries(coords)) [points[i].x, points[i].y] = xy;
      if (phase === 'ready') { points[14] = { x: .66, y: .25, visibility: .95 }; points[16] = { x: .6, y: .17, visibility: .95 }; }
      else { points[14] = { x: .6, y: .22, visibility: .95 }; points[16] = { x: .6, y: .08, visibility: .95 }; }
      return points;
    };
    for (const phase of ['ready', 'ready', 'ready', 'ready', 'shoot', 'shoot']) {
      await new Promise(resolve => setTimeout(resolve, 280));
      poseUI.receive({ timestamp: performance.now(), width: 320, height: 240, landmarks: [pose(phase)] });
    }
    window.historySnapshot = () => {
      const timestamp = performance.now(); const evidence = { id: crypto.randomUUID(), contextKey: currentShotContext(), inputAt: Math.round(performance.timeOrigin + timestamp), side: 'right', sensitivity: 'normal', elbowAngle: 170,
        ruleVersion: 'basketball-shot-2d-v1', thresholds: { readyAngle: 140, shootAngle: 160, wristAboveEar: .1 }, fullBodyUsable: true,
        wristToEar: .2, wristToShoulder: .7, minVisibility: .95, minPresence: null, modelVersion: PoseAssets.version, frameWidth: 320, frameHeight: 240 };
      return { event: true, state: 'shoot', timestamp, side: 'right', angle: 170, evidence };
    };
  });
  await page.waitForFunction(() => !shotHistory.busy && classroomUI.state.shotAttempts?.length === 1);
  const count = () => page.evaluate(async () => (await classroomUI.store.load(teacherKey, vaultConfig.revision)).state.shotAttempts.length);
  assert.equal(await count(), 1, 'real detector and app callback persist one synthetic motion event');

  const before = await page.evaluate(() => frameHistory.length);
  const quota = await page.evaluate(async () => {
    const write = repository.classroomWrite.bind(repository);
    try { repository.classroomWrite = async () => { throw new DOMException('test full', 'QuotaExceededError'); }; return await shotHistory.record(historySnapshot()); }
    finally { repository.classroomWrite = write; }
  });
  assert.equal(quota, false); assert.equal(await count(), 1);
  assert.match(await page.locator('#shotHistoryStatus').textContent(), /저장하지 못했어요/);
  await page.waitForFunction(n => cameraStream && captureLoop && frameHistory.length > n + 2, before);

  const txAbort = await page.evaluate(async () => {
    const write = repository.classroomWrite.bind(repository); let entered = false;
    try {
      repository.classroomWrite = (record, revision, version, options) => write(record, revision, version, { ...options, validate: () => { entered = true; shotHistory.controller.abort(); return options.validate(); } });
      return { stored: await shotHistory.record(historySnapshot()), entered };
    } finally { repository.classroomWrite = write; }
  });
  assert.deepEqual(txAbort, { stored: false, entered: true }); assert.equal(await count(), 1);

  await open(); await page.locator('#teacherShotHistoryEnabled').uncheck(); await page.locator('#teacherShotHistoryEnabled').check();
  await page.locator('#teacherDialog .close-button').click(); await page.waitForFunction(() => poseUI.running);
  await page.evaluate(() => {
    window.nativeHistoryEncrypt = LocalVault.encrypt;
    LocalVault.encrypt = async (...args) => { const value = await nativeHistoryEncrypt(...args); window.encryptHeld = true; await new Promise(resolve => { window.releaseHistoryEncrypt = resolve; }); return value; };
    window.pendingHistoryWrite = shotHistory.record(historySnapshot());
  });
  await page.waitForFunction(() => window.encryptHeld);
  await page.evaluate(() => { shotHistory.stop(); releaseHistoryEncrypt(); });
  assert.equal(await page.evaluate(() => pendingHistoryWrite), false);
  await page.evaluate(() => { LocalVault.encrypt = nativeHistoryEncrypt; });
  assert.equal(await count(), 1); assert.equal(await page.evaluate(() => Boolean(cameraStream && captureLoop && poseUI.running)), true);
  assert.deepEqual(errors, []);
  console.log('PASS synthetic PoseUI event → encrypted history; injected quota and real IDB abort/stop-during-encryption preserve data and camera. No real sports accuracy claimed.');
}).catch(error => { console.error(error); process.exitCode = 1; });
