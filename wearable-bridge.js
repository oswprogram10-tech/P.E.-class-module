(function (root) {
  'use strict';

  // The teacher tablet app injects this relay bridge into its trusted PE Loop WebView.
  // The student phone app accesses the watch; a normal browser/PWA cannot receive LAN data.
  const MIN_RELEASE_DATE = '2022-11-07';
  const HEART_RATE_STALE_MS = 5000;
  const PAIRING_PREFIX = 'PELOOP_PAIR_V1.';
  const PAIRING_TTL_MS = 120000;
  const PLATFORMS = new Set(['galaxy-watch', 'apple-watch']);
  const DATA_TYPES = Object.freeze(['heartRate']);
  const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

  function supportedBridge(bridge) {
    return Boolean(bridge && bridge.version === 2 && ['createPairingSession', 'reconnectSession', 'stopSession', 'subscribe'].every(method => typeof bridge[method] === 'function'));
  }

  function isPrivateIpv4(host) {
    if (typeof host !== 'string' || !/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(host)) return false;
    const octets = host.split('.').map(Number);
    if (octets.some(value => value > 255)) return false;
    return octets[0] === 10 ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168);
  }

  function validatePairingPayload(payload, now = Date.now()) {
    if (typeof payload !== 'string' || payload.length > 4096 || !payload.startsWith(PAIRING_PREFIX)) throw new Error('연결 QR 형식을 확인할 수 없습니다.');
    const encoded = payload.slice(PAIRING_PREFIX.length);
    if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error('연결 QR 형식을 확인할 수 없습니다.');
    let invitation;
    try {
      const binary = root.atob(encoded.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - encoded.length % 4) % 4));
      const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
      invitation = JSON.parse(new root.TextDecoder().decode(bytes));
    } catch (_) { throw new Error('연결 QR 내용을 읽을 수 없습니다.'); }
    const allowedKeys = ['expiresAt', 'fingerprint', 'host', 'port', 'sessionId', 'ticket', 'v'];
    if (!invitation || typeof invitation !== 'object' || Array.isArray(invitation) || Object.keys(invitation).sort().join(',') !== allowedKeys.join(',')) throw new Error('연결 QR에 허용되지 않은 정보가 들어 있습니다.');
    if (invitation.v !== 1 || !isPrivateIpv4(invitation.host)) throw new Error('연결 QR은 같은 로컬 네트워크의 주소여야 합니다.');
    if (!Number.isInteger(invitation.port) || invitation.port < 1024 || invitation.port > 65535) throw new Error('연결 QR의 포트가 올바르지 않습니다.');
    if (typeof invitation.sessionId !== 'string' || !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(invitation.sessionId)) throw new Error('연결 QR의 세션 식별자가 올바르지 않습니다.');
    if (typeof invitation.ticket !== 'string' || !/^[A-Za-z0-9_-]{22,64}$/.test(invitation.ticket)) throw new Error('연결 QR의 일회용 자격이 올바르지 않습니다.');
    if (typeof invitation.fingerprint !== 'string' || !/^[a-fA-F0-9]{64}$/.test(invitation.fingerprint)) throw new Error('연결 QR의 태블릿 인증 지문이 올바르지 않습니다.');
    if (!Number.isSafeInteger(invitation.expiresAt) || invitation.expiresAt <= now || invitation.expiresAt > now + PAIRING_TTL_MS) throw new Error('연결 QR이 만료되었거나 유효 시간이 너무 깁니다.');
    return Object.freeze({ v: invitation.v, host: invitation.host, port: invitation.port, sessionId: invitation.sessionId.toLowerCase(), ticket: invitation.ticket, fingerprint: invitation.fingerprint.toLowerCase(), expiresAt: invitation.expiresAt });
  }

  function validatePairingResult(result, now = Date.now()) {
    if (!result || typeof result.sessionId !== 'string' || !result.sessionId || result.sessionId.length > 128) throw new Error('연동 앱에서 유효한 세션을 돌려주지 않았습니다.');
    const invitation = validatePairingPayload(result.pairingPayload, now);
    return Object.freeze({ sessionId: result.sessionId, pairingPayload: result.pairingPayload, invitation });
  }

  function validateDevice(device, now = Date.now()) {
    if (!device || typeof device !== 'object' || !PLATFORMS.has(device.platform)) throw new Error('지원 대상으로 확인되지 않은 워치입니다.');
    if (typeof device.model !== 'string' || !device.model.trim() || device.model.length > 100) throw new Error('워치 모델을 확인할 수 없습니다.');
    if (!validDate(device.releaseDate) || device.releaseDate < MIN_RELEASE_DATE || Date.parse(`${device.releaseDate}T00:00:00Z`) > now) throw new Error('기기 출시일이 지원 범위에 없습니다.');
    if (device.heartRateAvailable !== true) throw new Error('이 기기에서 심박수 측정을 지원하지 않습니다.');
    return Object.freeze({ platform: device.platform, model: device.model.trim(), releaseDate: device.releaseDate });
  }

  function validateConsent(consent) {
    if (!consent || consent.student !== true || consent.guardian !== true || consent.heartRate !== true) {
      throw new Error('학생 본인과 보호자의 심박수 수집 동의를 모두 확인해야 합니다.');
    }
    if (typeof consent.isStillValid === 'function' && consent.isStillValid() !== true) throw new Error('수업 중 동의 확인이 해제되어 측정을 중단했습니다.');
  }

  function createNativeBridge(host = root.PELoopNativeHost) {
    if (root.PELoopWearableBridge) return root.PELoopWearableBridge;
    if (!host || typeof host.postMessage !== 'function') return null;
    const listeners = new Map();
    const pending = new Map();
    const onMessage = event => {
      let message;
      try { message = JSON.parse(event.data); } catch (_) { return; }
      if (message?.type === 'event' && typeof message.listenerId === 'string') {
        try { listeners.get(message.listenerId)?.(message.event); } catch (_) { /* Keep one listener from blocking others. */ }
        return;
      }
      const request = pending.get(message?.id);
      if (!request) return;
      clearTimeout(request.timer); pending.delete(message.id);
      if (message.ok === true) request.resolve(message.data);
      else request.reject(new Error(typeof message.error === 'string' ? message.error : '태블릿 네이티브 호스트 요청이 실패했습니다.'));
    };
    host.onmessage = onMessage;
    function invoke(method, value) {
      const id = root.crypto.randomUUID();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('태블릿 연결 요청 시간이 초과되었습니다.')); }, 10000);
        pending.set(id, { resolve, reject, timer });
        try { host.postMessage(JSON.stringify({ id, method, payload: value })); }
        catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
      });
    }
    const bridge = Object.freeze({
      version: 2,
      createPairingSession: request => invoke('createPairingSession', request),
      reconnectSession: request => invoke('reconnectSession', request),
      stopSession: request => invoke('stopSession', request),
      subscribe(listener) {
        const listenerId = root.crypto.randomUUID();
        listeners.set(listenerId, listener);
        void invoke('subscribe', { listenerId }).catch(() => listeners.delete(listenerId));
        return () => { listeners.delete(listenerId); void invoke('unsubscribe', { listenerId }).catch(() => {}); };
      },
    });
    root.PELoopWearableBridge = bridge;
    return bridge;
  }

  function createController({ bridge = createNativeBridge(), now = () => Date.now(), createId = () => root.crypto.randomUUID(), schedule = (fn, delay) => setTimeout(fn, delay), cancel = handle => clearTimeout(handle) } = {}) {
    let status = 'idle';
    let bpm = null;
    let sampledAt = null;
    let device = null;
    let pairingPayload = null;
    let disconnectionSource = null;
    let gapStartedAt = null;
    let gapCount = 0;
    let lastGapDurationMs = null;
    let currentSession = null;
    let unsubscribe = null;
    let staleTimer = null;
    let resumeFloor = -Infinity;
    let lastAcceptedTimestamp = -Infinity;
    const listeners = new Set();

    function snapshot() {
      return Object.freeze({ status, bpm, sampledAt, device, pairingPayload, disconnectionSource, gapStartedAt, gapCount, lastGapDurationMs });
    }
    function emit() { const value = snapshot(); for (const listener of listeners) listener(value); }
    function beginGap(nextStatus) {
      if (staleTimer !== null) { cancel(staleTimer); staleTimer = null; }
      if (gapStartedAt === null) gapStartedAt = now();
      bpm = null; sampledAt = null; pairingPayload = null; status = nextStatus; emit();
    }
    function closeGap() {
      if (gapStartedAt !== null) { gapCount += 1; lastGapDurationMs = Math.max(0, now() - gapStartedAt); gapStartedAt = null; }
      disconnectionSource = null;
    }
    function setStatus(value) { status = value; emit(); }
    function listen() {
      unsubscribe?.();
      unsubscribe = bridge.subscribe(event => {
        if (!currentSession || !event || event.sessionId !== currentSession.sessionId) return;
        if (status === 'network-disconnected' && !['permission-revoked', 'network-reconnected'].includes(event.type)) return;
        if (event.type === 'network-reconnected') { resumeFloor = now(); device = null; pairingPayload = null; status = 'waiting-data'; emit(); return; }
        if (event.type === 'participant-connected') { pairingPayload = null; status = 'waiting-data'; emit(); return; }
        if (event.type === 'device-ready') {
          try { device = validateDevice(event.device, now()); pairingPayload = null; status = 'waiting-data'; emit(); }
          catch (_) { void stop('unsupported'); }
          return;
        }
        if (event.type === 'invitation-expired') { void stop('expired'); return; }
        if (event.type === 'permission-unavailable') { void stop('denied'); return; }
        if (event.type === 'disconnected') {
          disconnectionSource = event.source === 'network' ? 'network' : 'watch';
          beginGap(disconnectionSource === 'network' ? 'network-disconnected' : 'disconnected'); return;
        }
        if (event.type === 'permission-revoked') { void stop('denied'); return; }
        if (event.type !== 'sample' || event.metric !== 'heartRate' || !device) return;
        const timestamp = event.timestamp;
        const value = event.value;
        if (!Number.isSafeInteger(timestamp) || !Number.isFinite(value) || value < 20 || value > 250 || (timestamp < resumeFloor || timestamp <= lastAcceptedTimestamp)) return;
        if (timestamp > now() + 30000) return;
        if (now() - timestamp > HEART_RATE_STALE_MS) { beginGap('stale'); return; }
        if (staleTimer !== null) cancel(staleTimer);
        closeGap(); lastAcceptedTimestamp = timestamp; bpm = value; sampledAt = timestamp; status = 'active';
        const sampleTime = sampledAt;
        staleTimer = schedule(() => { if (sampledAt === sampleTime && now() - sampleTime >= HEART_RATE_STALE_MS) beginGap('stale'); }, Math.max(0, sampleTime + HEART_RATE_STALE_MS - now()));
        emit();
      });
    }
    async function start(consent) {
      validateConsent(consent);
      if (!supportedBridge(bridge)) { status = 'unavailable'; emit(); throw new Error('워치 네이티브 연동 앱이 아직 연결되지 않았습니다.'); }
      if (currentSession) throw new Error('진행 중인 측정 세션을 먼저 종료해 주세요.');
      try {
        resumeFloor = -Infinity; lastAcceptedTimestamp = -Infinity;
        setStatus('creating-invitation');
        const participantToken = createId();
        const result = validatePairingResult(await bridge.createPairingSession({ participantToken, dataTypes: DATA_TYPES }), now());
        try { validateConsent(consent); } catch (error) { try { await bridge.stopSession({ sessionId: result.sessionId }); } catch (_) {} throw error; }
        device = null; currentSession = { sessionId: result.sessionId, participantToken };
        pairingPayload = result.pairingPayload; status = 'pairing'; bpm = null; sampledAt = null; disconnectionSource = null; gapStartedAt = null; gapCount = 0; lastGapDurationMs = null;
        listen(); emit(); return snapshot();
      } catch (error) {
        if (status !== 'denied') status = 'error';
        bpm = null; sampledAt = null; emit(); throw error;
      }
    }
    async function reconnect(consent) {
      validateConsent(consent);
      if (!supportedBridge(bridge)) throw new Error('워치 네이티브 연동 앱이 아직 연결되지 않았습니다.');
      if (!currentSession || !['disconnected', 'stale'].includes(status)) throw new Error('다시 연결할 측정 세션이 없습니다.');
      try {
        setStatus('creating-invitation');
        const result = validatePairingResult(await bridge.reconnectSession({ participantToken: currentSession.participantToken, dataTypes: DATA_TYPES }), now());
        try { validateConsent(consent); } catch (error) { try { await bridge.stopSession({ sessionId: result.sessionId }); } catch (_) {} throw error; }
        unsubscribe?.(); currentSession.sessionId = result.sessionId; device = null; pairingPayload = result.pairingPayload; status = 'pairing'; bpm = null; sampledAt = null; listen(); emit(); return snapshot();
      } catch (error) {
        if (status !== 'denied') status = 'error';
        bpm = null; sampledAt = null; emit(); throw error;
      }
    }
    async function stop(finalStatus = 'ended') {
      const ending = currentSession;
      currentSession = null;
      unsubscribe?.(); unsubscribe = null;
      if (staleTimer !== null) { cancel(staleTimer); staleTimer = null; }
      bpm = null; sampledAt = null; device = null; pairingPayload = null; disconnectionSource = null; gapStartedAt = null; status = finalStatus; emit();
      if (ending && supportedBridge(bridge)) {
        try { await bridge.stopSession({ sessionId: ending.sessionId }); } catch (_) { /* The page still forgets readings immediately. */ }
      }
      return snapshot();
    }
    return Object.freeze({
      available: supportedBridge(bridge),
      getState: snapshot,
      subscribe(listener) { if (typeof listener !== 'function') throw new Error('A state listener is required'); listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener); },
      start,
      reconnect,
      stop,
    });
  }

  const api = Object.freeze({ MIN_RELEASE_DATE, HEART_RATE_STALE_MS, PAIRING_PREFIX, PAIRING_TTL_MS, supportedBridge, isPrivateIpv4, validatePairingPayload, validatePairingResult, validateDevice, validateConsent, createNativeBridge, createController });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.WearableBridge = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
