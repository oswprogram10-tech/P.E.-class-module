'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const T = require('../tactics-board');
const { createLocalAdvisor } = require('../server/tactics-llm');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
function local() { const ctx = { TacticsBoard: T, URL, fetch: async () => { throw new Error('unexpected network'); }, console }; vm.createContext(ctx); vm.runInContext(read('tactics-search-local.js'), ctx); return ctx.TacticsLocalSearch.createLocalAdvisor(); }
const board = T.createBoard(), team = T.addTeam(board); T.addToken(board, { teamId: team.id, x: 100, y: 150 });
test('offline generated search agrees with server candidates, conditions and ID guard', () => {
  const browser = local(), server = createLocalAdvisor();
  for (const [sport, request] of [['teeball','아웃시키려는 송구에서 뒤쪽 백업'], ['basketball','리바운드 뒤 전진 패스와 후속 주자'], ['volleyball','같은 공을 잡으러 가다 충돌'], ['soccer','코너킥에서 먼 포스트 헤더'], ['dodgeball','회피한 뒤 다시 모여 캐치']]) {
    const input = { board, sport, request, goal: 'overall' }, a = browser.prepare(input), b = server.prepare(input);
    assert.deepEqual(JSON.parse(JSON.stringify(a.references)), b.references);
    assert.throws(() => browser.trainingExample({ ...input, reviewed: true, advice: { caseMatches: [{ referenceId: 'unknown', similarity:'가깝다' }], comparisonLimit:'다르다' } }), /출처/);
  }
});
test('offline artifact never contains evaluation corpus', () => { assert.ok(!read('tactics-search-local.js').includes(fs.readFileSync(path.join(__dirname, '../docs/tactics-query-evaluation.csv'), 'utf8'))); });
test('unsupported storage is reported without downloading a model', async () => {
  const ctx = { URL, document: { currentScript: { src: 'https://app.example/tactics-local-advisor.js' } }, navigator: {}, isSecureContext: true, WebAssembly, Worker: class {}, DOMException };
  vm.createContext(ctx); vm.runInContext(read('tactics-local-advisor.js'), ctx);
  const status = await ctx.TacticsLocalAdvisor.status(); assert.equal(status.supported, false); assert.equal(status.installed, false); assert.match(status.reason, /지원/);
  await assert.rejects(ctx.TacticsLocalAdvisor.install(), /지원/);
});
test('a model operation in another tab prevents concurrent deletion', async () => {
  let entered = false;
  const ctx = { URL, document: { currentScript: { src: 'https://app.example/tactics-local-advisor.js' } }, navigator: { storage: { getDirectory() { entered = true; } }, locks: { request: async (_name, options, callback) => { assert.equal(options.ifAvailable, true); return callback(null); } } }, isSecureContext: true, WebAssembly, Worker: class {}, DOMException };
  vm.createContext(ctx); vm.runInContext(read('tactics-local-advisor.js'), ctx);
  await assert.rejects(ctx.TacticsLocalAdvisor.remove(), /다른 탭/); assert.equal(entered, false);
});
test('compact prompt helper preserves observed facts, missing conditions and comparisons', () => {
  const { compactReferences } = require('../tactics-local-prompt');
  const scope = { questionId:'trace', purpose:'scene-comparison', supported:'중계 송구', missing:'콜은 확인되지 않음', ruleScope:'규칙 미확인' };
  const source = { id:'TBX-01', sport:'baseball', targetSport:'teeball', observed:'중계했다.', context:'날짜 미확인', candidateGrade:'A', factStatus:'article-checked', pilotMaterialReviewStatus:'accepted', relevance:'partial', unmatchedConditions:['communication'], differingConditions:['pass'], limitations:['영상 미확인','영상 미확인'], scopes:[scope, { ...scope, questionId:'another' }], sourceUrl:'https://example.test' };
  const compact = compactReferences([source, source, source, source]); assert.equal(compact.length, 3);
  assert.equal(compact[0].observed, source.observed); assert.equal(compact[0].context, source.context);
  assert.equal(compact[0].scopes.length, 1); assert.equal(compact[0].scopes[0].missing, scope.missing);
  assert.deepEqual(compact[0].unmatchedConditions, source.unmatchedConditions); assert.deepEqual(compact[0].differingConditions, source.differingConditions);
  assert.deepEqual(compact[0].limitations, ['영상 미확인']); assert.equal(compact[0].sourceUrl, undefined);
});
test('pinned Qwen tokenizer preserves Hangul and ChatML token identities', async () => {
  const { Tokenizer } = await import('../vendor/hf-tokenizers/tokenizers.mjs');
  const tokenizer = new Tokenizer(JSON.parse(read('vendor/qwen-tokenizer/tokenizer.json')), JSON.parse(read('vendor/qwen-tokenizer/tokenizer_config.json')));
  for (const [text, ids] of [['안녕하세요',[126246,144370,91145]], ['<|im_start|>system\n경기 비교<|im_end|>\n',[151644,8948,198,65306,20487,142350,151645,198]], ['abc 123',[13683,220,16,17,18]]]) assert.deepEqual(tokenizer.encode(text, { add_special_tokens:false }).ids, ids);
});
test('generation grammar restricts candidate identifiers, fields and text bounds', () => {
  const { responseGrammar } = require('../tactics-local-prompt');
  const grammar = responseGrammar(['TBX-01', 'soccer_case_01']);
  assert.match(grammar, /TBX-01/); assert.match(grammar, /soccer_case_01/);
  assert.match(grammar, /referenceIds/); assert.doesNotMatch(grammar, /similarity/);
  assert.throws(() => responseGrammar(['bad"id']), /ID/);
});

