const test = require('node:test');
const assert = require('node:assert/strict');
const Model = require('../classroom-model.js');
const Programs = require('../paps-program-selection.js');

function fixture() {
  const state = Model.createState();
  const classroom = Model.add(state, 'classes', { name: 'PAPS 1반' });
  return { state, classroom };
}

test('별지 통계표 기준으로 다섯 체력요소와 선택 검사 종목을 제공한다', () => {
  assert.deepEqual(Programs.FACTORS.map(factor => factor.id), [
    'cardiorespiratory', 'flexibility', 'muscle-strength-endurance', 'power', 'obesity',
  ]);
  const mappedItemIds = new Set(Programs.FACTORS.flatMap(factor => factor.options.flatMap(option => option.itemIds)));
  assert.deepEqual([...mappedItemIds].sort(), Model.MEASUREMENT_ITEMS.map(item => item.id).sort());
  const middle = Object.fromEntries(Programs.FACTORS.map(factor => [
    factor.id, Programs.availableOptions(factor.id, { schoolYear: 2026, gradeGroupId: 'middle-1' }).map(option => option.id),
  ]));
  assert.deepEqual(middle, {
    cardiorespiratory: ['shuttle-run', 'run-walk', 'step-test-pei'],
    flexibility: ['sit-and-reach', 'comprehensive-flexibility'],
    'muscle-strength-endurance': ['sit-ups', 'grip-strength', 'push-ups'],
    power: ['sprint-50m', 'standing-long-jump'],
    obesity: ['body-mass-index'],
  });
  assert.deepEqual(Programs.availableOptions('cardiorespiratory', { schoolYear: 2026, gradeGroupId: 'elementary-4' }).map(option => option.id), ['shuttle-run']);
  assert.deepEqual(Programs.availableOptions('muscle-strength-endurance', { schoolYear: 2026, gradeGroupId: 'elementary-4' }).map(option => option.id), ['sit-ups', 'grip-strength']);
  assert.equal(Programs.itemIdFor('run-walk', 'middle-2', 'female'), 'run-walk-1200m');
  assert.equal(Programs.itemIdFor('run-walk', 'middle-2', 'male'), 'run-walk-1600m');
  assert.equal(Programs.itemIdFor('run-walk', 'elementary-5', 'female'), 'run-walk-1000m');
  assert.equal(Programs.itemIdFor('push-ups', 'high-1', 'female'), 'knee-push-ups');
  assert.equal(Programs.SOURCE.pdfSha256, 'c370d499772929837d35fed32b8d4d8fca195e6e07970b5a8e25efa344bc01e8');
});

test('학급·학년도별 설정은 다섯 요소에 각 한 종목을 암호화 저장 상태로 보존한다', () => {
  const { state, classroom } = fixture();
  const selections = {
    cardiorespiratory: 'run-walk', flexibility: 'sit-and-reach',
    'muscle-strength-endurance': 'push-ups', power: 'sprint-50m', obesity: 'body-mass-index',
  };
  const saved = Programs.saveSelection(state, { classId: classroom.id, schoolYear: 2026, gradeGroupId: 'middle-1', selections }, Date.UTC(2026, 10, 7));
  assert.equal(saved.source.version, 'MOE-354-2025-03-10-paps-factor-selection');
  assert.equal(saved.retentionExpiresAt, Date.UTC(2029, 2, 1));
  assert.deepEqual(Programs.getSelection(state, classroom.id, 2026).selections, selections);
  assert.equal(state.papsSelections.length, 1);
  const updated = Programs.saveSelection(state, { classId: classroom.id, schoolYear: 2026, gradeGroupId: 'middle-1', selections: { ...selections, cardiorespiratory: 'step-test-pei' } }, Date.UTC(2026, 10, 8));
  assert.equal(state.papsSelections.length, 1);
  assert.equal(updated.id, saved.id);
  assert.equal(updated.modifiedAt, Date.UTC(2026, 10, 8));
  assert.equal(updated.version, 2);
  assert.deepEqual(updated.history, [{ version: 1, changedAt: Date.UTC(2026, 10, 8), gradeGroupId: 'middle-1', selections }]);
  assert.equal(Programs.saveSelection(state, { classId: classroom.id, schoolYear: 2026, gradeGroupId: 'middle-1', selections: { ...selections, cardiorespiratory: 'step-test-pei' } }, Date.UTC(2026, 10, 9)).version, 2);
});

test('설정은 누락·추가 요소, 비적용 종목, 미지원 학년·연도와 다른 학급 ID를 거부한다', () => {
  const { state, classroom } = fixture();
  const valid = {
    cardiorespiratory: 'shuttle-run', flexibility: 'sit-and-reach',
    'muscle-strength-endurance': 'sit-ups', power: 'sprint-50m', obesity: 'body-mass-index',
  };
  assert.throws(() => Programs.validateSelection({ schoolYear: 2026, gradeGroupId: 'middle-1', selections: { ...valid, obesity: undefined } }), /각각 검사 종목 하나/);
  assert.throws(() => Programs.validateSelection({ schoolYear: 2026, gradeGroupId: 'middle-1', selections: { ...valid, extra: 'x' } }), /각각 검사 종목 하나/);
  assert.throws(() => Programs.validateSelection({ schoolYear: 2026, gradeGroupId: 'elementary-4', selections: { ...valid, cardiorespiratory: 'step-test-pei' } }), /적용되는지/);
  assert.throws(() => Programs.validateSelection({ schoolYear: 2026, gradeGroupId: 'elementary-4', selections: { ...valid, 'muscle-strength-endurance': 'push-ups' } }), /적용되는지/);
  assert.throws(() => Programs.validateSelection({ schoolYear: 2025, gradeGroupId: 'middle-1', selections: valid }), /적용되는지/);
  assert.throws(() => Programs.saveSelection(state, { classId: 'missing-class', schoolYear: 2026, gradeGroupId: 'middle-1', selections: valid }));
});

test('오래된 상태의 expire는 설정 배열을 보충하고 학급이 삭제되면 PAPS 설정을 제거한다', () => {
  const { state, classroom } = fixture();
  const selections = {
    cardiorespiratory: 'shuttle-run', flexibility: 'sit-and-reach',
    'muscle-strength-endurance': 'sit-ups', power: 'sprint-50m', obesity: 'body-mass-index',
  };
  Programs.saveSelection(state, { classId: classroom.id, schoolYear: 2026, gradeGroupId: 'middle-1', selections }, Date.UTC(2026, 10, 7));
  classroom.pendingDelete = true;
  Model.expire(state, Date.UTC(2026, 10, 8));
  assert.equal(state.papsSelections.length, 0);
  const legacyState = Model.createState();
  delete legacyState.papsSelections;
  Model.expire(legacyState, Date.UTC(2026, 10, 8));
  assert.deepEqual(legacyState.papsSelections, []);
});
