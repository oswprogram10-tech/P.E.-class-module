const { withBrowser } = require('./browser-helper.cjs');
const assert = require('node:assert/strict');

(async () => {
  await withBrowser(async (page, errors, baseUrl) => {
    await page.locator('#teacherButton').click();
    await page.locator('#unlockPin').fill('123456');
    await page.locator('#unlockButton').click();
    await page.locator('#teacherContentPanel').waitFor({ state: 'visible', timeout: 60000 });
    await page.locator('[data-panel="classroom"]').click();
    await page.locator('#newClassName').fill('비밀 5학년');
    await page.locator('#addClassButton').click();
    await page.locator('#rosterName').fill('홍길동 비밀');
    await page.locator('#rosterNumber').fill('17');
    await page.locator('#addStudentButton').click();

    const rawMeta = await page.evaluate(async () => {
      const request = indexedDB.open('pe-loop-local-v1', 2);
      const db = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      const rows = await new Promise((resolve, reject) => { const tx = db.transaction('meta'); const get = tx.objectStore('meta').get('classroom'); get.onsuccess = () => resolve(get.result); get.onerror = () => reject(get.error); });
      db.close();
      return rows ? JSON.stringify(rows) : '';
    });
    assert.ok(rawMeta, 'expected an encrypted classroom metadata record');
    assert.equal(rawMeta.includes('홍길동 비밀'), false);
    assert.equal(rawMeta.includes('비밀 5학년'), false);

    await page.locator('#teacherDialog .close-button').click();
    assert.equal(await page.locator('#classroomTeacherRoot').innerText(), '');
    assert.equal(await page.locator('#teacherDialog').isVisible(), false);
    await page.locator('#teacherButton').click();
    await page.locator('#unlockPin').fill('123456');
    await page.locator('#unlockButton').click();
    await page.locator('#teacherContentPanel').waitFor({ state: 'visible', timeout: 60000 });
    await page.locator('[data-panel="classroom"]').click();
    await page.locator('#classroomTeacherRoot #rosterName').waitFor({ state: 'visible' });
    const decryptedHasNames = await page.evaluate(() => {
      const root = document.querySelector('#classroomTeacherRoot').innerText;
      return root.includes('홍길동 비밀') && root.includes('비밀 5학년');
    });
    assert.equal(decryptedHasNames, true, 'PIN unlock should restore decrypted classroom names');

    assert.match(await page.locator('#classroomTeacherRoot').innerText(), /허브 교사 비밀값 \(PIN과 별개\)/);
    await page.locator('#teacherLockButton').click();
    assert.equal(await page.locator('#studentWorkspace').isVisible(), false);
    assert.equal(await page.locator('#studentClassroomRoot').innerText(), '');
    assert.equal(await page.locator('#classroomTeacherRoot').innerText(), '');
    assert.deepEqual(errors, []);
    console.log('Classroom privacy: encrypted metadata, close cleanup, PIN restore and separate hub secret passed');
  });
})().catch(error => { console.error(error); process.exitCode = 1; });
