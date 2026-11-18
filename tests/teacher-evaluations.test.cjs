const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../classroom-model.js');
const E = require('../teacher-evaluations.js');

function fixture() {
  const state = M.createState();
  const cls = M.add(state, 'classes', { name: '체육반' });
  const student = M.add(state, 'students', { classId: cls.id, name: '학생1' });
  const lesson = M.add(state, 'lessons', { classId: cls.id, name: '패스', sport: '구기', unit: '패스' });
  const note = M.add(state, 'notes', { classId: cls.id, studentId: student.id, lessonId: lesson.id, text: '친구에게 정확히 전달함' });
  const criteria = E.DIMENSIONS.map(dimension => ({ dimension, description: `${dimension} 기준`, levels: ['시작', '기초', '성장', '안정'] }));
  const rubric = E.createRubric({ classId: cls.id, title: '패스 관찰', schoolYear: 2026, criteria });
  state.rubrics.push(rubric);
  return { state, cls, student, lesson, note, rubric };
}

test('교사 자체 루브릭은 출처가 공식이라고 주장하지 않고 평가를 미평가 상태로 시작한다', () => {
  const f = fixture();
  const evaluation = E.createEvaluation(f.state, { classId: f.cls.id, studentId: f.student.id, rubricId: f.rubric.id, ratings: { knowledge: 3, skill: null, attitude: 4 }, evidenceIds: [{ type: 'notes', id: f.note.id }] });
  assert.equal(f.rubric.ownership, 'teacher-authored');
  assert.equal(f.rubric.sourceStatus, 'not-claimed-official');
  assert.equal(evaluation.status, 'draft');
  assert.throws(() => E.approveEvaluation(f.state, evaluation.id), /미평가/);
});

test('학생 경계·근거 종류를 검증하고 승인 뒤 수정하면 승인을 되돌린다', () => {
  const f = fixture();
  const other = M.add(f.state, 'students', { classId: f.cls.id, name: '학생2' });
  const evaluation = E.createEvaluation(f.state, { classId: f.cls.id, studentId: f.student.id, rubricId: f.rubric.id, ratings: { knowledge: 3, skill: 2, attitude: 4 }, evidenceIds: [{ type: 'notes', id: f.note.id }] });
  assert.throws(() => E.createEvaluation(f.state, { classId: f.cls.id, studentId: other.id, rubricId: f.rubric.id, ratings: { knowledge: 3, skill: 2, attitude: 4 }, evidenceIds: [{ type: 'notes', id: f.note.id }] }), /같은 학급·학생/);
  assert.throws(() => E.createEvaluation(f.state, { classId: f.cls.id, studentId: f.student.id, rubricId: f.rubric.id, ratings: { knowledge: 3, skill: 2, attitude: 4 }, evidenceIds: [{ type: 'measurements', id: 'foreign' }] }), /관찰·성찰·제출/);
  E.approveEvaluation(f.state, evaluation.id, 1000);
  assert.equal(evaluation.status, 'approved');
  E.updateEvaluation(f.state, evaluation.id, { ratings: { knowledge: 4, skill: 2, attitude: 4 } }, 2000);
  assert.equal(evaluation.status, 'draft');
  assert.equal(evaluation.history.length, 2);
});

