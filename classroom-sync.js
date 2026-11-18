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
      try {
        const response = await this.fetcher(url, { ...options, redirect: 'error', cache: 'no-store', signal: controller.signal });
        let data;
        if (readJson) {
          data = await response.json().catch(error => {
            if (response.ok) throw error;
            return null;
          });
        }
        return { response, data };
      }
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
      if (!response.ok) {
        const errors = {
          401: '학급 서버 연결이 만료됐어요. 다시 연결해 주세요.',
          409: '서버 자료와 충돌했어요. 게시판을 새로 읽고 전송 대기열을 확인해 주세요.',
          413: '선택 장면이 너무 커요. 더 짧은 장면을 선택해 주세요.',
          507: '학급 서버의 저장 공간이 부족해요. 교사에게 알려 주세요.',
        };
        const error = new Error(errors[response.status] || (response.status >= 500 ? '학급 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.' : result?.error || '전송 실패'));
        error.status = response.status;
        throw error;
      }
      return result;
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
