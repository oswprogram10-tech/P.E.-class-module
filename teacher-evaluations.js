(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TeacherEvaluations = api;
})(globalThis, function () {
  'use strict';
  const DIMENSIONS = Object.freeze(['knowledge', 'skill', 'attitude']);
  const TYPES = new Set(['notes', 'reflections', 'submissions']);
  const fail = message => { throw new Error(message); };
  const clone = value => JSON.parse(JSON.stringify(value));
  const id = () => crypto.randomUUID();
  const text = (value, max, label) => { if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(`${label}을(를) 확인해 주세요.`); return value.trim(); };
  function byId(state, type, key, classId) {
    const item = state[type]?.find(row => row.id === key && row.classId === classId);
    if (!item) fail('선택한 학급 자료를 찾을 수 없습니다.');
    return item;
  }
  function createRubric({ classId, title, schoolYear, criteria, now = Date.now(), idFactory = id } = {}) {
    if (typeof classId !== 'string' || !classId.trim() || !Number.isInteger(schoolYear) || schoolYear < 2000 || schoolYear > 2100) fail('학급과 학년도를 확인해 주세요.');
    if (!Array.isArray(criteria) || criteria.length !== DIMENSIONS.length) fail('지식·기능·태도 기준을 각각 작성해 주세요.');
    const clean = DIMENSIONS.map(dimension => {
      const item = criteria.find(row => row?.dimension === dimension);
      if (!item) fail('지식·기능·태도 기준을 각각 작성해 주세요.');
      return { dimension, description: text(item.description, 300, '기준 설명'), levels: Array.from({ length: 4 }, (_, index) => text(item.levels?.[index], 200, '등급별 설명')) };
    });
    return { id: idFactory(), classId, schoolYear, title: text(title, 120, '루브릭 제목'), ownership: 'teacher-authored', sourceStatus: 'not-claimed-official', criteria: clean, version: 1, history: [], createdAt: now, modifiedAt: now };
  }
  function updateRubric(state, rubricId, { title, criteria } = {}, now = Date.now()) {
    const item = state.rubrics?.find(row => row.id === rubricId);
    if (!item || item.ownership !== 'teacher-authored' || item.sourceStatus !== 'not-claimed-official') fail('교사 자체 루브릭만 수정할 수 있습니다.');
    const next = createRubric({ classId: item.classId, title: title === undefined ? item.title : title, schoolYear: item.schoolYear, criteria: criteria === undefined ? item.criteria : criteria, now, idFactory: () => item.id });
    if (next.title === item.title && JSON.stringify(next.criteria) === JSON.stringify(item.criteria)) fail('변경된 루브릭 내용이 없습니다.');
    item.history.push({ changedAt: now, actor: 'teacher', before: { title: item.title, criteria: clone(item.criteria), version: item.version } });
    Object.assign(item, { title: next.title, criteria: next.criteria, modifiedAt: now, version: item.version + 1 });
    return item;
  }
  function validateEvidence(state, { classId, studentId, evidenceIds }) {
    if (!Array.isArray(evidenceIds) || evidenceIds.length > 50 || new Set(evidenceIds).size !== evidenceIds.length) fail('근거 자료를 확인해 주세요.');
    return evidenceIds.map(ref => {
      if (!ref || !TYPES.has(ref.type) || typeof ref.id !== 'string') fail('관찰·성찰·제출 근거만 연결할 수 있습니다.');
      const item = byId(state, ref.type, ref.id, classId);
      if (item.studentId !== studentId || item.deletedAt || (Number.isFinite(item.expiresAt) && item.expiresAt <= Date.now())) fail('근거 자료는 같은 학급·학생의 유효한 기록이어야 합니다.');
      return { type: ref.type, id: item.id };
    });
  }
  function createEvaluation(state, { classId, studentId, rubricId, ratings, comment = '', evidenceIds = [], now = Date.now(), idFactory = id } = {}) {
    if (!state.classes?.some(row => row.id === classId)) fail('학급을 찾을 수 없습니다.');
    const student = byId(state, 'students', studentId, classId);
    const rubric = byId(state, 'rubrics', rubricId, classId);
    if (rubric.schoolYear < 2000 || !ratings || typeof ratings !== 'object' || Array.isArray(ratings)) fail('평가 기준과 결과를 확인해 주세요.');
    const cleanRatings = {};
    for (const dimension of DIMENSIONS) {
      const value = ratings[dimension] ?? null;
      if (value !== null && (!Number.isInteger(value) || value < 1 || value > 4)) fail('평가 수준은 1~4 또는 미평가여야 합니다.');
      cleanRatings[dimension] = value;
    }
    if (Object.keys(ratings).some(key => !DIMENSIONS.includes(key))) fail('지원하지 않는 평가 기준입니다.');
    const record = {
      id: idFactory(), classId, studentId: student.id, rubricId: rubric.id, schoolYear: rubric.schoolYear,
      rubricVersion: rubric.version || 1, rubricSnapshot: { title: rubric.title, schoolYear: rubric.schoolYear, version: rubric.version || 1, criteria: clone(rubric.criteria) },
      ratings: cleanRatings, comment: String(comment || '').trim().slice(0, 1000),
      evidence: validateEvidence(state, { classId, studentId, evidenceIds }), status: 'draft', approvedAt: null,
      createdAt: now, modifiedAt: now, retentionExpiresAt: Date.UTC(rubric.schoolYear + 3, 2, 1), version: 1, history: [],
    };
    (state.assessments ||= []).push(record);
    return record;
  }
  function snapshot(item) { return { ratings: clone(item.ratings), comment: item.comment, evidence: clone(item.evidence), status: item.status, approvedAt: item.approvedAt }; }
  function updateEvaluation(state, assessmentId, patch, now = Date.now()) {
    const item = state.assessments?.find(row => row.id === assessmentId);
    if (!item) fail('평가 초안을 찾을 수 없습니다.');
    const before = snapshot(item);
    const ratings = patch.ratings === undefined ? item.ratings : patch.ratings;
    const comment = patch.comment === undefined ? item.comment : patch.comment;
    const evidenceIds = patch.evidenceIds === undefined ? item.evidence.map(ref => ref.id) : patch.evidenceIds;
    const evidence = patch.evidenceIds === undefined ? item.evidence : validateEvidence(state, { classId: item.classId, studentId: item.studentId, evidenceIds });
    const cleanRatings = {};
    for (const dimension of DIMENSIONS) {
      const value = ratings?.[dimension] ?? null;
      if (value !== null && (!Number.isInteger(value) || value < 1 || value > 4)) fail('평가 수준은 1~4 또는 미평가여야 합니다.');
      cleanRatings[dimension] = value;
    }
    if (Object.keys(ratings || {}).some(key => !DIMENSIONS.includes(key))) fail('지원하지 않는 평가 기준입니다.');
    const next = { ratings: cleanRatings, comment: String(comment || '').trim().slice(0, 1000), evidence };
    if (JSON.stringify({ ratings: before.ratings, comment: before.comment, evidence: before.evidence }) === JSON.stringify(next)) fail('변경된 평가 내용이 없습니다.');
    item.history.push({ changedAt: now, actor: 'teacher', action: 'edit', before });
    Object.assign(item, next, { status: 'draft', approvedAt: null, modifiedAt: now, version: item.version + 1 });
    for (const report of state.reports || []) if (report.assessmentIds?.includes(item.id) && report.status === 'approved') {
      report.history.push({ changedAt: now, actor: 'teacher', action: 'source-assessment-revised', before: { body: report.body, assessmentIds: [...report.assessmentIds], status: report.status, approvedAt: report.approvedAt } });
      report.status = 'draft'; report.approvedAt = null; report.modifiedAt = now; report.version += 1;
    }
    return item;
  }
  function approveEvaluation(state, assessmentId, now = Date.now()) {
    const item = state.assessments?.find(row => row.id === assessmentId);
    if (!item) fail('평가 초안을 찾을 수 없습니다.');
    if (DIMENSIONS.some(dimension => !Number.isInteger(item.ratings[dimension]))) fail('미평가 항목을 확인한 뒤 모든 기준을 평가해 주세요.');
    if (item.status === 'approved') return item;
    const before = snapshot(item);
    item.history.push({ changedAt: now, actor: 'teacher', action: 'approve', before });
    item.status = 'approved'; item.approvedAt = now; item.modifiedAt = now; item.version += 1;
    return item;
  }
  function createReport(state, { classId, studentId, assessmentIds, title, body = '', now = Date.now(), idFactory = id } = {}) {
    byId(state, 'students', studentId, classId);
    if (!Array.isArray(assessmentIds) || assessmentIds.length < 1 || new Set(assessmentIds).size !== assessmentIds.length) fail('근거로 사용할 승인 평가를 선택해 주세요.');
    const assessments = assessmentIds.map(key => state.assessments?.find(row => row.id === key && row.classId === classId && row.studentId === studentId && row.status === 'approved'));
    if (assessments.some(row => !row)) fail('같은 학생의 승인된 평가만 문안 근거로 선택할 수 있습니다.');
    const schoolYear = Math.max(...assessments.map(row => row.schoolYear));
    const record = { id: idFactory(), classId, studentId, schoolYear, title: text(title, 120, '문안 제목'), body: String(body || '').trim().slice(0, 2000), assessmentIds: [...assessmentIds], status: 'draft', approvedAt: null, createdAt: now, modifiedAt: now, retentionExpiresAt: Date.UTC(schoolYear + 3, 2, 1), version: 1, history: [] };
    (state.reports ||= []).push(record);
    return record;
  }
  function updateReport(state, reportId, { body, assessmentIds } = {}, now = Date.now()) {
    const item = state.reports?.find(row => row.id === reportId);
    if (!item) fail('문안 초안을 찾을 수 없습니다.');
    const ids = assessmentIds === undefined ? item.assessmentIds : assessmentIds;
    if (!Array.isArray(ids) || ids.length < 1 || new Set(ids).size !== ids.length || ids.some(key => !state.assessments?.some(row => row.id === key && row.classId === item.classId && row.studentId === item.studentId && row.status === 'approved'))) fail('같은 학생의 승인된 평가만 문안 근거로 선택할 수 있습니다.');
    const nextBody = body === undefined ? item.body : String(body || '').trim().slice(0, 2000);
    if (JSON.stringify({ body: item.body, assessmentIds: item.assessmentIds }) === JSON.stringify({ body: nextBody, assessmentIds: ids })) fail('변경된 문안이 없습니다.');
    item.history.push({ changedAt: now, actor: 'teacher', action: 'edit', before: { body: item.body, assessmentIds: [...item.assessmentIds], status: item.status, approvedAt: item.approvedAt } });
    Object.assign(item, { body: nextBody, assessmentIds: [...ids], status: 'draft', approvedAt: null, modifiedAt: now, version: item.version + 1 });
    return item;
  }
  function approveReport(state, reportId, now = Date.now()) {
    const item = state.reports?.find(row => row.id === reportId);
    if (!item) fail('문안 초안을 찾을 수 없습니다.');
    if (!item.body.trim()) fail('교사가 문안을 직접 작성해 주세요.');
    if (!item.assessmentIds.length || item.assessmentIds.some(key => !state.assessments?.some(row => row.id === key && row.classId === item.classId && row.studentId === item.studentId && row.status === 'approved'))) fail('승인 상태를 확인할 수 있는 근거 평가가 필요합니다.');
    if (item.status === 'approved') return item;
    item.history.push({ changedAt: now, actor: 'teacher', action: 'approve', before: { body: item.body, assessmentIds: [...item.assessmentIds], status: item.status, approvedAt: item.approvedAt } });
    item.status = 'approved'; item.approvedAt = now; item.modifiedAt = now; item.version += 1;
    return item;
  }
  function csvCell(value) { let text = String(value ?? ''); if (/^[\u0000-\u0020]*[=+\-@]/.test(text)) text = `'${text}`; return `"${text.replace(/"/g, '""').replace(/\r\n|\r|\n/g, ' ')}"`; }
  function approvedReportCsv(state, { classId, studentId, reportIds, studentName = '', generatedAt = new Date().toISOString() } = {}) {
    if (!Array.isArray(reportIds) || reportIds.length < 1 || new Set(reportIds).size !== reportIds.length) fail('내보낼 승인 문안을 직접 선택해 주세요.');
    const reports = reportIds.map(key => state.reports?.find(row => row.id === key && row.classId === classId && row.studentId === studentId && row.status === 'approved'));
    if (reports.some(row => !row)) fail('선택 학생의 승인된 문안만 내보낼 수 있습니다.');
    if (reports.some(row => row.assessmentIds.some(id => !state.assessments?.some(assessment => assessment.id === id && assessment.classId === classId && assessment.studentId === studentId && assessment.status === 'approved')))) fail('문안 근거 평가의 최신 승인 상태를 확인해 주세요.');
    const lines = [['출력종류', '산출일시', '학생ID', '학생표시명', '학년도', '문안제목', '교사작성문안', '승인근거평가ID', '형식안내']];
    for (const report of reports) lines.push(['교사 승인 로컬 초안', generatedAt, studentId, studentName, report.schoolYear, report.title, report.body, report.assessmentIds.join('|'), '임시 CSV · NEIS 양식/업로드 호환 검증 안 됨']);
    return '\ufeff' + lines.map(line => line.map(csvCell).join(',')).join('\r\n');
  }
  return Object.freeze({ DIMENSIONS, createRubric, updateRubric, createEvaluation, updateEvaluation, approveEvaluation, createReport, updateReport, approveReport, approvedReportCsv });
});
