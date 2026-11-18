(function (root) {
  'use strict';
  const model = typeof module !== 'undefined' && module.exports ? require('./classroom-model.js') : root.ClassroomModel;
  const sourceData = typeof module !== 'undefined' && module.exports ? require('./paps-bmi-criteria-data.js') : root.PapsBmiCriteriaData;
  if (!model?.PAPS_GRADE_GROUPS || !sourceData?.bands || !sourceData?.source) throw new Error('ClassroomModel and PapsBmiCriteriaData must load before PapsBmiCriteria.');

  const GROUPS = Object.freeze(['male', 'female']);
  const CATEGORIES = Object.freeze(sourceData.categories.map(item => Object.freeze({ ...item })));
  const CATEGORY_BY_ID = new Map(CATEGORIES.map(item => [item.id, item]));
  const REVIEWED_ON = sourceData.checkedOn;

  function unavailable(reason, extra = {}) { return { status: 'unavailable', reason, ...extra }; }
  function resolveDefault(scope = {}) {
    if (scope.targetGroupConfirmed !== true) return unavailable('target-group-not-confirmed');
    if (!Number.isInteger(scope.schoolYear) || !model.PAPS_GRADE_GROUPS.has(scope.gradeGroupId) || !GROUPS.includes(scope.targetGroupId)) return unavailable('incomplete-scope');
    if (scope.schoolYear !== sourceData.schoolYear) return unavailable('criteria-not-registered', { schoolYear: scope.schoolYear });
    if (scope.criteriaVersion && scope.criteriaVersion !== sourceData.criteriaVersion) return unavailable('criteria-not-registered', { criteriaVersion: scope.criteriaVersion });
    const gradeIndex = sourceData.grades.indexOf(scope.gradeGroupId);
    const raw = sourceData.bands[scope.targetGroupId]?.[gradeIndex]?.[0];
    if (!Array.isArray(raw)) return unavailable('criteria-not-registered', { schoolYear: scope.schoolYear, gradeGroupId: scope.gradeGroupId, targetGroupId: scope.targetGroupId });
    const bands = raw.length === 7
      ? [
          { categoryId: 'underweight', min: 0, max: raw[0] },
          { categoryId: 'normal', min: raw[1], max: raw[2] },
          { categoryId: 'overweight', min: raw[3], max: raw[4] },
          { categoryId: 'mild-obesity', min: raw[5], max: raw[6] },
          { categoryId: 'severe-obesity', min: 30.0, max: null },
        ]
      : [
          { categoryId: 'underweight', min: 0, max: raw[0] },
          { categoryId: 'normal', min: raw[1], max: raw[2] },
          { categoryId: 'overweight-mild-obesity', min: raw[3], max: raw[4] },
          { categoryId: 'severe-obesity', min: 30.0, max: null },
        ];
    return {
      status: 'available',
      criteriaVersion: sourceData.criteriaVersion,
      schoolYear: sourceData.schoolYear,
      gradeGroupId: scope.gradeGroupId,
      targetGroupId: scope.targetGroupId,
      bands,
      source: { ...sourceData.source },
    };
  }

  function classify(resolved, bmi) {
    if (!resolved || resolved.status !== 'available') return unavailable('criteria-not-resolved');
    if (typeof bmi !== 'number' || !Number.isFinite(bmi) || bmi < 0 || bmi > 100) return unavailable('invalid-measurement-value');
    if (Math.abs(bmi * 10 - Math.round(bmi * 10)) > 1e-7) return unavailable('unsupported-measurement-precision', { precision: 1 });
    const band = resolved.bands.find(item => bmi >= item.min && (item.max === null || bmi <= item.max));
    if (!band) return unavailable('criteria-gap');
    const category = CATEGORY_BY_ID.get(band.categoryId);
    return {
      status: 'available',
      itemId: 'body-mass-index',
      value: bmi,
      unit: 'kg/m²',
      schoolYear: resolved.schoolYear,
      gradeGroupId: resolved.gradeGroupId,
      targetGroupId: resolved.targetGroupId,
      categoryId: category.id,
      categoryLabel: category.label,
      band: { min: band.min, max: band.max },
      source: resolved.source,
    };
  }

  const api = Object.freeze({ CATEGORIES, REVIEWED_ON, resolveDefault, classify });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PapsBmiCriteria = api;
})(globalThis);
