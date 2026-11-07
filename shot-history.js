/* Encrypted classroom-local movement records; no raw frames or landmark arrays. */
(function (root) {
  'use strict';
  const M = typeof module !== 'undefined' && module.exports ? require('./classroom-model.js') : root.ClassroomModel;
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const FIELDS = ['classId', 'studentId', 'lessonId', 'deviceId'];
  const MAX_ATTEMPTS = 2000;
  const LEVELS = Object.freeze({ low: [130, 165, .18], normal: [140, 160, .10], high: [150, 155, .04] });
  const finite = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
  function deadline(record) {
    if (!record || !Number.isFinite(record.createdAt)) return 0;
    return Math.min(record.createdAt + M.MAX_RETENTION, Number.isFinite(record.expiresAt) ? record.expiresAt : Infinity);
  }
  function checkedBinding(state, contextKey, now) {
    let ids; try { ids = JSON.parse(contextKey); } catch { throw new Error('기록할 학생·수업 연결을 확인해 주세요.'); }
    if (!Array.isArray(ids) || ids.length !== 4 || !ids.every(id => typeof id === 'string' && UUID.test(id))) throw new Error('기록할 학생·수업 연결을 확인해 주세요.');
    const binding = state.binding;
    if (!binding || FIELDS.some((field, index) => binding[field] !== ids[index])) throw new Error('학생·수업 연결이 바뀌어 기록하지 않았어요.');
    const parents = [M.get(state, 'classes', ids[0]), M.get(state, 'students', ids[1], ids[0]), M.get(state, 'lessons', ids[2], ids[0]), M.get(state, 'devices', ids[3], ids[0])];
    if (parents.some(item => item.pendingDelete || item.deletedAt || deadline(item) <= now)) throw new Error('학생·수업·기기의 연결이 만료되었어요.');
    return { ids, expiresAt: Math.min(...parents.map(deadline)), notBefore: Math.max(...parents.map(parent => parent.createdAt)) };
  }
  function validEvidence(event, now) {
    const t = event?.thresholds;
    const level = LEVELS[event?.sensitivity];
    if (!event || typeof event.id !== 'string' || !UUID.test(event.id) || !finite(event.inputAt, now - M.MAX_RETENTION, now + 1000) ||
        !['left', 'right'].includes(event.side) || !['low', 'normal', 'high'].includes(event.sensitivity) || !finite(event.elbowAngle, 0, 180) ||
        event.ruleVersion !== 'basketball-shot-2d-v1' || !t || !finite(t.readyAngle, 0, 180) || !finite(t.shootAngle, 0, 180) || !finite(t.wristAboveEar, 0, 2) || !level || t.readyAngle !== level[0] || t.shootAngle !== level[1] || t.wristAboveEar !== level[2] || event.elbowAngle < t.shootAngle - 5 || event.wristToEar < t.wristAboveEar - .04 ||
        event.fullBodyUsable !== true || !finite(event.wristToEar, -10, 10) || !finite(event.wristToShoulder, -10, 10) || !finite(event.minVisibility, .6, 1) || (event.minPresence !== null && !finite(event.minPresence, .6, 1)) ||
        typeof event.modelVersion !== 'string' || !/^[a-z0-9.-]{1,120}$/i.test(event.modelVersion) ||
        !Number.isInteger(event.frameWidth) || event.frameWidth < 1 || event.frameWidth > 320 || !Number.isInteger(event.frameHeight) || event.frameHeight < 1 || event.frameHeight > 4096) throw new Error('동작 기록의 근거를 확인할 수 없어요.');
  }
  function add(state, event, now = Date.now()) {
    if (!Number.isFinite(now)) throw new Error('기록 시각을 확인해 주세요.');
    validEvidence(event, now);
    const { ids, expiresAt, notBefore } = checkedBinding(state, event.contextKey, now);
    if (event.inputAt < notBefore) throw new Error('연결 이전의 동작은 기록할 수 없어요.');
    const record = { id: event.id, classId: ids[0], studentId: ids[1], lessonId: ids[2], deviceId: ids[3], inputAt: event.inputAt,
      side: event.side, sensitivity: event.sensitivity, elbowAngle: event.elbowAngle, ruleVersion: event.ruleVersion,
      thresholds: { readyAngle: event.thresholds.readyAngle, shootAngle: event.thresholds.shootAngle, wristAboveEar: event.thresholds.wristAboveEar },
      fullBodyUsable: true, wristToEar: event.wristToEar, wristToShoulder: event.wristToShoulder, minVisibility: event.minVisibility, minPresence: event.minPresence, modelVersion: event.modelVersion, frameWidth: event.frameWidth, frameHeight: event.frameHeight };
    if (state.shotAttempts !== undefined && !Array.isArray(state.shotAttempts)) throw new Error('동작 기록을 읽을 수 없어요.');
    const records = state.shotAttempts = (state.shotAttempts || []).filter(item => deadline(item) > now);
    const existing = records.find(item => item.id === record.id);
    if (existing) {
      const same = Object.keys(record).every(key => JSON.stringify(existing[key]) === JSON.stringify(record[key]));
      if (!same) throw new Error('이미 사용한 동작 기록 번호예요.');
      return existing;
    }
    if (records.length >= MAX_ATTEMPTS) throw new Error('동작 기록이 가득 찼어요. 기존 기록을 삭제해 주세요.');
    record.createdAt = now; record.expiresAt = Math.min(expiresAt, now + M.MAX_RETENTION, event.inputAt + M.MAX_RETENTION);
    if (record.expiresAt <= now) throw new Error('동작 기록의 보관 기간이 지났어요.');
    records.push(record); return record;
  }
  function parentsActive(state, record, now) {
    const cls = state.classes.find(item => item.id === record.classId);
    if (!cls || cls.pendingDelete || cls.deletedAt || deadline(cls) <= now) return false;
    return ['students', 'lessons', 'devices'].every((type, index) => {
      const key = ['studentId', 'lessonId', 'deviceId'][index];
      const item = state[type].find(parent => parent.id === record[key] && parent.classId === record.classId);
      return item && !item.deletedAt && !item.pendingDelete && deadline(item) > now;
    });
  }
  function list(state, scope, now = Date.now()) {
    if (!scope || !['classId', 'studentId', 'lessonId'].every(field => typeof scope[field] === 'string' && UUID.test(scope[field]))) throw new Error('학급·학생·수업을 선택해 주세요.');
    return (state.shotAttempts || []).filter(item => item.classId === scope.classId && item.studentId === scope.studentId && item.lessonId === scope.lessonId && deadline(item) > now && parentsActive(state, item, now)).map(item => structuredClone(item));
  }
  function remove(state, id) {
    if (!UUID.test(id || '')) throw new Error('동작 기록을 찾을 수 없어요.');
    const records = state.shotAttempts || [];
    const index = records.findIndex(item => item.id === id);
    if (index < 0) return false;
    records.splice(index, 1); return true;
  }
  function linkClip(state, id, clip, now = Date.now()) {
    const record = (state.shotAttempts || []).find(item => item.id === id);
    if (!record || deadline(record) <= now || !parentsActive(state, record, now)) throw new Error('동작 기록을 찾을 수 없어요.');
    if (!clip || !UUID.test(clip.id || '') || FIELDS.some(field => clip[field] !== record[field]) || !Number.isFinite(clip.expiresAt) || clip.expiresAt <= now) throw new Error('같은 학생·수업·기기의 유효한 클립을 선택해 주세요.');
    if (record.clipId && record.clipId !== clip.id) throw new Error('이미 연결된 클립이 있어요.');
    record.clipId = clip.id; record.expiresAt = Math.min(record.expiresAt, clip.expiresAt); return record;
  }
  const api = { add, list, remove, linkClip, MAX_ATTEMPTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ShotHistory = api;
})(globalThis);
