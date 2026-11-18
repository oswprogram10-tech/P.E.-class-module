'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadPilot, parseCsv } = require('../server/tactics-pilot-loader');
const { createLocalAdvisor } = require('../server/tactics-llm');
const docs = path.join(__dirname, '../docs');
const manifest = path.join(docs, 'tactics-pilot-status.json');
const T = require('../tactics-board');
const board = T.createBoard(); const team = T.addTeam(board); T.addToken(board, { teamId: team.id, x: 100, y: 150 });

test('accepted materials preserve 29 cases, 122 scopes and article limitations', () => {
  const cases = loadPilot(manifest);
  assert.equal(cases.length, 29); assert.equal(cases.reduce((n, c) => n + c.scopes.length, 0), 122);
  const tb = cases.find(c => c.id === 'TBX-01');
  assert.equal(tb.sport, 'baseball'); assert.equal(tb.educatorReviewStatus, 'pending');
  assert.ok(tb.scopes.some(s => s.questionId === 'TE-14-06' && s.purpose === 'evidence-boundary-reference'));
  assert.ok(tb.sceneScopes.every(s => s.purpose === 'scene-comparison'));
});
test('pilot search keeps sport and shared-skill boundaries and never includes evaluation text', () => {
  const read = fs.readFileSync;
  fs.readFileSync = function(file, ...args) { if (String(file).endsWith('tactics-query-evaluation.csv')) throw new Error('evaluation file accessed'); return read.call(this, file, ...args); };
  let advisor; try { advisor = createLocalAdvisor(); } finally { fs.readFileSync = read; }
  const input = { board, sport: 'teeball', goal: 'overall', request: '중계자의 연결 위치 이동과 수비 위치 지원' };
  const result = advisor.prepare(input);
  assert.ok(result.references.some(r => r.sourceSport === 'baseball' && r.comparisonType === 'shared-skill'));
  assert.ok(result.references.every(r => r.sport === 'teeball' || r.sourceSport === 'baseball' && r.targetSport === 'teeball'));
  for (const request of ['태그업 상황에서 주자가 출발하는 규칙', '도루할 때 주자를 아웃시키는 방법']) assert.ok(advisor.prepare({ ...input, request }).references.every(r => r.sourceSport !== 'baseball'));
  const other = advisor.prepare({ ...input, sport: 'soccer', request: '리바운드 뒤 전진 패스 후속 주자' });
  assert.ok(other.references.every(r => r.sport === 'soccer'));
  const evaluation = fs.readFileSync(path.join(docs, 'tactics-query-evaluation.csv'), 'utf8');
  const lines = evaluation.split(/\r?\n/).slice(1).filter(Boolean);
  assert.ok(lines.length >= 450);
  assert.ok(lines.every(line => !JSON.stringify(result.messages).includes(line)));
  assert.ok(!JSON.stringify(result.messages).includes('TE-14-06'));
});
test('strict inputs reject broken CSV and duplicate identifiers; unaccepted manifest is disabled', () => {
  assert.throws(() => parseCsv('a,b\n"bad,x'));
  assert.throws(() => parseCsv('a,b\nx'));
  assert.throws(() => loadPilot(manifest, ['TBX-01']), /ID/);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-'));
  try { const m = JSON.parse(fs.readFileSync(manifest)); m.pilotMaterialReviewStatus = 'pending'; fs.writeFileSync(path.join(tmp, 'manifest.json'), JSON.stringify(m)); assert.deepEqual(loadPilot(path.join(tmp, 'manifest.json')), []); }
  finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
test('explicit legacy knowledge override does not implicitly load pilot', () => {
  const advisor = createLocalAdvisor({ knowledgePath: path.join(__dirname, '../server/tactics-knowledge.json') });
  const result = advisor.prepare({ board, sport: 'teeball', goal: 'overall', request: '중계자의 연결 위치 이동과 수비 위치 지원' });
  assert.ok(result.references.every(r => r.sport === 'teeball' && !r.pilotMaterialReviewStatus));
});

test('pilot loader rejects bundle files that escape through symlinks', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-path-'));
  try {
    const m = JSON.parse(fs.readFileSync(manifest));
    fs.writeFileSync(path.join(tmp, 'manifest.json'), JSON.stringify(m));
    fs.symlinkSync(path.join(docs, m.acceptedResearchBundles[0].caseFile), path.join(tmp, m.acceptedResearchBundles[0].caseFile));
    assert.throws(() => loadPilot(path.join(tmp, 'manifest.json')), /경로/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('reviewed pilot training example preserves baseball origin and evidence limits', () => {
  const advisor = createLocalAdvisor();
  const input = { board, sport: 'teeball', goal: 'overall', request: '중계자의 연결 위치 이동과 수비 위치 지원' };
  const reference = advisor.prepare(input).references.find(r => r.sourceSport === 'baseball');
  assert.ok(reference);
  const example = advisor.trainingExample({ ...input, reviewed: true, advice: { caseMatches: [{ referenceId: reference.id, similarity: '중계 위치 이동을 비교합니다.' }], comparisonLimit: '규칙과 경기 맥락이 다릅니다.' } });
  const row = JSON.parse(example.messages[2].content).cases[0];
  assert.equal(row.sourceSport, 'baseball'); assert.equal(row.targetSport, 'teeball');
  assert.equal(row.pilotMaterialReviewStatus, 'accepted'); assert.equal(row.claimCheckStatus, 'article-checked');
  assert.equal(row.educatorReviewStatus, 'pending'); assert.equal(row.expertReviewStatus, 'pending');
  assert.deepEqual(row.limitations, reference.limitations); assert.deepEqual(row.scopes, reference.scopes);
  assert.ok(row.limitations.length && row.scopes.length);
});
