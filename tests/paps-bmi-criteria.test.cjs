const test = require('node:test');
const assert = require('node:assert/strict');
const BMI = require('../paps-bmi-criteria.js');
const data = require('../paps-bmi-criteria-data.js');

test('2026 별표 4 BMI 기준은 남녀 초3~고3의 20개 범위와 원문 식별 정보를 제공한다', () => {
  assert.equal(data.schoolYear, 2026);
  assert.equal(data.source.reference, '별표 4, PDF 19쪽, 신체능력검사(필수평가) 비만 평가 기준: BMI');
  assert.equal(data.source.pdfSha256, 'c370d499772929837d35fed32b8d4d8fca195e6e07970b5a8e25efa344bc01e8');
  for (const targetGroupId of ['male', 'female']) for (const gradeGroupId of data.grades) {
    const resolved = BMI.resolveDefault({ schoolYear: 2026, gradeGroupId, targetGroupId, targetGroupConfirmed: true });
    assert.equal(resolved.status, 'available', `${targetGroupId}/${gradeGroupId}`);
    assert.equal(resolved.bands[0].min, 0);
    assert.equal(resolved.bands.at(-1).max, null);
    for (const band of resolved.bands) {
      assert.equal(BMI.classify(resolved, band.min).categoryId, band.categoryId);
      if (band.max !== null) assert.equal(BMI.classify(resolved, band.max).categoryId, band.categoryId);
    }
    for (let index = 1; index < resolved.bands.length; index++) {
      assert.ok(Math.abs(resolved.bands[index].min - resolved.bands[index - 1].max - 0.1) < 1e-9, `${targetGroupId}/${gradeGroupId} contiguous at ${index}`);
    }
  }
  assert.deepEqual(BMI.CATEGORIES.map(item => item.id), ['underweight', 'normal', 'overweight', 'mild-obesity', 'overweight-mild-obesity', 'severe-obesity']);
});

test('표 경계와 남자 고2·고3의 합쳐진 공식 구간을 구분해 판정한다', () => {
  const male = gradeGroupId => BMI.resolveDefault({ schoolYear: 2026, gradeGroupId, targetGroupId: 'male', targetGroupConfirmed: true });
  const fifth = male('elementary-5');
  assert.equal(BMI.classify(fifth, 14.5).categoryId, 'underweight');
  assert.equal(BMI.classify(fifth, 14.6).categoryId, 'normal');
  assert.equal(BMI.classify(fifth, 21.6).categoryId, 'normal');
  assert.equal(BMI.classify(fifth, 21.7).categoryId, 'overweight');
  assert.equal(BMI.classify(fifth, 24.4).categoryId, 'overweight');
  assert.equal(BMI.classify(fifth, 24.5).categoryId, 'mild-obesity');
  assert.equal(BMI.classify(fifth, 29.9).categoryId, 'mild-obesity');
  assert.equal(BMI.classify(fifth, 30.0).categoryId, 'severe-obesity');
  assert.equal(BMI.classify(male('high-2'), 24.9).categoryId, 'normal');
  assert.equal(BMI.classify(male('high-2'), 25.0).categoryId, 'overweight-mild-obesity');
  assert.equal(BMI.classify(male('high-3'), 29.9).categoryLabel, '과체중·경도 비만 (통합 구간)');
  const female = BMI.resolveDefault({ schoolYear: 2026, gradeGroupId: 'middle-2', targetGroupId: 'female', targetGroupConfirmed: true });
  assert.equal(BMI.classify(female, 22.7).categoryId, 'normal');
  assert.equal(BMI.classify(female, 22.8).categoryId, 'overweight');
});

test('기준 학년도·성별 확인·BMI 정밀도를 검사하고 건강 진단용 결과를 만들지 않는다', () => {
  const scope = { schoolYear: 2026, gradeGroupId: 'middle-1', targetGroupId: 'female', targetGroupConfirmed: true };
  assert.equal(BMI.resolveDefault({ ...scope, targetGroupConfirmed: false }).reason, 'target-group-not-confirmed');
  assert.equal(BMI.resolveDefault({ ...scope, schoolYear: 2025 }).reason, 'criteria-not-registered');
  assert.equal(BMI.resolveDefault({ ...scope, criteriaVersion: 'unknown' }).reason, 'criteria-not-registered');
  const resolved = BMI.resolveDefault(scope);
  assert.equal(BMI.classify(resolved, 15.24).reason, 'unsupported-measurement-precision');
  assert.equal(BMI.classify(resolved, 101).reason, 'invalid-measurement-value');
  const result = BMI.classify(resolved, 22.2);
  assert.equal(result.categoryId, 'overweight');
  assert.equal(result.unit, 'kg/m²');
  assert.equal(Object.hasOwn(result, 'diagnosis'), false);
  assert.equal(Object.hasOwn(result, 'percentile'), false);
});
