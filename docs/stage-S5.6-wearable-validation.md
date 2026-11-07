# S5.6 웨어러블 브리지 및 Android 호스트 검증

기록일: 2026-11-07. 사용자 승인 후 Android API 35 debug APK 빌드, JVM 검사, Lint(0 오류·0 경고), APK v2 서명 검증을 통과했다. 실제 Galaxy Watch/Apple Watch 및 태블릿 실행은 아직 하지 않았다.

## 구현 범위

- 2026-11-07 기준 출시일 하한은 2022-11-07이다. 학생 companion이 보낸 플랫폼(`galaxy-watch` 또는 `apple-watch`), 모델, 출시일, 심박수 기능 표시를 PWA 브리지에서 검사한다. 이 메타데이터 검사만으로 실제 제조사 API 호환 모델을 확정하지는 않는다.
- 단일 수업 세션의 초기 데이터는 심박수(bpm)와 시각뿐이다. 학생·학급 ID를 네이티브 브리지에 넘기지 않고 임시 무작위 참가자 토큰만 보낸다.
- 학생 본인, 보호자, 수집 항목(심박수)의 동의가 모두 확인되어야 한다. OS 심박 권한은 학생 페어링 휴대폰 앱이 처리한다. 동의 체크는 매 화면/수업 세션에서 다시 받아 PIN 저장소에 기록하지 않는다. 실제 동의 문서와 보관·증명 방식은 학교가 별도로 관리한다.
- 측정값과 기기 메타데이터는 화면 세션 메모리에만 둔다. PIN 암호화 클래스 상태, 허브, CSV, 네트워크로 저장하거나 보내지 않는다. 측정 종료, 동의 철회, PIN 잠금, 페이지 이탈 시 화면 값을 지운다.
- 워치 연결이 끊기면 값을 숨기고 공백을 표시하며 교사가 다시 연결한다. Wi-Fi 단절은 같은 주소가 돌아올 때 휴대폰이 임시 재접속 자격으로 자동 복구하도록 정했다. 복구 때도 이전 값을 되살리지 않고 새 워치 준비 정보와 새 표본을 기다린다. PWA와 태블릿 호스트 소스에 이벤트/자격 경로가 있지만 휴대폰 앱은 아직 없어 종단 간 자동 재접속은 미구현이다. 5초 동안 새 표본이 오지 않아도 값을 숨긴다.
- 심박 데이터 권한 거부 시 측정값과 기록은 비워 두고, 수업은 계속한다. 일반 수업 UI와 측정 기능은 분리되어 있다.
- `native/android/`에 Android 태블릿 앱을 추가했다. 현재 포함 기능은 AndroidX `WebViewAssetLoader` PWA 셸, 출처 제한 Web Message 브리지, 학생별 한 세션의 TLS 1.2 WebSocket 수신기, 2분·1회용 티켓, RAM 전용 재접속 자격, Wi-Fi 주소 변경 시 수신기 재바인딩과 DNS-SD 재광고, 심박 표본 검증이다. Android API 35 debug APK 빌드는 통과했지만 APK 설치와 기기 실행은 아직 검증하지 않았다. 백업은 클라우드와 기기 전송 경로 모두에서 제외한다. 학생 Android/Wear OS 및 iOS/watchOS companion 앱은 아직 없다.
- 일반 브라우저/PWA에는 네이티브 브리지가 없으므로 웨어러블 연결 버튼은 비활성화된다. 가상 v2 호스트는 QR 초대, 워치 준비 이벤트, 심박 표본, 휴대폰 권한 불가 이벤트를 흉내 낸다.

## 검사 근거

