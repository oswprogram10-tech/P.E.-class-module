'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { classify, positiveText } = require('../server/tactics-relevance');
const { createLocalAdvisor } = require('../server/tactics-llm');
const T = require('../tactics-board');
const board = T.createBoard(), team = T.addTeam(board); T.addToken(board, { teamId: team.id, x: 100, y: 150 });
const advisor = createLocalAdvisor();
const query = (sport, request, goal = 'overall') => advisor.prepare({ board, sport, request, goal });

test('five sports retain their own sources, and mixed baseball rules stay unconfirmed', () => {
  const samples = [['basketball','리바운드 뒤 전진 패스와 후속 주자'], ['volleyball','같은 공을 잡으러 가다 충돌하는 상황'], ['soccer','코너킥에서 먼 포스트 헤더를 하는 장면'], ['dodgeball','회피한 뒤 다시 모여 캐치하는 장면'], ['teeball','아웃시키려는 송구에서 뒤쪽 백업은 어떻게?']];
  for (const [sport, request] of samples) {
    const refs = query(sport, request).references;
    assert.ok(refs.length, `${sport} ${request}`);
    assert.ok(refs.every(r => r.sport === sport || sport === 'teeball' && r.sourceSport === 'baseball'));
    assert.ok(refs.every(r => r.relevance && Array.isArray(r.unmatchedConditions)));
  }
  const mixed = query('teeball', samples[4][1]).references.filter(r => r.sourceSport === 'baseball');
  assert.ok(mixed.length && mixed.every(r => r.relevance === 'partial' && r.ruleStatus === 'unconfirmed'));
  for (const text of ['도루 수비 판정 규칙', '투구 수비 규칙', '태그업 판정 규칙', '도루 때 수비 위치 이동 규칙']) assert.ok(query('teeball', text).references.every(r => r.sourceSport !== 'baseball'));
  assert.equal(query('dodgeball', '피구의 경기 규칙을 알려주세요').references.length, 0);
});
test('matching uses supported scope and polarity, never missing conditions or goal alone', () => {
  const row = { pilotMaterialReviewStatus: 'accepted', sourceSport: 'basketball', sceneScopes: [
    { purpose:'scene-comparison', supported:'리바운드 뒤 전진 패스', missing:'수비 전환과 간격은 기록되지 않음', ruleScope:'학교 규칙 미확인' },
    { purpose:'scene-comparison', supported:'서브 뒤 이동', missing:'방향 미확인', ruleScope:'규칙 미확인' },
  ] };
  const match = classify('리바운드 뒤 패스와 수비 전환', row);
  assert.equal(match.relevance, 'partial'); assert.ok(match.unmatchedConditions.includes('transition')); assert.equal(match.scopes.length, 1);
  assert.equal(classify('수비 전환과 간격', row), null);
  assert.equal(positiveText('콜이 없었다. 방향이 기록되지 않음.').trim(), '콜이 없었다');
  const legacy = { title:'중계 위치', observed:'콜이 없었다. 중계자가 송구했다.' };
  assert.ok(classify('콜이 없어 중계 송구가 어려웠다', legacy));
  assert.equal(query('soccer', '초콜릿 케이크 맛있는 패스', 'passing').references.length, 0);
  assert.equal(query('soccer', '초콜릿 케이크 먹기', 'defense').references.length, 0);
});
test('model receives only matched scopes and the server classification', () => {
  const result = query('teeball', '아웃시키려는 송구에서 뒤쪽 백업은 어떻게?');
  const payload = JSON.parse(result.messages[1].content);
  for (const r of payload.references.filter(r => r.sourceSport === 'baseball')) {
    assert.equal(r.relevance, 'partial'); assert.equal(r.ruleStatus, 'unconfirmed');
    assert.ok(r.scopes.length && r.scopes.every(s => s.purpose === 'scene-comparison'));
    assert.ok(Array.isArray(r.unmatchedConditions));
  }
});

test('failed request can compare successful action with difference shown', () => {
  const legacy = { title:'패스 연결', observed:'선수가 동료에게 패스했다.' };
  const result = classify('패스를 연결하지 못해 공격이 막혔다', legacy);
  assert.equal(result.relevance, 'partial'); assert.ok(result.differingConditions.includes('pass'));
  assert.equal(classify('수비 전환과 패스', { title:'리바운드', observed:'수비 전환 장면이 아니다. 리바운드를 잡았다.' }), null);
});

test('communication with absent teammate remains an observed difference', () => {
  const row = { title: '중계 소통', observed: '중계 과정에서 동료가 콜했다.' };
  for (const request of ['중계 과정에서 콜할 동료가 없었다', '중계 과정에서 정보 전달 동료가 없었다']) {
    const result = classify(request, row); assert.equal(result.relevance, 'partial'); assert.ok(result.differingConditions.includes('communication'));
  }
});

