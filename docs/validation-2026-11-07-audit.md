# 2026-11-07 현재 구현 검증

후속 상태: 아래 결함은 발견 당시의 기록이다. 사용자 수정 요청에 따른 적용 내용과 현재 검증 한계는 [수정 기록](wearable-audit-fixes-2026-11-07.md)을 따른다.

웹앱 자동 회귀는 통과했지만 Android 태블릿 호스트는 실행 준비가 끝난 상태가 아니다. 아래 결함은 기존 가짜 브리지 검사로 잡히지 않았다. 이번 요청은 검증으로 수행했으며 제품 소스 수정·게시·commit·push는 하지 않았다.

## 실행 결과

| 검사 | 결과 | 증거 범위 |
| --- | --- | --- |
| `node --test tests/*.test.cjs` | 125/125 통과 | 모델·보관·암호화·PAPS·수업 도구·웨어러블 JS 등 |
| Chromium 브라우저 스크립트 | 31/31 통과 | 아래 목록. Linux Chromium·가상 카메라·테스트 브리지 |
| 앱/서버 JavaScript 문법 | 34개 파일 통과 | `node --check` |
| Android XML 및 패키지 자산 | XML 파싱 통과, index 참조 자산 누락 없음 | Android 빌드·설치 검증을 대신하지 않음 |
| `git diff --check` | 통과 | 추적 파일 공백 검사 |
| Android 네이티브 | 소스 검토, 전체 빌드 미실행 | Gradle·Kotlin compiler·Android SDK/ADB가 없음 |

브라우저 검사는 `browser-helper.cjs`(도우미)와 `browser-long-delay.cjs`(실시간 310초 검사)를 제외한 모든 `browser-*.cjs`를 각각 별도 프로세스로 실행했다. 1·20·60초 지연 재생 검사는 포함했다. 학교 현장·발열·실제 40분 연속 사용과 실물 워치는 검증하지 않았다. 포즈 실제 모델 검사 역시 테스트 이미지/가상 카메라에 대한 결과이며 종목 정확도 시험을 뜻하지 않는다.

## 발견한 결함

### 1. P1 — Android 호스트의 존재하지 않는 상수 참조

[WearableRelayManager.kt](../native/android/app/src/main/java/com/peloop/wearablerelay/WearableRelayManager.kt)의 `rebindIfWifiAddressChanged()`(324행)가 `CloseFrame.ABNORMAL`을 참조한다. 의존성 Java-WebSocket 1.5.7의 실제 `CloseFrame.java`에는 이 상수가 없으며 `ABNORMAL_CLOSE`가 정의되어 있다. 현재 소스는 해당 참조 때문에 컴파일되지 않는다. 라이브러리 배포 소스를 대조해 확인했으며 Android 전체 빌드 결과로 보고하는 것은 아니다.

조치: 의도한 소켓 종료 방식에 맞는 실제 라이브러리 API를 사용하고 Android 컴파일 검사를 추가한다.

### 2. P1 — 실제 네이티브 이벤트가 웹 구독자에게 전달되지 않음

[NativeWearableBridge.kt](../native/android/app/src/main/java/com/peloop/wearablerelay/NativeWearableBridge.kt)(17~20행)는 `{type:"sample",sessionId:..., ...}` 형태의 이벤트를 그대로 전송한다. 반면 [wearable-bridge.js](../wearable-bridge.js)(74~82행)는 `{type:"event",listenerId:...,event:{...}}` 형식만 구독 이벤트로 인식한다. 실제 호스트가 전송한 이벤트에는 요청 `id`도 없어 후속 응답 경로에서도 버려진다. 심박수·연결 상태·권한 철회·만료가 모두 영향을 받는다.

현재 JS 어댑터에 실제 네이티브 형식과 기대 형식을 차례로 넣어 재현했다. 실제 형식은 콜백 0회, 감싼 형식은 1회 실행된다. 기존 테스트는 처음부터 기대 형식의 가짜 호스트를 사용해 통과했다.

조치: 네이티브 이벤트를 구독 ID와 함께 감싸고 실제 송신 포맷을 사용하는 경계 검사를 추가한다.

