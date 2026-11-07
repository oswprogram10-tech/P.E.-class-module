const HISTORY_MS = 5 * 60 * 1000;
const FRAME_INTERVAL_MS = 100;
const FRAME_WIDTH = 480;
const FRAME_HEIGHT = 270;
const CLIP_DB = 'pe-loop-local-v1';
const CLIP_STORE = 'clips';
const SETTINGS_KEY = 'pe-loop-settings-v1';
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const $ = (id) => document.getElementById(id);
const cameraVideo = $('cameraVideo');
const previewCanvas = $('previewCanvas');
const previewContext = previewCanvas.getContext('2d', { alpha: false });
const captureCanvas = $('captureCanvas');
const captureContext = captureCanvas.getContext('2d', { alpha: false });
const clipCanvas = $('clipCanvas');
const clipContext = clipCanvas.getContext('2d', { alpha: false });

let cameraStream = null;
let captureLoop = false;
let captureBusy = false;
let drawBusy = false;
const frameBuffer = new FrameBuffer({ durationMs: HISTORY_MS });
const frameHistory = frameBuffer.frames;
const captureNow = () => performance.timeOrigin + performance.now();
let captureGeneration = 0;
let captureRafId = null;
let cameraStarting = false;
let cameraInterruptedReason = '';
let lastVideoTime = -1;
let lastVideoProgressAt = 0;
let firstCapturedAt = 0;
let wakeLock = null;
let savingInterrupted = false;
let lastDrawnFrame = 0;
let lastFrameCutoff = 0;
let delaySeconds = 20;
let selectedEndOffset = 0;
let selectedLengthSeconds = 15;
let selectedStartIndex = 0;
let selectedEndIndex = 0;
let clipSelectionOpenedAt = 0;
let selectedDeleteId = null;
let toastTimer = null;
let installPrompt = null;
let teacherKey = null;
let teacherUnlocked = false;
const repository = new ClipRepository(CLIP_DB);
let classroomUI = null;
let poseUI = null;
let shotFeedback = null;
let shotHistory = null;
let pendingTransactions = 0;
const repositoryTransaction = repository.transaction.bind(repository);
repository.transaction = (...args) => {
  pendingTransactions += 1;
  return repositoryTransaction(...args).finally(() => { pendingTransactions -= 1; });
};
let vaultConfig = null;
let vaultProblem = '';
let appReady = false;
let pinBusy = false;
let pinController = null;
let teacherGeneration = 0;
let libraryGeneration = 0;
let mediaGeneration = 0;
let storageGeneration = 0;
let expiryTimer = null;
let deleting = false;
let resetting = false;
let libraryRows = new Map();
const vaultChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('pe-loop-vault') : null;
let previewClipLoop = false;
let previewClipToken = 0;
let libraryObjectUrls = [];
let selectionSnapshot = [];
let saving = false;
let studioState = 'idle';
let activeSaveController = null;
let savePhase = 'idle';
let previewDecodeFailed = false;
let updateRegistration = null;
let offlineCheckGeneration = 0;
let registrationGeneration = 0;
let serviceWorkerListenerInstalled = false;
let referenceUrl = null;
let referenceGeneration = 0;

function restingState() {
  return cameraStream ? ($('clipDialog').open ? 'selecting' : 'capturing') : (cameraInterruptedReason ? 'interrupted' : 'idle');
}

function setStudioState(state) {
  studioState = state;
  document.body.dataset.studioState = state;
  $('cameraButton').disabled = !appReady || state === 'saving' || state === 'starting';
  $('teacherButton').disabled = !appReady || state === 'saving';
  $('openClipButton').disabled = !cameraStream || state === 'saving' || frameBuffer.duration < 5000;
}

function setSaving(value) {
  if (value) poseUI?.suspend('장면을 저장하는 동안 전신 확인을 쉬어요.');
  else if (cameraStream) poseUI?.cameraStarted();
  saving = value;
  setStudioState(value ? 'saving' : restingState());
  for (const id of ['clipOffset', 'clipLength', 'clipStartFrame', 'clipEndFrame', 'studentName', 'studentNumber', 'reflectionGood', 'reflectionRetry', 'saveClipButton']) $(id).disabled = value;
  $('clipDialog').querySelector('.close-button').disabled = value;
  $('cancelSaveButton').hidden = !value;
  $('cancelSaveButton').disabled = false;
  $('clipDialog').setAttribute('aria-busy', String(value));
}

const settings = readSettings();
const DEFAULT_SHOT_SETTINGS = Object.freeze({ enabled: false, side: 'right', sensitivity: 'normal' });
const copyShotSettings = ({ enabled, side, sensitivity }) => ({ enabled, side, sensitivity });
let shotSettings = validShotSettings(settings.shot) ? copyShotSettings(settings.shot) : { ...DEFAULT_SHOT_SETTINGS };
let shotSettingsIssue = settings.shot !== undefined && !validShotSettings(settings.shot) ? '저장된 농구 설정을 읽을 수 없어 기본값과 사용 안 함으로 시작해요.' : '';

function validShotSettings(value) {
  return Boolean(value && typeof value.enabled === 'boolean' && ['right', 'left'].includes(value.side) && ['low', 'normal', 'high'].includes(value.sensitivity));
}

function syncShotControls(message = '') {
  $('teacherShotEnabled').checked = shotSettings.enabled;
  $('teacherShotSide').value = shotSettings.side;
  $('teacherShotSensitivity').value = shotSettings.sensitivity;
  $('shotSettingsStatus').textContent = message;
}

function currentShotContext() {
  const binding = classroomUI?.binding();
  return binding ? JSON.stringify([binding.classId, binding.studentId, binding.lessonId, binding.deviceId]) : '';
}

function createShotFeedback() {
  return new ShotFeedback({ currentContext: currentShotContext, active: () => Boolean(poseUI?.sport === 'basketball' && shotSettings.enabled && poseUI?.running && poseUI?.enabled && cameraStream && captureLoop && !saving && !$('teacherDialog').open && !$('clipDialog').open) });
}

function resetFeedbackOptions() {
  for (const id of ['shotVisualEnabled', 'shotSoundEnabled', 'shotCaptureEnabled']) $(id).checked = false;
  shotFeedback?.setOptions({ visual: false, sound: false, capture: false });
  poseUI?.setCaptureEnabled(false);
}

function renderShotState(snapshot = {}, eventFrame = null) {
  if (snapshot.reason) shotHistory?.observeReset();
  if (snapshot.event && poseUI?.sport === 'basketball' && snapshot.type !== 'volleyball-overhead-cue' && snapshot.ruleVersion !== 'volleyball-overhead-cue-v1') shotHistory?.record(snapshot);
  const state = ['ready', 'shoot'].includes(snapshot.state) ? snapshot.state : 'waiting';
  $('shotPanel').dataset.state = state;
  $('shotAngle').textContent = Number.isFinite(snapshot.angle) ? `${Math.round(snapshot.angle)}°` : '—';
  $('shotStatus').textContent = !shotSettings.enabled ? '교사 설정에서 켠 뒤 전신 확인을 사용해 주세요.'
    : state === 'ready' ? 'READY · 팔을 구부려 준비했어요. 선택한 팔을 위로 펴 주세요.'
    : state === 'shoot' ? 'SHOOT · 팔 펴기 동작을 감지했어요. 팔을 내린 뒤 다시 준비해 주세요.'
    : '전신이 안정적으로 보이면 선택한 팔을 구부려 준비해 주세요. 확인이 끊기면 처음부터 다시 준비해요.';
  try { if (shotFeedback) shotFeedback.consume({ ...snapshot, side: snapshot.side || shotSettings.side }, eventFrame); else eventFrame?.bitmap?.close(); }
  catch { try { eventFrame?.bitmap?.close(); } catch {} }
}

function saveShotSettings() {
  if (!teacherUnlocked || !teacherKey || !$('teacherDialog').open || document.hidden) return false;
  const next = { enabled: $('teacherShotEnabled').checked, side: $('teacherShotSide').value, sensitivity: $('teacherShotSensitivity').value };
  // A settings edit cannot continue a movement that began under older values.
  poseUI?.setShotSettings(shotSettings);
  if (!validShotSettings(next)) {
    syncShotControls('설정 값이 올바르지 않아 이전 설정을 유지해요. 팔과 민감도를 다시 선택해 주세요.');
    return false;
  }
  if (!saveSettings({ delaySeconds, shot: next })) {
    syncShotControls('농구 설정을 저장하지 못해 이전 설정을 유지해요. 저장 공간을 확인하고 다시 시도해 주세요.');
    return false;
  }
  shotSettings = next;
  shotSettingsIssue = '';
  settings.shot = { ...next };
  poseUI?.setShotSettings(shotSettings);
  syncShotControls('농구 설정을 저장했어요. 카메라와 전신 확인을 켜서 사용해 주세요.');
  return true;
}

function readSettings() {
  try {
    const value = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch { return {}; }
}

function saveSettings(value) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(value)); return true; }
  catch { return false; }
}

