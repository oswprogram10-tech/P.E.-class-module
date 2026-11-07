(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TacticsBoard = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const PROMPTS = Object.freeze({ planned: '계획한 것', performed: '실행된 것', next: '다음에 바꿀 점' });
  const LIMITS = Object.freeze({ dimension: 2000, objects: 200, text: 500 });
  const copy = value => JSON.parse(JSON.stringify(value));
  function keys(value, allowed) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !allowed.includes(k))) throw new Error('Unexpected or invalid fields');
  }
  function dimension(n) {
    if (!Number.isFinite(n) || n <= 0 || n > LIMITS.dimension) throw new Error('Invalid board dimensions');
    return n;
  }
  function point(p, board) {
    keys(p, ['x', 'y']);
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.y < 0 || p.x > board.width || p.y > board.height) throw new Error('Position outside board');
    return { x: p.x, y: p.y };
  }
  function exists(items, id) {
    const item = items.find(entry => entry.id === id);
    if (!item) throw new Error('Unknown ID');
    return item;
  }
  function addId(board, kind) {
    const key = 'next' + kind[0].toUpperCase() + kind.slice(1);
    if (!Number.isSafeInteger(board[key]) || board[key] < 1 || board[key] >= Number.MAX_SAFE_INTEGER) throw new Error('Invalid ID counter');
    return kind + '-' + board[key]++;
  }
  function capacity(items) { if (items.length >= LIMITS.objects) throw new Error('Board limit reached'); }
  function createBoard(options) {
    options = options || {};
    keys(options, ['width', 'height']);
    return { version: 1, width: dimension(options.width === undefined ? 1000 : options.width), height: dimension(options.height === undefined ? 600 : options.height), nextTeam: 1, nextToken: 1, nextArrow: 1, nextMark: 1, teams: [], tokens: [], arrows: [], marks: [], snapshots: { before: null, after: null }, reflection: { planned: '', performed: '', next: '' } };
  }
  function addTeam(board, data) {
    keys(data || {}, []); capacity(board.teams);
    const team = { id: addId(board, 'team') }; board.teams.push(team); return copy(team);
  }
  function addToken(board, data) {
    keys(data, ['teamId', 'x', 'y']); exists(board.teams, data.teamId); capacity(board.tokens);
    const pos = point({ x: data.x, y: data.y }, board);
    const token = { id: addId(board, 'token'), teamId: data.teamId, ...pos }; board.tokens.push(token); return copy(token);
  }
  function moveToken(board, id, position) { const pos = point(position, board); Object.assign(exists(board.tokens, id), pos); }
  function removeToken(board, id) { exists(board.tokens, id); board.tokens = board.tokens.filter(item => item.id !== id); }
  function removeTeam(board, id) {
    exists(board.teams, id);
    if (board.tokens.some(token => token.teamId === id)) throw new Error('Remove team tokens first');
    board.teams = board.teams.filter(item => item.id !== id);
  }
  function addArrow(board, data) {
    keys(data, ['kind', 'from', 'to']);
    if (!['movement', 'pass'].includes(data.kind)) throw new Error('Invalid arrow kind');
    const from = point(data.from, board), to = point(data.to, board); capacity(board.arrows);
    const arrow = { id: addId(board, 'arrow'), kind: data.kind, from, to }; board.arrows.push(arrow); return copy(arrow);
  }
  function addMark(board, data) {
    keys(data, ['kind', 'x', 'y']);
    if (!['attack', 'defense'].includes(data.kind)) throw new Error('Invalid mark kind');
    const pos = point({ x: data.x, y: data.y }, board); capacity(board.marks);
    const mark = { id: addId(board, 'mark'), kind: data.kind, ...pos }; board.marks.push(mark); return copy(mark);
  }
  function removeArrow(board, id) { exists(board.arrows, id); board.arrows = board.arrows.filter(item => item.id !== id); }
  function removeMark(board, id) { exists(board.marks, id); board.marks = board.marks.filter(item => item.id !== id); }
  function moveArrow(board, id, data) {
    keys(data, ['from', 'to']);
    const from = point(data.from, board), to = point(data.to, board);
    Object.assign(exists(board.arrows, id), { from, to });
  }
  function moveMark(board, id, position) { const pos = point(position, board); Object.assign(exists(board.marks, id), pos); }
  function saveSnapshot(board, phase) {
    if (!['before', 'after'].includes(phase)) throw new Error('Invalid snapshot phase');
    board.snapshots[phase] = copy({ width: board.width, height: board.height, teams: board.teams, tokens: board.tokens, arrows: board.arrows, marks: board.marks });
    return copy(board.snapshots[phase]);
  }
  function setReflection(board, data, forbiddenIdentifiers) {
    keys(data, ['planned', 'performed', 'next']);
    if (forbiddenIdentifiers !== undefined && (!Array.isArray(forbiddenIdentifiers) || forbiddenIdentifiers.some(s => typeof s !== 'string' || !s.trim()))) throw new Error('Invalid identifiers');
    const result = {};
    for (const key of Object.keys(PROMPTS)) {
      const value = data[key] === undefined ? '' : data[key];
      if (typeof value !== 'string' || value.length > LIMITS.text || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error('Invalid reflection');
      if ((forbiddenIdentifiers || []).some(s => value.toLocaleLowerCase().includes(s.trim().toLocaleLowerCase()))) throw new Error('Reflection contains an identifier');
      result[key] = value;
    }
    board.reflection = result; return copy(result);
  }
  function cloneBoard(board) { return copy(board); }
  function clearBoard(board) {
    board.teams = []; board.tokens = []; board.arrows = []; board.marks = [];
    board.snapshots = { before: null, after: null }; board.reflection = { planned: '', performed: '', next: '' };
  }
  return Object.freeze({ PROMPTS, LIMITS, createBoard, addTeam, removeTeam, addToken, moveToken, removeToken, addArrow, moveArrow, removeArrow, addMark, moveMark, removeMark, saveSnapshot, setReflection, cloneBoard, clearBoard });
}));
