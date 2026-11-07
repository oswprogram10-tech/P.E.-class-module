const { withBrowser } = require('./browser-helper.cjs');
const assert = require('node:assert/strict');

withBrowser(async (page, errors) => {
  console.log('phase 1: seed encrypted current and legacy metadata records');
  const seeded = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 160;
    const ctx = canvas.getContext('2d'); const blob = await new Promise(resolve => { ctx.fillStyle = '#3879c7'; ctx.fillRect(0, 0, 160, 160); canvas.toBlob(resolve, 'image/jpeg'); });
    const frames = Array.from({ length: 51 }, (_, i) => ({ time: i * 100, blob }));
    const video = await ClipExporter.export({ frames, start: 0, durationSeconds: 5 });
    async function put(id, value) {
      const encrypted = await encryptBlob(video.blob, teacherKey);
      const metadata = await encryptMetadata(value, teacherKey);
      const now = Date.now();
      await repository.put({ id, createdAt: now, expiresAt: now + RETENTION_MS, durationSeconds: video.durationSeconds, mimeType: 'video/webm', iv: encrypted.iv, ciphertext: encrypted.ciphertext, metadataIv: metadata.iv, metadataCiphertext: metadata.ciphertext }, vaultConfig.revision);
    }
    await put('with-reflection', { studentName: '성찰학생', studentNumber: '2', reflectionGood: '균형을 유지함', reflectionRetry: '팔을 더 들어보기' });
    await put('legacy-no-reflection', { studentName: '이전학생', studentNumber: '3' });
    const records = await allClips();
    return { ids: records.map(x => x.id), plain: JSON.stringify(records).includes('균형을 유지함') || JSON.stringify(records).includes('성찰학생'), duration: video.durationSeconds };
  });
  assert.deepEqual(seeded.ids.sort(), ['legacy-no-reflection', 'with-reflection']);
  assert.equal(seeded.plain, false, 'reflection and student metadata must not appear in IndexedDB records');

  console.log('phase 2: teacher library, reflection rendering, playback controls');
  await page.locator('#teacherButton').click();
  await page.locator('#unlockPin').fill('123456'); await page.locator('#unlockButton').click();
  await page.locator('#teacherContentPanel').waitFor({ state: 'visible' });
  await page.locator('[data-panel="library"]').click();
  await page.locator('[data-panel="library"]').click();
  await page.locator('[data-panel="library"]').click();
  await page.waitForFunction(() => libraryRows.size === 2 && !$('libraryStatus').textContent);
  assert.match(await page.locator('[data-clip-id="with-reflection"]').textContent(), /균형을 유지함.*팔을 더 들어보기/);
  assert.doesNotMatch(await page.locator('[data-clip-id="legacy-no-reflection"]').textContent(), /잘된 점:|다시 시도할 점:/);
  await page.locator('[data-clip-id="with-reflection"] .library-play').click();
  await page.waitForFunction(() => libraryObjectUrls.length === 1 && !!document.querySelector('.library-video'));
  const before = await page.evaluate(async () => {
    const video = document.querySelector('.library-video');
    if (video.readyState < 1) await new Promise(resolve => video.onloadedmetadata = resolve);
    const record = (await allClips()).find(x => x.id === 'with-reflection');
    return { duration: record.durationSeconds, ciphertext: Array.from(new Uint8Array(record.ciphertext)), loop: video.loop, speed: video.playbackRate };
  });
  await page.locator('[data-clip-id="with-reflection"] .playback-controls select').selectOption('0.5');
  await page.locator('[data-clip-id="with-reflection"] .playback-controls input[type=checkbox]').check();
  const after = await page.evaluate(async () => {
    const video = document.querySelector('.library-video'); const record = (await allClips()).find(x => x.id === 'with-reflection');
    return { duration: record.durationSeconds, ciphertext: Array.from(new Uint8Array(record.ciphertext)), loop: video.loop, speed: video.playbackRate };
  });
  assert.equal(after.speed, 0.5); assert.equal(after.loop, true);
  assert.equal(after.duration, before.duration); assert.deepEqual(after.ciphertext, before.ciphertext, 'playback controls must not rewrite saved encrypted video');

  console.log('phase 3: plaintext download consent, exact bytes, stale handler');
  const download = page.locator('[data-clip-id="with-reflection"] .clip-download');
  await page.evaluate(() => {
    window.confirmCalls = []; window.downloads = [];
    window.confirm = message => { window.confirmCalls.push(message); return false; };
    window.originalAnchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = async function () {
      window.downloads.push({ name: this.download, bytes: Array.from(new Uint8Array(await (await fetch(this.href)).arrayBuffer())) });
    };
  });
  const decrypted = await page.evaluate(async () => {
    const record = (await allClips()).find(x => x.id === 'with-reflection');
    return Array.from(new Uint8Array(await (await decryptClip(record)).arrayBuffer()));
  });
  await download.click();
  assert.equal(await page.evaluate(() => confirmCalls.length), 1);
  assert.match(await page.evaluate(() => confirmCalls[0]), /암호화되지 않습니다/);
  assert.equal(await page.evaluate(() => downloads.length), 0, 'cancelled consent must not export');
  await page.evaluate(() => { window.confirm = () => true; });
  await download.click();
  await page.waitForFunction(() => downloads.length === 1);
  const exported = await page.evaluate(() => downloads[0]);
  assert.equal(exported.name, 'pe-loop-clip.webm');
  assert.deepEqual(exported.bytes, decrypted, 'exported plaintext bytes must equal only the selected decrypted clip');

  const stale = await page.locator('[data-clip-id="with-reflection"] .clip-download').elementHandle();
  await page.locator('#teacherDialog .close-button').click();
  const count = await page.evaluate(() => downloads.length);
  await stale.evaluate(node => node.click());
  assert.equal(await page.evaluate(() => downloads.length), count, 'detached stale handler after closing access must not export');

  console.log('phase 4: export expiry checks before and after consent');
  await page.locator('#teacherButton').click();
  await page.locator('#unlockPin').fill('123456'); await page.locator('#unlockButton').click();
  await page.locator('#teacherContentPanel').waitFor({ state: 'visible' });
  await page.evaluate(async () => {
    window.realDateNow = Date.now;
    window.clockNow = window.realDateNow();
    Date.now = () => window.clockNow;
    const source = (await allClips()).find(x => x.id === 'with-reflection');
    const expiresAt = window.clockNow + 60000;
    for (const id of ['expires-before-consent', 'expires-during-consent']) {
      const createdAt = expiresAt - RETENTION_MS;
      await repository.put({ ...source, id, createdAt, expiresAt }, vaultConfig.revision);
    }
  });
  await page.locator('[data-panel="library"]').click();
  await page.waitForFunction(() => libraryRows.has('expires-before-consent') && libraryRows.has('expires-during-consent'));
  const downloadCountBeforeExpiryCases = await page.evaluate(() => downloads.length);
  await page.evaluate(() => { window.confirmCalls = []; window.confirm = () => { confirmCalls.push('unexpected'); return true; }; });
  await page.locator('[data-clip-id="expires-before-consent"] .library-play').click();
  await page.locator('[data-clip-id="expires-before-consent"] .clip-download').waitFor({ state: 'visible' });
  await page.evaluate(() => { clockNow += 60000; });
  await page.locator('[data-clip-id="expires-before-consent"] .clip-download').click();
  await page.waitForFunction(() => !libraryRows.has('expires-before-consent'));
  assert.equal(await page.evaluate(() => confirmCalls.length), 0, 'already-expired clip must be removed before asking consent');
  assert.equal(await page.evaluate(() => downloads.length), downloadCountBeforeExpiryCases);
  assert.equal(await page.evaluate(async () => (await allClips()).some(x => x.id === 'expires-before-consent')), false);

  // Replace the second record with a future expiry and advance the fake clock inside the consent callback.
  await page.evaluate(async () => {
    clockNow = realDateNow();
    const source = (await allClips()).find(x => x.id === 'with-reflection');
    const expiresAt = clockNow + 60000;
    const createdAt = expiresAt - RETENTION_MS;
    await repository.put({ ...source, id: 'expires-during-consent', createdAt, expiresAt }, vaultConfig.revision);
    await loadLibrary();
    window.confirm = message => { confirmCalls.push(message); clockNow = expiresAt; return true; };
  });
  await page.waitForFunction(() => libraryRows.has('expires-during-consent'));
  await page.locator('[data-clip-id="expires-during-consent"] .library-play').click();
  await page.locator('[data-clip-id="expires-during-consent"] .clip-download').waitFor({ state: 'visible' });
  const confirmCount = await page.evaluate(() => confirmCalls.length);
  await page.locator('[data-clip-id="expires-during-consent"] .clip-download').click();
  await page.waitForFunction(() => !libraryRows.has('expires-during-consent'));
  assert.equal(await page.evaluate(() => confirmCalls.length), confirmCount + 1);
  assert.equal(await page.evaluate(() => downloads.length), downloadCountBeforeExpiryCases, 'expiry during consent must prevent file creation');
  assert.equal(await page.evaluate(async () => (await allClips()).some(x => x.id === 'expires-during-consent')), false);
  await page.evaluate(() => { Date.now = realDateNow; });
  console.log('Expired export is rejected before consent and when expiry occurs during consent');
  await page.evaluate(() => { HTMLAnchorElement.prototype.click = window.originalAnchorClick; });
  assert.deepEqual(errors, []);
  console.log('Reflection encryption, old metadata compatibility, playback immutability, and guarded plaintext export passed');
}).catch(error => { console.error(error); process.exitCode = 1; });
