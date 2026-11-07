const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { withBrowser } = require('./browser-helper.cjs');

async function touchTarget(page, selector) {
  const box = await page.locator(selector).boundingBox();
  assert.ok(box && box.width >= 48 && box.height >= 48, `${selector} must offer at least 48 CSS px: ${JSON.stringify(box)}`);
}

withBrowser(async (page, errors) => {
  // The helper already completed first-time PIN setup. Measure repeat preparation.
  const started = performance.now();
  await page.locator('#teacherButton').click();
  await page.locator('#unlockPin').fill('123456');
  await page.locator('#unlockButton').click();
  await page.locator('#teacherContentPanel').waitFor({ state: 'visible' });
  await page.locator('#teacherDelay').fill('1');
  await page.locator('#teacherDelay').dispatchEvent('input');
  await page.locator('#teacherDialog .close-button').click();
  await page.locator('#cameraButton').click();
  await page.waitForFunction(() => frameHistory.length > 0);
  const preparationMs = Math.round(performance.now() - started);
  assert.ok(preparationMs < 60000, `automated repeat preparation exceeded 1 minute: ${preparationMs}ms`);
  console.log(`Automated teacher preparation (PIN → delay → capture): ${preparationMs}ms; excludes first install/permission and human measurement.`);

  for (const viewport of [{ width: 1280, height: 900 }, { width: 800, height: 1280 }, { width: 360, height: 800 }, { width: 640, height: 360 }]) {
    await page.setViewportSize(viewport);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `horizontal overflow at ${JSON.stringify(viewport)}`);
    for (const selector of ['#teacherButton', '#cameraButton', '#openClipButton']) await touchTarget(page, selector);
    for (const selector of ['#referenceFile', '#referenceMode', '#referenceOpacity', '#referencePlay', '#referenceClear']) await touchTarget(page, selector);
    await page.locator('#teacherButton').click();
    await page.locator('#unlockPin').fill('123456');
    await touchTarget(page, '#unlockPin');
    await touchTarget(page, '#unlockButton');
    await touchTarget(page, '#teacherDialog .close-button');
    await page.locator('#unlockButton').click();
    await page.locator('#teacherContentPanel').waitFor({ state: 'visible' });
    await touchTarget(page, '#teacherDelay');
    await touchTarget(page, '#teacherLockButton');
    await page.locator('#teacherDialog .close-button').click();
  }

  await page.waitForFunction(() => frameBuffer.duration >= 5300);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.locator('#openClipButton').click();
  await page.locator('#clipLength').fill('5');
  await page.locator('#clipLength').dispatchEvent('input');
  // A reduced viewport approximates the available space above a software keyboard.
  await page.setViewportSize({ width: 360, height: 320 });
  for (const selector of ['#clipStartFrame', '#clipEndFrame', '#clipPreviewPlay', '#reflectionGood', '#reflectionRetry', '#studentName', '#studentNumber', '#saveClipButton', '#clipDialog .close-button']) {
    await page.locator(selector).scrollIntoViewIfNeeded();
    await touchTarget(page, selector);
    const box = await page.locator(selector).boundingBox();
    assert.ok(box.y >= 0 && box.y + box.height <= 321, `${selector} cannot be scrolled into the visible reduced viewport`);
  }
  await page.locator('#studentName').fill('가상학생');
  await page.locator('#studentNumber').fill('1');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors, []);
  console.log('Layout passed: landscape/portrait, 360px narrow screen, 48px controls, reduced-height input and save/close access.');
}).catch(error => { console.error(error); process.exitCode = 1; });
