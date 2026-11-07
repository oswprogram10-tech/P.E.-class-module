const test = require('node:test');
const assert = require('node:assert/strict');
const { ClassroomRepository } = require('../classroom-repository.js');
const { ClipRepository } = require('../clip-repository.js');

function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }

test('암호화 대기 중 중단이나 검증 실패 시 classroom 저장 호출이 없다', async () => {
  for (const mode of ['abort', 'invalid']) {
    const waiting = deferred(), started = deferred(); let writes = 0, valid = true;
    const vault = { encrypt: async () => { started.resolve(); await waiting.promise; return { iv: new Uint8Array(12), ciphertext: new Uint8Array(2) }; } };
    const store = new ClassroomRepository({ classroomWrite: async () => { writes++; } }, vault);
    const controller = new AbortController();
    const operation = store.save({ version: 1 }, {}, 'revision', 0, { signal: controller.signal, validate: () => valid });
    await started.promise;
    if (mode === 'abort') controller.abort(new DOMException('stopped', 'AbortError')); else valid = false;
    waiting.resolve(); await assert.rejects(operation); assert.equal(writes, 0, mode);
  }
});

function stagedWrite() {
  const repo = new ClipRepository(); const reads = [], writes = [], opened = deferred(); let options, stores;
  repo.transaction = (names, _mode, action, opts) => {
    stores = names; options = opts;
    return new Promise((resolve, reject) => {
      const state = { error: null };
      const store = { get: key => { const request = { key }; reads.push(request); return request; }, put: record => { writes.push(record); resolve(); } };
      const tx = { objectStore: () => store, abort: () => reject(options.signal?.aborted ? options.signal.reason : state.error || new Error('aborted')) };
      action(tx, state); opened.resolve();
    });
  };
  return { repo, reads, writes, opened, options: () => options, stores: () => stores };
}

test('vault·버전 확인 후 put 직전 상태 검증 실패와 signal 중단은 쓰기를 차단한다', async () => {
  for (const mode of ['invalid', 'abort', 'ok']) {
    const fake = stagedWrite(), controller = new AbortController(); let valid = true;
    const operation = fake.repo.classroomWrite({ version: 2 }, 'revision', 1, { signal: controller.signal, validate: () => valid });
    await fake.opened.promise;
    assert.equal(fake.options().signal, controller.signal);
    Object.assign(fake.reads[0], { result: { revision: 'revision' } }); fake.reads[0].onsuccess();
    Object.assign(fake.reads[1], { result: { version: 1 } });
    if (mode === 'invalid') valid = false;
    if (mode === 'abort') controller.abort(new DOMException('stopped', 'AbortError'));
    fake.reads[1].onsuccess();
    if (mode === 'ok') { await operation; assert.equal(fake.writes.length, 1); }
    else { await assert.rejects(operation); assert.equal(fake.writes.length, 0, mode); }
  }
});

test('클립 연결은 같은 트랜잭션에서 클립 실존·유효기간과 최종 검증을 확인한다', async () => {
  for (const mode of ['missing', 'expired', 'invalid', 'abort', 'ok']) {
    const fake = stagedWrite(), controller = new AbortController(); let valid = true;
    const operation = fake.repo.classroomWrite({ version: 2 }, 'revision', 1, { signal: controller.signal, validate: () => valid, clipId: 'selected-clip' });
    await fake.opened.promise;
    Object.assign(fake.reads[0], { result: { revision: 'revision' } }); fake.reads[0].onsuccess();
    Object.assign(fake.reads[1], { result: { version: 1 } }); fake.reads[1].onsuccess();
    assert.deepEqual(fake.stores(), ['clips', 'meta']); assert.equal(fake.reads[2].key, 'selected-clip'); assert.equal(fake.writes.length, 0);
    const now = Date.now();
    fake.reads[2].result = mode === 'missing' ? undefined : { createdAt: now - 1000, expiresAt: mode === 'expired' ? now - 1 : now + 60000 };
    if (mode === 'invalid') valid = false;
    if (mode === 'abort') controller.abort(new DOMException('stopped', 'AbortError'));
    fake.reads[2].onsuccess();
    if (mode === 'ok') { await operation; assert.equal(fake.writes.length, 1); }
    else { await assert.rejects(operation); assert.equal(fake.writes.length, 0, mode); }
  }
});

test('암호화 후 선택 클립 ID는 저장 트랜잭션 옵션에 전달된다', async () => {
  let options;
  const store = new ClassroomRepository({ classroomWrite: async (_record, _revision, _version, value) => { options = value; } }, { encrypt: async () => ({ iv: new Uint8Array(12), ciphertext: new Uint8Array(2) }) });
  assert.equal(await store.save({ version: 1 }, {}, 'revision', 0, { clipId: 'selected-clip', validate: () => true }), 1);
  assert.equal(options.clipId, 'selected-clip');
});
