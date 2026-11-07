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

test('공식 별표 4 기준 100개 적용 범위를 제공하고 다섯 현재 종목의 범위 필요 상태를 표시한다', () => {
  assert.equal(P.DEFAULT_CATALOG.entries.length, 100);
  assert.equal(P.SUPPORTED_ITEMS.length, 5);
  for (const item of P.SUPPORTED_ITEMS) {
    assert.deepEqual(P.getAvailability(item.id), {
      status: 'available',
      itemId: item.id,
      catalogVersion: 'moe-school-health-rule-354-2025-03-10-annex4',
      reason: 'scope-required',
      scopeCount: 20,
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
  assert.equal(P.DEFAULT_CATALOG.entries.filter(entry => entry.targetGroupId === 'male').length, 50);
  assert.equal(P.DEFAULT_CATALOG.entries.filter(entry => entry.targetGroupId === 'female').length, 50);
  assert.deepEqual(P.resolveDefault({ ...scopeFor(P.DEFAULT_CATALOG.entries[0]), targetGroupConfirmed: false }).reason, 'target-group-not-confirmed');
  assert.equal(P.resolveDefault({ ...scopeFor(P.DEFAULT_CATALOG.entries[0]), schoolYear: 2025 }).reason, 'criteria-not-registered');
  assert.equal(P.resolveDefault({ ...scopeFor(P.DEFAULT_CATALOG.entries[0]), unit: 'lb' }).reason, 'criteria-not-registered');
});

test('각 공식 등급의 양 끝 경계와 0.1 단위 측정 경계를 정확히 분류한다', () => {
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
        assert.equal(criteria.status, 'available');
        for (const band of criteria.criteria.gradingCriteria.bands) {
          assert.equal(P.classify(criteria, band.min).grade, band.grade, `${targetGroupId}/${gradeGroupId}/${item.id} min ${band.min}`);
          assert.equal(P.classify(criteria, band.max).grade, band.grade, `${targetGroupId}/${gradeGroupId}/${item.id} max ${band.max}`);
        }
      }
    }
  }
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
  assert.equal(entry.percentileMethod.reason, 'not-defined-in-regulation');
});

test('대표 원문 행의 정수·소수 경계가 표와 일치한다', () => {
  const maleShuttle = P.DEFAULT_CATALOG.entries.find(entry => entry.targetGroupId === 'male' && entry.gradeGroupId === 'elementary-3' && entry.itemId === 'shuttle-run');
  assert.deepEqual(maleShuttle.gradingCriteria.bands.map(({ min, max }) => [min, max]), [[16, 22], [23, 39], [40, 64], [65, 87], [88, 100]]);
  const femaleJump = P.DEFAULT_CATALOG.entries.find(entry => entry.targetGroupId === 'female' && entry.gradeGroupId === 'high-3' && entry.itemId === 'standing-long-jump');
  assert.deepEqual(femaleJump.gradingCriteria.bands.map(({ min, max }) => [min, max]), [[94.9, 100], [100.1, 139], [139.1, 159], [159.1, 186], [186.1, 200]]);
  const maleFlexibility = P.DEFAULT_CATALOG.entries.find(entry => entry.targetGroupId === 'male' && entry.gradeGroupId === 'middle-3' && entry.itemId === 'sit-and-reach');
  assert.deepEqual(maleFlexibility.gradingCriteria.bands.map(({ min, max }) => [min, max]), [[-5.1, -3.1], [-3, 2.5], [2.6, 6.9], [7, 9.9], [10, 25]]);
});
