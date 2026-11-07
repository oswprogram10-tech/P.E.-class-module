# S5.6 공식 웨어러블 API 조사

조사일: 2026-11-06. 공식 Apple, Google Android, Samsung 개발자 문서를 확인했다. 이 문서는 API 경로와 제약을 기록하며, 실기기 호환이나 동작 확인을 뜻하지 않는다.

## 사용자 결정으로 고정된 제품 조건

- 조사 당시(2026-11-06) 대상은 출시일 기준 2022-11-06 이후 Apple Watch 및 Samsung Galaxy Watch였다. 현재 2026-11-07 기준 4년 하한은 2022-11-07이며, 앱 검사는 새 하한으로 갱신했다. API 문서는 이 기준일에 맞춘 완전한 판매 모델 목록을 제공하지 않으므로, 모델명·출시일 대조표는 별도 근거 확인이 필요하다.
- 첫 측정 항목은 심박수뿐이다. 학생과 보호자 동의가 모두 있어야 측정을 시작한다.
- 권한 거부나 연결 실패가 수업을 제한하지 않는다. 측정값은 숨기고 해당 세션의 심박 기록은 비워 둔다. 연결 공백 이후에는 교사가 수동으로 재연결한다.
- 사용자는 학생별 페어링 휴대폰 → 같은 로컬 Wi-Fi → Android 교사 태블릿의 네이티브 수신 앱 경로를 선택했다. 외부 클라우드 경유는 선택하지 않았다.
- 실제 기기 시험은 나중 단계다. 앱이나 환경은 게시하지 않는다.

## 공식 API 경로

| 플랫폼 | 공식 문서가 설명하는 기능 | 현재 MVP에 권하는 경로 | 제약 |
| --- | --- | --- | --- |
| Apple Watch | HealthKit의 `HKWorkoutSession`은 워치 센서를 운동에 맞게 설정하고 고빈도 심박 표본을 제공한다. 연결된 `HKLiveWorkoutBuilder`가 활성 세션의 실시간 자료를 다룬다. `WatchConnectivity`는 페어링된 iOS 앱과 watchOS 앱 사이의 통신을 제공한다. | watchOS companion에서 HealthKit 운동 세션과 실시간 심박을 얻고, 페어링된 iOS companion으로 전달한다. PWA 브리지는 iOS의 신뢰된 WebView가 제공한다. | 워치에는 한 번에 workout session 하나만 활성화할 수 있다. 다른 운동 앱이 시작되면 우리 세션이 끝날 수 있다. HealthKit은 앱이 읽기 권한 허용/거부를 구분하지 못하게 한다. 표본이 없을 때는 권한 거부라고 단정하지 말고 “측정값 없음, 기록 비움”으로 처리해야 한다. |
| Galaxy Watch | Wear OS Health Services는 Wear OS 3 이상 기기에 필수 구성요소다. `ExerciseClient`는 활성 운동 세션과 실시간 운동 지표에 맞는다. `MeasureClient`는 화면이 사용 중일 때의 짧은 신속 측정용이며 운동 추적에는 적합하지 않다고 Android 문서가 명시한다. 기기별 센서 지원을 실행 중 조회해야 한다. | 워치 companion에서 `ExerciseClient`로 수업 운동 세션을 열고 `HEART_RATE_BPM` 지원 여부를 먼저 확인한다. 심박 표본만 세션 메모리에서 사용한다. | 권한 이름과 요구사항은 Wear OS/API 버전에 따라 달라진다. 현재 Android 문서는 API 36 이상에서 health permission 계열을 사용하도록 안내한다. 운동이 화면 꺼짐/ambient 상태로 들어가면 자료가 묶여 전달될 수 있으므로 오래된 값은 표시하지 않아야 한다. |

Samsung은 별도 `Samsung Health Sensor SDK`도 제공한다. 공식 릴리스 노트 v1.4.1(2025-08-20 기준)은 Wear OS 기반 Galaxy Watch4 시리즈 이상을 지원 대상으로 적었다. 따라서 2022-11-06 출시일 하한과 함께 쓸 경우 Watch4/Watch5를 자동 지원 대상으로 선언하지 않고, 정확한 출시일과 모델 식별자를 대조해야 한다. 우선 MVP에는 Wear OS 전반의 Health Services API를 쓰고, Samsung SDK는 Health Services로 해결되지 않는 기기별 요구가 확인될 때만 검토하는 편이 낫다.

## 권한 거부와 빈 기록

