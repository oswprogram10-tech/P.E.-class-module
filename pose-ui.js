/* Optional full-body presence checks. No landmarks, images or scores are stored. */
(function (root) {
  'use strict';
  const $ = id => document.getElementById(id);
  class PoseUI {
    constructor({ video, cameraActive, paused, onShotState = () => {}, onCueState = () => {}, shotContext = () => '', runtimeFactory = () => new PoseRuntime({ minIntervalMs: 300 }) }) {
      Object.assign(this, { video, cameraActive, paused, runtimeFactory, onShotState, onCueState, shotContext });
      this.sport = 'basketball';
      this.cueSettings = { enabled: false, side: 'right' };
      this.cueDetector = null;
      this.lastShotContext = null;
      this.shotSettings = { enabled: false, side: 'right', sensitivity: 'normal' };
      this.shotDetector = null;
      this.captureEnabled = false;
      this.frameRevision = 0;
      this.pendingFrame = null;
      this.captureCopyPending = false;
      this.runtime = null;
      this.generation = 0;
      this.prepared = false;
      this.enabled = false;
      this.running = false;
      this.busy = false;
      this.copying = false;
      this.timer = null;
      this.intervalMs = 333;
      this.stableFrames = 0;
      this.lastResult = null;
      this.lastError = null;
      this.lastSpoken = '';
      this.lastSpokenAt = 0;
      this.metrics = { submitted: 0, skipped: 0, results: 0, copiesMs: [], inferenceMs: [] };
      $('posePrepare').onclick = () => this.prepare();
      $('poseCancel').onclick = () => this.cancelPreparation();
      $('poseClear').onclick = () => this.clear();
      $('poseEnabled').onchange = () => this.setEnabled($('poseEnabled').checked);
      $('poseSpeech').onchange = () => { if (!$('poseSpeech').checked) this.cancelSpeech(); };
      this.updateVoices();
      root.speechSynthesis?.addEventListener('voiceschanged', () => this.updateVoices());
      document.addEventListener('visibilitychange', () => { if (document.hidden) this.suspend('화면을 벗어나 전신 확인을 멈췄어요. 촬영을 다시 시작해 주세요.'); });
      root.addEventListener('pagehide', () => this.dispose());
      const supported = root.isSecureContext && Boolean(root.Worker && root.WebAssembly && root.OffscreenCanvas && root.createImageBitmap && root.caches && root.crypto?.subtle);
      this.supported = supported;
      $('posePrepare').disabled = !supported;
      this.state(supported ? 'unprepared' : 'unsupported', supported ? '전신 확인은 선택 기능이에요. 먼저 준비한 뒤 켜 주세요.' : '이 브라우저에서는 전신 확인을 지원하지 않아요. 기본 촬영은 사용할 수 있어요.');
    }
    state(state, message) {
      this.status = state;
      $('posePanel').dataset.state = state;
      $('poseStatus').textContent = message;
      $('posePrepare').hidden = this.prepared || this.busy;
      $('poseCancel').hidden = !this.busy;
      $('poseClear').hidden = !this.prepared && !this.busy && state !== 'error';
      $('poseEnabled').disabled = !this.prepared || this.busy || !this.supported;
      $('poseEnabled').checked = this.enabled;
    }
    setShotSettings(options) {
      if (!options || typeof options.enabled !== 'boolean' || !['left', 'right'].includes(options.side) || !['low', 'normal', 'high'].includes(options.sensitivity)) throw new TypeError('Invalid shot settings');
      this.invalidateFrame();
      const detector = this.shotDetector || new BasketballShot.Detector({ side: options.side, sensitivity: options.sensitivity });
      const snapshot = detector.configure({ side: options.side, sensitivity: options.sensitivity });
      this.shotDetector = detector;
      this.lastShotContext = null;
      this.shotSettings = { enabled: options.enabled, side: options.side, sensitivity: options.sensitivity };
      this.notifyShot(snapshot);
    }
    setMovement({ sport, enabled = false, side = 'right' }) {
      if (!['basketball', 'volleyball'].includes(sport) || typeof enabled !== 'boolean' || !['left', 'right'].includes(side)) throw new TypeError('Invalid movement selection');
      this.resetShot('sport-change');
      this.sport = sport;
      this.cueSettings = { enabled, side };
      this.cueDetector = new VolleyballCue.Detector({ side, sensitivity: 'normal' });
      this.onCueState(this.cueDetector.reset('sport-change'));
    }
    notifyShot(snapshot, frame = null) {
      snapshot.side = this.shotSettings.side;
      try { this.onShotState(snapshot, frame); }
      catch { frame?.bitmap.close(); }
    }
    setCaptureEnabled(enabled) {
      if (typeof enabled !== 'boolean') throw new TypeError('Invalid capture setting');
      if (this.captureEnabled === enabled) return;
      this.captureEnabled = enabled;
      this.resetShot('capture-setting');
    }
    invalidateFrame(clear = false) {
      this.frameRevision++;
      if (this.pendingFrame) {
        this.pendingFrame.bitmap?.close();
        this.pendingFrame.bitmap = null;
        this.pendingFrame.valid = false;
        if (clear) this.pendingFrame = null;
      }
    }
    async copyCapture(bitmap) {
      if (this.captureCopyPending) return null;
      this.captureCopyPending = true;
      let expired = false, timer;
      const copy = Promise.resolve().then(() => createImageBitmap(bitmap)).then(value => {
        if (expired) { value.close(); return null; }
        return value;
      }, () => null).finally(() => { this.captureCopyPending = false; });
      const timeout = new Promise(resolve => { timer = setTimeout(() => { expired = true; resolve(null); }, 250); });
      try { return await Promise.race([copy, timeout]); } finally { clearTimeout(timer); }
    }
    currentShotContext() {
      try { const context = this.shotContext(); return typeof context === 'string' ? context : null; }
      catch { return null; }
    }
    resetShot(reason) {
      this.invalidateFrame();
      this.lastShotContext = null;
      if (this.shotDetector) this.notifyShot(this.shotDetector.reset(reason));
      if (this.cueDetector) this.onCueState(this.cueDetector.reset(reason));
    }
    instance() { if (!this.runtime || this.runtime.closed) this.runtime = this.runtimeFactory(); return this.runtime; }
    async prepare() {
      if (!this.supported || this.busy) return;
      this.suspend();
      const generation = this.generation;
      this.busy = true;
      this.state('preparing', '전신 확인을 준비하고 있어요. 처음에는 인터넷 연결과 저장 공간이 필요해요. 기본 촬영은 계속 사용할 수 있어요.');
      try {
        await this.instance().prepare();
        if (generation !== this.generation) return;
        this.prepared = true;
        this.busy = false;
        this.lastError = null;
        this.state('ready', '준비됐어요. 전신 확인 사용을 켜면 이 기기 안에서만 분석해요.');
      } catch (error) {
        if (generation !== this.generation) return;
        this.busy = false;
        this.prepared = false;
        this.enabled = false;
        this.lastError = error;
        this.state('error', '전신 확인을 준비하지 못했어요. 연결·저장 공간·앱 파일을 확인한 뒤 다시 시도해 주세요. 기본 촬영은 계속 사용할 수 있어요.');
      }
    }
    cancelPreparation() {
      this.suspend();
      this.busy = false;
      this.prepared = false;
      this.enabled = false;
      this.state('unprepared', '준비를 중단했어요. 필요할 때 다시 준비할 수 있어요.');
    }
    setEnabled(enabled) {
      this.enabled = Boolean(enabled && this.prepared);
      if (!this.enabled) { this.suspend(); this.state(this.prepared ? 'ready' : 'unprepared', '전신 확인을 껐어요. 기본 촬영은 계속 사용할 수 있어요.'); }
      else this.cameraStarted();
    }
    async cameraStarted() {
      if (!this.enabled || !this.prepared || this.running || this.busy) return;
      if (this.paused()) { this.state('paused', '장면 선택·저장을 마치면 전신 확인을 다시 시작해요.'); return; }
      if (!this.cameraActive()) { this.state('waiting-camera', '카메라를 시작하면 전신 확인을 함께 사용해요.'); return; }
      this.suspend();
      const generation = this.generation;
      this.busy = true;
      this.state('starting', '전신 확인을 시작하고 있어요. 기본 지연 영상은 계속 재생돼요.');
      try {
        await this.instance().start({
          onResult: result => { if (generation === this.generation) this.receive(result, true); },
          onError: error => { if (generation === this.generation) this.failure(error); },
        });
        if (generation !== this.generation || !this.enabled || !this.cameraActive() || document.hidden) { if (generation === this.generation) this.suspend(); return; }
        this.busy = false;
        this.running = true;
        this.stableFrames = 0;
        this.intervalMs = 333;
        this.state('searching', '전신을 확인하고 있어요. 한 명이 머리부터 발끝까지 보이게 서 주세요.');
        this.schedule(generation);
      } catch (error) { if (generation === this.generation) this.failure(error); }
    }
    schedule(generation) {
      if (generation !== this.generation || !this.running) return;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.sample(generation), this.intervalMs);
    }
    async sample(generation) {
      if (generation !== this.generation || !this.running) return;
      if (!this.cameraActive() || document.hidden) { this.suspend('촬영이 멈춰 전신 확인도 멈췄어요. 촬영을 다시 시작해 주세요.'); return; }
      if (this.shotDetector?.lastTime !== null && this.shotDetector?.lastTime !== undefined && performance.now() - this.shotDetector.lastTime > BasketballShot.GAP_MS) this.resetShot('gap');
      if (this.lastResult && performance.now() - this.lastResult.timestamp > 2000) this.stale();
      if (this.paused()) { this.suspend('장면 선택·저장 중에는 전신 확인을 멈춰요.'); return; }
      if (this.copying || this.runtime.inflight || this.video.readyState < 2) { this.metrics.skipped++; this.schedule(generation); return; }
      this.copying = true;
      let bitmap, capture;
      const start = performance.now(), revision = this.frameRevision;
      const context = (this.shotSettings.enabled || (this.sport === 'volleyball' && this.cueSettings.enabled)) ? this.currentShotContext() : '';
      try {
        if (context === null) { this.resetShot('context'); return; }
        const width = Math.min(320, this.video.videoWidth);
        const height = Math.max(1, Math.round(width * this.video.videoHeight / this.video.videoWidth));
        bitmap = await createImageBitmap(this.video, { resizeWidth: width, resizeHeight: height, resizeQuality: 'low' });
        const timestamp = performance.now();
        if (this.captureEnabled && this.shotSettings.enabled && this.sport === 'basketball') {
          capture = await this.copyCapture(bitmap);
        }
        const currentContext = (this.shotSettings.enabled || (this.sport === 'volleyball' && this.cueSettings.enabled)) ? this.currentShotContext() : '';
        if (generation !== this.generation || revision !== this.frameRevision || !this.running || !this.enabled || this.paused() || !this.cameraActive() || document.hidden || currentContext !== context || performance.now() - timestamp > BasketballShot.GAP_MS) {
          if (currentContext !== context && revision === this.frameRevision) this.resetShot('context');
          return;
        }
        this.record('copiesMs', performance.now() - start);
        // The copy belongs to this one accepted input; no later video frame is read.
        const submitted = this.runtime.submit(bitmap, timestamp);
        bitmap = null;
        if (submitted) {
          this.pendingFrame = { timestamp, context, revision, generation, valid: true, bitmap: capture || null };
          capture = null;
          this.metrics.submitted++;
        } else this.metrics.skipped++;
      } catch (error) { if (generation === this.generation && revision === this.frameRevision) this.failure(error); }
      finally { bitmap?.close(); capture?.close(); this.copying = false; this.schedule(generation); }
    }
    record(type, value) { const values = this.metrics[type]; values.push(value); if (values.length > 120) values.shift(); }
    stale() {
      this.resetShot('stale');
      this.lastResult = { usable: false, reason: 'stale', timestamp: performance.now() };
      this.stableFrames = 0;
      this.state('unavailable', '최근 전신 확인 결과가 없어 분석을 멈췄어요. 화면이 다시 확인될 때까지 기다려 주세요.');
      this.cancelSpeech();
    }
    receive(result, fromRuntime = false) {
      let frame = null;
      if (fromRuntime && !this.pendingFrame && this.captureEnabled) { this.resetShot('frame-mismatch'); return; }
      if (fromRuntime && this.pendingFrame) {
        const pending = this.pendingFrame;
        this.pendingFrame = null;
        const context = (this.shotSettings.enabled || (this.sport === 'volleyball' && this.cueSettings.enabled)) ? this.currentShotContext() : '';
        if (!pending.valid || pending.timestamp !== result.timestamp || pending.generation !== this.generation || pending.revision !== this.frameRevision || pending.context !== context) {
          pending.bitmap?.close();
          this.resetShot('frame-mismatch');
          return;
        }
        frame = pending.bitmap;
      }
      this.processResult(result, frame);
    }
    processResult(result, frame) {
      try {
      if (!Number.isFinite(result.timestamp) || performance.now() - result.timestamp > 2000 || result.timestamp > performance.now() + 100) { this.stale(); return; }
      this.metrics.results++;
      if (Number.isFinite(result.latencyMs)) { this.record('inferenceMs', result.latencyMs); if (result.latencyMs > 300) this.intervalMs = Math.min(1000, Math.max(333, Math.ceil(result.latencyMs * 1.5))); }
      const landmarks = result.landmarks?.length === 1 ? result.landmarks[0] : null;
      const presence = PosePresence.analyze(landmarks);
      this.lastResult = { usable: false, reason: presence.reason, timestamp: result.timestamp };
      if (!presence.usable) {
        this.resetShot(presence.reason);
        this.stableFrames = 0;
        this.state('unavailable', presence.message + ' 분석 가능한 상태가 될 때까지 확인을 멈춰요.');
        this.speak(presence.message, presence.reason);
        return;
      }
      this.stableFrames++;
      if (this.stableFrames < 3) { this.state('recovering', '전신이 안정적으로 보이는지 잠시 더 확인하고 있어요.'); return; }
      this.lastResult.usable = true;
      if (this.sport === 'volleyball' && this.cueSettings.enabled && this.cueDetector) {
        const context = this.currentShotContext();
        if (!this.running || !this.enabled || !this.cameraActive() || this.paused() || document.hidden || performance.now() - result.timestamp > BasketballShot.GAP_MS || typeof context !== 'string') this.resetShot('stale');
        else {
          if (this.lastShotContext !== null && context !== this.lastShotContext) this.resetShot('context');
          this.lastShotContext = context;
          this.onCueState(this.cueDetector.update({ landmarks, timestamp: result.timestamp, width: result.width, height: result.height }));
        }
      }
      if (this.sport === 'basketball' && this.shotSettings.enabled && this.shotDetector) {
        if (!this.running || !this.enabled || !this.cameraActive() || this.paused() || document.hidden || performance.now() - result.timestamp > BasketballShot.GAP_MS) this.resetShot('stale');
        else {
          const context = this.currentShotContext();
          if (typeof context !== 'string') this.resetShot('context');
          else {
            if (this.lastShotContext !== null && context !== this.lastShotContext) this.resetShot('context');
            this.lastShotContext = context;
            const snapshot = this.shotDetector.update({ landmarks, timestamp: result.timestamp, width: result.width, height: result.height });
            snapshot.timestamp = result.timestamp;
            if (snapshot.event && Number.isFinite(snapshot.angle) && Number.isFinite(snapshot.wristToEar) && Number.isFinite(snapshot.wristToShoulder)) {
              const indices = PosePresence.REQUIRED_INDICES;
              const visibility = Math.min(...indices.map(index => landmarks[index].visibility));
              const minPresence = indices.every(index => Number.isFinite(landmarks[index].presence)) ? Math.min(...indices.map(index => landmarks[index].presence)) : null;
              const thresholds = BasketballShot.LEVELS[this.shotSettings.sensitivity];
              try {
                snapshot.evidence = Object.freeze({ id: crypto.randomUUID(), contextKey: context,
                  inputAt: Math.round(performance.timeOrigin + result.timestamp), side: this.shotSettings.side, sensitivity: this.shotSettings.sensitivity,
                  elbowAngle: snapshot.angle, ruleVersion: 'basketball-shot-2d-v1',
                  thresholds: Object.freeze({ readyAngle: thresholds.readyAngle, shootAngle: thresholds.shootAngle, wristAboveEar: thresholds.wristAboveEar }),
                  fullBodyUsable: true, wristToEar: snapshot.wristToEar, wristToShoulder: snapshot.wristToShoulder,
                  minVisibility: visibility, minPresence, modelVersion: PoseAssets.version, frameWidth: result.width, frameHeight: result.height });
              } catch { /* Feedback remains available if optional history evidence cannot be formed. */ }
            }
            if (snapshot.event && frame && this.captureEnabled) {
              // Ownership passes to the callback; notifyShot closes on callback failure.
              this.notifyShot(snapshot, { timestamp: result.timestamp, bitmap: frame });
              frame = null;
            } else this.notifyShot(snapshot);
          }
        }
      }
      this.state('present', '전신이 화면 안에 보이고 필요한 관절을 확인했어요. 자세의 정확성이나 슛 성공을 판정한 결과는 아니에요.');
      this.speak('전신을 확인했어요.', 'present');
      } finally { frame?.close(); }
    }
    updateVoices() {
      this.voice = root.speechSynthesis?.getVoices().find(voice => voice.localService && voice.lang.startsWith('ko')) || null;
      $('poseSpeech').disabled = !this.voice;
      if (!this.voice) { $('poseSpeech').checked = false; this.cancelSpeech(); }
      $('poseSpeechNote').textContent = this.voice ? '이 기기에 설치된 음성만 사용해요. 기본값은 꺼짐이에요.' : '이 기기의 한국어 음성이 없어 텍스트로 안내해요.';
    }
    speak(text, reason) {
      if (!$('poseSpeech').checked || !this.voice || document.hidden || !this.enabled) return;
      const now = performance.now();
      if (reason === this.lastSpoken || now - this.lastSpokenAt < 6000) return;
      this.cancelSpeech();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.voice = this.voice;
      utterance.lang = 'ko-KR';
      root.speechSynthesis.speak(utterance);
      this.lastSpoken = reason;
      this.lastSpokenAt = now;
    }
    cancelSpeech() { root.speechSynthesis?.cancel(); }
    suspend(message) {
      const wasBusy = this.busy;
      this.resetShot('suspended');
      this.invalidateFrame(true);
      this.generation++;
      clearTimeout(this.timer);
      this.timer = null;
      this.runtime?.stop();
      this.running = false;
      this.busy = false;
      this.stableFrames = 0;
      this.lastResult = null;
      this.cancelSpeech();
      if (message && this.enabled) this.state('waiting-camera', message);
      else if (message && wasBusy) { this.prepared = false; this.state('unprepared', '전신 확인 준비를 중단했어요. 필요할 때 다시 준비해 주세요. 기본 촬영은 사용할 수 있어요.'); }
    }
    failure(error) {
      this.lastError = error;
      this.suspend();
      this.enabled = false;
      this.state('error', '전신 확인을 실행하지 못했어요. 사용을 다시 켜거나 준비를 다시 시도해 주세요. 기본 촬영은 계속 사용할 수 있어요.');
    }
    async clear() {
      this.enabled = false;
      this.suspend();
      const generation = this.generation;
      this.busy = true;
      this.state('clearing', '전신 확인 준비 파일을 지우고 있어요. 저장한 수업 클립에는 영향을 주지 않아요.');
      try { await this.instance().clear(); if (generation !== this.generation) return; this.runtime.close(); this.runtime = null; this.prepared = false; this.busy = false; this.state('unprepared', '전신 확인 준비 파일을 지웠어요. 기본 촬영은 사용할 수 있어요.'); }
      catch (error) { if (generation === this.generation) this.failure(error); }
    }
    async reset() { $('poseSpeech').checked = false; await this.clear(); }
    dispose() { this.enabled = false; this.suspend(); this.runtime?.close(); this.runtime = null; }
  }
  root.PoseUI = PoseUI;
})(globalThis);
