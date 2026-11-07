(function (root) {
  const RETENTION = 7 * 24 * 60 * 60 * 1000;
  function expiry(record) {
    if (!Number.isFinite(record.createdAt) || !Number.isFinite(record.expiresAt)) return null;
    return Math.min(record.expiresAt, record.createdAt + RETENTION);
  }
  class ClipRepository {
    constructor(name = 'pe-loop-local-v1') { this.name = name; this.connection = null; }
    open() {
      if (!this.connection) {
        this.connection = new Promise((resolve, reject) => {
          let failed = false;
          const request = indexedDB.open(this.name, 2);
          request.onupgradeneeded = event => {
            const db = request.result;
            if (!db.objectStoreNames.contains('clips')) {
              const clips = db.createObjectStore('clips', { keyPath: 'id' });
              clips.createIndex('createdAt', 'createdAt');
            }
            if (!db.objectStoreNames.contains('meta')) {
              const meta = db.createObjectStore('meta');
              if (event.oldVersion === 1) meta.put(true, 'legacy-migration-pending');
            }
          };
          request.onerror = () => { failed = true; this.connection = null; reject(request.error); };
          request.onblocked = () => { failed = true; this.connection = null; reject(new Error('다른 앱 탭을 닫고 다시 열어 주세요.')); };
          request.onsuccess = () => {
            if (failed) { request.result.close(); return; }
            request.result.onversionchange = () => { request.result.close(); this.connection = null; };
            resolve(request.result);
          };
        });
      }
      return this.connection;
    }
    async transaction(stores, mode, action, { signal } = {}) {
      signal?.throwIfAborted();
      const db = await this.open();
      signal?.throwIfAborted();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(stores, mode);
        const result = { value: undefined, error: null };
        const abort = () => { try { tx.abort(); } catch {} };
        const clean = () => signal?.removeEventListener('abort', abort);
        signal?.addEventListener('abort', abort, { once: true });
        tx.oncomplete = () => { clean(); resolve(result.value); };
        tx.onerror = () => { /* onabort preserves the underlying error. */ };
        tx.onabort = () => { clean(); reject(signal?.aborted ? signal.reason : result.error || tx.error || new Error('저장 작업을 마치지 못했어요.')); };
        try { action(tx, result); } catch (error) { result.error = error; abort(); }
      });
    }
    raw(mode, action, options) {
      return this.transaction(['clips'], mode, (tx, result) => {
        const request = action(tx.objectStore('clips'));
        if (request?.addEventListener) request.addEventListener('success', () => { result.value = request.result; });
      }, options);
    }
    config() { return this.transaction(['meta'], 'readonly', (tx, result) => {
      const request = tx.objectStore('meta').get('vault'); request.onsuccess = () => { result.value = request.result || null; };
    }); }
    initialize(config, { legacy = false, signal } = {}) {
      return this.transaction(['clips', 'meta'], 'readwrite', (tx, result) => {
        const meta = tx.objectStore('meta');
        const current = meta.get('vault');
        current.onsuccess = () => {
          if (current.result) { result.value = current.result; return; }
          const count = tx.objectStore('clips').count();
          count.onsuccess = () => {
            const save = () => { meta.put(config, 'vault'); meta.delete('legacy-migration-pending'); result.value = config; };
            const refuse = () => { result.error = new Error('기존 클립의 PIN 설정을 확인할 수 없어요. 초기화 안내를 확인해 주세요.'); tx.abort(); };
            if (!count.result) { save(); return; }
            if (!legacy) { refuse(); return; }
            const eligible = meta.get('legacy-migration-pending');
            eligible.onsuccess = () => { if (eligible.result === true) save(); else refuse(); };
          };
        };
      }, { signal });
    }
    reset(config) {
      return this.transaction(['clips', 'meta'], 'readwrite', tx => {
        tx.objectStore('clips').clear(); tx.objectStore('meta').delete('legacy-migration-pending'); tx.objectStore('meta').delete('classroom'); tx.objectStore('meta').put(config, 'vault');
      });
    }
    classroomRead(revision) {
      return this.transaction(['meta'], 'readonly', (tx, result) => {
        const store = tx.objectStore('meta');
        const check = store.get('vault');
        check.onsuccess = () => {
          if (!revision || check.result?.revision !== revision) { result.error = new Error('PIN 설정이 바뀌었어요. 다시 열어 주세요.'); tx.abort(); return; }
          const request = store.get('classroom'); request.onsuccess = () => { result.value = request.result || null; };
        };
      });
    }
    classroomWrite(record, revision, expectedVersion, { signal, validate, clipId } = {}) {
      return this.transaction(clipId ? ['clips', 'meta'] : ['meta'], 'readwrite', (tx, result) => {
        const store = tx.objectStore('meta');
        const check = store.get('vault');
        check.onsuccess = () => {
          if (!revision || check.result?.revision !== revision) { result.error = new Error('PIN 설정이 바뀌었어요. 다시 열어 주세요.'); tx.abort(); return; }
          const current = store.get('classroom');
          current.onsuccess = () => {
            if ((current.result?.version || 0) !== expectedVersion) { result.error = new Error('다른 화면에서 기록을 바꿨어요. 다시 불러와 주세요.'); tx.abort(); return; }
            const commit = () => {
              try { signal?.throwIfAborted(); if (validate && validate() !== true) throw new Error('작업 상태가 바뀌어 기록하지 않았어요.'); store.put(record, 'classroom'); }
              catch (error) { result.error = error; try { tx.abort(); } catch {} }
            };
            if (!clipId) { commit(); return; }
            const clip = tx.objectStore('clips').get(clipId);
            clip.onsuccess = () => {
              const expiresAt = expiry(clip.result || {});
              if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) { result.error = new Error('선택한 클립이 삭제되었거나 만료되었어요.'); tx.abort(); return; }
              commit();
            };
          };
        };
      }, { signal });
    }
    guarded(mode, revision, action, options) {
      return this.transaction(['clips', 'meta'], mode, (tx, result) => {
        const request = tx.objectStore('meta').get('vault');
        request.onsuccess = () => {
          if (!revision || request.result?.revision !== revision) {
            result.error = new Error('다른 탭에서 PIN 설정이 바뀌었어요. 앱을 다시 열어 주세요.'); tx.abort(); return;
          }
          try { action(tx.objectStore('clips'), result); } catch (error) { result.error = error; tx.abort(); }
        };
      }, options);
    }
    put(record, revision, options) {
      return this.guarded('readwrite', revision, store => store.put(record), options);
    }
    delete(id, revision) { return this.guarded('readwrite', revision, store => store.delete(id)); }
    get(id, revision, now = Date.now()) {
      return this.guarded('readonly', revision, (store, result) => {
        const request = store.get(id); request.onsuccess = () => {
          const value = request.result;
          result.value = value && expiry(value) !== null && expiry(value) > now ? value : null;
        };
      });
    }
    all() { return this.raw('readonly', store => store.getAll()); }
    count() { return this.raw('readonly', store => store.count()); }
    expire(now = Date.now()) {
      return this.transaction(['clips'], 'readwrite', (tx, result) => {
        result.value = 0;
        const cursor = tx.objectStore('clips').openCursor();
        cursor.onsuccess = () => {
          const item = cursor.result;
          if (!item) return;
          const expiresAt = expiry(item.value);
          if (expiresAt !== null && expiresAt <= now) { item.delete(); result.value++; }
          item.continue();
        };
      });
    }
    summaries(now = Date.now()) {
      return this.transaction(['clips'], 'readonly', (tx, result) => {
        const summaries = []; result.value = summaries;
        const cursor = tx.objectStore('clips').openCursor();
        cursor.onsuccess = () => {
          const item = cursor.result;
          if (!item) { summaries.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); return; }
          const record = item.value;
          const expiresAt = expiry(record);
          if (expiresAt === null || expiresAt > now) summaries.push({
            id: record.id, createdAt: record.createdAt, expiresAt, durationSeconds: record.durationSeconds,
            metadataIv: record.metadataIv, metadataCiphertext: record.metadataCiphertext,
            bytes: (record.ciphertext?.byteLength || 0) + (record.metadataCiphertext?.byteLength || 0),
          });
          item.continue();
        };
      });
    }
  }
  const api = { ClipRepository, expiry, RETENTION };
  if (typeof module !== 'undefined') module.exports = api;
  else Object.assign(root, api);
})(globalThis);
