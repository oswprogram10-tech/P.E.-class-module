/* Local classroom workflow and optional classroom hub. */
(function (root) {
  'use strict';
  const M = root.ClassroomModel;
  const P = root.PapsCriteria;
  const BMI = root.PapsBmiCriteria;
  const PAPS_GRADE_OPTIONS = Object.freeze([
    ['elementary-3', '초3'], ['elementary-4', '초4'], ['elementary-5', '초5'], ['elementary-6', '초6'],
    ['middle-1', '중1'], ['middle-2', '중2'], ['middle-3', '중3'],
    ['high-1', '고1'], ['high-2', '고2'], ['high-3', '고3'],
  ].map(([id, name]) => Object.freeze({ id, name })));
  const PAPS_TARGET_OPTIONS = Object.freeze([{ id: 'male', name: '남자 기준' }, { id: 'female', name: '여자 기준' }]);
  const PAPS_GRADE_LABELS = new Map(PAPS_GRADE_OPTIONS.map(option => [option.id, option.name]));
  const PAPS_TARGET_LABELS = new Map(PAPS_TARGET_OPTIONS.map(option => [option.id, option.name]));
  const el = (tag, text, attrs = {}) => Object.assign(document.createElement(tag), { ...(text === undefined ? {} : { textContent: text }), ...attrs });
  const $ = id => document.getElementById(id);
  function field(parent, label, id, type = 'text') { const wrap = el('label', label); const input = el('input', undefined, { id, type }); input.maxLength = 100; wrap.append(input); parent.append(wrap); return input; }
  function localDate(date = new Date()) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
  function button(parent, text, id, action) { const b = el('button', text, { id, type: 'button', className: 'secondary-button' }); const teacherOnly = parent.id === 'classroomTeacherRoot' || Boolean(parent.closest('#classroomTeacherRoot')); b.onclick = () => { if (teacherOnly && !root.classroomAccessUnlocked()) return; Promise.resolve().then(action).catch(error => { $('classroomStatus').textContent = error.message; }); }; parent.append(b); return b; }
  function select(parent, label, id, items, value) { const wrap = el('label', label); const s = el('select', undefined, { id }); s.append(el('option', '선택해 주세요', { value: '' })); for (const item of items) s.append(el('option', item.name || item.id.slice(0, 8), { value: item.id })); s.value = value || ''; wrap.append(s); parent.append(wrap); return s; }
  const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
  const productionHub = location.protocol === 'https:' && location.hostname !== 'appassets.androidplatform.net'
    ? `${location.origin}/classroom-api` : '';
  function safeHub(value) {
    if (typeof value === 'string' && value.trim()) {
      const url = new URL(value, location.origin);
      if (!url.username && !url.password && !url.search && !url.hash) {
        const baseUrl = url.href.replace(/\/$/, '');
        if (productionHub && baseUrl === productionHub) return productionHub;
        if (location.protocol === 'http:' && LOOPBACK.has(location.hostname) &&
            url.protocol === 'http:' && LOOPBACK.has(url.hostname) && url.pathname === '/') return url.origin;
      }
    }
    throw new Error('학교 앱은 같은 HTTPS 주소의 학급 서버에 연결합니다. 개발 허브는 localhost에서 연결해 주세요.');
  }
  async function hubLogin(url, route, body) {
    const response = await fetch(url + route, {
      signal: AbortSignal.timeout(10000), method: 'POST', redirect: 'error', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const result = await response.json().catch(() => null);
    if (response.ok && typeof result?.token === 'string' && result.token) return result;
    if (response.status === 429) throw new Error('연결 시도가 너무 많아요. 잠시 후 다시 시도해 주세요.');
    if (route === '/teacher' && response.status === 403) throw new Error('이 학급의 허브 교사 비밀값을 확인해 주세요.');
    if (route === '/join' && [403, 410].includes(response.status)) throw new Error('참여 코드가 만료되었거나 이미 사용됐어요.');
    throw new Error('학급 서버에 연결하지 못했어요. 주소와 서버 상태를 확인해 주세요.');
  }
  async function dataURL(blob) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); }); }
  class ClassroomUI {
    constructor(options) {
      Object.assign(this, options); root.classroomAccessUnlocked = () => this.access().unlocked; this.store = new ClassroomRepository(options.repository); this.state = M.createState(); this.version = 0; this.epoch = 0; this.chain = Promise.resolve(); this.busy = false; this.remote = []; this.urls = []; this.teacherClient = null; this.studentClient = null; this.connection = null;
      this.pendingJoin = null;
      if (location.hash.startsWith('#join=')) { try { this.pendingJoin = JSON.parse(atob(location.hash.slice(6))); } catch {} history.replaceState(null, '', location.pathname + location.search); }
      window.addEventListener('online', () => { if (this.studentClient) this.sync().catch(error => this.notice(error.message)); });
      window.addEventListener('pagehide', () => this.closeAll());
      this.channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('pe-loop-classroom') : null;
      this.channel?.addEventListener('message', event => { if (event.data === 'lock') this.closeAll(false); });
    }
    notice(text) { $('classroomStatus').textContent = text; }
    accessCheck(access) { const now = this.access(); if (!access.key || access.key !== now.key || access.revision !== now.revision) throw new Error('PIN 상태가 바뀌었어요. 다시 열어 주세요.'); }
    async load() { const a = this.access(); this.accessCheck(a); const result = await this.store.load(a.key, a.revision); this.accessCheck(a); this.state = result.state; this.version = result.version; return a; }
    async write(action, { signal, validate, clipId } = {}) {
      const epoch = this.epoch;
      const work = this.chain.catch(() => {}).then(async () => { this.busy = true; try { const a = await this.load(); if (epoch !== this.epoch) throw new Error('작업이 중단됐어요.'); const result = await action(this.state); this.accessCheck(a); if (epoch !== this.epoch) throw new Error('작업이 중단됐어요.'); signal?.throwIfAborted(); if (validate && validate() !== true) throw new Error('작업 상태가 바뀌어 기록하지 않았어요.'); this.version = await this.store.save(this.state, a.key, a.revision, this.version, { signal, validate, clipId }); return result; } finally { this.busy = false; } });
      this.chain = work; return work;
    }
    binding() { const b = this.state.binding; if (!b) return null; try { return { ...b, student: M.get(this.state, 'students', b.studentId, b.classId), lesson: M.get(this.state, 'lessons', b.lessonId, b.classId) }; } catch { return null; } }
    metadata() { const b = this.binding(); return b ? { classId: b.classId, studentId: b.studentId, lessonId: b.lessonId, groupId: b.groupId || null, deviceId: b.deviceId, reflectionId: crypto.randomUUID() } : {}; }
    async teacherOpen() { const generation = this.openGeneration = (this.openGeneration || 0) + 1; try { await this.load(); if (generation !== this.openGeneration) return; await this.write(s => M.expire(s)); if (generation !== this.openGeneration) return; if (this.access().unlocked) await this.renderTeacher(); await this.renderStudent(); } catch (error) { this.notice(error.message); } }
    teacherClose() { root.ClassroomToolsUI?.stopGps(this); this.tacticsRequest?.abort(); window.dispatchEvent(new Event('tactics-context-end')); void Promise.resolve().then(() => root.TacticsLocalAdvisor?.release?.()).catch(() => {}); this.tacticsAdminToken = null; root.ClassroomToolsUI?.stopScanner(this); if (this.access().unlocked) { this.openGeneration = (this.openGeneration || 0) + 1; this.epoch++; } this.revokeUrls(); $('classroomTeacherRoot').replaceChildren(); this.teacherClient?.logout().catch(() => {}); this.teacherClient = null; this.revokeUrls(); }
    closeAll(broadcast = true) { root.ClassroomToolsUI?.stopScanner(this); void root.ClassroomToolsUI?.stopWearable(this); if (this.exerciseTimer) clearInterval(this.exerciseTimer); this.exerciseTimer = null; this.exercisePlayer = null; this.epoch++; this.teacherClose(); this.studentClient?.logout().catch(() => {}); this.studentClient = null; this.connection = null; this.state = M.createState(); this.remote = []; $('studentWorkspace').hidden = true; $('studentClassroomRoot').replaceChildren(); if (broadcast) this.channel?.postMessage('lock'); }
    revokeUrls() { this.urls.forEach(url => URL.revokeObjectURL(url)); this.urls = []; document.querySelectorAll('.classroom-video').forEach(video => { video.pause(); video.removeAttribute('src'); video.load(); }); }
    async removed(clipId) { if (!this.access().key) return; await this.write(state => M.removeClip(state, clipId)); await this.renderStudent(); }
    async refresh() { if (!this.access().key) return; await this.write(async state => { const ids = new Set((await this.repository.all()).filter(record => expiry(record) > Date.now()).map(record => record.id)); for (const item of state.submissions.filter(item => !item.deletedAt && !ids.has(item.clipId))) M.removeClip(state, item.clipId); M.expire(state); }); await this.renderStudent(); }
    async saved() { await this.renderStudent(); }
    async renderTeacher() {
      if (!this.access().unlocked) return; const host = $('classroomTeacherRoot'); const toolOpenStates = Array.from(host.querySelectorAll('.classroom-tool'), item => item.open); host.replaceChildren(); const state = this.state;
      host.append(el('p', '학급·명단·관찰과 전송 대기열은 교사 PIN으로 암호화해 이 기기에 보관합니다. 기존 이름·번호 클립은 자동 배정하지 않습니다.'));
      const cls = select(host, '학급', 'classSelect', state.classes, this.classId || state.classes[0]?.id); cls.disabled = Boolean(this.measurementEditId); this.classId = cls.value; cls.onchange = () => { this.tacticsRequest?.abort(); window.dispatchEvent(new Event('tactics-context-end')); void Promise.resolve().then(() => root.TacticsLocalAdvisor?.release?.()).catch(() => {}); void root.ClassroomToolsUI?.stopWearable(this); this.classId = cls.value; this.teacherClient?.logout().catch(() => {}); this.teacherClient = null; this.renderTeacher(); };
      const create = el('div', undefined, { className: 'classroom-grid' }); host.append(create); field(create, '새 학급 이름', 'newClassName'); button(create, '학급 만들기', 'addClassButton', async () => { const item = await this.write(s => M.add(s, 'classes', { name: $('newClassName').value })); this.tacticsRequest?.abort(); window.dispatchEvent(new Event('tactics-context-end')); void Promise.resolve().then(() => root.TacticsLocalAdvisor?.release?.()).catch(() => {}); this.classId = item.id; await this.renderTeacher(); });
      const classId = this.classId;
      if (this.teacherClient && this.teacherHubClassId !== classId) {
        this.teacherClient.logout().catch(() => {});
        this.teacherClient = null;
      }
      if (!classId) return;
      const students = state.students.filter(x => x.classId === classId), lessons = state.lessons.filter(x => x.classId === classId), groups = state.groups.filter(x => x.classId === classId), devices = state.devices.filter(x => x.classId === classId);
      const roster = el('div', undefined, { className: 'classroom-grid' }); host.append(el('h3', '명단 · 모둠 · 수업 · 기기'), roster);
      field(roster, '학생 이름', 'rosterName'); field(roster, '번호 (동명이인·같은 번호 허용)', 'rosterNumber'); select(roster, '모둠', 'rosterGroup', groups);
      button(roster, '학생 추가', 'addStudentButton', async () => { await this.write(s => M.add(s, 'students', { classId, name: $('rosterName').value, number: $('rosterNumber').value, groupId: $('rosterGroup').value || null })); await this.renderTeacher(); });
      field(roster, '모둠 이름', 'newGroupName'); button(roster, '모둠 추가', 'addGroupButton', async () => { await this.write(s => M.add(s, 'groups', { classId, name: $('newGroupName').value })); await this.renderTeacher(); });
      field(roster, '수업 이름', 'newLessonName'); field(roster, '단원', 'newLessonUnit'); field(roster, '종목', 'newLessonSport'); button(roster, '수업 만들기', 'addLessonButton', async () => { await this.write(s => M.add(s, 'lessons', { classId, name: $('newLessonName').value, unit: $('newLessonUnit').value, sport: $('newLessonSport').value })); await this.renderTeacher(); });
      field(roster, '기기 이름', 'newDeviceName'); button(roster, '기기 추가', 'addDeviceButton', async () => { await this.write(s => M.add(s, 'devices', { classId, name: $('newDeviceName').value })); await this.renderTeacher(); });
      const editingRecord = (state.measurements || []).find(record => record.id === this.measurementEditId && record.classId === classId) || null;
      if (this.measurementEditId && !editingRecord) this.measurementEditId = null;
      cls.disabled = Boolean(editingRecord);
      const measurementDate = editingRecord?.measuredOn || (this.measurementDraft?.classId === classId ? this.measurementDraft.measuredOn : localDate());
      const measurementYear = editingRecord?.schoolYear ?? (this.measurementDraft?.classId === classId ? this.measurementDraft.schoolYear : M.schoolYearForDate(measurementDate));
      const measurementStudent = editingRecord?.studentId || students.find(student => student.id === this.measurementDraft?.studentId)?.id || students[0]?.id;
      const measurementItems = M.MEASUREMENT_ITEMS;
      const measurementPanel = el('section', undefined, { className: 'classroom-measurements' });
      measurementPanel.append(el('h3', '체력 측정값 수기 기록'), el('p', '측정값은 PIN으로 암호화해 이 기기에만 저장합니다. 2026학년도 별표 4 기준은 교사가 학년과 평가표 구분을 직접 확인한 경우에만 종목별 등급·20점 항목점수 또는 BMI 구간을 조회합니다. 선택한 기준 범위와 버전도 기록과 함께 암호화해 보관합니다. 이름·학급명으로 기준을 추정하지 않습니다. 초3은 학교 선택평가입니다. BMI 항목점수는 아직 미산출이며, BMI 구간은 PAPS 별표 4 참고 분류로 의학적 진단이 아닙니다. 5개 요소 종합점수·종합등급·백분위·건강 진단은 계산하지 않습니다. 학년도 기준 최대 3개 학년도 보관하며 측정 기록과 학생·학급 식별 정보는 같은 시한에 암호화 상태로 정리합니다.'));
      const measurementForm = el('div', undefined, { className: 'classroom-grid' }); measurementPanel.append(measurementForm);
      host.append(measurementPanel);
      const studentOptions = students.map(student => ({ ...student, name: `${student.number || '-'}번 ${student.name} · ID ${student.id.slice(0, 6)}` }));
      const measurementStudentSelect = select(measurementForm, '학생 (S3 ID로 구분)', 'measurementStudent', studentOptions, measurementStudent); measurementStudentSelect.disabled = Boolean(editingRecord);
      const yearInput = field(measurementForm, '학년도', 'measurementSchoolYear', 'number'); yearInput.min = '2000'; yearInput.max = '2100'; yearInput.step = '1'; yearInput.value = measurementYear; yearInput.disabled = Boolean(editingRecord);
      const dateInput = field(measurementForm, '측정일', 'measurementDate', 'date'); dateInput.value = measurementDate;
      select(measurementForm, '측정 종목', 'measurementItem', measurementItems, editingRecord?.itemId || (this.measurementDraft?.classId === classId ? this.measurementDraft.itemId : measurementItems[0]?.id));
      const valueInput = field(measurementForm, '측정값', 'measurementValue', 'number');
      valueInput.inputMode = 'decimal'; if (editingRecord?.value !== null && editingRecord?.value !== undefined) valueInput.value = String(editingRecord.value);
      const heightInput = field(measurementForm, '키 (cm)', 'measurementHeightCm', 'number');
      heightInput.min = '50'; heightInput.max = '250'; heightInput.step = '0.1'; heightInput.inputMode = 'decimal'; heightInput.value = editingRecord?.heightCm == null ? '' : String(editingRecord.heightCm);
      const weightInput = field(measurementForm, '몸무게 (kg)', 'measurementWeightKg', 'number');
      weightInput.min = '5'; weightInput.max = '300'; weightInput.step = '0.1'; weightInput.inputMode = 'decimal'; weightInput.value = editingRecord?.weightKg == null ? '' : String(editingRecord.weightKg);
      const bmiConsentPanel = el('div', undefined, { id: 'bmiConsentPanel', hidden: true, className: 'classroom-item' });
      bmiConsentPanel.append(el('p', 'BMI 원자료를 기록하기 전에 학생 본인과 보호자의 동의를 모두 확인해 주세요. 동의서 원본이나 연락처는 입력하지 않고, 확인 여부도 측정 기록에 저장하지 않습니다.'));
      const studentConsent = el('input', undefined, { id: 'bmiStudentConsent', type: 'checkbox' });
      const studentConsentLabel = el('label', '이 기록에 대한 학생 본인의 동의를 확인했습니다.'); studentConsentLabel.prepend(studentConsent);
      const guardianConsent = el('input', undefined, { id: 'bmiGuardianConsent', type: 'checkbox' });
      const guardianConsentLabel = el('label', '이 기록에 대한 보호자의 동의를 확인했습니다.'); guardianConsentLabel.prepend(guardianConsent);
      bmiConsentPanel.append(studentConsentLabel, guardianConsentLabel); measurementForm.append(bmiConsentPanel);
      const unit = el('p', '', { id: 'measurementUnit' }); measurementForm.append(unit);
      const criteriaGrade = select(measurementForm, '측정 학년 (직접 확인)', 'measurementCriteriaGrade', PAPS_GRADE_OPTIONS, editingRecord?.assessmentGradeGroupId || editingRecord?.criteriaGradeGroupId || '');
      const criteriaTarget = select(measurementForm, '평가표 구분 (직접 확인)', 'measurementCriteriaTarget', PAPS_TARGET_OPTIONS, editingRecord?.assessmentTargetGroupId || editingRecord?.criteriaTargetGroupId || '');
      const criteriaPreview = el('p', '학년과 평가표 구분을 직접 선택하면 별표 4의 개별 종목 등급을 미리 봅니다.', { id: 'measurementCriteriaResult', className: 'measurement-criteria-result' });
      criteriaPreview.setAttribute('role', 'status'); criteriaPreview.setAttribute('aria-live', 'polite');
      measurementForm.append(criteriaPreview);
      const missingChoices = [{ id: '', name: '측정값 입력' }, ...M.MISSING_REASONS];
      const missing = select(measurementForm, '측정값이 없을 때', 'measurementMissingReason', missingChoices, editingRecord?.missingReason || '');
      const missingNote = field(measurementForm, '결측 메모 (기타 선택 시 필수)', 'measurementMissingNote'); missingNote.maxLength = 120; missingNote.value = editingRecord?.missingNote || '';
      let wasBmiItem = false;
      const bmiConsentConfirmed = () => studentConsent.checked && guardianConsent.checked;
      const updateBmiConsent = () => {
        const bmiItem = $('measurementItem').value === 'body-mass-index';
        if (bmiItem && !bmiConsentConfirmed()) { heightInput.value = ''; weightInput.value = ''; }
        heightInput.disabled = !bmiItem || !bmiConsentConfirmed() || Boolean(missing.value);
        weightInput.disabled = !bmiItem || !bmiConsentConfirmed() || Boolean(missing.value);
        heightInput.required = bmiItem && !missing.value && bmiConsentConfirmed();
        weightInput.required = bmiItem && !missing.value && bmiConsentConfirmed();
        updateCriteriaPreview();
      };
      const updateMeasurementItem = () => {
        const item = measurementItems.find(entry => entry.id === $('measurementItem').value) || measurementItems[0];
        if (!item) return;
        const bmiItem = item.id === 'body-mass-index';
        if (bmiItem !== wasBmiItem) { studentConsent.checked = false; guardianConsent.checked = false; wasBmiItem = bmiItem; }
        valueInput.closest('label').hidden = bmiItem;
        valueInput.disabled = bmiItem || Boolean(missing.value);
        valueInput.required = !bmiItem && !missing.value;
        heightInput.closest('label').hidden = !bmiItem;
        weightInput.closest('label').hidden = !bmiItem;
        bmiConsentPanel.hidden = !bmiItem;
        updateBmiConsent();
        valueInput.min = String(item.min); valueInput.max = String(item.max); valueInput.step = String(item.precision ? 10 ** -item.precision : 1);
        const precisionText = item.precision === 0 ? '정수' : `소수 ${item.precision}자리까지`;
        const protocol = M.measurementProtocol(item.id, criteriaGrade.value, criteriaTarget.value);
        let protocolText = '';
        if (item.distanceMeters) protocolText = protocol ? ` · 규정 거리 ${protocol.distanceMeters}m · 분:초 기록을 총 초로 입력 (예: 8:00은 480초)` : ' · 초5·초6은 1,000m, 중·고등학교는 평가표 구분에 맞는 거리 선택 필요';
        if (item.id === 'step-test-pei') protocolText = protocol ? ` · 규정 프로토콜: 발판 ${protocol.stepBoxHeightCm}cm, ${protocol.cadencePerMinute}회/분, ${protocol.durationMinutes}분 실시 · PEI는 0.1점 기록(0.01점 올림) · 산출된 점수만 입력 (심박수 미수집·미계산)` : ' · 초5~고3 대상 · 학년과 평가표 구분에 맞는 프로토콜 확인 필요';
        if (item.id === 'push-ups') protocolText = protocol ? ` · 중·고 남자 기준: 높이 ${protocol.barHeightCm}cm·폭 ${protocol.barWidthMinCm}cm 이상 봉, 몸을 곧게 유지, 가슴-봉 ${protocol.chestClearanceMaxCm}cm 이내·팔꿈치 ${protocol.elbowAngleDegrees}° · 더 반복할 수 없을 때까지` : ' · 중·고 남자 기준 종목 · 학년과 평가표 구분을 확인해 주세요';
        if (item.id === 'knee-push-ups') protocolText = protocol ? ` · 중·고 여자 기준: 무릎대고 몸을 곧게 유지, 손을 어깨너비에서 한 뼘 앞으로 옮긴 뒤 양옆으로 두 뼘 넓힘, 가슴-바닥 ${protocol.chestClearanceMaxCm}cm 이내·팔꿈치 ${protocol.elbowAngleDegrees}° · 더 반복할 수 없을 때까지` : ' · 중·고 여자 기준 종목 · 학년과 평가표 구분을 확인해 주세요';
        if (item.id === 'comprehensive-flexibility') protocolText = protocol ? ` · 어깨·몸통·옆구리·하체 4영역 좌우 1회씩 · 양쪽 성공 2점, 한쪽 1점, 모두 실패 0점 · 합계 0~${protocol.maxScore}점` : ' · 중·고 기준 종목 · 학년과 평가표 구분을 확인해 주세요';
        if (bmiItem) protocolText = ' · 키·몸무게로 자동 계산 · BMI는 0.1kg/m² 단위(0.01에서 올림) · 별표 4의 학년·평가표 구분별 참고 분류이며 의학적 진단이 아닙니다';
        unit.textContent = bmiItem ? `kg/m² · 키 50~250cm, 몸무게 5~300kg (각 소수 첫째 자리)${protocolText}` : `${item.unit} · 입력 범위 ${item.min}~${item.max}, ${precisionText}${protocolText}`;
        updateCriteriaPreview();
      };
      const updateCriteriaPreview = () => {
        const itemId = $('measurementItem').value, item = measurementItems.find(entry => entry.id === itemId);
        const gradeGroupId = criteriaGrade.value, targetGroupId = criteriaTarget.value;
        if (item?.requiresAssessmentScope) {
          if (!gradeGroupId || !targetGroupId) { criteriaPreview.textContent = '이 종목은 측정 학년과 평가표 구분을 먼저 선택해야 거리·실시 가능 여부를 확인할 수 있습니다.'; return; }
          if (!M.isMeasurementScopeApplicable(itemId, gradeGroupId, targetGroupId)) { criteriaPreview.textContent = '선택한 학년·평가표 구분에서는 이 종목을 실시하지 않습니다. 규정에 맞는 종목과 범위를 선택해 주세요.'; return; }
        }
        if (missing.value) { criteriaPreview.textContent = '측정값이 없어 등급은 조회하지 않습니다.'; return; }
        if (itemId === 'body-mass-index') {
          if (!gradeGroupId || !targetGroupId) { criteriaPreview.textContent = 'BMI 분류를 보려면 학년과 평가표 구분을 직접 선택해 주세요.'; return; }
          if (!bmiConsentConfirmed()) { criteriaPreview.textContent = '학생 본인과 보호자의 동의를 각각 확인하면 BMI를 계산하고 분류를 표시합니다.'; return; }
          const resolved = BMI.resolveDefault({ schoolYear: Number(yearInput.value), gradeGroupId, targetGroupId, targetGroupConfirmed: true });
          if (resolved.status !== 'available') { criteriaPreview.textContent = '등록된 공식 BMI 분류 기준은 2026학년도입니다. 키와 몸무게 원자료는 기준표 없이 계산·저장할 수 있습니다.'; return; }
          if (!Number.isFinite(heightInput.valueAsNumber) || !Number.isFinite(weightInput.valueAsNumber)) { criteriaPreview.textContent = '키와 몸무게를 입력하면 규정에 따라 BMI를 계산해 별표 4 기준 구간을 표시합니다.'; return; }
          try {
            const bmi = M.calculateBmi(heightInput.valueAsNumber, weightInput.valueAsNumber);
            const result = BMI.classify(resolved, bmi);
            criteriaPreview.textContent = result.status === 'available'
              ? `${PAPS_GRADE_LABELS.get(gradeGroupId)} · ${PAPS_TARGET_LABELS.get(targetGroupId)} · BMI ${result.value.toFixed(1)} kg/m² · 별표 4 BMI 구간: ${result.categoryLabel} (${result.band.max === null ? `${result.band.min.toFixed(1)} 이상` : `${result.band.min.toFixed(1)}~${result.band.max.toFixed(1)}`}) · 의학적 진단 아님`
              : '키·몸무게 범위와 소수 첫째 자리 정밀도를 확인해 주세요.';
          } catch (error) { criteriaPreview.textContent = error.message; }
          return;
        }
        if (!gradeGroupId && !targetGroupId) { criteriaPreview.textContent = '학년과 평가표 구분을 직접 선택하면 별표 4의 개별 종목 등급을 미리 봅니다.'; return; }
        if (!gradeGroupId || !targetGroupId) { criteriaPreview.textContent = '개별 등급을 보려면 학년과 평가표 구분을 모두 선택해 주세요.'; return; }
        const schoolYear = Number(yearInput.value), resolved = P.resolveDefault({
          itemId, schoolYear, gradeGroupId, unit: item?.unit, targetGroupId, targetGroupConfirmed: true,
        });
        if (resolved.status !== 'available') {
          criteriaPreview.textContent = schoolYear === 2026
            ? '선택한 범위의 공식 기준을 찾지 못했습니다. 측정값은 원자료로 저장할 수 있습니다.'
            : '등록된 공식 기준은 2026학년도입니다. 측정값은 원자료로 저장할 수 있습니다.';
          return;
        }
        if (!Number.isFinite(valueInput.valueAsNumber)) { criteriaPreview.textContent = '측정값을 입력하면 개별 종목 등급을 표시합니다.'; return; }
        const result = P.scoreItem(resolved, valueInput.valueAsNumber);
        if (result.status !== 'available') {
          criteriaPreview.textContent = result.reason === 'unsupported-measurement-precision'
            ? `측정값은 소수 ${item.precision}자리까지 입력해 주세요.`
            : '측정값의 범위와 정밀도를 확인해 주세요.';
          return;
        }
        const clampedText = result.clamped ? ' · 표의 끝 범위를 벗어나 끝 등급 적용' : '';
        criteriaPreview.textContent = `${PAPS_GRADE_LABELS.get(gradeGroupId)} · ${PAPS_TARGET_LABELS.get(targetGroupId)} · 별표 4 개별 종목 ${result.grade}등급 (${result.band.min}~${result.band.max} ${result.unit}) · 항목 점수 ${result.score}/20점${clampedText}`;
      };
      const updateMissingControl = () => { const isMissing = Boolean(missing.value); const bmiItem = $('measurementItem').value === 'body-mass-index'; valueInput.disabled = isMissing || bmiItem; valueInput.required = !isMissing && !bmiItem; heightInput.disabled = isMissing || !bmiItem || !bmiConsentConfirmed(); weightInput.disabled = isMissing || !bmiItem || !bmiConsentConfirmed(); heightInput.required = !isMissing && bmiItem && bmiConsentConfirmed(); weightInput.required = !isMissing && bmiItem && bmiConsentConfirmed(); missingNote.disabled = !isMissing; missingNote.required = missing.value === 'other'; if (isMissing) { valueInput.value = ''; heightInput.value = ''; weightInput.value = ''; } else missingNote.value = ''; updateCriteriaPreview(); };
      $('measurementItem').addEventListener('change', updateMeasurementItem);
      missing.addEventListener('change', updateMissingControl);
      valueInput.addEventListener('input', updateCriteriaPreview);
      heightInput.addEventListener('input', updateCriteriaPreview);
      weightInput.addEventListener('input', updateCriteriaPreview);
      yearInput.addEventListener('input', updateCriteriaPreview);
      criteriaGrade.addEventListener('change', updateMeasurementItem);
      criteriaTarget.addEventListener('change', updateMeasurementItem);
      studentConsent.addEventListener('change', updateBmiConsent);
      guardianConsent.addEventListener('change', updateBmiConsent);
      dateInput.addEventListener('change', updateCriteriaPreview);
      updateMeasurementItem(); updateMissingControl();
      button(measurementPanel, editingRecord ? '수정 이력과 함께 저장' : '측정 기록 저장', 'saveMeasurementButton', async () => {
        const studentId = $('measurementStudent').value;
        const nextStudent = students[(students.findIndex(student => student.id === studentId) + 1) % Math.max(students.length, 1)];
        const bmiItem = $('measurementItem').value === 'body-mass-index';
        if (bmiItem && !bmiConsentConfirmed()) throw new Error('BMI 기록은 학생 본인과 보호자의 동의를 모두 확인한 뒤 저장해 주세요.');
        const value = missing.value ? null : bmiItem ? M.calculateBmi(heightInput.valueAsNumber, weightInput.valueAsNumber) : $('measurementValue').valueAsNumber;
        const gradeGroupId = criteriaGrade.value || null, targetGroupId = criteriaTarget.value || null;
        if (value !== null && Boolean(gradeGroupId) !== Boolean(targetGroupId)) throw new Error('개별 등급을 기록하려면 학년과 평가표 구분을 모두 선택해 주세요.');
        const payload = {
          classId, studentId, schoolYear: Number($('measurementSchoolYear').value), measuredOn: $('measurementDate').value,
          itemId: $('measurementItem').value, unit: measurementItems.find(item => item.id === $('measurementItem').value)?.unit,
          value,
          assessmentGradeGroupId: gradeGroupId, assessmentTargetGroupId: targetGroupId,
          distanceMeters: measurementItems.find(item => item.id === $('measurementItem').value)?.distanceMeters || null,
          heightCm: bmiItem && !missing.value ? heightInput.valueAsNumber : null,
          weightKg: bmiItem && !missing.value ? weightInput.valueAsNumber : null,
          studentConsentConfirmed: bmiItem && bmiConsentConfirmed(),
          guardianConsentConfirmed: bmiItem && bmiConsentConfirmed(),
          missingReason: missing.value || null, missingNote: $('measurementMissingNote').value,
        };
        if (value !== null && gradeGroupId && targetGroupId) {
          if (bmiItem) {
            const resolved = BMI.resolveDefault({ schoolYear: payload.schoolYear, gradeGroupId, targetGroupId, targetGroupConfirmed: true });
            const category = BMI.classify(resolved, value);
            if (category.status === 'available') Object.assign(payload, { criteriaGradeGroupId: gradeGroupId, criteriaTargetGroupId: targetGroupId, criteriaSourceVersion: resolved.criteriaVersion });
          } else {
            const resolved = P.resolveDefault({ itemId: payload.itemId, schoolYear: payload.schoolYear, gradeGroupId, unit: payload.unit, targetGroupId, targetGroupConfirmed: true });
            const gradeResult = P.classify(resolved, value);
            if (gradeResult.status === 'available') Object.assign(payload, { criteriaGradeGroupId: gradeGroupId, criteriaTargetGroupId: targetGroupId, criteriaSourceVersion: resolved.criteria.criteriaVersion });
          }
        }
        if (editingRecord) {
          await this.write(s => M.updateMeasurement(s, editingRecord.id, payload));
          this.measurementEditId = null;
          this.measurementDraft = { classId, studentId, schoolYear: payload.schoolYear, measuredOn: payload.measuredOn, itemId: payload.itemId };
        } else {
          await this.write(s => M.add(s, 'measurements', payload));
          this.measurementDraft = { classId, studentId: nextStudent?.id || studentId, schoolYear: payload.schoolYear, measuredOn: payload.measuredOn, itemId: payload.itemId };
        }
        await this.renderTeacher();
        const criteriaSkipped = value !== null && (gradeGroupId || targetGroupId) && !payload.criteriaSourceVersion;
        this.notice(criteriaSkipped
          ? '측정값은 저장했지만 선택한 학년도·범위의 기준표가 없어 등급 기준은 기록하지 않았어요.'
          : editingRecord ? '측정값과 선택한 기준을 수정하고 이전·새 값과 변경 시각을 이력에 남겼어요.' : '측정값을 저장했어요. 다음 학생을 선택했습니다.');
      });
      if (editingRecord) button(measurementPanel, '수정 취소', 'cancelMeasurementEdit', async () => { this.measurementEditId = null; await this.renderTeacher(); });
      const selectedMeasurementStudent = $('measurementStudent').value;
      const measurementRows = (state.measurements || []).filter(record => record.classId === classId && record.studentId === selectedMeasurementStudent).sort((a, b) => b.measuredOn.localeCompare(a.measuredOn) || b.inputAt - a.inputAt);
      measurementPanel.append(el('h4', '선택 학생의 기록'));
      if (!selectedMeasurementStudent) measurementPanel.append(el('p', '기록하려면 먼저 학급에 학생을 추가해 주세요.'));
      else if (!measurementRows.length) measurementPanel.append(el('p', '아직 측정 기록이 없습니다.'));
      for (const record of measurementRows) {
        const item = measurementItems.find(entry => entry.id === record.itemId);
        const row = el('article', undefined, { className: 'classroom-item' });
        const result = record.value === null ? `결측 · ${M.MISSING_REASONS.find(reason => reason.id === record.missingReason)?.name || '이유 미상'}` : record.itemId === 'body-mass-index' ? `BMI ${record.value.toFixed(1)} kg/m² · 키 ${record.heightCm}cm · 몸무게 ${record.weightKg}kg` : `${record.value} ${record.unit}`;
        const assessmentScope = record.assessmentGradeGroupId && record.assessmentTargetGroupId
          ? ` · 측정 범위 ${PAPS_GRADE_LABELS.get(record.assessmentGradeGroupId)} ${PAPS_TARGET_LABELS.get(record.assessmentTargetGroupId)}` : '';
        const distance = record.distanceMeters ? ` · ${record.distanceMeters}m` : '';
        let criteriaText = '';
        if (record.value !== null && record.criteriaSourceVersion) {
          if (record.itemId === 'body-mass-index') {
            const resolved = BMI.resolveDefault({ schoolYear: record.schoolYear, gradeGroupId: record.criteriaGradeGroupId, targetGroupId: record.criteriaTargetGroupId, targetGroupConfirmed: true, criteriaVersion: record.criteriaSourceVersion });
            const category = BMI.classify(resolved, record.value);
            criteriaText = category.status === 'available'
              ? ` · 별표 4 BMI 구간 ${category.categoryLabel} · ${PAPS_GRADE_LABELS.get(record.criteriaGradeGroupId)} ${PAPS_TARGET_LABELS.get(record.criteriaTargetGroupId)} 기준 · ${record.criteriaSourceVersion}`
              : ` · 저장된 별표 4 BMI 기준을 현재 확인할 수 없음 (${record.criteriaSourceVersion})`;
          } else {
            const resolved = P.resolveDefault({ itemId: record.itemId, schoolYear: record.schoolYear, gradeGroupId: record.criteriaGradeGroupId, unit: record.unit, targetGroupId: record.criteriaTargetGroupId, targetGroupConfirmed: true, criteriaVersion: record.criteriaSourceVersion });
            const gradeResult = P.scoreItem(resolved, record.value);
            criteriaText = gradeResult.status === 'available'
              ? ` · 별표 4 개별 종목 ${gradeResult.grade}등급 · 항목 점수 ${gradeResult.score}/20점 · ${gradeResult.scoreMethodVersion}${gradeResult.clamped ? ' (표의 끝 범위 적용)' : ''} · ${PAPS_GRADE_LABELS.get(record.criteriaGradeGroupId)} ${PAPS_TARGET_LABELS.get(record.criteriaTargetGroupId)} 기준 · ${record.criteriaSourceVersion}`
              : ` · 저장된 별표 4 기준을 현재 확인할 수 없음 (${record.criteriaSourceVersion})`;
          }
        }
        const updatedText = record.modifiedAt ? ` · 수정 ${new Date(record.modifiedAt).toLocaleString()}` : '';
        row.append(el('p', `${record.schoolYear}학년도 · ${record.measuredOn} · ${item?.name || record.itemId}${distance} · ${result}${assessmentScope}${criteriaText} · 입력 ${new Date(record.inputAt).toLocaleString()}${updatedText}`));
        const changes = Array.isArray(record.changeHistory) ? record.changeHistory : [];
        if (changes.length) {
          const details = el('details'); details.append(el('summary', `변경 이력 ${changes.length}회`));
          for (const change of changes) {
            const format = value => {
              const measurement = value.value === null ? `결측 (${M.MISSING_REASONS.find(reason => reason.id === value.missingReason)?.name || '이유 미상'})` : value.itemId === 'body-mass-index' ? `BMI ${value.value.toFixed(1)} kg/m² (키 ${value.heightCm}cm, 몸무게 ${value.weightKg}kg)` : `${value.value} ${value.unit}`;
              if (!value.criteriaSourceVersion) return measurement;
              return `${measurement} · ${PAPS_GRADE_LABELS.get(value.criteriaGradeGroupId)} ${PAPS_TARGET_LABELS.get(value.criteriaTargetGroupId)} 기준 (${value.criteriaSourceVersion})`;
            };
            details.append(el('p', `${new Date(change.changedAt).toLocaleString()} · ${change.actor === 'teacher' ? '교사' : '확인되지 않은 사용자'}: ${format(change.before)} → ${format(change.after)}`));
          }
          row.append(details);
        }
        measurementPanel.append(row);
        const editButton = button(row, '수정', `editMeasurement-${record.id}`, async () => {
          this.measurementEditId = record.id;
          this.measurementDraft = { classId, studentId: record.studentId, schoolYear: record.schoolYear, measuredOn: record.measuredOn, itemId: record.itemId };
          await this.renderTeacher();
        });
        editButton.disabled = Boolean(editingRecord);
        const deleteButton = button(row, '기록 삭제', `deleteMeasurement-${record.id}`, async () => {
          if (!confirm('이 측정값과 연결된 수정 이력을 이 기기에서 영구 삭제할까요?')) return;
          await this.write(s => M.removeMeasurement(s, record.id, classId));
          if (this.measurementEditId === record.id) this.measurementEditId = null;
          await this.renderTeacher(); this.notice('측정 기록을 삭제했어요.');
        });
        deleteButton.disabled = Boolean(editingRecord);
      }
      measurementPanel.append(el('p', '수정하면 PIN 암호화 기록에 이전 값·새 값·시각·교사 역할을 남깁니다. 학생 ID와 학년도는 수정할 수 없으며 바꿔야 하면 삭제 후 다시 입력하세요. 기록을 삭제하면 연결된 수정 이력도 함께 지웁니다.'));
      $('measurementStudent')?.addEventListener('change', () => {
        if (!editingRecord) { criteriaGrade.value = ''; criteriaTarget.value = ''; }
        this.measurementDraft = { classId, studentId: $('measurementStudent').value, schoolYear: Number($('measurementSchoolYear').value), measuredOn: $('measurementDate').value, itemId: $('measurementItem').value };
        this.renderTeacher();
      });
      const bind = el('div', undefined, { className: 'classroom-grid' }); host.append(el('h3', '이 기기의 학생 · 수업 지정'), bind);
      select(bind, '학생 (ID로 구분)', 'bindStudent', students.map(s => ({ ...s, name: `${s.number || '-'}번 ${s.name} · ${s.id.slice(0, 6)}` })), state.binding?.studentId);
      select(bind, '수업', 'bindLesson', lessons, state.binding?.lessonId); select(bind, '기기', 'bindDevice', devices, state.binding?.deviceId);
      const mode = select(bind, '모드', 'bindMode', [{ id: 'student', name: '개인 연습' }, { id: 'station', name: '모둠 스테이션' }], state.binding?.mode || 'student');
      button(bind, '이 기기에 지정', 'bindStationButton', async () => { await this.write(s => { const student = M.get(s, 'students', $('bindStudent').value, classId); M.get(s, 'lessons', $('bindLesson').value, classId); M.get(s, 'devices', $('bindDevice').value, classId); s.binding = { classId, studentId: student.id, lessonId: $('bindLesson').value, deviceId: $('bindDevice').value, groupId: student.groupId || null, mode: mode.value }; }); await this.renderStudent(); this.notice('학생·수업을 지정했어요. 이후 저장한 클립만 연결됩니다.'); });
      button(bind, '모드 배포', 'deployModeButton', async () => { if (!this.teacherClient) throw new Error('먼저 학급 서버에 교사로 연결해 주세요.'); await this.teacherClient.request('/mode', { deviceId: $('bindDevice').value, lessonId: $('bindLesson').value, mode: mode.value }); this.notice('모드를 배포했어요. 참여 기기에서 동기화하면 반영됩니다.'); });
      host.append(el('h3', '학생 이력 · 교사 관찰 (이 기기)'));
      const history = el('div', undefined, { id: 'classroomHistory' }); host.append(history); const selected = $('bindStudent').value;
      const showHistory = () => { history.replaceChildren(); const sid = $('bindStudent').value; for (const item of state.submissions.filter(x => x.classId === classId && x.studentId === sid && !x.deletedAt)) history.append(el('p', `${lessons.find(l => l.id === item.lessonId)?.name || item.lessonId.slice(0, 6)} · ${item.clipId.slice(0, 6)} · ${item.status} · ${new Date(item.expiresAt).toLocaleDateString()}`)); for (const note of state.notes.filter(x => x.classId === classId && x.studentId === sid)) history.append(el('p', note.text)); }; $('bindStudent').onchange = showHistory; showHistory();
      field(host, '교사 관찰 메모', 'observationText'); button(host, '관찰 저장', 'saveObservationButton', async () => { await this.write(s => M.add(s, 'notes', { classId, studentId: $('bindStudent').value, lessonId: $('bindLesson').value, text: $('observationText').value, expiresAt: Date.now() + M.MAX_RETENTION })); await this.renderTeacher(); });
      host.append(el('h3', '선택 자료 전송 · 학급 서버'), el('p', '직접 선택한 대표 장면과 성찰, 게시판에 올린 피드백을 학급 서버에 보냅니다. 전송 범위는 해당 학급과 수업입니다.'));
      if (productionHub) {
        const registration = field(host, '운영자에게 전달할 학급 ID', 'hubClassId');
        registration.value = classId;
        registration.readOnly = true;
      }
      const hubAddress = field(host, '학급 서버 주소', 'teacherHubUrl');
      hubAddress.value = productionHub || this.teacherHubUrl || (LOOPBACK.has(location.hostname) ? 'http://127.0.0.1:8787' : '');
      hubAddress.readOnly = Boolean(productionHub);
      const hubSecret = field(host, '학급 교사 비밀값 (PIN과 별개)', 'hubSecret', 'password');
      hubSecret.maxLength = 512;
      button(host, '허브 교사 연결', 'connectTeacherHub', async () => {
        const epoch = this.epoch;
        const url = safeHub(hubAddress.value);
        const secret = hubSecret.value;
        hubSecret.value = '';
        const result = await hubLogin(url, '/teacher', { secret, classId });
        const client = new ClassroomSync(url, result.token);
        if (epoch !== this.epoch || !this.access().unlocked || this.classId !== classId) {
          client.logout().catch(() => {});
          return;
        }
        this.teacherClient?.logout().catch(() => {});
        this.teacherClient = client;
        this.teacherHubClassId = classId;
        this.teacherHubUrl = url;
        this.notice('교사 연결됨. 학생 참여 코드를 발행할 수 있어요.');
      });
      button(host, '선택 학생 QR 참여 코드 만들기', 'createJoinButton', async () => { if (!this.teacherClient) throw new Error('허브에 먼저 연결해 주세요.'); const epoch = this.epoch, client = this.teacherClient; const student = M.get(this.state, 'students', $('bindStudent').value, classId); const context = { studentId: student.id, lessonId: $('bindLesson').value, deviceId: $('bindDevice').value, groupId: student.groupId || null, mode: $('bindMode').value }; const result = await client.request('/capabilities', context); if (epoch !== this.epoch || client !== this.teacherClient || classId !== this.classId || !this.access().unlocked) return; const payload = { hubUrl: client.baseUrl, capability: result.capability }; const url = new URL(location.href); url.hash = 'join=' + btoa(JSON.stringify(payload)); const output = $('joinCodeOutput'); output.replaceChildren(); const qr = qrcode(0, 'L'); qr.addData(url.href); qr.make(); const image = el('img', undefined, { alt: '10분 이내 한 번만 사용할 학생 참여 QR', src: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(qr.createSvgTag({ scalable: true })) }); output.append(image); const text = el('textarea', undefined, { id: 'joinPayload', readOnly: true, value: JSON.stringify(payload) }); output.append(text, el('p', '10분 이내 한 번만 사용할 수 있어요.')); });
      host.append(el('div', undefined, { id: 'joinCodeOutput' })); button(host, '허브 제출·게시판 새로 읽기', 'refreshTeacherHub', async () => { if (!this.teacherClient) throw new Error('교사 허브 연결이 필요해요.'); const client = this.teacherClient, epoch = this.epoch; const result = await client.state(); if (epoch === this.epoch && client === this.teacherClient && classId === this.classId) this.renderRemoteTeacher(result.items, $('hubTeacherItems')); }); host.append(el('div', undefined, { id: 'hubTeacherItems' }));
      button(host, '삭제 대기 자료를 허브에서 철회', 'retryClassDeletes', async () => { if (!this.teacherClient) throw new Error('이 학급으로 허브 교사 연결 후 다시 시도해 주세요.'); const client = this.teacherClient; await this.write(async s => { const a = this.access(), epoch = this.epoch; await client.sync({ outbox: s.outbox.filter(op => op.classId === classId && op.kind === 'delete') }, async () => { this.accessCheck(a); if (epoch !== this.epoch) throw new Error('작업이 중단됐어요.'); this.version = await this.store.save(s, a.key, a.revision, this.version); }); const pending = s.outbox.some(op => op.classId === classId && op.kind === 'delete' && !['sent', 'cancelled'].includes(op.status)); if (!pending && s.classes.find(c => c.id === classId)?.pendingDelete) s.classes = s.classes.filter(c => c.id !== classId); }); this.notice('허브 철회를 처리했어요. 실패 항목은 같은 학급에서 다시 연결해 재시도할 수 있어요.'); await this.renderTeacher(); });
      button(host, '이 기기의 학급·명단·수업 삭제', 'deleteClassButton', async () => { if (!confirm('이 기기의 명단·수업·측정값과 수정 이력을 삭제하고 이 기기에서 보낸 제출·글을 철회 대기합니다. 다른 기기의 학급 자료는 삭제하지 않습니다. 원본 클립은 별도로 7일 보관되며 자동 재배정하지 않습니다. 허브 철회는 연결 후 재시도가 필요합니다.')) return; await root.ClassroomToolsUI?.stopWearable(this); await this.write(s => { for (const item of s.submissions.filter(i => i.classId === classId && !i.deletedAt)) M.removeClip(s, item.clipId); for (const feedback of s.feedback.filter(i => i.classId === classId)) M.enqueue(s, classId, 'delete', { id: feedback.id, classId }); for (const type of ['students', 'lessons', 'groups', 'devices', 'notes', 'feedback', 'reflections', 'shotAttempts', 'measurements', 'papsSelections', ...M.TOOL_TYPES]) if (Array.isArray(s[type])) s[type] = s[type].filter(i => i.classId !== classId); const classroom = s.classes.find(i => i.id === classId); classroom.name = '삭제 대기 학급'; classroom.pendingDelete = true; for (const op of s.outbox.filter(i => i.classId === classId && i.kind !== 'delete')) { op.status = 'cancelled'; delete op.payload.clipData; delete op.payload.reflection; delete op.payload.text; } if (s.binding?.classId === classId) delete s.binding; }); this.classId = classId; this.measurementDraft = null; this.measurementEditId = null; await this.renderTeacher(); await this.renderStudent(); this.notice('로컬 명단·수업·측정 기록을 삭제했어요. 삭제 대기 학급으로 허브 교사 연결 후 ‘삭제 대기 자료를 허브에서 철회’를 눌러 완료해 주세요.'); });
      await root.ClassroomToolsUI?.renderTeacher(this, { host, state, classId, students, lessons, groups });
      host.querySelectorAll('.classroom-tool').forEach((item, index) => { item.open = toolOpenStates[index] ?? false; });
    }
    renderRemoteTeacher(items, host) { if (!this.access().unlocked || !host?.isConnected || host !== $('hubTeacherItems')) return; this.revokeUrls(); host.replaceChildren(); for (const item of items) { const row = el('article', undefined, { className: 'classroom-item' }); row.append(el('p', `${item.studentId?.slice(0, 8) || '교사'} · ${item.lessonId.slice(0, 6)} · ${item.kind}`)); if (item.kind === 'submit') { const video = el('video', undefined, { controls: true, className: 'classroom-video' }); video.src = item.clipData; row.append(video, el('p', item.reflection ? `잘된 점: ${item.reflection.good}\n다시 시도: ${item.reflection.retry}` : '성찰 미선택')); } else { row.append(el('p', `${item.text} · ${item.moderation}`)); for (const [action, text] of [['approve', '공개 승인'], ['hide', '숨기기']]) button(row, text, '', async () => { await this.teacherClient.request('/moderate', { id: item.id, action }); const result = await this.teacherClient.state(); this.renderRemoteTeacher(result.items, host); }); } button(row, '허브 자료 삭제', '', async () => { await this.teacherClient.request('/operations', { id: crypto.randomUUID(), kind: 'delete', payload: { id: item.id, classId: this.classId } }); const result = await this.teacherClient.state(); this.renderRemoteTeacher(result.items, host); }); host.append(row); } }
    async renderStudent() {
      root.ClassroomToolsUI?.stopScanner(this);
      const epoch = this.epoch; const b = this.binding(); const host = $('studentClassroomRoot'); host.replaceChildren(); $('studentWorkspace').hidden = !this.access().key; if (!this.access().key) return;
      host.append(el('h3', '대표 장면 · 수업 성찰'), el('p', b ? `${b.student.number || '-'}번 ${b.student.name} · ${b.lesson.name} · ${b.mode === 'station' ? '모둠 스테이션' : '개인 연습'}` : '교사가 학급·학생·수업을 지정하거나 참여 코드를 입력해 주세요.'));
      const joinInput = field(host, '교사가 발급한 1회용 참여 데이터', 'studentJoinPayload');
      joinInput.maxLength = 2048;
      if (this.pendingJoin) { joinInput.value = JSON.stringify(this.pendingJoin); this.pendingJoin = null; }
      button(host, '허브 수업 참여', 'joinStudentHub', async () => { const payload = JSON.parse($('studentJoinPayload').value); $('studentJoinPayload').value = ''; await this.join(payload); });
      root.ClassroomToolsUI?.renderStudent(this, { host, state: this.state, binding: b });
      if (!b) return;
      field(host, '이 기기에서 사용할 내 이름', 'localStudentName').value = b.student.name === '참여 학생' ? '' : b.student.name;
      field(host, '이 기기에서 사용할 내 번호', 'localStudentNumber').value = b.student.number || '';
      button(host, '내 표시 정보 저장 (이 기기만)', 'saveStudentProfile', async () => { const name = $('localStudentName').value.trim(), number = $('localStudentNumber').value.trim(); if (!name || name.length > 24 || !/^\d{1,4}$/.test(number)) throw new Error('이름과 1~4자리 번호를 확인해 주세요.'); await this.write(s => { const student = M.get(s, 'students', b.studentId, b.classId); student.name = name; student.number = number; }); await this.renderStudent(); });
      const items = []; const key = this.access().key; for (const record of await this.repository.all()) { if (expiry(record) <= Date.now()) continue; let meta; try { meta = await this.decryptMetadata(record, key); } catch { continue; } if (meta.classId === b.classId && meta.studentId === b.studentId && meta.lessonId === b.lessonId) items.push({ id: record.id, name: `${new Date(record.createdAt).toLocaleTimeString()} · ${record.durationSeconds}초` }); }
      if (epoch !== this.epoch || key !== this.access().key) return; select(host, '직접 선택할 대표 클립', 'representativeClip', items); const check = el('label', '이 장면의 짧은 성찰도 함께 제출'); const input = el('input', undefined, { type: 'checkbox', id: 'includeReflection', checked: true }); check.prepend(input); host.append(check);
      host.append(el('p', '제출 버튼을 누른 장면과 선택한 성찰만 대기열에 담습니다. 카메라 원본·다른 클립은 전송하지 않습니다. 원본 만료 또는 제출 후 7일 중 빠른 시각에 삭제하며 앱을 열 때 정리합니다.'));
      button(host, '선택 장면 제출', 'submitRepresentative', async () => { await this.submit($('representativeClip').value, $('includeReflection').checked); });
      button(host, '대기열 재전송 · 게시판 새로 읽기', 'syncClassroomButton', async () => this.sync());
      const list = el('div', undefined, { id: 'submissionList' }); host.append(list); for (const item of this.state.submissions.filter(i => i.classId === b.classId && i.studentId === b.studentId && i.lessonId === b.lessonId && !i.deletedAt)) { const row = el('article'); row.append(el('p', `${item.clipId.slice(0, 8)} · ${item.status} · ${new Date(item.expiresAt).toLocaleString()} 만료`)); button(row, '이 제출 철회 (원본 유지)', '', async () => { await this.write(s => { const submission = s.submissions.find(i => i.id === item.id); submission.deletedAt = Date.now(); delete submission.clipData; s.reflections = s.reflections.filter(r => r.id !== submission.reflectionId); for (const op of s.outbox.filter(i => i.kind === 'submit' && i.payload.id === item.id)) { op.status = 'cancelled'; delete op.payload.clipData; delete op.payload.reflection; } M.enqueue(s, b.classId, 'delete', { id: item.id, classId: b.classId }); }); await this.renderStudent(); if (this.studentClient) await this.sync(); }); list.append(row); }
      field(host, '학급 칭찬 · 텍스트 피드백 (교사 승인 뒤 공개)', 'studentFeedback'); button(host, '피드백 보내기', 'sendFeedbackButton', async () => { const text = $('studentFeedback').value; await this.write(s => { const feedback = M.add(s, 'feedback', { classId: b.classId, studentId: b.studentId, lessonId: b.lessonId, text, expiresAt: Date.now() + M.MAX_RETENTION, moderation: 'pending' }); M.enqueue(s, b.classId, 'feedback', { id: feedback.id, classId: b.classId, studentId: b.studentId, lessonId: b.lessonId, text: feedback.text, expiresAt: feedback.expiresAt }); }); await this.renderStudent(); if (this.studentClient) await this.sync(); });
      const board = el('div', undefined, { id: 'classFeedbackBoard' });
      if (this.connection?.classId === b.classId && this.connection.lessonId === b.lessonId && this.connection.studentId === b.studentId) {
        for (const item of this.remote.filter(i => i.kind === 'feedback')) {
          board.append(el('p', `${item.text} · ${item.moderation === 'approved' ? '공개됨' : '교사 확인 중'}`));
        }
      }
      host.append(board);
    }
    async join(payload) {
      const epoch = this.epoch;
      const url = safeHub(payload?.hubUrl);
      const access = this.access();
      this.accessCheck(access);
      const context = await hubLogin(url, '/join', { capability: payload.capability });
      const client = new ClassroomSync(url, context.token);
      try {
        this.accessCheck(access);
        if (epoch !== this.epoch) throw new Error('참여 작업이 중단됐어요.');
        await this.write(s => {
          for (const [type, id, name, extra] of [['classes', context.classId, '참여 학급', {}], ['students', context.studentId, '참여 학생', { classId: context.classId }], ['lessons', context.lessonId, '참여 수업', { classId: context.classId, sport: '', unit: '' }], ['devices', context.deviceId, '참여 기기', { classId: context.classId }]]) {
            if (!s[type].some(x => x.id === id)) s[type].push({ id, name, createdAt: Date.now(), ...extra });
          }
          s.binding = { classId: context.classId, studentId: context.studentId, lessonId: context.lessonId, deviceId: context.deviceId, groupId: context.groupId, mode: context.mode };
        });
        this.accessCheck(access);
        if (epoch !== this.epoch) throw new Error('참여 작업이 중단됐어요.');
      } catch (error) {
        client.logout().catch(() => {});
        throw error;
      }
      this.studentClient?.logout().catch(() => {});
      this.studentClient = client;
      this.connection = context;
      this.remote = [];
      await this.sync();
    }
    async submit(clipId, includeReflection) {
      const a = this.access(); const b = this.binding(); if (!b || !clipId) throw new Error('이 수업에서 저장한 대표 장면을 직접 선택해 주세요.'); const record = (await this.repository.all()).find(r => r.id === clipId); if (!record || expiry(record) <= Date.now()) throw new Error('장면이 만료되었어요.'); const meta = await this.decryptMetadata(record, a.key); if (meta.classId !== b.classId || meta.studentId !== b.studentId || meta.lessonId !== b.lessonId) throw new Error('이 학생·수업의 클립만 제출할 수 있어요.'); const clipData = await dataURL(await this.decryptClip(record, a.key)); this.accessCheck(a);
      await this.write(s => { let reflection; if (includeReflection) { reflection = M.add(s, 'reflections', { classId: b.classId, studentId: b.studentId, lessonId: b.lessonId, clipId, good: meta.reflectionGood, retry: meta.reflectionRetry, expiresAt: expiry(record) }); reflection.id = meta.reflectionId || reflection.id; } const item = M.add(s, 'submissions', { classId: b.classId, studentId: b.studentId, lessonId: b.lessonId, clipId, reflectionId: reflection?.id, clipExpiresAt: expiry(record), clipData }); M.enqueue(s, b.classId, 'submit', { id: item.id, classId: b.classId, studentId: b.studentId, lessonId: b.lessonId, clipId, clipData, clipExpiresAt: item.clipExpiresAt, expiresAt: item.expiresAt, ...(reflection ? { reflection: { good: reflection.good, retry: reflection.retry } } : {}) }); }); await this.renderStudent(); this.notice(this.studentClient ? '선택 장면 전송을 시작해요.' : '이 기기의 암호화 대기열에 저장했어요. 참여 후 동기화할 수 있어요.'); if (this.studentClient) await this.sync();
    }
    async sync() {
      const client = this.studentClient, context = this.connection;
      if (!client || !context) throw new Error('교사에게 참여 코드를 받아 허브 수업에 참여해 주세요.');
      const access = this.access(), epoch = this.epoch;
      const sameSession = () => client === this.studentClient && epoch === this.epoch;
      const inScope = item => item?.classId === context.classId && item.studentId === context.studentId && item.lessonId === context.lessonId;
      const result = await this.write(async state => {
        if (!sameSession()) throw new Error('연결이 종료됐어요.');
        const now = Date.now();
        const records = new Set((await this.repository.all()).filter(r => expiry(r) > now).map(r => r.id));
        for (const item of state.submissions.filter(i => !i.deletedAt && !records.has(i.clipId))) M.removeClip(state, item.clipId);
        M.expire(state);
        const outbox = state.outbox.filter(op => op.classId === context.classId && (
          op.kind === 'delete'
            ? state.submissions.some(item => item.id === op.payload.id && inScope(item))
            : inScope(op.payload)
        ));
        await client.sync({ submissions: state.submissions, outbox }, async () => {
          this.accessCheck(access);
          if (!sameSession()) throw new Error('연결이 종료됐어요.');
          this.version = await this.store.save(state, access.key, access.revision, this.version);
        });
        // A successful, complete state response is authoritative for previously sent submissions.
        const snapshot = await client.state();
        if (!Array.isArray(snapshot.items) || !Array.isArray(snapshot.modes)) throw new Error('학급 서버 자료를 확인하지 못했어요.');
        if (!sameSession()) throw new Error('연결이 종료됐어요.');
        const visible = new Set(snapshot.items.filter(item => item.kind === 'submit').map(item => item.id));
        for (const item of state.submissions.filter(inScope)) {
          if (item.status === 'sent' && !item.deletedAt && !visible.has(item.id)) item.deletedAt = Date.now();
        }
        const mode = snapshot.modes.find(item => item.deviceId === context.deviceId && item.lessonId === context.lessonId);
        if (mode && inScope(state.binding) && state.binding.deviceId === context.deviceId) state.binding.mode = mode.mode;
        return { items: snapshot.items, failures: outbox.filter(op => op.status === 'failed') };
      });
      if (!sameSession()) return;
      this.remote = result.items;
      await this.renderStudent();
      if (sameSession()) this.notice(result.failures.length
        ? `전송 실패 ${result.failures.length}건. ${result.failures[0].error}`
        : '동기화했어요.');
    }
  }
  root.ClassroomUI = ClassroomUI;
})(globalThis);
