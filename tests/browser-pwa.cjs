const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const expectedShell = new Set([
  '/', '/index.html', '/styles.css', '/app.js', '/local-vault.js', '/clip-repository.js',
  '/webm-muxer.js', '/clip-exporter.js', '/timeline.js', '/frame-buffer.js',
  '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png',
]);

function cacheKeys(page) {
  return page.evaluate(async () => {
    const names = await caches.keys();
    const shellName = names.find((name) => name.startsWith('pe-loop-shell-'));
    const shell = shellName ? await caches.open(shellName) : null;
    const urls = shell ? (await shell.keys()).map((request) => new URL(request.url).pathname) : [];
    return { names, shellName, urls };
  });
}

async function run() {
  let offline = false;
  let swVersion = 'v6';
  let failShellPath = '';
  const mime = { '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
  const server = http.createServer((req, res) => {
    if (offline) { req.socket.destroy(); return; }
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (failShellPath && pathname === failShellPath) { res.writeHead(500).end('synthetic shell failure'); return; }
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    try {
      let body = fs.readFileSync(file);
      if (pathname === '/sw.js') {
        body = Buffer.from(String(body).replace("const CACHE_VERSION = 'v6';", `const CACHE_VERSION = '${swVersion}';`));
        res.setHeader('Cache-Control', 'no-store');
      }
      res.setHeader('Content-Type', mime[path.extname(file)] || 'text/html');
      res.end(body);
    } catch { res.writeHead(404).end(); }
  });

  let browser;
  let context;
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
      args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    });
    // 초기 앱 셸 캐시가 일부 실패하면 사용자가 이해할 수 있는 재시도 경로를 제공한다.
    const failureContext = await browser.newContext({ viewport: { width: 800, height: 1280 } });
    const failurePage = await failureContext.newPage();
    failShellPath = '/icon-512.png';
    await failurePage.goto(baseUrl);
    await failurePage.waitForFunction(() => appReady);
    await failurePage.locator('#offlineStatus').waitFor({ state: 'visible', timeout: 25000 });
    assert.match(await failurePage.locator('#offlineStatusText').textContent(), /오프라인 저장을 준비하지 못했어요/);
    assert.equal(await failurePage.locator('#offlineRetryButton').isVisible(), true);
    failShellPath = '';
    await failurePage.locator('#offlineRetryButton').click();
    await failurePage.locator('#offlineStatus').waitFor({ state: 'hidden', timeout: 25000 });
    const recoveredCache = await cacheKeys(failurePage);
    assert.deepEqual([...recoveredCache.urls].sort(), [...expectedShell].sort(), 'retry must cache the complete shell');
    await failureContext.close();
    console.log('Initial cache failure message and retry passed');

    context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(baseUrl);
    await page.waitForFunction(() => appReady);

    // 첫 설치: skipWaiting/clients.claim 없이 현재 페이지는 아직 제어되지 않는다.
    const firstInstall = await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      return { controller: Boolean(navigator.serviceWorker.controller) };
    });
    assert.equal(firstInstall.controller, false, 'first page must not be claimed by the new worker');

    await page.reload();
    await page.waitForFunction(() => appReady);
    assert.equal(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)), true, 'reopened page must be controlled');

    const initialCache = await cacheKeys(page);
    assert.ok(initialCache.shellName?.startsWith('pe-loop-shell-'));
    assert.deepEqual([...initialCache.urls].sort(), [...expectedShell].sort(), 'Cache API must contain only the app shell');
    assert.equal(initialCache.names.every((name) => name === initialCache.shellName), true, 'no unrelated cache should be created');
    assert.match(await page.locator('#installHint').textContent(), /앱 설치|홈 화면에 추가/);

    // 정상 PIN 흐름으로 IndexedDB 데이터를 만든 뒤 업데이트 후에도 보존되는지 확인한다.
    await page.locator('#teacherButton').click();
    await page.locator('#newPin').fill('123456');
    await page.locator('#confirmPin').fill('123456');
    await page.locator('#createPinButton').click();
    await page.locator('#teacherContentPanel').waitFor({ state: 'visible', timeout: 20000 });
    const revision = await page.evaluate(() => vaultConfig.revision);
    await page.locator('#teacherDialog .close-button').click();

    // 업데이트 전에 만든 암호화 클립이 버전 전환 뒤에도 남는지 확인한다.
    await page.evaluate(() => setDelay(1));
    await page.locator('#cameraButton').click();
    await page.waitForFunction(() => frameBuffer.duration >= 5500, {}, { timeout: 20000 });
    await page.locator('#openClipButton').click();
    await page.locator('#clipLength').fill('5');
    await page.locator('#clipLength').dispatchEvent('input');
    await page.locator('#studentName').fill('업데이트전');
    await page.locator('#studentNumber').fill('3');
    await page.locator('#saveClipButton').click();
    await page.waitForFunction(() => !$('clipDialog').open, {}, { timeout: 30000 });
    await page.locator('#cameraButton').click();
    const beforeUpdate = await page.evaluate(async () => {
      const clips = await allClips();
      return { count: clips.length, ids: clips.map((clip) => clip.id), duration: clips[0]?.durationSeconds };
    });
    assert.equal(beforeUpdate.count, 1, 'one encrypted clip must exist before the update');
    assert.ok(Math.abs(beforeUpdate.duration - 5) < 0.4);

    await page.evaluate(async () => {
      await (await caches.open('unrelated-app-cache')).put('/unrelated.txt', new Response('keep'));
      await (await caches.open('pe-loop-shell-stale')).put('/stale.txt', new Response('delete'));
    });

    // 서버를 끊어 SW 캐시만으로 앱 셸이 다시 열리는지 확인한다.
    offline = true;
    await page.reload();
    await page.waitForFunction(() => appReady, {}, { timeout: 20000 });
    assert.match(await page.title(), /PE Loop/);
    console.log('Offline app-shell reload passed');

    offline = false;
    await page.evaluate(() => { window.__stillOpen = 'yes'; });
    swVersion = 'v7';
    const updateState = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      await registration.update();
      for (let index = 0; index < 200; index++) {
        if (registration.waiting?.state === 'installed') return registration.waiting.state;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return registration.waiting?.state || 'timeout';
    });
    assert.equal(updateState, 'installed', 'new worker should wait for the next safe launch');
    await page.locator('#updateStatus').waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(await page.evaluate(() => window.__stillOpen), 'yes', 'page must not reload automatically');
    assert.equal(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)), true, 'old controller must remain until the app closes');

    const duringUpdate = await cacheKeys(page);
    assert.equal(duringUpdate.names.includes('pe-loop-shell-v6'), true, 'active cache must remain');
    assert.equal(duringUpdate.names.includes('pe-loop-shell-v7'), true, 'new version must be fully installed');
    assert.equal(duringUpdate.names.includes('unrelated-app-cache'), true, 'unrelated cache must survive');
    console.log('Waiting worker and versioned cache passed without forced reload');

    // 앱을 완전히 닫고 다시 열어 브라우저 기본 수명주기로 새 worker를 활성화한다.
    await page.close();
    await new Promise((resolve) => setTimeout(resolve, 400));
    const reopened = await context.newPage();
    reopened.on('pageerror', (error) => errors.push(error.message));
    await reopened.goto(baseUrl);
    await reopened.waitForFunction(() => appReady, {}, { timeout: 20000 });
    await reopened.waitForFunction(() => Boolean(navigator.serviceWorker.controller), {}, { timeout: 20000 });

    const afterUpdate = await cacheKeys(reopened);
    assert.equal(afterUpdate.shellName, 'pe-loop-shell-v7', 'new version cache must be active');
    assert.equal(afterUpdate.names.filter((name) => name.startsWith('pe-loop-shell-')).length, 1, 'only one app cache may remain');
    assert.equal(afterUpdate.names.includes('unrelated-app-cache'), true, 'unrelated cache must not be deleted');
    assert.deepEqual([...afterUpdate.urls].sort(), [...expectedShell].sort(), 'new cache must be complete');
    assert.equal(await reopened.evaluate(async () => (await repository.config())?.revision), revision, 'PIN configuration must survive the update');
    const afterUpdateClips = await reopened.evaluate(async () => {
      const clips = await allClips();
      return { count: clips.length, ids: clips.map((clip) => clip.id) };
    });
    assert.equal(afterUpdateClips.count, 1, 'pre-update encrypted clip must survive the update');
    assert.deepEqual(afterUpdateClips.ids, beforeUpdate.ids, 'pre-update clip identity must be unchanged');
    console.log('Pre-update encrypted clip and PIN configuration survived the update');

    // 오프라인 상태에서도 PIN으로 로컬 데이터에 접근하고 가상 카메라로 5초 클립을 저장한다.
    offline = true;
    await reopened.locator('#teacherButton').click();
    await reopened.locator('#unlockPin').fill('123456');
    await reopened.locator('#unlockButton').click();
    await reopened.locator('#teacherContentPanel').waitFor({ state: 'visible', timeout: 20000 });
    await reopened.locator('#teacherDialog .close-button').click();
    await reopened.evaluate(() => setDelay(1));
    await reopened.locator('#cameraButton').click();
    await reopened.waitForFunction(() => frameBuffer.duration >= 5500, {}, { timeout: 20000 });
    await reopened.locator('#openClipButton').click();
    await reopened.locator('#clipLength').fill('5');
    await reopened.locator('#clipLength').dispatchEvent('input');
    await reopened.locator('#studentName').fill('오프라인학생');
    await reopened.locator('#studentNumber').fill('7');
    await reopened.locator('#saveClipButton').click();
    await reopened.waitForFunction(() => !$('clipDialog').open, {}, { timeout: 30000 });
    const offlineClip = await reopened.evaluate(async (preUpdateId) => {
      const clips = await allClips();
      const previous = clips.find((clip) => clip.id === preUpdateId);
      const newest = clips.at(-1);
      return {
        count: clips.length,
        previousPreserved: Boolean(previous?.ciphertext && previous?.metadataCiphertext),
        duration: newest?.durationSeconds,
        encrypted: Boolean(newest?.ciphertext && newest?.metadataCiphertext),
      };
    }, beforeUpdate.ids[0]);
    assert.equal(offlineClip.count, 2);
    assert.equal(offlineClip.previousPreserved, true, 'pre-update clip ciphertext must remain intact');
    assert.ok(Math.abs(offlineClip.duration - 5) < 0.4);
    assert.equal(offlineClip.encrypted, true);
    console.log(JSON.stringify({ offlineCameraSave: offlineClip, passed: true }));

    assert.deepEqual(errors, []);
  } finally {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    await new Promise((resolve) => server.close(resolve));
  }
}

run().catch((error) => { console.error(error); process.exitCode = 1; });
