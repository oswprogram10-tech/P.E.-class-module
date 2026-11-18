'use strict';
// Explicit, expensive manual check. Does not download a model.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const os = require('node:os'), crypto = require('node:crypto');
const { chromium } = require('playwright');
const modelFile = process.argv[2], outputFile = process.argv[3];
if (!modelFile || !outputFile) { console.error('Usage: node scripts/manual/tactics-local-3b.cjs /path/to/qwen2.5-3b-instruct-q4_k_m.gguf /tmp/result.json'); process.exit(2); }
const root = path.resolve(__dirname, '../..'), expected = '626b4a6678b86442240e33df819e00132d3ba7dddfe1cdc4fbb18e0a9615c62d';
const isolation = process.env.PE_TEST_ISOLATION === '1';
const concurrencyText = process.env.PE_TEST_HARDWARE_CONCURRENCY;
const concurrency = concurrencyText === undefined ? null : Number(concurrencyText);
if (concurrency !== null && (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 64)) throw new Error('PE_TEST_HARDWARE_CONCURRENCY must be an integer from 1 to 64');
const record = { isolationRequested: isolation, hardwareConcurrencyOverride: concurrency, modelBytes: 2104932768, modelSha256: expected, environment: 'headless Chromium on current machine; synthetic input', steps: [] };
function report(stage, data) { record.steps.push({ stage, at: new Date().toISOString(), ...data }); fs.writeFileSync(outputFile, JSON.stringify(record, null, 2)); }
(async () => {
  if (fs.statSync(modelFile).size !== record.modelBytes) throw new Error('model size mismatch');
  const hash = crypto.createHash('sha256'); for await (const chunk of fs.createReadStream(modelFile)) hash.update(chunk);
  if (hash.digest('hex') !== expected) throw new Error('model SHA-256 mismatch'); report('model-verified', {});
  const mime = { '.js':'text/javascript', '.wasm':'application/wasm', '.html':'text/html', '.css':'text/css', '.json':'application/json' };
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = pathname === '/test-model.gguf' ? path.resolve(modelFile) : path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (pathname !== '/test-model.gguf' && !file.startsWith(root + path.sep)) return res.writeHead(403).end();
    fs.stat(file, (error, stat) => { if (error || !stat.isFile()) return res.writeHead(404).end(); res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Content-Length': stat.size, ...(isolation ? { 'Cross-Origin-Opener-Policy':'same-origin', 'Cross-Origin-Embedder-Policy':'require-corp', 'Cross-Origin-Resource-Policy':'same-origin' } : {}) }); fs.createReadStream(file).pipe(res); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-3b-profile-')); let ctx;
  try {
    ctx = await chromium.launchPersistentContext(profile, { headless:true, executablePath: process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), args:['--no-sandbox'] });
    record.browserVersion = ctx.browser()?.version() || 'persistent Chromium'; record.offlineCondition = 'Playwright context offline after online installation and reload';
    const page = await ctx.newPage();
    await page.exposeBinding('testRecord', (_source, stage, data) => report(stage, data));
    page.on('request', request => { const u = new URL(request.url()); if (u.protocol.startsWith('http') && u.origin !== `http://127.0.0.1:${server.address().port}`) report('external-request', { origin: u.origin }); });
    await page.addInitScript(({ concurrency }) => { if (concurrency !== null) Object.defineProperty(navigator, 'hardwareConcurrency', { configurable:true, get: () => concurrency }); const fetchOriginal = window.fetch; window.fetch = (url, options) => fetchOriginal(String(url).includes('huggingface.co/Qwen/') ? '/test-model.gguf' : url, options); }, { concurrency });
    await page.goto(`http://127.0.0.1:${server.address().port}/`); await page.evaluate(() => navigator.serviceWorker.ready);
    const run = async stage => {
      const environment = await page.evaluate(async () => {
        const { Wllama } = await import('./vendor/wllama-v3/index.js'); const original = Wllama.prototype.loadModel;
        Wllama.prototype.loadModel = async function(...args) { const result = await original.apply(this, args); const info = this.getLoadedContextInfo(); await window.testRecord('engine-loaded', { isMultithread: this.isMultithread(), threads: this.getNumThreads(), nBatch: info.n_batch, requestedUBatch: args[1]?.n_ubatch }); return result; };
        return { crossOriginIsolated, hardwareConcurrency: navigator.hardwareConcurrency };
      });
      report(`${stage}-environment`, environment); if (isolation && !environment.crossOriginIsolated) throw new Error('cross-origin isolation was requested but is not active');
      report(`${stage}-install-start`, {});
      const installed = await page.evaluate(async () => { const advisor = window.TacticsLocalAdvisor; if (!(await advisor.status()).installed) await advisor.install(); return advisor.status(); });
      if (!installed.installed) throw new Error(`${stage}: model not installed`); report(`${stage}-installed`, { state: installed.state });
      report(`${stage}-generation-start`, {});
      const checked = await page.evaluate(async () => {
        const input = { sport:'teeball', goal:'overall', request:'중계 송구와 수비 위치 이동을 비교해 주세요.' };
        const allowed = TacticsLocalSearch.createLocalAdvisor().prepareText(input).references.map(row => row.id);
        return { allowed, result: await TacticsLocalAdvisor.suggest(input, { onProgress: event => { window.testRecord('progress', { phase: event.phase, received: event.received, total: event.total }); } }) };
      });
      const { result, allowed } = checked;
      const passed = result.modelUsed === true && result.cases.length > 0 && result.cases.every(row => allowed.includes(row.id));
      report(`${stage}-result`, { passed, structuralCheckOnly: true, requiresHumanQualityReview: true, allowed, result }); if (!passed) throw new Error(`${stage}: no validated generated case`);
    };
    await run('online'); await ctx.setOffline(true); await page.reload(); await run('offline-reload');
    record.passed = true; report('complete', { passed: true, structuralCheckOnly: true, requiresHumanQualityReview: true });
  } finally { if (ctx) await ctx.close(); server.close(); fs.rmSync(profile, { recursive:true, force:true }); }
})().catch(error => { record.passed = false; report('error', { passed: false, error: String(error) }); console.error(error); process.exitCode = 1; });
