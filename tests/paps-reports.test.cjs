const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../classroom-model.js');
const reports = require('../paps-reports.js');

function fixture() {
  const state = M.createState();
  const cls = M.add(state, 'classes', { name: '체육반' });
  const first = M.add(state, 'students', { classId: cls.id, name: '학생1' });
  const second = M.add(state, 'students', { classId: cls.id, name: '학생2' });
  const scope = { criteriaGradeGroupId: 'elementary-5', criteriaTargetGroupId: 'male', criteriaSourceVersion: 'MOE-354-2025-03-10-annex4' };
  const add = (student, year, date, value, extra = {}) => M.add(state, 'measurements', { classId: cls.id, studentId: student.id, schoolYear: year, measuredOn: date, itemId: 'grip-strength', value, unit: 'kg', missingReason: null, missingNote: '', ...scope, ...extra });
  return { state, cls, first, second, add };
}

test('학생별 추이는 기록된 연도와 명시된 적용 범위만 시간순으로 반환한다', () => {
  const f = fixture();
  f.add(f.first, 2025, '2025-11-06', 11.2);
  f.add(f.first, 2026, '2026-11-06', 12.3);
  f.add(f.second, 2026, '2026-11-06', 18.4);
  f.add(f.first, 2026, '2026-11-07', null, { missingReason: 'absent', ...{ criteriaGradeGroupId: null, criteriaTargetGroupId: null, criteriaSourceVersion: null } });
  const trend = reports.buildTrend(f.state.measurements, { classId: f.cls.id, studentId: f.first.id, itemId: 'grip-strength', gradeGroupId: 'elementary-5', targetGroupId: 'male' });
  assert.deepEqual(trend.map(row => [row.schoolYear, row.value]), [[2025, 11.2], [2026, 12.3]]);
});

test('분포는 동일 학년·성별·버전의 유효 수치만 분류하고 결측/범위 밖은 별도 집계한다', () => {
  const f = fixture();
  f.add(f.first, 2026, '2026-11-06', 12.3);
  f.add(f.second, 2026, '2026-11-06', 45.6);
  f.add(f.second, 2026, '2026-11-07', null, { missingReason: 'absent', ...{ criteriaGradeGroupId: null, criteriaTargetGroupId: null, criteriaSourceVersion: null } });
  const result = reports.classDistribution(f.state.measurements, { classId: f.cls.id, schoolYear: 2026, itemId: 'grip-strength', gradeGroupId: 'elementary-5', targetGroupId: 'male', criteriaSourceVersion: 'MOE-354-2025-03-10-annex4' });
  assert.equal(result.included, 2);
  assert.equal(result.missing, 1);
  assert.equal(result.unavailable, 0);
  assert.equal(Object.values(result.counts).reduce((a, b) => a + b, 0), 2);
});

test('로컬 PAPS CSV는 선택한 학생 기록만 포함하고 수식과 줄바꿈 삽입을 무력화한다', () => {
  const f = fixture();
  const record = f.add(f.first, 2026, '2026-11-06', 12.3);
  const other = f.add(f.second, 2026, '2026-11-06', 18.4);
  const csv = reports.createStudentCsv(f.state.measurements, { classId: f.cls.id, studentId: f.first.id, selectedIds: [record.id], generatedAt: '2026-11-06' });
  assert.match(csv, /로컬 임시자료/);
  assert.match(csv, /NEIS 양식 아님/);
  assert.match(csv, /12\.3/);
  assert.doesNotMatch(csv, new RegExp(other.id));
  assert.throws(() => reports.createStudentCsv(f.state.measurements, { classId: f.cls.id, studentId: f.first.id, selectedIds: [record.id, other.id] }), /학생·학급 범위/);
  const dangerous = reports.createStudentCsv([{ ...record, itemId: '=cmd', value: 12.3 }], { classId: f.cls.id, studentId: f.first.id, selectedIds: [record.id] });
  assert.match(dangerous, /'=cmd/);
});
