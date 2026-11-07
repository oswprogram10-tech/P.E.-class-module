(function (root) {
  'use strict';
  const DAY = 86400000;
  const MAX_RETENTION = 7 * DAY;
  const TYPES = ['classes', 'students', 'lessons', 'groups', 'devices', 'reflections', 'submissions', 'notes', 'feedback', 'measurements'];
  const MEASUREMENT_ITEMS = [
    { id: 'shuttle-run', name: '왕복 오래달리기', unit: '회', min: 0, max: 300, precision: 0 },
    { id: 'sit-and-reach', name: '앉아 윗몸 앞으로 굽히기', unit: 'cm', min: -50, max: 100, precision: 1 },
    { id: 'sit-ups', name: '윗몸 말아 올리기', unit: '회', min: 0, max: 300, precision: 0 },
    { id: 'standing-long-jump', name: '제자리멀리뛰기', unit: 'cm', min: 0, max: 400, precision: 1 },
    { id: 'grip-strength', name: '악력', unit: 'kg', min: 0, max: 100, precision: 1 },
  ];
  const PAPS_GRADE_GROUPS = new Set(['elementary-3', 'elementary-4', 'elementary-5', 'elementary-6', 'middle-1', 'middle-2', 'middle-3', 'high-1', 'high-2', 'high-3']);
  const PAPS_TARGET_GROUPS = new Set(['male', 'female']);
  const MISSING_REASONS = [
    { id: 'not-measured', name: '미측정' },
    { id: 'absent', name: '결시' },
    { id: 'unable', name: '수행할 수 없음' },
    { id: 'declined', name: '학생이 중단/거부함' },
    { id: 'measurement-error', name: '측정 오류' },
    { id: 'other', name: '기타' },
  ];
  const id = () => crypto.randomUUID();
  const TOOL_TYPES = ['rubrics', 'assessments', 'reports', 'exerciseApprovals', 'tacticsBoards', 'qrMissionStores'];
  function createState() { return { version: 1, classes: [], students: [], lessons: [], groups: [], devices: [], reflections: [], submissions: [], notes: [], feedback: [], measurements: [], outbox: [], shotAttempts: [], rubrics: [], assessments: [], reports: [], exerciseApprovals: [], tacticsBoards: [], qrMissionStores: [] }; }
  function text(value, max = 200) { const s = String(value || '').trim(); if (!s || s.length > max) throw new Error('내용을 확인해 주세요.'); return s; }
  function get(state, type, key, classId) { const value = state[type]?.find(item => item.id === key && (!classId || item.classId === classId)); if (!value) throw new Error('선택한 항목을 찾을 수 없어요.'); return value; }
  function schoolYearForDate(date) { const [year, month] = date.split('-').map(Number); return month < 3 ? year - 1 : year; }
  function measurementCriteria(data) {
    const values = [data.criteriaGradeGroupId, data.criteriaTargetGroupId, data.criteriaSourceVersion]
      .map(value => value === undefined || value === null || value === '' ? null : value);
    if (values.every(value => value === null)) return { criteriaGradeGroupId: null, criteriaTargetGroupId: null, criteriaSourceVersion: null };
    const [gradeGroupId, targetGroupId, criteriaSourceVersion] = values;
    if (!gradeGroupId || !targetGroupId || !criteriaSourceVersion) throw new Error('공식 등급 기준을 기록하려면 학년·평가표 구분·기준 버전을 모두 확인해 주세요.');
    if (!PAPS_GRADE_GROUPS.has(gradeGroupId) || !PAPS_TARGET_GROUPS.has(targetGroupId) || typeof criteriaSourceVersion !== 'string' || !criteriaSourceVersion.trim() || criteriaSourceVersion.length > 120) {
      throw new Error('공식 등급 기준 범위를 확인해 주세요.');
    }
    return { criteriaGradeGroupId: gradeGroupId, criteriaTargetGroupId: targetGroupId, criteriaSourceVersion };
  }
  function validMeasurementData(state, classId, data) {
    const student = get(state, 'students', data.studentId, classId);
    const item = MEASUREMENT_ITEMS.find(entry => entry.id === data.itemId);
    if (!item) throw new Error('지원하지 않는 체력 측정 종목입니다.');
    if (!Number.isInteger(data.schoolYear) || data.schoolYear < 2000 || data.schoolYear > 2100) throw new Error('학년도를 확인해 주세요.');
    if (typeof data.measuredOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.measuredOn)) throw new Error('측정일을 확인해 주세요.');
    const measuredTimestamp = Date.parse(`${data.measuredOn}T00:00:00Z`);
    if (!Number.isFinite(measuredTimestamp) || new Date(measuredTimestamp).toISOString().slice(0, 10) !== data.measuredOn) throw new Error('측정일을 확인해 주세요.');
    if (schoolYearForDate(data.measuredOn) !== data.schoolYear) throw new Error('측정일과 학년도가 맞지 않아요. (학년도는 3월에 시작합니다.)');
    if (data.unit !== item.unit) throw new Error('종목의 단위를 확인해 주세요.');
    let value = null, missingReason = null;
    if (data.value === null) {
      missingReason = MISSING_REASONS.find(reason => reason.id === data.missingReason)?.id;
      if (!missingReason) throw new Error('측정값이 없으면 결측 이유를 선택해 주세요.');
    } else {
      if (data.missingReason) throw new Error('측정값과 결측 이유를 함께 입력할 수 없어요.');
      if (typeof data.value !== 'number' || !Number.isFinite(data.value) || data.value < item.min || data.value > item.max) throw new Error(`측정값은 ${item.min}~${item.max} ${item.unit} 범위로 입력해 주세요.`);
      const scale = 10 ** item.precision;
      if (Math.abs(data.value * scale - Math.round(data.value * scale)) > 1e-8) throw new Error(`${item.precision === 0 ? '정수' : '소수 첫째 자리까지'} 입력해 주세요.`);
      value = data.value;
    }
    const missingNote = String(data.missingNote || '').trim();
    if (missingNote.length > 120) throw new Error('결측 메모는 120자 이내로 입력해 주세요.');
    if (missingReason === 'other' && !missingNote) throw new Error('결측 이유가 기타이면 메모를 입력해 주세요.');
    if (value !== null && missingNote) throw new Error('결측 메모는 측정값이 없을 때만 입력할 수 있어요.');
    const criteria = measurementCriteria(data);
    return { student, item, schoolYear: data.schoolYear, measuredOn: data.measuredOn, value, unit: item.unit, missingReason, missingNote, ...criteria };
  }
  function measurementSnapshot(record) {
    return {
      schoolYear: record.schoolYear, measuredOn: record.measuredOn, itemId: record.itemId,
      value: record.value, unit: record.unit, missingReason: record.missingReason, missingNote: record.missingNote,
      criteriaGradeGroupId: record.criteriaGradeGroupId || null,
      criteriaTargetGroupId: record.criteriaTargetGroupId || null,
      criteriaSourceVersion: record.criteriaSourceVersion || null,
    };
  }
  function add(state, type, data) {
    if (!TYPES.includes(type)) throw new Error('지원하지 않는 항목입니다.');
    const classId = type === 'classes' ? null : data.classId;
    if (classId) get(state, 'classes', classId); else if (type !== 'classes') throw new Error('학급을 선택해 주세요.');
    const now = Date.now();
    const record = { ...data, id: id(), createdAt: now };
    if (type === 'measurements') {
      const checked = validMeasurementData(state, classId, data);
      const retentionExpiresAt = Date.UTC(checked.schoolYear + 3, 2, 1);
      if (retentionExpiresAt <= now) throw new Error('이 학년도의 기록 보관 기간이 지나 저장할 수 없어요.');
      Object.assign(record, {
        studentId: checked.student.id, schoolYear: checked.schoolYear, measuredOn: checked.measuredOn,
        itemId: checked.item.id, value: checked.value, unit: checked.unit,
        missingReason: checked.missingReason, missingNote: checked.missingNote,
        criteriaGradeGroupId: checked.criteriaGradeGroupId, criteriaTargetGroupId: checked.criteriaTargetGroupId,
        inputAt: now, modifiedAt: null, changeHistory: [], criteriaSourceVersion: checked.criteriaSourceVersion,
        retentionExpiresAt,
      });
      delete record.expiresAt;
    } else {
      record.expiresAt = Math.min(Number.isFinite(data.expiresAt) ? data.expiresAt : record.createdAt + MAX_RETENTION, record.createdAt + MAX_RETENTION);
      if (record.expiresAt <= record.createdAt) throw new Error('보관 기간을 확인해 주세요.');
    }
    if (['classes', 'students', 'lessons', 'groups', 'devices'].includes(type)) record.name = text(data.name, 100);
    if (type === 'lessons') { record.sport = text(data.sport, 100); record.unit = text(data.unit, 100); }
    if (type === 'students' && data.groupId) get(state, 'groups', data.groupId, classId);
    if (['reflections', 'submissions', 'notes'].includes(type)) { get(state, 'students', data.studentId, classId); get(state, 'lessons', data.lessonId, classId); }
    if (type === 'reflections') { record.clipId = text(data.clipId, 100); record.good = String(data.good || '').slice(0, 1000); record.retry = String(data.retry || '').slice(0, 1000); }
    if (type === 'notes' || type === 'feedback') record.text = text(data.text, 1000);
    if (type === 'feedback') { get(state, 'lessons', data.lessonId, classId); if (data.studentId) get(state, 'students', data.studentId, classId); record.hidden = false; }
    if (type === 'submissions') {
      record.clipId = text(data.clipId, 100);
      if (data.reflectionId) { const reflection = get(state, 'reflections', data.reflectionId, classId); if (reflection.studentId !== data.studentId || reflection.lessonId !== data.lessonId || reflection.clipId !== data.clipId) throw new Error('성찰과 제출 장면이 일치하지 않아요.'); }
      if (state.submissions.some(item => item.classId === classId && item.studentId === data.studentId && item.lessonId === data.lessonId && item.clipId === data.clipId && !item.deletedAt)) throw new Error('이미 제출한 장면입니다.');
      if (!Number.isFinite(data.clipExpiresAt) || data.clipExpiresAt <= record.createdAt) throw new Error('원본 장면의 보관 기간을 확인해 주세요.');
      record.expiresAt = Math.min(data.clipExpiresAt, record.createdAt + MAX_RETENTION); record.status = 'queued';
    }
    if (!Array.isArray(state[type])) state[type] = [];
    state[type].push(record); return record;
  }
  function updateMeasurement(state, measurementId, data, now = Date.now()) {
    const record = state.measurements?.find(item => item.id === measurementId);
    if (!record) throw new Error('선택한 측정 기록을 찾을 수 없어요.');
    if (data.classId !== record.classId || data.studentId !== record.studentId) throw new Error('기록의 학급과 학생은 수정할 수 없어요.');
    const checked = validMeasurementData(state, record.classId, data);
    if (checked.schoolYear !== record.schoolYear) throw new Error('학년도 변경은 삭제 후 다시 입력해 주세요.');
    const before = measurementSnapshot(record);
    const after = measurementSnapshot({ ...checked, itemId: checked.item.id });
    if (JSON.stringify(before) === JSON.stringify(after)) throw new Error('변경된 측정 내용이 없어요.');
    if (!Array.isArray(record.changeHistory)) record.changeHistory = [];
    record.changeHistory.push({ id: id(), changedAt: now, actor: 'teacher', before, after });
    Object.assign(record, after, { modifiedAt: now });
    return record;
  }
  function removeMeasurement(state, measurementId, classId) {
    if (!Array.isArray(state.measurements)) state.measurements = [];
    const index = state.measurements.findIndex(item => item.id === measurementId && (!classId || item.classId === classId));
    if (index < 0) throw new Error('선택한 측정 기록을 찾을 수 없어요.');
    return state.measurements.splice(index, 1)[0];
  }
  function enqueue(state, classId, kind, payload, operationId = id(), now = Date.now()) {
    get(state, 'classes', classId);
    if (!['submit', 'delete', 'feedback'].includes(kind)) throw new Error('지원하지 않는 전송입니다.');
    const existing = state.outbox.find(item => item.id === operationId); if (existing) return existing;
    const item = { id: operationId, classId, kind, payload, status: 'queued', attempts: 0, createdAt: now }; state.outbox.push(item); return item;
  }
  function expire(state, now = Date.now()) {
    for (const type of ['measurements', ...TOOL_TYPES]) if (!Array.isArray(state[type])) state[type] = [];
    const deadline = item => Math.min(Number.isFinite(item.expiresAt) ? item.expiresAt : Infinity, Number.isFinite(item.createdAt) ? item.createdAt + MAX_RETENTION : 0);
    const activeMeasurements = state.measurements.filter(item => {
      const classroom = state.classes.find(parent => parent.id === item.classId);
      const student = state.students.find(parent => parent.id === item.studentId && parent.classId === item.classId);
      return Number.isFinite(item.retentionExpiresAt) && item.retentionExpiresAt > now && classroom && !classroom.pendingDelete && !classroom.deletedAt && student && !student.pendingDelete && !student.deletedAt;
    });
    const activeAssessments = state.assessments.filter(item => {
      const classroom = state.classes.find(parent => parent.id === item.classId);
      const student = state.students.find(parent => parent.id === item.studentId && parent.classId === item.classId);
      return Number.isFinite(item.retentionExpiresAt) && item.retentionExpiresAt > now && classroom && !classroom.pendingDelete && !classroom.deletedAt && student && !student.pendingDelete && !student.deletedAt;
    });
    const protectedClasses = new Set([...activeMeasurements, ...activeAssessments].map(item => item.classId));
    const protectedStudents = new Set([...activeMeasurements, ...activeAssessments].map(item => item.studentId));
    const expiredClasses = new Set(state.classes.filter(item => deadline(item) <= now && !protectedClasses.has(item.id)).map(item => item.id));
    const expiredStudents = new Set(state.students.filter(item => expiredClasses.has(item.classId) || (deadline(item) <= now && !protectedStudents.has(item.id))).map(item => item.id));
    const expiredLessons = new Set(state.lessons.filter(item => expiredClasses.has(item.classId) || deadline(item) <= now).map(item => item.id));
    const expired = state.submissions.filter(item => !item.deletedAt && (deadline(item) <= now || expiredClasses.has(item.classId) || expiredStudents.has(item.studentId) || expiredLessons.has(item.lessonId)));
    for (const item of expired) { removeClip(state, item.clipId, now); delete item.clipData; }
    for (const type of ['classes', 'students', 'lessons', 'groups', 'devices', 'reflections', 'notes', 'feedback']) state[type] = state[type].filter(item => {
      const heldByLongLivedRecord = type === 'classes' ? protectedClasses.has(item.id) : type === 'students' ? protectedStudents.has(item.id) : false;
      return (deadline(item) > now || heldByLongLivedRecord) && !expiredClasses.has(type === 'classes' ? item.id : item.classId) && (!item.studentId || !expiredStudents.has(item.studentId)) && (!item.lessonId || !expiredLessons.has(item.lessonId));
    });
    state.measurements = state.measurements.filter(item => {
      const classroom = state.classes.find(parent => parent.id === item.classId);
      const student = state.students.find(parent => parent.id === item.studentId && parent.classId === item.classId);
      return Number.isFinite(item.retentionExpiresAt) && item.retentionExpiresAt > now && classroom && !classroom.pendingDelete && !classroom.deletedAt && student && !student.pendingDelete && !student.deletedAt;
    });
    const retainedRubricIds = new Set(activeAssessments.map(item => item.rubricId));
    state.rubrics = state.rubrics.filter(item => state.classes.some(parent => parent.id === item.classId && !parent.pendingDelete && !parent.deletedAt) && (deadline(item) > now || retainedRubricIds.has(item.id)));
    state.assessments = state.assessments.filter(item => {
      const classroom = state.classes.find(parent => parent.id === item.classId);
      const student = state.students.find(parent => parent.id === item.studentId && parent.classId === item.classId);
      return Number.isFinite(item.retentionExpiresAt) && item.retentionExpiresAt > now && classroom && !classroom.pendingDelete && !classroom.deletedAt && student && !student.pendingDelete && !student.deletedAt;
    });
    const activeAssessmentIds = new Set(state.assessments.map(item => item.id));
    state.reports = state.reports.filter(item => {
      const classroom = state.classes.find(parent => parent.id === item.classId);
      const student = state.students.find(parent => parent.id === item.studentId && parent.classId === item.classId);
      return Number.isFinite(item.retentionExpiresAt) && item.retentionExpiresAt > now && classroom && !classroom.pendingDelete && !classroom.deletedAt && student && !student.pendingDelete && !student.deletedAt && item.assessmentIds?.every(id => activeAssessmentIds.has(id));
    });
    state.exerciseApprovals = state.exerciseApprovals.filter(item => deadline(item) > now && state.classes.some(parent => parent.id === item.classId && !parent.pendingDelete && !parent.deletedAt));
    state.tacticsBoards = state.tacticsBoards.filter(item => deadline(item) > now && state.classes.some(parent => parent.id === item.classId && !parent.pendingDelete && !parent.deletedAt));
    state.qrMissionStores = state.qrMissionStores.filter(item => deadline(item) > now && state.classes.some(parent => parent.id === item.classId && !parent.pendingDelete && !parent.deletedAt));
    // Attempts disappear with any missing, expired, or deleted parent, including the device.
    if (Array.isArray(state.shotAttempts)) state.shotAttempts = state.shotAttempts.filter(item => {
      const classroom = state.classes.find(parent => parent.id === item.classId);
      return deadline(item) > now && classroom && !classroom.pendingDelete && !classroom.deletedAt &&
        ['students', 'lessons', 'devices'].every((type, index) => {
          const key = ['studentId', 'lessonId', 'deviceId'][index];
          const parent = state[type].find(entry => entry.id === item[key] && entry.classId === item.classId);
          return parent && !parent.pendingDelete && !parent.deletedAt && deadline(parent) > now;
        });
    });
    for (const student of state.students) if (student.groupId && !state.groups.some(group => group.id === student.groupId && group.classId === student.classId)) student.groupId = null;
    if (state.binding && (expiredClasses.has(state.binding.classId) || expiredStudents.has(state.binding.studentId) || expiredLessons.has(state.binding.lessonId) || !state.devices.some(item => item.id === state.binding.deviceId))) delete state.binding;
    for (const op of state.outbox.filter(item => item.kind !== 'delete' && (expiredClasses.has(item.classId) || (item.payload?.studentId && expiredStudents.has(item.payload.studentId)) || (item.payload?.lessonId && expiredLessons.has(item.payload.lessonId)) || (item.payload?.expiresAt && item.payload.expiresAt <= now)))) { if (op.status !== 'sent') op.status = 'cancelled'; if (op.payload) { delete op.payload.clipData; delete op.payload.text; delete op.payload.reflection; } }
    state.outbox = state.outbox.filter(item => Number.isFinite(item.createdAt) && item.createdAt + MAX_RETENTION > now);
    state.submissions = state.submissions.filter(item => !item.deletedAt || item.deletedAt + MAX_RETENTION > now);
    return expired;
  }
  function removeClip(state, clipId, now = Date.now()) {
    if (Array.isArray(state.shotAttempts)) state.shotAttempts = state.shotAttempts.filter(item => item.clipId !== clipId);
    for (const item of state.submissions.filter(entry => entry.clipId === clipId && !entry.deletedAt)) {
      item.deletedAt = now;
      delete item.clipData;
      for (const queued of state.outbox.filter(entry => entry.payload?.id === item.id && entry.kind === 'submit')) { if (queued.status !== 'sent') queued.status = 'cancelled'; delete queued.payload.clipData; delete queued.payload.reflection; }
      enqueue(state, item.classId, 'delete', { id: item.id, classId: item.classId }, id(), now);
    }
    state.reflections = state.reflections.filter(reflection => reflection.clipId !== clipId || state.submissions.some(item => !item.deletedAt && item.reflectionId === reflection.id));
  }
  const api = { createState, add, get, enqueue, expire, removeClip, updateMeasurement, removeMeasurement, DAY, MAX_RETENTION, MEASUREMENT_ITEMS, MISSING_REASONS, schoolYearForDate, TOOL_TYPES };
  if (typeof module !== 'undefined') module.exports = api; else root.ClassroomModel = api;
})(globalThis);
