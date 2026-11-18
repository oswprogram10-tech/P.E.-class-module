'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function harness({ fail = false, pause = false, lockFailure = false, tokenFailure = false } = {}) {
  let loads = 0, exits = 0, completions = [], locked = false, timer, fetches = 0, resume, lockFailures = 0;
  const listeners = {};
  class Wllama {
    setCompat() {}
    async loadModel() { loads++; }
    async exit() { exits++; }
    async createCompletion(opts) { completions.push(opts); if (fail) throw new Error('inference failed'); if (pause) await new Promise(resolve => { resume = resolve; }); opts.onData({ choices: [{ text: '{"selected":[]}', finish_reason: 'stop' }] }); }
  }
  class Tokenizer { encode() { return { ids: [1] }; } }
  const model = { size: 2104932768 };
  const dir = { getFileHandle: async name => ({ getFile: async () => name === 'verified.json' ? { text: async () => JSON.stringify({ sha256: '626b4a6678b86442240e33df819e00132d3ba7dddfe1cdc4fbb18e0a9615c62d' }) } : model }), removeEntry: async () => {} };
  const document = { currentScript: { src: 'https://example.test/tactics-local-advisor.js' }, hidden: false, addEventListener: (name, fn) => { listeners[name] = fn; } };
  const ctx = { URL, DOMException, WebAssembly, Worker: class {}, isSecureContext: true, document,
    navigator: { storage: { getDirectory: async () => ({ getDirectoryHandle: async () => dir }) }, locks: { request: (_name, _options, callback) => { if (lockFailure && !lockFailures++) { if (lockFailure === 'sync') throw new Error('lock failed'); return Promise.reject(new Error('lock failed')); } return (async () => { if (locked) return callback(null); locked = true; try { return await callback({}); } finally { locked = false; } })(); } } },
    fetch: async () => { fetches++; return { ok: !(tokenFailure && fetches === 1), json: async () => ({}) }; },
    setTimeout: fn => { timer = fn; return 1; }, clearTimeout: () => { timer = null; }, addEventListener: (name, fn) => { listeners[name] = fn; },
    TacticsLocalSearch: { createLocalAdvisor: () => ({ prepareText: input => ({ input: { request: input, sport: 'soccer' }, references: [{ id: 'one', observed: 'fact' }] }) }) },
    TacticsLocalPrompt: { planCandidates: () => ({ prompt: 'full prompt', tokens: 5, references: [['one']], totalCount: 1, omittedIds: [] }), responseGrammar: () => 'grammar', validateSelection: () => [] },
    fakeTokenizer: { Tokenizer }, fakeEngine: { Wllama } };
  vm.createContext(ctx);
  const source = fs.readFileSync(path.join(__dirname, '../tactics-local-advisor.js'), 'utf8').replace("import('./vendor/hf-tokenizers/tokenizers.mjs')", 'Promise.resolve(fakeTokenizer)').replace("import('./vendor/wllama-v3/index.js')", 'Promise.resolve(fakeEngine)');
  vm.runInContext(source, ctx);
  return { advisor: ctx.TacticsLocalAdvisor, listeners, document, stats: () => ({ loads, exits, completions, locked, fetches }), expire: () => timer?.(), resume: () => resume?.() };
}

test('warm requests run inference again and keep the deletion lock until release', async () => {
  const h = harness(); await h.advisor.suggest('first'); await h.advisor.suggest('second');
  const s = h.stats(); assert.equal(s.loads, 1); assert.equal(s.fetches, 2); assert.equal(s.completions.length, 2); assert.equal(s.locked, true);
  assert.ok(s.completions.every(c => c.prompt === 'full prompt' && c.cache_prompt === true && c.id_slot === 0));
  assert.equal((await h.advisor.status()).warm, true); await h.advisor.release();
  assert.equal(h.stats().exits, 1); assert.equal(h.stats().locked, false); assert.equal((await h.advisor.status()).warm, false);
});
test('hidden page releases the warm engine and its lock', async () => {
  const h = harness(); await h.advisor.suggest('first'); h.document.hidden = true; h.listeners.visibilitychange();
  await new Promise(resolve => setImmediate(resolve)); assert.equal(h.stats().exits, 1); assert.equal(h.stats().locked, false);
});
test('idle expiry releases the warm engine and its lock', async () => {
  const h = harness(); await h.advisor.suggest('first'); h.expire();
  await new Promise(resolve => setImmediate(resolve)); assert.equal(h.stats().exits, 1); assert.equal(h.stats().locked, false);
});

test('inference failure releases engine and lock', async () => {
  const h = harness({ fail: true }); await assert.rejects(h.advisor.suggest('first'), /inference failed/);
  assert.equal(h.stats().exits, 1); assert.equal(h.stats().locked, false);
});

test('release waits for an in-flight completion before unlocking and suppresses its result', async () => {
  const h = harness({ pause: true }); const running = h.advisor.suggest('first');
  while (!h.stats().completions.length) await new Promise(resolve => setImmediate(resolve));
  const released = h.advisor.release(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.stats().locked, true); h.resume(); await assert.rejects(running, { name: 'AbortError' });
  await released; assert.equal(h.stats().locked, false); assert.equal(h.stats().exits, 1);
});

test('lock request rejection permits cleanup and a later retry', async () => {
  const h = harness({ lockFailure: true }); await assert.rejects(h.advisor.suggest('first'), /lock failed/);
  await h.advisor.release(); await h.advisor.suggest('second'); assert.equal(h.stats().loads, 1); await h.advisor.release();
});
test('tokenizer resource failure permits a later retry', async () => {
  const h = harness({ tokenFailure: true }); await assert.rejects(h.advisor.suggest('first'), /토큰화/);
  assert.equal(h.stats().locked, false); await h.advisor.suggest('second'); assert.equal(h.stats().loads, 1); assert.equal(h.stats().fetches, 4); await h.advisor.release();
});

test('synchronous lock request failure permits retry', async () => {
  const h = harness({ lockFailure: 'sync' }); await assert.rejects(h.advisor.suggest('first'), /lock failed/);
  await h.advisor.release(); await h.advisor.suggest('second'); assert.equal(h.stats().loads, 1); await h.advisor.release();
});