### 3. P2 — WebView 응답의 UI 스레드 요구사항 위반

[NativeWearableBridge.kt](../native/android/app/src/main/java/com/peloop/wearablerelay/NativeWearableBridge.kt)의 작업 스레드(33행)와 WebSocket 이벤트 콜백이 `JavaScriptReplyProxy.postMessage()`를 직접 호출한다(19·97행). AndroidX WebKit 1.12.1의 배포 소스는 `JavaScriptReplyProxy` 클래스에 `@UiThread`를 지정하고 “UI thread not currently enforced, but required”라고 명시한다. 현재 구현은 이 요구사항을 따르지 않는다. 기기에서 발생하는 구체적인 예외는 아직 재현하지 않았다.

조치: 응답과 이벤트 전송을 메인 Looper에 전달하고 종료·구독 취소 후 대기 이벤트도 걸러낸다.

### 4. P2 — 재접속 뒤 단절 구간 표본을 다시 표시할 수 있음

[wearable-bridge.js](../wearable-bridge.js)의 단절 처리(132~135행)는 마지막 시각을 지우고, 재접속 뒤에는 일반적인 5초 신선도 조건만 적용한다(164~168행). 호스트 역시 인증/기기 준비 시 마지막 시각을 초기화하며 재접속 시점보다 뒤의 표본인지 검사하지 않는다. 2초 단절 뒤, 단절 도중 측정된 1초 전 표본을 넣었더니 현재 심박수로 표시되어 공백이 닫혔다.

companion이 큐를 만들지 않는 설계는 있으나 수신 경계에서 “단절 구간 값을 채우지 않는다”는 규칙을 강제하지 못한다.

조치: 재접속 기준 시각 또는 새로운 측정 epoch를 정하고 단절 중/이전 표본과 중복 표본을 거부한다.

### 5. P2 — 새 Wi-Fi 주소 바인딩 실패 후 자동 복구 경로가 멈춤

[WearableRelayManager.kt](../native/android/app/src/main/java/com/peloop/wearablerelay/WearableRelayManager.kt)의 재바인딩(306~340행)은 새 서버 시작 전 `session.address`를 새 주소로, `port`를 0으로 바꾼다. 시작이 실패하면 단절 이벤트만 보내며 주소/포트/서버 상태를 복구하지 않는다. 다음 네트워크 알림이 같은 IP를 보고하면 주소가 같다는 이유로 재시도를 건너뛴다. 수신기와 DNS-SD 광고가 없는 상태에서 UI는 복구를 계속 기다릴 수 있다. 이는 소스 제어 흐름으로 확인했으며 Android 장애 주입 시험은 미실행이다.

조치: 성공 후 엔드포인트 상태를 확정하고, 실패 상태에서 같은 주소라도 다시 바인딩하거나 새 QR 안내로 전환한다.

## 브라우저 실행 목록

`buffer-limits`, `camera`, `classroom-capture`, `classroom-flow`, `classroom-measurements`, `classroom-privacy`, `classroom-reset`, `classroom-tools`, `clips`, `data`, `delay`, `feedback-real`, `layout`, `paps-reports`, `pose-capture`, `pose-real`, `pose-runtime`, `pose-ui`, `pwa`, `reference`, `reflection`, `reset`, `review`, `shot-feedback`, `shot-history-failures`, `shot-history`, `shot-ui`, `smoke`, `sport-extension`, `vault-migration`, `wearable-bridge`.

## 남은 검증 범위

학생 Android/iOS companion 및 Wear OS/watchOS 앱이 아직 없으므로 QR 스캔→TLS 지문 확인→DNS-SD 발견→워치 심박 수신→휴대폰 자동 재접속의 종단 간 검사는 실행할 수 없다. 학생/보호자 동의는 현재 교사가 확인하는 화면 게이트이며 실제 동의 문서 관리·증빙 시스템을 뜻하지 않는다.

다음 우선순위는 위 네이티브 연결 결함 수정, Android 실제 빌드, 실제 네이티브 송신 경계 검사, companion 구현 후 LAN 장애/복구 시험이다. 이번 회귀 결과만으로 워치 지원 완료나 현장 운영 가능을 선언할 수 없다.
