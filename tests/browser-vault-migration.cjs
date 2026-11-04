const { withBrowser } = require('./browser-helper.cjs');
const assert = require('node:assert/strict');

async function legacyFixture(page, baseUrl, withPin, dbVersion = 1) {
  await page.goto(baseUrl + '/tests/fixture.html');
  await page.addScriptTag({ url: baseUrl + '/local-vault.js' });
  await page.evaluate(async ({ withPin, dbVersion }) => {
    const original = await LocalVault.create('123456');
    const video = await LocalVault.encrypt(new TextEncoder().encode('legacy-video'), original.key);
    const meta = await LocalVault.encrypt(new TextEncoder().encode(JSON.stringify({ studentName: '이전가상학생', studentNumber: '7' })), original.key);
    const createdAt = Date.now();
    if (withPin) localStorage.setItem('pe-loop-settings-v1', JSON.stringify({ delaySeconds: 17, ...original.config }));
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('pe-loop-local-v1', dbVersion);
      request.onupgradeneeded = () => { request.result.createObjectStore('clips', { keyPath: 'id' }); if (dbVersion === 2) request.result.createObjectStore('meta'); };
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('clips', 'readwrite');
      tx.objectStore('clips').put({ id: 'legacy', createdAt, expiresAt: createdAt + 604800000, durationSeconds: 5, mimeType: 'video/webm',
        iv: video.iv, ciphertext: video.ciphertext, metadataIv: meta.iv, metadataCiphertext: meta.ciphertext });
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, { withPin, dbVersion });
}
(async () => {
  await withBrowser(async (page, errors) => {
    assert.equal(await page.evaluate(() => delaySeconds), 17);
    await page.locator('#teacherButton').click();
    assert.equal(await page.locator('#teacherUnlockPanel').isVisible(), true);
    await page.locator('#unlockPin').fill('123456'); await page.locator('#unlockButton').click();
    await page.locator('#teacherContentPanel').waitFor({ state: 'visible' });
    const migrated = await page.evaluate(async () => {
      const clips = await allClips(); const video = await decryptClip(clips[0]); const meta = await decryptMetadata(clips[0]);
      return { count: clips.length, text: await video.text(), name: meta.studentName, hasVault: !!(await repository.config())?.revision,
        legacyConfigRemaining: !!JSON.parse(localStorage.getItem(SETTINGS_KEY)).pinSalt };
    });
    assert.deepEqual(migrated, { count: 1, text: 'legacy-video', name: '이전가상학생', hasVault: true, legacyConfigRemaining: false });
    assert.deepEqual(errors, []);
    console.log('Legacy v1 database and PIN migration preserve encrypted clips passed');
  }, { setupTeacher: false, beforeApp: (page, baseUrl) => legacyFixture(page, baseUrl, true) });

  await withBrowser(async (page, errors) => {
    assert.ok(await page.evaluate(() => vaultProblem));
    await page.locator('#teacherButton').click();
    assert.equal(await page.locator('#teacherSetupPanel').isVisible(), false);
    const refused = await page.evaluate(async () => {
      const candidate = await LocalVault.create('654321');
      return repository.initialize(candidate.config).then(() => false, () => true);
    });
    assert.equal(refused, true);
    assert.equal(await page.evaluate(async () => (await allClips()).length), 1);
    assert.equal(await page.evaluate(async () => await repository.config()), null);
    assert.deepEqual(errors, []);
    console.log('Missing PIN cannot silently replace keys for existing clips passed');
  }, { setupTeacher: false, beforeApp: (page, baseUrl) => legacyFixture(page, baseUrl, false) });

  await withBrowser(async (page, errors) => {
    assert.ok(await page.evaluate(() => vaultProblem));
    assert.equal(await page.evaluate(async () => await repository.config()), null);
    assert.equal(await page.evaluate(async () => (await allClips()).length), 1);
    assert.deepEqual(errors, []);
    console.log('Missing v2 vault cannot adopt stale localStorage credentials passed');
  }, { setupTeacher: false, beforeApp: (page, baseUrl) => legacyFixture(page, baseUrl, true, 2) });

  await withBrowser(async (page, errors) => {
    await page.locator('#teacherButton').click();
    await page.locator('#newPin').fill('123456'); await page.locator('#confirmPin').fill('123456');
    await page.evaluate(() => {
      window.originalInitialize = repository.initialize.bind(repository);
      repository.initialize = async () => { throw new DOMException('synthetic no space', 'QuotaExceededError'); };
    });
    await page.locator('#createPinButton').click(); await page.waitForFunction(() => !pinBusy);
    assert.equal(await page.evaluate(() => teacherKey), null);
    assert.equal(await page.evaluate(async () => await repository.config()), null);
    assert.match(await page.locator('#teacherMessage').textContent(), /공간이 부족/);
    await page.evaluate(() => {
      repository.initialize = window.originalInitialize;
      window.originalCreate = LocalVault.create;
      LocalVault.create = async (...args) => {
        const value = await window.originalCreate(...args);
        window.createHeld = true; await new Promise(resolve => { window.releaseCreate = resolve; }); return value;
      };
    });
    await page.locator('#createPinButton').click(); await page.waitForFunction(() => window.createHeld);
    await page.locator('#teacherDialog .close-button').click();
    await page.evaluate(() => window.releaseCreate()); await page.waitForTimeout(100);
    assert.equal(await page.evaluate(async () => await repository.config()), null);
    assert.equal(await page.evaluate(() => teacherKey), null);
    await page.evaluate(() => { LocalVault.create = window.originalCreate; });
    await page.locator('#teacherButton').click();
    await page.locator('#newPin').fill('123456'); await page.locator('#confirmPin').fill('123456');
    await page.locator('#createPinButton').click();
    await page.locator('#teacherContentPanel').waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => teacherKey.extractable), false);
    assert.deepEqual(errors, []);
    console.log('Initial PIN persistence failure/cancellation/retry passed');
  }, { setupTeacher: false });
})().catch(error => { console.error(error); process.exitCode = 1; });
