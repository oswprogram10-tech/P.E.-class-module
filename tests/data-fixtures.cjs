async function seedClip(page, options = {}) {
  return page.evaluate(async options => {
    if (!window.fixtureVideo) {
      const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 270;
      const context = canvas.getContext('2d'); context.fillStyle = '#68a74d'; context.fillRect(0, 0, 480, 270);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg'));
      const frames = Array.from({ length: 51 }, (_, index) => ({ time: index * 100, blob }));
      window.fixtureVideo = (await ClipExporter.export({ frames, start: 0, durationSeconds: 5 })).blob;
    }
    const video = await encryptBlob(window.fixtureVideo);
    const metadata = await encryptMetadata({ studentName: options.name || '가상학생', studentNumber: '1' });
    if (options.badMetadata) new Uint8Array(metadata.ciphertext)[0] ^= 1;
    if (options.badVideo) new Uint8Array(video.ciphertext)[0] ^= 1;
    const createdAt = options.createdAt ?? Date.now();
    const record = { id: options.id || crypto.randomUUID(), createdAt, expiresAt: options.expiresAt ?? createdAt + RETENTION_MS,
      durationSeconds: 5, mimeType: 'video/webm', iv: video.iv, ciphertext: video.ciphertext, metadataIv: metadata.iv, metadataCiphertext: metadata.ciphertext };
    await repository.put(record, vaultConfig.revision);
    return record.id;
  }, options);
}
async function unlock(page, pin = '123456') {
  await page.locator('#teacherButton').click();
  await page.locator('#unlockPin').fill(pin);
  await page.locator('#unlockButton').click();
  await page.locator('#teacherContentPanel').waitFor({ state: 'visible', timeout: 30000 });
}
async function library(page, count) {
  await page.locator('[data-panel="library"]').click();
  await page.waitForFunction(expected => libraryRows.size === expected && !$('libraryStatus').textContent, count);
}
module.exports = { seedClip, unlock, library };
