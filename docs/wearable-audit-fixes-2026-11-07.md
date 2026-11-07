# 웨어러블 검증 결함 수정 — 2026-11-07

[검증 보고서](validation-2026-11-07-audit.md)의 5개 항목에 대한 소스 수정을 적용했다. 후속으로 Android debug APK 빌드와 JVM 검사는 통과했지만 실물 LAN 연결은 아직 검증하지 않았다.

| 항목 | 수정 |
| --- | --- |
| 없는 종료 상수 | Java-WebSocket의 실제 `GOING_AWAY` 상수 사용 |
| 네이티브 이벤트 포맷 | `BridgeMessages`에서 `{type:"event",listenerId,event}`로 감싸 JS 구독 규격과 일치시킴 |
| WebView 스레드 | 응답과 이벤트 모두 메인 Looper의 Handler로 전송. 종료 후 대기 메시지 및 취소한 구독 이벤트 차단 |
| 공백 구간 재표시 | JS는 복구 시점보다 이전인 표본을 거부하고 수신 시각의 증가 조건을 공백 후에도 보존. 네이티브는 인증 시점의 최소 표본 시각과 마지막 허용 표본 시각을 검사하며 기기 준비 이벤트로 이력을 초기화하지 않음 |
| IP 재바인딩 실패 | 새 주소는 수신기 시작 성공 뒤 확정. 실패 시 재바인딩 필요 상태와 port=0을 유지해 인증을 막고, 2초 뒤 직렬 네트워크 작업 큐에서 재시도. 세션 종료 후 재시도 차단 |

후속 Android Lint에서 발견한 API 26 스타일/선택 카메라 기능 오류를 수정했다. WebView 서비스 워커와 메시지 브리지 기능을 실행 전에 검사하고, 백업을 클라우드·기기 전송에서 제외했으며, 앱 아이콘을 지정했다. Wi-Fi 주소 조회는 deprecated 네트워크 열거 대신 연결 콜백과 활성 네트워크를 사용한다.

PWA 셸 캐시는 v23으로 올려 수정된 JS가 갱신되도록 했다. 게시하지 않았다.

## 검증

- `node --test tests/*.test.cjs`: 125개 통과.
- `node tests/browser-wearable-bridge.cjs`: 통과.
- `node tests/browser-classroom-tools.cjs`: 통과.
- `node tests/browser-pwa.cjs`: 오프라인 재실행·암호화 데이터 보존·새 버전 대기/적용·설치 실패 검사 통과.
- 웨어러블 복구 단위 검사에서 2초 공백 중에 측정된 최근 표본도 거부하고, 복구 후 새 표본만 표시함을 확인했다.
- Android `BridgeMessagesTest`를 추가해 실제 네이티브 송신 코드의 이벤트 래퍼를 검사하도록 했다. 후속 임시 Gradle 8.10.2/Kotlin 2.0.21 하네스에서 Android Kotlin 소스 전체와 이 JVM 테스트 1개가 통과했다.
- 사용자 승인 뒤 Android SDK Platform 35/Build Tools 35.0.0을 임시 경로에 설치하고 `:app:testDebugUnitTest :app:assembleDebug :app:lintDebug`를 실행했다. 세 검사 모두 성공했고 `BridgeMessagesTest` 1/1, Lint 0 오류·0 경고, APK v2 서명, WebView/PWA 자산 패키징을 확인했다.
- Java-WebSocket 소스의 상수 목록 대조와 `git diff --check`를 수행했다.

## 남은 확인

실제 APK 설치·실행, UI 스레드 런타임 동작, 소켓 바인딩 실패 주입 및 실물 Wi-Fi 복구 검증은 남아 있다. 학생 companion/워치 앱도 아직 없어 자동 재접속 종단 간 동작은 미검증이다. APK 빌드와 JVM 검사를 실기기 동작 통과로 해석하지 않는다.
