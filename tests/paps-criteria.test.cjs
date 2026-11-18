const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../paps-criteria.js');

const grades = ['elementary-3', 'elementary-4', 'elementary-5', 'elementary-6', 'middle-1', 'middle-2', 'middle-3', 'high-1', 'high-2', 'high-3'];
const targetGroups = ['male', 'female'];

function scopeFor(entry) {
  return {
    itemId: entry.itemId,
    schoolYear: entry.schoolYear,
    gradeGroupId: entry.gradeGroupId,
    unit: entry.unit,
    targetGroupId: entry.targetGroupId,
    targetGroupConfirmed: true,
    criteriaVersion: entry.criteriaVersion,
  };
}

function fixture(overrides = {}) {
  return {
    ...JSON.parse(JSON.stringify(P.DEFAULT_CATALOG.entries[0])),
    criteriaVersion: 'fixture-2026-a',
    ...overrides,
  };
}

test('공식 별표 4 기준 176개 적용 범위를 제공하고 13개 종목의 범위 필요 상태를 표시한다', () => {
  assert.equal(P.DEFAULT_CATALOG.entries.length, 176);
  assert.equal(P.SUPPORTED_ITEMS.length, 13);
  const expectedScopes = new Map([
    ['run-walk-1000m', 4], ['run-walk-1200m', 6], ['run-walk-1600m', 6], ['step-test-pei', 16],
    ['push-ups', 6], ['knee-push-ups', 6], ['comprehensive-flexibility', 12],
  ]);
  for (const item of P.SUPPORTED_ITEMS) {
    const scopeCount = expectedScopes.get(item.id) || 20;
    assert.deepEqual(P.getAvailability(item.id), {
      status: 'available',
      itemId: item.id,
      catalogVersion: 'moe-school-health-rule-354-2025-03-10-annex4',
      reason: 'scope-required',
      scopeCount,
    });
  }
  assert.equal(P.getAvailability('invented-item').reason, 'unsupported-item');
  assert.equal(P.EMPTY_CATALOG.entries.length, 0);
});

test('남녀·초3부터 고3까지 각 범위를 확인한 뒤 해당 기준만 해석한다', () => {
  for (const entry of P.DEFAULT_CATALOG.entries) {
    const result = P.resolveDefault(scopeFor(entry));
    assert.equal(result.status, 'available', `${entry.targetGroupId}/${entry.gradeGroupId}/${entry.itemId}`);
    assert.deepEqual(result.criteria.gradingCriteria.bands.map(band => band.grade), [5, 4, 3, 2, 1]);
    assert.equal(result.criteria.targetGroupLabel, entry.targetGroupId === 'male' ? '남자' : '여자');
    assert.equal(result.criteria.source.reviewStatus, 'verified-official');
  }
  assert.equal(P.DEFAULT_CATALOG.entries.filter(entry => entry.targetGroupId === 'male').length, 88);
  assert.equal(P.DEFAULT_CATALOG.entries.filter(entry => entry.targetGroupId === 'female').length, 88);
  assert.deepEqual(P.resolveDefault({ ...scopeFor(P.DEFAULT_CATALOG.entries[0]), targetGroupConfirmed: false }).reason, 'target-group-not-confirmed');
  assert.equal(P.resolveDefault({ ...scopeFor(P.DEFAULT_CATALOG.entries[0]), schoolYear: 2025 }).reason, 'criteria-not-registered');
  assert.equal(P.resolveDefault({ ...scopeFor(P.DEFAULT_CATALOG.entries[0]), unit: 'lb' }).reason, 'criteria-not-registered');
});

