(function (root, factory) {
  'use strict';
  const model = typeof module !== 'undefined' && module.exports ? require('./classroom-model.js') : root.ClassroomModel;
  const criteria = typeof module !== 'undefined' && module.exports ? require('./paps-criteria.js') : root.PapsCriteria;
  const bmiCriteria = typeof module !== 'undefined' && module.exports ? require('./paps-bmi-criteria.js') : root.PapsBmiCriteria;
  const api = factory(model, criteria, bmiCriteria);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PapsProgramSelection = api;
})(globalThis, function (model, criteria, bmiCriteria) {
  'use strict';

  const SOURCE = Object.freeze({
    version: 'MOE-354-2025-03-10-paps-factor-selection',
    publisher: '대한민국 교육부',
    documentTitle: '학교건강검사규칙',
    documentId: '교육부령 제354호 (2025. 3. 10. 일부개정)',
    url: 'https://www.law.go.kr/법령/학교건강검사규칙',
    reference: '제7조제3항·제8조제1항 및 별지 제1호서식 뒤쪽 제2쪽 「항목별 평균기록 통계」',
    checkedOn: criteria.REVIEWED_ON,
    effectiveFrom: '2025-03-10',
    pdfSha256: criteria.SCORE_SOURCE.pdfSha256,
  });
  const FACTORS = Object.freeze([
    Object.freeze({ id: 'cardiorespiratory', label: '심폐지구력', options: Object.freeze([
      Object.freeze({ id: 'shuttle-run', label: '왕복오래달리기', itemIds: Object.freeze(['shuttle-run']) }),
      Object.freeze({ id: 'run-walk', label: '오래달리기-걷기', itemIds: Object.freeze(['run-walk-1000m', 'run-walk-1200m', 'run-walk-1600m']) }),
      Object.freeze({ id: 'step-test-pei', label: '스텝검사 (PEI)', itemIds: Object.freeze(['step-test-pei']) }),
    ]) }),
    Object.freeze({ id: 'flexibility', label: '유연성', options: Object.freeze([
      Object.freeze({ id: 'sit-and-reach', label: '앉아 윗몸 앞으로 굽히기', itemIds: Object.freeze(['sit-and-reach']) }),
      Object.freeze({ id: 'comprehensive-flexibility', label: '종합유연성', itemIds: Object.freeze(['comprehensive-flexibility']) }),
    ]) }),
    Object.freeze({ id: 'muscle-strength-endurance', label: '근력·근지구력', options: Object.freeze([
      Object.freeze({ id: 'sit-ups', label: '윗몸 말아 올리기', itemIds: Object.freeze(['sit-ups']) }),
      Object.freeze({ id: 'grip-strength', label: '악력', itemIds: Object.freeze(['grip-strength']) }),
      Object.freeze({ id: 'push-ups', label: '팔굽혀펴기 (남자) / 무릎대고 팔굽혀펴기 (여자)', itemIds: Object.freeze(['push-ups', 'knee-push-ups']) }),
    ]) }),
    Object.freeze({ id: 'power', label: '순발력', options: Object.freeze([
      Object.freeze({ id: 'sprint-50m', label: '50m 달리기', itemIds: Object.freeze(['sprint-50m']) }),
      Object.freeze({ id: 'standing-long-jump', label: '제자리멀리뛰기', itemIds: Object.freeze(['standing-long-jump']) }),
    ]) }),
    Object.freeze({ id: 'obesity', label: '비만도', options: Object.freeze([
      Object.freeze({ id: 'body-mass-index', label: 'BMI (점수 세부 기준 미제공)', itemIds: Object.freeze(['body-mass-index']) }),
    ]) }),
  ]);
  const ELEMENTARY_5_6 = new Set(['elementary-5', 'elementary-6']);
  const MIDDLE_HIGH = new Set(['middle-1', 'middle-2', 'middle-3', 'high-1', 'high-2', 'high-3']);
  const GRADE_GROUPS = new Set(model.PAPS_GRADE_GROUPS);
  const FACTOR_MAP = new Map(FACTORS.map(factor => [factor.id, factor]));
  const SCHOOL_YEAR_MIN = 2000, SCHOOL_YEAR_MAX = 2100;

  function getOption(factorId, optionId) {
    const factor = FACTOR_MAP.get(factorId);
    return factor?.options.find(option => option.id === optionId) || null;
  }

  function itemIdFor(optionId, gradeGroupId, targetGroupId) {
    if (!GRADE_GROUPS.has(gradeGroupId) || !model.PAPS_TARGET_GROUPS.has(targetGroupId)) return null;
    if (optionId === 'run-walk') {
      if (ELEMENTARY_5_6.has(gradeGroupId)) return 'run-walk-1000m';
      if (MIDDLE_HIGH.has(gradeGroupId)) return targetGroupId === 'female' ? 'run-walk-1200m' : 'run-walk-1600m';
      return null;
    }
    if (optionId === 'push-ups') {
      if (!MIDDLE_HIGH.has(gradeGroupId)) return null;
      return targetGroupId === 'female' ? 'knee-push-ups' : 'push-ups';
    }
    return model.MEASUREMENT_ITEMS.some(item => item.id === optionId) ? optionId : null;
  }

  function itemAvailable(itemId, schoolYear, gradeGroupId, targetGroupId) {
    if (itemId === 'body-mass-index') {
      return bmiCriteria.resolveDefault({ schoolYear, gradeGroupId, targetGroupId, targetGroupConfirmed: true }).status === 'available';
    }
    const item = model.MEASUREMENT_ITEMS.find(entry => entry.id === itemId);
    if (!item) return false;
    return criteria.resolveDefault({ itemId, schoolYear, gradeGroupId, unit: item.unit, targetGroupId, targetGroupConfirmed: true }).status === 'available';
  }

  function availableOptions(factorId, { schoolYear, gradeGroupId } = {}) {
    const factor = FACTOR_MAP.get(factorId);
    if (!factor || !Number.isInteger(schoolYear) || !GRADE_GROUPS.has(gradeGroupId)) return [];
    return factor.options.filter(option => ['male', 'female'].every(targetGroupId => {
      const itemId = itemIdFor(option.id, gradeGroupId, targetGroupId);
      return itemId && option.itemIds.includes(itemId) && itemAvailable(itemId, schoolYear, gradeGroupId, targetGroupId);
    }));
  }

  function validateSelection({ schoolYear, gradeGroupId, selections } = {}) {
    if (!Number.isInteger(schoolYear) || schoolYear < SCHOOL_YEAR_MIN || schoolYear > SCHOOL_YEAR_MAX) throw new Error('PAPS 설정 학년도를 확인해 주세요.');
    if (!GRADE_GROUPS.has(gradeGroupId)) throw new Error('PAPS 설정 학년을 직접 선택해 주세요.');
    if (!selections || typeof selections !== 'object' || Array.isArray(selections)) throw new Error('체력요소별 검사 종목 설정을 확인해 주세요.');
    const expected = FACTORS.map(factor => factor.id).sort();
    const supplied = Object.keys(selections).sort();
    if (JSON.stringify(expected) !== JSON.stringify(supplied)) throw new Error('다섯 체력요소에 각각 검사 종목 하나씩 선택해 주세요.');
    if (FACTORS.some(factor => typeof selections[factor.id] !== 'string' || !selections[factor.id])) throw new Error('다섯 체력요소에 각각 검사 종목 하나씩 선택해 주세요.');
    for (const factor of FACTORS) {
      const option = getOption(factor.id, selections[factor.id]);
      if (!option || !availableOptions(factor.id, { schoolYear, gradeGroupId }).some(candidate => candidate.id === option.id)) {
        throw new Error(`${factor.label} 검사 종목이 선택 학년·학년도에 적용되는지 확인해 주세요.`);
      }
    }
    return { schoolYear, gradeGroupId, selections: Object.fromEntries(FACTORS.map(factor => [factor.id, selections[factor.id]])) };
  }

  function saveSelection(state, { classId, schoolYear, gradeGroupId, selections } = {}, now = Date.now()) {
    model.get(state, 'classes', classId);
    const checked = validateSelection({ schoolYear, gradeGroupId, selections });
    const retentionExpiresAt = Date.UTC(schoolYear + 3, 2, 1);
    if (retentionExpiresAt <= now) throw new Error('선택한 학년도의 PAPS 설정 보관 기간이 끝났어요.');
    if (!Array.isArray(state.papsSelections)) state.papsSelections = [];
    const current = state.papsSelections.find(item => item.classId === classId && item.schoolYear === schoolYear);
    if (current && current.gradeGroupId === checked.gradeGroupId && FACTORS.every(factor => current.selections?.[factor.id] === checked.selections[factor.id])) return current;
    const history = Array.isArray(current?.history) ? [...current.history] : [];
    if (current) history.push({ version: current.version || 1, changedAt: now, gradeGroupId: current.gradeGroupId, selections: { ...current.selections } });
    const record = {
      ...(current || {}), id: current?.id || crypto.randomUUID(), classId,
      schoolYear: checked.schoolYear, gradeGroupId: checked.gradeGroupId,
      selections: checked.selections, source: SOURCE,
      createdAt: current?.createdAt || now, modifiedAt: current ? now : null,
      version: (current?.version || 0) + 1, history, retentionExpiresAt,
    };
    if (current) Object.assign(current, record); else state.papsSelections.push(record);
    return record;
  }

  function getSelection(state, classId, schoolYear) {
    return state.papsSelections?.find(item => item.classId === classId && item.schoolYear === schoolYear) || null;
  }

  return Object.freeze({ SOURCE, FACTORS, availableOptions, itemIdFor, validateSelection, saveSelection, getSelection });
});
