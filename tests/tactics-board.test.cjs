const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const M = require('../tactics-board.js');

test('anonymous stable identifiers and bounded positions', () => {
  const board = M.createBoard({ width: 100, height: 50 });
  const team = M.addTeam(board);
  const token = M.addToken(board, { teamId: team.id, x: 0, y: 50 });
  M.moveToken(board, token.id, { x: 100, y: 0 });
  assert.deepEqual(board.tokens[0], { ...token, x: 100, y: 0 });
  assert.throws(() => M.addToken(board, { teamId: team.id, x: 1, y: 1, studentId: 'student-1' }));
  assert.throws(() => M.addTeam(board, { name: 'student' }));
  assert.throws(() => M.moveToken(board, token.id, { x: -1, y: 0 }));
  assert.throws(() => M.addToken(board, { teamId: 'external-id', x: 0, y: 0 }));
  assert.throws(() => M.removeTeam(board, team.id));
  M.removeToken(board, token.id); M.removeTeam(board, team.id);
  assert.notEqual(M.addTeam(board).id, team.id);
  assert.throws(() => M.createBoard({ width: Infinity }));
});

test('arrows, marks, snapshots and clone are independent', () => {
  const b = M.createBoard();
  const team = M.addTeam(b); const token = M.addToken(b, { teamId: team.id, x: 10, y: 20 });
  const arrow = M.addArrow(b, { kind: 'pass', from: { x: 10, y: 20 }, to: { x: 100, y: 200 } });
  const mark = M.addMark(b, { kind: 'defense', x: 0, y: 0 });
  M.moveArrow(b, arrow.id, { from: { x: 1, y: 2 }, to: { x: 3, y: 4 } });
  M.moveMark(b, mark.id, { x: 5, y: 6 });
  assert.deepEqual(b.arrows[0].to, { x: 3, y: 4 });
  assert.equal(b.marks[0].x, 5);
  M.saveSnapshot(b, 'before'); M.moveToken(b, token.id, { x: 30, y: 40 });
  M.removeArrow(b, arrow.id); M.removeMark(b, mark.id); M.saveSnapshot(b, 'after');
  assert.equal(b.snapshots.before.tokens[0].x, 10);
  assert.equal(b.snapshots.after.tokens[0].x, 30);
  assert.equal(b.snapshots.before.arrows.length, 1);
  const cloned = M.cloneBoard(b); M.clearBoard(b);
  assert.equal(cloned.snapshots.before.arrows.length, 1);
  assert.equal(b.snapshots.before, null);
  assert.notEqual(M.addTeam(b).id, team.id);
  assert.throws(() => M.addArrow(b, { kind: 'pass', from: { x: 0, y: 0 }, to: { x: 1001, y: 0 } }));
  assert.throws(() => M.addMark(b, { kind: 'other', x: 1, y: 1 }));
});

test('reflection fields are bounded and known identifiers can be rejected', () => {
  const b = M.createBoard();
  M.setReflection(b, { planned: '공간으로 이동', performed: '패스', next: '간격 유지' });
  assert.equal(b.reflection.next, '간격 유지');
  assert.throws(() => M.setReflection(b, { planned: 'student-12' }, ['student-12']));
  assert.throws(() => M.setReflection(b, { studentId: '12' }));
  assert.throws(() => M.setReflection(b, { planned: 'x'.repeat(501) }));
  assert.equal(b.reflection.next, '간격 유지');
});

test('browser UMD and CommonJS expose the same API', () => {
  const context = {}; vm.runInNewContext(fs.readFileSync(require.resolve('../tactics-board.js'), 'utf8'), context);
  assert.deepEqual(Object.keys(context.TacticsBoard), Object.keys(M));
});
