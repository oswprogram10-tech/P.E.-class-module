const { withBrowser } = require('./browser-helper.cjs');
const { seedClip, unlock, library } = require('./data-fixtures.cjs');
const assert = require('node:assert/strict');

withBrowser(async (page, errors) => {
  await seedClip(page, { id: 'good', name: '정상가상학생' });
  await seedClip(page, { id: 'bad-meta', badMetadata: true });
  await seedClip(page, { id: 'bad-video', badVideo: true });
  const encryption = await page.evaluate(async () => {
    const record = (await allClips()).find(record => record.id === 'good');
    window.classKey = teacherKey;
    return { extractable: teacherKey.extractable, plaintextNameStored: JSON.stringify(record).includes('정상가상학생'), pinInSettings: !!JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}').pinSalt };
  });
  assert.deepEqual(encryption, { extractable: false, plaintextNameStored: false, pinInSettings: false });
  await unlock(page); await library(page, 3);
  await page.evaluate(() => { window.classKey = teacherKey; });
  assert.match(await page.locator('[data-clip-id="good"]').textContent(), /정상가상학생/);
  assert.equal(await page.locator('[data-clip-id="bad-meta"] .library-play').isDisabled(), true);
  await page.locator('[data-clip-id="bad-video"] .library-play').click();
  await page.waitForFunction(() => libraryRows.get('bad-video').textContent.includes('영상을 읽을 수 없어요'));
  assert.match(await page.locator('[data-clip-id="good"]').textContent(), /정상가상학생/);
  await page.locator('[data-clip-id="good"] .library-play').click();
  await page.waitForFunction(() => libraryObjectUrls.length === 1);
  await page.locator('#teacherDialog .close-button').click();
  assert.equal(await page.evaluate(() => libraryObjectUrls.length), 0);
  assert.equal(await page.locator('.library-video').count(), 0);
  assert.equal(await page.locator('#libraryList').textContent(), '');
  assert.equal(await page.evaluate(() => teacherKey === window.classKey), true);
  await page.locator('#teacherButton').click();
  await page.locator('#unlockPin').fill('654321'); await page.locator('#unlockButton').click();
  await page.waitForFunction(() => !pinBusy);
  assert.equal(await page.evaluate(() => teacherUnlocked), false);
  assert.equal(await page.evaluate(() => teacherKey === window.classKey), true);
  assert.equal(await page.locator('#unlockPin').inputValue(), '');
  assert.equal(await page.evaluate(async () => (await allClips()).length), 3);
  await page.locator('#teacherDialog .close-button').click();
  console.log('Encryption, corrupt-row isolation, wrong PIN and close/key separation passed');

  await unlock(page);
  await page.evaluate(() => {
    window.realMetadata = decryptMetadata;
    window.metadataHeld = false;
    decryptMetadata = async (...args) => {
      if (!window.metadataHeld) { window.metadataHeld = true; await new Promise(resolve => { window.releaseMetadata = resolve; }); }
      return window.realMetadata(...args);
    };
  });
  await page.locator('[data-panel="library"]').click();
  await page.waitForFunction(() => window.metadataHeld);
  await page.locator('#teacherDialog .close-button').click();
  await page.evaluate(() => window.releaseMetadata());
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#libraryList').textContent(), '');
  assert.equal(await page.evaluate(() => libraryObjectUrls.length), 0);
  await page.evaluate(() => { decryptMetadata = window.realMetadata; });
  await unlock(page); await library(page, 3);
  await page.evaluate(() => {
    window.realDecrypt = decryptClip;
    decryptClip = async (...args) => { window.videoHeld = true; await new Promise(resolve => { window.releaseVideo = resolve; }); return window.realDecrypt(...args); };
  });
  await page.locator('[data-clip-id="good"] .library-play').click();
  await page.waitForFunction(() => window.videoHeld);
  await page.locator('#teacherDialog .close-button').click();
  await page.evaluate(() => window.releaseVideo());
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => libraryObjectUrls.length), 0);
  assert.equal(await page.locator('.library-video').count(), 0);
  await page.evaluate(() => { decryptClip = window.realDecrypt; lockTeacherDialog(); });
  assert.equal(await page.evaluate(() => teacherKey), null);
  await page.locator('#teacherButton').click();
  await page.evaluate(() => {
    window.realVerify = LocalVault.verify;
    LocalVault.verify = async (...args) => { window.verifyHeld = true; await new Promise(resolve => { window.releaseVerify = resolve; }); return window.realVerify(...args); };
  });
  await page.locator('#unlockPin').fill('123456'); await page.locator('#unlockButton').click();
  await page.waitForFunction(() => window.verifyHeld);
  await page.locator('#teacherDialog .close-button').click();
  await page.evaluate(() => window.releaseVerify());
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => teacherKey), null);
  assert.equal(await page.evaluate(() => teacherUnlocked), false);
  await page.evaluate(() => { LocalVault.verify = window.realVerify; });
  console.log('Late metadata/video/PIN results are discarded after close passed');

  await unlock(page); await library(page, 3);
  await page.locator('[data-clip-id="bad-meta"] .library-delete').click();
  await page.locator('#cancelDeleteButton').click();
  assert.equal(await page.evaluate(async () => (await allClips()).length), 3);
  await page.evaluate(() => {
    window.realDelete = repository.delete.bind(repository);
    repository.delete = async () => { throw new Error('synthetic delete failure'); };
  });
  await page.locator('[data-clip-id="bad-meta"] .library-delete').click();
  await page.locator('#confirmDeleteButton').click(); await page.waitForFunction(() => !deleting);
  assert.match(await page.locator('#deleteMessage').textContent(), /삭제하지 못했어요/);
  assert.equal(await page.evaluate(async () => (await allClips()).length), 3);
  await page.evaluate(() => { repository.delete = window.realDelete; });
  await page.locator('#confirmDeleteButton').click();
  await page.waitForFunction(() => !$('deleteDialog').open && libraryRows.size === 2);
  assert.equal(await page.evaluate(async () => (await allClips()).some(record => record.id === 'bad-meta')), false);
  console.log('Manual delete cancel, failure and retry passed');

  const boundary = await page.evaluate(async () => {
    const record = (await allClips()).find(record => record.id === 'good');
    const at = Date.now();
    const copy = { ...record, id: 'expiry-boundary', createdAt: at - RETENTION_MS, expiresAt: at };
    await withStore('readwrite', store => store.put(copy));
    const before = await repository.get(copy.id, vaultConfig.revision, at - 1);
    await repository.expire(at - 1);
    const stillExists = (await allClips()).some(record => record.id === copy.id);
    await repository.expire(at);
    const after = (await allClips()).some(record => record.id === copy.id);
    return { before: !!before, stillExists, after };
  });
  assert.deepEqual(boundary, { before: true, stillExists: true, after: false });
  await seedClip(page, { id: 'expires-on-screen', expiresAt: Date.now() + 2000 });
  await page.evaluate(() => loadLibrary());
  await page.waitForFunction(() => libraryRows.has('expires-on-screen'));
  await page.locator('[data-clip-id="expires-on-screen"] .library-play').click();
  await page.waitForFunction(() => libraryObjectUrls.length === 1);
  await page.waitForFunction(() => !libraryRows.has('expires-on-screen'), {}, { timeout: 6000 });
  assert.equal(await page.evaluate(() => libraryObjectUrls.length), 0);
  assert.equal(await page.evaluate(async () => (await allClips()).some(record => record.id === 'expires-on-screen')), false);
  console.log('Exact expiry boundary and active-player expiration cleanup passed');

  await page.locator('[data-panel="settings"]').click();
  await page.evaluate(() => {
    window.originalEstimate = navigator.storage.estimate.bind(navigator.storage);
    window.estimateRequests = [];
    navigator.storage.estimate = () => new Promise(resolve => window.estimateRequests.push(resolve));
  });
  await page.evaluate(async () => {
    const old = refreshStorageInfo();
    const recent = refreshStorageInfo();
    window.estimateRequests[1]({ usage: 1048500, quota: 1048576 }); await recent;
    window.estimateRequests[0]({ usage: 1, quota: 10737418240 }); await old;
  });
  assert.match(await page.locator('#storageInfo').textContent(), /여유가 적어요/);
  await page.evaluate(() => {
    navigator.storage.estimate = async () => { throw new Error('synthetic unavailable'); };
  });
  await page.evaluate(() => refreshStorageInfo());
  assert.match(await page.locator('#storageInfo').textContent(), /확인하지 못했어요/);
  await page.evaluate(() => { navigator.storage.estimate = window.originalEstimate; });
  const delayBefore = await page.evaluate(() => delaySeconds);
  await page.evaluate(() => {
    window.originalStorageSet = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new DOMException('synthetic settings full', 'QuotaExceededError'); };
    setDelay(31);
    Storage.prototype.setItem = window.originalStorageSet;
  });
  assert.equal(await page.evaluate(() => delaySeconds), delayBefore);
  assert.match(await page.locator('#teacherMessage').textContent(), /이전 지연/);
  assert.deepEqual(errors, []);
  console.log('Storage estimate fallback and failed settings write consistency passed');
}).catch(error => { console.error(error); process.exitCode = 1; });
