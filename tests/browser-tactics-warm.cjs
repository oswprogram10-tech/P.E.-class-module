'use strict';
const assert = require('node:assert/strict');
const { withBrowser } = require('./browser-helper.cjs');
const sha = '626b4a6678b86442240e33df819e00132d3ba7dddfe1cdc4fbb18e0a9615c62d';
(async () => {
  await withBrowser(async (first, errors, baseUrl) => {
    const second = await first.context().newPage();
    second.on('pageerror', error => errors.push(error.message));
    await second.goto(baseUrl); await second.waitForFunction(() => appReady);
    const run = page => page.evaluate(() => TacticsLocalAdvisor.suggest({ sport: 'basketball', goal: 'overall', request: '압박 패스' }));
    await run(first); await run(first);
    assert.deepEqual(await first.evaluate(async () => [window.fakeLoads, window.fakeCompletions, (await TacticsLocalAdvisor.status()).warm]), [1, 2, true]);
    await assert.rejects(run(second), /다른 탭/);
    await first.evaluate(() => TacticsLocalAdvisor.release());
    await run(second); assert.equal(await second.evaluate(() => fakeLoads), 1);
    await second.evaluate(() => { window.fakeHidden = true; document.dispatchEvent(new Event('visibilitychange')); });
    await second.waitForFunction(async () => !(await TacticsLocalAdvisor.status()).warm);
    await run(first); await first.evaluate(() => { document.querySelector('#studentTacticsReset').click(); });
    await first.waitForFunction(async () => !(await TacticsLocalAdvisor.status()).warm);
    assert.deepEqual(errors, []);
  }, { setupTeacher: false, beforeApp: async page => {
    await page.context().addInitScript(({ sha }) => {
      window.fakeLoads = 0; window.fakeCompletions = 0; window.fakeHidden = false;
      Object.defineProperty(document, 'hidden', { get: () => window.fakeHidden, configurable: true });
      navigator.storage.getDirectory = async () => ({ getDirectoryHandle: async () => ({ getFileHandle: async name => ({ getFile: async () => name === 'verified.json' ? { text: async () => JSON.stringify({ sha256: sha }) } : { size: 2104932768 } }) }) });
    }, { sha });
    await page.context().route('**/sw.js', route => route.abort());
    await page.context().route('**/vendor/hf-tokenizers/tokenizers.mjs', route => route.fulfill({ contentType: 'text/javascript', body: 'export class Tokenizer { encode() { return {ids:[1]}; } }' }));
    await page.context().route('**/vendor/wllama-v3/index.js', route => route.fulfill({ contentType: 'text/javascript', body: `export class Wllama { setCompat() {} async loadModel() { window.fakeLoads++; } async exit() {} async createCompletion(o) { window.fakeCompletions++; o.onData({choices:[{text:'{"referenceIds":[]}',finish_reason:'stop'}]}); } }` }));
  } });
  console.log('Mock engine warm reuse, actual cross-tab Web Locks, explicit release, hidden cleanup and student reset passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
