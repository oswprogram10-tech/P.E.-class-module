const { withBrowser } = require('./browser-helper.cjs');
const { seedClip } = require('./data-fixtures.cjs');
const assert = require('node:assert/strict');

withBrowser(async (page, errors, baseUrl) => {
  await seedClip(page, { id: 'before-reset' });
  const oldRevision = await page.evaluate(() => vaultConfig.revision);
  await page.evaluate(async () => {
    const config = await repository.config(), key = await LocalVault.verify('123456', config);
    const loaded = await classroomUI.store.load(key, config.revision);
    const classroom = ClassroomModel.add(loaded.state, 'classes', { name: '가상 체육 학급' });
    const student = ClassroomModel.add(loaded.state, 'students', { classId: classroom.id, name: '가상 학생' });
    const today = new Date();
    const measuredOn = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const schoolYear = ClassroomModel.schoolYearForDate(measuredOn);
    const input = { classId: classroom.id, studentId: student.id, schoolYear, measuredOn, itemId: 'grip-strength', value: 12.3, unit: 'kg', missingReason: null, missingNote: '' };
    const record = ClassroomModel.add(loaded.state, 'measurements', input);
    ClassroomModel.updateMeasurement(loaded.state, record.id, { ...input, value: 13.4 });
    await classroomUI.store.save(loaded.state, key, config.revision, loaded.version);
  });
  const peer = await page.context().newPage();
  peer.on('pageerror', error => errors.push(error.message));
  await peer.goto(baseUrl); await peer.waitForFunction(() => appReady);
  await peer.locator('#teacherButton').click();
  await peer.locator('#unlockPin').fill('123456'); await peer.locator('#unlockButton').click();
  await peer.locator('#teacherContentPanel').waitFor({ state: 'visible' });
  await peer.evaluate(() => { window.oldRevision = vaultConfig.revision; window.oldKey = teacherKey; });
  await page.bringToFront();
  await page.locator('#teacherButton').click(); await page.locator('#forgotPinButton').click();
  await page.locator('#resetNewPin').fill('654321'); await page.locator('#resetConfirmPin').fill('654321');
  await page.locator('#resetPhrase').fill('삭제');
  assert.equal(await page.locator('#confirmResetButton').isDisabled(), true);
  await page.locator('#cancelResetButton').click();
  assert.equal(await page.evaluate(async () => (await allClips()).length), 1);
  assert.equal(await page.evaluate(async () => (await repository.config()).revision), oldRevision);
  await page.locator('#teacherButton').click(); await page.locator('#forgotPinButton').click();
  await page.locator('#resetNewPin').fill('654321'); await page.locator('#resetConfirmPin').fill('654321');
  await page.locator('#resetPhrase').fill('모두 삭제');
  await page.evaluate(() => {
    window.originalReset = repository.reset.bind(repository);
    repository.reset = config => repository.transaction(['clips', 'meta'], 'readwrite', tx => {
      tx.objectStore('clips').clear(); tx.objectStore('meta').put(config, 'vault');
      throw new DOMException('synthetic interrupted reset', 'QuotaExceededError');
    });
  });
  await page.locator('#confirmResetButton').click(); await page.waitForFunction(() => !resetting);
  assert.match(await page.locator('#resetMessage').textContent(), /완료하지 못했어요/);
  assert.equal(await page.evaluate(async () => (await allClips()).length), 1);
  assert.equal(await page.evaluate(async () => (await repository.config()).revision), oldRevision);
  const dataPreserved = await page.evaluate(async () => {
    const key = await LocalVault.verify('123456', await repository.config());
    const config = await repository.config(), loaded = await classroomUI.store.load(key, config.revision);
    const clipPreserved = (await decryptMetadata((await allClips())[0], key)).studentName === '가상학생';
    const record = loaded.state.measurements[0];
    return clipPreserved && loaded.state.classes.length === 1 && record?.value === 13.4 && record.changeHistory?.length === 1 && record.changeHistory[0].before.value === 12.3;
  });
  assert.equal(dataPreserved, true);
  console.log('Reset confirmation/cancel and atomic rollback preserve clips, measurements and correction history passed');

  await page.evaluate(() => { repository.reset = window.originalReset; });
  await page.locator('#confirmResetButton').click();
  await page.waitForFunction(() => !$('resetDialog').open);
  assert.equal(await page.evaluate(async () => (await allClips()).length), 0);
  const newRevision = await page.evaluate(async () => (await repository.config()).revision);
  assert.notEqual(newRevision, oldRevision);
  await peer.waitForFunction(() => teacherKey === null);
  const staleRejected = await peer.evaluate(async () => repository.put({ id: 'stale-key-write' }, window.oldRevision).then(() => false, () => true));
  assert.equal(staleRejected, true);
  assert.equal(await page.evaluate(async () => (await allClips()).length), 0);
  assert.equal(await page.evaluate(async () => LocalVault.verify('123456', await repository.config()).then(() => false, () => true)), true);
  assert.equal(await page.evaluate(async () => !!await LocalVault.verify('654321', await repository.config())), true);
  await page.reload(); await page.waitForFunction(() => appReady);
  assert.equal(await page.evaluate(() => teacherKey), null);
  await page.locator('#teacherButton').click();
  await page.locator('#unlockPin').fill('654321'); await page.locator('#unlockButton').click();
  await page.locator('#teacherContentPanel').waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(async () => (await allClips()).length), 0);
  const classroomAfterReset = await page.evaluate(async () => {
    const loaded = await classroomUI.store.load(teacherKey, vaultConfig.revision);
    return { classes: loaded.state.classes.length, measurements: loaded.state.measurements.length };
  });
  assert.deepEqual(classroomAfterReset, { classes: 0, measurements: 0 });
  assert.deepEqual(errors, []);
  await peer.close();
  console.log('Confirmed reset/new PIN, reload and cross-tab stale-key rejection passed');
}).catch(error => { console.error(error); process.exitCode = 1; });