test('prompt dedup removes only exact context duplicates and fully included missing conditions', () => {
  const { compactReference } = require('../tactics-local-prompt');
  const row = { id:'X', sport:'soccer', observed:'관찰', context:'경기 · 학교 규칙 · 누락 조건', limitations:['누락 조건'], scopes:[{ supported:'패스', missing:'방향 미확인', ruleScope:'학교 규칙' }, { supported:'패스', missing:'방향 미확인; 거리 미확인', ruleScope:'학교 규칙' }, { supported:'수비', missing:'방향 미확인', ruleScope:'학교 규칙' }] };
  const result = compactReference(row); assert.equal(result.context, '경기'); assert.deepEqual(result.limitations, ['누락 조건']);
  assert.equal(result.scopes.length, 2); assert.equal(result.scopes[0].missing, '방향 미확인; 거리 미확인'); assert.equal(result.scopes[1].supported, '수비');
});

test('selection IDs reject duplicates, unknowns, excess and extra fields', () => {
  const { validateSelection, selectionReferences } = require('../tactics-local-prompt');
  const rows = [{id:'a',sport:'soccer',observed:'프리킥 헤더',relevance:'partial'}, {id:'b',sport:'soccer',observed:'코너킥 헤더',relevance:'partial'}];
  assert.deepEqual(validateSelection({referenceIds:['b','a']}, rows), [rows[1],rows[0]]);
  for (const bad of [{referenceIds:['a','a']},{referenceIds:['x']},{referenceIds:['a','b','a']},{referenceIds:['a'],similarity:'추측'}]) assert.throws(() => validateSelection(bad, rows));
  assert.equal(selectionReferences(rows)[0].observed, rows[0].observed);
});
test('five sport text searches need neither model nor board and preserve scope', async () => {
  const ctx = { TacticsBoard:T, URL, fetch:async () => { throw new Error('unexpected network'); }, console, document:{currentScript:{src:'https://app.example/tactics-local-advisor.js'}}, navigator:{}, DOMException };
  vm.createContext(ctx); vm.runInContext(read('tactics-search-local.js'), ctx); vm.runInContext(read('tactics-local-prompt.js'),ctx); vm.runInContext(read('tactics-local-advisor.js'),ctx);
  for (const [sport,request] of [['basketball','리바운드 뒤 전진 패스와 후속 주자'],['volleyball','같은 공을 잡으러 가다 충돌'],['soccer','코너킥 헤더'],['teeball','중계 송구와 수비 위치 이동'],['dodgeball','회피한 뒤 다시 모여 캐치']]) {
    const result = await ctx.TacticsLocalAdvisor.search({sport,request,goal:'overall'}); assert.equal(result.modelUsed,false); assert.equal(result.resultKind,'retrieval'); assert.ok(result.cases.length,sport); assert.ok(result.cases.every(row => row.similarityOrigin === 'source' && row.observed && row.sourceUrl));
    const pilot = result.cases.find(row => row.pilotMaterialReviewStatus === 'accepted'); if (pilot) assert.ok(pilot.scopes.length && pilot.scopes[0].missing);
  }
  await assert.rejects(ctx.TacticsLocalAdvisor.search({sport:'soccer',goal:'overall',request:'연락처 010-1234-5678 패스'}), /연락처/);
  const empty = await ctx.TacticsLocalAdvisor.suggest({sport:'soccer',goal:'overall',request:'초콜릿 케이크 먹기'}); assert.equal(empty.modelUsed,false); assert.equal(empty.cases.length,0);
});


test('candidate planning fits whole profiles and exposes omitted candidates', () => {
  const { planCandidates, validateSelection, responseGrammar } = require('../tactics-local-prompt');
  const rows = [{id:'a', sport:'baseball', targetSport:'teeball', observed:'매우 긴 원문'.repeat(80), relevance:'partial'}, {id:'b', sport:'baseball', targetSport:'teeball', observed:'놓치지 않았다.', relevance:'partial', ruleStatus:'unconfirmed', matchedConditions:['backup'], scopes:[{supported:'뒤쪽 백업',missing:'회수 여부 미확인',ruleScope:'득점 규칙 제외',matchedConditions:['backup']}]}, {id:'c',sport:'soccer',observed:'수비했다.'}];
  const count = value => value.length;
  const plan = planCandidates({request:'백업', sport:'teeball', references:rows, tokenCount:count, budget:900});
  assert.ok(plan.tokens <= 900); assert.deepEqual(plan.references.map(row => row[0]), ['b','c']); assert.equal(plan.omittedCount, 1);
  assert.deepEqual(plan.references[0][8], ['뒤쪽 백업','회수 여부 미확인','득점 규칙 제외']);
  assert.match(plan.prompt, /"shownCandidates":2/); assert.throws(() => validateSelection({referenceIds:['a']}, rows.filter(row => plan.references.some(ref => ref[0] === row.id))));
  assert.throws(() => planCandidates({request:'긴 요청'.repeat(1000),sport:'soccer',references:rows,tokenCount:count,budget:900}), /한도/);
  assert.throws(() => planCandidates({request:'',sport:'',references:[rows[1],rows[1]],tokenCount:count}), /ID/);
  assert.doesNotThrow(() => responseGrammar(['a','b','c','d','e','f','g','h']));
  assert.throws(() => responseGrammar(['a','a']), /ID/);
});
