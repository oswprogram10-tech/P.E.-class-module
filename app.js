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
let wakeLock = null;
let savingInterrupted = false;
let lastDrawnFrame = 0;
let lastFrameCutoff = 0;
let delaySeconds = 20;
let selectedEndOffset = 0;
let selectedLengthSeconds = 15;
let clipSelectionOpenedAt = 0;
let selectedDeleteId = null;
let toastTimer = null;
let installPrompt = null;
let teacherKey = null;
let teacherUnlocked = false;
const repository = new ClipRepository(CLIP_DB);
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
  saving = value;
  setStudioState(value ? 'saving' : restingState());
  for (const id of ['clipOffset', 'clipLength', 'studentName', 'studentNumber', 'saveClipButton']) $(id).disabled = value;
  $('clipDialog').querySelector('.close-button').disabled = value;
  $('cancelSaveButton').hidden = !value;
  $('cancelSaveButton').disabled = false;
  $('clipDialog').setAttribute('aria-busy', String(value));
}

const settings = readSettings();

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
  const next = Math.min(60, Math.max(1, Number(seconds) || 20));
  if (persist && !saveSettings({ delaySeconds: next })) {
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
    frameBuffer.add({ time: now, blob });
  } catch {
    if (generation === captureGeneration) interruptCamera('카메라 영상을 읽지 못했어요. 촬영을 다시 시작해 주세요.');
  } finally {
    if (generation === captureGeneration) captureBusy = false;
  }
}

async function drawDelayedFrame(now = captureNow()) {
  if (!cameraStream || drawBusy || !frameHistory.length) return;
  const targetTime = now - delaySeconds * 1000;
  if (frameHistory[0].time > targetTime) {
    $('previewWrap').classList.remove('has-video');
    $('previewEmpty').removeAttribute('aria-hidden');
    $('previewEmpty').querySelector('strong').textContent = `지연 영상 준비 중 · ${Math.ceil((frameHistory[0].time - targetTime) / 1000)}초`;
    $('previewEmpty').querySelector('span:last-child').textContent = '설정한 시간만큼 영상이 모이면 자동으로 재생돼요';
    lastDrawnFrame = 0;
    return;
  }
  const frame = closestFrame(targetTime);
  if (!frame || frame.time === lastDrawnFrame) return;
  drawBusy = true;
  const generation = captureGeneration;
  const success = await drawFrameToCanvas(frame, previewCanvas, previewContext, () => generation === captureGeneration && Boolean(cameraStream));
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
    captureBusy = false;
    captureLoop = true;
    for (const track of stream.getVideoTracks()) {
      const lost = () => { if (generation === captureGeneration) interruptCamera('카메라 연결이 끊겼어요. 촬영을 다시 시작해 주세요.'); };
      track.addEventListener('ended', lost, { once: true });
      track.addEventListener('mute', lost, { once: true });
    }
    captureTick(generation);
    requestScreenLock(generation);
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
  const end = (clipSelectionOpenedAt || captureNow()) - selectedEndOffset * 1000;
  return Timeline.select(selectionSnapshot, end, selectedLengthSeconds);
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
    const offset = (performance.now() - startedAt) % (selectedLengthSeconds * 1000);
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

function updateClipRangeLabels() {
  if (saving) return;
  selectedLengthSeconds = Number($('clipLength').value || 15);
  const availableSeconds = Math.floor((clipSelectionOpenedAt - (selectionSnapshot[0]?.time ?? clipSelectionOpenedAt)) / 1000);
  const maxOffset = Math.max(0, Math.min(300, availableSeconds - selectedLengthSeconds));
  $('clipOffset').max = String(maxOffset);
  if (Number($('clipOffset').value) > maxOffset) $('clipOffset').value = String(maxOffset);
  selectedEndOffset = Number($('clipOffset').value || 0);
  $('clipOffsetValue').textContent = selectedEndOffset === 0 ? '선택 창을 연 시점' : `선택 창을 연 시점에서 ${selectedEndOffset}초 전`;
  $('clipLengthValue').textContent = `${selectedLengthSeconds}초`;
  const selection = getSelection();
  const clock = value => new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(value);
  $('clipSelectionTime').textContent = selection.valid ? `${clock(selection.start)} ~ ${clock(selection.end)} · ${selectedLengthSeconds}초 구간 고정` : selection.reason;
  $('saveClipButton').disabled = !selection.valid;
  $('clipError').textContent = '';
  previewSelection();
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
  if (frameBuffer.duration < 5000) return showToast('최소 5초의 영상이 모이면 장면을 고를 수 있어요.');
  const available = Math.floor((captureNow() - (frameHistory[0]?.time ?? captureNow())) / 1000);
  $('clipOffset').max = String(Math.max(0, Math.min(300, available - 15)));
  $('clipOffset').value = '0';
  $('clipLength').value = '15';
  clipSelectionOpenedAt = frameHistory.at(-1)?.time || captureNow();
  selectionSnapshot = frameBuffer.snapshot();
  setStudioState('selecting');
  $('studentName').value = '';
  $('studentNumber').value = '';
  $('saveProgress').textContent = '';
  $('clipError').textContent = '';
  $('cancelSaveButton').hidden = true;
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
  return value;
}

async function exportSelection(frames, durationSeconds, signal) {
  const start = clipSelectionOpenedAt - selectedEndOffset * 1000 - durationSeconds * 1000;
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
    const metadata = await encryptMetadata({ studentName: name, studentNumber: number }, saveKey);
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
      updateClipRangeLabels();
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
  showTeacherTab('settings'); updateClipCount(); refreshStorageInfo();
}

function showTeacherTab(panel) {
  if (!teacherUnlocked) return;
  document.querySelectorAll('.teacher-tab').forEach(tab => tab.classList.toggle('is-active', tab.dataset.panel === panel));
  $('settingsPanel').hidden = panel !== 'settings'; $('libraryPanel').hidden = panel !== 'library';
  $('teacherContentTitle').textContent = panel === 'settings' ? '수업 설정' : '저장한 클립';
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
    await repository.delete(id, vaultConfig?.revision);
    if (token !== teacherGeneration || !teacherUnlocked) return;
    selectedDeleteId = null; $('deleteDialog').close(); await loadLibrary(); refreshStorageInfo();
  } catch { if (token === teacherGeneration) $('deleteMessage').textContent = '삭제하지 못했어요. 다시 시도해 주세요.'; }
  finally { deleting = false; $('confirmDeleteButton').disabled = false; $('cancelDeleteButton').disabled = false; }
}

