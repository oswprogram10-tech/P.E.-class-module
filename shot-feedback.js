/* Optional session-only feedback. Images and event metadata never enter storage. */
(function (root) {
  'use strict';
  const $ = id => document.getElementById(id);
  class ShotFeedback {
    constructor({ currentContext = () => '', active = () => true } = {}) {
      Object.assign(this, { currentContext, active });
      this.options = { visual: false, sound: false, capture: false };
      this.generation = 0; this.lastTimestamp = -Infinity; this.imageUrl = null;
      this.lastCapture = null; this.encoding = false; this.audio = null; this.tone = null;
      this.timer = null; this.disposed = false;
    }
    context() { try { const value = this.currentContext(); return typeof value === 'string' ? value : null; } catch { return null; } }
    available() { try { return !this.disposed && !document.hidden && this.active(); } catch { return false; } }
    status(message) { $('shotFeedbackStatus').textContent = message; }
    setOptions(options) {
      if (!options || ['visual', 'sound', 'capture'].some(key => typeof options[key] !== 'boolean')) throw new TypeError('Invalid feedback options');
      this.clear(); this.options = { visual: options.visual, sound: options.sound, capture: options.capture };
      if (!this.options.sound) this.closeAudio();
      this.status('피드백 설정은 이 실행 중에만 적용해요. 임시 이미지는 저장하거나 전송하지 않아요.');
    }
    async unlockAudio() {
      if (!this.options.sound || this.disposed) return false;
      const generation = this.generation;
      try {
        const Audio = root.AudioContext || root.webkitAudioContext;
        if (!Audio) throw new Error('Audio unavailable');
        const context = this.audio || (this.audio = new Audio());
        if (context.state !== 'running') await context.resume();
        if (generation !== this.generation || this.disposed || !this.options.sound || context !== this.audio) return false;
        if (context.state !== 'running') throw new Error('Audio blocked');
        return true;
      } catch {
        if (generation === this.generation && !this.disposed) this.status('효과음을 사용할 수 없어요. 시각 안내와 기본 촬영은 계속 사용할 수 있어요.');
        return false;
      }
    }
    stopTone() {
      const tone = this.tone; this.tone = null;
      if (tone) { try { tone.oscillator.stop(); } catch {} try { tone.oscillator.disconnect(); tone.gain.disconnect(); } catch {} }
    }
    closeAudio() {
      this.stopTone(); const context = this.audio; this.audio = null;
      try { context?.close()?.catch(() => {}); } catch {}
    }
    playTone() {
      if (!this.options.sound) return;
      try {
        const context = this.audio;
        if (!context || context.state !== 'running') throw new Error('Audio not unlocked');
        const oscillator = context.createOscillator(), gain = context.createGain();
        const start = context.currentTime;
        oscillator.frequency.value = 660; oscillator.type = 'sine';
        gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(.06, start + .01); gain.gain.linearRampToValueAtTime(0, start + .09);
        oscillator.connect(gain); gain.connect(context.destination);
        this.tone = { oscillator, gain };
        oscillator.onended = () => { try { oscillator.disconnect(); gain.disconnect(); } catch {} if (this.tone?.oscillator === oscillator) this.tone = null; };
        oscillator.start(start); oscillator.stop(start + .10);
      } catch {
        this.stopTone(); this.status('효과음을 재생하지 못했어요. 시각 안내와 기본 촬영은 계속 사용할 수 있어요.');
      }
    }
    releaseImage() {
      $('shotCaptureImage').removeAttribute('src'); $('shotCaptureFigure').hidden = true;
      $('shotCaptureCaption').textContent = ''; this.lastCapture = null;
      if (this.imageUrl) URL.revokeObjectURL(this.imageUrl);
      this.imageUrl = null;
    }
    clear() {
      this.generation++; clearTimeout(this.timer); this.timer = null; this.stopTone();
      this.releaseImage(); $('shotFeedbackNotice').hidden = true; $('shotFeedbackTime').textContent = '';
      $('shotFeedbackTime').removeAttribute('data-timestamp');
    }
    inputTime(timestamp) {
      const date = new Date(performance.timeOrigin + timestamp);
      return date.toLocaleTimeString('ko-KR', { hour12: false }) + '.' + String(date.getMilliseconds()).padStart(3, '0');
    }
    consume(snapshot = {}, eventFrame = null) {
      const bitmap = eventFrame?.bitmap;
      let canvas;
      try {
        if (snapshot.reason) { this.clear(); return; }
        if (!snapshot.event) return;
        const timestamp = snapshot.timestamp, context = this.context();
        if (!this.available() || context === null || !Number.isFinite(timestamp) || timestamp <= this.lastTimestamp || performance.now() - timestamp > 1000 || timestamp > performance.now() + 100) return;
        this.clear(); this.lastTimestamp = timestamp;
        const generation = this.generation;
        if (!Object.values(this.options).some(Boolean)) return;
        const metadata = Object.freeze({ timestamp, side: snapshot.side === 'left' ? 'left' : 'right', angle: Number.isFinite(snapshot.angle) ? snapshot.angle : null });
        const text = `추론 입력 시각 ${this.inputTime(timestamp)} · ${metadata.side === 'left' ? '왼팔' : '오른팔'} · 팔꿈치 ${metadata.angle === null ? '—' : Math.round(metadata.angle) + '°'}`;
        $('shotFeedbackTime').textContent = text; $('shotFeedbackTime').dataset.timestamp = String(timestamp);
        if (this.options.visual) { $('shotFeedbackNotice').hidden = false; this.timer = setTimeout(() => { if (generation === this.generation) $('shotFeedbackNotice').hidden = true; }, 900); }
        this.playTone();
        if (!this.options.capture) return;
        if (!bitmap || eventFrame.timestamp !== timestamp || !Number.isFinite(bitmap.width) || !Number.isFinite(bitmap.height) || bitmap.width <= 0 || bitmap.height <= 0) { this.status('이 감지의 입력 이미지를 확보하지 못했어요. 다른 시점의 이미지로 대신하지 않아요.'); return; }
        if (this.encoding) { this.status('이전 이미지 처리를 정리하고 있어 이번 순간 이미지는 생략했어요.'); return; }
        const scale = Math.min(1, 320 / bitmap.width, 640 / bitmap.height);
        canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        canvas.getContext('2d', { alpha: false }).drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const captureCanvas = canvas; this.encoding = true;
        const stillCurrent = () => generation === this.generation && this.options.capture && this.available() && this.context() === context;
        new Promise(resolve => captureCanvas.toBlob(resolve, 'image/jpeg', .9)).then(blob => {
          if (!blob || !stillCurrent()) { if (!blob && stillCurrent()) this.status('순간 이미지를 준비하지 못했어요. 기본 촬영은 계속 사용할 수 있어요.'); return; }
          const url = URL.createObjectURL(blob);
          if (!stillCurrent()) { URL.revokeObjectURL(url); return; }
          this.releaseImage(); this.imageUrl = url; this.lastCapture = metadata;
          $('shotCaptureImage').src = url; $('shotCaptureCaption').textContent = text;
          $('shotCaptureFigure').hidden = false;
        }).catch(() => { if (stillCurrent()) this.status('순간 이미지를 표시하지 못했어요. 기본 촬영은 계속 사용할 수 있어요.'); })
          .finally(() => { captureCanvas.width = captureCanvas.height = 0; this.encoding = false; });
        canvas = null;
      } catch {
        if (canvas) { canvas.width = canvas.height = 0; this.encoding = false; }
        this.status('추가 피드백을 표시하지 못했어요. 기본 촬영은 계속 사용할 수 있어요.');
      } finally { try { bitmap?.close(); } catch {} }
    }
    dispose() { this.clear(); this.disposed = true; this.closeAudio(); }
  }
  root.ShotFeedback = ShotFeedback;
})(globalThis);
