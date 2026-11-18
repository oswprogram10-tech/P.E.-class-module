(function (root) {
  'use strict';
  const M = root.ClassroomModel;
  const Reports = root.PapsReports;
  const PapsPrograms = root.PapsProgramSelection;
  const E = root.TeacherEvaluations;
  const R = root.ExerciseRoutines;
  const Q = root.QRMissions;
  const T = root.TacticsBoard;
  const W = root.WearableBridge;
  const GPS = root.GpsMissions;
  const Curriculum = root.PeCurriculum;
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
    const bmiMode = result.kind === 'bmi';
    const rows = bmiMode ? result.categories.map(item => ({ id: item.id, label: item.label })) : [5, 4, 3, 2, 1].map(grade => ({ id: grade, label: `${grade}등급` }));
    const rowHeight = bmiMode ? 34 : 41;
    const chart = svg(parent, bmiMode ? '학급의 BMI 기준 구간별 기록 수' : '학급의 공식 개별 등급별 기록 수', 600, 12 + rows.length * rowHeight);
    const max = Math.max(1, ...rows.map(row => result.counts[row.id]));
    rows.forEach((row, index) => { const y = 12 + index * rowHeight; const label = document.createElementNS(chart.namespaceURI, 'text'); label.setAttribute('x', '8'); label.setAttribute('y', String(y + 19)); label.textContent = row.label; chart.append(label); const rect = document.createElementNS(chart.namespaceURI, 'rect'); rect.setAttribute('x', '185'); rect.setAttribute('y', String(y)); rect.setAttribute('width', String(370 * result.counts[row.id] / max)); rect.setAttribute('height', '25'); rect.setAttribute('fill', '#6b9d57'); chart.append(rect); const count = document.createElementNS(chart.namespaceURI, 'text'); count.setAttribute('x', String(194 + 370 * result.counts[row.id] / max)); count.setAttribute('y', String(y + 19)); count.textContent = String(result.counts[row.id]); chart.append(count); });
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
    const box = section(host, 'PAPS 기록 · 종목 설정 · 추이 · 분포 · CSV', '별표 4 개별 등급과 별표 5 항목점수를 표시합니다. 제7조에 따라 학급·학년도별로 체력요소마다 검사 종목 하나를 설정할 수 있습니다. BMI 점수 세부 기준이 없어 100점 종합점수·종합등급은 아직 계산하지 않습니다. CSV는 교사 PIN 안에서 고른 기록만 내려받는 임시 자료이며 NEIS 양식이 아닙니다.');
    const programPanel = el('section', undefined, { className: 'classroom-item', id: 'papsProgramSelectionPanel' });
    programPanel.append(el('h4', '종합점수용 검사 종목 설정'), el('p', '교육부령 제354호 제7조제3항에 따라 체력요소별 검사 종목 1개를 학급·학년도 기준으로 선택합니다. 성별 기준이 다른 오래달리기-걷기와 팔굽혀펴기는 교사가 고른 종목 계열에서 평가표 기준에 맞는 항목을 찾습니다. 저장 내용은 PIN 암호화 자료에 포함됩니다.'));
    const configuredYears = [...new Set([2026, ...state.measurements.filter(row => row.classId === classId).map(row => row.schoolYear), ...(state.papsSelections || []).filter(row => row.classId === classId).map(row => row.schoolYear)])].sort((a, b) => b - a);
    const yearOptions = configuredYears.map(year => ({ id: String(year), name: `${year}학년도` }));
    const priorSelection = PapsPrograms.getSelection(state, classId, configuredYears[0]);
    const programYear = select(programPanel, '설정 학년도', 'papsProgramYear', yearOptions, String(configuredYears[0]));
    const programGrade = select(programPanel, '학급 학년 (직접 선택)', 'papsProgramGrade', gradeOptions, priorSelection?.gradeGroupId || '');
    const factorControls = new Map();
    for (const factor of PapsPrograms.FACTORS) factorControls.set(factor.id, select(programPanel, `${factor.label} 검사 종목`, `papsFactor-${factor.id}`, []));
    const programStatus = el('p', '학년도와 학급 학년을 직접 고른 뒤 체력요소별 종목을 설정해 주세요.', { id: 'papsProgramSelectionStatus', role: 'status', 'aria-live': 'polite' }); programPanel.append(programStatus);
    const refreshProgramStatus = () => {
      const selectedYear = Number(programYear.value), selectedGrade = programGrade.value;
      const saved = PapsPrograms.getSelection(state, classId, selectedYear);
      const savedMatchesGrade = Boolean(saved && saved.gradeGroupId === selectedGrade);
      const selections = Object.fromEntries([...factorControls].map(([factorId, control]) => [factorId, control.value]));
      const complete = PapsPrograms.FACTORS.every(factor => selections[factor.id]);
      const matchesSaved = savedMatchesGrade && complete && PapsPrograms.FACTORS.every(factor => saved.selections[factor.id] === selections[factor.id]);
      programStatus.textContent = !selectedGrade
        ? '학급 학년을 직접 선택해 주세요.'
        : complete
          ? `${matchesSaved ? '저장된 설정입니다.' : '선택을 마쳤습니다. 저장을 눌러 적용해 주세요.'} BMI 세부 배점이 없어 종합점수는 아직 계산하지 않습니다.`
          : `다섯 요소 중 ${PapsPrograms.FACTORS.filter(factor => selections[factor.id]).length}/5개를 선택했습니다. BMI 점수는 세부 기준 확인 전까지 미제공입니다.`;
    };
    const refreshProgramOptions = () => {
      const selectedYear = Number(programYear.value), selectedGrade = programGrade.value;
      const saved = PapsPrograms.getSelection(state, classId, selectedYear);
      const savedMatchesGrade = Boolean(saved && saved.gradeGroupId === selectedGrade);
      for (const factor of PapsPrograms.FACTORS) {
        const control = factorControls.get(factor.id);
        control.replaceChildren(el('option', '선택해 주세요', { value: '' }));
        const options = PapsPrograms.availableOptions(factor.id, { schoolYear: selectedYear, gradeGroupId: selectedGrade });
        for (const option of options) control.append(el('option', option.label, { value: option.id }));
        control.disabled = !selectedYear || !selectedGrade;
        control.value = savedMatchesGrade && options.some(option => option.id === saved.selections[factor.id]) ? saved.selections[factor.id] : '';
      }
      refreshProgramStatus();
    };
    programYear.addEventListener('change', () => {
      const saved = PapsPrograms.getSelection(state, classId, Number(programYear.value));
      programGrade.value = saved?.gradeGroupId || '';
      refreshProgramOptions();
    });
    programGrade.addEventListener('change', refreshProgramOptions);
    factorControls.forEach(control => control.addEventListener('change', refreshProgramStatus));
    refreshProgramOptions();
    actionButton(programPanel, '체력요소별 종목 설정 저장', async () => {
      const selections = Object.fromEntries([...factorControls].map(([factorId, control]) => [factorId, control.value]));
      await ui.write(s => PapsPrograms.saveSelection(s, { classId, schoolYear: Number(programYear.value), gradeGroupId: programGrade.value, selections }));
      await ui.renderTeacher();
      ui.notice('학급·학년도별 검사 종목 설정을 PIN 암호화해 저장했어요. BMI 세부 배점 확인 전에는 총점을 표시하지 않습니다.');
    }, 'savePapsProgramSelection');
    box.append(programPanel);
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
        else { trendGraph(trendOutput, rows, rows[0].unit); for (const row of rows) { const resultLabel = row.itemId === 'body-mass-index' ? (row.categoryLabel ? `BMI 구간 ${row.categoryLabel}` : 'BMI 구간 기준 미제공') : (row.score == null ? '항목 점수 기준 미제공' : `항목 점수 ${row.score}/20점 · ${row.scoreMethodVersion}`); trendOutput.append(el('p', `${row.schoolYear}학년도 · ${row.measuredOn} · ${row.value} ${row.unit} · ${resultLabel} · 등급 기준 ${row.criteriaSourceVersion}`)); } }
      } else trendOutput.append(el('p', '비교 범위가 섞이지 않도록 학년 기준과 평가표 구분을 직접 선택해 주세요.'));
      if (item.value && grade.value && target.value && year.value) {
        const result = Reports.classDistribution(state.measurements, { classId, schoolYear: Number(year.value), itemId: item.value, gradeGroupId: grade.value, targetGroupId: target.value });
        distributionOutput.append(el('h4', result.kind === 'bmi' ? '학급 BMI 구간 분포' : '학급 등급 분포'), el('p', `${result.included}개 수치 기록 분류 · ${result.missing}개 결측 · ${result.unavailable}개 기준 불일치/미제공`));
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
  function showCurriculumReference(host, reference) {
    const { code, gradeLabel, schoolYear, area, summary, source } = reference;
    host.append(el('p', `[${code}] · ${schoolYear}학년도 ${gradeLabel} · ${area}`),
      el('p', `요약 · ${summary}`));
    const citation = el('p', `${source.notice} · ${source.title} · ${source.section} · `);
    if (typeof source.url === 'string' && source.url.startsWith('https://')) {
      citation.append(el('a', '고시 원문 보기', { href: source.url, target: '_blank', rel: 'noopener noreferrer' }));
    }
    host.append(citation);
  }

  function curriculumHistory(parent, evaluation) {
    const history = el('details', undefined, { className: 'classroom-item' });
    let newer = evaluation.curriculumSnapshot;
    for (const entry of [...evaluation.history].reverse()) {
      const previous = entry.before?.curriculumSnapshot;
      if (entry.action === 'edit' && previous && JSON.stringify(previous) !== JSON.stringify(newer)) {
        const item = el('section', undefined, { className: 'classroom-item' });
        item.append(el('p', `${new Date(entry.changedAt).toLocaleDateString()} 변경 전`));
        showCurriculumReference(item, previous);
        history.append(item);
      }
      newer = previous;
    }
    if (!history.childElementCount) return;
    history.prepend(el('summary', '변경 전 성취기준 보기'));
    parent.append(history);
  }

  function curriculumPicker(parent, prefix, getYear, saved = null) {
    const fieldset = el('fieldset', undefined, { className: 'classroom-item' });
    fieldset.append(el('legend', '국가 체육 성취기준 (선택)'));
    parent.append(fieldset);
    const grades = Curriculum.GRADES.map(({ id, label }) => ({ id, name: label }));
    const grade = select(fieldset, '적용 학년', prefix + '-grade', grades, saved?.grade);
    const code = select(fieldset, '성취기준', prefix + '-code', []);
    const message = el('div', undefined, { className: 'classroom-status' });
    message.setAttribute('aria-live', 'polite');
    fieldset.append(message);
    const remove = 'remove-reference';
    const selected = () => code.value === remove ? null : code.value ? { grade: grade.value, code: code.value } : undefined;

    function refresh() {
      const year = getYear();
      const entries = Curriculum.list({ schoolYear: year, grade: grade.value });
      code.replaceChildren(el('option', saved ? `저장한 기준 유지 [${saved.code}]` : '미지정', { value: '' }));
      if (saved) code.append(el('option', '기준 연결 해제', { value: remove }));
      const groups = new Map();
      for (const entry of entries) {
        if (!groups.has(entry.area)) {
          const group = el('optgroup', undefined, { label: entry.area });
          groups.set(entry.area, group);
          code.append(group);
        }
        groups.get(entry.area).append(el('option', `[${entry.code}] ${entry.summary}`, { value: entry.code }));
      }
      code.disabled = !saved && !entries.length;
      const selectedGrade = Curriculum.GRADES.find(row => row.id === grade.value);
      message.textContent = !year ? '루브릭을 고르면 학년별 적용 기준을 확인할 수 있어요.'
        : !selectedGrade ? '기준을 연결하려면 평가 학년을 선택해 주세요.'
        : !entries.length ? `${selectedGrade.label}은 ${selectedGrade.firstYear}학년도부터 2022 개정 기준을 적용합니다.`
        : '수업 내용에 맞는 기준을 교사가 직접 선택합니다.';
    }
    grade.addEventListener('change', refresh);
    code.addEventListener('change', () => {
      const value = selected();
      if (value === undefined) return refresh();
      message.replaceChildren();
      if (value === null) message.textContent = '수정 저장 시 평가의 기준 연결을 해제합니다.';
      else showCurriculumReference(message, Curriculum.snapshot({ ...value, schoolYear: getYear() }));
    });
    refresh();
    return { refresh, selected };
  }

  function addEvaluationTools(ui, host, { state, classId, students }) {
    const box = section(host, '교사 루브릭 · 근거 평가 · 문안 승인', '교사가 만든 루브릭으로 수기 평가하고 수업에 맞는 국가 성취기준을 선택해 연결할 수 있습니다. 학생 관찰·성찰·직접 제출한 클립은 같은 학생의 평가 근거로 연결합니다. 문안은 교사가 직접 작성하고 승인한 뒤 로컬 CSV로 저장합니다.');
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
    const rubricSelect = select(box, '적용 루브릭', 'evaluationRubric', rubricValues);
    const curriculum = curriculumPicker(box, 'evaluationCurriculum', () => state.rubrics.find(row => row.id === rubricSelect.value && row.classId === classId)?.schoolYear);
    rubricSelect.addEventListener('change', curriculum.refresh);
    const ratingSelects = {};
    for (const dimension of E.DIMENSIONS) ratingSelects[dimension] = select(box, `${{ knowledge: '지식', skill: '기능', attitude: '태도' }[dimension]} 수준`, `evaluationRating-${dimension}`, [{ id: '1', name: '1 시작' }, { id: '2', name: '2 기초' }, { id: '3', name: '3 성장' }, { id: '4', name: '4 안정' }]);
    textarea(box, '교사 서술 (선택)', 'evaluationComment', '', 1000);
    const evidenceHost = el('div', undefined, { id: 'evaluationEvidenceOptions' }); box.append(el('h4', '같은 학생의 근거 선택'), evidenceHost);
    const refreshEvidence = () => { evidenceHost.replaceChildren(); for (const option of evidenceOptions(state, classId, studentSelect.value)) checkbox(evidenceHost, option.label, `evaluation-evidence-${option.type}-${option.id}`); };
    studentSelect.addEventListener('change', refreshEvidence); refreshEvidence();
    actionButton(box, '평가 초안 저장', async () => {
      const evidenceIds = [...evidenceHost.querySelectorAll('input[type=checkbox]:checked')].map(evidenceFromInput);
      const ratings = Object.fromEntries(E.DIMENSIONS.map(dimension => [dimension, $(`evaluationRating-${dimension}`).value ? Number($(`evaluationRating-${dimension}`).value) : null]));
      await ui.write(s => E.createEvaluation(s, {
        classId, studentId: studentSelect.value, rubricId: rubricSelect.value, ratings,
        comment: $('evaluationComment').value, evidenceIds, curriculum: curriculum.selected(),
      }));
      await ui.renderTeacher();
      ui.notice('평가 초안을 저장했어요. 모든 항목을 확인하고 교사가 승인해야 출력에 사용할 수 있습니다.');
    }, 'createEvaluationButton');

    box.append(el('h4', '평가 초안과 수정 이력'));
    const evalOutput = el('div', undefined, { id: 'assessmentRows' }); box.append(evalOutput);
    for (const item of state.assessments.filter(row => row.classId === classId)) {
      const student = students.find(row => row.id === item.studentId);
      const row = el('details', undefined, { className: 'classroom-item' }); row.append(el('summary', `${student?.name || '학생'} · ${item.rubricSnapshot?.title || '삭제된 루브릭'} 기준 v${item.rubricVersion || 1} · ${item.status === 'approved' ? '승인' : '초안'} · 평가 v${item.version}`));
      row.append(el('p', E.DIMENSIONS.map(dimension => `${dimension}: ${item.ratings[dimension] ?? '미평가'}`).join(' · ')), el('p', item.comment || '교사 서술 없음'), el('p', `근거: ${item.evidence.map(ref => `${ref.type}:${ref.id.slice(0, 8)}`).join(', ') || '없음'}`));
      if (item.curriculumSnapshot) {
        const saved = el('section', undefined, { className: 'classroom-item', id: `saved-curriculum-${item.id}` });
        saved.append(el('h5', '저장 당시 성취기준'));
        showCurriculumReference(saved, item.curriculumSnapshot);
        row.append(saved);
      }
      curriculumHistory(row, item);
      const editedCurriculum = curriculumPicker(row, `edit-curriculum-${item.id}`, () => item.schoolYear, item.curriculumSnapshot);
      const evidenceEditor = el('div', undefined, { className: 'classroom-evidence-edit' }); row.append(el('p', '수정할 근거 선택'), evidenceEditor);
      const evidenceSet = new Set(item.evidence.map(ref => `${ref.type}:${ref.id}`));
      for (const option of evidenceOptions(state, classId, item.studentId)) {
        const node = checkbox(evidenceEditor, option.label, `evaluation-evidence-${option.type}-${option.id}`, evidenceSet.has(`${option.type}:${option.id}`)); node.checked = evidenceSet.has(`${option.type}:${option.id}`);
      }
      const edits = {};
      for (const dimension of E.DIMENSIONS) edits[dimension] = select(row, `${dimension} 수정`, `edit-${item.id}-${dimension}`, [{ id: '1', name: '1 시작' }, { id: '2', name: '2 기초' }, { id: '3', name: '3 성장' }, { id: '4', name: '4 안정' }, { id: 'null', name: '미평가' }], item.ratings[dimension] ?? 'null');
      const comment = textarea(row, '교사 서술 수정', `edit-comment-${item.id}`, item.comment, 1000);
      actionButton(row, '평가 수정 저장', async () => {
        const ratings = Object.fromEntries(E.DIMENSIONS.map(dimension => [dimension, edits[dimension].value === 'null' ? null : Number(edits[dimension].value)]));
        const evidenceIds = [...evidenceEditor.querySelectorAll('input[type=checkbox]:checked')].map(evidenceFromInput);
        await ui.write(s => E.updateEvaluation(s, item.id, { ratings, comment: comment.value, evidenceIds, curriculum: editedCurriculum.selected() }));
        await ui.renderTeacher();
      });
      if (item.status !== 'approved') actionButton(row, '교사 승인', async () => { await ui.write(s => E.approveEvaluation(s, item.id)); await ui.renderTeacher(); });
      if (item.history.length) row.append(el('p', `변경 이력 ${item.history.length}건 · 마지막 ${new Date(item.history.at(-1).changedAt).toLocaleString()}`)); evalOutput.append(row);
    }

    box.append(el('h4', '교사가 직접 쓰는 문안'));
    const reportStudent = select(box, '문안 대상 학생', 'reportStudent', students);
    const approvedSelect = el('div', undefined, { id: 'approvedEvaluationOptions' }); box.append(approvedSelect);
    const refreshApproved = () => { approvedSelect.replaceChildren(); for (const item of state.assessments.filter(row => row.classId === classId && row.studentId === reportStudent.value && row.status === 'approved')) checkbox(approvedSelect, `승인 평가 · ${item.schoolYear} · ${item.id.slice(0, 8)}`, `report-evaluation-${item.id}`); };
    reportStudent.addEventListener('change', refreshApproved); refreshApproved();
    input(box, '문안 제목', 'reportTitle');
    const newReportBody = textarea(box, '교사 작성 문안', 'reportBody', '', 2000);
    const newByteReference = el('p', undefined, { id: 'reportByteReference' }); box.append(newByteReference);
    newReportBody.setAttribute('aria-describedby', newByteReference.id);
    const showByteReference = (output, body, visible) => {
      output.hidden = !visible;
      if (!visible) {
        output.textContent = '';
        return;
      }
      const limit = 1500;
      const bytes = E.reportBodyUtf8Bytes(body);
      const over = bytes > limit ? ` · ${(bytes - limit).toLocaleString('ko-KR')}바이트 초과` : '';
      output.textContent = `2026학년도 고교 과목별 세특 참고 · UTF-8 추정 ${bytes.toLocaleString('ko-KR')} / ${limit.toLocaleString('ko-KR')}바이트${over} · 특수문자는 나이스에서 확인해 주세요.`;
    };
    const refreshNewBytes = () => {
      const years = [...approvedSelect.querySelectorAll('input[type=checkbox]:checked')].map(node => state.assessments.find(item => item.id === node.id.slice('report-evaluation-'.length))?.schoolYear).filter(Number.isInteger);
      showByteReference(newByteReference, newReportBody.value, years.length > 0 && Math.max(...years) === 2026);
    };
    approvedSelect.addEventListener('change', refreshNewBytes);
    reportStudent.addEventListener('change', refreshNewBytes);
    newReportBody.addEventListener('input', refreshNewBytes); refreshNewBytes();
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
      if (report.schoolYear === 2026) {
        const reference = el('p', undefined, { id: `edit-report-byte-${report.id}` }); row.append(reference);
        body.setAttribute('aria-describedby', reference.id);
        const refresh = () => showByteReference(reference, body.value, true);
        body.addEventListener('input', refresh); refresh();
      }
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
    const box = section(host, '오프라인 QR·GPS 미션 만들기', 'QR에는 무작위 미션 ID만 담습니다. GPS는 첫 활동의 도착 여부를 한 번 확인하는 선택 기능입니다. 이동 경로·현재 좌표는 저장하지 않으며 위치가 확인되지 않으면 완료로 처리하지 않습니다.');
    input(box, '미션 제목', 'qrMissionTitle'); input(box, '활동 제목', 'qrActivityTitle'); textarea(box, '활동 안내', 'qrActivityInstructions', '', 3000);
    textarea(box, '추가 순서 활동 (한 줄에 제목 | 안내, 선택)', 'qrAdditionalActivities', '', 6000);
    textarea(box, '선택 퀴즈 질문 (첫 활동에 추가, 선택)', 'qrQuizPrompt', '', 1000);
    textarea(box, '퀴즈 보기 (한 줄에 하나, 2~12개)', 'qrQuizOptions', '', 2000);
    input(box, '정답 번호 (보기의 1부터 시작)', 'qrQuizCorrectIndex', 'number');
    select(box, '대상 모둠 (선택)', 'qrMissionGroup', groups);
    const gpsOptions = el('details'); gpsOptions.append(el('summary', 'GPS 도착 미션 (첫 활동, 선택)')); box.append(gpsOptions);
    const useGps = checkbox(gpsOptions, '첫 활동에 GPS 도착 확인 사용', 'qrGpsEnabled');
    const targetLat = input(gpsOptions, '목표 위도', 'qrGpsLatitude', 'number'); targetLat.step = 'any';
    const targetLon = input(gpsOptions, '목표 경도', 'qrGpsLongitude', 'number'); targetLon.step = 'any';
    input(gpsOptions, '도착 반경 (10~200m)', 'qrGpsRadius', 'number', 30);
    const safeLat = input(gpsOptions, '안전 구역 중심 위도', 'qrGpsSafeLatitude', 'number'); safeLat.step = 'any';
    const safeLon = input(gpsOptions, '안전 구역 중심 경도', 'qrGpsSafeLongitude', 'number'); safeLon.step = 'any';
    input(gpsOptions, '안전 구역 반경 (20~1000m)', 'qrGpsSafeRadius', 'number', 100);
    const safety = checkbox(gpsOptions, '교사가 현장을 확인했고 도로·차량·위험 시설을 피한 이동 경로와 안전 구역입니다.', 'qrGpsSafety');
    gpsOptions.append(el('p', 'GPS 오차가 큰 실내에서는 사용하지 마세요. 확인이 안 되면 더 이동하지 말고 교사에게 알려 주세요. 목표·안전 구역 좌표는 이 기기에 PIN 암호화해 보관합니다.'));
    actionButton(gpsOptions, '현재 위치를 한 번 읽어 목표·안전 중심에 입력', async () => {
      if (document.hidden) return;
      const access = ui.access(), epoch = ui.epoch; stopGps(ui); const controller = ui.gpsController = new AbortController();
      let fix; try { fix = await GPS.locate({ signal: controller.signal }); } finally { if (ui.gpsController === controller) ui.gpsController = null; } ui.accessCheck(access);
      if (ui.epoch !== epoch || !ui.access().unlocked || !gpsOptions.isConnected || !gpsOptions.open || document.hidden) return;
      targetLat.value = safeLat.value = String(fix.latitude); targetLon.value = safeLon.value = String(fix.longitude);
      ui.notice('현재 위치를 입력했어요. 지도·현장을 직접 확인해 안전 구역을 정해 주세요.');
    }, 'qrGpsLocate');
    actionButton(box, '미션과 익명 QR 만들기', async () => {
      const groupId = $('qrMissionGroup').value || null; const kind = groupId ? 'group' : 'station';
      const activities = [{ kind, title: $('qrActivityTitle').value, instructions: $('qrActivityInstructions').value, ...(groupId ? { groupId } : {}) }];
      if (useGps.checked) {
        if ([targetLat, targetLon, safeLat, safeLon].some(node => !node.value.trim())) throw new Error('GPS 목표와 안전 구역의 위도·경도를 입력해 주세요.');
        activities[0].gps = GPS.validate({ target: { latitude: Number(targetLat.value), longitude: Number(targetLon.value) }, radiusM: Number($('qrGpsRadius').value), safeArea: { latitude: Number(safeLat.value), longitude: Number(safeLon.value), radiusM: Number($('qrGpsSafeRadius').value) }, safetyReviewed: safety.checked });
      }
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
    ui.qrScanGeneration = (ui.qrScanGeneration || 0) + 1;
    if (ui.qrAnimation) cancelAnimationFrame(ui.qrAnimation); ui.qrAnimation = null;
    if (ui.qrCameraStream) { ui.qrCameraStream.getTracks().forEach(track => track.stop()); ui.qrCameraStream = null; }
    if (ui.qrCameraVideo) { ui.qrCameraVideo.srcObject = null; ui.qrCameraVideo = null; }
  }
  function stopGps(ui) { ui.gpsController?.abort(); ui.gpsController = null; }
  async function scanCamera(ui, video, inputNode) {
    const fallback = 'QR 아래 표시된 무작위 ID를 직접 입력해 주세요.';
    stopScanner(ui);
    const generation = ui.qrScanGeneration;
    if (typeof root.BarcodeDetector !== 'function' || !navigator.mediaDevices?.getUserMedia) throw new Error(`이 브라우저는 QR 자동 스캔을 지원하지 않습니다. ${fallback}`);
    let detector;
    try {
      if (root.BarcodeDetector.getSupportedFormats && !(await root.BarcodeDetector.getSupportedFormats()).includes('qr_code')) throw new Error('unsupported');
      detector = new root.BarcodeDetector({ formats: ['qr_code'] });
    } catch { throw new Error(`이 브라우저는 QR 자동 스캔을 지원하지 않습니다. ${fallback}`); }
    if (generation !== ui.qrScanGeneration || !video.isConnected || document.hidden) return;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      if (generation !== ui.qrScanGeneration || !video.isConnected || document.hidden) { stream.getTracks().forEach(track => track.stop()); return; }
      ui.qrCameraStream = stream;
      ui.qrCameraVideo = video;
      video.srcObject = stream;
      await video.play();
      if (generation !== ui.qrScanGeneration || !video.isConnected) { stream.getTracks().forEach(track => track.stop()); return; }
    } catch (error) {
      if (generation !== ui.qrScanGeneration) { stream?.getTracks().forEach(track => track.stop()); return; }
      stopScanner(ui);
      throw new Error(error.name === 'NotAllowedError' ? `카메라 권한이 거부됐어요. ${fallback}` : `카메라를 시작하지 못했어요. ${fallback}`);
    }
    const loop = async () => {
      if (generation !== ui.qrScanGeneration || !video.isConnected || ui.qrCameraStream !== stream) return;
      try {
        const found = await detector.detect(video);
        if (generation !== ui.qrScanGeneration || !video.isConnected || ui.qrCameraStream !== stream) return;
        if (found[0]?.rawValue) { inputNode.value = found[0].rawValue; stopScanner(ui); $('qrScanButton')?.click(); return; }
      } catch { /* retry next frame */ }
      if (generation !== ui.qrScanGeneration || !video.isConnected || ui.qrCameraStream !== stream) return;
      ui.qrAnimation = requestAnimationFrame(loop);
    };
    ui.qrAnimation = requestAnimationFrame(loop);
  }
  function addQrStudentTools(ui, host, state, binding) {
    if (!binding) return;
    const box = section(host, '학생 QR 미션 참여 (익명·이 기기 전용)', '교사에게 받은 QR을 스캔하거나 QR 아래의 무작위 ID를 입력합니다. 이 흐름은 학생 ID·이름·위치를 연결하지 않습니다. 스캐너 미지원 시 텍스트 입력을 사용하세요.');
    let panelGeneration = 0;
    box.addEventListener('toggle', () => {
      if (box.open || !box.isConnected) return;
      panelGeneration++;
      stopScanner(ui);
      stopGps(ui);
    });
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
      missionStatus = { sessionId: session.id, missionId: mission.id, phase: session.phase, activityIndex: session.activityIndex, completed: session.phase === 'completed', ...(session.phase === 'completed' ? {} : { activity: { id: active.id, kind: active.kind, title: active.title, instructions: active.instructions, ...(active.groupId ? { groupId: active.groupId } : {}), ...(active.criteria ? { criteria: active.criteria } : {}), ...(active.gps ? { gps: active.gps } : {}), ...(active.quiz ? { quiz: { prompt: active.quiz.prompt, options: active.quiz.options } } : {}) } }) };
    }
    catch (error) { status.append(el('p', `저장된 미션 상태를 읽지 못했습니다: ${error.message}`)); return; }
    const show = result => {
      status.replaceChildren();
      if (result.completed) { status.append(el('p', '모든 미션 활동을 완료했어요. 참여 기록은 익명입니다.')); return; }
      status.append(el('h4', result.activity.title), el('p', result.activity.instructions), el('p', result.activity.criteria || '교사가 안내한 방법으로 활동해 주세요.'));
      if (result.activity.quiz) select(status, result.activity.quiz.prompt, 'qrAnswer', result.activity.quiz.options);
      const gpsConsent = result.activity.gps ? checkbox(status, '위치를 한 번 확인해 도착 여부만 기록합니다. 이동 중에는 화면을 보지 않고, 확인이 안 되면 교사에게 알립니다.', 'qrGpsConsent') : null;
      const completeButton = actionButton(status, result.activity.gps ? '현재 위치로 도착 확인하고 활동 완료' : '이 활동 완료', async () => {
        if (completeButton.disabled || document.hidden) return;
        const access = ui.access(), epoch = ui.epoch, generation = panelGeneration;
        const answerOptionId = result.activity.quiz ? $('qrAnswer').value : undefined;
        const valid = () => !document.hidden && ui.epoch === epoch && generation === panelGeneration &&
          box.open && status.isConnected && ui.access().key === access.key;
        completeButton.disabled = true;
        try {
          let locationFix;
          if (result.activity.gps) {
            if (!gpsConsent.checked) throw new Error('일회성 위치 확인 안내를 먼저 확인해 주세요.');
            stopGps(ui); const controller = ui.gpsController = new AbortController(); try { locationFix = await GPS.locate({ signal: controller.signal }); } finally { if (ui.gpsController === controller) ui.gpsController = null; }
          }
          ui.accessCheck(access); if (!valid()) throw new Error('미션 화면이 바뀌어 위치 결과를 사용하지 않았어요.');
          const responseId = crypto.randomUUID();
          await ui.write(s => { const { store, data } = readQrStore(s, binding.classId); if (store.activeSessionId !== result.sessionId) throw new Error('미션 세션이 바뀌었어요.'); Q.respond(data, { responseId, sessionId: store.activeSessionId, missionId: result.missionId, classId: binding.classId, activityId: result.activity.id, completed: true, ...(result.activity.groupId ? { groupId: result.activity.groupId } : {}), ...(result.activity.quiz ? { answerOptionId } : {}) }, { locationFix }); store.serialized = Q.serialize(data); const index = s.qrMissionStores.findIndex(row => row.classId === binding.classId); s.qrMissionStores[index] = store; }, { validate: valid }); await ui.renderStudent();
        } finally { if (completeButton.isConnected) completeButton.disabled = false; }
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
    const box = section(host, '익명 전술판 · 모둠 회고 · 경기 사례 찾기', '선수 이름이나 학생 번호 대신 익명 토큰을 사용합니다. 팀이 원하는 상황을 설명하면 실제 농구·배구 경기 사례를 출처와 함께 찾아 비교합니다. 정답 전술이나 학생 실행 지시가 아닙니다. 배치는 이 기기에 PIN 암호화해 저장하며, 선택한 배치만 별도 서버에 암호화 공유할 수 있습니다.');
    const classBoards = state.tacticsBoards.filter(row => row.classId === classId);
    const selectedBoardId = classBoards.some(row => row.id === ui.tacticsBoardId) ? ui.tacticsBoardId : classBoards[0]?.id;
    let item = getBoard(state, classId, selectedBoardId); const board = item.board;
    const boardChoice = select(box, '전술판 선택', 'tacticsBoardChoice', classBoards.map(row => ({ id: row.id, name: row.title })), item.id);
    boardChoice.addEventListener('change', () => { ui.tacticsBoardId = boardChoice.value; ui.renderTeacher(); });
    const summary = el('div', undefined, { className: 'classroom-item' }); summary.append(el('p', `팀 ${board.teams.length} · 익명 토큰 ${board.tokens.length} · 화살표 ${board.arrows.length} · 표식 ${board.marks.length}`)); box.append(summary);
    tacticsPreview(box, board);
    actionButton(box, '새 빈 전술판 추가', async () => { let createdId; await ui.write(s => { const index = s.tacticsBoards.findIndex(row => row.classId === classId); const created = index < 0 ? getBoard(s, classId) : { ...getBoard(s, classId), id: crypto.randomUUID(), title: `전술판 ${s.tacticsBoards.filter(row => row.classId === classId).length + 1}`, board: T.createBoard(), createdAt: Date.now(), expiresAt: Date.now() + M.MAX_RETENTION }; delete created.share; s.tacticsBoards.push(created); createdId = created.id; }); ui.tacticsBoardId = createdId; await ui.renderTeacher(); });
    actionButton(box, '현재 전술판 복제', async () => { let createdId; await ui.write(s => { const original = s.tacticsBoards.find(row => row.id === item.id); const created = { ...JSON.parse(JSON.stringify(original)), id: crypto.randomUUID(), title: `전술판 ${s.tacticsBoards.filter(row => row.classId === classId).length + 1}`, createdAt: Date.now(), expiresAt: Date.now() + M.MAX_RETENTION }; delete created.share; s.tacticsBoards.push(created); createdId = created.id; }); ui.tacticsBoardId = createdId; await ui.renderTeacher(); });
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
    box.append(el('p', `현재 판 이름: ${item.title}. 공유·LLM에는 익명 도형 배치만 사용하며 자유 문장 회고는 이 기기에만 보관합니다.`));
    root.TacticsToolsUI?.render(ui, box, item, classId);
  }
  function addWearableStatus(ui, host, { classId, students }) {
    ui.wearableUnsubscribe?.();
    const box = section(host, '웨어러블 — 수업 중 심박수 시범 연동 준비', `출시일이 ${W.MIN_RELEASE_DATE}인 모델부터 확인합니다. 학생 휴대폰이 워치와 페어링하고, 같은 Wi-Fi에서 교사 태블릿 앱으로 심박을 전달합니다.`);
    const reference = el('details', undefined, { className: 'classroom-item', id: 'wearableModelReference' });
    reference.append(el('summary', '기기 후보와 휴대폰 OS 확인'),
      el('p', '제조사 자료에서 확인한 최초 출시 시점의 조건입니다. 업데이트한 워치는 더 최신 휴대폰 OS가 필요할 수 있습니다. 아래 모델은 PE Loop 실기기 연결 확인 전입니다.'));
    const families = el('ul');
    for (const row of W.MODEL_REFERENCE) families.append(el('li', `${row.product} · ${row.release} · ${row.watch} · ${row.phone}`));
    reference.append(families, el('p', 'Apple의 A 모델 번호는 아래에서 확인할 수 있습니다. 앱에서 읽는 내부 식별자는 연결 시험 때 별도로 확인합니다.'));
    const vendorLinks = el('p');
    vendorLinks.append(el('a', 'Apple 시계·iPhone 호환성', { href: 'https://support.apple.com/ko-kr/118490', target: '_blank', rel: 'noopener noreferrer' }),
      ' · ', el('a', 'Apple 모델 번호', { href: 'https://support.apple.com/ko-kr/108056', target: '_blank', rel: 'noopener noreferrer' }),
      ' · ', el('a', '삼성 워치 모델 번호', { href: 'https://www.samsung.com/sec/watches/all-watches/', target: '_blank', rel: 'noopener noreferrer' }));
    reference.append(vendorLinks);
    box.append(reference);
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
  root.ClassroomToolsUI = Object.freeze({ renderTeacher, renderStudent, stopScanner, stopWearable, stopGps });
})(globalThis);