test('각 공식 등급의 양 끝 경계와 종목별 측정 정밀도를 정확히 분류한다', () => {
  for (const targetGroupId of targetGroups) {
    for (const gradeGroupId of grades) {
      for (const item of P.SUPPORTED_ITEMS) {
        const criteria = P.resolveDefault({
          itemId: item.id,
          schoolYear: 2026,
          gradeGroupId,
          unit: item.unit,
          targetGroupId,
          targetGroupConfirmed: true,
        });
        const applicable = P.DEFAULT_CATALOG.entries.some(entry => entry.itemId === item.id && entry.targetGroupId === targetGroupId && entry.gradeGroupId === gradeGroupId);
        if (!applicable) {
          assert.equal(criteria.reason, 'criteria-not-registered', `${targetGroupId}/${gradeGroupId}/${item.id}`);
          continue;
        }
        assert.equal(criteria.status, 'available');
        for (const band of criteria.criteria.gradingCriteria.bands) {
          assert.equal(P.classify(criteria, band.min).grade, band.grade, `${targetGroupId}/${gradeGroupId}/${item.id} min ${band.min}`);
          assert.equal(P.classify(criteria, band.max).grade, band.grade, `${targetGroupId}/${gradeGroupId}/${item.id} max ${band.max}`);
        }
      }
    }
  }
});

test('50m 달리기는 공식 표의 낮은 기록일수록 높은 등급이며 끝 범위를 클램프한다', () => {
  const resolved = P.resolveDefault({
    itemId: 'sprint-50m', schoolYear: 2026, gradeGroupId: 'elementary-5', unit: '초',
    targetGroupId: 'male', targetGroupConfirmed: true,
  });
  assert.equal(resolved.status, 'available');
  assert.equal(resolved.criteria.gradingCriteria.direction, 'lower');
  assert.equal(P.classify(resolved, 13.21).grade, 5);
  assert.equal(P.classify(resolved, 13.20).grade, 4);
  assert.equal(P.classify(resolved, 10.20).grade, 3);
  assert.equal(P.classify(resolved, 10.21).grade, 4);
  assert.equal(P.classify(resolved, 8.30).grade, 1);
  assert.equal(P.classify(resolved, 20).grade, 5);
  assert.equal(P.classify(resolved, 20).clamped, true);
  assert.equal(P.classify(resolved, 5).grade, 1);
  assert.equal(P.classify(resolved, 5).clamped, true);
  assert.equal(P.classify(resolved, 10.205).reason, 'unsupported-measurement-precision');

  const female = P.resolveDefault({
    itemId: 'sprint-50m', schoolYear: 2026, gradeGroupId: 'middle-2', unit: '초',
    targetGroupId: 'female', targetGroupConfirmed: true,
  });
  assert.equal(P.classify(female, 8.60).grade, 1);
  assert.equal(P.classify(female, 12.21).grade, 5);
});

test('오래달리기-걷기는 규정 거리별 실시 학년·성별 기준과 낮은 시간 우선 등급을 적용한다', () => {
  const scope = (itemId, gradeGroupId, targetGroupId) => P.resolveDefault({
    itemId, schoolYear: 2026, gradeGroupId, unit: '초', targetGroupId, targetGroupConfirmed: true,
  });
  const elementary = scope('run-walk-1000m', 'elementary-5', 'male');
  assert.equal(elementary.status, 'available');
  assert.equal(P.classify(elementary, 480).grade, 5);
  assert.equal(P.classify(elementary, 268).grade, 1);
  assert.equal(P.classify(elementary, 240).grade, 1);
  assert.equal(P.classify(elementary, 240).clamped, true);
  assert.equal(scope('run-walk-1000m', 'middle-1', 'male').reason, 'criteria-not-registered');
  assert.equal(scope('run-walk-1200m', 'middle-1', 'male').reason, 'criteria-not-registered');

  const femaleMiddle = scope('run-walk-1200m', 'middle-1', 'female');
  assert.equal(P.classify(femaleMiddle, 355).grade, 1);
  assert.equal(P.classify(femaleMiddle, 609).grade, 5);
  const maleHigh = scope('run-walk-1600m', 'high-3', 'male');
  assert.equal(P.classify(maleHigh, 362).grade, 1);
  assert.equal(P.classify(maleHigh, 600).grade, 5);
  assert.equal(scope('run-walk-1600m', 'high-3', 'female').reason, 'criteria-not-registered');
});

