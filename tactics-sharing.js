(function (root) {
  'use strict';
  const T = typeof module !== 'undefined' && module.exports ? require('./tactics-board.js') : root.TacticsBoard;
  const cryptoApi = root.crypto || (typeof require === 'function' ? require('node:crypto').webcrypto : null);
  const PREFIX = 'PELOOP_TACTICS_V1:';
  const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
  const encode = bytes => typeof Buffer !== 'undefined' ? Buffer.from(bytes).toString('base64url') : btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const decode = value => typeof Buffer !== 'undefined' ? new Uint8Array(Buffer.from(value, 'base64url')) : Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
  function serverUrl(value) {
    const u = new URL(value);
    if ((u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname))) || u.username || u.password || u.search || u.hash || u.pathname !== '/') throw new Error('공유 서버는 HTTPS 주소를 입력해 주세요. 개발용 HTTP는 localhost만 허용해요.');
    return u.origin;
  }
  function invitation(share, role = 'read') {
    const token = role === 'edit' ? share.writeToken : share.readToken;
    if (!token) throw new Error('이 권한의 초대를 만들 수 없어요.');
    return PREFIX + encode(new TextEncoder().encode(JSON.stringify({ server: serverUrl(share.server), id: share.id, token, key: share.key, role })));
  }
  function parseInvitation(value) {
    if (typeof value !== 'string' || value.length > 4096 || !value.startsWith(PREFIX)) throw new Error('전술판 초대 내용을 확인해 주세요.');
    let data; try { data = JSON.parse(new TextDecoder().decode(decode(value.slice(PREFIX.length)))); } catch { throw new Error('전술판 초대 형식이 올바르지 않아요.'); }
    if (!data || ![data.id, data.token, data.key].every(token => typeof token === 'string' && tokenPattern.test(token)) || !['read', 'edit'].includes(data.role)) throw new Error('전술판 초대 권한이 올바르지 않아요.');
    return { server: serverUrl(data.server), id: data.id, token: data.token, key: data.key, role: data.role };
  }
  async function encrypt(board, secret) {
    const key = await cryptoApi.subtle.importKey('raw', decode(secret), 'AES-GCM', false, ['encrypt']);
    const iv = cryptoApi.getRandomValues(new Uint8Array(12));
    const data = new TextEncoder().encode(JSON.stringify(T.anonymousLayout(board)));
    const ciphertext = await cryptoApi.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode('PELOOP_TACTICS_V1') }, key, data);
    return { version: 1, iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)) };
  }
  async function decrypt(envelope, secret) {
    try {
      if (envelope.version !== 1 || typeof envelope.ciphertext !== 'string' || envelope.ciphertext.length > 150000) throw new Error();
      const key = await cryptoApi.subtle.importKey('raw', decode(secret), 'AES-GCM', false, ['decrypt']);
      const data = await cryptoApi.subtle.decrypt({ name: 'AES-GCM', iv: decode(envelope.iv), additionalData: new TextEncoder().encode('PELOOP_TACTICS_V1') }, key, decode(envelope.ciphertext));
      return T.anonymousLayout(JSON.parse(new TextDecoder().decode(data)));
    } catch { throw new Error('전술판을 복호화하지 못했어요. 올바른 초대를 다시 받아 주세요.'); }
  }
  async function request(server, path, { token, body, method = body ? 'POST' : 'GET', signal } = {}) {
    const url = serverUrl(server) + '/tactics/v1' + path;
    const controller = new AbortController(), abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    const timer = setTimeout(abort, path === '/suggestions' ? 65000 : 15000);
    try {
      const response = await fetch(url, {
        method, signal: controller.signal, redirect: 'error', credentials: 'omit', cache: 'no-store',
        headers: { Authorization: `Bearer ${token || ''}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result) {
        const error = new Error(result?.message || '공유 서버의 응답을 확인하지 못했어요. 연결을 확인하고 다시 시도해 주세요.');
        error.status = response.status;
        error.retryable = response.status >= 500 || response.ok;
        throw error;
      }
      return result;
    } catch (error) {
      signal?.throwIfAborted();
      if (controller.signal.aborted || error instanceof TypeError) {
        const failure = new Error(controller.signal.aborted
          ? '서버 응답이 늦어 작업을 멈췄어요. 연결을 확인하고 다시 시도해 주세요.'
          : '공유 서버에 연결하지 못했어요. 네트워크를 확인하고 다시 시도해 주세요.');
        failure.retryable = true;
        throw failure;
      }
      throw error;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  async function create(server, adminToken, board, signal) {
    server = serverUrl(server);
    const key = encode(cryptoApi.getRandomValues(new Uint8Array(32)));
    const result = await request(server, '/boards', { token: adminToken, body: { envelope: await encrypt(board, key) }, signal });
    return { server, key, ...result };
  }
  async function read(share, signal) {
    const token = share.writeToken || share.readToken || share.token;
    const result = await request(share.server, '/boards/' + share.id, { token, signal });
    return { board: await decrypt(result.envelope, share.key), version: result.version, expiresAt: result.expiresAt };
  }
  async function join(value, signal) {
    const invite = parseInvitation(value), result = await read(invite, signal);
    return { board: result.board, share: { server: invite.server, id: invite.id, key: invite.key, ...(invite.role === 'edit' ? { writeToken: invite.token } : { readToken: invite.token }), version: result.version, expiresAt: result.expiresAt } };
  }
  async function publish(share, board, signal) {
    if (!share.writeToken) throw new Error('읽기 전용 초대예요. 편집 초대를 받아 주세요.');
    const layout = T.anonymousLayout(board);
    try {
      return await request(share.server, '/boards/' + share.id, {
        token: share.writeToken, method: 'PUT',
        body: { expectedVersion: share.version, envelope: await encrypt(layout, share.key) }, signal,
      });
    } catch (error) {
      signal?.throwIfAborted();
      if (error.status !== 409 && !error.retryable) throw error;
      // Recover an unacknowledged publish only if the next version has the exact submitted layout.
      const latest = await read(share, signal).catch(() => null);
      signal?.throwIfAborted();
      if (latest?.version === share.version + 1 && JSON.stringify(latest.board) === JSON.stringify(layout)) {
        return { version: latest.version, expiresAt: latest.expiresAt, recovered: true };
      }
      throw error;
    }
  }
  async function revoke(share, signal) {
    if (!share.writeToken) throw new Error('공유를 종료할 권한이 없어요.');
    try {
      return await request(share.server, '/boards/' + share.id, { token: share.writeToken, method: 'DELETE', signal });
    } catch (error) {
      if (error.status === 404) return { ok: true };
      throw error;
    }
  }
  const api = Object.freeze({ PREFIX, serverUrl, invitation, parseInvitation, encrypt, decrypt, request, create, read, join, publish, revoke });
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TacticsSharing = api;
})(globalThis);
