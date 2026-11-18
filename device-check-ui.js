(function (root) {
  'use strict';
  const D = root.DeviceCheck;
  const $ = id => document.getElementById(id);
  const duration = ms => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
  class DeviceCheckUI {
    constructor({ access, openTeacher, startCamera, stopCamera, capture }) {
      Object.assign(this, { access, openTeacher, startCamera, stopCamera, capture });
      this.error = ''; this.starting = false; this.lastSaved = 0;
      this.session = new D.Session(this.read());
      this.renderChecks();
      $('deviceCheckModel').value = this.session.state.model;
      $('deviceCheckOpen').addEventListener('click', () => openTeacher());
      $('deviceCheckStart').addEventListener('click', () => this.start());
      $('deviceCheckStop').addEventListener('click', () => { if (!access()) return; this.interrupt('교사가 점검을 중단했어요. 새 점검은 0분부터 시작해요.'); stopCamera(); });
      $('deviceCheckHeatRecord').addEventListener('click', () => this.guarded(() => {
        const heat = $('deviceCheckHeat').value;
        this.session.recordHeat(heat, Date.now());
        if (heat === 'hot') stopCamera();
      }));
      $('deviceCheckSave').addEventListener('click', () => this.guarded(() => this.session.review(Date.now())));
      $('deviceCheckLater').addEventListener('click', () => this.guarded(() => this.session.defer()));
      window.addEventListener('storage', event => {
        if (event.key !== D.STORAGE_KEY && event.key !== null) return;
        // A second window must not continue counting an obsolete run.
        this.session = new D.Session(this.read());
        this.error = '다른 창에서 점검 기록이 바뀌었어요. 점검은 앱 창 하나에서 진행해 주세요.';
        this.renderChecks(); $('deviceCheckModel').value = this.session.state.model; this.render();
      });
      this.timer = setInterval(() => this.tick(), 1000);
      this.render();
    }
    read() {
      try { const raw = localStorage.getItem(D.STORAGE_KEY); return raw ? JSON.parse(raw) : null; }
      catch { this.error = '저장된 점검 결과를 읽지 못했어요. 저장 공간을 확인한 뒤 다시 점검해 주세요.'; return null; }
    }
    persist() {
      try { localStorage.setItem(D.STORAGE_KEY, JSON.stringify(this.session.snapshot())); this.lastSaved = performance.now(); return true; }
      catch { this.error = '점검 결과를 기기에 저장하지 못했어요. 이번 화면의 결과는 앱을 닫으면 사라질 수 있어요.'; return false; }
    }
    guarded(action) {
      if (!this.access() || this.starting) return;
      this.error = '';
      try { action(); this.persist(); } catch (error) { this.error = error.message; }
      this.render();
    }
    async start() {
      if (!this.access() || this.starting || this.session.state.status === 'running') return;
      const model = $('deviceCheckModel').value.trim(), heat = $('deviceCheckHeat').value;
      this.error = '';
      if (!$('deviceCheckTestOnly').checked) { this.error = '학생 대신 교사 시연이나 테스트 자료로 점검한다는 항목을 확인해 주세요.'; this.render(); return; }
      // Validate before closing the PIN-protected screen or requesting the camera.
      try { new D.Session().start({ model, heat }, performance.now(), Date.now()); }
      catch (error) { this.error = error.message; this.render(); return; }
      const session = this.session;
      this.starting = true; this.render();
      try {
        await this.startCamera();
        const deadline = performance.now() + 2500;
        while (true) {
          const { active, frameAt } = this.capture();
          const now = performance.now();
          if (session !== this.session) {
            if (active) this.stopCamera();
            return;
          }
          if (!active || document.hidden) throw new Error('카메라가 시작되지 않았어요. 권한과 연결을 확인하고 다시 점검해 주세요.');
          if (Number.isFinite(frameAt) && frameAt <= now && now - frameAt <= 2500) break;
          if (now >= deadline) {
            this.stopCamera();
            throw new Error('첫 카메라 프레임이 들어오지 않았어요. 카메라 연결을 확인하고 다시 점검해 주세요.');
          }
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        session.start({ model, heat, userAgent: navigator.userAgent }, performance.now(), Date.now());
        this.renderChecks(); this.persist();
      } catch (error) { this.error = error.message; }
      finally { this.starting = false; this.render(); }
    }
    interrupt(reason) {
      if (this.session.state.status !== 'running') return;
      this.session.interrupt(reason); this.persist(); this.render();
    }
    tick() {
      if (this.session.state.status !== 'running') return;
      const before = this.session.state.status, now = performance.now();
      this.session.observe({ ...this.capture(), now, wallTime: Date.now(), visible: !document.hidden });
      if (before !== this.session.state.status || now - this.lastSaved >= 10000) this.persist();
      this.render();
    }
    renderChecks() {
      $('deviceCheckChecklist').replaceChildren();
      for (const [id, text] of Object.entries(D.CHECKS)) {
        const label = document.createElement('label'); label.textContent = text;
        const select = document.createElement('select'); select.id = `deviceCheck-${id}`;
        for (const [value, title] of [['pending', '아직 확인 안 함'], ['pass', '직접 확인함'], ['fail', '문제 있음']]) {
          const option = document.createElement('option'); option.value = value; option.textContent = title; select.append(option);
        }
        select.value = this.session.state.checks[id];
        select.addEventListener('change', () => { this.guarded(() => this.session.setCheck(id, select.value)); select.value = this.session.state.checks[id]; });
        label.append(select); $('deviceCheckChecklist').append(label);
      }
    }
    render() {
      const s = this.session.state, running = s.status === 'running', authorized = this.access();
      $('deviceCheckNotice').hidden = s.status === 'passed' && !this.error;
      $('deviceCheckNotice').dataset.state = s.status;
      const progress = `${duration(s.elapsedMs)} / 40:00`;
      $('deviceCheckSummary').textContent = this.starting ? '기기 점검용 카메라를 시작하고 있어요.' : running ? `${D.STATUSES[s.status]} · ${progress}. 약 10분마다 발열을 확인해 주세요.` : s.status === 'pending' ? '수업에 필요한 기능을 설정하고 이 기기와 학교 환경을 점검할 수 있어요. 나중에 진행할 수도 있어요.' : `${D.STATUSES[s.status]}. 교사 메뉴에서 결과를 확인하거나 다시 점검할 수 있어요.`;
      $('deviceCheckOpen').disabled = this.starting;
      $('deviceCheckProgress').value = s.elapsedMs;
      $('deviceCheckElapsed').textContent = progress;
      $('deviceCheckStatus').textContent = `${D.STATUSES[s.status]}${s.reason ? ' · ' + s.reason : ''}`;
      $('deviceCheckError').textContent = this.error;
      $('deviceCheckStart').disabled = !authorized || running || this.starting;
      $('deviceCheckStart').textContent = s.startedAt ? '새 40분 점검 시작 (이전 결과 교체)' : '40분 점검 시작';
      $('deviceCheckStop').disabled = !authorized || !running;
      $('deviceCheckSave').disabled = !authorized || running || this.starting;
      $('deviceCheckLater').disabled = !authorized || running || this.starting;
      $('deviceCheckHeatRecord').disabled = !authorized || !s.startedAt || !['running', 'ready', 'incomplete', 'passed'].includes(s.status);
      $('deviceCheckModel').disabled = running || this.starting;
      $('deviceCheckTestOnly').disabled = running || this.starting;
      $('deviceCheckMetrics').textContent = s.startedAt ? `${s.model} · ${new Date(s.startedAt).toLocaleString('ko-KR')} 시작 · 최대 버퍼 ${(s.peakBytes / 1048576).toFixed(1)}MiB / ${s.peakFrames}프레임 / ${(s.maxBufferMs / 1000).toFixed(1)}초. 버퍼 수치는 기기 전체 메모리나 온도가 아니에요.` : '점검 결과는 이 브라우저에만 저장돼요. 학생 이름·학교명·영상은 점검 기록에 포함하지 않아요.';
      $('deviceCheckHeatHistory').replaceChildren();
      for (const row of s.thermal) {
        const item = document.createElement('li'); item.textContent = `${duration(row.elapsedMs)} · ${D.HEAT[row.value]}`; $('deviceCheckHeatHistory').append(item);
      }
    }
  }
  root.DeviceCheckUI = DeviceCheckUI;
})(globalThis);
