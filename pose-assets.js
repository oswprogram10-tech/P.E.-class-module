/* SHA-256 pins are produced from the verified official npm package and official model. */
(function (root) {
  'use strict';
  const api = Object.freeze({
    version: 'mediapipe-tasks-vision-0.10.21-pose-lite-v1',
    files: Object.freeze([
      { name: 'sdk', url: './vendor/pose/vision_bundle.mjs', sha256: '40f4123dfcd75cfa58add046919cc6f52fde66f009ff582997c09ba54c6ba27c' },
      { name: 'loader', url: './vendor/pose/vision_wasm_nosimd_internal.js', sha256: '927def7b465c51b86e4b3060f93646aca4e27121f4b8fc0483786e407ea9cf1f' },
      { name: 'wasm', url: './vendor/pose/vision_wasm_nosimd_internal.wasm', sha256: '3821ea9b1f7fb8c549ef2a064ef5c85750bf375c545a49fd6eea0df44a95f1f4' },
      { name: 'model', url: './vendor/pose/pose_landmarker_lite.task', sha256: '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a' }
    ])
  });
  if (typeof module !== 'undefined') module.exports = api; else root.PoseAssets = api;
})(globalThis);
