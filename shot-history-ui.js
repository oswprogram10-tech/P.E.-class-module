/* Teacher-controlled local history; it never sends records to the hub. */
(function (root) {
  'use strict';
  const $ = id => document.getElementById(id);
  const fields = ['classId', 'studentId', 'lessonId', 'deviceId'];
  const expires = record => Math.min(record?.expiresAt ?? Infinity, Number.isFinite(record?.createdAt) ? record.createdAt + ClassroomModel.MAX_RETENTION : 0);
  const text = (tag, value) => { const node = document.createElement(tag); node.textContent = value; return node; };
  class ShotHistoryUI {
    constructor({ classroom, repository, access, context, active, decryptMetadata }) {
      Object.assign(this, { classroom, repository, access, context, active, decryptMetadata });
      this.enabled = false; this.epoch = 0; this.view = 0; this.controller = new AbortController();
      this.armedContext = ''; this.busy = false; this.selected = null; this.clips = new Map();
      $('teacherShotHistoryEnabled').onchange = () => this.setEnabled($('teacherShotHistoryEnabled').checked);
      $('shotHistoryRefresh').onclick = () => this.refresh();
      $('shotHistoryClass').onchange = () => { this.filters(true); this.render(); };
      $('shotHistoryStudent').onchange = $('shotHistoryLesson').onchange = () => this.render();
      $('shotHistoryLinkClip').onclick = () => this.linkSelectedClip();
    }
    message(value) { $('shotHistoryStatus').textContent = value; }
    teacher(value) { $('teacherShotHistoryStatus').textContent = value; }
    visible() { const a = this.access(); return Boolean(a.unlocked && a.key && $('teacherDialog').open && !document.hidden); }
    currentBinding() {
      const binding = this.classroom.binding(), state = this.classroom.state, now = Date.now();
      if (!binding) return null;
      const parents = [state.classes.find(x => x.id === binding.classId), ...['students', 'lessons', 'devices'].map((type, i) => state[type].find(x => x.id === binding[fields[i + 1]] && x.classId === binding.classId))];
      return parents.every(x => x && !x.pendingDelete && !x.deletedAt && expires(x) > now) ? binding : null;
    }
    pause() { this.epoch++; this.controller.abort(); this.controller = new AbortController(); }
    stop(message = '동작 기록을 껐어요. 새로 사용하려면 교사 설정에서 켜 주세요.') {
      this.pause(); this.enabled = false; this.armedContext = ''; $('teacherShotHistoryEnabled').checked = false; this.message(message);
    }
    observeReset() {
      if (this.enabled && this.context() !== this.armedContext) this.stop('학생·수업 연결이 바뀌어 기록을 껐어요. 교사가 연결을 확인하고 다시 켜 주세요.');
      else this.pause();
    }
    setEnabled(enabled) {
      if (!enabled) { this.stop(); return true; }
      if (!this.visible() || !this.currentBinding()) {
        this.stop('교사 PIN을 열고 학급·학생·수업·기기를 먼저 지정해 주세요.'); return false;
      }
      this.pause(); this.enabled = true; this.armedContext = this.context();
      $('teacherShotHistoryEnabled').checked = true;
      this.message('로컬 동작 기록을 켰어요. 감지된 최소 각도 요약만 PIN 암호화로 최대 7일 보관해요.'); return true;
    }
    async record(snapshot) {
      if (!snapshot?.event || !this.enabled || snapshot.type === 'volleyball-overhead-cue' || snapshot.ruleVersion === 'volleyball-overhead-cue-v1') return false;
      if (!this.active() || !snapshot.evidence) { this.message('유효한 동작 근거가 없어 이번 기록은 저장하지 않았어요.'); return false; }
      if (!Number.isFinite(snapshot.timestamp) || performance.now() - snapshot.timestamp > 1000 || snapshot.timestamp > performance.now() + 100 || Math.abs(snapshot.evidence.inputAt - performance.timeOrigin - snapshot.timestamp) > 2 || snapshot.angle !== snapshot.evidence.elbowAngle || snapshot.side !== snapshot.evidence.side) {
        this.message('프레임 시각이나 동작 근거가 일치하지 않아 기록하지 않았어요.'); return false;
      }
      if (!this.currentBinding() || this.context() !== this.armedContext || snapshot.evidence.contextKey !== this.armedContext) {
        this.stop('학생·수업 연결이 달라 이번 기록을 저장하지 않았어요. 연결을 확인하고 다시 켜 주세요.'); return false;
      }
      if (this.busy) { this.message('이전 기록을 처리 중이라 이번 기록은 생략했어요. 기본 촬영은 계속돼요.'); return false; }
      const evidence = structuredClone(snapshot.evidence), a = this.access(), epoch = this.epoch, controller = this.controller;
      const valid = () => this.enabled && epoch === this.epoch && !controller.signal.aborted && this.access().key === a.key && this.access().revision === a.revision && this.context() === evidence.contextKey && this.armedContext === evidence.contextKey && Boolean(this.currentBinding()) && !document.hidden;
      this.busy = true;
      try {
        await this.classroom.write(state => { if (!valid()) throw new Error('기록할 상태가 바뀌었어요.'); ClassroomModel.expire(state); return ShotHistory.add(state, evidence); }, { signal: controller.signal, validate: valid });
        if (valid()) this.message('동작 요약 1건을 이 기기에 암호화해 기록했어요. 슛 성공·성적을 뜻하지 않아요.');
        return true;
      } catch (error) {
        if (epoch === this.epoch) this.message(`동작 기록을 저장하지 못했어요. ${error.message || '저장 공간과 연결을 확인해 주세요.'} 기본 촬영은 계속돼요.`);
        return false;
      } finally { this.busy = false; }
    }
    options(id, items, selected) {
      const node = $(id); node.replaceChildren(new Option('선택해 주세요', ''));
      for (const item of items) node.add(new Option(`${item.name || item.id.slice(0, 8)} · ${item.id.slice(0, 6)}`, item.id));
      node.value = items.some(x => x.id === selected) ? selected : items[0]?.id || '';
    }
    filters(reset = false) {
      const state = this.classroom.state, binding = this.classroom.binding();
      const cid = $('shotHistoryClass').value || binding?.classId;
      this.options('shotHistoryClass', state.classes.filter(x => !x.pendingDelete), cid);
      const classId = $('shotHistoryClass').value;
      this.options('shotHistoryStudent', state.students.filter(x => x.classId === classId), reset ? binding?.studentId : $('shotHistoryStudent').value || binding?.studentId);
      this.options('shotHistoryLesson', state.lessons.filter(x => x.classId === classId), reset ? binding?.lessonId : $('shotHistoryLesson').value || binding?.lessonId);
    }
    scope() { return { classId: $('shotHistoryClass').value, studentId: $('shotHistoryStudent').value, lessonId: $('shotHistoryLesson').value }; }
    async open() { if (this.visible()) await this.refresh(); }
    close() {
      this.view++; this.selected = null; this.clips.clear();
      for (const id of ['shotHistoryClass', 'shotHistoryStudent', 'shotHistoryLesson', 'shotHistoryClip', 'shotHistoryList']) $(id).replaceChildren();
      $('shotHistorySelected').textContent = ''; this.teacher(''); $('shotHistoryLinkClip').disabled = true;
    }
    async refresh() {
      if (!this.visible()) return false;
      const view = ++this.view, a = this.access(); this.teacher('로컬 이력을 읽고 있어요…');
      const valid = () => view === this.view && this.visible() && a.key === this.access().key && a.revision === this.access().revision;
      try {
        await this.classroom.write(async state => {
          const ids = new Set((await this.repository.all()).filter(item => expires(item) > Date.now()).map(item => item.id));
          for (const item of state.shotAttempts || []) if (item.clipId && !ids.has(item.clipId)) ClassroomModel.removeClip(state, item.clipId);
          ClassroomModel.expire(state);
        }, { validate: valid });
        if (!valid()) return false;
        this.filters(); this.render(); return true;
      } catch (error) { if (valid()) this.teacher(`이력을 읽지 못했어요. ${error.message || '다시 시도해 주세요.'}`); return false; }
    }
    render() {
      if (!this.visible()) return;
      this.view++;
      this.selected = null; this.clips.clear(); $('shotHistoryClip').replaceChildren(); $('shotHistorySelected').textContent = ''; $('shotHistoryLinkClip').disabled = true;
      const host = $('shotHistoryList'); host.replaceChildren();
      let records; try { records = ShotHistory.list(this.classroom.state, this.scope()).sort((a, b) => b.inputAt - a.inputAt); } catch { this.teacher('조회할 학급·학생·수업을 선택해 주세요.'); return; }
      for (const record of records.slice(0, 100)) {
        const row = document.createElement('article'); row.dataset.attemptId = record.id; row.className = 'shot-history-row';
        row.append(text('p', `${new Date(record.inputAt).toLocaleString('ko-KR')} · ${record.side === 'left' ? '왼팔' : '오른팔'} · 팔꿈치 ${Math.round(record.elbowAngle)}°${record.clipId ? ' · 클립 연결됨' : ''}`));
        const details = document.createElement('details'); details.append(text('summary', '근거와 한계'));
        details.append(text('p', `2D 동작 신호 · 민감도 ${record.sensitivity} · 전신 최소 visibility ${record.minVisibility.toFixed(2)} (기준 0.60 이상) · presence ${Number.isFinite(record.minPresence) ? record.minPresence.toFixed(2) : '현재 모델에서 미제공'} · 손목/몸통 비율 ${record.wristToEar.toFixed(2)} / ${record.wristToShoulder.toFixed(2)} · 기준 ${record.thresholds.readyAngle}°→${record.thresholds.shootAngle}° · ${record.ruleVersion} · ${record.modelVersion} · 만료 ${new Date(record.expiresAt).toLocaleString('ko-KR')}. 골 성공·기술 정확성·성적 판정이 아니에요.`)); row.append(details);
        const select = text('button', '이 기록 선택'); select.type = 'button'; select.dataset.action = 'select'; select.onclick = () => this.select(record.id);
        const remove = text('button', '기록 삭제'); remove.type = 'button'; remove.dataset.action = 'delete'; remove.onclick = () => this.remove(record.id);
        row.append(select, remove); host.append(row);
      }
      this.teacher(`${records.length}건 중 최근 ${Math.min(100, records.length)}건 표시 · 기기 전체 최대 ${ShotHistory.MAX_ATTEMPTS}건 · 허브 전송 없음`);
    }
    async select(id) {
      if (!this.visible()) return;
      const record = ShotHistory.list(this.classroom.state, this.scope()).find(x => x.id === id); if (!record) return;
      const view = ++this.view, a = this.access(); this.selected = id; this.clips.clear(); $('shotHistoryClip').replaceChildren(new Option('클립을 명시적으로 선택해 주세요', ''));
      $('shotHistorySelected').textContent = `선택한 기록: ${new Date(record.inputAt).toLocaleString('ko-KR')} · ${record.id.slice(0, 8)}`; $('shotHistoryLinkClip').disabled = true;
      try {
        for (const clip of await this.repository.all()) {
          if (view !== this.view || !this.visible() || a.key !== this.access().key) return;
          if (expires(clip) <= Date.now()) continue;
          let meta; try { meta = await this.decryptMetadata(clip, a.key); } catch { continue; }
          if (fields.some(field => meta[field] !== record[field])) continue;
          this.clips.set(clip.id, { id: clip.id, ...Object.fromEntries(fields.map(field => [field, meta[field]])), expiresAt: expires(clip) });
          $('shotHistoryClip').add(new Option(`${new Date(clip.createdAt).toLocaleString('ko-KR')} · ${clip.durationSeconds}초`, clip.id));
        }
        if (view === this.view && this.visible()) $('shotHistoryLinkClip').disabled = this.clips.size === 0;
      } catch { if (view === this.view) this.teacher('연결할 클립을 읽지 못했어요. 다시 선택해 주세요.'); }
    }
    async remove(id) {
      if (!this.visible()) return false;
      const view = this.view, a = this.access();
      const valid = () => view === this.view && this.visible() && a.key === this.access().key && a.revision === this.access().revision;
      try {
        await this.classroom.write(state => { ClassroomModel.expire(state); const record = ShotHistory.list(state, this.scope()).find(x => x.id === id); if (!record) throw new Error('현재 조회 범위의 기록이 아니에요.'); return ShotHistory.remove(state, id); }, { validate: valid });
        if (valid()) this.render(); return true;
      } catch (error) { if (valid()) this.teacher(`삭제하지 못했어요. ${error.message || ''}`); return false; }
    }
    async linkSelectedClip() {
      if (!this.visible()) return false;
      const id = this.selected, clipId = $('shotHistoryClip').value, a = this.access(), view = this.view;
      const valid = () => view === this.view && this.visible() && a.key === this.access().key && a.revision === this.access().revision && this.selected === id;
      if (!id || !clipId || !this.clips.has(clipId)) { this.teacher('기록과 같은 학생·수업·기기의 클립을 직접 선택해 주세요.'); return false; }
      try {
        await this.classroom.write(async state => {
          ClassroomModel.expire(state);
          if (!ShotHistory.list(state, this.scope()).some(x => x.id === id)) throw new Error('현재 조회 범위의 기록이 아니에요.');
          const clip = await this.repository.get(clipId, a.revision); if (!clip) throw new Error('클립이 삭제되었거나 만료됐어요.');
          const meta = await this.decryptMetadata(clip, a.key);
          return ShotHistory.linkClip(state, id, { id: clip.id, ...Object.fromEntries(fields.map(field => [field, meta[field]])), expiresAt: expires(clip) });
        }, { validate: valid, clipId });
        if (valid()) { this.render(); this.teacher('선택한 로컬 클립을 연결했어요. 허브로 전송하지 않아요.'); } return true;
      } catch (error) { if (valid()) this.teacher(`연결하지 못했어요. ${error.message || ''}`); return false; }
    }
  }
  root.ShotHistoryUI = ShotHistoryUI;
})(globalThis);