function friendlyFailure(error, fallback) {
  if (error?.name === 'QuotaExceededError') return '저장 공간이 부족해요. 기존 클립이나 기기 저장 공간을 정리한 뒤 다시 시도해 주세요.';
  if (error?.name === 'SecurityError') return '브라우저 저장 권한을 확인하고 HTTPS 주소를 Chrome에서 다시 열어 주세요.';
  if (error?.name === 'VersionError') return '앱 버전이 바뀌었어요. 다른 탭을 닫고 앱을 다시 열어 주세요.';
  return error?.name === 'Error' && /[가-힣]/.test(error.message) ? error.message : fallback;
}

function showToast(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2600);
}

function formatDuration(seconds) {
  const whole = Math.max(0, Math.round(seconds));
  if (whole < 60) return `${whole}초`;
  return `${Math.floor(whole / 60)}분 ${String(whole % 60).padStart(2, '0')}초`;
}

function formatDate(timestamp) {
  return new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(timestamp);
}

function setDelay(seconds, { persist = true } = {}) {
  const next = Math.min(300, Math.max(1, Number(seconds) || 20));
  if (persist && !saveSettings({ delaySeconds: next, shot: shotSettings })) {
    $('teacherMessage').textContent = '설정을 저장하지 못해 이전 지연 시간을 유지해요. 브라우저 저장 공간을 확인해 주세요.';
    $('teacherDelay').value = String(delaySeconds);
    return;
  }
  delaySeconds = next;
  $('delayReadout').textContent = `${delaySeconds}초`;
  $('teacherDelay').value = String(delaySeconds);
  $('teacherDelayValue').textContent = String(delaySeconds);
  settings.delaySeconds = delaySeconds;
}

function updateHistoryUi(now = captureNow()) {
  const oldest = frameHistory[0]?.time ?? now;
  const availableSeconds = Math.max(0, Math.min(HISTORY_MS / 1000, (now - oldest) / 1000));
  const progress = Math.min(100, availableSeconds / (HISTORY_MS / 1000) * 100);
  $('timelineProgress').style.width = `${progress}%`;
  $('timelineKnob').style.left = `${progress}%`;
  $('openClipButton').disabled = !cameraStream || saving || frameBuffer.duration < 5000;
  $('openClipButton').title = frameBuffer.duration < 5000 ? '최소 5초의 영상이 모이면 장면을 저장할 수 있어요.' : '최근 영상에서 저장할 장면을 골라요.';
  if (!cameraStream) {
    $('bufferStatus').textContent = '카메라 대기 중';
  } else if (availableSeconds < delaySeconds) {
    $('bufferStatus').textContent = `${Math.floor(availableSeconds)}초 영상 모으는 중`;
  } else {
    $('bufferStatus').textContent = `최근 ${formatDuration(availableSeconds)} 준비됨`;
  }
  if (frameBuffer.capacityLimited) $('bufferStatus').textContent = `메모리 한도로 최근 ${formatDuration(availableSeconds)} 보관`;
  if ($('clipDialog').open && !saving && !selectionSnapshot.length) {
    const referenceTime = clipSelectionOpenedAt || now;
    const clipAge = Math.floor((referenceTime - ((selectionSnapshot[0] || frameHistory[0])?.time ?? referenceTime)) / 1000);
    const maxOffset = Math.max(0, Math.min(300, clipAge - selectedLengthSeconds));
    $('clipOffset').max = String(maxOffset);
    if (Number($('clipOffset').value) > maxOffset) {
      $('clipOffset').value = String(maxOffset);
      updateClipRangeLabels();
    }
  }
}

async function drawFrameToCanvas(frame, canvas, context, shouldDraw = () => true) {
  if (!frame) return false;
  try {
    const bitmap = await createImageBitmap(frame.blob);
    const valid = shouldDraw();
    if (valid) context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return valid;
  } catch {
    return false;
  }
}

function closestFrame(targetTime) {
  if (!frameHistory.length) return null;
  let low = 0;
  let high = frameHistory.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (frameHistory[middle].time < targetTime) low = middle + 1;
    else high = middle;
  }
  const current = frameHistory[low];
  const previous = frameHistory[Math.max(0, low - 1)];
  if (Math.abs(previous.time - targetTime) <= Math.abs(current.time - targetTime)) return previous;
  return current;
}

async function captureTick(generation) {
  if (!captureLoop || generation !== captureGeneration) return;
  captureRafId = requestAnimationFrame(() => captureTick(generation));
  const now = captureNow();
  if (now - lastVideoProgressAt > 2500) {
    interruptCamera('카메라 영상이 멈췄어요. 촬영을 다시 시작해 주세요.');
    return;
  }
  if (captureBusy || cameraVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
  if (cameraVideo.currentTime === lastVideoTime || now - lastFrameCutoff < FRAME_INTERVAL_MS) return;
  lastVideoTime = cameraVideo.currentTime;
  lastVideoProgressAt = now;
  lastFrameCutoff = now;
  captureBusy = true;
  try {
    captureContext.drawImage(cameraVideo, 0, 0, FRAME_WIDTH, FRAME_HEIGHT);
    const blob = await new Promise(resolve => captureCanvas.toBlob(resolve, 'image/jpeg', 0.52));
    if (!captureLoop || generation !== captureGeneration || !blob) return;
    if (frameBuffer.add({ time: now, blob }) && !firstCapturedAt) firstCapturedAt = now;
  } catch {
    if (generation === captureGeneration) interruptCamera('카메라 영상을 읽지 못했어요. 촬영을 다시 시작해 주세요.');
  } finally {
    if (generation === captureGeneration) captureBusy = false;
  }
}

async function drawDelayedFrame(now = captureNow()) {
  if (!cameraStream || drawBusy || !frameHistory.length) return;
  const targetTime = now - delaySeconds * 1000;
  const shortfall = frameHistory[0].time - targetTime;
  // Allow one capture interval of sampling jitter, only after the configured
  // interval has actually elapsed. Larger memory shortages remain visible.
  const jitterReady = shortfall > 0 && shortfall <= 150 && firstCapturedAt && now - firstCapturedAt >= delaySeconds * 1000 && frameHistory.at(-1).time - frameHistory[0].time >= delaySeconds * 1000 - 150;
  if (shortfall > 0 && !jitterReady) {
    $('previewWrap').classList.remove('has-video');
    $('previewEmpty').removeAttribute('aria-hidden');
    $('previewEmpty').querySelector('strong').textContent = frameBuffer.capacityLimited ? '지연 영상의 보관 공간이 부족해요' : `지연 영상 준비 중 · ${Math.ceil(shortfall / 1000)}초`;
    $('previewEmpty').querySelector('span:last-child').textContent = frameBuffer.capacityLimited ? '현재 보관 범위에 맞춰 지연 시간을 줄여 주세요.' : '설정한 시간만큼 영상이 모이면 자동으로 재생돼요';
    lastDrawnFrame = 0;
    return;
  }
  const frame = closestFrame(targetTime);
  if (!frame || frame.time === lastDrawnFrame) return;
  drawBusy = true;
  const generation = captureGeneration;
  const success = await drawFrameToCanvas(frame, previewCanvas, previewContext, () => generation === captureGeneration && Boolean(cameraStream) && !$('clipDialog').open);
  if (success) {
    lastDrawnFrame = frame.time;
    $('previewWrap').classList.add('has-video');
    $('previewEmpty').setAttribute('aria-hidden', 'true');
  }
  drawBusy = false;
}

function cameraErrorMessage(error) {
  switch (error?.name) {
    case 'NotAllowedError': return '카메라 권한이 필요해요. Chrome 사이트 설정에서 허용한 뒤 다시 시작해 주세요.';
    case 'NotFoundError': return '사용할 수 있는 카메라가 없어요. 태블릿의 카메라 연결을 확인해 주세요.';
    case 'NotReadableError': return '다른 앱이 카메라를 사용 중일 수 있어요. 해당 앱을 닫고 다시 시작해 주세요.';
    default: return '카메라를 시작하지 못했어요. 카메라 상태를 확인한 뒤 다시 시도해 주세요.';
  }
}

function showCameraNotice(message) {
  $('cameraNotice').textContent = message;
  $('cameraNotice').hidden = !message;
}

async function requestScreenLock(generation) {
  if (!navigator.wakeLock || document.hidden) return;
  try {
    const lock = await navigator.wakeLock.request('screen');
    if (generation !== captureGeneration || !cameraStream) await lock.release();
    else wakeLock = lock;
  } catch { /* Screen lock is optional; capture can continue without it. */ }
}

async function startCamera() {
  if (!appReady || cameraStarting || saving || cameraStream || document.hidden) return;
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    showCameraNotice('카메라를 사용하려면 HTTPS 주소를 최신 Chrome에서 열어 주세요.');
    return;
  }
  if (vaultProblem || !teacherKey) {
    showTeacherDialog();
    return;
  }
  const generation = ++captureGeneration;
  cameraStarting = true;
  setStudioState('starting');
  $('cameraButton').querySelector('span:nth-child(2)').textContent = '카메라 연결 중…';
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } },
    });
    if (generation !== captureGeneration || document.hidden) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }
    cameraStream = stream;
    cameraVideo.srcObject = stream;
    await cameraVideo.play();
    if (generation !== captureGeneration) return;
    cameraInterruptedReason = '';
    showCameraNotice('');
    frameBuffer.clear();
    lastDrawnFrame = 0;
    lastFrameCutoff = 0;
    lastVideoTime = -1;
    lastVideoProgressAt = captureNow();
    firstCapturedAt = 0;
    captureBusy = false;
    captureLoop = true;
    for (const track of stream.getVideoTracks()) {
      const lost = () => { if (generation === captureGeneration) interruptCamera('카메라 연결이 끊겼어요. 촬영을 다시 시작해 주세요.'); };
      track.addEventListener('ended', lost, { once: true });
      track.addEventListener('mute', lost, { once: true });
    }
    captureTick(generation);
    requestScreenLock(generation);
    poseUI?.cameraStarted();
    $('cameraStatus').textContent = '화면이 5분 순환 버퍼에 임시 저장돼요';
    $('liveIndicator').classList.add('is-live');
    $('recordingToast').hidden = false;
    $('cameraButton').querySelector('span:nth-child(2)').textContent = '촬영 종료';
    showToast('카메라가 시작됐어요. 전신이 화면에 보이도록 서 주세요.');
  } catch (error) {
    if (stream) stream.getTracks().forEach(track => track.stop());
    if (generation === captureGeneration) {
      stopCamera({ preserveSession: true });
      showCameraNotice(cameraErrorMessage(error));
    }
  } finally {
    if (generation === captureGeneration) {
      cameraStarting = false;
      setStudioState(restingState());
    }
  }
}

