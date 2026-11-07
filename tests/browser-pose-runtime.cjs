const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { withBrowser } = require('./browser-helper.cjs');

withBrowser(async (page, errors, baseUrl) => {
  await page.addScriptTag({ url: baseUrl + '/pose-assets.js' });
  await page.addScriptTag({ url: baseUrl + '/pose-runtime.js' });
  // Fixture-only registry replacement: production runtime accepts no assets/URL override.
  await page.evaluate(() => {
    window.fixturePoseRuntime = (assets, options = {}) => {
      const registry = window.ModelProfiles;
      try {
        window.ModelProfiles = { resolve: () => assets, DEFAULT_ID: 'test-only' };
        return new PoseRuntime(options);
      } finally { window.ModelProfiles = registry; }
    };
  });
  const results = await page.evaluate(async () => {
    const missing = new PoseRuntime();
    let missingRejected = false;
    if (PoseAssets.files.some(item => !item.sha256)) { try { await missing.prepare(); } catch (error) { missingRejected = /아직 준비/.test(error.message); } }
    else missingRejected = true;
    const bytes = new TextEncoder().encode('synthetic asset');
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
    const assets = { version: 'synthetic-test', files: [{ name: 'fixture', url: './test-pose-asset.bin', sha256: hash }] };
    const runtime = fixturePoseRuntime(assets);
    const originalFetch = window.fetch; let calls = 0; let active = false;
    try {
      await runtime.clear();
      window.fetch = async (_url, { signal }) => { calls++; active = true; return new Promise((resolve, reject) => { signal.addEventListener('abort', () => { active = false; reject(new DOMException('aborted', 'AbortError')); }, { once: true }); }); };
      const pending = runtime.prepare().then(() => false, () => true);
      while (!active) await new Promise(resolve => setTimeout(resolve, 0));
      runtime.close(); const cancelled = await pending;
      const retry = fixturePoseRuntime(assets);
      window.fetch = async () => { calls++; return new Response(bytes); };
      await retry.prepare(); window.fetch = async () => { throw new Error('offline'); }; await retry.prepare();
      const cache = await caches.open(retry.cacheName); await cache.put(new URL(assets.files[0].url, location.href), new Response('tampered'));
      window.fetch = async () => new Response('still tampered');
      let tamperRejected = false; try { await retry.prepare(); } catch (error) { tamperRejected = /무결성/.test(error.message); }
      await retry.clear(); return { missingRejected, cancelled, tamperRejected, calls };
    } finally { window.fetch = originalFetch; }
  });
  assert.deepEqual(results, { missingRejected: true, cancelled: true, tamperRejected: true, calls: 2 });
  const hungFrame = await page.evaluate(async () => {
    const bytes = new TextEncoder().encode('fake worker fixture');
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
    const assets = { version: 'hung-worker-test', files: [{ name: 'fixture', url: './fake-worker-asset', sha256: hash }] };
    const OriginalWorker = window.Worker, originalFetch = window.fetch;
    const runtime = fixturePoseRuntime(assets, { frameTimeoutMs: 20 });
    try {
      await runtime.clear(); window.fetch = async () => new Response(bytes); await runtime.prepare();
      window.Worker = class { postMessage(message) { if (message.type === 'init') setTimeout(() => this.onmessage({ data: { type: 'ready' } }), 0); } terminate() {} };
      let failure = ''; await runtime.start({ onError: error => { failure = error.message; } });
      runtime.submit({ close() {} }, 1000);
      await new Promise(resolve => setTimeout(resolve, 80));
      const stopped = !runtime.worker && !runtime.inflight && !runtime.ready;
      await runtime.start(); const restarted = runtime.ready; runtime.stop();
      return { stopped, restarted, failure };
    } finally { window.Worker = OriginalWorker; window.fetch = originalFetch; await runtime.clear(); }
  });
  assert.equal(hungFrame.stopped, true); assert.equal(hungFrame.restarted, true); assert.match(hungFrame.failure, /초과/);
  const invalidModelFailure = await page.evaluate(async () => {
    const bytes = new TextEncoder().encode('deliberately invalid model');
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
    const assets = { version: 'sdk-loader-probe', files: [...PoseAssets.files.filter(f => f.name !== 'model'), { name: 'model', url: './test-invalid-model.task', sha256: hash }] };
    const runtime = fixturePoseRuntime(assets); const originalFetch = window.fetch;
    try {
      await runtime.clear();
      window.fetch = (url, options) => String(url).endsWith('/test-invalid-model.task') ? Promise.resolve(new Response(bytes)) : originalFetch(url, options);
      await runtime.prepare();
      try { await runtime.start(); return 'unexpected success'; } catch (error) { return error.message; }
    } finally { window.fetch = originalFetch; await runtime.clear(); }
  });
  assert.notEqual(invalidModelFailure, 'unexpected success');
  assert.doesNotMatch(invalidModelFailure, /importScripts|document is not defined|Cannot find module/);
  console.log('Verified official SDK/WASM loader reached invalid-model failure:', invalidModelFailure.slice(0, 180));
  if (fs.existsSync(path.join(__dirname, '../vendor/pose/pose_landmarker_lite.task'))) {
    const inference = await page.evaluate(async baseUrl => {
      const runtime = new PoseRuntime({ minIntervalMs: 0 }); const originalFetch = window.fetch;
      try {
        await runtime.clear(); await runtime.prepare();
        const blob = await (await originalFetch(baseUrl + '/tests/fixtures/pose-sample.jpg')).blob();
        let resolveResult, rejectResult;
        const latency = [];
        await runtime.start({ onResult: result => resolveResult(result), onError: error => rejectResult(error) });
        let result;
        for (let i = 1; i <= 5; i++) {
          const bitmap = await createImageBitmap(blob); const promise = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
          if (!runtime.submit(bitmap, i * 1000)) throw new Error('frame unexpectedly rejected');
          if (i === 1) { const extra = await createImageBitmap(blob); if (runtime.submit(extra, i * 1000 + 1)) throw new Error('second in-flight frame accepted'); }
          result = await Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('inference timeout')), 30000))]); latency.push(result.latencyMs);
        }
        runtime.stop();
        window.fetch = async () => { throw new Error('offline'); }; await runtime.prepare();
        await runtime.start(); runtime.stop();
        return { count: result.landmarks[0]?.length || 0, noseX: result.landmarks[0]?.[0]?.x, latency };
      } finally { window.fetch = originalFetch; runtime.close(); }
    }, baseUrl);
    assert.equal(inference.count, 33); assert.ok(Math.abs(inference.noseX - 0.346) < 0.2);
    console.log('Real local CPU pose inference and offline restart passed:', JSON.stringify(inference));
  } else console.log('Real model inference pending: official model unavailable');
  assert.deepEqual(errors, []);
  console.log('Pose optional cache integrity, offline reuse, cancellation and retry passed; real model is verified separately when present');
}, { setupTeacher: false }).catch(error => { console.error(error); process.exitCode = 1; });
