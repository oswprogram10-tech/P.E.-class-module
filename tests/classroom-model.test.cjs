const test = require('node:test');
const assert = require('node:assert/strict');
const Model = require('../classroom-model.js');

function base() {
  const state = Model.createState();
  const classroom = Model.add(state, 'classes', { name: '5학년 체육' });
  const student = Model.add(state, 'students', { classId: classroom.id, name: '김민수', number: '7' });
  const lesson = Model.add(state, 'lessons', { classId: classroom.id, name: '슛 연습', sport: '농구', unit: '슛' });
  return { state, classroom, student, lesson };
}

test('동명이인·동일 번호 학생은 안정적인 별도 ID를 가진다', () => {
  const { state, classroom } = base();
  const first = Model.add(state, 'students', { classId: classroom.id, name: '김민수', number: '7' });
  const second = Model.add(state, 'students', { classId: classroom.id, name: '김민수', number: '7' });
  assert.notEqual(first.id, second.id);
  assert.equal(Model.get(state, 'students', first.id, classroom.id), first);
  assert.equal(Model.get(state, 'students', second.id, classroom.id), second);
});

test('다른 학급의 학생이나 수업 참조는 거부한다', () => {
  const { state, classroom, lesson } = base();
  const other = Model.add(state, 'classes', { name: '다른 학급' });
  const student = Model.add(state, 'students', { classId: other.id, name: '이학생' });
  assert.throws(() => Model.add(state, 'submissions', {
    classId: classroom.id, studentId: student.id, lessonId: lesson.id,
    clipId: 'clip-a', clipExpiresAt: Date.now() + Model.DAY,
  }));
});

test('기존 클립은 학생 메타데이터만으로 자동 배정되지 않는다', () => {
  const { state } = base();
  const clip = { id: 'legacy-clip', name: '김민수', number: '7' };
  assert.equal(state.submissions.length, 0);
  assert.equal(state.students.some(s => s.id === clip.id), false);
  assert.throws(() => Model.get(state, 'students', clip.id));
});

test('제출은 중복을 거부하고 만료는 원본 만료와 제출 후 7일 중 이른 시각이다', () => {
  const { state, classroom, student, lesson } = base();
  const now = Date.now();
  const originalExpiry = now + 3 * Model.DAY;
  const submission = Model.add(state, 'submissions', {
    classId: classroom.id, studentId: student.id, lessonId: lesson.id,
    clipId: 'clip-a', clipExpiresAt: originalExpiry,
  });
  assert.equal(submission.expiresAt, originalExpiry);
  assert.ok(submission.expiresAt <= submission.createdAt + 7 * Model.DAY);
  assert.throws(() => Model.add(state, 'submissions', {
    classId: classroom.id, studentId: student.id, lessonId: lesson.id,
    clipId: 'clip-a', clipExpiresAt: originalExpiry,
  }), /이미 제출/);
  const farExpiry = Model.add(state, 'submissions', {
    classId: classroom.id, studentId: student.id, lessonId: lesson.id,
    clipId: 'clip-b', clipExpiresAt: submission.createdAt + 365 * Model.DAY,
  });
  assert.equal(farExpiry.expiresAt, farExpiry.createdAt + 7 * Model.DAY);
});

test('클립 삭제는 제출을 철회하고 참조되지 않는 성찰·미전송 미디어를 정리한다', () => {
  const { state, classroom, student, lesson } = base();
  const reflection = Model.add(state, 'reflections', {
    classId: classroom.id, studentId: student.id, lessonId: lesson.id,
    clipId: 'clip-a', good: '잘함', retry: '다시 시도',
  });
  const submission = Model.add(state, 'submissions', {
    classId: classroom.id, studentId: student.id, lessonId: lesson.id,
    clipId: 'clip-a', reflectionId: reflection.id,
    clipExpiresAt: Date.now() + Model.DAY,
  });
  submission.clipData = 'temporary media';
  const queued = Model.enqueue(state, classroom.id, 'submit', { id: submission.id, clipData: 'temporary media' });
  Model.removeClip(state, 'clip-a');
  assert.ok(submission.deletedAt);
  assert.equal(submission.clipData, undefined);
  assert.equal(state.reflections.some(item => item.id === reflection.id), false);
  assert.equal(queued.status, 'cancelled');
  assert.ok(state.outbox.some(item => item.kind === 'delete' && item.payload.id === submission.id));
});

test('만료 시 만료 제출과 미디어를 정리하고 성찰을 제거한다', () => {
  const { state, classroom, student, lesson } = base();
  const reflection = Model.add(state, 'reflections', {
    classId: classroom.id, studentId: student.id, lessonId: lesson.id,
    clipId: 'clip-expired', good: '', retry: '',
  });
  const submission = Model.add(state, 'submissions', {
    classId: classroom.id, studentId: student.id, lessonId: lesson.id,
    clipId: 'clip-expired', reflectionId: reflection.id,
    clipExpiresAt: Date.now() + 1000,
  });
  submission.clipData = 'temporary media';
  assert.deepEqual(Model.expire(state, submission.expiresAt), [submission]);
  assert.ok(submission.deletedAt);
  assert.equal(submission.clipData, undefined);
  assert.equal(state.reflections.some(item => item.id === reflection.id), false);
});

test('feedback는 학급 내 수업을 요구하고 텍스트를 검증한다', () => {
  const { state, classroom, lesson } = base();
  const other = Model.add(state, 'classes', { name: '다른 학급' });
  const otherLesson = Model.add(state, 'lessons', { classId: other.id, name: '달리기', sport: '달리기', unit: '주법' });
  assert.throws(() => Model.add(state, 'feedback', { classId: classroom.id, lessonId: otherLesson.id, text: '좋았어요' }));
  const feedback = Model.add(state, 'feedback', { classId: classroom.id, lessonId: lesson.id, text: '좋았어요' });
  assert.equal(feedback.hidden, false);
});
