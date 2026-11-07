const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
let revision = 1;
let failedPath = null;
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === failedPath) return res.writeHead(503).end('deliberate failure');
  const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
  try {
    let data = fs.readFileSync(file);
    if (pathname === '/sw.js') data = Buffer.from(data.toString().replace(/pe-loop-shell-v\d+/, `pe-loop-shell-test-v${revision}`));
    if (pathname === '/' || pathname === '/index.html') data = Buffer.from(data.toString().replace('<head>', `<head><meta name="test-revision" content="${revision}">`));
    if (pathname === '/app.js') data = Buffer.from(`window.testRevision = ${revision};\n` + data.toString());
    const mime = { '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
    res.setHeader('Content-Type', mime[path.extname(file)] || 'text/html');
    res.setHeader('Cache-Control', 'no-store');
    res.end(data);
  } catch { res.writeHead(404).end(); }
});

async function ready(page) {
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await page.waitForFunction(() => appReady);
}
async function marker(page, expected) {
  assert.deepEqual(await page.evaluate(() => [document.querySelector('meta[name=test-revision]').content, window.testRevision]), [String(expected), expected]);
}
async function waitWaiting(page) {
  await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting, null, { timeout: 15000 });
}
async function requestApply(page) {
  return page.evaluate(async () => {
    const worker = (await navigator.serviceWorker.getRegistration()).waiting;
    const channel = new MessageChannel();
    const result = new Promise(resolve => { channel.port1.onmessage = e => resolve(e.data); });
    worker.postMessage({ type: 'APPLY_UPDATE' }, [channel.port2]);
    return result;
  });
}
async function blocked(page) {
  await page.evaluate(() => $('updateButton').click());
  assert.match(await page.locator('#updateMessage').textContent(), /촬영과 저장을 마치고/);
  assert.ok(await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()).waiting));
}
async function unlock(page) {
  await page.locator('#teacherButton').click();
  await page.locator('#unlockPin').fill('123456');
  await page.locator('#unlockButton').click();
  await page.locator('#teacherContentPanel').waitFor({ state: 'visible' });
}

