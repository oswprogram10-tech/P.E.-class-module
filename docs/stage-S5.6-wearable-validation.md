# S5.6 웨어러블 브리지 및 Android 호스트 검증

## 2026-11-17 후보 모델·OS 조건

- 공식 Apple 모델 식별 페이지의 8개 제품 섹션과 Swift 판매 모델 번호 44개가 각각 일치함을 대조했다. `WatchN,N`은 별도의 잠정 범위다. Swift/Xcode 실행·서명은 현재 Linux 환경에서 확인하지 않았다. [출처와 기기 표](S5.6-device-support-matrix.md)
- Galaxy 목록을 두 Android 앱이 공유한다. Watch8·9 계열, 정확한 지역 모델 코드, Watch 및 휴대폰 SDK 하한, 누락된 준비 응답 거부, FE LTE 보류를 호환 범위에 반영했다. 워치 SDK와 휴대폰 SDK는 해당 두 앱 사이에서 확인하며 태블릿 릴레이 필드는 유지했다.
- Node 자동 검사 218개, Chromium의 후보 표·동의·재접속 검사, 태블릿·학생 휴대폰·Wear OS 세 Android APK 빌드·Lint·서명 확인을 통과했다. Android 호스트 및 학생 휴대폰 JVM 검사 13개를 실행했다. Android·Apple 실기기, 학교 LAN 및 심박 센서는 미검증이다.

아래는 2026-11-07 초기 검증 기록이다.

기록일: 2026-11-07. Android SDK/API 35에서 태블릿 호스트·학생 휴대폰·Wear OS 앱을 구현하고, iPhone/Apple Watch Swift source scaffold를 추가했다. Android 세 debug APK를 조립하고 JVM 단위 검사 11건(호스트 1건·학생 휴대폰 10건), 세 모듈 Lint 0 오류·0 경고를 통과했다. Swift Package 테스트와 XcodeGen 프로젝트는 작성했으나 Swift/Xcode가 없는 Linux 환경이라 실행·프로젝트 생성하지 않았다. APK 설치·실제 Galaxy Watch/Apple Watch 및 태블릿 실행은 하지 않았다.

## 구현 범위

- 2026-11-07 기준 출시일 하한은 2022-11-07이다. 학생 companion이 보낸 플랫폼(`galaxy-watch` 또는 `apple-watch`), 모델, 출시일, 심박수 기능 표시를 PWA 브리지에서 검사한다. 이 메타데이터 검사만으로 실제 제조사 API 호환 모델을 확정하지는 않는다.
- 단일 수업 세션의 초기 데이터는 심박수(bpm)와 시각뿐이다. 학생·학급 ID를 네이티브 브리지에 넘기지 않고 임시 무작위 참가자 토큰만 보낸다.
- 학생 본인, 보호자, 수집 항목(심박수)의 동의가 모두 확인되어야 한다. OS 심박 권한은 학생 페어링 휴대폰 앱이 처리한다. 동의 체크는 매 화면/수업 세션에서 다시 받아 PIN 저장소에 기록하지 않는다. 실제 동의 문서와 보관·증명 방식은 학교가 별도로 관리한다.
- 측정값과 기기 메타데이터는 화면 세션 메모리에만 둔다. PIN 암호화 클래스 상태, 허브, CSV, 네트워크로 저장하거나 보내지 않는다. 측정 종료, 동의 철회, PIN 잠금, 페이지 이탈 시 화면 값을 지운다.
- 워치 연결이 끊기면 값을 숨기고 공백을 표시하며 교사가 다시 연결한다. Wi-Fi 단절은 같은 주소가 돌아올 때 휴대폰이 RAM 전용 재접속 자격으로 자동 복구하도록 정했다. 태블릿 IP가 바뀌면 DNS-SD에서 세션 ID와 지문을 확인해 찾고, 실패하면 교사에게 새 QR을 안내한다. 휴대폰·태블릿 코드에 복구 경로를 구현했지만 APK 설치와 실제 네트워크 복구는 미검증이다. 복구 때 이전 값을 되살리지 않고 새 워치 준비 정보와 새 표본을 기다린다. 5초 동안 새 표본이 오지 않아도 값을 숨긴다.
- 심박 데이터 권한 거부 시 측정값과 기록은 비워 두고, 수업은 계속한다. 일반 수업 UI와 측정 기능은 분리되어 있다.
- `native/android/studentPhone/`에 Android 휴대폰 companion을 추가했다. 교사 QR strict parse(사설 IPv4·1회성 256-bit 티켓·TLS 공개키 지문·120초 이하 만료), OkHttp TLS pinning, 초기 연결과 RAM 재접속 자격, 응답 ACK 검증, Wi-Fi 연결 감지, DNS-SD의 session ID·지문 검증, 백오프 재시도, 학생·보호자 확인 UI, Wear Data Layer 전달을 포함한다. 각 수업 연결마다 임시 128-bit 워치 세션 토큰을 새로 발급하고 오래된 연결 메시지를 거부한다. 네트워크 단절 값은 저장/재전송하지 않는다.
- `native/android/wear/`에 Galaxy Watch용 Wear OS 앱을 추가했다. 사용자가 심박·알림 권한을 미리 확인한 뒤, 휴대폰이 현재 수업 토큰을 보내면 Health Services `ExerciseClient`가 `WORKOUT` 데이터 capability를 조회하고 `HEART_RATE_BPM`만 구독한다. GPS나 다른 건강 데이터는 요청하지 않고, 앱 자체 기록 파일도 만들지 않는다. Health Services가 활성 운동 세션을 실행하는 점은 OS·제조사 UI와 실제 기기에서 확인할 필요가 있다. APK 설치·센서 권한·화면 꺼짐 및 ambient 표본 갱신은 미검증이다.
- 현재 Android 태블릿·휴대폰·Wear OS 세 디버그 APK는 조립됐으나 실제 기기 설치·연결은 검증하지 않았다. iPhone/Apple Watch 소스 scaffold는 있으나 Xcode 빌드·서명 미검증이다. Galaxy Watch 코드와 Apple Watch `Watch7,1...Watch7,6`, `Watch7,8...Watch7,11` 식별자 일부를 후보로 넣었지만 공식 전 지역 모델 목록이나 전체 출시일과 대조하지 않은 잠정 allowlist다. 검증된 지원 모델은 없다.
- 일반 브라우저/PWA에는 네이티브 브리지가 없으므로 웨어러블 연결 버튼은 비활성화된다. 가상 v2 호스트는 QR 초대, 워치 준비 이벤트, 심박 표본, 휴대폰 권한 불가 이벤트를 흉내 낸다.

