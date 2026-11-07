(function (root) {
  'use strict';
  const CACHE_PREFIX = 'pe-loop-pose-';
  class PoseRuntime {
    constructor(options = {}) {
      if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => !['minIntervalMs', 'frameTimeoutMs', 'profileId'].includes(key))) throw new TypeError('Use an allowlisted model profile ID; asset overrides are not supported');
      const { minIntervalMs = 100, frameTimeoutMs = 5000, profileId = root.ModelProfiles.DEFAULT_ID } = options;
      const profile = root.ModelProfiles.resolve(profileId);
      Object.defineProperty(this, 'assets', { value: profile, enumerable: true });
      this.profileId = profile.id;
      this.minIntervalMs = minIntervalMs; this.frameTimeoutMs = frameTimeoutMs; this.cacheName = CACHE_PREFIX + profile.version;
      this.generation = 0; this.worker = null; this.controller = null; this.ready = false; this.inflight = false; this.frameTimer = null; this.lastTimestamp = -Infinity; this.closed = false; this.rejectStart = null; this.onError = null;
    }
    check(generation) { if (this.closed || this.generation !== generation) throw new Error('포즈 준비가 중단됐어요.'); }
    async verified(bytes, entry) {
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('') === entry.sha256;
    }
    async prepare() {
      if (this.closed) throw new Error('닫힌 포즈 분석기는 다시 열 수 없어요.');
      if (!this.assets?.files?.length || this.assets.files.some(item => !/^[a-f0-9]{64}$/.test(item.sha256 || ''))) throw new Error('공식 포즈 모델 파일과 무결성 정보가 아직 준비되지 않았어요.');
      if (this.controller) throw new Error('포즈 준비가 이미 진행 중이에요.');
      const generation = this.generation; const controller = this.controller = new AbortController();
      try {
        const cache = await caches.open(this.cacheName); this.check(generation);
        for (const entry of this.assets.files) {
          const url = new URL(entry.url, location.href);
          if (url.origin !== location.origin) throw new Error('포즈 파일은 현재 앱에서만 불러올 수 있어요.');
          let response = await cache.match(url.href); this.check(generation);
          if (response && !await this.verified(await response.clone().arrayBuffer(), entry)) { await cache.delete(url.href); response = null; }
          if (!response) {
            response = await fetch(url.href, { signal: controller.signal, cache: 'no-store', redirect: 'error', credentials: 'same-origin' });
            if (!response.ok || response.type === 'opaque') throw new Error('포즈 파일을 가져오지 못했어요.');
            const bytes = await response.arrayBuffer(); this.check(generation);
            if (!await this.verified(bytes, entry)) throw new Error('포즈 파일 무결성을 확인하지 못했어요.');
            this.check(generation); await cache.put(url.href, new Response(bytes, { headers: { 'Content-Type': response.headers.get('Content-Type') || 'application/octet-stream' } }));
          }
          this.check(generation);
        }
      } finally { if (this.controller === controller) this.controller = null; }
    }
    async start({ onResult = () => {}, onError = () => {} } = {}) {
      if (this.closed) throw new Error('닫힌 포즈 분석기는 다시 열 수 없어요.');
      if (this.worker) throw new Error('포즈 분석기가 이미 실행 중이에요.');
      const generation = this.generation; const cache = await caches.open(this.cacheName); this.check(generation); const buffers = {};
      for (const entry of this.assets.files) {
        const response = await cache.match(new URL(entry.url, location.href).href); this.check(generation);
        if (!response || !entry.sha256) throw new Error('포즈 파일을 먼저 준비해 주세요.');
        const bytes = await response.arrayBuffer(); this.check(generation);
        if (!await this.verified(bytes, entry)) throw new Error('포즈 파일 무결성을 확인하지 못했어요.');
        buffers[entry.name] = bytes;
      }
      this.check(generation); const worker = this.worker = new Worker('./pose-worker.js'); this.lastTimestamp = -Infinity; this.onError = onError;
      return new Promise((resolve, reject) => {
        let ready = false; const timer = setTimeout(() => { if (!ready) { this.rejectStart = null; this.stop(); reject(new Error('포즈 분석기 준비 시간이 초과됐어요.')); } }, 60000);
        this.rejectStart = error => { clearTimeout(timer); reject(error); };
        worker.onmessage = event => {
          if (worker !== this.worker) return;
          const message = event.data;
          if (message.type === 'ready') { ready = true; this.ready = true; clearTimeout(timer); this.rejectStart = null; resolve(); }
          else if (message.type === 'result') { clearTimeout(this.frameTimer); this.frameTimer = null; this.inflight = false; onResult(message); }
          else if (message.type === 'error') { clearTimeout(this.frameTimer); this.frameTimer = null; this.inflight = false; const error = new Error(message.message || '포즈 분석 실패'); if (!ready) { clearTimeout(timer); this.rejectStart = null; this.stop(); reject(error); } else onError(error); }
        };
        worker.onerror = event => { const error = new Error(event.message || '포즈 분석기 오류'); if (!ready) { clearTimeout(timer); this.rejectStart = null; this.stop(); reject(error); } else { this.stop(); onError(error); } };
        worker.postMessage({ type: 'init', assets: buffers }, Object.values(buffers));
      });
    }
    submit(bitmap, timestamp) {
      if (!this.worker || !this.ready || this.inflight || !Number.isFinite(timestamp) || timestamp <= this.lastTimestamp || timestamp - this.lastTimestamp < this.minIntervalMs) { bitmap?.close(); return false; }
      this.inflight = true; this.lastTimestamp = timestamp;
      try { this.worker.postMessage({ type: 'frame', bitmap, timestamp }, [bitmap]); this.frameTimer = setTimeout(() => { const onError = this.onError; this.stop(); onError?.(new Error('포즈 분석 응답 시간이 초과됐어요.')); }, this.frameTimeoutMs); return true; }
      catch (error) { this.inflight = false; bitmap?.close(); throw error; }
    }
    stop() {
      this.generation++; this.controller?.abort(); this.controller = null; clearTimeout(this.frameTimer); this.frameTimer = null; this.worker?.terminate(); this.worker = null; this.ready = false; this.inflight = false; this.onError = null; this.lastTimestamp = -Infinity;
      const reject = this.rejectStart; this.rejectStart = null; reject?.(new Error('포즈 분석이 중단됐어요.'));
    }
    close() { this.stop(); this.closed = true; }
    async clear() { this.stop(); await caches.delete(this.cacheName); }
  }
  if (typeof module !== 'undefined') module.exports = { PoseRuntime }; else root.PoseRuntime = PoseRuntime;
})(globalThis);