test('PEI는 초5~고3의 공식 0.1점 기준만 분류하며 초3·초4 기준은 없다', () => {
  const pei = P.resolveDefault({
    itemId: 'step-test-pei', schoolYear: 2026, gradeGroupId: 'high-3', unit: '점',
    targetGroupId: 'male', targetGroupConfirmed: true,
  });
  assert.equal(pei.status, 'available');
  assert.equal(pei.criteria.gradingCriteria.direction, 'higher');
  assert.equal(P.classify(pei, 44.0).grade, 5);
  assert.equal(P.classify(pei, 76.0).grade, 1);
  assert.equal(P.classify(pei, 43.9).grade, 5);
  assert.equal(P.classify(pei, 43.9).clamped, true);
  assert.equal(P.classify(pei, 95.1).grade, 1);
  assert.equal(P.classify(pei, 95.1).clamped, true);
  assert.equal(P.classify(pei, 44.05).reason, 'unsupported-measurement-precision');
  assert.equal(P.resolveDefault({
    itemId: 'step-test-pei', schoolYear: 2026, gradeGroupId: 'elementary-4', unit: '점',
    targetGroupId: 'female', targetGroupConfirmed: true,
  }).reason, 'criteria-not-registered');
});

test('팔굽혀펴기 기준은 중·고등 학년의 해당 평가표에만 있고 종합유연성은 0~8점으로 등급화한다', () => {
  const resolve = (itemId, gradeGroupId, targetGroupId) => P.resolveDefault({
    itemId, schoolYear: 2026, gradeGroupId, unit: itemId === 'comprehensive-flexibility' ? '점' : '회',
    targetGroupId, targetGroupConfirmed: true,
  });
  const malePushups = resolve('push-ups', 'middle-1', 'male');
  assert.equal(malePushups.status, 'available');
  assert.deepEqual(malePushups.criteria.gradingCriteria.bands.map(({ min, max }) => [min, max]), [[0, 3], [4, 11], [12, 24], [25, 33], [34, 41]]);
  assert.equal(P.classify(malePushups, 24).grade, 3);
  assert.equal(resolve('push-ups', 'middle-1', 'female').reason, 'criteria-not-registered');
  assert.equal(resolve('push-ups', 'elementary-6', 'male').reason, 'criteria-not-registered');

  const femaleKneePushups = resolve('knee-push-ups', 'middle-1', 'female');
  assert.equal(femaleKneePushups.status, 'available');
  assert.deepEqual(femaleKneePushups.criteria.gradingCriteria.bands.map(({ min, max }) => [min, max]), [[0, 5], [6, 13], [14, 23], [24, 44], [45, 50]]);
  assert.equal(P.classify(femaleKneePushups, 45).grade, 1);
  assert.equal(resolve('knee-push-ups', 'middle-1', 'male').reason, 'criteria-not-registered');

  const flexibility = resolve('comprehensive-flexibility', 'middle-1', 'female');
  assert.deepEqual(flexibility.criteria.gradingCriteria.bands.map(({ min, max }) => [min, max]), [[0, 4], [5, 5], [6, 6], [7, 7], [8, 8]]);
  assert.equal(P.classify(flexibility, 4).grade, 5);
  assert.equal(P.classify(flexibility, 5).grade, 4);
  assert.equal(P.classify(flexibility, 8).grade, 1);
  assert.equal(resolve('comprehensive-flexibility', 'elementary-6', 'female').reason, 'criteria-not-registered');
});