## 검사 근거

- `node tests/wearable-bridge.test.cjs` — 15개 단위 사례 통과: 출시일 경계, 사설 LAN/일회성 QR 형식, 동의 게이트와 철회, 익명 토큰, 휴대폰 권한 실패, 초대 만료, Web Message 어댑터, 워치 연결 공백/교사 QR 재연결, 로컬 Wi-Fi 단절 뒤 값 숨김과 새 표본만 재개, 오래되거나 잘못된 표본, stale 처리, 종료·권한 철회.
- `node tests/browser-wearable-bridge.cjs` — 가짜 v2 호스트로 동의 게이트, 초대 QR, 심박 화면, 워치 끊김 뒤 공백·교사 QR 재연결, 재연결 실패 뒤 세션 종료, Wi-Fi 단절 뒤 자동 복구 이벤트와 새 값 전까지 공백 유지, 권한 불가 시 빈 기록, PIN 잠금 종료와 저장소 비기록을 확인했다.
- `node tests/browser-classroom-tools.cjs` — 교사 도구 브라우저 회귀 통과.
- `git diff --check` 통과. 두 Chromium 테스트는 loopback 서버를 열도록 허가된 권한으로 수행했다.
- Android student phone: `:studentPhone:testDebugUnitTest` — 10 JVM 사례 통과. QR 사설 IPv4·만료·필드·자격, TLS ACK/resume 자격 형식, watch frame/session token, 호스트 전송 payload 및 bounded reconnect delay를 검사했다. `:app:testDebugUnitTest` 호스트 검사 1건도 통과했다.
- Android 전체: `:app:testDebugUnitTest :app:assembleDebug :app:lintDebug :studentPhone:testDebugUnitTest :studentPhone:assembleDebug :studentPhone:lintDebug :wear:assembleDebug :wear:lintDebug` 통과. 태블릿 호스트·학생 휴대폰·Wear OS APK를 각각 조립했고 세 모듈 Lint 오류/경고는 0건이다. 두 companion 앱 ID와 서명은 Data Layer 쌍을 위해 동일하게 맞췄다. 배포용 AAB/Play 업로드 설정은 하지 않았다.
- Apple companion: `native/apple/`에 Swift Package 코어 테스트, XcodeGen 구성, iOS QR/TLS/Bonjour/WCSession 소스와 watchOS HealthKit workout 소스를 추가했다. 이 Linux 환경에는 Swift, Xcode, Apple SDK/서명 ID가 없어 `swift test`, 프로젝트 생성, macOS 빌드, Simulator 및 실기기 시험을 실행하지 못했다. `native/apple/README.md`에 실행 방법과 제한을 기록했다.
- 2026-11-07 후속 검사에서 `/tmp` 임시 Gradle 8.10.2/Kotlin 2.0.21 하네스를 구성하고, Android API 35 `android-all` 및 현재 AndroidX/WebSocket 의존성으로 Android 앱 Kotlin 소스 전체를 컴파일했다. `BridgeMessagesTest` 1개도 통과했다. 이는 API/라이브러리 경계의 Kotlin 소스 컴파일 증거다.
- 사용자가 허락한 뒤 `/tmp`에 Android SDK Platform 35와 Build Tools 35.0.0을 설치하고 Google SDK 라이선스를 수락했다. Gradle 8.10.2, AGP 8.8.2, Kotlin 2.0.21, JDK 21 조합으로 전체 명령을 최종 재실행해 성공했다. 테스트 11/11 통과, Lint 0 오류·0 경고, APK 리소스·manifest 병합, D8, 패키징을 확인했다.
- Lint에서 확인한 API 27 스타일 속성과 선택 카메라 기능 선언, WebView 선택 기능 가드, 백업/기기 전송 제외 규칙, 런처 아이콘을 보정했다. Wi-Fi 주소 조회는 deprecated `allNetworks` 대신 활성/콜백 네트워크를 사용한다. PWA 실행에 필요한 JavaScript는 신뢰된 로컬 origin으로 제한한 상태에서만 켠다.
- 조립 산출물은 `native/android/app/build/outputs/apk/debug/app-debug.apk`(태블릿 호스트), `native/android/studentPhone/build/outputs/apk/debug/studentPhone-debug.apk`, `native/android/wear/build/outputs/apk/debug/wear-debug.apk`다. 호스트 package는 `com.peloop.wearablerelay`, companion package는 둘 다 `com.peloop.studentcompanion`이며 target/compile API는 35다. 세 APK 모두 Signature Scheme v2 검증을 통과했다.
- APK 설치·실행, WebView 실제 동작, 소켓 바인딩 실패 주입, 실물 Wi-Fi 복구는 아직 확인하지 않았다. 이번 빌드로 APK는 준비됐지만 설치 가능성과 런타임 통합은 검증되지 않았다. SDK/Gradle 패키지는 `/tmp` 임시 경로에 설치했고 재사용 설정 초안은 저장하지 않았다.
- 가상 브리지 테스트는 제조사 앱/API, 실제 센서, 심박 정확도, 실제 모델 호환이나 Android 호스트와의 LAN 연결 증거가 아니다.

