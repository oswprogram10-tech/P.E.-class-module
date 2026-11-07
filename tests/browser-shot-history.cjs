const assert = require('node:assert/strict');
const { withBrowser } = require('./browser-helper.cjs');
async function unlock(page) {
  await page.locator('#teacherButton').click();
  await page.locator('#unlockPin').fill('123456'); await page.locator('#unlockButton').click();
  await page.locator('#teacherContentPanel').waitFor({ state: 'visible' });
}

withBrowser(async (page, errors) => {
  await page.waitForFunction(() => typeof ShotHistory !== 'undefined' && typeof ClassroomModel !== 'undefined');
  const schema = await page.evaluate(() => {
    const state = ClassroomModel.createState();
    const now = Date.now() + 1000, ids = Array.from({ length: 5 }, () => crypto.randomUUID());
    const [classId, studentId, lessonId, deviceId, clipId] = ids;
    ClassroomModel.add(state, 'classes', { id: classId, name: 'Test class', createdAt: now, expiresAt: now + 86400000 });
    state.classes[0].id = classId;
    ClassroomModel.add(state, 'students', { classId, name: 'Secret student', createdAt: now, expiresAt: now + 86400000 }); state.students[0].id = studentId;
    ClassroomModel.add(state, 'lessons', { classId, name: 'Lesson', sport: 'basketball', unit: 'shot', createdAt: now, expiresAt: now + 86400000 }); state.lessons[0].id = lessonId;
    ClassroomModel.add(state, 'devices', { classId, name: 'Device', createdAt: now, expiresAt: now + 86400000 }); state.devices[0].id = deviceId;
    state.binding = { classId, studentId, lessonId, deviceId };
    delete state.shotAttempts;
    const event = { id: crypto.randomUUID(), contextKey: JSON.stringify([classId, studentId, lessonId, deviceId]), inputAt: now, side: 'right', sensitivity: 'normal', elbowAngle: 165, ruleVersion: 'basketball-shot-2d-v1', thresholds: { readyAngle: 140, shootAngle: 160, wristAboveEar: .1 }, fullBodyUsable: true, wristToEar: .2, wristToShoulder: .1, minVisibility: .9, minPresence: null, modelVersion: 'lite-v1', frameWidth: 320, frameHeight: 213,
      frame: 'raw-image-secret', landmarks: [{ x: .5, y: .2 }], studentName: 'Secret student', pin: '123456' };
    const record = ShotHistory.add(state, event, now);
    const listed = ShotHistory.list(state, { classId, studentId, lessonId }, now);
    const clip = { id: clipId, classId, studentId, lessonId, deviceId, expiresAt: now + 3600000 };
    ShotHistory.linkClip(state, record.id, clip, now);
    const linked = state.shotAttempts[0];
    const linkedExpiry = linked.expiresAt;
    const sanitized = !Object.keys(linked).some(key => ['frame', 'landmarks', 'studentName', 'pin', 'contextKey', 'rawFrame'].includes(key)) && !JSON.stringify(linked).includes('raw-image-secret');
    const wrongLinkRejected = (() => { try { ShotHistory.linkClip(state, record.id, { ...clip, studentId: crypto.randomUUID() }, now); return false; } catch { return true; } })();
    linked.expiresAt = now - 1;
    const expired = ShotHistory.list(state, { classId, studentId, lessonId }, now).length === 0;
    linked.expiresAt = now + 1000;
    return { keys: Object.keys(state).sort(), listed: listed.length, sanitized, linkedExpiry, expectedClipExpiry: clip.expiresAt, wrongLinkRejected, outbox: state.outbox.length, expired, removed: ShotHistory.remove(state, record.id), left: state.shotAttempts.length };
  });
  assert.ok(schema.keys.includes('shotAttempts'));
  assert.equal(schema.listed, 1);
  assert.equal(schema.sanitized, true);
  assert.equal(schema.linkedExpiry, schema.expectedClipExpiry);
  assert.equal(schema.wrongLinkRejected, true);
  assert.equal(schema.outbox, 0);
  assert.equal(schema.expired, true);
  assert.equal(schema.removed, true);
  assert.equal(schema.left, 0);

  await unlock(page);
  await page.locator('[data-panel="classroom"]').click();
  await page.locator('#newClassName').fill('이력 검증 학급'); await page.locator('#addClassButton').click();
  await page.locator('#rosterName').fill('학생 이름 비공개'); await page.locator('#rosterNumber').fill('3'); await page.locator('#addStudentButton').click();
  await page.evaluate(async () => { await classroomUI.write(state => ClassroomModel.add(state, 'lessons', { classId: classroomUI.classId, name: '농구', unit: '슛', sport: '농구' })); await classroomUI.renderTeacher(); });
  await page.locator('#newDeviceName').fill('테스트 기기'); await page.locator('#addDeviceButton').click();
  await page.waitForFunction(() => classroomUI.state.classes.length === 1 && classroomUI.state.students.length === 1 && classroomUI.state.lessons.length === 1 && classroomUI.state.devices.length === 1, null, { timeout: 10000 }).catch(async error => { console.error('classroom setup state', await page.evaluate(() => ({ classes: classroomUI.state.classes.length, students: classroomUI.state.students.length, lessons: classroomUI.state.lessons.length, devices: classroomUI.state.devices.length })), await page.locator('#classroomStatus').textContent()); throw error; });
  const binding = await page.evaluate(() => ({ classId: classroomUI.state.classes[0].id, studentId: classroomUI.state.students[0].id, lessonId: classroomUI.state.lessons[0].id, deviceId: classroomUI.state.devices[0].id }));
  await page.selectOption('#bindStudent', binding.studentId); await page.selectOption('#bindLesson', binding.lessonId); await page.selectOption('#bindDevice', binding.deviceId); await page.selectOption('#bindMode', 'student'); await page.locator('#bindStationButton').click();
  await page.waitForFunction(() => classroomUI.binding()?.studentId);
  await page.locator('[data-panel="settings"]').click();
  assert.equal(await page.locator('#teacherShotHistoryEnabled').isChecked(), false);
  await page.locator('#teacherShotHistoryEnabled').check(); await page.waitForFunction(() => shotHistory.enabled);
  const eventResult = await page.evaluate(async binding => {
    shotHistory.active = () => true; // Isolated controller test: camera event is synthetic.
    const timestamp = performance.now(), inputAt = performance.timeOrigin + timestamp, contextKey = JSON.stringify([binding.classId, binding.studentId, binding.lessonId, binding.deviceId]);
    const evidence = { id: crypto.randomUUID(), contextKey, inputAt, side: 'right', sensitivity: 'normal', elbowAngle: 165,
      ruleVersion: 'basketball-shot-2d-v1', thresholds: { readyAngle: 140, shootAngle: 160, wristAboveEar: .1 },
      fullBodyUsable: true, wristToEar: .2, wristToShoulder: .1, minVisibility: .9, minPresence: null,
      modelVersion: 'lite-v1', frameWidth: 320, frameHeight: 213, landmarks: [{ x: .4, y: .3 }], studentName: '학생 이름 비공개', pin: '123456', rawFrame: 'image-secret' };
    const ok = await shotHistory.record({ event: true, timestamp, side: evidence.side, angle: evidence.elbowAngle, evidence });
    return { ok, inputAt, id: evidence.id };
  }, binding);
  assert.equal(eventResult.ok, true);
  await page.waitForFunction(() => classroomUI.state.shotAttempts?.length === 1);
  const stored = await page.evaluate(async () => {
    const encrypted = await repository.classroomRead(vaultConfig.revision);
    const loaded = await classroomUI.store.load(teacherKey, vaultConfig.revision);
    return { encryptedHasSecret: JSON.stringify(encrypted).includes('image-secret') || JSON.stringify(encrypted).includes('학생 이름 비공개') || JSON.stringify(encrypted).includes('123456'), record: loaded.state.shotAttempts[0], outbox: loaded.state.outbox.length };
  });
  assert.equal(stored.encryptedHasSecret, false);
  assert.equal(stored.record.studentId, binding.studentId); assert.equal(stored.record.deviceId, binding.deviceId);
  assert.equal(stored.record.inputAt, eventResult.inputAt); assert.equal(stored.outbox, 0);
  const rejected = await page.evaluate(async binding => {
    const timestamp = performance.now(), evidence = { id: crypto.randomUUID(), contextKey: JSON.stringify([binding.classId, binding.studentId, binding.lessonId, binding.deviceId]), inputAt: performance.timeOrigin + timestamp, side: 'right', sensitivity: 'normal', elbowAngle: 165, ruleVersion: 'basketball-shot-2d-v1', thresholds: { readyAngle: 140, shootAngle: 160, wristAboveEar: .1 }, fullBodyUsable: true, wristToEar: .2, wristToShoulder: .1, minVisibility: .9, minPresence: null, modelVersion: 'lite-v1', frameWidth: 320, frameHeight: 213 };
    const stale = await shotHistory.record({ event: true, timestamp: timestamp - 5000, side: 'right', angle: 165, evidence });
    const mismatch = await shotHistory.record({ event: true, timestamp, side: 'left', angle: 165, evidence });
    const noEvent = await shotHistory.record({ event: false, timestamp, side: 'right', angle: 165, evidence });
    return { stale, mismatch, noEvent, count: classroomUI.state.shotAttempts.length };
  }, binding);
  assert.deepEqual(rejected, { stale: false, mismatch: false, noEvent: false, count: 1 });
  await page.evaluate(async binding => {
    const now = Date.now(), clipId = crypto.randomUUID();
    const encrypted = await encryptBlob(new Blob(['same-scope clip bytes'], { type: 'video/webm' }), teacherKey);
    const metadata = await encryptMetadata({ classId: binding.classId, studentId: binding.studentId, lessonId: binding.lessonId, deviceId: binding.deviceId, studentName: '학생 이름 비공개', studentNumber: '3', reflectionGood: '', reflectionRetry: '' }, teacherKey);
    await repository.put({ id: clipId, createdAt: now, expiresAt: now + 3600000, durationSeconds: 5, mimeType: 'video/webm', iv: encrypted.iv, ciphertext: encrypted.ciphertext, metadataIv: metadata.iv, metadataCiphertext: metadata.ciphertext }, vaultConfig.revision);
    window.historyClipId = clipId;
  }, binding);
  await page.locator('#teacherDialog .close-button').click();
  assert.equal(await page.evaluate(() => shotHistory.enabled), true);
  await unlock(page);
  await page.waitForFunction(() => document.querySelector('#shotHistoryList [data-attempt-id]'));
  assert.equal(await page.locator('#shotHistoryList [data-attempt-id]').count(), 1);
  await page.locator('#shotHistoryList [data-action="select"]').click();
  await page.waitForFunction(() => $('shotHistoryClip').options.length > 1, null, { timeout: 10000 }).catch(async error => { console.error('clip options', await page.evaluate(async () => ({ text: $('teacherShotHistoryStatus').textContent, count: (await repository.all()).length, records: classroomUI.state.shotAttempts, meta: await Promise.all((await repository.all()).map(async r => decryptMetadata(r, teacherKey).catch(e => String(e)))) }))); throw error; });
  assert.deepEqual(await page.locator('#shotHistoryClip option').evaluateAll(options => options.slice(1).map(option => option.value)), [await page.evaluate(() => historyClipId)]);
  await page.locator('#shotHistoryClip').selectOption(await page.evaluate(() => historyClipId));
  await page.locator('#shotHistoryLinkClip').click();
  await page.waitForFunction(() => classroomUI.state.shotAttempts[0]?.clipId === historyClipId);
  assert.equal(await page.evaluate(() => classroomUI.state.outbox.length), 0, 'manual clip link stays local');
  await page.locator('#shotHistoryList [data-action="delete"]').click();
  await page.waitForFunction(() => classroomUI.state.shotAttempts.length === 0);
  await page.locator('#teacherDialog .close-button').click();
  assert.deepEqual(errors, []);
  console.log('PASS bound encrypted local history, metadata allowlist, PIN-gated UI, deletion and no outbox');
}).catch(error => { console.error(error); process.exitCode = 1; });
