// 앱 셸만 버전별 캐시에 보관한다. 영상·학생 정보·PIN·암호화 키는 캐시하지 않는다.
const CACHE_PREFIX = 'pe-loop-shell-';
const CACHE_VERSION = 'v6';
const CACHE_NAME = `${CACHE_PREFIX}${CACHE_VERSION}`;
const NAVIGATION_FALLBACK = './index.html';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './local-vault.js',
  './clip-repository.js',
  './webm-muxer.js',
  './clip-exporter.js',
  './timeline.js',
  './frame-buffer.js',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
];

const OFFLINE_HTML = `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <title>PE Loop · 오프라인</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; box-sizing: border-box; background: #f4f4ef; color: #1d2723; font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Noto Sans KR', sans-serif; }
      main { width: min(440px, 100%); background: #fff; border: 1px solid #dfe4dc; border-radius: 20px; padding: 28px; box-shadow: 0 12px 40px rgba(35,52,41,.06); }
      h1 { margin: 0 0 10px; font-size: 24px; line-height: 1.3; }
      p { margin: 0 0 20px; font-size: 15px; line-height: 1.65; color: #59645c; }
      button { width: 100%; min-height: 52px; border: 0; border-radius: 12px; background: #b8f05a; color: #243428; font: inherit; font-weight: 800; cursor: pointer; }
    </style>
  </head>
  <body>
    <main>
      <h1>앱 화면을 불러오지 못했어요.</h1>
      <p>인터넷 연결을 확인하고 다시 시도해 주세요. 이미 설치한 앱이라면 앱을 완전히 닫았다 다시 열어 보세요. 기기에 저장한 클립과 PIN 설정은 이 화면에서 삭제되지 않아요.</p>
      <button type="button" onclick="location.reload()">다시 시도</button>
    </main>
  </body>
</html>`;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      // 모든 앱 셸 파일이 준비되어야 설치가 성공한다. 부분 캐시는 남기지 않는다.
      await cache.addAll(APP_SHELL);
    } catch (error) {
      await caches.delete(CACHE_NAME);
      throw error;
    }
    // 새 worker를 즉시 활성화하지 않는다. 열린 수업 화면은 브라우저의 기본 대기 수명주기를 따른다.
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
        .map((key) => caches.delete(key)),
    );
    // clients.claim()을 호출하지 않는다. 기존 페이지를 새 버전으로 강제 전환하지 않는다.
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(NAVIGATION_FALLBACK);
      if (cached) return cached;
      try {
        return await fetch(request);
      } catch {
        return new Response(OFFLINE_HTML, {
          status: 503,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
    try {
      // 버전 캐시에 없는 응답을 즉석에서 섞지 않는다. HTML·JS 혼합 버전 실행을 막기 위해서다.
      return await fetch(request);
    } catch {
      return Response.error();
    }
  })());
});
