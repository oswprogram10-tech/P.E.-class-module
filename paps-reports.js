(function (root, factory) {
  'use strict';
  const criteria = typeof module !== 'undefined' && module.exports ? require('./paps-criteria.js') : root.PapsCriteria;
  const api = factory(criteria);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PapsReports = api;
})(globalThis, function (criteria) {
  'use strict';
  const fail = message => { throw new Error(message); };
  const hasScope = item => item && Number.isInteger(item.schoolYear) && item.itemId && item.value !== null && Number.isFinite(item.value) && item.criteriaGradeGroupId && item.criteriaTargetGroupId && item.criteriaSourceVersion;
  function buildTrend(records, scope) {
    if (!scope || !scope.studentId || !scope.itemId || !scope.gradeGroupId || !scope.targetGroupId) fail('학생·종목·별표 4 학년·평가표 구분을 직접 선택해 주세요.');
    const rows = (Array.isArray(records) ? records : []).filter(item => hasScope(item) && item.studentId === scope.studentId && item.itemId === scope.itemId && (!scope.gradeGroupId || item.criteriaGradeGroupId === scope.gradeGroupId) && (!scope.targetGroupId || item.criteriaTargetGroupId === scope.targetGroupId) && (!scope.classId || item.classId === scope.classId) && (scope.fromYear == null || item.schoolYear >= scope.fromYear) && (scope.toYear == null || item.schoolYear <= scope.toYear))
      .map(item => ({ schoolYear: item.schoolYear, measuredOn: item.measuredOn, value: item.value, unit: item.unit, criteriaSourceVersion: item.criteriaSourceVersion, itemId: item.itemId }))
      .sort((a, b) => a.schoolYear - b.schoolYear || a.measuredOn.localeCompare(b.measuredOn));
    return rows;
  }
  function classDistribution(records, scope) {
    if (!scope || !scope.classId || !Number.isInteger(scope.schoolYear) || !scope.itemId || !scope.gradeGroupId || !scope.targetGroupId) fail('학년도·종목·학년·평가표 구분을 모두 선택해 주세요.');
    const counts = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    let included = 0, missing = 0, unavailable = 0;
    const rows = (Array.isArray(records) ? records : []).filter(item => item.classId === scope.classId && item.schoolYear === scope.schoolYear && item.itemId === scope.itemId);
    for (const row of rows) {
      if (row.value === null) { missing++; continue; }
      if (!hasScope(row) || row.criteriaGradeGroupId !== scope.gradeGroupId || row.criteriaTargetGroupId !== scope.targetGroupId || (scope.criteriaSourceVersion && row.criteriaSourceVersion !== scope.criteriaSourceVersion)) { unavailable++; continue; }
      const resolved = criteria.resolveDefault({ schoolYear: row.schoolYear, gradeGroupId: row.criteriaGradeGroupId, targetGroupId: row.criteriaTargetGroupId, itemId: row.itemId, unit: row.unit, criteriaVersion: row.criteriaSourceVersion, targetGroupConfirmed: true });
      const result = criteria.classify(resolved, row.value);
      if (result.status !== 'available') { unavailable++; continue; }
      counts[result.grade]++; included++;
    }
    return { scope: { ...scope }, counts, included, missing, unavailable };
  }
  function csvCell(value) {
    let text = String(value ?? '');
    if (typeof value !== 'number' && /^[\u0000-\u0020]*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""').replace(/\r\n|\r|\n/g, ' ')}"`;
  }
  function createStudentCsv(records, { classId, studentId, selectedIds, generatedAt = new Date().toISOString() } = {}) {
    if (!classId || !studentId || !Array.isArray(selectedIds) || selectedIds.length === 0) fail('학생과 내보낼 기록을 직접 선택해 주세요.');
    const wanted = new Set(selectedIds);
    if (wanted.size !== selectedIds.length) fail('같은 기록을 두 번 선택할 수 없어요.');
    const selected = (Array.isArray(records) ? records : []).filter(row => wanted.has(row.id));
    if (selected.length !== wanted.size || selected.some(row => row.classId !== classId || row.studentId !== studentId)) fail('선택 기록이 학생·학급 범위와 일치하지 않습니다.');
    const headers = ['출력종류', '산출일시', '학급내학생ID', '학년도', '측정일', '종목ID', '측정값', '단위', '결측사유', '별표4학년', '평가표구분', '기준버전', '개별등급'];
    const lines = [headers, ...selected.sort((a, b) => a.schoolYear - b.schoolYear || a.measuredOn.localeCompare(b.measuredOn)).map(row => {
      let grade = '';
      if (hasScope(row)) {
        const resolved = criteria.resolveDefault({ schoolYear: row.schoolYear, gradeGroupId: row.criteriaGradeGroupId, targetGroupId: row.criteriaTargetGroupId, itemId: row.itemId, unit: row.unit, criteriaVersion: row.criteriaSourceVersion, targetGroupConfirmed: true });
        const result = criteria.classify(resolved, row.value);
        if (result.status === 'available') grade = `${result.grade}등급${result.clamped ? ' (범위밖 끝등급)' : ''}`;
      }
      return ['PAPS 로컬 임시자료 (NEIS 양식 아님)', generatedAt, row.studentId, row.schoolYear, row.measuredOn, row.itemId, row.value, row.unit, row.missingReason || '', row.criteriaGradeGroupId || '', row.criteriaTargetGroupId || '', row.criteriaSourceVersion || '', grade];
    })];
    return '\ufeff' + lines.map(line => line.map(csvCell).join(',')).join('\r\n');
  }
  return Object.freeze({ buildTrend, classDistribution, createStudentCsv });
});
