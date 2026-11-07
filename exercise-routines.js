(function (root) {
  'use strict';

  const PHASES = Object.freeze({ stretching: 180, strength: 360, movement: 360 });
  const activities = [
    ['stretch-reach', 'stretching', '천천히 뻗기', '팔과 다리를 편안한 범위에서 천천히 뻗고 풀기를 반복한다.', 'flexibility', 'easy', '움직일 공간', '통증이 있으면 멈추고 반동을 주지 않는다.'],
    ['stretch-side', 'stretching', '옆으로 기울이기', '서서 몸을 편안한 범위에서 좌우로 천천히 기울인다.', 'flexibility', 'easy', '움직일 공간', '균형을 유지하고 통증이 있으면 멈춘다.'],
    ['strength-chair', 'strength', '의자 앉았다 일어서기', '안정된 의자에 천천히 앉았다가 일어서며 필요할 때 쉰다.', 'strength', 'moderate', '움직이지 않는 의자', '의자가 미끄러지지 않도록 확인하고 통증이 있으면 멈춘다.'],
    ['strength-wall', 'strength', '벽 밀기', '벽을 마주 보고 손으로 벽을 천천히 밀고 돌아온다.', 'strength', 'moderate', '튼튼한 벽', '손이 미끄러지지 않게 하고 통증이 있으면 멈춘다.'],
    ['move-walk', 'movement', '방향 바꾸어 걷기', '정해진 공간에서 걸으며 교사의 신호에 따라 방향을 바꾼다.', 'endurance', 'easy', '장애물이 없는 공간', '다른 사람과 간격을 두고 걸으며 충돌을 피한다.'],
    ['move-steps', 'movement', '발걸음 따라 하기', '교사가 정한 간단한 발걸음을 제자리에서 따라 한다.', 'coordination', 'easy', '장애물이 없는 공간', '서로 간격을 두고 어지럽거나 아프면 멈춘다.'],
  ].map(([id, phase, title, instructions, fitnessTarget, difficulty, equipment, safetyNotes]) => ({
    id, phase, title, instructions, fitnessTarget, difficulty, seconds: PHASES[phase],
    suitability: 'teacher-review-required', equipment, safetyNotes,
    safetyStatus: 'teacher-review-required', media: null,
  }));

  function freeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    return value;
  }
  const ACTIVITIES = freeze(activities);
  const nonempty = value => typeof value === 'string' && value.trim().length > 0;
  function validateCatalog(catalog) {
    if (!Array.isArray(catalog) || !catalog.length) throw new Error('A non-empty activity catalog is required');
    const ids = new Set();
    for (const item of catalog) {
      if (!item || typeof item !== 'object' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.id || '') || ids.has(item.id)) throw new Error('Invalid or duplicate activity ID');
      ids.add(item.id);
      if (!Object.hasOwn(PHASES, item.phase) || !Number.isSafeInteger(item.seconds) || item.seconds !== PHASES[item.phase]) throw new Error('Invalid phase or duration');
      if (!['title', 'instructions', 'fitnessTarget', 'equipment', 'safetyNotes'].every(key => nonempty(item[key])) || !['easy', 'moderate', 'hard'].includes(item.difficulty)) throw new Error('Incomplete activity');
      if (item.suitability !== 'teacher-review-required' || item.safetyStatus !== 'teacher-review-required' || item.media !== null) throw new Error('Unsafe or unsupported activity');
    }
    return true;
  }
  function buildRoutine({ selections, approvals, catalog = ACTIVITIES } = {}) {
    validateCatalog(catalog);
    if (!selections || typeof selections !== 'object' || Array.isArray(selections) || Object.keys(selections).length !== 3 || !Object.keys(PHASES).every(phase => Object.hasOwn(selections, phase))) throw new Error('Select one activity per phase');
    if (!Array.isArray(approvals)) throw new Error('Teacher approvals are required');
    const approved = new Set();
    for (const approval of approvals) {
      if (!approval || !nonempty(approval.id) || approved.has(approval.id) || approval.approved !== true || approval.safetyReviewed !== true || approval.suitabilityReviewed !== true || !catalog.some(item => item.id === approval.id)) throw new Error('Invalid teacher approval');
      approved.add(approval.id);
    }
    const fields = ['id', 'phase', 'title', 'instructions', 'fitnessTarget', 'difficulty', 'seconds', 'suitability', 'equipment', 'safetyNotes', 'safetyStatus', 'media'];
    const eligible = catalog.filter(item => approved.has(item.id)).map(item => Object.fromEntries(fields.map(key => [key, item[key]])));
    const steps = Object.keys(PHASES).map(phase => {
      const item = eligible.find(candidate => candidate.id === selections[phase] && candidate.phase === phase);
      if (!item) throw new Error('Selected activity must be approved for its phase');
      return item;
    });
    if (new Set(steps.map(item => item.id)).size !== 3 || steps.reduce((sum, item) => sum + item.seconds, 0) !== 900) throw new Error('Invalid routine');
    return freeze({ steps, eligible, totalSeconds: 900 });
  }
  function createPlayer(options) {
    const routine = buildRoutine(options);
    let index = 0;
    let remainingSeconds = routine.steps[0].seconds;
    let status = 'paused';
    let current = routine.steps[0];
    function advance() {
      index += 1;
      if (index === routine.steps.length) { status = 'complete'; current = null; remainingSeconds = 0; }
      else { current = routine.steps[index]; remainingSeconds = current.seconds; }
    }
    function snapshot() { return freeze({ status, index, current, remainingSeconds, totalSeconds: routine.totalSeconds }); }
    return Object.freeze({
      getState: snapshot,
      pause() { if (status === 'running') status = 'paused'; return snapshot(); },
      resume() { if (status === 'paused') status = 'running'; return snapshot(); },
      skip() { if (status !== 'complete') advance(); return snapshot(); },
      alternate(id) {
        if (status === 'complete') throw new Error('Routine is complete');
        const alternate = routine.eligible.find(item => item.id === id && item.phase === current.phase && item.seconds === current.seconds);
        if (!alternate) throw new Error('Alternate must be approved for this phase');
        current = alternate;
        return snapshot();
      },
      tick(seconds) {
        if (!Number.isSafeInteger(seconds) || seconds < 0) throw new Error('Elapsed seconds must be a non-negative integer');
        if (status === 'running') {
          while (seconds > 0 && status === 'running') {
            const elapsed = Math.min(seconds, remainingSeconds);
            remainingSeconds -= elapsed;
            seconds -= elapsed;
            if (remainingSeconds === 0) advance();
          }
        }
        return snapshot();
      },
    });
  }
  const api = Object.freeze({ PHASES, ACTIVITIES, validateCatalog, buildRoutine, createPlayer });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ExerciseRoutines = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
