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
    { id: 'sprint-50m', name: '50m 달리기', unit: '초', min: 0.01, max: 60, precision: 2, gradingDirection: 'lower' },
    { id: 'run-walk-1000m', name: '오래달리기-걷기 1,000m', unit: '초', min: 1, max: 3600, precision: 0, gradingDirection: 'lower', distanceMeters: 1000, requiresAssessmentScope: true },
    { id: 'run-walk-1200m', name: '오래달리기-걷기 1,200m', unit: '초', min: 1, max: 3600, precision: 0, gradingDirection: 'lower', distanceMeters: 1200, requiresAssessmentScope: true },
    { id: 'run-walk-1600m', name: '오래달리기-걷기 1,600m', unit: '초', min: 1, max: 3600, precision: 0, gradingDirection: 'lower', distanceMeters: 1600, requiresAssessmentScope: true },
    { id: 'step-test-pei', name: '스텝검사 PEI', unit: '점', min: 0, max: 200, precision: 1, requiresAssessmentScope: true },
    { id: 'push-ups', name: '팔굽혀펴기', unit: '회', min: 0, max: 300, precision: 0, requiresAssessmentScope: true },
    { id: 'knee-push-ups', name: '무릎대고 팔굽혀펴기', unit: '회', min: 0, max: 300, precision: 0, requiresAssessmentScope: true },
    { id: 'comprehensive-flexibility', name: '종합유연성', unit: '점', min: 0, max: 8, precision: 0, requiresAssessmentScope: true },
    { id: 'body-mass-index', name: 'BMI', unit: 'kg/m²', min: 0, max: 100, precision: 1, requiresAssessmentScope: true },
  ];
  const PAPS_GRADE_GROUPS = new Set(['elementary-3', 'elementary-4', 'elementary-5', 'elementary-6', 'middle-1', 'middle-2', 'middle-3', 'high-1', 'high-2', 'high-3']);
  const PAPS_TARGET_GROUPS = new Set(['male', 'female']);
  const ELEMENTARY_5_6 = new Set(['elementary-5', 'elementary-6']);
  const MIDDLE_HIGH = new Set(['middle-1', 'middle-2', 'middle-3', 'high-1', 'high-2', 'high-3']);
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
  function createState() { return { version: 1, classes: [], students: [], lessons: [], groups: [], devices: [], reflections: [], submissions: [], notes: [], feedback: [], measurements: [], papsSelections: [], outbox: [], shotAttempts: [], rubrics: [], assessments: [], reports: [], exerciseApprovals: [], tacticsBoards: [], qrMissionStores: [] }; }
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
  function isMeasurementScopeApplicable(itemId, gradeGroupId, targetGroupId) {
    const item = MEASUREMENT_ITEMS.find(entry => entry.id === itemId);
    if (!item) return false;
    if (!item.requiresAssessmentScope) return true;
    if (!PAPS_GRADE_GROUPS.has(gradeGroupId) || !PAPS_TARGET_GROUPS.has(targetGroupId)) return false;
    if (itemId === 'run-walk-1000m') return ELEMENTARY_5_6.has(gradeGroupId);
    if (itemId === 'run-walk-1200m') return MIDDLE_HIGH.has(gradeGroupId) && targetGroupId === 'female';
    if (itemId === 'run-walk-1600m') return MIDDLE_HIGH.has(gradeGroupId) && targetGroupId === 'male';
    if (itemId === 'step-test-pei') return !['elementary-3', 'elementary-4'].includes(gradeGroupId);
    if (itemId === 'push-ups') return MIDDLE_HIGH.has(gradeGroupId) && targetGroupId === 'male';
    if (itemId === 'knee-push-ups') return MIDDLE_HIGH.has(gradeGroupId) && targetGroupId === 'female';
    if (itemId === 'comprehensive-flexibility') return MIDDLE_HIGH.has(gradeGroupId);
    if (itemId === 'body-mass-index') return true;
    return false;
  }
  function calculateBmi(heightCm, weightKg) {
    if (![heightCm, weightKg].every(Number.isFinite) || heightCm < 50 || heightCm > 250 || weightKg < 5 || weightKg > 300 ||
      Math.abs(heightCm * 10 - Math.round(heightCm * 10)) > 1e-7 || Math.abs(weightKg * 10 - Math.round(weightKg * 10)) > 1e-7) {
      throw new Error('키는 50~250cm, 몸무게는 5~300kg 범위에서 소수 첫째 자리까지 입력해 주세요.');
    }
    const heightTenths = Math.round(heightCm * 10);
    const weightTenths = Math.round(weightKg * 10);
    const numerator = weightTenths * 1000000;
    const denominator = heightTenths * heightTenths;
    const bmiTenths = Math.floor(numerator / denominator) + (numerator % denominator === 0 ? 0 : 1);
    return bmiTenths / 10;
  }
  function measurementProtocol(itemId, gradeGroupId, targetGroupId) {
    const item = MEASUREMENT_ITEMS.find(entry => entry.id === itemId);
    if (!item || !isMeasurementScopeApplicable(itemId, gradeGroupId, targetGroupId)) return null;
    if (item.distanceMeters) return { distanceMeters: item.distanceMeters };
    if (itemId === 'step-test-pei') {
      if (ELEMENTARY_5_6.has(gradeGroupId)) return { stepBoxHeightCm: 20.3, cadencePerMinute: 24, durationMinutes: 3 };
      if (gradeGroupId.startsWith('middle-') || targetGroupId === 'female') return { stepBoxHeightCm: 45.7, cadencePerMinute: 24, durationMinutes: 3 };
      return { stepBoxHeightCm: 50.8, cadencePerMinute: 30, durationMinutes: 3 };
    }
    if (itemId === 'push-ups') return { barHeightCm: 30, barWidthMinCm: 110, chestClearanceMaxCm: 10, elbowAngleDegrees: 90 };
    if (itemId === 'knee-push-ups') return { chestClearanceMaxCm: 15, elbowAngleDegrees: 90, kneeSupported: true, handPlacement: 'shoulder width + one hand length forward, then two hand lengths outward' };
    if (itemId === 'comprehensive-flexibility') return { parts: ['shoulder', 'trunk', 'side', 'lower-body'], attemptsPerSide: 1, scorePerPartMax: 2, maxScore: 8 };
    return null;
  }
  function validMeasurementData(state, classId, data) {
    const student = get(state, 'students', data.studentId, classId);
    const item = MEASUREMENT_ITEMS.find(entry => entry.id === data.itemId);
    if (!item) throw new Error('지원하지 않는 체력 측정 종목입니다.');
    if (item.id === 'body-mass-index' && (data.studentConsentConfirmed !== true || data.guardianConsentConfirmed !== true)) {
      throw new Error('BMI 기록은 학생 본인과 보호자의 동의를 모두 확인한 뒤 저장해 주세요.');
    }
    if (!Number.isInteger(data.schoolYear) || data.schoolYear < 2000 || data.schoolYear > 2100) throw new Error('학년도를 확인해 주세요.');
    if (typeof data.measuredOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.measuredOn)) throw new Error('측정일을 확인해 주세요.');
    const measuredTimestamp = Date.parse(`${data.measuredOn}T00:00:00Z`);
    if (!Number.isFinite(measuredTimestamp) || new Date(measuredTimestamp).toISOString().slice(0, 10) !== data.measuredOn) throw new Error('측정일을 확인해 주세요.');
    if (schoolYearForDate(data.measuredOn) !== data.schoolYear) throw new Error('측정일과 학년도가 맞지 않아요. (학년도는 3월에 시작합니다.)');
    if (data.unit !== item.unit) throw new Error('종목의 단위를 확인해 주세요.');
    const assessmentGradeGroupId = data.assessmentGradeGroupId || data.criteriaGradeGroupId || null;
    const assessmentTargetGroupId = data.assessmentTargetGroupId || data.criteriaTargetGroupId || null;
    if (Boolean(assessmentGradeGroupId) !== Boolean(assessmentTargetGroupId)) throw new Error('측정 기준 학년과 평가표 구분을 모두 선택해 주세요.');
    if (assessmentGradeGroupId && (!PAPS_GRADE_GROUPS.has(assessmentGradeGroupId) || !PAPS_TARGET_GROUPS.has(assessmentTargetGroupId))) throw new Error('측정 기준 학년과 평가표 구분을 확인해 주세요.');
    if (item.requiresAssessmentScope && !isMeasurementScopeApplicable(item.id, assessmentGradeGroupId, assessmentTargetGroupId)) {
      throw new Error(item.id === 'body-mass-index' ? 'BMI 기준 학년과 평가표 구분을 직접 선택해 주세요.' : '이 종목의 거리·실시 학년·평가표 구분을 확인해 주세요.');
    }
    if (data.criteriaGradeGroupId && (data.criteriaGradeGroupId !== assessmentGradeGroupId || data.criteriaTargetGroupId !== assessmentTargetGroupId)) throw new Error('측정 범위와 공식 등급 기준 범위가 일치하지 않습니다.');
    if (item.distanceMeters && data.distanceMeters != null && data.distanceMeters !== item.distanceMeters) throw new Error('오래달리기-걷기 거리를 확인해 주세요.');
    let value = null, missingReason = null, heightCm = null, weightKg = null;
    if (data.value === null) {
      missingReason = MISSING_REASONS.find(reason => reason.id === data.missingReason)?.id;
      if (!missingReason) throw new Error('측정값이 없으면 결측 이유를 선택해 주세요.');
      if (item.id === 'body-mass-index' && (data.heightCm != null || data.weightKg != null)) throw new Error('BMI가 결측이면 키와 몸무게를 함께 비워 주세요.');
    } else {
      if (data.missingReason) throw new Error('측정값과 결측 이유를 함께 입력할 수 없어요.');
      if (item.id === 'body-mass-index') {
        heightCm = data.heightCm;
        weightKg = data.weightKg;
        value = calculateBmi(heightCm, weightKg);
        if (value < item.min || value > item.max) throw new Error(`계산한 BMI는 ${item.min}~${item.max} ${item.unit} 범위에서 확인해 주세요.`);
      } else {
        if (typeof data.value !== 'number' || !Number.isFinite(data.value) || data.value < item.min || data.value > item.max) throw new Error(`측정값은 ${item.min}~${item.max} ${item.unit} 범위로 입력해 주세요.`);
        const scale = 10 ** item.precision;
        const precisionLabel = item.precision === 0 ? '정수' : item.precision === 1 ? '소수 첫째 자리까지' : item.precision === 2 ? '소수 둘째 자리까지' : `소수 ${item.precision}자리까지`;
        if (Math.abs(data.value * scale - Math.round(data.value * scale)) > 1e-8) throw new Error(`${precisionLabel} 입력해 주세요.`);
        value = data.value;
      }
    }
    const missingNote = String(data.missingNote || '').trim();
    if (missingNote.length > 120) throw new Error('결측 메모는 120자 이내로 입력해 주세요.');
    if (missingReason === 'other' && !missingNote) throw new Error('결측 이유가 기타이면 메모를 입력해 주세요.');
    if (value !== null && missingNote) throw new Error('결측 메모는 측정값이 없을 때만 입력할 수 있어요.');
    const criteria = measurementCriteria(data);
    return {
      student, item, schoolYear: data.schoolYear, measuredOn: data.measuredOn, value, unit: item.unit,
      missingReason, missingNote, assessmentGradeGroupId, assessmentTargetGroupId,
      distanceMeters: item.distanceMeters || null, heightCm, weightKg, ...criteria,
    };
  }
  function measurementSnapshot(record) {
    return {
      schoolYear: record.schoolYear, measuredOn: record.measuredOn, itemId: record.itemId,
      value: record.value, unit: record.unit, missingReason: record.missingReason, missingNote: record.missingNote,
      assessmentGradeGroupId: record.assessmentGradeGroupId || null,
      assessmentTargetGroupId: record.assessmentTargetGroupId || null,
      distanceMeters: record.distanceMeters || null,
      heightCm: record.heightCm ?? null, weightKg: record.weightKg ?? null,
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
        assessmentGradeGroupId: checked.assessmentGradeGroupId, assessmentTargetGroupId: checked.assessmentTargetGroupId,
        distanceMeters: checked.distanceMeters, heightCm: checked.heightCm, weightKg: checked.weightKg,
        criteriaGradeGroupId: checked.criteriaGradeGroupId, criteriaTargetGroupId: checked.criteriaTargetGroupId,
        inputAt: now, modifiedAt: null, changeHistory: [], criteriaSourceVersion: checked.criteriaSourceVersion,
        retentionExpiresAt,
      });
      delete record.studentConsentConfirmed;
      delete record.guardianConsentConfirmed;
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
    for (const type of ['measurements', 'papsSelections', ...TOOL_TYPES]) if (!Array.isArray(state[type])) state[type] = [];
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
    state.papsSelections = state.papsSelections.filter(item => {
      const classroom = state.classes.find(parent => parent.id === item.classId);
      return Number.isFinite(item.retentionExpiresAt) && item.retentionExpiresAt > now && classroom && !classroom.pendingDelete && !classroom.deletedAt;
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
  const api = { createState, add, get, enqueue, expire, removeClip, updateMeasurement, removeMeasurement, DAY, MAX_RETENTION, MEASUREMENT_ITEMS, MISSING_REASONS, PAPS_GRADE_GROUPS, PAPS_TARGET_GROUPS, isMeasurementScopeApplicable, measurementProtocol, calculateBmi, schoolYearForDate, TOOL_TYPES };
  if (typeof module !== 'undefined') module.exports = api; else root.ClassroomModel = api;
})(globalThis);