function clearLibraryMedia() {
  mediaGeneration++;
  document.querySelectorAll('.library-video').forEach(video => { video.pause(); video.removeAttribute('src'); video.load(); video.remove(); });
  libraryObjectUrls.forEach(url => URL.revokeObjectURL(url)); libraryObjectUrls = [];
}

function clearLibraryPreviewUrls() {
  libraryGeneration++; clearLibraryMedia(); libraryRows.clear(); $('libraryList').replaceChildren();
  $('libraryStatus').textContent = ''; $('libraryRetryButton').hidden = true; $('emptyLibrary').hidden = true;
}

function closeTeacherAccess() {
  teacherGeneration++; pinController?.abort(); pinController = null;
  teacherUnlocked = false; pinBusy = false; clearPinInputs(); clearLibraryPreviewUrls();
  selectedDeleteId = null; if ($('deleteDialog').open) $('deleteDialog').close();
  $('teacherMessage').textContent = '';
}

function lockTeacherDialog() {
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
  stopCamera(); clearLibraryPreviewUrls();
  try {
    const candidate = await LocalVault.create(pin);
    await repository.reset(candidate.config);
    vaultConfig = candidate.config; vaultProblem = ''; teacherKey = candidate.key;
    saveSettings({ delaySeconds });
    for (const field of ['pinSalt', 'pinCheckIv', 'pinCheck', 'pinKdfIterations']) delete settings[field];
    $('resetDialog').close(); await updateClipCount();
    try { vaultChannel?.postMessage({ revision: vaultConfig.revision }); } catch {}
    try { localStorage.setItem('pe-loop-vault-revision', vaultConfig.revision); } catch {}
    showToast('모든 클립을 삭제하고 새 PIN을 설정했어요.');
  } catch { $('resetMessage').textContent = '초기화를 완료하지 못했어요. 저장소의 클립과 PIN은 함께 유지돼요. 다시 시도해 주세요.'; }
  finally { resetting = false; $('cancelResetButton').disabled = false; updateResetReady(); }
}