test('범위 밖 값은 별표 4 각주대로 최저·최고 등급에 두고 백분위는 제공하지 않는다', () => {
  const entry = P.DEFAULT_CATALOG.entries.find(row => row.targetGroupId === 'male' && row.gradeGroupId === 'elementary-5' && row.itemId === 'shuttle-run');
  const resolved = P.resolveDefault(scopeFor(entry));
  const [lowest, , , , highest] = entry.gradingCriteria.bands;
  assert.deepEqual(P.classify(resolved, lowest.min - 1), {
    status: 'available', itemId: 'shuttle-run', value: lowest.min - 1, unit: '회', schoolYear: 2026,
    gradeGroupId: 'elementary-5', targetGroupId: 'male', targetGroupLabel: '남자', grade: 5,
    band: { min: lowest.min, max: lowest.max }, clamped: true,
    percentile: { status: 'unavailable', reason: 'not-defined-in-regulation' }, source: entry.source,
  });
  const upper = P.classify(resolved, highest.max + 1);
  assert.equal(upper.grade, 1);
  assert.equal(upper.clamped, true);
  assert.equal(upper.percentile.status, 'unavailable');
  assert.equal(Object.hasOwn(upper, 'score'), false);
  assert.equal(Object.hasOwn(upper, 'totalGrade'), false);

  const jump = P.resolveDefault({ itemId: 'standing-long-jump', schoolYear: 2026, gradeGroupId: 'elementary-5', unit: 'cm', targetGroupId: 'female', targetGroupConfirmed: true });
  assert.equal(P.classify(jump, 100.1).grade, 4);
  assert.equal(P.classify(jump, 100).grade, 5);
  assert.equal(P.classify(jump, 100.05).reason, 'unsupported-measurement-precision');
});

test('등록 계약은 학년도·학년군·대상·단위·실제 5등급 경계·공식 출처를 검증한다', () => {
  const valid = fixture();
  assert.equal(P.createCatalog({ catalogVersion: 'fixture-catalog', entries: [valid] }).entries.length, 1);
  assert.throws(() => P.createCatalog({ catalogVersion: 'fixture', entries: [fixture({ schoolYear: null })] }), /학년도/);
  assert.throws(() => P.createCatalog({ catalogVersion: 'fixture', entries: [fixture({ gradeGroupId: '' })] }), /학년군/);
  assert.throws(() => P.createCatalog({ catalogVersion: 'fixture', entries: [fixture({ targetGroupId: '' })] }), /대상 구분/);
  assert.throws(() => P.createCatalog({ catalogVersion: 'fixture', entries: [fixture({ unit: 'lb' })] }), /단위/);
  assert.throws(() => P.createCatalog({ catalogVersion: 'fixture', entries: [fixture({ percentileMethod: { status: 'available' } })] }), /백분위/);
  assert.throws(() => P.createCatalog({ catalogVersion: 'fixture', entries: [fixture({ source: { ...valid.source, checkedOn: '2026-02-30' } })] }), /확인일/);
  assert.throws(() => P.createCatalog({ catalogVersion: 'fixture', entries: [fixture({ source: { ...valid.source, reviewStatus: 'unverified' } })] }), /공식 출처/);
  assert.throws(() => P.createCatalog({ catalogVersion: 'fixture', entries: [fixture({ gradingCriteria: { direction: 'higher', bands: [] } })] }), /5등급/);
  assert.throws(() => P.createCatalog({ catalogVersion: 'fixture', entries: [valid, valid] }), /중복/);

  const secondScope = fixture({ gradeGroupId: 'elementary-4' });
  assert.equal(P.createCatalog({ catalogVersion: 'fixture', entries: [valid, secondScope] }).entries.length, 2);
});

test('기준이 바뀌어 같은 범위에 복수 버전이 있으면 버전을 지정해야 한다', () => {
  const current = fixture({ criteriaVersion: 'fixture-2026-a' });
  const revised = fixture({ criteriaVersion: 'fixture-2026-b' });
  const catalog = P.createCatalog({ catalogVersion: 'fixture-catalog', entries: [current, revised] });
  const scope = scopeFor(current);
  delete scope.criteriaVersion;
  assert.equal(P.resolve(catalog, scope).reason, 'criteria-version-required');
  const resolved = P.resolve(catalog, { ...scope, criteriaVersion: 'fixture-2026-b' });
  assert.equal(resolved.status, 'available');
  assert.equal(resolved.criteria.criteriaVersion, 'fixture-2026-b');
  assert.equal(P.classify(resolved, 40).grade, 3);
  assert.equal(Object.hasOwn(resolved, 'score'), false);
  assert.equal(Object.isFrozen(resolved.criteria), true);
  assert.equal(P.resolve(catalog, { ...scope, unit: 'lb' }).reason, 'criteria-not-registered');
  assert.throws(() => P.resolve({ schemaVersion: 1, catalogVersion: 'bad', entries: [fixture({ source: { reviewStatus: 'unverified' } })] }, scope), /공식 출처/);
});