test('recorded phases and actions match independent paraphrases without claiming absent details', () => {
  for (const [sport, request] of [
    ['soccer', '공을 되찾은 뒤 앞쪽으로 빠르게 달리는 장면'],
    ['soccer', '선수가 내려와 공간으로 뛰는 동료와 움직인 장면'],
    ['dodgeball', '작전 시간 이후 팀이 재정비한 경기'],
    ['dodgeball', '연장 경기에서 선수 구성을 바꾼 장면'],
    ['dodgeball', '상대보다 선수 수가 적은 상황에서 버틴 경기'],
  ]) assert.ok(query(sport, request).references.length, `${sport}: ${request}`);
  const independent = classify('상반 움직임으로 공간을 열고 서드맨에게 패스한다', {title:'내려오는 동작',observed:'한 선수가 내려오고 다른 선수는 공간으로 뛰었다. 동료가 패스했다.'});
  assert.ok(independent); assert.equal(independent.relevance,'partial'); assert.ok(independent.unmatchedConditions.includes('third_man'));
  const opposite = classify('수적 우위에서 패스하기', {title:'경기',observed:'우리 팀은 수적 우위가 없었다. 선수들이 패스했다.'});
  assert.equal(opposite.relevance,'partial'); assert.ok(opposite.differingConditions.includes('player_advantage')); assert.ok(!opposite.matchedConditions.includes('player_advantage'));
});
test('score, time, uncertain details and rule-only requests are not promoted into different facts', () => {
  const { concepts } = require('../server/tactics-relevance');
  assert.ok(!concepts('3 대 1로 점수에서 앞섰다').has('player_advantage'));
  assert.ok(!concepts('10분이 경과했다').has('late_stage'));
  assert.ok(!concepts('상대를 아웃시켰다').has('role_assignment'));
  assert.equal(classify('코트 구석 위치를 유지하는 장면', {title:'경기',observed:'코트 구석 위치는 기록되지 않았다.'}), null);
  assert.equal(query('dodgeball','연장전 규칙을 설명해 주세요').references.length, 0);
  assert.equal(query('soccer','초콜릿 케이크 먹기','defense').references.length, 0);
});

test('lineup is not an observed role agreement and possession loss is not recovery', () => {
  const lineup = classify('연장전 역할을 나눠야 할 때', {title:'연장전', observed:'연장전에서 선수 여섯 명을 기용했다.'});
  assert.ok(lineup); assert.equal(lineup.relevance, 'partial'); assert.ok(lineup.unmatchedConditions.includes('role_assignment'));
  const possession = classify('공을 빼앗아 동료에게 패스한다', {title:'패스', observed:'공을 빼앗긴 뒤 동료가 패스했다.'});
  assert.ok(possession); assert.equal(possession.relevance, 'partial'); assert.ok(possession.unmatchedConditions.includes('ball_recovery'));
  assert.ok(!possession.matchedConditions.includes('ball_recovery'));
});
test('third player absence is a difference and cannot negate a later sentence', () => {
  const result = classify('제3의 선수에게 패스하기', {title:'경기', observed:'제3의 선수가 없었다. 패스를 했다.'});
  assert.ok(result); assert.equal(result.relevance, 'partial'); assert.ok(result.differingConditions.includes('third_man'));
  assert.ok(!result.matchedConditions.includes('third_man')); assert.ok(result.matchedConditions.includes('pass')); assert.ok(!result.differingConditions.includes('pass'));
});

test('role agreement is not inferred from lineup and observed absence is a difference', () => {
  const fromLineup = classify('연장전 역할을 합의했다', { title:'연장전', observed:'연장전에서 선수를 기용했다.' });
  assert.ok(fromLineup); assert.equal(fromLineup.relevance, 'partial'); assert.ok(fromLineup.unmatchedConditions.includes('role_assignment'));
  const absent = classify('연장전 역할을 합의했다', { title:'연장전', observed:'연장전 역할을 합의하지 못했다.' });
  assert.ok(absent); assert.equal(absent.relevance, 'partial'); assert.ok(absent.differingConditions.includes('role_assignment')); assert.ok(!absent.matchedConditions.includes('role_assignment'));
  const unknown = classify('연장전 역할을 합의했다', { title:'연장전', observed:'연장전 역할 합의 여부는 확인되지 않았다.' });
  assert.ok(unknown); assert.equal(unknown.relevance, 'partial'); assert.ok(unknown.unmatchedConditions.includes('role_assignment'));
});
