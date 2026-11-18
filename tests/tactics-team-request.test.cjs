'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../tactics-team-request');
const { createLocalAdvisor } = require('../server/tactics-llm');
const advisor = createLocalAdvisor(); let time;
function store() { time = 1000; return createStore({ now: () => time, search: input => advisor.prepareText(input) }); }
const question = { sport:'soccer', request:'코너킥 헤더', caseIds:[] };
function available() { return advisor.prepareText({ ...question, goal:'overall' }).references.map(row => row.id); }
test('handoff is a copied one-use memory value and expires at 15 minutes', () => {
  const h = store(), input = { ...question, caseIds:[available()[0]] }; h.offer(input); input.caseIds.push('mutated');
  const first = h.peek(); assert.equal(first.caseIds.length, 1); first.caseIds.push('mutated');
  assert.equal(h.consume().caseIds.length, 1); assert.equal(h.consume(), null);
  h.offer({ ...question, caseIds:[] }); time += 15*60*1000 - 1; assert.ok(h.peek()); time++; assert.equal(h.peek(), null); assert.equal(h.consume(), null);
});
test('rejects invalid input and non-current case IDs without retaining previous handoff', () => {
  const h = store(), ids = available(); h.offer({ ...question, caseIds:[ids[0]] });
  for (const bad of [{ ...question, board:{} }, { ...question, key:'private' }, { ...question, caseIds:['made-up'] }, { ...question, caseIds:[ids[0],ids[0]] }, { ...question, caseIds:['a','b','c'] }, { ...question, sport:'baseball' }, { ...question, request:'연락처 010-1234-5678 패스' }]) {
    assert.throws(() => h.offer(bad)); assert.equal(h.peek(), null);
  }
  const basketballId = advisor.prepareText({ sport:'basketball', goal:'overall', request:'리바운드 패스' }).references[0].id;
  assert.throws(() => h.offer({ ...question, caseIds:[basketballId] }), /현재 요청/);
});
test('clear explicitly drops request and never mutates source result', () => {
  const h = store(), ids = available(), original = [...ids]; h.offer({ ...question, caseIds:ids.slice(0,2) }); h.clear();
  assert.equal(h.peek(), null); assert.deepEqual(ids, original);
});

test('sparse arrays, accessor indices and extra array properties are rejected', () => {
  const h = store(); const sparse = Array(1), getter = []; Object.defineProperty(getter, '0', { get: () => available()[0], enumerable:true }); getter.length = 1;
  const extra = [available()[0]]; extra.private = 'secret';
  for (const caseIds of [sparse, getter, extra]) { assert.throws(() => h.offer({ ...question, caseIds })); assert.equal(h.peek(), null); }
});
