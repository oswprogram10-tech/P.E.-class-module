(function (root) {
  'use strict';
  const DURATION_MS = 40 * 60 * 1000;
  const STORAGE_KEY = 'pe-loop-device-check-v1';
  const CHECKS = Object.freeze({
    placement: '학교 사용 장소의 거치·충전선·이동 동선이 안전함',
    visibility: '실제 조명과 거리에서 전신·지연 영상을 알아볼 수 있음',
    controls: '가로·세로 회전, 키보드 입력, 저장·닫기 버튼을 사용할 수 있음',
    clips: '테스트 클립 저장과 교사 PIN 목록 재생을 확인함',
    offline: '사용 장소의 접속과 오프라인 재실행·저장·재생을 확인함',
  });
  const HEAT = Object.freeze({ normal: '평소와 비슷함', warm: '따뜻하지만 사용에 지장 없음', hot: '너무 뜨겁거나 온도 경고·성능 저하가 있음' });
  const STATUSES = Object.freeze({ pending: '점검 전', deferred: '나중에 점검', running: '40분 연속 촬영 점검 중', interrupted: '연속 촬영 점검 중단', ready: '40분 촬영 완료 · 교사 확인 필요', incomplete: '미확인 항목 있음', failed: '문제 발견 · 재점검 필요', passed: '교사 기기·현장 점검 완료' });
  const copy = value => JSON.parse(JSON.stringify(value));
  function initial() {
    return { schemaVersion: 1, status: 'pending', model: '', userAgent: '', checks: Object.fromEntries(Object.keys(CHECKS).map(id => [id, 'pending'])), thermal: [], elapsedMs: 0, startedAt: null, completedAt: null, reviewedAt: null, reason: '', peakFrames: 0, peakBytes: 0, maxBufferMs: 0 };
  }
  class Session {
    constructor(saved = null) {
      this.state = initial(); this.startedMono = null; this.lastTick = null;
      if (!saved || saved.schemaVersion !== 1 || !Object.hasOwn(STATUSES, saved.status)) return;
      const s = this.state;
      for (const key of ['model', 'userAgent', 'reason']) if (typeof saved[key] === 'string') s[key] = saved[key].slice(0, key === 'userAgent' ? 512 : 160);
      for (const key of ['elapsedMs', 'peakFrames', 'peakBytes', 'maxBufferMs']) if (Number.isFinite(saved[key]) && saved[key] >= 0) s[key] = saved[key];
      s.elapsedMs = Math.min(s.elapsedMs, DURATION_MS);
      for (const key of ['startedAt', 'completedAt', 'reviewedAt']) if (Number.isFinite(saved[key]) && saved[key] > 0) s[key] = saved[key];
      for (const id of Object.keys(CHECKS)) if (['pending', 'pass', 'fail'].includes(saved.checks?.[id])) s.checks[id] = saved.checks[id];
      s.thermal = (Array.isArray(saved.thermal) ? saved.thermal : []).filter(row => row && Object.hasOwn(HEAT, row.value) && Number.isFinite(row.at) && Number.isFinite(row.elapsedMs) && row.elapsedMs >= 0 && row.elapsedMs <= DURATION_MS).slice(-50).map(row => ({ value: row.value, at: row.at, elapsedMs: row.elapsedMs }));
      s.status = saved.status;
      if (s.status === 'running') { s.status = 'interrupted'; s.completedAt = null; s.reason = '앱이 닫히거나 새로 열려 연속 촬영을 확인할 수 없어요. 처음부터 다시 점검해 주세요.'; }
      if (s.completedAt && s.elapsedMs !== DURATION_MS) s.completedAt = null;
      if (s.status === 'passed' && !this.canPass()) s.status = 'incomplete';
      if (s.status === 'ready' && !s.completedAt) s.status = 'incomplete';
    }
    snapshot() { return copy(this.state); }
    start({ model, userAgent = '', heat }, now, wallTime) {
      if (typeof model !== 'string' || !model.trim() || model.trim().length > 80) throw new Error('기기 모델명을 80자 이내로 입력해 주세요.');
      if (!['normal', 'warm'].includes(heat)) throw new Error('시작 전 발열을 확인해 주세요. 너무 뜨거우면 식힌 뒤 점검하세요.');
      if (!Number.isFinite(now) || !Number.isFinite(wallTime)) throw new Error('점검 시각을 확인하지 못했어요.');
      this.state = { ...initial(), status: 'running', model: model.trim(), userAgent: userAgent.slice(0, 512), startedAt: wallTime, thermal: [{ value: heat, at: wallTime, elapsedMs: 0 }] };
      this.startedMono = now; this.lastTick = now;
    }
    observe({ now, wallTime, active, visible, frameAt, frames = 0, bytes = 0, bufferMs = 0 }) {
      const s = this.state;
      if (s.status !== 'running') return;
      if (!active || !visible) return this.interrupt('촬영 또는 화면 표시가 중단됐어요. 40분 점검은 처음부터 다시 시작해 주세요.');
      if (!Number.isFinite(now) || now < this.lastTick || now - this.lastTick > 5000) return this.interrupt('앱 응답이 오래 멈춰 연속 사용을 확인할 수 없어요. 다시 점검해 주세요.');
      if (!Number.isFinite(frameAt) || frameAt > now || now - frameAt > 2500) return this.interrupt('새 카메라 프레임이 들어오지 않아 점검을 중단했어요.');
      this.lastTick = now;
      s.elapsedMs = Math.min(DURATION_MS, now - this.startedMono);
      for (const [key, value] of [['peakFrames', frames], ['peakBytes', bytes], ['maxBufferMs', bufferMs]]) if (Number.isFinite(value) && value >= 0) s[key] = Math.max(s[key], value);
      if (s.elapsedMs >= DURATION_MS) { s.status = 'ready'; s.completedAt = wallTime; s.reason = '마지막 발열 상태와 학교 환경 항목을 확인한 뒤 결과를 저장해 주세요.'; }
    }
    interrupt(reason) {
      if (this.state.status !== 'running') return;
      this.state.status = 'interrupted'; this.state.completedAt = null; this.state.reason = reason;
      this.startedMono = null; this.lastTick = null;
    }
    recordHeat(value, wallTime) {
      if (!this.state.startedAt || !['running', 'ready', 'incomplete', 'passed'].includes(this.state.status) || !Object.hasOwn(HEAT, value) || !Number.isFinite(wallTime)) throw new Error('점검 시작 후 발열 상태를 선택해 주세요.');
      this.state.thermal.push({ value, at: wallTime, elapsedMs: this.state.elapsedMs });
      if (this.state.thermal.length > 50) this.state.thermal.splice(1, this.state.thermal.length - 50);
      if (value === 'hot') { this.state.status = 'failed'; this.state.reason = '발열 문제를 기록했어요. 촬영을 멈추고 기기를 식힌 뒤 다시 점검해 주세요.'; }
      else if (this.state.status === 'passed') { this.state.status = 'ready'; this.state.reviewedAt = null; }
    }
    setCheck(id, value) {
      if (!Object.hasOwn(CHECKS, id) || !['pending', 'pass', 'fail'].includes(value)) throw new Error('점검 항목을 확인해 주세요.');
      this.state.checks[id] = value;
      if (this.state.status === 'passed') { this.state.status = 'ready'; this.state.reviewedAt = null; }
    }
    canPass() {
      const s = this.state;
      return Boolean(s.completedAt && s.elapsedMs === DURATION_MS && s.thermal.some(row => row.elapsedMs === 0) && s.thermal.some(row => row.elapsedMs === DURATION_MS) && !s.thermal.some(row => row.value === 'hot') && Object.values(s.checks).every(value => value === 'pass'));
    }
    review(wallTime) {
      const s = this.state;
      if (s.status === 'running') throw new Error('연속 촬영 점검이 끝난 뒤 결과를 확인해 주세요.');
      s.reviewedAt = wallTime;
      if (s.thermal.some(row => row.value === 'hot') || Object.values(s.checks).includes('fail')) { s.status = 'failed'; s.reason = '문제가 있는 항목을 해결한 뒤 다시 점검해 주세요.'; }
      else if (this.canPass()) { s.status = 'passed'; s.reason = '이 기기와 사용 장소에서 교사가 확인한 결과예요. 기기·브라우저·장소가 바뀌면 다시 점검해 주세요.'; }
      else { s.status = 'incomplete'; s.reason = !s.completedAt ? '40분 연속 촬영이 아직 완료되지 않았어요.' : '40분 종료 후 발열 관찰과 모든 학교 환경 항목을 확인해 주세요.'; }
    }
    defer() { this.interrupt('교사가 점검을 중단했어요. 다시 시작할 때 40분을 새로 측정해요.'); if (!this.state.completedAt && this.state.status !== 'failed') this.state.status = 'deferred'; }
  }
  const api = Object.freeze({ DURATION_MS, STORAGE_KEY, CHECKS, HEAT, STATUSES, Session });
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.DeviceCheck = api;
})(globalThis);
