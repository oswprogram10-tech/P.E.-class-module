const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../classroom-model');

function base() {
  const state = M.createState();
  const classroom = M.add(state, 'classes', { name: '5학년 체육' });
  const student = M.add(state, 'students', { classId: classroom.id, name: '같은 이름' });
  const otherStudent = M.add(state, 'students', { classId: classroom.id, name: '같은 이름' });
  return { state, classroom, student, otherStudent };
}

function measurement(classId, studentId, values = {}) {
  return {
    classId, studentId, schoolYear: 2026, measuredOn: '2026-11-06',
    itemId: 'grip-strength', value: 12.3, unit: 'kg', missingReason: null, missingNote: '', ...values,
  };
}

test('PAPS 수기 원자료는 S3 학생 ID·단위·입력 시각을 가지며 7일 만료를 상속하지 않는다', () => {
  const { state, classroom, student, otherStudent } = base();
  const record = M.add(state, 'measurements', measurement(classroom.id, otherStudent.id));
  assert.equal(record.studentId, otherStudent.id);
  assert.notEqual(record.studentId, student.id);
  assert.equal(record.unit, 'kg');
  assert.equal(record.inputAt, record.createdAt);
  assert.equal(record.modifiedAt, null);
  assert.equal(record.criteriaSourceVersion, null);
  assert.equal(Object.hasOwn(record, 'score'), false);
  assert.equal(Object.hasOwn(record, 'grade'), false);
  assert.equal(record.expiresAt, undefined);
  assert.equal(record.retentionExpiresAt, Date.UTC(2029, 2, 1));
  M.expire(state, record.createdAt + 8 * M.DAY);
  assert.equal(state.measurements.length, 1);
});

test('측정값은 범위·단위·정밀도·학년도에 맞아야 하고 다른 학급 학생은 거부한다', () => {
  const { state, classroom, student } = base();
  const otherClass = M.add(state, 'classes', { name: '다른 학급' });
  const foreignStudent = M.add(state, 'students', { classId: otherClass.id, name: '다른 학생' });
  assert.throws(() => M.add(state, 'measurements', measurement(classroom.id, foreignStudent.id)), /찾을 수 없어요/);
  assert.throws(() => M.add(state, 'measurements', measurement(classroom.id, student.id, { unit: '회' })), /단위/);
  assert.throws(() => M.add(state, 'measurements', measurement(classroom.id, student.id, { value: 100.1 })), /범위/);
  assert.throws(() => M.add(state, 'measurements', measurement(classroom.id, student.id, { value: 1.25 })), /소수/);
  assert.throws(() => M.add(state, 'measurements', measurement(classroom.id, student.id, { measuredOn: '2026-02-28' })), /학년도/);
  assert.throws(() => M.add(state, 'measurements', measurement(classroom.id, student.id, { measuredOn: '2026-02-30', schoolYear: 2025 })), /측정일/);
});

test('공식 측정 단위에 맞춰 제자리멀리뛰기를 0.1cm까지 기록한다', () => {
  const { state, classroom, student } = base();
  const record = M.add(state, 'measurements', measurement(classroom.id, student.id, {
    itemId: 'standing-long-jump', value: 100.1, unit: 'cm',
  }));
  assert.equal(record.value, 100.1);
  assert.throws(() => M.add(state, 'measurements', measurement(classroom.id, student.id, {
    itemId: 'standing-long-jump', value: 100.05, unit: 'cm',
  })), /소수 첫째 자리/);
});

test('개별 등급 조회 범위는 명시적으로 고정하고 수정 이력에 이전·새 기준을 남긴다', () => {
  const { state, classroom, student } = base();
  const papsScope = {
    criteriaGradeGroupId: 'elementary-5',
    criteriaTargetGroupId: 'male',
    criteriaSourceVersion: 'MOE-354-2025-03-10-annex4',
  };
  const record = M.add(state, 'measurements', measurement(classroom.id, student.id, papsScope));
  assert.equal(record.criteriaGradeGroupId, 'elementary-5');
  assert.equal(record.criteriaTargetGroupId, 'male');
  assert.equal(record.criteriaSourceVersion, 'MOE-354-2025-03-10-annex4');
  assert.throws(() => M.add(state, 'measurements', measurement(classroom.id, student.id, {
    criteriaGradeGroupId: 'elementary-5', criteriaTargetGroupId: 'female',
  })), /학년·평가표 구분·기준 버전/);
  const changed = M.updateMeasurement(state, record.id, measurement(classroom.id, student.id, {
    ...papsScope, value: 13.2, criteriaTargetGroupId: 'female',
  }), record.inputAt + 1000);
  assert.equal(changed.changeHistory[0].before.criteriaTargetGroupId, 'male');
  assert.equal(changed.changeHistory[0].after.criteriaTargetGroupId, 'female');
  assert.equal(changed.changeHistory[0].after.criteriaGradeGroupId, 'elementary-5');
});

