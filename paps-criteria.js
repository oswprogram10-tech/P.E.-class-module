(function (root) {
  'use strict';

  const model = typeof module !== 'undefined' && module.exports
    ? require('./classroom-model.js')
    : root.ClassroomModel;
  const sourceData = typeof module !== 'undefined' && module.exports
    ? require('./paps-criteria-data.js')
    : root.PapsCriteriaData;
  if (!model?.MEASUREMENT_ITEMS) throw new Error('ClassroomModel must load before PapsCriteria.');
  if (!sourceData?.data || !sourceData?.source) throw new Error('PapsCriteriaData must load before PapsCriteria.');

  const SUPPORTED_ITEMS = Object.freeze(model.MEASUREMENT_ITEMS.map(item => Object.freeze({
    id: item.id,
    unit: item.unit,
    precision: item.precision,
  })));
  const ITEM_BY_ID = new Map(SUPPORTED_ITEMS.map(item => [item.id, item]));
  const SUPPORTED_IDS = new Set(ITEM_BY_ID.keys());
  const REVIEWED_ON = sourceData.checkedOn;
  const GRADE_LEVELS = Object.freeze([5, 4, 3, 2, 1]);
  const EMPTY_CATALOG = deepFreeze({
    schemaVersion: 1,
    catalogVersion: 'empty-catalog',
    entries: [],
  });

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
    return value;
  }

  function nonEmpty(value) { return typeof value === 'string' && value.trim().length > 0; }
  function validDate(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  }
  function isObject(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
  function isAtMeasurementPrecision(value, item) {
    const scale = 10 ** item.precision;
    return Math.abs(value * scale - Math.round(value * scale)) <= 1e-7;
  }

  function validateEntry(entry) {
    if (!isObject(entry)) throw new Error('기준 항목 형식을 확인해 주세요.');
    if (!nonEmpty(entry.criteriaVersion)) throw new Error('기준 버전을 지정해 주세요.');
    if (!Number.isInteger(entry.schoolYear) || entry.schoolYear < 2000 || entry.schoolYear > 2100) throw new Error('적용 학년도를 확인해 주세요.');
    if (!nonEmpty(entry.gradeGroupId)) throw new Error('공식 학년군을 지정해 주세요.');
    if (!SUPPORTED_IDS.has(entry.itemId)) throw new Error('지원하지 않는 측정 종목입니다.');
    const item = ITEM_BY_ID.get(entry.itemId);
    if (entry.unit !== item.unit) throw new Error('공식 단위가 앱의 측정 단위와 일치하지 않습니다.');
    if (!nonEmpty(entry.targetGroupId) || !nonEmpty(entry.targetGroupLabel)) throw new Error('공식 대상 구분을 지정해 주세요.');

    const criteria = entry.gradingCriteria;
    if (!isObject(criteria) || criteria.direction !== 'higher' || !Array.isArray(criteria.bands) || criteria.bands.length !== GRADE_LEVELS.length) {
      throw new Error('출처에 따른 5등급 기준표를 등록해 주세요.');
    }
    const tick = 10 ** -item.precision;
    criteria.bands.forEach((band, index) => {
      if (!isObject(band) || band.grade !== GRADE_LEVELS[index] || !Number.isFinite(band.min) || !Number.isFinite(band.max) || band.min > band.max) {
        throw new Error('등급별 측정 범위를 확인해 주세요.');
      }
      if (!isAtMeasurementPrecision(band.min, item) || !isAtMeasurementPrecision(band.max, item)) {
        throw new Error('등급 경계의 정밀도가 측정 단위와 일치하지 않습니다.');
      }
      if (index > 0) {
        const previous = criteria.bands[index - 1];
        if (Math.abs((band.min - previous.max) - tick) > 1e-7) throw new Error('등급 사이 범위가 겹치거나 비어 있습니다.');
      }
    });

    if (!isObject(entry.percentileMethod) || entry.percentileMethod.status !== 'unavailable' || entry.percentileMethod.reason !== 'not-defined-in-regulation') {
      throw new Error('법령에 산식이 없는 백분위는 미제공으로 표시해야 합니다.');
    }

    const source = entry.source;
    if (!isObject(source) || source.reviewStatus !== 'verified-official') throw new Error('공식 출처 검토가 완료된 자료만 등록할 수 있습니다.');
    if (!nonEmpty(source.publisher) || !nonEmpty(source.documentTitle) || !nonEmpty(source.reference)) throw new Error('출처 기관·문서명·쪽 또는 표 위치를 지정해 주세요.');
    if (!validDate(source.checkedOn) || !validDate(source.effectiveFrom)) throw new Error('출처 확인일과 시행일을 YYYY-MM-DD로 지정해 주세요.');
    if (!nonEmpty(source.documentId) || !/^[a-f0-9]{64}$/i.test(source.pdfSha256 || '')) throw new Error('출처 문서 식별자와 원문 해시를 확인해 주세요.');
    let parsed;
    try { parsed = new URL(source.url); } catch { throw new Error('출처 URL을 확인해 주세요.'); }
    if (parsed.protocol !== 'https:') throw new Error('출처 URL은 HTTPS여야 합니다.');
    return entry;
  }

  function createCatalog({ catalogVersion, entries = [] } = {}) {
    if (!nonEmpty(catalogVersion)) throw new Error('기준 목록 버전을 지정해 주세요.');
    if (!Array.isArray(entries)) throw new Error('기준 항목 목록을 확인해 주세요.');
    const seenScopes = new Set();
    const copy = entries.map(entry => {
      validateEntry(entry);
      const key = [entry.criteriaVersion, entry.schoolYear, entry.gradeGroupId, entry.itemId, entry.unit, entry.targetGroupId].join('|');
      if (seenScopes.has(key)) throw new Error('동일 기준 버전과 적용 범위가 중복되었습니다.');
      seenScopes.add(key);
      return JSON.parse(JSON.stringify(entry));
    });
    return deepFreeze({ schemaVersion: 1, catalogVersion, entries: copy });
  }

  function unavailable(reason, extra = {}) {
    return { status: 'unavailable', reason, ...extra };
  }

  function createOfficialEntries() {
    const entries = [];
    for (const targetGroupId of ['male', 'female']) {
      const targetGroupLabel = targetGroupId === 'male' ? '남자' : '여자';
      for (const item of SUPPORTED_ITEMS) {
        const gradeRows = sourceData.data[targetGroupId]?.[item.id];
        if (!Array.isArray(gradeRows) || gradeRows.length !== sourceData.grades.length) throw new Error(`기준표 학년 자료를 확인해 주세요: ${targetGroupId}/${item.id}`);
        for (const [index, gradeGroupId] of sourceData.grades.entries()) {
          const bands = gradeRows[index].map(([min, max], bandIndex) => ({ grade: GRADE_LEVELS[bandIndex], min, max }));
          entries.push({
            criteriaVersion: sourceData.criteriaVersion,
            schoolYear: sourceData.schoolYear,
            gradeGroupId,
            itemId: item.id,
            unit: item.unit,
            targetGroupId,
            targetGroupLabel,
            gradingCriteria: { direction: 'higher', bands },
            percentileMethod: { status: 'unavailable', reason: 'not-defined-in-regulation' },
            source: {
              reviewStatus: sourceData.source.reviewStatus,
              publisher: sourceData.source.publisher,
              documentTitle: sourceData.source.documentTitle,
              documentId: sourceData.source.documentId,
              url: sourceData.source.url,
              reference: sourceData.source.reference[targetGroupId],
              checkedOn: sourceData.source.checkedOn,
              effectiveFrom: sourceData.source.effectiveFrom,
              pdfSha256: sourceData.source.pdfSha256,
              measurementMethodReference: sourceData.source.measurementMethodReference,
            },
          });
        }
      }
    }
    return entries;
  }

  const DEFAULT_CATALOG = createCatalog({
    catalogVersion: sourceData.catalogVersion,
    entries: createOfficialEntries(),
  });

  function getAvailability(itemId) {
    if (!SUPPORTED_IDS.has(itemId)) return unavailable('unsupported-item');
    return {
      status: 'available',
      itemId,
      catalogVersion: DEFAULT_CATALOG.catalogVersion,
      reason: 'scope-required',
      scopeCount: DEFAULT_CATALOG.entries.filter(entry => entry.itemId === itemId).length,
    };
  }

  function resolve(catalog, scope = {}) {
    if (!catalog || catalog.schemaVersion !== 1 || !Array.isArray(catalog.entries)) throw new Error('기준 목록을 확인해 주세요.');
    catalog = createCatalog({ catalogVersion: catalog.catalogVersion, entries: catalog.entries });
    if (!SUPPORTED_IDS.has(scope.itemId)) return unavailable('unsupported-item');
    if (scope.targetGroupConfirmed !== true) return unavailable('target-group-not-confirmed', { itemId: scope.itemId });
    if (!Number.isInteger(scope.schoolYear) || !nonEmpty(scope.gradeGroupId) || !nonEmpty(scope.targetGroupId) || !nonEmpty(scope.unit)) {
      return unavailable('incomplete-scope', { itemId: scope.itemId });
    }
    const matches = catalog.entries.filter(entry =>
      entry.itemId === scope.itemId && entry.schoolYear === scope.schoolYear &&
      entry.gradeGroupId === scope.gradeGroupId && entry.targetGroupId === scope.targetGroupId &&
      entry.unit === scope.unit && (!scope.criteriaVersion || entry.criteriaVersion === scope.criteriaVersion));
    if (matches.length === 0) return unavailable('criteria-not-registered', { itemId: scope.itemId, catalogVersion: catalog.catalogVersion });
    if (matches.length > 1) return unavailable('criteria-version-required', { itemId: scope.itemId, catalogVersion: catalog.catalogVersion });
    return { status: 'available', catalogVersion: catalog.catalogVersion, criteria: matches[0] };
  }

  function resolveDefault(scope = {}) { return resolve(DEFAULT_CATALOG, scope); }

  function classify(resolved, value) {
    if (!resolved || resolved.status !== 'available' || !resolved.criteria) return unavailable('criteria-not-resolved');
    const entry = resolved.criteria;
    const item = ITEM_BY_ID.get(entry.itemId);
    if (!item || typeof value !== 'number' || !Number.isFinite(value)) return unavailable('invalid-measurement-value', { itemId: entry.itemId });
    if (!isAtMeasurementPrecision(value, item)) return unavailable('unsupported-measurement-precision', { itemId: entry.itemId, precision: item.precision });
    const definition = model.MEASUREMENT_ITEMS.find(candidate => candidate.id === entry.itemId);
    if (value < definition.min || value > definition.max) return unavailable('measurement-out-of-range', { itemId: entry.itemId, unit: entry.unit });

    const bands = entry.gradingCriteria.bands;
    let matched = bands.find(band => value >= band.min && value <= band.max);
    let clamped = false;
    if (!matched && value < bands[0].min) { matched = bands[0]; clamped = true; }
    if (!matched && value > bands[bands.length - 1].max) { matched = bands[bands.length - 1]; clamped = true; }
    if (!matched) return unavailable('value-between-grade-ranges', { itemId: entry.itemId, value, unit: entry.unit });

    return {
      status: 'available',
      itemId: entry.itemId,
      value,
      unit: entry.unit,
      schoolYear: entry.schoolYear,
      gradeGroupId: entry.gradeGroupId,
      targetGroupId: entry.targetGroupId,
      targetGroupLabel: entry.targetGroupLabel,
      grade: matched.grade,
      band: { min: matched.min, max: matched.max },
      clamped,
      percentile: { status: 'unavailable', reason: 'not-defined-in-regulation' },
      source: entry.source,
    };
  }

  const api = Object.freeze({
    SUPPORTED_ITEMS,
    EMPTY_CATALOG,
    DEFAULT_CATALOG,
    REVIEWED_ON,
    createCatalog,
    getAvailability,
    resolve,
    resolveDefault,
    classify,
    validateEntry,
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PapsCriteria = api;
})(globalThis);