function stopCamera({ preserveSession = false } = {}) {
  shotHistory?.stop();
  poseUI?.suspend('촬영이 멈춰 전신 확인도 멈췄어요. 촬영을 다시 시작해 주세요.');
  if (saving) { savingInterrupted = true; cancelActiveSave('interrupted'); }
  ++captureGeneration;
  cameraStarting = false;
  captureLoop = false;
  if (captureRafId !== null) cancelAnimationFrame(captureRafId);
  if (cameraStream) cameraStream.getTracks().forEach(track => track.stop());
  cameraStream = null;
  cameraVideo.srcObject = null;
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  frameBuffer.clear();
  lastDrawnFrame = 0;
  previewContext.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
  $('previewWrap').classList.remove('has-video');
  $('previewEmpty').removeAttribute('aria-hidden');
  $('previewEmpty').querySelector('strong').textContent = '촬영을 다시 시작해 주세요';
  $('previewEmpty').querySelector('span:last-child').textContent = '새 촬영을 시작하면 지연 영상이 다시 준비돼요';
  $('liveIndicator').classList.remove('is-live');
  $('recordingToast').hidden = true;
  $('cameraStatus').textContent = cameraInterruptedReason || '카메라 대기 중';
  $('cameraButton').querySelector('span:nth-child(2)').textContent = '촬영 다시 시작';
  if (!preserveSession) {
    classroomUI?.closeAll();
    teacherKey = null;
    selectionSnapshot = [];
    cameraInterruptedReason = '';
    showCameraNotice('');
  }
  if (!saving) setStudioState(restingState());
}

function interruptCamera(reason) {
  if (!cameraStream && !cameraStarting) return;
  cameraInterruptedReason = reason;
  if (saving) { savingInterrupted = true; cancelActiveSave('interrupted'); }
  document.dispatchEvent(new Event('captureinterrupted'));
  stopCamera({ preserveSession: true });
  showCameraNotice(reason + ' 이전 촬영과 새 촬영의 영상은 이어 붙이지 않아요.');
}

function getSelection() {
  const start = selectionSnapshot[selectedStartIndex]?.time;
  const end = selectionSnapshot[selectedEndIndex]?.time;
  const duration = Math.round((end - start) * 1000) / 1000000;
  return Timeline.select(selectionSnapshot, end, duration);
}

function getSelectionFrames() { return getSelection().frames; }

async function previewSelection() {
  if (saving) return;
  const token = ++previewClipToken;
  const selection = getSelection();
  previewDecodeFailed = false;
  if (!selection.valid) {
    $('clipPreviewEmpty').textContent = selection.reason;
    $('clipPreviewEmpty').hidden = false;
    return;
  }
  $('clipPreviewEmpty').hidden = true;
  previewClipLoop = true;
  const startedAt = performance.now();
  const valid = () => previewClipLoop && token === previewClipToken && $('clipDialog').open && !saving;
  const draw = async () => {
    if (!valid()) return;
    const offset = (performance.now() - startedAt) % (selection.end - selection.start);
    const frame = Timeline.frameAt(selection.frames, selection.start + offset);
    const drawn = await drawFrameToCanvas(frame, clipCanvas, clipContext, valid);
    if (!valid()) return;
    if (!drawn) {
      previewDecodeFailed = true;
      $('saveClipButton').disabled = true;
      $('clipPreviewEmpty').textContent = '이 장면을 읽지 못했어요. 다른 구간을 골라 주세요.';
      $('clipPreviewEmpty').hidden = false;
      return;
    }
    setTimeout(draw, FRAME_INTERVAL_MS);
  };
  draw();
}

async function previewSelectionFrame(index) {
  if (saving) return;
  previewClipLoop = false;
  const token = ++previewClipToken;
  const frame = selectionSnapshot[index];
  const valid = () => token === previewClipToken && $('clipDialog').open && !saving;
  if (!frame) return;
  $('clipPreviewEmpty').hidden = true;
  const drawn = await drawFrameToCanvas(frame, clipCanvas, clipContext, valid);
  if (!valid()) return;
  previewDecodeFailed = !drawn;
  if (!drawn) { $('saveClipButton').disabled = true; $('clipPreviewEmpty').textContent = '이 장면을 읽지 못했어요. 다른 프레임을 골라 주세요.'; $('clipPreviewEmpty').hidden = false; }
}

function updateClipRangeLabels({ fine = false, previewIndex = null } = {}) {
  if (saving) return;
  if (!fine) {
    selectedLengthSeconds = Number($('clipLength').value || 15);
    const availableSeconds = Math.floor((clipSelectionOpenedAt - (selectionSnapshot[0]?.time ?? clipSelectionOpenedAt)) / 1000);
    const maxOffset = Math.max(0, Math.min(300, availableSeconds - selectedLengthSeconds));
    $('clipOffset').max = String(maxOffset);
    if (Number($('clipOffset').value) > maxOffset) $('clipOffset').value = String(maxOffset);
    selectedEndOffset = Number($('clipOffset').value || 0);
    const endFrame = Timeline.frameAt(selectionSnapshot, clipSelectionOpenedAt - selectedEndOffset * 1000);
    selectedEndIndex = Math.max(0, selectionSnapshot.indexOf(endFrame));
    const startFrame = Timeline.frameAt(selectionSnapshot, endFrame.time - selectedLengthSeconds * 1000);
    selectedStartIndex = Math.max(0, selectionSnapshot.indexOf(startFrame));
    while (selectedStartIndex < selectedEndIndex && endFrame.time - selectionSnapshot[selectedStartIndex].time > 30000) selectedStartIndex++;
  } else {
    selectedStartIndex = Number($('clipStartFrame').value);
    selectedEndIndex = Number($('clipEndFrame').value);
  }
  $('clipStartFrame').value = String(selectedStartIndex);
  $('clipEndFrame').value = String(selectedEndIndex);
  $('clipOffsetValue').textContent = selectedEndOffset === 0 ? '화면에 보이던 장면' : `화면에 보이던 장면에서 ${selectedEndOffset}초 전`;
  const selection = getSelection();
  selectedLengthSeconds = Math.round((selection.end - selection.start) * 1000) / 1000000;
  $('clipLengthValue').textContent = `${selectedLengthSeconds.toFixed(2)}초`;
  $('clipStartFrameValue').textContent = `${selectedStartIndex + 1} / ${selectionSnapshot.length}`;
  $('clipEndFrameValue').textContent = `${selectedEndIndex + 1} / ${selectionSnapshot.length}`;
  const clock = value => new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(value);
  $('clipSelectionTime').textContent = selection.valid ? `${clock(selection.start)} ~ ${clock(selection.end)} · ${selectedLengthSeconds.toFixed(2)}초 구간 고정` : selection.reason;
  $('saveClipButton').disabled = !selection.valid;
  $('clipError').textContent = '';
  if (previewIndex === null) previewSelection();
  else previewSelectionFrame(previewIndex);
}

function cancelActiveSave(reason = 'user') {
  if (!activeSaveController || activeSaveController.signal.aborted) return;
  if (reason === 'user' && savePhase === 'committing') return;
  activeSaveController.abort(new DOMException(reason === 'user' ? '저장을 취소했어요. 선택한 장면은 유지돼요.' : '화면이나 촬영이 중단되어 저장하지 않았어요. 다시 시도해 주세요.', 'AbortError'));
  $('cancelSaveButton').disabled = true;
}

