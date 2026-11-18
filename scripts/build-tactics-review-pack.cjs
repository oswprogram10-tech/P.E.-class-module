'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createLocalAdvisor, cleanInput, cleanAdvice } = require('../server/tactics-llm');
const T = require('../tactics-board');
const root = path.resolve(__dirname, '..');
const folder = path.join(root, 'examples/tactics-review-starter');
const scenarios = require('../examples/tactics-review-starter/scenarios.cjs');
const sources = JSON.parse(fs.readFileSync(path.join(folder, 'sources.json'), 'utf8'));
const knowledge = JSON.parse(fs.readFileSync(path.join(root, 'server/tactics-knowledge.json'), 'utf8'));
const advisor = createLocalAdvisor();
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const CHECKLIST = [
  '배치와 관찰 문장이 일치합니다.',
  '보이지 않는 공·골대·네트·시각·능력을 단정하지 않습니다.',
  '실제 학급에 맞는 안전한 활동 제안입니다.',
  '초등학생이 이해할 수 있는 설명입니다.',
  '참고자료와 제안의 관련성을 교사가 확인했습니다.',
  '학생 식별·건강·성적 평가가 없습니다.',
];
function validateCases(cases) {
  if (cases.length !== 48 || new Set(cases.map(row => row.id)).size !== cases.length) throw new Error('Expected 48 unique draft cases.');
  const hashes = new Set(), families = new Map();
  for (const row of cases) {
    const input = cleanInput(row.input), prepared = advisor.prepare(input);
    cleanAdvice(row.draftAdvice, prepared.references);
    if (row.review.status !== 'pending' || row.review.reviewed !== false || row.provenance.kind !== 'assistant-authored-synthetic-draft') throw new Error('Drafts must never be marked teacher reviewed.');
    if (!['train-candidate', 'evaluation-holdout'].includes(row.split) || row.sourceIds.some(id => !sources.sources.some(source => source.id === id))) throw new Error('Invalid split/source.');
    const layoutHash = digest(T.anonymousLayout(input.board));
    if (hashes.has(layoutHash)) throw new Error('Duplicate geometry: ' + row.id);
    hashes.add(layoutHash);
    if (families.has(row.familyId) && families.get(row.familyId) !== row.split) throw new Error('Family appears in training and evaluation: ' + row.familyId);
    families.set(row.familyId, row.split);
    for (const team of input.board.teams) if (!/^team-\d+$/.test(team.id)) throw new Error('Non-anonymous team.');
    for (const token of input.board.tokens) if (!/^token-\d+$/.test(token.id)) throw new Error('Non-anonymous token.');
  }
  for (const sport of ['basketball', 'volleyball']) for (const goal of ['spacing', 'passing', 'defense']) {
    if (cases.filter(row => row.sport === sport && row.goal === goal && row.split === 'train-candidate').length !== 6 || cases.filter(row => row.sport === sport && row.goal === goal && row.split === 'evaluation-holdout').length !== 2) throw new Error('Unbalanced case selection.');
  }
}
function build() {
  validateCases(scenarios);
  const cases = scenarios.map(row => ({ ...row, fingerprint: digest({ input: row.input, draftAdvice: row.draftAdvice }) }));
  const systemPrompt = advisor.prepare(cases[0].input).messages[0].content;
  const pack = { schemaVersion: 1, createdOn: '2026-11-12', packId: digest({ cases, knowledge, sources, systemPrompt, checklist: CHECKLIST }), notice: '48개 모두 AI 작성 합성 초안입니다. 교사 검토·현장 검증·모델 학습을 완료한 자료가 아닙니다.', checklist: CHECKLIST, systemPrompt, knowledge, sources: sources.sources, cases };
  fs.writeFileSync(path.join(folder, 'draft-cases.jsonl'), cases.map(row => JSON.stringify(row)).join('\n') + '\n');
  const cell = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const csv = [['사례ID', '용도', '종목', '목표', '상황', '관찰 초안', '연습 제안 초안', '이유 초안', '진행 단계 초안', '불확실성', '개별 검토 기준', '참고자료', '검토 상태', '교사 의견']];
  for (const row of cases) csv.push([row.id, row.split === 'train-candidate' ? '학습 후보' : '평가 전용', row.sport === 'basketball' ? '농구' : '배구', { spacing: '간격', passing: '패스', defense: '수비' }[row.goal], row.title, row.draftAdvice.summary, row.draftAdvice.suggestions[0].title, row.draftAdvice.suggestions[0].reason, row.draftAdvice.suggestions[0].steps.join(' / '), row.expectedUncertainty, row.reviewCriteria.join(' / '), row.sourceIds.join(' | '), '교사 검토 전', '']);
  fs.writeFileSync(path.join(folder, 'review-sheet.csv'), '\ufeff' + csv.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n');
  const template = fs.readFileSync(path.join(__dirname, 'tactics-review-template.html'), 'utf8');
  fs.writeFileSync(path.join(folder, 'review-pack.html'), template.replace('__PACK_DATA__', JSON.stringify(pack).replace(/</g, '\\u003c')));
  fs.writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify({ schemaVersion: 1, packId: pack.packId, createdOn: pack.createdOn, counts: { total: cases.length, trainingCandidates: 36, evaluationHoldouts: 12, teacherReviewed: 0 }, files: Object.fromEntries(['draft-cases.jsonl', 'review-sheet.csv', 'review-pack.html', 'sources.json'].map(name => [name, crypto.createHash('sha256').update(fs.readFileSync(path.join(folder, name))).digest('hex')])) }, null, 2) + '\n');
  return pack;
}
if (require.main === module) { const pack = build(); process.stdout.write(`Prepared ${pack.cases.length} unreviewed synthetic cases: 36 training candidates / 12 evaluation holdouts.\n`); }
module.exports = { build, validateCases };