(async () => {
  let browser;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
    const base = `http://127.0.0.1:${server.address().port}`;
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    let page = await context.newPage();
    let navigations = 0;
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
    await page.goto(base); await ready(page);
    await page.waitForTimeout(300);
    assert.equal(navigations, 1, 'first install reloaded the page');
    await marker(page, 1);
    await page.reload(); await ready(page);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await page.waitForFunction(() => $('offlineNotice').dataset.state === 'ready');
    await context.setOffline(true);
    await page.reload(); await ready(page); await marker(page, 1);
    await page.waitForFunction(() => $('offlineNotice').dataset.state === 'ready');
    await page.waitForFunction(() => $('offlineNotice').dataset.state === 'ready');
    await page.locator('#teacherButton').click();
    await page.locator('#newPin').fill('123456'); await page.locator('#confirmPin').fill('123456');
    await page.locator('#createPinButton').click();
    await page.locator('#teacherContentPanel').waitFor({ state: 'visible' });
    await page.locator('#teacherDialog .close-button').click();
    await page.evaluate(() => setDelay(1));
    await page.locator('#cameraButton').click();
    await page.waitForFunction(() => lastDrawnFrame && lastDrawnFrame - frameHistory[0].time >= 5400, null, { timeout: 20000 });
    await page.locator('#openClipButton').click();
    await page.locator('#clipLength').fill('5'); await page.locator('#clipLength').dispatchEvent('input');
    await page.locator('#studentName').fill('가상학생'); await page.locator('#studentNumber').fill('1');
    await page.locator('#saveClipButton').click();
    await page.waitForFunction(() => !$('clipDialog').open, null, { timeout: 40000 });
    await page.locator('#cameraButton').click();
    await unlock(page); await page.locator('[data-panel="library"]').click();
    await page.locator('.library-play').first().waitFor(); await page.locator('.library-play').first().click();
    await page.waitForFunction(() => document.querySelector('.library-video')?.readyState >= 1, null, { timeout: 15000 });
    const playback = await page.evaluate(async () => { const video = document.querySelector('.library-video'); await video.play(); return { duration: video.duration, paused: video.paused, count: (await allClips()).length }; });
    assert.ok(playback.duration > 4 && playback.duration <= 5.1 && !playback.paused && playback.count === 1, JSON.stringify(playback));
    await page.locator('#teacherDialog .close-button').click();
    await context.setOffline(false);
    console.log('PASS offline restart, PIN, fake camera, 5s encrypted WebM and library playback');

    revision = 2; failedPath = '/icon-512.png';
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      window.failedInstall = new Promise(resolve => reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        worker.addEventListener('statechange', () => { if (worker.state === 'redundant') resolve(); });
      }, { once: true }));
      await reg.update();
    });
    await page.evaluate(() => window.failedInstall);
    assert.equal(await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()).waiting), false);
    await page.reload(); await ready(page); await marker(page, 1);
    failedPath = null;
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await waitWaiting(page); await page.waitForFunction(() => !$('updateNotice').hidden);
    for (const query of ['/?x=1', '/index.html?x=1']) {
      const check = await context.newPage(); await check.goto(base + query); await ready(check); await marker(check, 1); await check.close();
    }
    await page.bringToFront();
    await unlock(page); await page.locator('#teacherDialog .close-button').click();
    await page.locator('#cameraButton').click();
    await page.waitForFunction(() => cameraStream && lastDrawnFrame && lastDrawnFrame - frameHistory[0].time >= 5400, null, { timeout: 20000 });
    await blocked(page);
    await page.locator('#openClipButton').click(); await blocked(page);
    await page.locator('#clipLength').fill('5'); await page.locator('#clipLength').dispatchEvent('input');
    await page.locator('#studentName').fill('두번째'); await page.locator('#studentNumber').fill('2');
    await page.evaluate(() => {
      window.realExport = ClipExporter.export;
      ClipExporter.export = async options => { await new Promise(resolve => { window.releaseExport = resolve; }); return window.realExport(options); };
      window.realPut = repository.put.bind(repository);
      repository.put = async (...args) => { await new Promise(resolve => { window.releasePut = resolve; }); return window.realPut(...args); };
    });
    await page.locator('#saveClipButton').click();
    await page.waitForFunction(() => savePhase === 'encoding' && window.releaseExport); await blocked(page);
    await page.evaluate(() => window.releaseExport());
    await page.waitForFunction(() => savePhase === 'committing' && window.releasePut, null, { timeout: 30000 }); await blocked(page);
    assert.deepEqual(await requestApply(page), { ok: false, reason: 'close-to-update' });
    await page.evaluate(() => window.releasePut());
    await page.waitForFunction(() => !$('clipDialog').open, null, { timeout: 30000 });
    await page.locator('#cameraButton').click();
    await page.waitForFunction(() => !pendingTransactions);
    const before = navigations;
    await page.locator('#updateButton').click();
    assert.match(await page.locator('#updateMessage').textContent(), /모든 탭과 설치된 앱 창을 닫고 다시 열어/);
    await page.waitForTimeout(300); assert.equal(navigations, before); await marker(page, 1);
    const other = await context.newPage(); await other.goto(base); await ready(other); await marker(other, 1);
    await other.bringToFront(); await unlock(other); await other.locator('#teacherDialog .close-button').click();
    await other.locator('#cameraButton').click();
    await other.waitForFunction(() => !!cameraStream);
    assert.deepEqual(await requestApply(page), { ok: false, reason: 'close-to-update' });
    assert.equal(await other.evaluate(() => !!cameraStream), true);
    await other.locator('#cameraButton').click(); await other.close();
    await page.evaluate(() => caches.open('other-application-cache'));
    await page.close();
    page = await context.newPage(); await page.goto(base); await ready(page);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
    await marker(page, 2); await unlock(page); await page.locator('[data-panel="library"]').click();
    const cacheNames = await page.evaluate(() => caches.keys());
    assert.deepEqual(cacheNames.filter(name => name.startsWith('pe-loop-shell-')), ['pe-loop-shell-test-v2']);
    assert.ok(cacheNames.includes('other-application-cache'), 'other applications\' caches must survive activation');
    await page.waitForFunction(() => libraryRows.size === 2);
    await page.locator('.library-play').first().click();
    await page.waitForFunction(() => document.querySelector('.library-video')?.readyState >= 1);
    console.log('PASS version waiting, query consistency, protected states, natural activation and encrypted data preservation');

    await page.locator('#teacherDialog .close-button').click();
    await page.evaluate(async () => { const cache = await caches.open('pe-loop-shell-test-v2'); await cache.delete('./frame-buffer.js'); });
    await page.locator('#offlineRetryButton').click();
    await page.waitForFunction(() => $('offlineNotice').dataset.state === 'error');
    console.log('PASS missing cache asset reported');
    await context.close();

    revision = 3; failedPath = '/icon-512.png';
    const fresh = await browser.newContext();
    const bad = await fresh.newPage(); await bad.goto(base); await bad.waitForFunction(() => appReady);
    await bad.waitForFunction(() => $('offlineNotice').dataset.state === 'error', null, { timeout: 15000 });
    assert.equal(await bad.evaluate(() => !!navigator.serviceWorker.controller), false);
    await fresh.close();
    console.log('PASS initial installation failure reported');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