function openClipDialog() {
  if (!teacherKey) {
    showTeacherDialog();
    showToast('교사가 PIN을 입력한 뒤 장면을 저장해 주세요.');
    return;
  }
  if (!cameraStream) return showToast('먼저 카메라를 시작해 주세요.');
  if (frameBuffer.duration < 5000 || !lastDrawnFrame) return showToast('지연 영상이 화면에 나타나면 장면을 고를 수 있어요.');
  if (!frameHistory.some(frame => frame.time === lastDrawnFrame)) return showToast('화면의 장면이 버퍼에서 사라졌어요. 영상이 갱신되면 다시 선택해 주세요.');
  const available = Math.floor((captureNow() - (frameHistory[0]?.time ?? captureNow())) / 1000);
  $('clipOffset').max = String(Math.max(0, Math.min(300, available - 15)));
  $('clipOffset').value = '0';
  $('clipLength').value = '15';
  clipSelectionOpenedAt = lastDrawnFrame;
  selectionSnapshot = frameBuffer.snapshot();
  for (const id of ['clipStartFrame', 'clipEndFrame']) $(id).max = String(selectionSnapshot.length - 1);
  setStudioState('selecting');
  const binding = classroomUI?.binding();
  $('studentName').value = binding?.student.name || '';
  $('studentNumber').value = binding?.student.number || '';
  $('reflectionGood').value = ''; $('reflectionRetry').value = '';
  $('saveProgress').textContent = '';
  $('clipError').textContent = '';
  $('cancelSaveButton').hidden = true;
  poseUI?.suspend('장면을 고르는 동안 전신 확인을 쉬어요.');
  $('clipDialog').showModal();
  updateClipRangeLabels();
  $('studentName').focus({ preventScroll: true });
}

function openDatabase() { return repository.open(); }
function withStore(mode, operation, options) { return repository.raw(mode, operation, options); }
function allClips() { return repository.all(); }
async function encryptBlob(blob, key = teacherKey) { return LocalVault.encrypt(await blob.arrayBuffer(), key); }
async function decryptClip(record, key = teacherKey) {
  if (typeof record.mimeType !== 'string' || !record.mimeType.startsWith('video/webm')) throw new Error('지원하지 않는 클립이에요.');
  return new Blob([await LocalVault.decrypt(record.ciphertext, record.iv, key)], { type: record.mimeType });
}
function encryptMetadata(metadata, key = teacherKey) { return LocalVault.encrypt(new TextEncoder().encode(JSON.stringify(metadata)), key); }
async function decryptMetadata(record, key = teacherKey) {
  const bytes = await LocalVault.decrypt(record.metadataCiphertext, record.metadataIv, key);
  const value = JSON.parse(new TextDecoder().decode(bytes));
  if (!value || typeof value.studentName !== 'string' || !value.studentName.trim() || value.studentName.length > 24 || typeof value.studentNumber !== 'string' || !/^\d{1,4}$/.test(value.studentNumber)) throw new Error('학생 정보를 읽을 수 없어요.');
  for (const field of ['reflectionGood', 'reflectionRetry']) {
    if (value[field] === undefined) value[field] = '';
    if (typeof value[field] !== 'string' || value[field].length > 300) throw new Error('성찰 정보를 읽을 수 없어요.');
  }
  return value;
}

async function exportSelection(frames, durationSeconds, signal) {
  const start = getSelection().start;
  return ClipExporter.export({ frames, start, durationSeconds, signal,
    onProgress: progress => { $('saveProgress').textContent = `클립을 만드는 중이에요 · ${progress}%`; },
  });
}

async function saveSelectedClip() {
  if (saving) return;
  const name = $('studentName').value.trim();
  const number = $('studentNumber').value.trim();
  $('clipError').textContent = '';
  if (!name || name.length > 24 || /[\u0000-\u001f\u007f]/.test(name)) {
    $('clipError').textContent = '이름을 1~24자로 입력해 주세요.';
    $('studentName').focus(); return;
  }
  if (!/^\d{1,4}$/.test(number) || Number(number) === 0) {
    $('clipError').textContent = '번호는 1~9999 사이의 숫자로 입력해 주세요.';
    $('studentNumber').focus(); return;
  }
  if (!teacherKey) { $('clipError').textContent = '교사가 PIN을 입력한 뒤 저장해 주세요.'; return; }
  const selection = getSelection();
  if (!selection.valid || previewDecodeFailed) {
    $('clipError').textContent = selection.reason || '이 장면을 읽을 수 없어요. 다른 구간을 골라 주세요.';
    return;
  }
  const saveKey = teacherKey;
  const saveRevision = vaultConfig?.revision;
  const controller = new AbortController();
  activeSaveController = controller;
  savePhase = 'encoding'; savingInterrupted = false;
  setSaving(true);
  previewClipLoop = false; previewClipToken += 1;
  $('saveProgress').textContent = '클립을 준비하고 있어요…';
  let committed = false;
  try {
    const output = await exportSelection(selection.frames, selectedLengthSeconds, controller.signal);
    controller.signal.throwIfAborted();
    savePhase = 'encrypting';
    $('saveProgress').textContent = '클립을 안전하게 보관하고 있어요…';
    const encrypted = await encryptBlob(output.blob, saveKey);
    controller.signal.throwIfAborted();
    const metadata = await encryptMetadata({ ...classroomUI?.metadata(), studentName: name, studentNumber: number,
      reflectionGood: $('reflectionGood').value.trim().slice(0, 300), reflectionRetry: $('reflectionRetry').value.trim().slice(0, 300) }, saveKey);
    controller.signal.throwIfAborted();
    const createdAt = Date.now();
    const record = {
      id: crypto.randomUUID(), createdAt, expiresAt: createdAt + RETENTION_MS,
      durationSeconds: output.durationSeconds, mimeType: output.blob.type,
      iv: encrypted.iv, ciphertext: encrypted.ciphertext,
      metadataIv: metadata.iv, metadataCiphertext: metadata.ciphertext,
    };
    if (savingInterrupted || document.hidden) throw new Error('촬영이 중단되어 저장하지 않았어요. 다시 시도해 주세요.');
    savePhase = 'committing';
    $('cancelSaveButton').disabled = true;
    $('saveProgress').textContent = '저장을 마무리하고 있어요…';
    await repository.put(record, saveRevision, { signal: controller.signal });
    committed = true;
    classroomUI?.saved().catch(() => {});
  } catch (error) {
    $('saveProgress').textContent = controller.signal.aborted ? controller.signal.reason.message :
      friendlyFailure(error, '저장하지 못했어요. 기기 상태를 확인하고 다시 시도해 주세요.');
    savePhase = controller.signal.aborted ? 'cancelled' : 'failed';
  } finally {
    activeSaveController = null;
    setSaving(false);
    if (committed) {
      savePhase = 'succeeded';
      $('clipDialog').close();
      updateClipCount();
      showToast(`${name} 학생의 클립을 저장했어요. 7일 뒤 자동 삭제돼요.`);
    } else if ($('clipDialog').open) {
      updateClipRangeLabels({ fine: true });
    }
    setStudioState(restingState());
  }
}

function expireOldClips(now = Date.now()) { return repository.expire(now); }

function scheduleExpiry(summaries) {
  clearTimeout(expiryTimer);
  const next = summaries.filter(item => Number.isFinite(item.expiresAt)).reduce((min, item) => Math.min(min, item.expiresAt), Infinity);
  if (Number.isFinite(next)) expiryTimer = setTimeout(() => refreshRetention(), Math.min(3600000, Math.max(1, next - Date.now() + 5)));
}

async function updateClipCount() {
  try {
    await expireOldClips();
    const summaries = await repository.summaries();
    $('clipCount').textContent = String(summaries.length);
    scheduleExpiry(summaries);
  } catch { $('clipCount').textContent = '—'; }
}

async function refreshRetention() {
  try {
    const removed = await expireOldClips();
    await updateClipCount();
    if (removed && teacherUnlocked && !$('libraryPanel').hidden) await loadLibrary();
  } catch { /* A later access retries; expiry is checked again before playback. */ }
}

function clearPinInputs() { for (const id of ['newPin', 'confirmPin', 'unlockPin']) $(id).value = ''; }

function showTeacherDialog() {
  if (!appReady || saving) return;
  if (!window.isSecureContext || !crypto.subtle) { showCameraNotice('PIN 기능을 사용하려면 HTTPS 주소를 최신 Chrome에서 열어 주세요.'); return; }
  shotHistory?.pause();
  poseUI?.suspend('교사 설정을 여는 동안 전신 확인과 슛 동작 확인을 쉬어요.');
  teacherGeneration++;
  pinController?.abort(); pinController = null;
  pinBusy = false;
  $('createPinButton').disabled = false; $('unlockButton').disabled = false;
  teacherUnlocked = false;
  clearLibraryPreviewUrls(); clearPinInputs();
  const existing = Boolean(vaultConfig || vaultProblem);
  $('teacherMessage').textContent = vaultProblem;
  $('teacherSetupPanel').hidden = existing;
  $('teacherUnlockPanel').hidden = !existing;
  $('teacherContentPanel').hidden = true;
  if (!$('teacherDialog').open) $('teacherDialog').showModal();
  (existing ? $('unlockPin') : $('newPin')).focus({ preventScroll: true });
}