async function syncVaultRevision() {
  try {
    const current = await repository.config();
    if (vaultConfig?.revision === current?.revision) return;
    closeTeacherAccess(); if ($('teacherDialog').open) $('teacherDialog').close();
    stopCamera(); vaultConfig = current; vaultProblem = current ? '' : 'PIN 설정을 다시 확인해 주세요.';
    showCameraNotice('다른 탭에서 PIN 설정이 바뀌었어요. 새 PIN으로 다시 열어 주세요.');
  } catch { /* A guarded write still rejects stale revisions. */ }
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('./sw.js').catch(() => showToast('오프라인 저장을 설정하지 못했어요.'));
  }
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
  $('cameraButton').addEventListener('click', () => cameraStream ? stopCamera() : startCamera());
  $('openClipButton').addEventListener('click', openClipDialog);
  $('clipOffset').addEventListener('input', updateClipRangeLabels);
  $('clipLength').addEventListener('input', updateClipRangeLabels);
  $('saveClipButton').addEventListener('click', saveSelectedClip);
  $('cancelSaveButton').addEventListener('click', () => cancelActiveSave('user'));
  $('teacherButton').addEventListener('click', showTeacherDialog);
  $('createPinButton').addEventListener('click', createTeacherPin);
  $('unlockButton').addEventListener('click', unlockTeacher);
  $('newPin').addEventListener('keydown', (event) => { if (event.key === 'Enter') $('confirmPin').focus(); });
  $('confirmPin').addEventListener('keydown', (event) => { if (event.key === 'Enter') createTeacherPin(); });
  $('unlockPin').addEventListener('keydown', (event) => { if (event.key === 'Enter') unlockTeacher(); });
  $('teacherDelay').addEventListener('input', (event) => setDelay(event.target.value));
  $('teacherLockButton').addEventListener('click', lockTeacherDialog);
  document.querySelectorAll('.teacher-tab').forEach((tab) => tab.addEventListener('click', () => showTeacherTab(tab.dataset.panel)));
  $('cancelDeleteButton').addEventListener('click', () => { selectedDeleteId = null; $('deleteDialog').close(); });
  $('deleteDialog').addEventListener('cancel', event => { if (deleting) event.preventDefault(); else selectedDeleteId = null; });
  $('confirmDeleteButton').addEventListener('click', deleteClip);
  $('clipDialog').addEventListener('cancel', event => { if (saving) event.preventDefault(); });
  $('clipDialog').addEventListener('close', () => {
    previewClipLoop = false; previewClipToken += 1; selectionSnapshot = [];
    if (!saving) setStudioState(restingState());
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
    if (document.hidden) { if ($('teacherDialog').open) { closeTeacherAccess(); $('teacherDialog').close(); } cancelActiveSave('interrupted'); interruptCamera('앱이 화면에서 벗어나 촬영을 멈췄어요. 돌아온 뒤 다시 시작해 주세요.'); }
    else { syncVaultRevision(); refreshRetention(); }
  });
  window.addEventListener('pagehide', () => stopCamera());
}

function runLoops() {
  setInterval(() => {
    drawDelayedFrame();
    updateHistoryUi();
  }, 100);
  setInterval(refreshRetention, 60 * 60 * 1000);
}

async function init() {
  setDelay(settings.delaySeconds || 20, { persist: false });
  $('cameraButton').disabled = true; $('teacherButton').disabled = true;
  wireEvents(); setupInstallPrompt(); registerServiceWorker(); runLoops();
  try {
    vaultConfig = await repository.config();
    if (!vaultConfig && LocalVault.validConfig(settings)) {
      const migrated = { pinSalt: settings.pinSalt, pinCheckIv: settings.pinCheckIv, pinCheck: settings.pinCheck, pinKdfIterations: 250000, revision: crypto.randomUUID() };
      vaultConfig = await repository.initialize(migrated, { legacy: true });
    }
    if (vaultConfig) {
      if (!LocalVault.validConfig(vaultConfig) || typeof vaultConfig.revision !== 'string' || !vaultConfig.revision) vaultProblem = 'PIN 설정이 손상됐어요. 초기화 안내를 확인해 주세요.';
      for (const field of ['pinSalt', 'pinCheckIv', 'pinCheck', 'pinKdfIterations']) delete settings[field];
      saveSettings({ delaySeconds });
    } else if (await repository.count()) vaultProblem = '기존 클립의 PIN 설정을 찾을 수 없어요. 초기화 안내를 확인해 주세요.';
    await refreshRetention();
  } catch (error) { vaultProblem = friendlyFailure(error, '로컬 저장소를 열지 못했어요. 다른 탭과 저장 공간을 확인해 주세요.'); showCameraNotice(vaultProblem); }
  finally { appReady = true; setStudioState(restingState()); }
}

init();
