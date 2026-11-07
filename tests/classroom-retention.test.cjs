const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('../classroom-model');
test('seven-day expiration removes class records and cancels sensitive pending payloads', () => {
  const s = M.createState(); const cls = M.add(s, 'classes', { name: '학급' });
  const student = M.add(s, 'students', { classId: cls.id, name: '가상 학생' });
  const lesson = M.add(s, 'lessons', { classId: cls.id, name: '수업', sport: '공', unit: '협동' });
  const reflection = M.add(s, 'reflections', { classId: cls.id, studentId: student.id, lessonId: lesson.id, clipId: 'clip', good: '잘함' });
  const sub = M.add(s, 'submissions', { classId: cls.id, studentId: student.id, lessonId: lesson.id, clipId: 'clip', clipExpiresAt: Date.now() + 7 * M.DAY, reflectionId: reflection.id, clipData: 'sensitive' });
  M.add(s, 'notes', { classId: cls.id, studentId: student.id, lessonId: lesson.id, text: '관찰' });
  M.add(s, 'feedback', { classId: cls.id, studentId: student.id, lessonId: lesson.id, text: '칭찬' });
  M.enqueue(s, cls.id, 'submit', { id: sub.id, studentId: student.id, lessonId: lesson.id, clipData: 'sensitive', expiresAt: sub.expiresAt });
  M.expire(s, Date.now() + 8 * M.DAY);
  for (const type of ['classes', 'students', 'lessons', 'groups', 'devices', 'reflections', 'notes', 'feedback']) assert.equal(s[type].length, 0, type);
  assert.ok(sub.deletedAt); assert.equal(sub.clipData, undefined);
  assert.equal(JSON.stringify(s.outbox).includes('sensitive'), false);
  assert.equal(s.outbox.length, 1); assert.equal(s.outbox[0].kind, 'delete');
});
