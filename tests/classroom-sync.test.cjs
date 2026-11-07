const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ClassroomSync } = require('../classroom-sync');
test('a timed out operation keeps its payload and later operations and retries proceed', async () => {
  let blocked = true;
  const fetcher = async (_url, options) => {
    const op = JSON.parse(options.body);
    if (blocked && op.id === 'a') return await new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true }));
    return { ok: true, json: async () => ({ ok: true }) };
  };
  const payload = { id: 'clip-a', clipData: 'selected', expiresAt: Date.now() + 50000 };
  const state = { submissions: [{ id: 'clip-a' }], outbox: [{ id: 'a', kind: 'submit', status: 'queued', attempts: 0, payload }, { id: 'b', kind: 'feedback', status: 'queued', attempts: 0, payload: { id: 'feedback' } }] };
  const sync = new ClassroomSync('http://127.0.0.1:1', 'test', fetcher, { timeoutMs: 20 });
  await sync.sync(state, async () => {});
  assert.equal(state.outbox[0].status, 'failed'); assert.equal(payload.clipData, 'selected'); assert.equal(state.outbox[1].status, 'sent');
  blocked = false; await sync.sync(state, async () => {});
  assert.equal(state.outbox[0].status, 'sent'); assert.equal(payload.clipData, undefined);
});
