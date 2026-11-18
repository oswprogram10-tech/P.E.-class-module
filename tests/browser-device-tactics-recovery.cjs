const assert = require('node:assert/strict');
const { withBrowser } = require('./browser-helper.cjs');

(async () => {
  await withBrowser(async (page, errors, baseUrl) => {
    const result = await page.evaluate(async () => {
      const advisor = TacticsLocalAdvisor, originalFetch = window.fetch;
      const modelUrl = (await advisor.status()).model.url;
      const files = async () => {
        const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('pe-tactics-model-v1', { create: true });
        const names = []; for await (const name of dir.keys()) names.push(name); return names.sort();
      };
      const state = async () => ({ state: (await advisor.status()).state, files: await files() });
      window.fetch = (url, options) => String(url) === modelUrl ? Promise.resolve(new Response(new Uint8Array(16))) : originalFetch(url, options);
      let truncatedError; try { await advisor.install(); } catch (e) { truncatedError = e.message; }
      const afterTruncated = await state();
      const controller = new AbortController();
      window.fetch = (url, options) => String(url) === modelUrl ? Promise.resolve(new Response(new ReadableStream({ start(stream) { stream.enqueue(new Uint8Array(16)); }, cancel() {} }))) : originalFetch(url, options);
      let abortName; try { await advisor.install({ signal: controller.signal, onProgress: () => controller.abort() }); } catch (e) { abortName = e.name; }
      const afterAbort = await state();
      // A second short response verifies a fresh attempt enters the real install path.
      window.fetch = (url, options) => String(url) === modelUrl ? Promise.resolve(new Response(new Uint8Array(16))) : originalFetch(url, options);
      let retryError; try { await advisor.install(); } catch (e) { retryError = e.message; }
      const afterRetry = await state(); window.fetch = originalFetch;
      return { truncatedError, afterTruncated, abortName, afterAbort, retryError, afterRetry };
    });
    assert.match(result.truncatedError, /크기|무결성/);
    assert.equal(result.abortName, 'AbortError'); assert.match(result.retryError, /크기|무결성/);
    for (const state of [result.afterTruncated, result.afterAbort, result.afterRetry]) assert.deepEqual(state, { state: 'not-installed', files: [] });
    const peer = await page.context().newPage(); await peer.goto(baseUrl); await peer.waitForFunction(() => appReady);
    await peer.evaluate(() => { window.lockHeld = false; window.releaseLock = null; navigator.locks.request('pe-tactics-local-model-v1', async () => { window.lockHeld = true; await new Promise(resolve => { window.releaseLock = resolve; }); }); });
    await peer.waitForFunction(() => window.lockHeld);
    const locked = await page.evaluate(async () => {
      const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('pe-tactics-model-v1', { create: true });
      const writer = await (await dir.getFileHandle('sentinel', { create: true })).createWritable(); await writer.write('preserve'); await writer.close();
      const attempt = async action => { try { await action(); return ''; } catch (e) { return e.message; } };
      const install = await attempt(() => TacticsLocalAdvisor.install()); const remove = await attempt(() => TacticsLocalAdvisor.remove());
      const content = await (await (await dir.getFileHandle('sentinel')).getFile()).text(); await dir.removeEntry('sentinel');
      return { install, remove, content, state: (await TacticsLocalAdvisor.status()).state };
    });
    assert.match(locked.install, /다른 탭/); assert.match(locked.remove, /다른 탭/); assert.equal(locked.content, 'preserve'); assert.equal(locked.state, 'not-installed');
    await peer.evaluate(() => window.releaseLock()); await peer.close();
    await page.evaluate(async () => {
      const modelUrl = (await TacticsLocalAdvisor.status()).model.url, originalFetch = window.fetch;
      window.fetch = (url, options) => {
        if (String(url) !== modelUrl) return originalFetch(url, options);
        window.mockDownloadStarted = true;
        return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true }));
      };
    });
    await page.locator('#teacherButton').click(); await page.locator('#unlockPin').fill('123456'); await page.locator('#unlockButton').click();
    await page.locator('[data-panel="classroom"]').click(); await page.locator('#newClassName').fill('취소 검사'); await page.locator('#addClassButton').click();
    await page.locator('.classroom-tool').nth(4).locator(':scope > summary').click();
    await page.locator('#tacticsDeviceInstall').click(); await page.waitForFunction(() => window.mockDownloadStarted);
    await page.locator('#tacticsDeviceCancel').click();
    await page.waitForFunction(() => document.querySelector('#tacticsDeviceProgress').textContent.includes('정리를 마쳤어요'));
    assert.equal((await page.evaluate(() => TacticsLocalAdvisor.status())).state, 'not-installed');
    await page.evaluate(() => {
      // UI progress wiring only: this is not a model inference test.
      TacticsLocalAdvisor.suggest = async (_input, options) => {
        options.onProgress({ phase: 'prefill', message: '모델이 입력을 처리하는 중', received: 1024, total: 2048 });
        await new Promise(resolve => { window.startMockGeneration = resolve; });
        options.onProgress({ phase: 'generating', message: '기기에서 생성 중', received: 12, total: 384 });
        await new Promise(resolve => { window.finishMockGeneration = resolve; });
        return { modelUsed: true, modelAttempted: true, modelCoverage: { retrieved: 4, shown: 1, omittedIds: ['hidden-id'] }, summary: '모의 빈 결과', cases: [], comparisonLimit: '모의 원문·범위 생략' };
      };
    });
    await page.locator('#tacticsAiRequest').fill('압박 패스');
    await page.locator('#tacticsAiSelect').click();
    await page.waitForFunction(() => document.querySelector('#tacticsDeviceProgress').textContent === '모델이 입력을 처리하는 중');
    await page.evaluate(() => window.startMockGeneration());
    await page.waitForFunction(() => document.querySelector('#tacticsDeviceProgress').textContent === '기기에서 생성 중');
    await page.evaluate(() => window.finishMockGeneration());
    await page.waitForFunction(() => document.querySelector('#tacticsNetworkStatus').textContent.includes('기존 자료 검색 결과는 그대로'));
    assert.ok(await page.locator('#tacticsAiOutput a').count());
    assert.match(await page.locator('#tacticsAiOutput').textContent(), /검색된 4개 중 1개.*모의 원문·범위 생략/s);
    assert.doesNotMatch(await page.locator('#tacticsAiOutput').textContent(), /hidden-id/);
    await page.evaluate(() => { TacticsLocalAdvisor.suggest = async input => { const base = await TacticsLocalAdvisor.search(input); return { ...base, cases: base.cases.slice(0, 1), modelUsed: true, modelAttempted: true, modelCoverage: { retrieved: base.cases.length, shown: 1, omittedIds: [] }, comparisonLimit: '모의 성공 한계' }; }; });
    await page.locator('#tacticsAiSelect').click(); await page.waitForFunction(() => document.querySelector('#tacticsAiOutput').textContent.includes('모의 성공 한계'));
    assert.match(await page.locator('#tacticsAiOutput').textContent(), /AI가 실행되어 비교할 사례를 선택/);
    await page.evaluate(() => { TacticsLocalAdvisor.search = async () => ({ cases: [], modelUsed: false, summary: '모의 빈 검색', comparisonLimit: '모의 검색 한계' }); TacticsLocalAdvisor.suggest = async () => ({ cases: [], modelUsed: false, summary: '모의 빈 검색', comparisonLimit: '모의 검색 한계' }); });
    await page.locator('#tacticsAiSelect').click(); await page.waitForFunction(() => document.querySelector('#tacticsNetworkStatus').textContent.includes('AI를 호출하지 않았어요'));
    assert.match(await page.locator('#tacticsAiOutput').textContent(), /모의 빈 검색/);
    assert.doesNotMatch(await page.locator('#tacticsAiOutput').textContent(), /AI가 실행되었지만|AI 검토 범위/);
    assert.deepEqual(errors, []);
  });
  console.log('Production install recovery passed with 16-byte truncated/mock stream, abort, retry, and real cross-tab Web Locks. No model weights or inference tested.');
})().catch(error => { console.error(error); process.exitCode = 1; });