test('0과 결측은 구분하고 결측 사유를 요구한다', () => {
  const { state, classroom, student } = base();
  const zero = M.add(state, 'measurements', measurement(classroom.id, student.id, { itemId: 'sit-ups', unit: '회', value: 0 }));
  const missing = M.add(state, 'measurements', measurement(classroom.id, student.id, { value: null, missingReason: 'absent' }));
  assert.equal(zero.value, 0);
  assert.equal(zero.missingReason, null);
  assert.equal(missing.value, null);
  assert.equal(missing.missingReason, 'absent');
  assert.throws(() => M.add(state, 'measurements', measurement(classroom.id, student.id, { value: null })), /결측 이유/);
  assert.throws(() => M.add(state, 'measurements', measurement(classroom.id, student.id, { value: null, missingReason: 'other' })), /메모/);
  assert.throws(() => M.add(state, 'measurements', measurement(classroom.id, student.id, { missingNote: '추가 문구' })), /결측 메모/);
});

test('정정은 이전값·새값·시각·교사 역할을 이력으로 남기고 재배정을 막는다', () => {
  const { state, classroom, student, otherStudent } = base();
  const record = M.add(state, 'measurements', measurement(classroom.id, student.id));
  const inputAt = record.inputAt, changedAt = inputAt + 1234;
  const updated = M.updateMeasurement(state, record.id, measurement(classroom.id, student.id, { value: 13.4 }), changedAt);
  assert.equal(updated.value, 13.4);
  assert.equal(updated.inputAt, inputAt);
  assert.equal(updated.modifiedAt, changedAt);
  assert.equal(updated.changeHistory.length, 1);
  assert.equal(updated.changeHistory[0].actor, 'teacher');
  assert.equal(updated.changeHistory[0].changedAt, changedAt);
  assert.equal(updated.changeHistory[0].before.value, 12.3);
  assert.equal(updated.changeHistory[0].after.value, 13.4);
  assert.throws(() => M.updateMeasurement(state, record.id, measurement(classroom.id, student.id, { value: 13.4 })), /변경된/);
  assert.throws(() => M.updateMeasurement(state, record.id, measurement(classroom.id, otherStudent.id, { value: 13.4 })), /학급과 학생/);
  assert.throws(() => M.updateMeasurement(state, record.id, measurement(classroom.id, student.id, { schoolYear: 2025, measuredOn: '2025-11-06' })), /학년도 변경/);
  const removed = M.removeMeasurement(state, record.id, classroom.id);
  assert.equal(removed.changeHistory.length, 1);
  assert.equal(state.measurements.length, 0, 'hard deletion removes the measurement and its correction history');
});

test('학년도 만료와 학생·학급 삭제 경계에서 체력 기록을 정리한다', () => {
  const { state, classroom, student, otherStudent } = base();
  const keep = M.add(state, 'measurements', measurement(classroom.id, otherStudent.id));
  const eightDaysLater = keep.createdAt + 8 * M.DAY;
  M.expire(state, eightDaysLater);
  assert.deepEqual(state.measurements.map(item => item.id), [keep.id]);
  assert.ok(state.classes.some(item => item.id === classroom.id), 'the class name is retained only while its measurement remains');
  assert.ok(state.students.some(item => item.id === otherStudent.id), 'the referenced student identity is retained only while its measurement remains');
  state.students = state.students.filter(item => item.id !== otherStudent.id);
  M.expire(state);
  assert.equal(state.measurements.length, 0);

  const second = base();
  const finalRecord = M.add(second.state, 'measurements', measurement(second.classroom.id, second.student.id));
  M.updateMeasurement(second.state, finalRecord.id, measurement(second.classroom.id, second.student.id, { value: 13.4 }));
  assert.equal(finalRecord.changeHistory.length, 1);
  M.expire(second.state, finalRecord.retentionExpiresAt);
  assert.equal(second.state.measurements.length, 0);
  assert.equal(second.state.measurements.some(item => item.changeHistory?.length), false, 'expired measurements cannot leave correction history behind');
  assert.equal(second.state.students.length, 0, 'the roster identity expires after its last measurement expires');

  const third = base();
  const pendingDeletion = M.add(third.state, 'measurements', measurement(third.classroom.id, third.student.id));
  third.state.classes.find(item => item.id === third.classroom.id).pendingDelete = true;
  M.expire(third.state);
  assert.equal(third.state.measurements.some(item => item.id === pendingDeletion.id), false);
});