test('공식 기준의 시행일·원문 해시와 백분위 미제공 근거를 함께 제공한다', () => {
  const entry = P.DEFAULT_CATALOG.entries[0];
  assert.equal(entry.source.publisher, '대한민국 교육부');
  assert.equal(entry.source.documentId, '교육부령 제354호 (2025. 3. 10. 일부개정)');
  assert.equal(entry.source.effectiveFrom, '2025-03-10');
  assert.equal(entry.source.checkedOn, P.REVIEWED_ON);
  assert.match(entry.source.pdfSha256, /^[a-f0-9]{64}$/);
  assert.match(entry.source.reference, /별표 4/);
  assert.equal(entry.source.measurementMethodReference, '별표 3, PDF 11~14쪽');
  assert.equal(entry.percentileMethod.reason, 'not-defined-in-regulation');
});

test('대표 원문 행의 정수·소수 경계가 표와 일치한다', () => {
  const maleShuttle = P.DEFAULT_CATALOG.entries.find(entry => entry.targetGroupId === 'male' && entry.gradeGroupId === 'elementary-3' && entry.itemId === 'shuttle-run');
  assert.deepEqual(maleShuttle.gradingCriteria.bands.map(({ min, max }) => [min, max]), [[16, 22], [23, 39], [40, 64], [65, 87], [88, 100]]);
  const femaleJump = P.DEFAULT_CATALOG.entries.find(entry => entry.targetGroupId === 'female' && entry.gradeGroupId === 'high-3' && entry.itemId === 'standing-long-jump');
  assert.deepEqual(femaleJump.gradingCriteria.bands.map(({ min, max }) => [min, max]), [[94.9, 100], [100.1, 139], [139.1, 159], [159.1, 186], [186.1, 200]]);
  const maleFlexibility = P.DEFAULT_CATALOG.entries.find(entry => entry.targetGroupId === 'male' && entry.gradeGroupId === 'middle-3' && entry.itemId === 'sit-and-reach');
  assert.deepEqual(maleFlexibility.gradingCriteria.bands.map(({ min, max }) => [min, max]), [[-5.1, -3.1], [-3, 2.5], [2.6, 6.9], [7, 9.9], [10, 25]]);
  const maleSprint = P.DEFAULT_CATALOG.entries.find(entry => entry.targetGroupId === 'male' && entry.gradeGroupId === 'elementary-3' && entry.itemId === 'sprint-50m');
  assert.deepEqual(maleSprint.gradingCriteria.bands.map(({ min, max }) => [min, max]), [[14.41, 16.56], [11.01, 14.4], [9.81, 11], [9.01, 9.8], [8.8, 9]]);
  assert.equal(maleSprint.source.reference, '별표 4 남자 기준표, PDF 17쪽');
  const femaleSprint = P.DEFAULT_CATALOG.entries.find(entry => entry.targetGroupId === 'female' && entry.gradeGroupId === 'high-3' && entry.itemId === 'sprint-50m');
  assert.deepEqual(femaleSprint.gradingCriteria.bands.map(({ min, max }) => [min, max]), [[12.21, 13.51], [10.51, 12.2], [9.51, 10.5], [8.81, 9.5], [8.6, 8.8]]);
  assert.equal(femaleSprint.source.reference, '별표 4 여자 기준표, PDF 18쪽');
});

