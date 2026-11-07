(function (root) {
  'use strict';
  const M = root.ClassroomModel;
  const Reports = root.PapsReports;
  const E = root.TeacherEvaluations;
  const R = root.ExerciseRoutines;
  const Q = root.QRMissions;
  const T = root.TacticsBoard;
  const W = root.WearableBridge;
  const $ = id => document.getElementById(id);
  const el = (tag, text, attrs = {}) => Object.assign(document.createElement(tag), { ...(text === undefined ? {} : { textContent: text }), ...attrs });
  function actionButton(parent, label, fn, id = '', permitted = null) {
    const button = el('button', label, { type: 'button', className: 'secondary-button', ...(id ? { id } : {}) });
    button.addEventListener('click', () => {
      if (permitted ? !permitted() : !root.classroomAccessUnlocked?.()) return;
      Promise.resolve().then(fn).catch(error => { const status = $('classroomStatus'); if (status) status.textContent = error.message; });
    });
    parent.append(button); return button;
  }
  function input(parent, label, id, type = 'text', value = '') {
    const wrap = el('label', label); const node = el('input', undefined, { id, type }); node.value = String(value); node.maxLength = type === 'number' ? 12 : 1000; wrap.append(node); parent.append(wrap); return node;
  }
  function textarea(parent, label, id, value = '', max = 2000) {
    const wrap = el('label', label); const node = el('textarea', undefined, { id, maxLength: max }); node.value = value; wrap.append(node); parent.append(wrap); return node;
  }
  function select(parent, label, id, values, selected = '') {
    const wrap = el('label', label); const node = el('select', undefined, { id }); node.append(el('option', '선택해 주세요', { value: '' }));
    for (const option of values) node.append(el('option', option.name, { value: option.id })); node.value = selected || ''; wrap.append(node); parent.append(wrap); return node;
  }
  function checkbox(parent, label, id, checked = false) {
    const wrap = el('label', label); const node = el('input', undefined, { id, type: 'checkbox', checked }); node.checked = checked; wrap.prepend(node); parent.append(wrap); return node;
  }
  function section(host, title, description) {
    const details = el('details', undefined, { className: 'classroom-tool' });
    details.append(el('summary', title), el('p', description)); host.append(details); return details;
  }
  function localDownload(filename, csv) {
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = el('a', '선택 파일 다운로드', { href: url, download: filename });
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function svg(parent, label, width = 540, height = 180) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    node.setAttribute('viewBox', `0 0 ${width} ${height}`); node.setAttribute('role', 'img'); node.setAttribute('aria-label', label); node.setAttribute('class', 'classroom-chart'); parent.append(node); return node;
  }
  function trendGraph(parent, rows, unit) {
    if (!rows.length) return;
    const chart = svg(parent, '선택 학생의 측정값 추이'); const values = rows.map(row => row.value);
    const low = Math.min(...values), high = Math.max(...values), spread = Math.max(1, high - low);
    const points = rows.map((row, index) => ({ x: 35 + (rows.length === 1 ? 0 : index * 465 / (rows.length - 1)), y: 130 - ((row.value - low) / spread) * 95 }));
    const line = document.createElementNS(chart.namespaceURI, 'polyline'); line.setAttribute('points', points.map(p => `${p.x},${p.y}`).join(' ')); line.setAttribute('fill', 'none'); line.setAttribute('stroke', '#36704d'); line.setAttribute('stroke-width', '4'); chart.append(line);
    rows.forEach((row, index) => { const circle = document.createElementNS(chart.namespaceURI, 'circle'); circle.setAttribute('cx', points[index].x); circle.setAttribute('cy', points[index].y); circle.setAttribute('r', '6'); circle.setAttribute('fill', '#36704d'); chart.append(circle); const label = document.createElementNS(chart.namespaceURI, 'text'); label.setAttribute('x', points[index].x); label.setAttribute('y', '158'); label.setAttribute('text-anchor', 'middle'); label.textContent = `${row.schoolYear}: ${row.value} ${unit}`; chart.append(label); });
  }
  function barGraph(parent, result) {
    const chart = svg(parent, '학급의 공식 개별 등급별 기록 수', 540, 230); const grades = [5, 4, 3, 2, 1];
    const max = Math.max(1, ...grades.map(grade => result.counts[grade]));
    grades.forEach((grade, index) => { const y = 12 + index * 41; const label = document.createElementNS(chart.namespaceURI, 'text'); label.setAttribute('x', '8'); label.setAttribute('y', String(y + 19)); label.textContent = `${grade}등급`; chart.append(label); const rect = document.createElementNS(chart.namespaceURI, 'rect'); rect.setAttribute('x', '75'); rect.setAttribute('y', String(y)); rect.setAttribute('width', String(400 * result.counts[grade] / max)); rect.setAttribute('height', '26'); rect.setAttribute('fill', '#6b9d57'); chart.append(rect); const count = document.createElementNS(chart.namespaceURI, 'text'); count.setAttribute('x', String(84 + 400 * result.counts[grade] / max)); count.setAttribute('y', String(y + 19)); count.textContent = String(result.counts[grade]); chart.append(count); });
  }
  function tacticsPreview(parent, board) {
    const chart = svg(parent, '익명 토큰, 이동·패스 경로와 공격·수비 표식이 있는 전술판', 1000, 600);
    const defs = document.createElementNS(chart.namespaceURI, 'defs'); const markerId = `tactics-arrow-${crypto.randomUUID()}`; const marker = document.createElementNS(chart.namespaceURI, 'marker'); marker.setAttribute('id', markerId); marker.setAttribute('viewBox', '0 0 10 10'); marker.setAttribute('refX', '8'); marker.setAttribute('refY', '5'); marker.setAttribute('markerWidth', '9'); marker.setAttribute('markerHeight', '9'); marker.setAttribute('orient', 'auto-start-reverse'); const head = document.createElementNS(chart.namespaceURI, 'path'); head.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z'); head.setAttribute('fill', '#984b31'); marker.append(head); defs.append(marker); chart.append(defs);
    const rect = document.createElementNS(chart.namespaceURI, 'rect'); rect.setAttribute('x', '4'); rect.setAttribute('y', '4'); rect.setAttribute('width', '992'); rect.setAttribute('height', '592'); rect.setAttribute('fill', '#edf5e9'); rect.setAttribute('stroke', '#477254'); rect.setAttribute('stroke-width', '8'); chart.append(rect);
    const center = document.createElementNS(chart.namespaceURI, 'line'); center.setAttribute('x1', '500'); center.setAttribute('y1', '4'); center.setAttribute('x2', '500'); center.setAttribute('y2', '596'); center.setAttribute('stroke', '#80a389'); center.setAttribute('stroke-width', '3'); chart.append(center);
    const circle = document.createElementNS(chart.namespaceURI, 'circle'); circle.setAttribute('cx', '500'); circle.setAttribute('cy', '300'); circle.setAttribute('r', '75'); circle.setAttribute('fill', 'none'); circle.setAttribute('stroke', '#80a389'); circle.setAttribute('stroke-width', '3'); chart.append(circle);
    for (const arrow of board.arrows) {
      const line = document.createElementNS(chart.namespaceURI, 'line'); line.setAttribute('x1', String(arrow.from.x)); line.setAttribute('y1', String(arrow.from.y)); line.setAttribute('x2', String(arrow.to.x)); line.setAttribute('y2', String(arrow.to.y)); line.setAttribute('stroke', arrow.kind === 'pass' ? '#2762aa' : '#984b31'); line.setAttribute('stroke-width', '7'); line.setAttribute('stroke-dasharray', arrow.kind === 'pass' ? '12 10' : 'none'); line.setAttribute('marker-end', `url(#${markerId})`); chart.append(line);
    }
    for (const mark of board.marks) {
      const node = document.createElementNS(chart.namespaceURI, 'text'); node.setAttribute('x', String(mark.x)); node.setAttribute('y', String(mark.y)); node.setAttribute('text-anchor', 'middle'); node.setAttribute('font-size', '34'); node.setAttribute('fill', mark.kind === 'attack' ? '#b44b2b' : '#355e9b'); node.textContent = mark.kind === 'attack' ? '공격' : '수비'; chart.append(node);
    }
    for (const [index, token] of board.tokens.entries()) {
      const teamIndex = Math.max(0, board.teams.findIndex(team => team.id === token.teamId)); const node = document.createElementNS(chart.namespaceURI, 'circle'); node.setAttribute('cx', String(token.x)); node.setAttribute('cy', String(token.y)); node.setAttribute('r', '22'); node.setAttribute('fill', teamIndex % 2 ? '#4e6eac' : '#b75c37'); node.setAttribute('stroke', 'white'); node.setAttribute('stroke-width', '4'); chart.append(node);
      const label = document.createElementNS(chart.namespaceURI, 'text'); label.setAttribute('x', String(token.x)); label.setAttribute('y', String(token.y + 5)); label.setAttribute('text-anchor', 'middle'); label.setAttribute('fill', 'white'); label.setAttribute('font-size', '15'); label.textContent = `익명 ${index + 1}`; chart.append(label);
    }
    parent.append(chart);
  }
  const gradeOptions = [
    ['elementary-3', '초3'], ['elementary-4', '초4'], ['elementary-5', '초5'], ['elementary-6', '초6'],
    ['middle-1', '중1'], ['middle-2', '중2'], ['middle-3', '중3'], ['high-1', '고1'], ['high-2', '고2'], ['high-3', '고3'],
  ].map(([id, name]) => ({ id, name }));
  const targets = [{ id: 'male', name: '남자 기준' }, { id: 'female', name: '여자 기준' }];
  const itemOptions = M.MEASUREMENT_ITEMS.map(item => ({ id: item.id, name: `${item.name} (${item.unit})` }));
  const phaseNames = { stretching: '스트레칭 3분', strength: '근력 6분', movement: '이동 6분' };
  const activityById = new Map(R.ACTIVITIES.map(item => [item.id, item]));

  function addPapsReports(ui, host, { state, classId, students }) {
    const box = section(host, 'PAPS 추이 · 학급 분포 · 로컬 CSV', '입력된 측정값만 표시합니다. 등급 비교는 해당 기록에 저장된 공식 기준 범위와 버전이 일치할 때만 합니다. 백분위·종합점수는 없습니다. CSV는 교사 PIN 안에서 선택한 기록만 내려받는 임시 자료이며 NEIS 양식이 아닙니다.');
    const reportStudent = select(box, '추이를 볼 학생', 'papsReportStudent', students);
    const item = select(box, '측정 종목', 'papsReportItem', itemOptions);
    const grade = select(box, '별표 4 학년 기준 (직접 선택)', 'papsReportGrade', gradeOptions);
    const target = select(box, '평가표 구분 (직접 선택)', 'papsReportTarget', targets);
    const yearValues = [...new Set(state.measurements.filter(row => row.classId === classId).map(row => row.schoolYear))].sort((a, b) => b - a).map(year => ({ id: String(year), name: `${year}학년도` }));
    const year = select(box, '학급 분포 학년도', 'papsReportYear', yearValues);
    const trendOutput = el('div', undefined, { id: 'papsTrendOutput' }); box.append(trendOutput);
    const distributionOutput = el('div', undefined, { id: 'papsDistributionOutput' }); box.append(distributionOutput);
    const refresh = () => {
      trendOutput.replaceChildren(); distributionOutput.replaceChildren();
      if (reportStudent.value && item.value && grade.value && target.value) {
        const rows = Reports.buildTrend(state.measurements, { classId, studentId: reportStudent.value, itemId: item.value, gradeGroupId: grade.value || undefined, targetGroupId: target.value || undefined });
        trendOutput.append(el('h4', '학생 추이 (실제 기록 연도만)'));
        if (!rows.length) trendOutput.append(el('p', '현재 선택 범위에 수치 기록이 없습니다.'));
        else { trendGraph(trendOutput, rows, rows[0].unit); for (const row of rows) trendOutput.append(el('p', `${row.schoolYear}학년도 · ${row.measuredOn} · ${row.value} ${row.unit} · ${row.criteriaSourceVersion}`)); }
      } else trendOutput.append(el('p', '비교 범위가 섞이지 않도록 학년 기준과 평가표 구분을 직접 선택해 주세요.'));
      if (item.value && grade.value && target.value && year.value) {
        const result = Reports.classDistribution(state.measurements, { classId, schoolYear: Number(year.value), itemId: item.value, gradeGroupId: grade.value, targetGroupId: target.value });
        distributionOutput.append(el('h4', '학급 등급 분포'), el('p', `${result.included}개 수치 기록 분류 · ${result.missing}개 결측 · ${result.unavailable}개 기준 불일치/미제공`));
        if (result.included) barGraph(distributionOutput, result);
      }
    };
    [reportStudent, item, grade, target, year].forEach(node => node.addEventListener('change', refresh));
    const exportOptions = el('div', undefined, { id: 'papsExportChecks' }); box.append(el('h4', '학생 측정 기록 CSV'), el('p', '학생과 기록을 직접 선택합니다. 생성 전 확인 창이 표시됩니다.'), exportOptions);
    const refreshExport = () => {
      exportOptions.replaceChildren();
      if (!reportStudent.value) return;
      for (const row of state.measurements.filter(record => record.classId === classId && record.studentId === reportStudent.value).sort((a, b) => a.schoolYear - b.schoolYear || a.measuredOn.localeCompare(b.measuredOn))) checkbox(exportOptions, `${row.schoolYear} · ${row.measuredOn} · ${M.MEASUREMENT_ITEMS.find(x => x.id === row.itemId)?.name || row.itemId} · ${row.value === null ? `결측 ${row.missingReason}` : `${row.value} ${row.unit}`}`, `papsExport-${row.id}`);
    };
    reportStudent.addEventListener('change', refreshExport); actionButton(box, '선택 기록 CSV 다운로드', () => {
      const ids = [...exportOptions.querySelectorAll('input[type=checkbox]:checked')].map(node => node.id.slice('papsExport-'.length));
      if (!ids.length || !reportStudent.value || !confirm(`${ids.length}개 기록을 이 기기에 CSV로 저장할까요? 파일은 NEIS 업로드용이 아닙니다.`)) return;
      const csv = Reports.createStudentCsv(state.measurements, { classId, studentId: reportStudent.value, selectedIds: ids }); localDownload(`paps-local-${new Date().toISOString().slice(0, 10)}.csv`, csv);
    }, 'papsExportButton');
  }

  function evidenceOptions(state, classId, studentId) {
    const result = [];
    for (const type of ['notes', 'reflections', 'submissions']) for (const item of state[type].filter(row => row.classId === classId && row.studentId === studentId && !row.deletedAt)) result.push({ type, id: item.id, label: `${{ notes: '교사 관찰', reflections: '학생 성찰', submissions: '제출 클립' }[type]} · ${item.id.slice(0, 8)}` });
    return result;
  }
  function evidenceFromInput(node) { const [, , type, ...rest] = node.id.split('-'); return { type, id: rest.join('-') }; }
  function addEvaluationTools(ui, host, { state, classId, students }) {
    const box = section(host, '교사 루브릭 · 근거 평가 · 문안 승인', '교사 자체 기준으로 수기 평가합니다. 공식 성취기준으로 표시하지 않으며, 학생 관찰·성찰·직접 제출한 클립만 같은 학생의 근거로 연결합니다. 미평가는 0점이 아닙니다. 문안은 교사가 직접 작성하고 승인해야 로컬 CSV로 나갈 수 있습니다.');
    box.append(el('h4', '교사 자체 루브릭 만들기'));
    input(box, '학년도', 'rubricYear', 'number', M.schoolYearForDate(new Date().toISOString().slice(0, 10)));
    input(box, '루브릭 제목', 'rubricTitle');
    const rubricFields = {};
    for (const dimension of E.DIMENSIONS) rubricFields[dimension] = input(box, `${{ knowledge: '지식', skill: '기능', attitude: '태도' }[dimension]} 관찰 기준`, `rubric-${dimension}`);
    const levelInputs = [1, 2, 3, 4].map(level => input(box, `${level}수준 공통 설명`, `rubric-level-${level}`));
    actionButton(box, '자체 루브릭 저장', async () => {
      const rubric = E.createRubric({ classId, title: $('rubricTitle').value, schoolYear: Number($('rubricYear').value), criteria: E.DIMENSIONS.map(dimension => ({ dimension, description: rubricFields[dimension].value, levels: levelInputs.map(node => node.value) })) });
      await ui.write(s => { s.rubrics.push(rubric); }); await ui.renderTeacher(); ui.notice('교사 자체 루브릭을 PIN 암호화 저장소에 보관했어요.');
    }, 'createRubricButton');
    for (const rubric of state.rubrics.filter(row => row.classId === classId)) {
      const edit = el('details', undefined, { className: 'classroom-item' }); edit.append(el('summary', `${rubric.title} · ${rubric.schoolYear}학년도 · 기준 v${rubric.version || 1} 수정`));
      const title = input(edit, '루브릭 제목', `edit-rubric-title-${rubric.id}`, 'text', rubric.title); const descriptions = {};
      for (const dimension of E.DIMENSIONS) descriptions[dimension] = input(edit, `${dimension} 관찰 기준`, `edit-rubric-${dimension}-${rubric.id}`, 'text', rubric.criteria.find(item => item.dimension === dimension)?.description || '');
      const sharedLevels = rubric.criteria[0]?.levels || [];
      const anchors = [1, 2, 3, 4].map(level => input(edit, `${level}수준 공통 설명`, `edit-rubric-level-${level}-${rubric.id}`, 'text', sharedLevels[level - 1] || ''));
      actionButton(edit, '루브릭 변경 이력과 함께 저장', async () => {
        const criteria = E.DIMENSIONS.map(dimension => ({ dimension, description: descriptions[dimension].value, levels: anchors.map(node => node.value) }));
        await ui.write(s => E.updateRubric(s, rubric.id, { title: title.value, criteria })); await ui.renderTeacher();
      });
      if (rubric.history?.length) edit.append(el('p', `기준 수정 이력 ${rubric.history.length}건 · 저장 시점별 평가 기준을 평가 기록에 보존합니다.`));
      box.append(edit);
    }
    const rubricValues = state.rubrics.filter(row => row.classId === classId).map(row => ({ id: row.id, name: `${row.title} · ${row.schoolYear} · 교사 자체 기준` }));
    const studentSelect = select(box, '평가 학생', 'evaluationStudent', students);
    select(box, '적용 루브릭', 'evaluationRubric', rubricValues);
    const ratingSelects = {};
    for (const dimension of E.DIMENSIONS) ratingSelects[dimension] = select(box, `${{ knowledge: '지식', skill: '기능', attitude: '태도' }[dimension]} 수준`, `evaluationRating-${dimension}`, [{ id: '1', name: '1 시작' }, { id: '2', name: '2 기초' }, { id: '3', name: '3 성장' }, { id: '4', name: '4 안정' }]);
    textarea(box, '교사 서술 (선택)', 'evaluationComment', '', 1000);
    const evidenceHost = el('div', undefined, { id: 'evaluationEvidenceOptions' }); box.append(el('h4', '같은 학생의 근거 선택'), evidenceHost);
    const refreshEvidence = () => { evidenceHost.replaceChildren(); for (const option of evidenceOptions(state, classId, studentSelect.value)) checkbox(evidenceHost, option.label, `evaluation-evidence-${option.type}-${option.id}`); };
    studentSelect.addEventListener('change', refreshEvidence); refreshEvidence();
    actionButton(box, '평가 초안 저장', async () => {
      const evidenceIds = [...evidenceHost.querySelectorAll('input[type=checkbox]:checked')].map(evidenceFromInput);
      const ratings = Object.fromEntries(E.DIMENSIONS.map(dimension => [dimension, $(`evaluationRating-${dimension}`).value ? Number($(`evaluationRating-${dimension}`).value) : null]));
      await ui.write(s => E.createEvaluation(s, { classId, studentId: studentSelect.value, rubricId: $('evaluationRubric').value, ratings, comment: $('evaluationComment').value, evidenceIds })); await ui.renderTeacher(); ui.notice('평가 초안을 저장했어요. 모든 항목을 확인하고 교사가 승인해야 출력에 사용할 수 있습니다.');
    }, 'createEvaluationButton');

    box.append(el('h4', '평가 초안과 수정 이력'));
    const evalOutput = el('div', undefined, { id: 'assessmentRows' }); box.append(evalOutput);
    for (const item of state.assessments.filter(row => row.classId === classId)) {
      const student = students.find(row => row.id === item.studentId);
      const row = el('details', undefined, { className: 'classroom-item' }); row.append(el('summary', `${student?.name || '학생'} · ${item.rubricSnapshot?.title || '삭제된 루브릭'} 기준 v${item.rubricVersion || 1} · ${item.status === 'approved' ? '승인' : '초안'} · 평가 v${item.version}`));
      row.append(el('p', E.DIMENSIONS.map(dimension => `${dimension}: ${item.ratings[dimension] ?? '미평가'}`).join(' · ')), el('p', item.comment || '교사 서술 없음'), el('p', `근거: ${item.evidence.map(ref => `${ref.type}:${ref.id.slice(0, 8)}`).join(', ') || '없음'}`));
      const evidenceEditor = el('div', undefined, { className: 'classroom-evidence-edit' }); row.append(el('p', '수정할 근거 선택'), evidenceEditor);
      const evidenceSet = new Set(item.evidence.map(ref => `${ref.type}:${ref.id}`));
      for (const option of evidenceOptions(state, classId, item.studentId)) {
        const node = checkbox(evidenceEditor, option.label, `evaluation-evidence-${option.type}-${option.id}`, evidenceSet.has(`${option.type}:${option.id}`)); node.checked = evidenceSet.has(`${option.type}:${option.id}`);
      }
      const edits = {};
      for (const dimension of E.DIMENSIONS) edits[dimension] = select(row, `${dimension} 수정`, `edit-${item.id}-${dimension}`, [{ id: '1', name: '1 시작' }, { id: '2', name: '2 기초' }, { id: '3', name: '3 성장' }, { id: '4', name: '4 안정' }, { id: 'null', name: '미평가' }], item.ratings[dimension] ?? 'null');
      const comment = textarea(row, '교사 서술 수정', `edit-comment-${item.id}`, item.comment, 1000);
      actionButton(row, '평가 수정 저장', async () => { const ratings = Object.fromEntries(E.DIMENSIONS.map(dimension => [dimension, edits[dimension].value === 'null' ? null : Number(edits[dimension].value)])); const evidenceIds = [...evidenceEditor.querySelectorAll('input[type=checkbox]:checked')].map(evidenceFromInput); await ui.write(s => E.updateEvaluation(s, item.id, { ratings, comment: comment.value, evidenceIds })); await ui.renderTeacher(); });
      if (item.status !== 'approved') actionButton(row, '교사 승인', async () => { await ui.write(s => E.approveEvaluation(s, item.id)); await ui.renderTeacher(); });
      if (item.history.length) row.append(el('p', `변경 이력 ${item.history.length}건 · 마지막 ${new Date(item.history.at(-1).changedAt).toLocaleString()}`)); evalOutput.append(row);
    }

    box.append(el('h4', '교사가 직접 쓰는 문안'));
    const reportStudent = select(box, '문안 대상 학생', 'reportStudent', students);
    const approvedSelect = el('div', undefined, { id: 'approvedEvaluationOptions' }); box.append(approvedSelect);
    const refreshApproved = () => { approvedSelect.replaceChildren(); for (const item of state.assessments.filter(row => row.classId === classId && row.studentId === reportStudent.value && row.status === 'approved')) checkbox(approvedSelect, `승인 평가 · ${item.schoolYear} · ${item.id.slice(0, 8)}`, `report-evaluation-${item.id}`); };
    reportStudent.addEventListener('change', refreshApproved); refreshApproved();
    input(box, '문안 제목', 'reportTitle'); textarea(box, '교사 작성 문안', 'reportBody', '', 2000);
    actionButton(box, '문안 초안 저장', async () => {
      const assessmentIds = [...approvedSelect.querySelectorAll('input[type=checkbox]:checked')].map(node => node.id.slice('report-evaluation-'.length));
      await ui.write(s => E.createReport(s, { classId, studentId: reportStudent.value, assessmentIds, title: $('reportTitle').value, body: $('reportBody').value })); await ui.renderTeacher(); ui.notice('문안 초안을 저장했어요. 승인 전에는 파일로 출력되지 않습니다.');
    }, 'createReportButton');
    const reportRows = el('div', undefined, { id: 'teacherReportRows' }); box.append(el('h4', '문안 승인 · 선택 출력'), reportRows);
    for (const report of state.reports.filter(row => row.classId === classId)) {
      const student = students.find(row => row.id === report.studentId); const row = el('article', undefined, { className: 'classroom-item' });
      checkbox(row, `선택 출력 · ${student?.name || '학생'} · ${report.schoolYear} · ${report.status === 'approved' ? '승인' : '초안'}`, `report-export-${report.id}`);
      row.append(el('p', report.title), el('p', report.body || '문안이 비어 있습니다.'), el('p', `근거 평가 ${report.assessmentIds.length}건 · v${report.version}`));
      const body = textarea(row, '교사 문안 편집', `edit-report-${report.id}`, report.body, 2000);
      actionButton(row, '문안 수정 저장', async () => { await ui.write(s => E.updateReport(s, report.id, { body: body.value })); await ui.renderTeacher(); });
      if (report.status !== 'approved') actionButton(row, '문안 승인', async () => { await ui.write(s => E.approveReport(s, report.id)); await ui.renderTeacher(); });
      reportRows.append(row);
    }
    actionButton(box, '선택한 학생의 승인 문안 CSV 다운로드', () => {
      const chosen = [...reportRows.querySelectorAll('input[type=checkbox]:checked')].map(node => node.id.slice('report-export-'.length));
      if (!chosen.length) throw new Error('내보낼 문안을 직접 선택해 주세요.');
      const ids = new Set(chosen.map(id => state.reports.find(row => row.id === id)?.studentId).filter(Boolean)); if (ids.size !== 1) throw new Error('한 번에 한 학생의 승인 문안만 선택해 주세요.');
      const studentId = [...ids][0], student = students.find(row => row.id === studentId);
      if (!confirm(`${student?.name || '선택 학생'}의 승인 문안 ${chosen.length}개를 로컬 임시 CSV로 저장할까요? NEIS 양식이나 업로드 호환은 검증되지 않았습니다.`)) return;
      localDownload(`teacher-report-${new Date().toISOString().slice(0, 10)}.csv`, E.approvedReportCsv(state, { classId, studentId, reportIds: chosen, studentName: student?.name || '' }));
    }, 'exportApprovedReportsButton');
  }

  function updateExerciseTimer(ui, output) {
    if (!ui.exercisePlayer || !output?.isConnected) return;
    const state = ui.exercisePlayer.getState();
    output.textContent = state.status === 'complete' ? '15분 루틴을 마쳤어요.' : `${phaseNames[state.current.phase]} · ${state.current.title} · ${Math.floor(state.remainingSeconds / 60)}:${String(state.remainingSeconds % 60).padStart(2, '0')} · ${state.status === 'running' ? '진행 중' : '일시정지'}`;
  }
  function runExerciseTimer(ui, output) {
    if (!ui.exercisePlayer) throw new Error('먼저 승인된 15분 루틴을 시작해 주세요.');
    ui.exerciseTimer && clearInterval(ui.exerciseTimer);
    ui.exercisePlayer.resume(); updateExerciseTimer(ui, output);
    ui.exerciseTimer = setInterval(() => {
      if (ui.exercisePlayer?.getState().status === 'running') ui.exercisePlayer.tick(1);
      updateExerciseTimer(ui, output);
      if (ui.exercisePlayer?.getState().status === 'complete') { clearInterval(ui.exerciseTimer); ui.exerciseTimer = null; }
    }, 1000);
  }
  function addExerciseTools(ui, host, { state, classId }) {
    const box = section(host, '교사 검토 운동 콘텐츠 · 15분 루틴', '현재 콘텐츠는 자체 작성한 글 안내 초안이며 전문가 검토나 학교 안전 승인을 받은 자료가 아닙니다. 항목별 안전·학급 적합성을 교사가 직접 검토하고 선택한 뒤에만 루틴을 시작할 수 있습니다.');
    box.append(el('h4', '동작별 검토'));
    for (const activity of R.ACTIVITIES) {
      const approved = state.exerciseApprovals.find(row => row.classId === classId && row.activityId === activity.id);
      const card = el('details', undefined, { className: 'classroom-item' }); card.append(el('summary', `${activity.title} · ${phaseNames[activity.phase]} · ${approved?.approved ? '교사 검토 완료' : '미검토'}`), el('p', activity.instructions), el('p', `준비물: ${activity.equipment} · 주의: ${activity.safetyNotes} · 적합성 확인 필요`));
      const safety = checkbox(card, '교사가 안전 주의와 활동 방법을 직접 검토함', `exercise-safety-${activity.id}`, approved?.safetyReviewed === true);
      const suitability = checkbox(card, '교사가 이 학급의 공간·연령·학생 적합성을 직접 확인함', `exercise-fit-${activity.id}`, approved?.suitabilityReviewed === true);
      actionButton(card, '이 동작 교사 검토 저장', async () => {
        if (!safety.checked || !suitability.checked) throw new Error('두 검토 항목을 직접 확인한 뒤 저장해 주세요.');
        await ui.write(s => { s.exerciseApprovals = s.exerciseApprovals.filter(row => row.classId !== classId || row.activityId !== activity.id); s.exerciseApprovals.push({ id: crypto.randomUUID(), classId, activityId: activity.id, approved: true, safetyReviewed: true, suitabilityReviewed: true, reviewedAt: Date.now(), createdAt: Date.now(), expiresAt: Date.now() + M.MAX_RETENTION }); }); await ui.renderTeacher();
      }); box.append(card);
    }
    const approvedIds = new Set(state.exerciseApprovals.filter(row => row.classId === classId && row.approved && row.safetyReviewed && row.suitabilityReviewed).map(row => row.activityId));
    const selections = {};
    for (const phase of Object.keys(R.PHASES)) selections[phase] = select(box, `${phaseNames[phase]} 동작`, `routine-${phase}`, R.ACTIVITIES.filter(item => item.phase === phase && approvedIds.has(item.id)).map(item => ({ id: item.id, name: item.title })));
    const goal = select(box, '교사가 선택한 목표 (자동 판정 없음)', 'routineGoal', [{ id: 'flexibility', name: '유연성' }, { id: 'strength', name: '근력' }, { id: 'endurance', name: '지구력' }, { id: 'coordination', name: '협응' }]);
    const candidates = el('p', '목표를 고르면 해당 체력 요소를 다루는 교사 검토 동작을 확인할 수 있습니다.', { id: 'routineCandidates' }); box.append(candidates);
    const updateCandidates = () => { const items = R.ACTIVITIES.filter(activity => activity.fitnessTarget === goal.value && approvedIds.has(activity.id)); candidates.textContent = goal.value ? (items.length ? `선택 목표 후보: ${items.map(item => item.title).join(' · ')}. 루틴에 넣을 동작은 교사가 구간별로 선택합니다.` : '이 목표로 승인된 동작이 아직 없습니다.') : '목표를 고르면 해당 체력 요소를 다루는 교사 검토 동작을 확인할 수 있습니다.'; };
    goal.addEventListener('change', updateCandidates); updateCandidates();
    const alternates = select(box, '현재 구간에서 바꿔 사용할 승인 동작', 'routineAlternate', R.ACTIVITIES.filter(activity => approvedIds.has(activity.id)).map(item => ({ id: item.id, name: `${phaseNames[item.phase]} · ${item.title}` })));
    const status = el('p', '안전·적합성 검토 후 세 구간을 직접 선택해 주세요.', { id: 'routineStatus', className: 'measurement-criteria-result' }); box.append(status);
    actionButton(box, '15분 루틴 시작', () => {
      if (Object.values(selections).some(node => !node.value)) throw new Error('각 구간 동작을 하나씩 선택해 주세요.');
      const approvals = state.exerciseApprovals.filter(row => row.classId === classId && approvedIds.has(row.activityId)).map(row => ({ id: row.activityId, approved: true, safetyReviewed: true, suitabilityReviewed: true }));
      ui.exercisePlayer = R.createPlayer({ selections: Object.fromEntries(Object.entries(selections).map(([phase, node]) => [phase, node.value])), approvals });
      runExerciseTimer(ui, status);
    }, 'startRoutineButton');
    actionButton(box, '일시정지', () => { ui.exercisePlayer?.pause(); updateExerciseTimer(ui, status); });
    actionButton(box, '다시 시작', () => { ui.exercisePlayer?.resume(); updateExerciseTimer(ui, status); });
    actionButton(box, '현재 동작 건너뛰기', () => { ui.exercisePlayer?.skip(); updateExerciseTimer(ui, status); });
    actionButton(box, '현재 구간의 대체 동작 적용', () => { if (!ui.exercisePlayer || !alternates.value) throw new Error('루틴과 대체 동작을 먼저 선택해 주세요.'); ui.exercisePlayer.alternate(alternates.value); updateExerciseTimer(ui, status); });
    if (ui.exercisePlayer?.getState().status === 'running') runExerciseTimer(ui, status);
  }

  function readQrStore(state, classId) {
    let store = state.qrMissionStores.find(row => row.classId === classId);
    if (!store) store = { id: crypto.randomUUID(), classId, serialized: Q.serialize(Q.createState()), activeSessionId: null, activeSessionIds: {}, createdAt: Date.now(), expiresAt: Date.now() + M.MAX_RETENTION };
    return { store, data: Q.deserialize(store.serialized) };
  }
  function addQrTeacherTools(ui, host, { state, classId, groups }) {
    const box = section(host, '오프라인 QR 미션 만들기', 'QR에는 비밀이나 학생 식별 정보를 넣지 않고 무작위 미션 ID만 담습니다. 응답은 PIN 암호화 로컬 저장소에 익명으로 보관하며 GPS·클라우드 동기화·평가 자동 승격은 없습니다.');
    input(box, '미션 제목', 'qrMissionTitle'); input(box, '활동 제목', 'qrActivityTitle'); textarea(box, '활동 안내', 'qrActivityInstructions', '', 3000);
    textarea(box, '추가 순서 활동 (한 줄에 제목 | 안내, 선택)', 'qrAdditionalActivities', '', 6000);
    textarea(box, '선택 퀴즈 질문 (첫 활동에 추가, 선택)', 'qrQuizPrompt', '', 1000);
    textarea(box, '퀴즈 보기 (한 줄에 하나, 2~12개)', 'qrQuizOptions', '', 2000);
    input(box, '정답 번호 (보기의 1부터 시작)', 'qrQuizCorrectIndex', 'number');
    select(box, '대상 모둠 (선택)', 'qrMissionGroup', groups);
    actionButton(box, '미션과 익명 QR 만들기', async () => {
      const groupId = $('qrMissionGroup').value || null; const kind = groupId ? 'group' : 'station';
      const activities = [{ kind, title: $('qrActivityTitle').value, instructions: $('qrActivityInstructions').value, ...(groupId ? { groupId } : {}) }];
      const extras = $('qrAdditionalActivities').value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      for (const line of extras) {
        const separator = line.indexOf('|'); const title = separator < 0 ? '' : line.slice(0, separator).trim(); const instructions = separator < 0 ? '' : line.slice(separator + 1).trim();
        if (!title || !instructions) throw new Error('추가 활동은 제목 | 안내 형식으로 한 줄씩 입력해 주세요.');
        activities.push({ kind, title, instructions, ...(groupId ? { groupId } : {}) });
      }
      const quizPrompt = $('qrQuizPrompt').value.trim(); const optionTexts = $('qrQuizOptions').value.split(/\r?\n/).map(value => value.trim()).filter(Boolean); const answerIndex = Number($('qrQuizCorrectIndex').value);
      if (quizPrompt) {
        if (optionTexts.length < 2 || optionTexts.length > 12 || !Number.isInteger(answerIndex) || answerIndex < 1 || answerIndex > optionTexts.length) throw new Error('퀴즈 질문에는 보기 2~12개와 올바른 정답 번호가 필요합니다.');
        activities[0].quiz = { prompt: quizPrompt, options: optionTexts.map((text, index) => ({ id: `option-${index + 1}`, text })), correctOptionId: `option-${answerIndex}` };
      } else if (optionTexts.length || $('qrQuizCorrectIndex').value) throw new Error('퀴즈 보기나 정답을 입력했다면 질문도 작성해 주세요.');
      const definition = { classId, title: $('qrMissionTitle').value, activities };
      let payload;
      await ui.write(s => { const existing = readQrStore(s, classId); const result = Q.createMission(existing.data, definition); existing.store.serialized = Q.serialize(existing.data); existing.store.expiresAt = Date.now() + M.MAX_RETENTION; const index = s.qrMissionStores.findIndex(row => row.classId === classId); if (index < 0) s.qrMissionStores.push(existing.store); else s.qrMissionStores[index] = existing.store; payload = result.qrPayload; });
      await ui.renderTeacher(); const output = $('qrTeacherOutput'); if (output && root.qrcode) { output.replaceChildren(); const qr = root.qrcode(0, 'L'); qr.addData(payload); qr.make(); output.append(el('img', undefined, { alt: '익명 오프라인 미션 QR', src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr.createSvgTag({ scalable: true }))}` }), el('p', `QR 내용: 무작위 미션 ID ${payload}`)); }
      ui.notice('QR 미션을 PIN 암호화 로컬 저장소에 만들었어요. 학생이 이 기기의 학생 미션 영역에서 스캔하거나 ID를 입력할 수 있습니다.');
    }, 'createQrMissionButton');
    const output = el('div', undefined, { id: 'qrTeacherOutput' }); box.append(output);
    const missions = state.qrMissionStores.filter(row => row.classId === classId).flatMap(row => Q.deserialize(row.serialized).missions);
    box.append(el('h4', '저장된 미션'));
    for (const mission of missions) {
      const row = el('article', undefined, { className: 'classroom-item' }); row.append(el('p', `${mission.title} · 활동 ${mission.activities.length}개 · 익명 ID ${mission.id}`));
      if (root.qrcode) { const qr = root.qrcode(0, 'L'); qr.addData(mission.id); qr.make(); row.append(el('img', undefined, { alt: `${mission.title} 익명 QR`, src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr.createSvgTag({ scalable: true }))}` })); }
      actionButton(row, '이 미션과 익명 응답 삭제', async () => {
        if (!confirm('이 미션과 연결된 익명 세션·응답을 이 기기에서 삭제할까요?')) return;
        await ui.write(s => {
          const store = s.qrMissionStores.find(item => item.classId === classId); if (!store) return;
          const data = Q.deserialize(store.serialized); data.missions = data.missions.filter(item => item.id !== mission.id); const sessions = new Set(data.sessions.filter(item => item.missionId === mission.id).map(item => item.id));
          data.sessions = data.sessions.filter(item => item.missionId !== mission.id); data.responses = data.responses.filter(item => !sessions.has(item.body.sessionId));
          if (store.activeSessionIds) delete store.activeSessionIds[mission.id]; if (store.activeMissionId === mission.id) { store.activeMissionId = null; store.activeSessionId = null; }
          store.serialized = Q.serialize(data);
        }); await ui.renderTeacher();
      });
      box.append(row);
    }
  }
  function stopScanner(ui) {
    if (ui.qrAnimation) cancelAnimationFrame(ui.qrAnimation); ui.qrAnimation = null;
    if (ui.qrCameraStream) { ui.qrCameraStream.getTracks().forEach(track => track.stop()); ui.qrCameraStream = null; }
  }
  async function scanCamera(ui, video, inputNode) {
    if (!('BarcodeDetector' in root) || !navigator.mediaDevices?.getUserMedia) throw new Error('이 브라우저는 QR 자동 스캔을 지원하지 않습니다. QR 아래 표시된 무작위 ID를 직접 입력해 주세요.');
    const detector = new root.BarcodeDetector({ formats: ['qr_code'] });
    ui.qrCameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    video.srcObject = ui.qrCameraStream; await video.play();
    const loop = async () => {
      if (!video.isConnected || !ui.qrCameraStream) return;
      try { const found = await detector.detect(video); if (found[0]?.rawValue) { inputNode.value = found[0].rawValue; stopScanner(ui); $('qrScanButton')?.click(); return; } } catch { /* retry next frame */ }
      ui.qrAnimation = requestAnimationFrame(loop);
    };
    ui.qrAnimation = requestAnimationFrame(loop);
  }
  function addQrStudentTools(ui, host, state, binding) {
    if (!binding) return;
    const box = section(host, '학생 QR 미션 참여 (익명·이 기기 전용)', '교사에게 받은 QR을 스캔하거나 QR 아래의 무작위 ID를 입력합니다. 이 흐름은 학생 ID·이름·위치를 연결하지 않습니다. 스캐너 미지원 시 텍스트 입력을 사용하세요.');
    const payload = input(box, 'QR 미션 ID 또는 QR 내용', 'qrStudentPayload');
    const video = el('video', undefined, { playsInline: true, muted: true, className: 'qr-camera' }); box.append(video);
    const status = el('div', undefined, { id: 'qrStudentMissionStatus' }); box.append(status);
    const studentAccess = () => Boolean(ui.access().key);
    actionButton(box, '카메라로 QR 스캔', async () => scanCamera(ui, video, payload), '', studentAccess);
    actionButton(box, '미션 ID 열기', async () => {
      const missionId = payload.value.trim();
      let latest;
      await ui.write(s => { const { store, data } = readQrStore(s, binding.classId); const mission = data.missions.find(row => row.id === missionId); if (!mission) throw new Error('이 수업에서 만든 미션 QR이 아닙니다.'); store.activeSessionIds ||= {}; const result = Q.scan(data, missionId, binding.classId, store.activeSessionIds[missionId] || null); store.activeSessionIds[missionId] = result.sessionId; store.activeSessionId = result.sessionId; store.activeMissionId = missionId; store.serialized = Q.serialize(data); store.expiresAt = Date.now() + M.MAX_RETENTION; const index = s.qrMissionStores.findIndex(row => row.classId === binding.classId); if (index < 0) s.qrMissionStores.push(store); else s.qrMissionStores[index] = store; latest = result; });
      await ui.renderStudent(); ui.notice(`미션 ${latest.activityIndex + 1}단계가 열렸습니다.`);
    }, 'qrScanButton', studentAccess);
    const current = state.qrMissionStores.find(row => row.classId === binding.classId);
    if (!current?.activeSessionId) return;
    let data, missionStatus;
    try {
      data = Q.deserialize(current.serialized);
      const session = data.sessions.find(row => row.id === current.activeSessionId);
      const mission = data.missions.find(row => row.id === (current.activeMissionId || session?.missionId));
      if (!session || !mission || mission.classId !== binding.classId) throw new Error('미션 세션이 현재 수업과 일치하지 않습니다.');
      const active = mission.activities[session.activityIndex];
      missionStatus = { sessionId: session.id, missionId: mission.id, phase: session.phase, activityIndex: session.activityIndex, completed: session.phase === 'completed', ...(session.phase === 'completed' ? {} : { activity: { id: active.id, kind: active.kind, title: active.title, instructions: active.instructions, ...(active.groupId ? { groupId: active.groupId } : {}), ...(active.criteria ? { criteria: active.criteria } : {}), ...(active.quiz ? { quiz: { prompt: active.quiz.prompt, options: active.quiz.options } } : {}) } }) };
    }
    catch (error) { status.append(el('p', `저장된 미션 상태를 읽지 못했습니다: ${error.message}`)); return; }
    const show = result => {
      status.replaceChildren();
      if (result.completed) { status.append(el('p', '모든 미션 활동을 완료했어요. 참여 기록은 익명입니다.')); return; }
      status.append(el('h4', result.activity.title), el('p', result.activity.instructions), el('p', result.activity.criteria || '교사가 안내한 방법으로 활동해 주세요.'));
      if (result.activity.quiz) select(status, result.activity.quiz.prompt, 'qrAnswer', result.activity.quiz.options);
      actionButton(status, '이 활동 완료', async () => {
        const responseId = crypto.randomUUID(); let next;
        await ui.write(s => { const { store, data } = readQrStore(s, binding.classId); next = Q.respond(data, { responseId, sessionId: store.activeSessionId, missionId: result.missionId, classId: binding.classId, activityId: result.activity.id, completed: true, ...(result.activity.groupId ? { groupId: result.activity.groupId } : {}), ...(result.activity.quiz ? { answerOptionId: $('qrAnswer').value } : {}) }); store.serialized = Q.serialize(data); const index = s.qrMissionStores.findIndex(row => row.classId === binding.classId); s.qrMissionStores[index] = store; }); await ui.renderStudent();
      }, '', studentAccess);
    };
    show(missionStatus);
    actionButton(box, '미션 일시정지', async () => { await ui.write(s => { const { store, data } = readQrStore(s, binding.classId); Q.pause(data, store.activeSessionId); store.serialized = Q.serialize(data); s.qrMissionStores[s.qrMissionStores.findIndex(row => row.classId === binding.classId)] = store; }); await ui.renderStudent(); }, '', studentAccess);
    actionButton(box, '미션 이어하기', async () => { await ui.write(s => { const { store, data } = readQrStore(s, binding.classId); Q.resume(data, store.activeSessionId); store.serialized = Q.serialize(data); s.qrMissionStores[s.qrMissionStores.findIndex(row => row.classId === binding.classId)] = store; }); await ui.renderStudent(); }, '', studentAccess);
    if (missionStatus.completed) actionButton(box, '익명 미션 다시 시작', async () => { await ui.write(s => { const { store, data } = readQrStore(s, binding.classId); Q.restart(data, store.activeSessionId); store.serialized = Q.serialize(data); s.qrMissionStores[s.qrMissionStores.findIndex(row => row.classId === binding.classId)] = store; }); await ui.renderStudent(); }, '', studentAccess);
  }

  function getBoard(state, classId, boardId) {
    let item = state.tacticsBoards.find(row => row.classId === classId && (!boardId || row.id === boardId));
    if (!item) item = { id: crypto.randomUUID(), classId, title: '전술판 1', board: T.createBoard(), createdAt: Date.now(), expiresAt: Date.now() + M.MAX_RETENTION };
    return item;
  }
  function addTacticsTools(ui, host, { state, classId, students }) {
    const box = section(host, '익명 수동 전술판 · 모둠 회고', '선수 이름이나 학생 번호 대신 익명 토큰을 사용합니다. 키보드로 좌표와 동작을 지정할 수 있습니다. 전술 제안이나 자동 판정은 없으며, 데이터는 이 기기에 PIN 암호화해 저장합니다.');
    const classBoards = state.tacticsBoards.filter(row => row.classId === classId);
    const selectedBoardId = classBoards.some(row => row.id === ui.tacticsBoardId) ? ui.tacticsBoardId : classBoards[0]?.id;
    let item = getBoard(state, classId, selectedBoardId); const board = item.board;
    const boardChoice = select(box, '전술판 선택', 'tacticsBoardChoice', classBoards.map(row => ({ id: row.id, name: row.title })), item.id);
    boardChoice.addEventListener('change', () => { ui.tacticsBoardId = boardChoice.value; ui.renderTeacher(); });
    const summary = el('div', undefined, { className: 'classroom-item' }); summary.append(el('p', `팀 ${board.teams.length} · 익명 토큰 ${board.tokens.length} · 화살표 ${board.arrows.length} · 표식 ${board.marks.length}`)); box.append(summary);
    tacticsPreview(box, board);
    actionButton(box, '새 빈 전술판 추가', async () => { let createdId; await ui.write(s => { const index = s.tacticsBoards.findIndex(row => row.classId === classId); const created = index < 0 ? getBoard(s, classId) : { ...getBoard(s, classId), id: crypto.randomUUID(), title: `전술판 ${s.tacticsBoards.filter(row => row.classId === classId).length + 1}`, board: T.createBoard(), createdAt: Date.now(), expiresAt: Date.now() + M.MAX_RETENTION }; if (index < 0) s.tacticsBoards.push(created); createdId = created.id; }); ui.tacticsBoardId = createdId; await ui.renderTeacher(); });
    actionButton(box, '현재 전술판 복제', async () => { let createdId; await ui.write(s => { const original = s.tacticsBoards.find(row => row.id === item.id); const created = { ...JSON.parse(JSON.stringify(original)), id: crypto.randomUUID(), title: `전술판 ${s.tacticsBoards.filter(row => row.classId === classId).length + 1}`, createdAt: Date.now(), expiresAt: Date.now() + M.MAX_RETENTION }; s.tacticsBoards.push(created); createdId = created.id; }); ui.tacticsBoardId = createdId; await ui.renderTeacher(); });
    const teamSelect = select(box, '팀', 'tacticsTeam', board.teams.map(team => ({ id: team.id, name: `팀 ${team.id}` })));
    const tokenSelect = select(box, '토큰', 'tacticsToken', board.tokens.map(token => ({ id: token.id, name: `익명 ${token.id}` })));
    const arrowSelect = select(box, '이동·패스 화살표', 'tacticsArrow', board.arrows.map(arrow => ({ id: arrow.id, name: `${arrow.kind === 'pass' ? '패스' : '이동'} ${arrow.id}` })));
    const markSelect = select(box, '공격·수비 표식', 'tacticsMark', board.marks.map(mark => ({ id: mark.id, name: `${mark.kind === 'attack' ? '공격' : '수비'} ${mark.id}` })));
    const x1 = input(box, 'X 좌표 (0~1000)', 'tacticsX1', 'number', '100'); const y1 = input(box, 'Y 좌표 (0~600)', 'tacticsY1', 'number', '100');
    const x2 = input(box, '끝 X 좌표 (0~1000)', 'tacticsX2', 'number', '400'); const y2 = input(box, '끝 Y 좌표 (0~600)', 'tacticsY2', 'number', '300');
    const save = async mutate => { await ui.write(s => { let current = s.tacticsBoards.find(row => row.id === item.id); if (!current) { current = { ...item, board: T.cloneBoard(item.board) }; s.tacticsBoards.push(current); } mutate(current.board); current.expiresAt = Date.now() + M.MAX_RETENTION; }); await ui.renderTeacher(); };
    actionButton(box, '팀 추가', () => save(value => T.addTeam(value, {})));
    actionButton(box, '익명 토큰 추가', () => { if (!teamSelect.value) throw new Error('팀을 먼저 추가해 주세요.'); return save(value => T.addToken(value, { teamId: teamSelect.value, x: Number(x1.value), y: Number(y1.value) })); });
    actionButton(box, '선택 토큰 좌표 이동', () => { if (!tokenSelect.value) throw new Error('토큰을 선택해 주세요.'); return save(value => T.moveToken(value, tokenSelect.value, { x: Number(x2.value), y: Number(y2.value) })); });
    actionButton(box, '움직임 화살표 추가', () => save(value => T.addArrow(value, { kind: 'movement', from: { x: Number(x1.value), y: Number(y1.value) }, to: { x: Number(x2.value), y: Number(y2.value) } })));
    actionButton(box, '패스 화살표 추가', () => save(value => T.addArrow(value, { kind: 'pass', from: { x: Number(x1.value), y: Number(y1.value) }, to: { x: Number(x2.value), y: Number(y2.value) } })));
    actionButton(box, '공격 표식 추가', () => save(value => T.addMark(value, { kind: 'attack', x: Number(x1.value), y: Number(y1.value) })));
    actionButton(box, '수비 표식 추가', () => save(value => T.addMark(value, { kind: 'defense', x: Number(x1.value), y: Number(y1.value) })));
    if (tokenSelect.value) actionButton(box, '선택 토큰 삭제', () => save(value => T.removeToken(value, tokenSelect.value)));
    if (teamSelect.value) actionButton(box, '토큰을 비운 선택 팀 삭제', () => save(value => T.removeTeam(value, teamSelect.value)));
    if (arrowSelect.value) actionButton(box, '선택 화살표 삭제', () => save(value => T.removeArrow(value, arrowSelect.value)));
    if (markSelect.value) actionButton(box, '선택 표식 삭제', () => save(value => T.removeMark(value, markSelect.value)));
    const beforeAfter = select(box, '스냅샷 구분', 'tacticsSnapshotPhase', [{ id: 'before', name: '실행 전' }, { id: 'after', name: '실행 후' }]);
    actionButton(box, '현재 배치 스냅샷 저장', () => save(value => T.saveSnapshot(value, beforeAfter.value)));
    for (const phase of ['before', 'after']) { const snapshot = board.snapshots[phase]; if (snapshot) box.append(el('p', `${phase === 'before' ? '실행 전' : '실행 후'}: 익명 토큰 ${snapshot.tokens.length} · 화살표 ${snapshot.arrows.length} · 표식 ${snapshot.marks.length}`)); }
    const reflection = {};
    for (const [key, prompt] of Object.entries(T.PROMPTS)) reflection[key] = textarea(box, prompt, `tacticsReflection-${key}`, board.reflection[key], 500);
    actionButton(box, '익명 회고 저장', () => {
      const identifiers = students.flatMap(student => [student.id, student.name, student.number].filter(Boolean));
      return save(value => T.setReflection(value, Object.fromEntries(Object.entries(reflection).map(([key, node]) => [key, node.value])), identifiers));
    });
    actionButton(box, '전술판 초기화', () => { if (!confirm('이 익명 전술판과 회고를 지울까요?')) return; return save(value => T.clearBoard(value)); });
    box.append(el('p', `현재 판 이름: ${item.title}. 도형은 ID와 좌표만 저장되며 학생 식별 정보는 허용하지 않습니다. 허브 동기화/공유는 아직 연결하지 않았습니다.`));
  }
  function addWearableStatus(ui, host, { classId, students }) {
    ui.wearableUnsubscribe?.();
    const box = section(host, '웨어러블 — 수업 중 심박수 시범 연동 준비', '대상은 2022-11-06 이후 출시된 Galaxy Watch와 Apple Watch입니다. 학생의 페어링 휴대폰 앱이 워치에 연결하고, 같은 로컬 Wi-Fi의 교사 태블릿 네이티브 앱이 데이터를 전달합니다. 이 PWA는 브라우저에서 워치나 LAN 서버에 직접 연결하지 않습니다.');
    box.append(el('p', '초기 범위는 수업 중 심박수(bpm)와 측정 시각만 화면에 표시하는 것입니다. 위치·수면·칼로리·건강 위험 경보·성적 판정은 수집하거나 제공하지 않습니다. 측정값은 페이지 메모리에만 두고 수업 세션 종료·PIN 잠금 때 즉시 지웁니다.'));
    const bridge = root.PELoopWearableBridge;
    const controller = ui.wearableController || (ui.wearableController = W.createController({ bridge }));
    const choices = students.map(student => ({ id: student.id, name: `${student.number || '-'}번 ${student.name}` }));
    const studentChoice = select(box, '동의 확인 대상 학생', 'wearableConsentStudent', choices);
    const studentConsent = checkbox(box, '이 수업에서 학생 본인의 심박수 수집 동의서를 확인했습니다.', 'wearableStudentConsent');
    const guardianConsent = checkbox(box, '이 수업에서 보호자의 심박수 수집 동의서를 확인했습니다.', 'wearableGuardianConsent');
    box.append(el('p', '동의서 원본·보호자 연락처는 이 기능에 입력하지 않습니다. 학생 본인과 보호자의 동의가 모두 확인되어야 하며, 화면을 다시 그리거나 잠그면 확인 표시가 초기화됩니다. 연결 QR을 학생 휴대폰 앱으로 스캔한 뒤, 필요한 시계·심박 권한은 학생 휴대폰에서 처리합니다.'));
    const status = el('p', controller.available ? '네이티브 연동 앱이 있습니다. 지원 모델·OS 권한·실기기 검증은 별도 확인해야 합니다.' : '네이티브 연동 앱이 아직 없어 시계 연결은 비활성화되어 있습니다.', { id: 'wearableStatus' });
    status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const value = el('p', '현재 심박수: 표시할 측정값 없음', { id: 'wearableLiveValue', hidden: true, className: 'classroom-item' });
    const pairing = el('div', undefined, { id: 'wearablePairingOutput', hidden: true, className: 'classroom-item' });
    box.append(status, pairing, value);
    let startButton, reconnectButton, stopButton;
    const hasConsent = () => Boolean(studentChoice.value && studentConsent.checked && guardianConsent.checked);
    const activeStates = new Set(['creating-invitation', 'pairing', 'waiting-data', 'active', 'disconnected', 'network-disconnected', 'stale']);
    function renderState(state) {
      const messages = {
        idle: controller.available ? '아직 측정을 시작하지 않았습니다.' : '네이티브 연동 앱이 없어 시계 연결은 비활성화되어 있습니다.',
        unavailable: '네이티브 연동 앱이 없어 시계 연결은 비활성화되어 있습니다.',
        'creating-invitation': '학생 휴대폰 연결용 일회성 QR을 만들고 있습니다.',
        pairing: '학생 휴대폰에서 PE Loop 앱으로 QR을 스캔해 주세요. 휴대폰에서 워치 연결과 필요한 OS 권한을 확인합니다.',
        'waiting-data': '학생 휴대폰이 연결되었습니다. 새 심박 측정값을 기다리는 중입니다.', active: '측정 중입니다.',
        disconnected: '연결이 끊겼습니다. 수업은 계속할 수 있습니다. 현재 값은 숨겼고 측정 공백을 표시합니다. 교사가 직접 다시 연결해 주세요.',
        'network-disconnected': '학생 휴대폰과 교사 태블릿의 로컬 Wi-Fi 연결이 끊겼습니다. 수업은 계속하며 측정값은 비워 두고, 연결 복구를 자동으로 기다립니다.',
        stale: '새 측정값이 제때 도착하지 않아 현재 값을 숨겼습니다. 공백으로 기록하며 자동으로 이전 값을 재사용하지 않습니다.',
        denied: '심박 표본이 없거나 동의 확인이 해제되어 심박 측정을 중단했습니다. 수업은 계속 진행하고 심박 기록은 비워 둡니다.',
        unsupported: '지원 범위로 확인되지 않은 워치여서 측정을 시작하지 않았습니다. 수업은 계속할 수 있습니다.',
        expired: '연결 QR이 만료되었습니다. 측정 세션을 새로 시작해 주세요.',
        error: '학생 휴대폰 또는 교사 태블릿 연결에 실패했습니다. 수업은 계속할 수 있고 심박 기록은 비워 둡니다.', ended: '측정 세션을 종료하고 화면의 측정값을 지웠습니다.',
      };
      status.textContent = messages[state.status] || '측정 상태를 확인할 수 없습니다.';
      if (state.status === 'disconnected' || state.status === 'network-disconnected' || state.status === 'stale') status.textContent += ` 측정 공백 ${state.gapCount + 1}회.`;
      pairing.replaceChildren(); pairing.hidden = true;
      if (state.status === 'pairing' && state.pairingPayload && root.qrcode) {
        try {
          const qr = root.qrcode(0, 'M'); qr.addData(state.pairingPayload); qr.make();
          pairing.append(el('img', undefined, { alt: '학생 휴대폰 일회성 연결 QR', src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr.createSvgTag({ scalable: true }))}` }), el('p', '이 QR에는 2분 안에 한 번 사용할 연결 자격이 있습니다. 지정한 학생의 휴대폰에서만 스캔해 주세요. 만료되면 세션을 종료하고 새 QR을 만드세요.'));
          pairing.hidden = false;
        } catch (_) { status.textContent = '연결 QR을 만들 수 없습니다. 세션을 종료하고 다시 시도해 주세요.'; }
      }
      value.hidden = state.status !== 'active' || state.bpm === null;
      value.textContent = value.hidden ? '현재 심박수: 표시할 측정값 없음' : `현재 심박수: ${state.bpm} bpm · ${new Date(state.sampledAt).toLocaleTimeString()}`;
      if (startButton) startButton.disabled = !controller.available || !hasConsent() || activeStates.has(state.status);
      if (reconnectButton) reconnectButton.disabled = !controller.available || !hasConsent() || !['disconnected', 'stale'].includes(state.status);
      if (stopButton) stopButton.disabled = !activeStates.has(state.status) && !['denied', 'error'].includes(state.status);
    }
    startButton = actionButton(box, '수업 심박수 연결 QR 만들기', async () => {
      const selectedId = studentChoice.value;
      const consent = { student: studentConsent.checked, guardian: guardianConsent.checked, heartRate: true, isStillValid: () => studentChoice.value === selectedId && studentConsent.checked && guardianConsent.checked };
      await controller.start(consent);
    });
    reconnectButton = actionButton(box, '교사가 연결 QR 다시 만들기', async () => {
      const selectedId = studentChoice.value;
      const consent = { student: studentConsent.checked, guardian: guardianConsent.checked, heartRate: true, isStillValid: () => studentChoice.value === selectedId && studentConsent.checked && guardianConsent.checked };
      await controller.reconnect(consent);
    });
    stopButton = actionButton(box, '수업 심박수 측정 종료', () => controller.stop());
    const checkConsent = () => {
      if (!hasConsent() && activeStates.has(controller.getState().status)) void controller.stop('denied');
      renderState(controller.getState());
    };
    studentChoice.addEventListener('change', () => { studentConsent.checked = false; guardianConsent.checked = false; if (activeStates.has(controller.getState().status)) void controller.stop('denied'); renderState(controller.getState()); });
    studentConsent.addEventListener('change', checkConsent);
    guardianConsent.addEventListener('change', checkConsent);
    ui.wearableUnsubscribe = controller.subscribe(renderState);
    renderState(controller.getState());
    if (!ui.wearablePagehideHandler) { ui.wearablePagehideHandler = () => { void ui.wearableController?.stop(); }; root.addEventListener('pagehide', ui.wearablePagehideHandler); }
  }
  async function renderTeacher(ui, context) {
    if (!ui.access().unlocked || !context.classId) return;
    const classroom = context.state.classes.find(row => row.id === context.classId);
    if (!classroom || classroom.pendingDelete || classroom.deletedAt) return;
    if (!context.state.tacticsBoards.some(row => row.classId === context.classId)) {
      await ui.write(s => { s.tacticsBoards.push(getBoard(s, context.classId)); }); context.state = ui.state;
    }
    addPapsReports(ui, context.host, context);
    addEvaluationTools(ui, context.host, context);
    addExerciseTools(ui, context.host, context);
    addQrTeacherTools(ui, context.host, context);
    addTacticsTools(ui, context.host, context);
    addWearableStatus(ui, context.host, context);
  }
  function renderStudent(ui, context) { addQrStudentTools(ui, context.host, context.state, context.binding); }
  async function stopWearable(ui) {
    ui.wearableUnsubscribe?.(); ui.wearableUnsubscribe = null;
    if (ui.wearableController) await ui.wearableController.stop();
  }
  root.ClassroomToolsUI = Object.freeze({ renderTeacher, renderStudent, stopScanner, stopWearable });
})(globalThis);