test('생기부 문안은 수동 작성·승인한 평가만 근거로 삼고 승인 문안만 안전 CSV로 내보낸다', () => {
  const f = fixture();
  const draft = E.createEvaluation(f.state, { classId: f.cls.id, studentId: f.student.id, rubricId: f.rubric.id, ratings: { knowledge: 3, skill: 2, attitude: 4 } });
  assert.throws(() => E.createReport(f.state, { classId: f.cls.id, studentId: f.student.id, assessmentIds: [draft.id], title: '수행 관찰' }), /승인된 평가/);
  E.approveEvaluation(f.state, draft.id);
  const report = E.createReport(f.state, { classId: f.cls.id, studentId: f.student.id, assessmentIds: [draft.id], title: '수행 관찰', body: '=실제 문장' });
  assert.throws(() => E.approvedReportCsv(f.state, { classId: f.cls.id, studentId: f.student.id, reportIds: [report.id] }), /승인된 문안/);
  E.approveReport(f.state, report.id);
  const csv = E.approvedReportCsv(f.state, { classId: f.cls.id, studentId: f.student.id, reportIds: [report.id], studentName: '학생1' });
  assert.match(csv, /'=실제 문장/);
  assert.match(csv, /NEIS 양식/);
  E.updateEvaluation(f.state, draft.id, { comment: '근거 평가 수정' });
  assert.equal(report.status, 'draft', 'a changed source evaluation invalidates its previously approved report');
  assert.throws(() => E.approvedReportCsv(f.state, { classId: f.cls.id, studentId: f.student.id, reportIds: [report.id] }), /승인된 문안/);
  E.approveEvaluation(f.state, draft.id);
  E.updateReport(f.state, report.id, { body: '교사가 수정함' });
  assert.equal(report.status, 'draft');
});

test('루브릭 수정은 버전을 올리고 이미 생성한 평가에 당시 기준 사본을 보존한다', () => {
  const f = fixture();
  const evaluation = E.createEvaluation(f.state, { classId: f.cls.id, studentId: f.student.id, rubricId: f.rubric.id, ratings: { knowledge: 2, skill: 3, attitude: 4 } });
  const revisedCriteria = E.DIMENSIONS.map(dimension => ({ dimension, description: `수정 ${dimension}`, levels: ['새1', '새2', '새3', '새4'] }));
  E.updateRubric(f.state, f.rubric.id, { title: '수정 기준', criteria: revisedCriteria });
  assert.equal(f.rubric.version, 2);
  assert.equal(f.rubric.history.length, 1);
  assert.equal(evaluation.rubricVersion, 1);
  assert.equal(evaluation.rubricSnapshot.title, '패스 관찰');
  assert.equal(evaluation.rubricSnapshot.criteria[0].description, 'knowledge 기준');
});

test('교육과정 선택은 학년도와 학년 범위를 검증하고 당시 출처 사본을 저장한다', () => {
  const f = fixture();
  const args = { classId: f.cls.id, studentId: f.student.id, rubricId: f.rubric.id, ratings: { knowledge: 3, skill: 2, attitude: 4 } };
  const old = E.createEvaluation(f.state, args);
  assert.equal('curriculumSnapshot' in old, false);
  E.updateEvaluation(f.state, old.id, { comment: '기존 평가 수정' });
  assert.equal('curriculumSnapshot' in old, false);
  assert.throws(() => E.createEvaluation(f.state, { ...args, curriculum: { grade: 'middle-1', code: '6체02-02' } }));
  assert.throws(() => E.createEvaluation(f.state, { ...args, curriculum: { grade: 'elementary-5', code: 'unknown' } }));
  const previousYear = E.createRubric({ classId: f.cls.id, title: '이전 학년도', schoolYear: 2025, criteria: f.rubric.criteria });
  f.state.rubrics.push(previousYear);
  assert.throws(() => E.createEvaluation(f.state, { ...args, rubricId: previousYear.id, curriculum: { grade: 'elementary-5', code: '6체02-02' } }));
  const evaluation = E.createEvaluation(f.state, { ...args, curriculum: { grade: 'elementary-5', code: '6체02-02' } });
  assert.equal(evaluation.curriculumSnapshot.grade, 'elementary-5');
  assert.equal(evaluation.curriculumSnapshot.code, '6체02-02');
  assert.equal(evaluation.curriculumSnapshot.schoolYear, 2026);
  assert.ok(evaluation.curriculumSnapshot.summary);
  assert.ok(evaluation.curriculumSnapshot.source);
  assert.equal(f.rubric.ownership, 'teacher-authored');
});

test('교육과정 변경은 이전 사본을 이력에 남기고 평가와 문안 승인을 취소한다', () => {
  const f = fixture();
  const evaluation = E.createEvaluation(f.state, { classId: f.cls.id, studentId: f.student.id, rubricId: f.rubric.id, ratings: { knowledge: 3, skill: 2, attitude: 4 }, curriculum: { grade: 'elementary-5', code: '6체02-02' } });
  evaluation.curriculumSnapshot.summary = '저장 당시의 요약';
  evaluation.curriculumSnapshot.source.title = '저장 당시의 출처';
  const saved = structuredClone(evaluation.curriculumSnapshot);
  E.updateEvaluation(f.state, evaluation.id, { comment: '수정', curriculum: { grade: 'elementary-5', code: '6체02-02' } });
  assert.deepEqual(evaluation.curriculumSnapshot, saved);
  E.updateEvaluation(f.state, evaluation.id, { comment: '다시 수정' });
  assert.deepEqual(evaluation.curriculumSnapshot, saved);
  assert.throws(() => E.updateEvaluation(f.state, evaluation.id, { curriculum: { grade: 'middle-1', code: '6체02-02' } }));
  assert.deepEqual(evaluation.curriculumSnapshot, saved);
  E.approveEvaluation(f.state, evaluation.id);
  const report = E.createReport(f.state, { classId: f.cls.id, studentId: f.student.id, assessmentIds: [evaluation.id], title: '문안', body: '교사 작성' });
  E.approveReport(f.state, report.id);
  const version = evaluation.version;
  E.updateEvaluation(f.state, evaluation.id, { curriculum: null }, 2000);
  assert.equal('curriculumSnapshot' in evaluation, false);
  assert.deepEqual(evaluation.history.at(-1).before.curriculumSnapshot, saved);
  assert.equal(evaluation.version, version + 1);
  assert.equal(evaluation.status, 'draft');
  assert.equal(report.status, 'draft');
  assert.equal(report.history.at(-1).action, 'source-assessment-revised');
  E.updateEvaluation(f.state, evaluation.id, { curriculum: { grade: 'elementary-5', code: '6체02-02' } });
  assert.equal(evaluation.curriculumSnapshot.code, '6체02-02');
  assert.equal('curriculumSnapshot' in evaluation.history.at(-1).before, false);
});

test('2026 세특 참고 바이트는 UTF-8과 줄바꿈 정규화 및 저장 시 공백 제거를 사용한다', () => {
  assert.equal(E.reportBodyUtf8Bytes('가'.repeat(500)), 1500);
  assert.equal(E.reportBodyUtf8Bytes('가'.repeat(500) + 'a'), 1501);
  assert.equal(E.reportBodyUtf8Bytes('가'.repeat(501)), 1503);
  assert.equal(E.reportBodyUtf8Bytes('  한A1\r\n글\r끝  '), 13);
  assert.equal(E.reportBodyUtf8Bytes('\r\n'), 0);
});