Android Health Services는 필요한 심박 권한 요청과 권한 상태 처리를 앱에서 구현할 수 있다. Apple HealthKit은 읽기 권한 거부 여부를 앱에 알려주지 않는다. 그래서 두 플랫폼의 화면 상태를 완전히 똑같이 “OS 권한 거부”로 표시할 수 없다. 제품 문구는 공통으로 “심박 측정값이 들어오지 않아 기록을 비워 둡니다. 수업은 계속됩니다.”처럼 결과만 안내하고, 내부 원인은 알 수 있을 때만 구분한다.

수업 중 연결이 끊기거나 새 표본이 5초 이상 없는 상태는 현재 PWA 브리지 규약대로 값을 숨기고 공백을 표시한다. 값 또는 공백 이력은 화면 세션 메모리에만 있으며, 영구 기록은 만들지 않는다.

## 아직 결정하거나 구현해야 할 사항

1. Android 교사 태블릿에 네이티브 수신 앱을 만들고 PWA를 그 앱의 신뢰된 WebView로 연다. 현재 PWA 브리지는 같은 WebView에 네이티브 코드가 주입되는 형태만 정의하며, 일반 브라우저가 워치나 다른 휴대폰의 LAN 연결을 직접 받지는 않는다.
2. Apple Watch와 Galaxy Watch의 모델 식별자·공식 출시일·최소 OS 목록을 별도 공식 제품 자료와 대조한다. 현재 코드의 출시일 검사는 네이티브 앱이 전달한 날짜 문자열을 확인할 뿐 실제 모델 데이터베이스를 검증하지 않는다.
3. iOS/watchOS와 Android/Wear OS companion 프로젝트 및 WebView native bridge를 만든다. 현재 저장소에는 플랫폼 프로젝트·서명 구성·기기별 권한 요청 UI가 없다.
4. 실제 기기 연결, 워치 재시작, 권한 철회, 타 앱 운동 세션 충돌, OS 절전/ambient 동작을 시험한다. 가상 브리지 검사는 이를 대체하지 않는다.

현재 `server/classroom-hub.js`는 `127.0.0.1` 전용 개발 서버다. 제출·피드백 데이터를 RAM에 최대 7일 보관하고 로컬 origin만 허용한다. 이 동작은 교사 태블릿에서 학생 휴대폰들의 실시간 심박을 전달하는 릴레이 계약과 다르므로 그대로 LAN에 노출하지 않는다. 태블릿 네이티브 수신 앱은 활성 수업 세션의 최신 표본만 RAM에 두고 연결 종료/만료 시 즉시 폐기해야 하며, 오프라인 재전송 대기열·디스크·기존 outbox·서버 로그에는 남기지 않는다.

Apple은 iOS/iPadOS 앱이 로컬 네트워크를 직접 unicast로 사용해도 `NSLocalNetworkUsageDescription` 문구를 요구하고, 첫 접근 때 사용자에게 로컬 네트워크 허용을 요청한다. Apple Watch를 쓰는 학생의 iPhone companion도 교사 태블릿으로 연결하려면 이 권한이 필요하다. 거부되면 해당 심박 세션만 빈 상태로 둔다. 이 권한이 자동으로 허용되는 것으로 가정하지 않는다.

## 공식 참고 문서

- [Apple — HKWorkoutSession](https://developer.apple.com/documentation/healthkit/hkworkoutsession)
- [Apple — HKLiveWorkoutBuilder](https://developer.apple.com/documentation/healthkit/hkliveworkoutbuilder)
- [Apple — Watch Connectivity](https://developer.apple.com/documentation/watchconnectivity)
- [Apple — Authorizing access to health data](https://developer.apple.com/documentation/healthkit/authorizing-access-to-health-data)
- [Apple — NSLocalNetworkUsageDescription](https://developer.apple.com/documentation/bundleresources/information-property-list/nslocalnetworkusagedescription)
- [Apple — TN3179: Understanding local network privacy](https://developer.apple.com/documentation/technotes/tn3179-understanding-local-network-privacy)
- [Android — Health Services on Wear OS](https://developer.android.com/health-and-fitness/health-services)
- [Android — Compatibility across Wear OS devices](https://developer.android.com/health-and-fitness/health-services/compatibility)
- [Android — Record an exercise with ExerciseClient](https://developer.android.com/health-and-fitness/health-services/active-data)
- [Android — Health Services permissions](https://developer.android.com/health-and-fitness/health-services/permissions)
- [Android — MeasureClient](https://developer.android.com/health-and-fitness/health-services/active-data/measure-client)
- [Samsung — Health Sensor SDK release notes](https://developer.samsung.com/health/sensor/release-note.html)