test('별표 5 항목 점수는 등급 구간을 균등 분할하고 최소·최대 범위를 0·20점으로 처리한다', () => {
  const resolve = itemId => P.resolveDefault({
    itemId, schoolYear: 2026, gradeGroupId: 'elementary-5', unit: P.SUPPORTED_ITEMS.find(item => item.id === itemId).unit,
    targetGroupId: 'male', targetGroupConfirmed: true,
  });
  const shuttle = resolve('shuttle-run');
  assert.equal(P.scoreItem(shuttle, 21).score, 0);
  assert.deepEqual([22, 23, 24, 25, 26, 27, 28].map(value => P.scoreItem(shuttle, value).score), [0, 1, 1, 2, 2, 3, 3]);
  assert.deepEqual([29, 33, 34, 39, 40, 44, 45, 49].map(value => P.scoreItem(shuttle, value).score), [4, 4, 5, 5, 6, 6, 7, 7]);
  assert.deepEqual([100, 101, 102, 103, 104, 105, 106, 107, 108].map(value => P.scoreItem(shuttle, value).score), [16, 16, 17, 17, 18, 19, 19, 20, 20]);

  const sprint = resolve('sprint-50m');
  assert.equal(P.scoreItem(sprint, 15.56).score, 0);
  assert.equal(P.scoreItem(sprint, 13.21).score, 3);
  assert.equal(P.scoreItem(sprint, 8.50).score, 16);
  assert.equal(P.scoreItem(sprint, 8.31).score, 19);
  assert.equal(P.scoreItem(sprint, 8.30).score, 20);

  const flexibility = P.resolveDefault({ itemId: 'comprehensive-flexibility', schoolYear: 2026, gradeGroupId: 'middle-1', unit: '점', targetGroupId: 'female', targetGroupConfirmed: true });
  assert.deepEqual([0, 4, 5, 6, 7, 8].map(value => P.scoreItem(flexibility, value).score), [4, 4, 8, 12, 16, 20]);
  assert.equal(P.scoreItem(flexibility, 8).scoreMethodVersion, 'MOE-354-2025-03-10-annex5');
  assert.match(P.SCORE_SOURCE.reference, /별표 5.*PDF 20쪽/);
  assert.equal(P.scoreItem(shuttle, 10.205).reason, 'unsupported-measurement-precision');
});

test('모든 공식 적용 범위의 별표 5 점수 경계가 등급별 기대 점수와 일치한다', () => {
  const gradePointBounds = new Map([[5, [0, 3]], [4, [4, 7]], [3, [8, 11]], [2, [12, 15]], [1, [16, 20]]]);
  for (const entry of P.DEFAULT_CATALOG.entries) {
    const resolved = P.resolveDefault({
      itemId: entry.itemId, schoolYear: entry.schoolYear, gradeGroupId: entry.gradeGroupId,
      unit: entry.unit, targetGroupId: entry.targetGroupId, criteriaVersion: entry.criteriaVersion,
      targetGroupConfirmed: true,
    });
    const direction = entry.gradingCriteria.direction;
    for (const band of entry.gradingCriteria.bands) {
      if (entry.itemId === 'comprehensive-flexibility') {
        const expected = (6 - band.grade) * 4;
        assert.equal(P.scoreItem(resolved, band.min).score, expected, `${entry.targetGroupId}/${entry.gradeGroupId}/${entry.itemId} grade ${band.grade}`);
        continue;
      }
      const [minExpected, maxExpected] = gradePointBounds.get(band.grade);
      const performanceMinimum = direction === 'lower' ? band.max : band.min;
      const performanceMaximum = direction === 'lower' ? band.min : band.max;
      assert.equal(P.scoreItem(resolved, performanceMinimum).score, minExpected, `${entry.targetGroupId}/${entry.gradeGroupId}/${entry.itemId} grade ${band.grade} min`);
      assert.equal(P.scoreItem(resolved, performanceMaximum).score, maxExpected, `${entry.targetGroupId}/${entry.gradeGroupId}/${entry.itemId} grade ${band.grade} max`);
    }
  }
});