async function createTeacherPin() {
  if (pinBusy || !appReady || vaultProblem || vaultConfig) return;
  const pin = $('newPin').value.trim();
  if (!/^\d{6}$/.test(pin)) { $('teacherMessage').textContent = 'PIN은 숫자 6자리로 설정해 주세요.'; return; }
  if (pin !== $('confirmPin').value.trim()) { $('teacherMessage').textContent = '두 PIN이 서로 달라요.'; return; }
  const token = teacherGeneration;
  const controller = new AbortController(); pinController = controller;
  pinBusy = true; $('createPinButton').disabled = true;
  try {
    const candidate = await LocalVault.create(pin);
    controller.signal.throwIfAborted();
    const config = await repository.initialize(candidate.config, { signal: controller.signal });
    vaultConfig = config;
    if (config.revision !== candidate.config.revision) throw new Error('다른 탭에서 PIN을 설정했어요. 설정된 PIN으로 다시 열어 주세요.');
    if (token !== teacherGeneration || !$('teacherDialog').open) return;
    teacherKey = candidate.key;
    clearPinInputs(); revealTeacherContent();
  } catch (error) {
    if (token === teacherGeneration && !controller.signal.aborted) $('teacherMessage').textContent = friendlyFailure(error, 'PIN을 저장하지 못했어요. 저장 공간과 기기 상태를 확인해 주세요.');
  } finally {
    if (token === teacherGeneration) { pinBusy = false; $('createPinButton').disabled = false; pinController = null; }
  }
}

async function unlockTeacher() {
  if (pinBusy || !appReady) return;
  const pin = $('unlockPin').value.trim();
  if (!/^\d{6}$/.test(pin)) { $('teacherMessage').textContent = '숫자 6자리 PIN을 입력해 주세요.'; return; }
  const token = teacherGeneration;
  pinBusy = true; $('unlockButton').disabled = true;
  try {
    const config = await repository.config();
    const candidate = await LocalVault.verify(pin, config);
    const latest = await repository.config();
    if (!config?.revision || latest?.revision !== config.revision) throw new Error('PIN 설정이 바뀌었어요. 다시 확인해 주세요.');
    if (token !== teacherGeneration || !$('teacherDialog').open || document.hidden) return;
    vaultConfig = config; vaultProblem = ''; teacherKey = candidate;
    clearPinInputs(); revealTeacherContent();
  } catch (error) {
    if (token === teacherGeneration) $('teacherMessage').textContent = friendlyFailure(error, 'PIN을 확인하지 못했어요. 저장소와 기기 상태를 확인해 주세요.');
    // A failed candidate must never erase the active class key.
  } finally {
    if (token === teacherGeneration) { pinBusy = false; $('unlockButton').disabled = false; $('unlockPin').value = ''; }
  }
}

function revealTeacherContent() {
  teacherUnlocked = true;
  $('teacherSetupPanel').hidden = true; $('teacherUnlockPanel').hidden = true;
  $('teacherContentPanel').hidden = false; $('teacherMessage').textContent = '';
  $('teacherDelay').value = String(delaySeconds); $('teacherDelayValue').textContent = String(delaySeconds);
  syncShotControls(shotSettingsIssue);
  showTeacherTab('settings'); updateClipCount(); refreshStorageInfo();
  classroomUI?.teacherOpen().then(() => shotHistory?.open());
}

function showTeacherTab(panel) {
  if (!teacherUnlocked) return;
  document.querySelectorAll('.teacher-tab').forEach(tab => tab.classList.toggle('is-active', tab.dataset.panel === panel));
  $('settingsPanel').hidden = panel !== 'settings'; $('libraryPanel').hidden = panel !== 'library'; $('classroomPanel').hidden = panel !== 'classroom';
  $('teacherContentTitle').textContent = panel === 'settings' ? '수업 설정' : panel === 'classroom' ? '학급 · 제출' : '저장한 클립';
  if (panel === 'classroom' && !$('classroomTeacherRoot').children.length) classroomUI?.teacherOpen();
  if (panel === 'library') loadLibrary();
  else { clearLibraryPreviewUrls(); refreshStorageInfo(); }
}

function validLibrary(token, key) {
  return token === libraryGeneration && teacherUnlocked && teacherKey === key && $('teacherDialog').open && !$('libraryPanel').hidden && !document.hidden;
}

function remainingText(expiresAt) {
  const remaining = expiresAt - Date.now();
  if (remaining <= 0) return '보관 기간 만료';
  return remaining >= 86400000 ? `${Math.ceil(remaining / 86400000)}일 이내 삭제` : `${Math.max(1, Math.ceil(remaining / 3600000))}시간 이내 삭제`;
}

async function loadLibrary() {
  if (!teacherUnlocked || !teacherKey || $('libraryPanel').hidden) return;
  clearLibraryPreviewUrls();
  const token = libraryGeneration; const key = teacherKey;
  $('libraryStatus').textContent = '클립 목록을 확인하고 있어요…';
  $('libraryRetryButton').hidden = true; $('emptyLibrary').hidden = true;
  try {
    await expireOldClips();
    const summaries = await repository.summaries();
    if (!validLibrary(token, key)) return;
    $('clipCount').textContent = String(summaries.length); scheduleExpiry(summaries);
    for (const clip of summaries) {
      if (!validLibrary(token, key)) return;
      let metadata = null;
      try { if (clip.expiresAt !== null) metadata = await decryptMetadata(clip, key); } catch {}
      if (!validLibrary(token, key)) return;
      if (clip.expiresAt !== null && clip.expiresAt <= Date.now()) continue;
      const row = document.createElement('article'); row.className = 'library-item'; row.dataset.clipId = clip.id;
      const play = document.createElement('button'); play.type = 'button'; play.className = 'library-play'; play.textContent = '영상 보기';
      play.disabled = !metadata;
      const meta = document.createElement('div'); meta.className = 'library-meta';
      const title = document.createElement('strong'); title.textContent = metadata ? `${metadata.studentNumber}번 ${metadata.studentName}` : '읽을 수 없는 클립';
      const detail = document.createElement('span');
      const validDate = Number.isFinite(clip.createdAt) && Math.abs(clip.createdAt) <= 8640000000000000;
      const duration = Number.isFinite(clip.durationSeconds) ? `${clip.durationSeconds.toFixed(1)}초` : '길이 미확인';
      detail.textContent = metadata ? `${validDate ? formatDate(clip.createdAt) : '날짜 미확인'} · ${duration} · ${remainingText(clip.expiresAt)}` : '클립 정보가 손상됐어요. 이 항목만 삭제할 수 있어요.';
      meta.append(title, detail);
      if (metadata?.reflectionGood || metadata?.reflectionRetry) {
        const reflection = document.createElement('p'); reflection.className = 'clip-reflection';
        reflection.textContent = [metadata.reflectionGood && `잘된 점: ${metadata.reflectionGood}`, metadata.reflectionRetry && `다시 시도할 점: ${metadata.reflectionRetry}`].filter(Boolean).join(' · ');
        meta.append(reflection);
      }
      const del = document.createElement('button'); del.type = 'button'; del.className = 'library-delete'; del.textContent = '×'; del.setAttribute('aria-label', '이 클립 삭제');
      del.addEventListener('click', () => askDeleteClip(clip.id));
      play.addEventListener('click', () => playLibraryClip(clip.id, row, detail, token, key));
      row.append(play, meta, del); libraryRows.set(clip.id, row); $('libraryList').append(row);
    }
    if (!validLibrary(token, key)) return;
    $('libraryStatus').textContent = ''; $('emptyLibrary').hidden = libraryRows.size > 0;
  } catch {
    if (validLibrary(token, key)) { $('libraryStatus').textContent = '목록을 읽지 못했어요. 다시 시도해 주세요.'; $('libraryRetryButton').hidden = false; }
  }
}

async function playLibraryClip(id, row, detail, token, key) {
  if (!validLibrary(token, key)) return;
  clearLibraryMedia();
  const mediaToken = mediaGeneration;
  const valid = () => validLibrary(token, key) && mediaToken === mediaGeneration;
  try {
    const record = await repository.get(id, vaultConfig.revision);
    if (!valid()) return;
    if (!record) { await loadLibrary(); return; }
    const blob = await decryptClip(record, key);
    if (!valid()) return;
    if (expiry(record) <= Date.now()) { await refreshRetention(); return; }
    const url = URL.createObjectURL(blob);
    if (!valid()) { URL.revokeObjectURL(url); return; }
    libraryObjectUrls.push(url);
    const video = document.createElement('video'); video.className = 'library-video';
    video.src = url; video.controls = true; video.playsInline = true; video.muted = true; video.preload = 'metadata';
    video.onerror = () => { if (valid()) { clearLibraryMedia(); detail.textContent = '영상을 재생할 수 없어요. 이 클립만 삭제할 수 있어요.'; } };
    row.append(video);
    const controls = document.createElement('div'); controls.className = 'playback-controls';
    const speedLabel = document.createElement('label'); speedLabel.textContent = '재생 속도 ';
    const speed = document.createElement('select'); speed.setAttribute('aria-label', '재생 속도');
    for (const value of [0.5, 0.75, 1, 1.25, 1.5, 2]) { const option = document.createElement('option'); option.value = String(value); option.textContent = `${value}배`; option.selected = value === 1; speed.append(option); }
    speed.addEventListener('change', () => { video.playbackRate = Number(speed.value); });
    speedLabel.append(speed);
    const loopLabel = document.createElement('label'); const loop = document.createElement('input'); loop.type = 'checkbox';
    loop.addEventListener('change', () => { video.loop = loop.checked; });
    loopLabel.append(loop, document.createTextNode(' 반복 재생'));
    const download = document.createElement('button'); download.type = 'button'; download.className = 'clip-download'; download.textContent = '영상 파일 내보내기';
    download.addEventListener('click', async () => {
      if (valid() && expiry(record) <= Date.now()) { await refreshRetention(); return; }
      if (!valid() || !confirm('내보낸 영상 파일은 암호화되지 않습니다. 기기와 공유 위치를 확인해 주세요. 파일로 저장할까요?')) return;
      if (!valid()) return;
      if (expiry(record) <= Date.now()) { await refreshRetention(); return; }
      const link = document.createElement('a'); link.href = url; link.download = 'pe-loop-clip.webm'; link.click();
    });
    controls.append(speedLabel, loopLabel, download); row.append(controls);
  } catch { if (valid()) detail.textContent = '영상을 읽을 수 없어요. 다른 클립은 계속 확인할 수 있어요.'; }
}

