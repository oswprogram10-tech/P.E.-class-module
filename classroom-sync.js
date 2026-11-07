(function (root) {
  'use strict';
  class ClassroomSync {
    constructor(baseUrl, token, fetcher = fetch, { timeoutMs = 10000 } = {}) { this.baseUrl = baseUrl.replace(/\/$/, ''); this.token = token; this.fetcher = (...args) => fetcher(...args); this.timeoutMs = timeoutMs; this.controller = new AbortController(); }
    close() { this.controller.abort(); this.token = ''; }
    async timedFetch(url, options, parentSignal, readJson = false) {
      const controller = new AbortController();
      const abort = () => controller.abort();
      parentSignal?.addEventListener('abort', abort, { once: true });
      if (parentSignal?.aborted) controller.abort();
      const timer = setTimeout(abort, this.timeoutMs);
      try { const response = await this.fetcher(url, { ...options, signal: controller.signal }); return { response, data: readJson ? await response.json() : undefined }; }
      finally { clearTimeout(timer); parentSignal?.removeEventListener('abort', abort); }
    }
    async logout() {
      const token = this.token;
      this.close();
      const { response } = await this.timedFetch(this.baseUrl + '/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}' });
      if (!response.ok) throw new Error('연결된 세션을 종료하지 못했어요.');
    }
    async request(path, body) {
      this.controller.signal.throwIfAborted();
      const { response, data: result } = await this.timedFetch(this.baseUrl + path, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${this.token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }, this.controller.signal, true);
      if (!response.ok) { const error = new Error(result.error || '전송 실패'); error.status = response.status; throw error; } return result;
    }
    async sync(state, persist) {
      for (const item of state.outbox.filter(entry => !['sent', 'cancelled'].includes(entry.status))) {
        this.controller.signal.throwIfAborted();
        const submission = item.kind === 'submit' ? state.submissions?.find(entry => entry.id === item.payload.id) : null;
        if (item.kind === 'submit' && item.payload.expiresAt <= Date.now()) { item.status = 'cancelled'; if (submission) { submission.status = 'cancelled'; submission.deletedAt = Date.now(); delete submission.clipData; } delete item.payload.clipData; await persist(); continue; }
        item.status = 'sending'; if (submission) submission.status = 'sending'; item.attempts++; await persist();
        this.controller.signal.throwIfAborted();
        try { await this.request('/operations', { id: item.id, kind: item.kind, payload: item.payload }); item.status = 'sent'; if (submission) { submission.status = 'sent'; delete submission.clipData; } item.error = null; if (item.kind === 'submit') delete item.payload.clipData; }
        catch (error) { item.status = 'failed'; if (submission) submission.status = 'failed'; item.error = String(error.message); }
        this.controller.signal.throwIfAborted(); await persist();
      }
    }
    state() { return this.request('/state'); }
  }
  if (typeof module !== 'undefined') module.exports = { ClassroomSync }; else root.ClassroomSync = ClassroomSync;
})(globalThis);
