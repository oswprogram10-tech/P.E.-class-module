// Increment this version whenever any app-shell resource changes.
const CACHE_NAME = 'pe-loop-shell-v58';
const APP_SHELL = ['./', './index.html', './styles.css', './app.js', './pose-assets.js', './model-profiles.js', './volleyball-cue.js', './pose-runtime.js', './pose-presence.js', './basketball-shot.js', './shot-feedback.js', './shot-history.js', './shot-history-ui.js', './pose-ui.js', './pose-worker.js', './classroom-model.js', './paps-criteria-data.js', './paps-criteria.js', './paps-bmi-criteria-data.js', './paps-bmi-criteria.js', './paps-program-selection.js', './paps-reports.js', './pe-curriculum.js', './teacher-evaluations.js', './exercise-routines.js', './gps-missions.js', './qr-missions.js', './tactics-board.js', './tactics-sharing.js', './tactics-search-local.js', './tactics-team-request.js', './tactics-local-prompt.js', './tactics-local-advisor.js', './tactics-student-ui.js', './vendor/wllama-v3/index.js', './vendor/wllama-v3/wasm/wllama.wasm', './vendor/wllama-v3/compat/wllama.js', './vendor/wllama-v3/compat/wllama.wasm', './vendor/hf-tokenizers/tokenizers.mjs', './vendor/qwen-tokenizer/tokenizer.json', './vendor/qwen-tokenizer/tokenizer_config.json', './vendor/noble-hashes/sha256.js', './vendor/noble-hashes/_md.js', './vendor/noble-hashes/_assert.js', './vendor/noble-hashes/utils.js', './vendor/noble-hashes/crypto.js', './tactics-tools-ui.js', './wearable-bridge.js', './classroom-tools-ui.js', './classroom-repository.js', './classroom-sync.js', './classroom-ui.js', './qrcode-generator.js', './local-vault.js', './clip-repository.js', './webm-muxer.js', './clip-exporter.js', './timeline.js', './frame-buffer.js', './device-check.js', './device-check-ui.js', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png'];
const shellUrls = new Set(APP_SHELL.map(path => new URL(path, self.registration.scope).href));

self.addEventListener('install', event => {
  // A failed or partial download must never replace the working version.
  event.waitUntil(caches.open(CACHE_NAME).then(cache =>
    cache.addAll(APP_SHELL.map(path => new Request(path, { cache: 'reload' })))
  ));
});

self.addEventListener('activate', event => {
  // Natural activation waits until the old worker has no controlled clients.
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith('pe-loop-shell-') && key !== CACHE_NAME)
    .map(key => caches.delete(key)))));
});

self.addEventListener('message', event => {
  if (event.data?.type === 'CHECK_SHELL' && event.ports[0]) {
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE_NAME);
      const entries = await Promise.all(APP_SHELL.map(path => cache.match(path)));
      event.ports[0].postMessage({ ready: entries.every(response => response?.ok) });
    })());
    return;
  }
  if (event.data?.type !== 'APPLY_UPDATE' || !event.source?.id || !event.ports[0]) return;
  event.ports[0].postMessage({ ok: false, reason: 'close-to-update' });
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  const scopeUrl = new URL(self.registration.scope);
  const isAppNavigation = request.mode === 'navigate' &&
    (url.pathname === scopeUrl.pathname || url.pathname === new URL('index.html', scopeUrl).pathname);
  if (!isAppNavigation && !shellUrls.has(url.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(isAppNavigation ? new URL('index.html', self.registration.scope).href : request);
    // Never fill a missing shell asset from a different deployment version.
    return cached || Response.error();
  })());
});