function askDeleteClip(id) {
  if (!teacherUnlocked || !libraryRows.has(id) || deleting) return;
  selectedDeleteId = id; $('deleteMessage').textContent = ''; $('deleteDialog').showModal();
}

async function deleteClip() {
  if (!teacherUnlocked || !selectedDeleteId || deleting) return;
  const id = selectedDeleteId; const token = teacherGeneration;
  deleting = true; $('confirmDeleteButton').disabled = true; $('cancelDeleteButton').disabled = true;
  try {
    await classroomUI?.removed(id);
    await repository.delete(id, vaultConfig?.revision);
    if (token !== teacherGeneration || !teacherUnlocked) return;
    selectedDeleteId = null; $('deleteDialog').close(); await loadLibrary(); refreshStorageInfo();
  } catch { if (token === teacherGeneration) $('deleteMessage').textContent = '삭제하지 못했어요. 다시 시도해 주세요.'; }
  finally { deleting = false; $('confirmDeleteButton').disabled = false; $('cancelDeleteButton').disabled = false; }
}

function clearLibraryMedia() {
  mediaGeneration++;
  document.querySelectorAll('.playback-controls').forEach(controls => controls.remove());
  document.querySelectorAll('.library-video').forEach(video => { video.pause(); video.removeAttribute('src'); video.load(); video.remove(); });
  libraryObjectUrls.forEach(url => URL.revokeObjectURL(url)); libraryObjectUrls = [];
}

function clearLibraryPreviewUrls() {
  libraryGeneration++; clearLibraryMedia(); libraryRows.clear(); $('libraryList').replaceChildren();
  $('libraryStatus').textContent = ''; $('libraryRetryButton').hidden = true; $('emptyLibrary').hidden = true;
}

function closeTeacherAccess() {
  shotHistory?.close();
  teacherGeneration++; pinController?.abort(); pinController = null;
  classroomUI?.teacherClose();
  teacherUnlocked = false; pinBusy = false; clearPinInputs(); clearLibraryPreviewUrls();
  selectedDeleteId = null; if ($('deleteDialog').open) $('deleteDialog').close();
  $('teacherMessage').textContent = '';
  if (cameraStream) poseUI?.cameraStarted();
}

function lockTeacherDialog() {
  shotHistory?.stop();
  classroomUI?.closeAll();
  closeTeacherAccess(); teacherKey = null; $('teacherDialog').close();
}

async function refreshStorageInfo() {
  const token = teacherGeneration;
  const request = ++storageGeneration;
  try {
    const estimate = await navigator.storage?.estimate?.();
    const persistent = await navigator.storage?.persisted?.();
    if (token !== teacherGeneration || request !== storageGeneration || !teacherUnlocked) return;
    if (estimate && Number.isFinite(estimate.quota) && Number.isFinite(estimate.usage)) {
      const mib = bytes => (bytes / 1048576).toFixed(1);
      const free = Math.max(0, estimate.quota - estimate.usage);
      $('storageInfo').textContent = `이 사이트 사용 ${mib(estimate.usage)}MB / 할당 ${mib(estimate.quota)}MB (추정). ${free < 5 * 1048576 ? '여유가 적어요. 기존 클립을 정리해 주세요.' : '저장 공간은 기기 상황에 따라 달라져요.'}`;
    } else $('storageInfo').textContent = '남은 공간을 확인할 수 없어요. 저장 실패 시 기기 저장 공간을 확인해 주세요.';
    $('storagePersistence').textContent = persistent ? '자동 정리 방지 요청이 허용됐어요. 기기 초기화나 브라우저 데이터 삭제는 막을 수 없어요.' : '브라우저가 공간 확보를 위해 클립을 지울 수 있어요. 7일 보관을 보장하지는 않아요.';
  } catch { if (token === teacherGeneration && request === storageGeneration) { $('storageInfo').textContent = '저장 공간 정보를 확인하지 못했어요.'; $('storagePersistence').textContent = ''; } }
}

async function requestPersistentStorage() {
  if (!teacherUnlocked) return;
  try { await navigator.storage?.persist?.(); } catch {}
  await refreshStorageInfo();
}

function showResetDialog() {
  if (!appReady || saving || resetting) return;
  closeTeacherAccess(); if ($('teacherDialog').open) $('teacherDialog').close();
  for (const id of ['resetNewPin', 'resetConfirmPin', 'resetPhrase']) $(id).value = '';
  $('resetMessage').textContent = ''; $('confirmResetButton').disabled = true;
  $('resetDialog').showModal();
}

function updateResetReady() {
  $('confirmResetButton').disabled = resetting || $('resetPhrase').value !== '모두 삭제' || !/^\d{6}$/.test($('resetNewPin').value) || $('resetNewPin').value !== $('resetConfirmPin').value;
}

async function resetLocalData() {
  if (resetting || $('resetPhrase').value !== '모두 삭제') return;
  const pin = $('resetNewPin').value;
  if (!/^\d{6}$/.test(pin) || pin !== $('resetConfirmPin').value) { $('resetMessage').textContent = '새 PIN을 두 번 동일하게 입력해 주세요.'; return; }
  resetting = true; $('confirmResetButton').disabled = true; $('cancelResetButton').disabled = true;
  $('resetMessage').textContent = '새 PIN을 준비하고 있어요…';
  await poseUI?.reset();
  classroomUI?.closeAll();
  stopCamera(); clearLibraryPreviewUrls();
  try {
    const candidate = await LocalVault.create(pin);
    await repository.reset(candidate.config);
    vaultConfig = candidate.config; vaultProblem = ''; teacherKey = candidate.key;
    shotSettings = { ...DEFAULT_SHOT_SETTINGS }; shotSettingsIssue = ''; settings.shot = { ...shotSettings };
    resetFeedbackOptions();
    poseUI?.setShotSettings(shotSettings); syncShotControls();
    poseUI?.setMovement({ sport: 'basketball' });
    $('teacherMovementSport').value = 'basketball';
    $('teacherVolleyballEnabled').checked = false;
    $('teacherVolleyballSide').value = 'right';
    $('teacherShotHistoryEnabled').disabled = false;
    $('shotPanel').hidden = false; $('volleyballPanel').hidden = true;
    saveSettings({ delaySeconds, shot: shotSettings });
    for (const field of ['pinSalt', 'pinCheckIv', 'pinCheck', 'pinKdfIterations']) delete settings[field];
    $('resetDialog').close(); await updateClipCount();
    try { vaultChannel?.postMessage({ revision: vaultConfig.revision }); } catch {}
    try { localStorage.setItem('pe-loop-vault-revision', vaultConfig.revision); } catch {}
    showToast('이 기기의 모든 자료를 삭제하고 새 PIN을 설정했어요.');
  } catch { $('resetMessage').textContent = '초기화를 완료하지 못했어요. 저장소의 자료와 PIN은 함께 유지돼요. 다시 시도해 주세요.'; }
  finally { resetting = false; $('cancelResetButton').disabled = false; updateResetReady(); }
}

async function syncVaultRevision() {
  try {
    const current = await repository.config();
    if (vaultConfig?.revision === current?.revision) return;
    classroomUI?.closeAll();
    closeTeacherAccess(); if ($('teacherDialog').open) $('teacherDialog').close();
    stopCamera(); vaultConfig = current; vaultProblem = current ? '' : 'PIN 설정을 다시 확인해 주세요.';
    showCameraNotice('다른 탭에서 PIN 설정이 바뀌었어요. 새 PIN으로 다시 열어 주세요.');
  } catch { /* A guarded write still rejects stale revisions. */ }
}

function updateIsBusy() {
  return !appReady || cameraStarting || Boolean(cameraStream) || saving || pinBusy || deleting || resetting ||
    pendingTransactions > 0 || Boolean(classroomUI?.busy) || Boolean(poseUI?.busy) || Boolean(document.querySelector('dialog[open]'));
}

function setOfflineStatus(state, message) {
  $('offlineNotice').dataset.state = state;
  $('offlineMessage').textContent = message;
}

