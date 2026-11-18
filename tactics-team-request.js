(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = { createStore: factory };
  else root.TacticsTeamRequest = factory({ search: input => root.TacticsLocalSearch.createLocalAdvisor().prepareText(input) });
})(globalThis, function createStore({ search, now = () => Date.now(), ttlMs = 15 * 60 * 1000 }) {
  if (typeof search !== 'function' || typeof now !== 'function' || !Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error('요청 보관 설정이 올바르지 않습니다.');
  let saved = null;
  function clear() { saved = null; }
  function live() { if (saved && now() >= saved.expiresAt) clear(); return saved; }
  function copy(value) { return value ? { sport: value.sport, request: value.request, caseIds: [...value.caseIds] } : null; }
  function offer(payload) {
    clear();
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.getPrototypeOf(payload) !== Object.prototype || Reflect.ownKeys(payload).sort().join(',') !== 'caseIds,request,sport' || Object.values(Object.getOwnPropertyDescriptors(payload)).some(d => !('value' in d)) || !Array.isArray(payload.caseIds) || payload.caseIds.length > 2 || Reflect.ownKeys(payload.caseIds).length !== payload.caseIds.length + 1 || Array.from({ length: payload.caseIds.length }, (_, i) => Object.getOwnPropertyDescriptor(payload.caseIds, String(i))).some(d => !d || !('value' in d)) || payload.caseIds.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,60}$/.test(id)) || new Set(payload.caseIds).size !== payload.caseIds.length) throw new Error('모둠 요청 형식을 확인해 주세요.');
    // Search again for this exact question and sport. Caller-supplied candidate lists are never trusted.
    const prepared = search({ sport: payload.sport, goal: 'overall', request: payload.request });
    if (!prepared?.input || !Array.isArray(prepared.references)) throw new Error('검색 결과를 확인하지 못했어요.');
    const allowed = new Set(prepared.references.map(row => row.id));
    if (payload.caseIds.some(id => !allowed.has(id))) throw new Error('현재 요청에서 찾은 사례만 가져올 수 있어요.');
    saved = { sport: prepared.input.sport, request: prepared.input.request, caseIds: [...payload.caseIds], expiresAt: now() + ttlMs };
    return copy(saved);
  }
  function peek() { return copy(live()); }
  function consume() { const value = copy(live()); clear(); return value; }
  return Object.freeze({ offer, peek, consume, clear });
});