- `node tests/wearable-bridge.test.cjs` — 15개 단위 사례 통과: 출시일 경계, 사설 LAN/일회성 QR 형식, 동의 게이트와 철회, 익명 토큰, 휴대폰 권한 실패, 초대 만료, Web Message 어댑터, 워치 연결 공백/교사 QR 재연결, 로컬 Wi-Fi 단절 뒤 값 숨김과 새 표본만 재개, 오래되거나 잘못된 표본, stale 처리, 종료·권한 철회.
- `node tests/browser-wearable-bridge.cjs` — 가짜 v2 호스트로 동의 게이트, 초대 QR, 심박 화면, 워치 끊김 뒤 공백·교사 QR 재연결, 재연결 실패 뒤 세션 종료, Wi-Fi 단절 뒤 자동 복구 이벤트와 새 값 전까지 공백 유지, 권한 불가 시 빈 기록, PIN 잠금 종료와 저장소 비기록을 확인했다.
- `node tests/browser-classroom-tools.cjs` — 교사 도구 브라우저 회귀 통과.
- `git diff --check` 통과. 두 Chromium 테스트는 loopback 서버를 열도록 허가된 권한으로 수행했다.
- 2026-11-07 후속 검사에서 `/tmp` 임시 Gradle 8.10.2/Kotlin 2.0.21 하네스를 구성하고, Android API 35 `android-all` 및 현재 AndroidX/WebSocket 의존성으로 Android 앱 Kotlin 소스 전체를 컴파일했다. `BridgeMessagesTest` 1개도 통과했다. 이는 API/라이브러리 경계의 Kotlin 소스 컴파일 증거다.
- 사용자가 허락한 뒤 `/tmp`에 Android SDK Platform 35와 Build Tools 35.0.0을 설치하고 Google SDK 라이선스를 수락했다. Gradle 8.10.2, AGP 8.8.2, Kotlin 2.0.21, JDK 21 조합으로 실제 `:app:testDebugUnitTest :app:assembleDebug :app:lintDebug`가 성공했다. JVM 단위 검사 1/1 통과, Lint 0 오류·0 경고, APK 리소스·manifest 병합, D8, 패키징 및 서명을 확인했다.
- Lint에서 확인한 API 27 스타일 속성과 선택 카메라 기능 선언, WebView 선택 기능 가드, 백업/기기 전송 제외 규칙, 런처 아이콘을 보정했다. Wi-Fi 주소 조회는 deprecated `allNetworks` 대신 활성/콜백 네트워크를 사용한다. PWA 실행에 필요한 JavaScript는 신뢰된 로컬 origin으로 제한한 상태에서만 켠다.
- 생성물 `native/android/app/build/outputs/apk/debug/app-debug.apk`: package `com.peloop.wearablerelay`, min API 26, target/compile API 35, APK Signature Scheme v2 검증 통과. `aapt`/ZIP 확인에서 `assets/index.html`, `assets/wearable-bridge.js`, 포즈 모델 파일, 런처 아이콘과 백업 제외 규칙 포함을 확인했다. SHA-256은 `595ed524b338ba4f827cb6c62e8f3e9fcef1c58210435386c7690dabd9f358e4`이다.
- APK 설치·실행, WebView 실제 동작, 소켓 바인딩 실패 주입, 실물 Wi-Fi 복구는 아직 확인하지 않았다. 이번 빌드로 APK는 준비됐지만 설치 가능성과 런타임 통합은 검증되지 않았다. SDK/Gradle 패키지는 `/tmp` 임시 경로에 설치했고 재사용 설정 초안은 저장하지 않았다.
- 가상 브리지 테스트는 제조사 앱/API, 실제 센서, 심박 정확도, 실제 모델 호환이나 Android 호스트와의 LAN 연결 증거가 아니다.

## 외부 조건과 다음 일

Apple HealthKit/WatchConnectivity, Wear OS Health Services, Samsung Health Sensor SDK의 API 경로와 권한·기기 범위는 [S5.6 공식 API 조사](stage-S5.6-vendor-api-research.md)에 기록했다. 사용자가 선택한 학생별 페어링 휴대폰 → 같은 로컬 Wi-Fi → Android 교사 태블릿 흐름, QR, TLS 공개키 지문 고정, 학생 식별자 제외, 메모리 전용 전달 규칙은 [LAN 릴레이 계약](S5.6-lan-relay-contract.md)에 있다.

남은 작업은 APK의 태블릿 설치·실행과 실연결, Android/iOS 학생 companion에서 임시 재접속 자격을 RAM에 보관하고 DNS-SD 탐색 및 자동 백오프 재시도를 수행하는 구현, 탐색 실패 후 새 QR 안내, 워치 앱, 모델별 출시일·최소 OS 표, 제조사 API 검증이다. Wi-Fi 단절 시 측정값 공백·수업 계속·휴대폰 자동 재연결 및 IP 변경 시 로컬 탐색 후 실패하면 QR 재요청은 사용자 선택으로 정했으나, 학생 companion이 없어 end-to-end 검증은 남아 있다. 학교 현장·발열·실제 40분 연속 시험은 앞선 지시에 따라 제외했다. 앱 코드를 게시하지 않았다.
