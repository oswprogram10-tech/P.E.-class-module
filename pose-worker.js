/* Classic worker: MediaPipe's verified WASM loader uses importScripts. */
'use strict';
let landmarker = null;
const objectUrls = [];
function url(bytes, type) { const value = URL.createObjectURL(new Blob([bytes], { type })); objectUrls.push(value); return value; }
async function initialize(assets) {
  const sdk = await import(url(assets.sdk, 'text/javascript'));
  const files = { wasmLoaderPath: url(assets.loader, 'text/javascript'), wasmBinaryPath: url(assets.wasm, 'application/wasm') };
  landmarker = await sdk.PoseLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetBuffer: new Uint8Array(assets.model), delegate: 'CPU' },
    runningMode: 'VIDEO', numPoses: 1,
    minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5
  });
}
self.onmessage = async event => {
  const m = event.data;
  try {
    if (m.type === 'init') { await initialize(m.assets); self.postMessage({ type: 'ready' }); }
    else if (m.type === 'frame') {
      const start = performance.now();
      try {
        if (!landmarker) throw new Error('포즈 모델이 준비되지 않았어요.');
        const result = landmarker.detectForVideo(m.bitmap, m.timestamp);
        self.postMessage({ type: 'result', timestamp: m.timestamp, width: m.bitmap.width, height: m.bitmap.height, latencyMs: performance.now() - start, landmarks: result.landmarks, worldLandmarks: result.worldLandmarks });
      } finally { m.bitmap.close(); }
    } else if (m.type === 'close') { landmarker?.close(); landmarker = null; for (const value of objectUrls) URL.revokeObjectURL(value); self.close(); }
  } catch (error) { self.postMessage({ type: 'error', message: String(error?.message || error), frame: m.type === 'frame' }); }
};