async function checkOfflineShell({ retry = false } = {}) {
  const generation = ++offlineCheckGeneration;
  setOfflineStatus('checking', '오프라인 준비 상태를 확인하고 있어요.');
  if (!updateRegistration) {
    setOfflineStatus('error', '오프라인 준비를 확인하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.');
    if (retry) registerServiceWorker();
    return;
  }
  if (retry) {
    try { await updateRegistration.update(); } catch { /* Check the installed cache below. */ }
  }
  if (generation !== offlineCheckGeneration) return;
  const worker = navigator.serviceWorker.controller || updateRegistration.active;
  if (!worker) {
    if (generation === offlineCheckGeneration) setOfflineStatus('error', '오프라인 준비가 끝나지 않았어요. 인터넷 연결을 확인하고 다시 시도해 주세요.');
    return;
  }
  const ready = await new Promise(resolve => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => { channel.port1.close(); resolve(false); }, 2000);
    channel.port1.onmessage = event => {
      clearTimeout(timer); channel.port1.close(); resolve(event.data?.ready === true);
    };
    try { worker.postMessage({ type: 'CHECK_SHELL' }, [channel.port2]); }
    catch { clearTimeout(timer); channel.port1.close(); channel.port2.close(); resolve(false); }
  });
  if (generation !== offlineCheckGeneration) return;
  setOfflineStatus(ready ? 'ready' : 'error', ready
    ? '오프라인 실행에 필요한 파일이 준비됐어요.'
    : '오프라인 파일을 확인하지 못했어요. 인터넷 연결을 확인해 다시 확인해 주세요. 계속되면 새 버전이 준비된 뒤 모든 앱 창을 닫고 다시 열어 주세요.');
}

function showWaitingUpdate() {
  if (!updateRegistration?.waiting || !navigator.serviceWorker.controller) return;
  $('updateNotice').hidden = false;
  $('updateMessage').textContent = '새 버전이 준비됐어요. 수업을 마친 뒤 적용해 주세요.';
}

function applyWaitingUpdate() {
  if (!updateRegistration?.waiting) return;
  if (updateIsBusy()) {
    $('updateMessage').textContent = '촬영과 저장을 마치고 열린 창을 닫은 뒤 적용해 주세요.';
    return;
  }
  $('updateMessage').textContent = '업데이트하려면 PE Loop의 모든 탭과 설치된 앱 창을 닫고 다시 열어 주세요.';
}

function registerServiceWorker() {
  const generation = ++registrationGeneration;
  ++offlineCheckGeneration;
  if (!('serviceWorker' in navigator) || !window.isSecureContext) {
    setOfflineStatus('error', '이 환경에서는 오프라인 준비를 사용할 수 없어요. HTTPS 주소에서 다시 열어 주세요.');
    return;
  }
  if (!serviceWorkerListenerInstalled) {
    serviceWorkerListenerInstalled = true;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // Initial installation and changes initiated elsewhere never reload this page.
      checkOfflineShell();
    });
  }
  navigator.serviceWorker.register('./sw.js').then(registration => {
    if (generation !== registrationGeneration) return;
    updateRegistration = registration;
    showWaitingUpdate();
    checkOfflineShell();
    registration.addEventListener('updatefound', () => {
      if (generation !== registrationGeneration) return;
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (generation !== registrationGeneration) return;
        if (worker.state === 'installed') showWaitingUpdate();
        if (worker.state === 'activated' || worker.state === 'redundant') checkOfflineShell();
      });
    });
    registration.installing?.addEventListener('statechange', event => {
      if (generation !== registrationGeneration) return;
      if (event.target.state === 'activated' || event.target.state === 'redundant') checkOfflineShell();
    });
  }).catch(() => {
    if (generation === registrationGeneration) setOfflineStatus('error', '오프라인 준비를 확인하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.');
  });
}

function updateReferenceAppearance() {
  const wrap = $('previewWrap');
  wrap.classList.toggle('reference-side', Boolean(referenceUrl) && $('referenceMode').value === 'side');
  wrap.style.setProperty('--reference-opacity', $('referenceOpacity').value);
  wrap.style.setProperty('--reference-scale', $('referenceScale').value);
  wrap.style.setProperty('--reference-x', `${$('referenceX').value}%`);
  wrap.style.setProperty('--reference-y', `${$('referenceY').value}%`);
}

function clearReferenceVideo() {
  const video = $('referenceVideo');
  ++referenceGeneration;
  video.pause(); video.removeAttribute('src'); video.load(); video.hidden = true;
  video.replaceWith(video.cloneNode(false));
  if (referenceUrl) URL.revokeObjectURL(referenceUrl);
  referenceUrl = null; $('referenceFile').value = '';
  updateReferenceAppearance();
  $('referenceTime').disabled = true; $('referenceTime').value = '0';
  $('referencePlay').disabled = true; $('referencePlay').textContent = '시범 영상 재생';
  $('referenceClear').disabled = true; $('referenceStatus').textContent = '기기에 있는 영상만 불러와요.';
}

function setupReferenceVideo() {
  for (const id of ['referenceMode', 'referenceOpacity', 'referenceScale', 'referenceX', 'referenceY']) $(id).addEventListener('input', updateReferenceAppearance);
  $('referenceFile').addEventListener('change', () => {
    const file = $('referenceFile').files[0];
    if (!file) return;
    clearReferenceVideo();
    if (!file.type.startsWith('video/')) { $('referenceStatus').textContent = '영상 파일을 선택해 주세요.'; return; }
    const video = $('referenceVideo');
    const generation = referenceGeneration;
    referenceUrl = URL.createObjectURL(file); video.src = referenceUrl; video.hidden = false;
    updateReferenceAppearance();
    $('referenceClear').disabled = false; $('referenceStatus').textContent = '시범 영상을 읽고 있어요…';
    const valid = () => generation === referenceGeneration && video === $('referenceVideo') && Boolean(referenceUrl);
    video.addEventListener('loadedmetadata', () => {
      if (!valid() || !Number.isFinite(video.duration)) return;
      $('referenceTime').max = String(video.duration); $('referenceTime').disabled = false;
      $('referencePlay').disabled = false; $('referenceStatus').textContent = '기기의 시범 영상을 비교하고 있어요.';
    });
    video.addEventListener('error', () => { if (valid()) { clearReferenceVideo(); $('referenceStatus').textContent = '이 영상을 열 수 없어요. 다른 영상 파일을 선택해 주세요.'; } });
    video.addEventListener('timeupdate', () => { if (valid()) $('referenceTime').value = String(video.currentTime); });
    video.addEventListener('ended', () => { if (valid()) $('referencePlay').textContent = '시범 영상 재생'; });
  });
  $('referenceTime').addEventListener('input', () => { if (referenceUrl) $('referenceVideo').currentTime = Number($('referenceTime').value); });
  $('referencePlay').addEventListener('click', async () => {
    const video = $('referenceVideo');
    const generation = referenceGeneration;
    const valid = () => generation === referenceGeneration && video === $('referenceVideo') && Boolean(referenceUrl);
    if (video.paused) {
      try { await video.play(); if (valid() && !document.hidden && !video.paused) $('referencePlay').textContent = '시범 영상 일시정지'; }
      catch (error) { if (valid() && !document.hidden && error?.name !== 'AbortError') $('referenceStatus').textContent = '시범 영상을 재생하지 못했어요.'; }
    } else { video.pause(); $('referencePlay').textContent = '시범 영상 재생'; }
  });
  $('referenceClear').addEventListener('click', clearReferenceVideo);
  updateReferenceAppearance();
}

function setupInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    $('installButton').hidden = false;
    $('installHint').hidden = true;
  });
  $('installButton').addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    $('installButton').hidden = true;
  });
  window.addEventListener('appinstalled', () => {
    $('installButton').hidden = true;
    $('installHint').textContent = '홈 화면에서 PE Loop를 열 수 있어요';
    $('installHint').hidden = false;
  });
}

