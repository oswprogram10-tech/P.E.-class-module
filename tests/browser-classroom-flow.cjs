const { withBrowser } = require('./browser-helper.cjs');
const { createHub } = require('../server/classroom-hub');
const assert = require('node:assert/strict');

(async () => {
  const hub = createHub({ teacherSecret: 'synthetic-secret-for-test' });
  await new Promise((resolve, reject) => { hub.server.once('error', reject); hub.server.listen(0, '127.0.0.1', resolve); });
  const hubUrl = `http://127.0.0.1:${hub.server.address().port}`;
  try {
    await withBrowser(async (page, errors) => {
      await page.locator('#teacherButton').click();
      await page.locator('#unlockPin').fill('123456'); await page.locator('#unlockButton').click();
      await page.locator('#teacherContentPanel').waitFor({ state: 'visible' });
      await page.locator('[data-panel="classroom"]').click();
      await page.waitForTimeout(300);
      await page.locator('#newClassName').fill('검증 학급'); await page.locator('#addClassButton').click();
      await page.locator('#newGroupName').waitFor({ timeout: 5000 }).catch(async error => { console.error('class creation status:', await page.locator('#classroomStatus').textContent()); throw error; });
      await page.locator('#newGroupName').fill('가상 모둠'); await page.locator('#addGroupButton').click();
      await page.waitForFunction(() => classroomUI.state.groups.length === 1);
      for (let n = 1; n <= 2; n++) {
        await page.locator('#rosterName').fill('동명 학생'); await page.locator('#rosterNumber').fill('7');
        await page.selectOption('#rosterGroup', { label: '가상 모둠' }); await page.locator('#addStudentButton').click();
        await page.waitForFunction(n => classroomUI.state.students.length === n, n);
      }
      await page.locator('#newLessonName').fill('공 놀이'); await page.locator('#newLessonUnit').fill('협동'); await page.locator('#newLessonSport').fill('농구'); await page.locator('#addLessonButton').click();
      await page.waitForFunction(() => classroomUI.state.lessons.length === 1);
      await page.locator('#newDeviceName').fill('기기 1'); await page.locator('#addDeviceButton').click();
      await page.waitForFunction(() => classroomUI.state.devices.length === 1);
      const ids = await page.evaluate(() => ({ classId: classroomUI.state.classes[0].id, students: classroomUI.state.students.map(s => s.id), lessonId: classroomUI.state.lessons[0].id, deviceId: classroomUI.state.devices[0].id, groupId: classroomUI.state.groups[0].id }));
      assert.notEqual(ids.students[0], ids.students[1]);
      await page.selectOption('#bindStudent', ids.students[0]); await page.selectOption('#bindLesson', ids.lessonId); await page.selectOption('#bindDevice', ids.deviceId); await page.selectOption('#bindMode', 'student');
      await page.locator('#bindStationButton').click();
      await page.waitForFunction(() => !!classroomUI.state.binding);
      console.log('Class, duplicate-name roster, group, lesson, device and binding created through UI');
      await page.evaluate(async () => {
        const now = Date.now(); const metadata = { ...classroomUI.metadata(), studentName: '동명 학생', studentNumber: '7', reflectionGood: '균형', reflectionRetry: '팔 올리기' };
        const encrypted = await encryptBlob(new Blob(['synthetic-selected-video'], { type: 'video/webm' }), teacherKey);
        const meta = await encryptMetadata(metadata, teacherKey);
        await repository.put({ id: 'selected-fixture', createdAt: now, expiresAt: now + RETENTION_MS, durationSeconds: 5, mimeType: 'video/webm', iv: encrypted.iv, ciphertext: encrypted.ciphertext, metadataIv: meta.iv, metadataCiphertext: meta.ciphertext }, vaultConfig.revision);
        const legacy = await encryptMetadata({ studentName: '동명 학생', studentNumber: '7' }, teacherKey);
        await repository.put({ id: 'legacy-fixture', createdAt: now, expiresAt: now + RETENTION_MS, durationSeconds: 5, mimeType: 'video/webm', iv: encrypted.iv, ciphertext: encrypted.ciphertext, metadataIv: legacy.iv, metadataCiphertext: legacy.ciphertext }, vaultConfig.revision);
        await classroomUI.renderStudent();
      });
      const encrypted = await page.evaluate(async () => { const records = await repository.all(); const record = records.find(x => x.id === 'selected-fixture'); return { raw: JSON.stringify(records), metadata: await decryptMetadata(record) }; });
      assert.equal(encrypted.raw.includes('동명 학생'), false); assert.equal(encrypted.metadata.classId, ids.classId); assert.equal(encrypted.metadata.studentId, ids.students[0]); assert.equal(encrypted.metadata.lessonId, ids.lessonId); assert.equal(encrypted.metadata.groupId, ids.groupId); assert.equal(encrypted.metadata.deviceId, ids.deviceId); assert.ok(encrypted.metadata.reflectionId);
      assert.equal(await page.locator('#representativeClip option').count(), 2);
      await page.locator('#teacherHubUrl').fill(hubUrl); await page.locator('#hubSecret').fill('synthetic-secret-for-test'); await page.locator('#connectTeacherHub').click();
      await page.waitForFunction(() => !!classroomUI.teacherClient);
      await page.locator('#createJoinButton').click(); await page.locator('#joinPayload').waitFor({ timeout: 5000 }).catch(async error => { console.error('join creation status:', await page.locator('#classroomStatus').textContent()); throw error; });
      assert.ok(await page.locator('#joinCodeOutput img').getAttribute('src'));
      const payload = await page.locator('#joinPayload').inputValue();
      await page.locator('#teacherDialog .close-button').click();
      await page.selectOption('#representativeClip', 'selected-fixture'); await page.locator('#submitRepresentative').click();
      await page.waitForFunction(() => classroomUI.state.submissions[0]?.status === 'queued');
      await page.locator('#studentJoinPayload').fill(payload); await page.locator('#joinStudentHub').click();
      await page.waitForFunction(() => !!classroomUI.studentClient && !!classroomUI.connection);
      await page.waitForFunction(() => classroomUI.state.submissions[0]?.status === 'sent');
      await page.locator('#studentFeedback').fill('멋진 협동이었어요'); await page.locator('#sendFeedbackButton').click();
      await page.waitForFunction(() => document.querySelector('#classFeedbackBoard')?.textContent.includes('교사 확인 중'));
      await page.locator('#teacherButton').click(); await page.locator('#unlockPin').fill('123456'); await page.locator('#unlockButton').click(); await page.locator('[data-panel="classroom"]').click();
      await page.locator('#teacherHubUrl').fill(hubUrl); await page.locator('#hubSecret').fill('synthetic-secret-for-test'); await page.locator('#connectTeacherHub').click(); await page.waitForFunction(() => !!classroomUI.teacherClient);
      await page.locator('#refreshTeacherHub').click(); await page.locator('#hubTeacherItems video').waitFor();
      assert.match(await page.locator('#hubTeacherItems').textContent(), /균형.*팔 올리기/s);
      assert.match(await page.locator('#hubTeacherItems').textContent(), /멋진 협동이었어요 · pending/);
      await page.getByRole('button', { name: '공개 승인' }).click();
      await page.waitForFunction(() => document.querySelector('#hubTeacherItems')?.textContent.includes('멋진 협동이었어요 · approved'));
      await page.evaluate(() => { classroomUI.teacherClient.request = async () => { window.qrHeld = true; await new Promise(resolve => { window.releaseQr = resolve; }); return { capability: 'synthetic-late-capability' }; }; });
      await page.locator('#createJoinButton').click(); await page.waitForFunction(() => window.qrHeld);
      await page.locator('#teacherDialog .close-button').click(); await page.evaluate(() => window.releaseQr());
      await page.waitForTimeout(100);
      assert.equal(await page.locator('#joinPayload').count(), 0);
      await page.locator('#teacherButton').click(); await page.locator('#unlockPin').fill('123456'); await page.locator('#unlockButton').click(); await page.locator('[data-panel="classroom"]').click(); await page.locator('#deleteClassButton').waitFor();
      await page.context().setOffline(true);
      await page.evaluate(() => { window.confirm = () => true; });
      await page.locator('#deleteClassButton').click();
      await page.waitForFunction(() => classroomUI.state.classes[0]?.pendingDelete === true);
      const deletion = await page.evaluate(() => ({ students: classroomUI.state.students.length, name: classroomUI.state.classes[0].name, queue: classroomUI.state.outbox.filter(op => op.kind === 'delete').map(op => op.payload.id), submission: classroomUI.state.submissions[0].id }));
      assert.equal(deletion.students, 0); assert.equal(deletion.name, '삭제 대기 학급'); assert.equal(deletion.queue.length, 2, 'submission and authored feedback must both remain recoverable deletions'); assert.ok(deletion.queue.includes(deletion.submission));
      await page.context().setOffline(false);
      await page.locator('#teacherHubUrl').fill(hubUrl); await page.locator('#hubSecret').fill('synthetic-secret-for-test'); await page.locator('#connectTeacherHub').click(); await page.waitForFunction(() => !!classroomUI.teacherClient);
      await page.locator('#retryClassDeletes').click(); await page.waitForFunction(() => classroomUI.state.classes.length === 0);
      const checkAuth = await (await fetch(hubUrl + '/teacher', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: 'synthetic-secret-for-test', classId: ids.classId }) })).json();
      const checkState = await (await fetch(hubUrl + '/state', { headers: { Authorization: 'Bearer ' + checkAuth.token } })).json();
      assert.deepEqual(checkState.items, [], 'offline class deletion must withdraw both this station submission and feedback after teacher retry');
      assert.deepEqual(errors, []);
      console.log('Encrypted bound clip, explicit selection, QR join, hub submission and feedback approval passed');
    });
  } finally { await new Promise(resolve => hub.server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