## 외부 조건과 다음 일

Apple HealthKit/WatchConnectivity, Wear OS Health Services, Samsung Health Sensor SDK의 API 경로와 권한·기기 범위는 [S5.6 공식 API 조사](stage-S5.6-vendor-api-research.md)에 기록했다. Android 소스 선택은 `ExerciseClient`이며 `MeasureClient`는 공식 문서에서 짧은 측정용으로 구분된다. [기기 적격성 표](S5.6-device-support-matrix.md)는 API 하한과 4년 출시일 필터를 분리하고 잠정 Galaxy/Apple Watch 모델 코드 후보를 지원 인증과 구별한다. 공식 모델 ID/출시일/최소 휴대폰 OS 목록과 실기기 확인은 아직 미완료다. Apple 소스의 Swift 컴파일/프로젝트 서명, Android APK 설치, 기기 간 권한·실제 심박·Wi-Fi 변경·Bonjour/DNS-SD 재연결 시험은 남았다. 학교 현장·발열·실제 40분 연속 시험은 앞선 사용자 지시대로 제외했다.

남은 작업은 Android 세 APK와 Apple 앱을 빌드·서명해 기기에 설치하고, 보호자·학생 동의 게이트, QR 연결, OS 권한/센서 부재, 표본 신선도, Wi-Fi 복구, IP 변경 시 DNS-SD/Bonjour 탐색과 QR fallback을 확인하는 것이다. Swift/macOS 빌드, Apple 모델별 공식 출시일/최소 휴대폰 OS 전수 대조, 제품 출시 전 실기기 검증도 남았다. 지금까지 앱 코드를 게시하지 않았다.
