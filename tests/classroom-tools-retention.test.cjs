const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../classroom-model.js');
const E = require('../teacher-evaluations.js');

function fixture() {
  const state = M.createState();
  const cls = M.add(state, 'classes', { name: '수업' });
  const student = M.add(state, 'students', { classId: cls.id, name: '학생' });
  const rubric = E.createRubric({ classId: cls.id, title: '자체 기준', schoolYear: 2026, criteria: E.DIMENSIONS.map(dimension => ({ dimension, description: '관찰 기준', levels: ['1', '2', '3', '4'] })) });
  state.rubrics.push(rubric);
  const assessment = E.createEvaluation(state, { classId: cls.id, studentId: student.id, rubricId: rubric.id, ratings: { knowledge: 2, skill: 3, attitude: 4 } });
  E.approveEvaluation(state, assessment.id);
  const report = E.createReport(state, { classId: cls.id, studentId: student.id, assessmentIds: [assessment.id], title: '수업 문안', body: '교사 작성' });
  E.approveReport(state, report.id);
  return { state, cls, student, rubric, assessment, report };
}

test('평가·문안은 기준 만료 때까지 학급·학생·루브릭을 보호하고 기간 만료 후 정리한다', () => {
  const f = fixture();
  const afterWeek = f.cls.createdAt + 8 * M.DAY;
  M.expire(f.state, afterWeek);
  assert.equal(f.state.classes.length, 1);
  assert.equal(f.state.students.length, 1);
  assert.equal(f.state.rubrics.length, 1);
  assert.equal(f.state.assessments.length, 1);
  assert.equal(f.state.reports.length, 1);
  M.expire(f.state, f.assessment.retentionExpiresAt);
  assert.equal(f.state.assessments.length, 0);
  assert.equal(f.state.reports.length, 0);
  assert.equal(f.state.students.length, 0);
  assert.equal(f.state.rubrics.length, 0);
});

test('삭제 대기 학급의 확장 평가 자료와 QR·전술 데이터는 보존되지 않는다', () => {
  const f = fixture();
  f.cls.pendingDelete = true;
  f.state.exerciseApprovals.push({ id: 'approval', classId: f.cls.id, createdAt: Date.now(), expiresAt: Date.now() + M.DAY });
  f.state.tacticsBoards.push({ id: 'board', classId: f.cls.id, createdAt: Date.now(), expiresAt: Date.now() + M.DAY });
  f.state.qrMissionStores.push({ id: 'qr', classId: f.cls.id, createdAt: Date.now(), expiresAt: Date.now() + M.DAY });
  M.expire(f.state);
  assert.equal(f.state.assessments.length, 0);
  assert.equal(f.state.reports.length, 0);
  assert.equal(f.state.rubrics.length, 0);
  assert.equal(f.state.exerciseApprovals.length, 0);
  assert.equal(f.state.tacticsBoards.length, 0);
  assert.equal(f.state.qrMissionStores.length, 0);
});

test('기존 저장 상태는 새 확장 자료 배열을 안전하게 초기화한다', () => {
  const legacy = { version: 1, classes: [], students: [], lessons: [], groups: [], devices: [], reflections: [], submissions: [], notes: [], feedback: [], measurements: [], outbox: [], shotAttempts: [] };
  M.expire(legacy);
  for (const type of M.TOOL_TYPES) assert.deepEqual(legacy[type], []);
});
