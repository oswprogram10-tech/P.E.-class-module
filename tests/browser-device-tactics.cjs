const assert = require('node:assert/strict');
const { withBrowser } = require('./browser-helper.cjs');

(async () => {
  await withBrowser(async (page, errors) => {
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.reload(); await page.waitForFunction(() => appReady && navigator.serviceWorker.controller);
    await page.context().setOffline(true);
    await page.reload(); await page.waitForFunction(() => appReady && navigator.serviceWorker.controller);
    const offline = await page.evaluate(async () => {
      const state = await TacticsLocalAdvisor.status();
      const board = TacticsBoard.createBoard(); const team = TacticsBoard.addTeam(board, {}); TacticsBoard.addToken(board, { teamId: team.id, x: 100, y: 100 });
      const references = TacticsLocalSearch.createLocalAdvisor().prepare({ board, sport: 'basketball', goal: 'overall', request: '압박 상황에서 패스 경로' }).references;
      const paths = ['./tactics-local-advisor.js', './tactics-local-prompt.js', './tactics-search-local.js', './vendor/wllama-v3/index.js', './vendor/wllama-v3/wasm/wllama.wasm', './vendor/wllama-v3/compat/wllama.js', './vendor/wllama-v3/compat/wllama.wasm', './vendor/hf-tokenizers/tokenizers.mjs', './vendor/qwen-tokenizer/tokenizer.json', './vendor/qwen-tokenizer/tokenizer_config.json', './vendor/noble-hashes/sha256.js'];
      const responses = await Promise.all(paths.map(path => fetch(path).then(response => response.ok)));
      return { state, count: references.length, responses };
    });
    assert.equal(offline.state.installed, false, 'real model weights were not installed for this test');
    assert.ok(offline.count > 0, 'static references remain searchable offline');
    assert.ok(offline.responses.every(Boolean), 'local engine resources survive offline reload');
    await page.locator('#teacherButton').click(); await page.locator('#unlockPin').fill('123456'); await page.locator('#unlockButton').click();
    await page.locator('[data-panel="classroom"]').click(); await page.locator('#newClassName').fill('기기 검사'); await page.locator('#addClassButton').click();
    await page.locator('.classroom-tool').nth(4).locator(':scope > summary').click();
    assert.equal(await page.locator('#tacticsAiMode').inputValue(), 'device');
    await page.evaluate(() => { window.releaseCalls = 0; TacticsLocalAdvisor.release = async () => { window.releaseCalls++; }; });
    await page.locator('#tacticsDeviceRelease').click(); await page.waitForFunction(() => document.querySelector('#tacticsDeviceProgress').textContent.includes('파일은 유지'));
    assert.equal(await page.evaluate(() => window.releaseCalls), 1);
    await page.locator('#tacticsAiRequest').fill('압박 상황에서 패스 경로를 비교하고 싶어요.');
    await page.locator('#tacticsAiSelect').click();
    await page.waitForFunction(() => document.querySelector('#tacticsNetworkStatus').textContent.includes('설치'));
    assert.match(await page.locator('#tacticsNetworkStatus').textContent(), /설치/);
    assert.match(await page.locator('#tacticsAiOutput').textContent(), /자료에서 찾은 경기 사례/);
    await page.locator('#teacherLockButton').click();
    await page.waitForFunction(() => window.releaseCalls > 1);
    assert.deepEqual(errors, []);
  });
  console.log('Offline reload, real uninstalled status, static search, engine asset paths and no fabricated model result passed; model weights and inference were not tested.');
})().catch(error => { console.error(error); process.exitCode = 1; });