function wireEvents() {
  for (const id of ['shotVisualEnabled', 'shotSoundEnabled', 'shotCaptureEnabled']) $(id).addEventListener('change', () => {
    shotFeedback.setOptions({ visual: $('shotVisualEnabled').checked, sound: $('shotSoundEnabled').checked, capture: $('shotCaptureEnabled').checked });
    poseUI.resetShot('feedback-settings');
    poseUI.setCaptureEnabled($('shotCaptureEnabled').checked);
    if ($('shotSoundEnabled').checked) shotFeedback.unlockAudio();
  });
  $('shotCaptureClear').addEventListener('click', () => shotFeedback.clear());
  $('updateButton').addEventListener('click', applyWaitingUpdate);
  $('offlineRetryButton').addEventListener('click', () => checkOfflineShell({ retry: true }));
  $('cameraButton').addEventListener('click', () => cameraStream ? stopCamera() : startCamera());
  $('openClipButton').addEventListener('click', openClipDialog);
  $('clipOffset').addEventListener('input', updateClipRangeLabels);
  $('clipLength').addEventListener('input', updateClipRangeLabels);
  $('clipStartFrame').addEventListener('input', () => updateClipRangeLabels({ fine: true, previewIndex: Number($('clipStartFrame').value) }));
  $('clipEndFrame').addEventListener('input', () => updateClipRangeLabels({ fine: true, previewIndex: Number($('clipEndFrame').value) }));
  $('clipPreviewPlay').addEventListener('click', previewSelection);
  $('saveClipButton').addEventListener('click', saveSelectedClip);
  $('cancelSaveButton').addEventListener('click', () => cancelActiveSave('user'));
  $('teacherButton').addEventListener('click', showTeacherDialog);
  $('createPinButton').addEventListener('click', createTeacherPin);
  $('unlockButton').addEventListener('click', unlockTeacher);
  $('newPin').addEventListener('keydown', (event) => { if (event.key === 'Enter') $('confirmPin').focus(); });
  $('confirmPin').addEventListener('keydown', (event) => { if (event.key === 'Enter') createTeacherPin(); });
  $('unlockPin').addEventListener('keydown', (event) => { if (event.key === 'Enter') unlockTeacher(); });
  $('teacherDelay').addEventListener('input', (event) => setDelay(event.target.value));
  $('applyMovement').addEventListener('click', () => {
    if (!teacherUnlocked || !teacherKey || !$('teacherDialog').open || document.hidden) return;
    const sport = $('teacherMovementSport').value, side = $('teacherVolleyballSide').value;
    if (!['basketball', 'volleyball'].includes(sport) || !['left', 'right'].includes(side)) return;
    resetFeedbackOptions();
    shotHistory?.setEnabled(false);
    poseUI.setMovement({ sport, side, enabled: $('teacherVolleyballEnabled').checked });
    $('shotPanel').hidden = sport !== 'basketball';
    $('volleyballPanel').hidden = sport !== 'volleyball';
    $('teacherShotHistoryEnabled').disabled = sport !== 'basketball';
    $('movementSettingsStatus').textContent = '이번 실행에 적용했어요. 준비 상태·추가 피드백·이력 기록을 껐어요. 전신 확인을 켜고 처음부터 준비해 주세요.';
  });
  $('saveShotSettings').addEventListener('click', saveShotSettings);
  for (const id of ['teacherShotEnabled', 'teacherShotSide', 'teacherShotSensitivity']) $(id).addEventListener('change', () => {
    if (!teacherUnlocked || !$('teacherDialog').open) return;
    poseUI?.setShotSettings(shotSettings);
    $('shotSettingsStatus').textContent = '변경한 설정은 「농구 설정 저장」을 눌러 적용해 주세요.';
  });
  window.addEventListener('storage', event => {
    if (event.key !== SETTINGS_KEY && event.key !== null) return;
    const incoming = readSettings().shot;
    shotSettings = validShotSettings(incoming) ? copyShotSettings(incoming) : { ...DEFAULT_SHOT_SETTINGS };
    shotSettingsIssue = incoming !== undefined && !validShotSettings(incoming) ? '저장된 농구 설정을 읽을 수 없어 기본값과 사용 안 함으로 시작해요.' : '';
    settings.shot = { ...shotSettings };
    poseUI?.setShotSettings(shotSettings);
    syncShotControls('다른 화면의 설정 변경을 반영했어요. 동작을 처음부터 다시 준비해 주세요.');
  });
  for (const id of ['classroomTeacherRoot', 'studentClassroomRoot']) $(id).addEventListener('change', () => poseUI?.setShotSettings(shotSettings));
  $('teacherLockButton').addEventListener('click', lockTeacherDialog);
  document.querySelectorAll('.teacher-tab').forEach((tab) => tab.addEventListener('click', () => showTeacherTab(tab.dataset.panel)));
  $('cancelDeleteButton').addEventListener('click', () => { selectedDeleteId = null; $('deleteDialog').close(); });
  $('deleteDialog').addEventListener('cancel', event => { if (deleting) event.preventDefault(); else selectedDeleteId = null; });
  $('confirmDeleteButton').addEventListener('click', deleteClip);
  $('clipDialog').addEventListener('cancel', event => { if (saving) event.preventDefault(); });
  $('clipDialog').addEventListener('close', () => {
    previewClipLoop = false; previewClipToken += 1; selectionSnapshot = [];
    if (!saving) { setStudioState(restingState()); poseUI?.cameraStarted(); }
  });
  window.addEventListener('beforeunload', event => { if (saving) { event.preventDefault(); event.returnValue = ''; } });
  $('teacherDialog').addEventListener('close', closeTeacherAccess);
  $('teacherDialog').addEventListener('submit', closeTeacherAccess);
  $('teacherDialog').addEventListener('cancel', closeTeacherAccess);
  $('libraryRetryButton').addEventListener('click', loadLibrary);
  $('storagePersistButton').addEventListener('click', requestPersistentStorage);
  $('forgotPinButton').addEventListener('click', showResetDialog);
  $('cancelResetButton').addEventListener('click', () => { if (!resetting) $('resetDialog').close(); });
  $('confirmResetButton').addEventListener('click', resetLocalData);
  for (const id of ['resetNewPin', 'resetConfirmPin', 'resetPhrase']) $(id).addEventListener('input', updateResetReady);
  $('resetDialog').addEventListener('cancel', event => { if (resetting) event.preventDefault(); });
  $('resetDialog').addEventListener('close', () => { for (const id of ['resetNewPin', 'resetConfirmPin', 'resetPhrase']) $(id).value = ''; });
  vaultChannel?.addEventListener('message', () => syncVaultRevision());
  window.addEventListener('storage', event => { if (event.key === 'pe-loop-vault-revision') syncVaultRevision(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { $('referenceVideo').pause(); $('referencePlay').textContent = '시범 영상 재생'; if ($('teacherDialog').open) { closeTeacherAccess(); $('teacherDialog').close(); } cancelActiveSave('interrupted'); interruptCamera('앱이 화면에서 벗어나 촬영을 멈췄어요. 돌아온 뒤 다시 시작해 주세요.'); }
    else { syncVaultRevision(); refreshRetention(); }
  });
  window.addEventListener('pagehide', () => { clearReferenceVideo(); stopCamera(); resetFeedbackOptions(); shotFeedback?.dispose(); });
  window.addEventListener('pageshow', event => {
    if (event.persisted && shotFeedback?.disposed) { shotFeedback = createShotFeedback(); resetFeedbackOptions(); }
  });
}

function runLoops() {
  setInterval(() => {
    drawDelayedFrame();
    updateHistoryUi();
  }, 100);
  setInterval(refreshRetention, 60 * 60 * 1000);
}

async function init() {
  shotFeedback = createShotFeedback();
  poseUI = new PoseUI({ video: cameraVideo, cameraActive: () => Boolean(cameraStream && captureLoop), paused: () => saving || Boolean($('clipDialog').open) || Boolean($('teacherDialog').open) || document.hidden, onShotState: renderShotState,
    onCueState: snapshot => {
      $('volleyballStatus').textContent = !poseUI?.cueSettings.enabled ? '교사 설정에서 이번 실행의 동작 확인을 켜 주세요.'
        : snapshot.event || snapshot.state === 'swing' ? '머리 위 팔 스윙 유사 동작을 확인했어요. 팔을 내린 뒤 다시 준비해 주세요.'
        : snapshot.state === 'ready' ? '준비 자세를 확인했어요. 머리 위에서 팔을 옆·아래 방향으로 펴 주세요.'
        : '전신이 보이게 서서 선택한 팔을 머리 위로 구부려 준비해 주세요.';
    },
    shotContext: currentShotContext });
  poseUI.setShotSettings(shotSettings);
  syncShotControls(shotSettingsIssue);
  classroomUI = new ClassroomUI({ repository, access: () => ({ key: teacherKey, revision: vaultConfig?.revision, unlocked: teacherUnlocked }), decryptMetadata, decryptClip });
  shotHistory = new ShotHistoryUI({ classroom: classroomUI, repository, access: () => ({ key: teacherKey, revision: vaultConfig?.revision, unlocked: teacherUnlocked }), context: currentShotContext,
    active: () => Boolean(poseUI?.sport === 'basketball' && shotSettings.enabled && poseUI?.enabled && poseUI?.running && cameraStream && captureLoop && !saving && !document.hidden && !$('teacherDialog').open && !$('clipDialog').open), decryptMetadata });
  setDelay(settings.delaySeconds || 20, { persist: false });
  $('cameraButton').disabled = true; $('teacherButton').disabled = true;
  wireEvents(); setupInstallPrompt(); setupReferenceVideo(); registerServiceWorker(); runLoops();
  try {
    vaultConfig = await repository.config();
    if (!vaultConfig && LocalVault.validConfig(settings)) {
      const migrated = { pinSalt: settings.pinSalt, pinCheckIv: settings.pinCheckIv, pinCheck: settings.pinCheck, pinKdfIterations: 250000, revision: crypto.randomUUID() };
      vaultConfig = await repository.initialize(migrated, { legacy: true });
    }
    if (vaultConfig) {
      if (!LocalVault.validConfig(vaultConfig) || typeof vaultConfig.revision !== 'string' || !vaultConfig.revision) vaultProblem = 'PIN 설정이 손상됐어요. 초기화 안내를 확인해 주세요.';
      for (const field of ['pinSalt', 'pinCheckIv', 'pinCheck', 'pinKdfIterations']) delete settings[field];
      saveSettings({ delaySeconds, shot: shotSettings });
    } else if (await repository.count()) vaultProblem = '기존 클립의 PIN 설정을 찾을 수 없어요. 초기화 안내를 확인해 주세요.';
    await refreshRetention();
  } catch (error) { vaultProblem = friendlyFailure(error, '로컬 저장소를 열지 못했어요. 다른 탭과 저장 공간을 확인해 주세요.'); showCameraNotice(vaultProblem); }
  finally { appReady = true; setStudioState(restingState()); }
}

init();
