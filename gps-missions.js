(function (root) {
  'use strict';
  const fail = message => { throw new Error(message); };
  function coordinate(value) {
    if (!value || typeof value !== 'object' || !Number.isFinite(value.latitude) || Math.abs(value.latitude) > 90 || !Number.isFinite(value.longitude) || Math.abs(value.longitude) > 180) fail('올바른 위도·경도를 입력해 주세요.');
    return { latitude: value.latitude, longitude: value.longitude };
  }
  function distance(a, b) {
    a = coordinate(a); b = coordinate(b);
    const rad = value => value * Math.PI / 180;
    const h = Math.sin(rad(b.latitude - a.latitude) / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(rad(b.longitude - a.longitude) / 2) ** 2;
    return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
  }
  function validate(definition) {
    if (!definition || definition.safetyReviewed !== true) fail('교사가 이동 경로와 안전 구역을 먼저 확인해 주세요.');
    const target = coordinate(definition.target), safeArea = coordinate(definition.safeArea);
    if (!Number.isFinite(definition.radiusM) || definition.radiusM < 10 || definition.radiusM > 200) fail('도착 반경은 10~200m로 정해 주세요.');
    if (!Number.isFinite(definition.safeArea.radiusM) || definition.safeArea.radiusM < 20 || definition.safeArea.radiusM > 1000) fail('안전 구역 반경은 20~1000m로 정해 주세요.');
    safeArea.radiusM = definition.safeArea.radiusM;
    if (distance(target, safeArea) + definition.radiusM > safeArea.radiusM + 0.01) fail('도착 구역 전체가 교사가 확인한 안전 구역 안에 있어야 해요.');
    return { target, radiusM: definition.radiusM, safeArea, safetyReviewed: true };
  }
  function verify(definition, fix, now = Date.now()) {
    const rule = validate(definition);
    const coords = coordinate(fix);
    if (!Number.isFinite(fix.timestamp) || now - fix.timestamp > 30000 || fix.timestamp > now + 5000) fail('위치 정보가 오래됐어요. 도착 확인을 다시 눌러 주세요.');
    if (!Number.isFinite(fix.accuracy) || fix.accuracy < 0 || fix.accuracy > 50) fail('GPS 오차가 커서 도착을 확인할 수 없어요. 안전한 곳에 머물며 다시 확인해 주세요.');
    if (distance(coords, rule.safeArea) + fix.accuracy > rule.safeArea.radiusM) fail('현재 위치를 안전 구역 안으로 확인할 수 없어요. 이동을 멈추고 교사에게 알려 주세요.');
    const distanceM = distance(coords, rule.target);
    if (distanceM + fix.accuracy > rule.radiusM) fail('GPS 오차를 포함하면 도착 구역 안인지 확인할 수 없어요. 교사 안내를 따라 주세요.');
    return { verified: true };
  }
  function locate({ geolocation = root.navigator?.geolocation, signal, secure = root.isSecureContext, timeoutMs = 10000 } = {}) {
    if (!secure || !geolocation) return Promise.reject(new Error('GPS 도착 확인에는 HTTPS와 위치 권한을 지원하는 기기가 필요해요.'));
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error, fix) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); error ? reject(error) : resolve(fix); };
      const abort = () => finish(new Error('위치 확인을 취소했어요.'));
      const timer = setTimeout(() => finish(new Error('위치를 확인하지 못했어요. 안전한 곳에서 교사에게 알려 주세요.')), timeoutMs + 500);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) return abort();
      try {
        geolocation.getCurrentPosition(position => finish(null, { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy, timestamp: position.timestamp }), error => finish(new Error(error.code === 1 ? '위치 권한이 거부됐어요. GPS 없이 진행할 활동은 교사에게 안내받아 주세요.' : 'GPS 위치를 확인하지 못했어요. 안전한 곳에서 교사에게 알려 주세요.')), { enableHighAccuracy: true, maximumAge: 0, timeout: timeoutMs });
      } catch { finish(new Error('GPS 위치를 요청하지 못했어요.')); }
    });
  }
  const api = Object.freeze({ coordinate, distance, validate, verify, locate });
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.GpsMissions = api;
})(globalThis);
