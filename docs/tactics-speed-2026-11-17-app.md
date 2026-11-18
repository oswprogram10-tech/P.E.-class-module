# 전술 앱 API 응답 시간 실측 (2026-11-17)

Chromium 155, CPU quota 2/affinity 0–1, 동일한 검증된 Qwen 3B 파일과 같은 브라우저 페이지에서 실제 `suggest`를 호출했다. 모델 설치 후 서버를 종료하고 오프라인에서 순차 실행했다. baseline은 보존된 `tactics-speed-baseline-2026-11-17.txt`, final은 측정 당시 `tactics-local-advisor.js`다. 각 요청은 실제 `createCompletion` 1회이며 seed 42는 실험 계측에만 적용했다. 각 수치는 단일 관측으로 Android 실기기 결과나 정확도 평가가 아니다.

| 요청 | 전체 시간 | 모델 로드 | 캐시된 입력 / 전체 입력 토큰 | 선택 ID |
| --- | ---: | ---: | ---: | --- |
| 기존 코드 cold | 457.087초 | 1 | 0 / 488 | teeball_case_01, TBX-18 |
| 변경 코드 cold | 454.600초 | 1 | 0 / 488 | teeball_case_01, TBX-18 |
| 변경 코드 같은 질문 warm | 24.289초 | 0 | 487 / 488 | teeball_case_01, TBX-18 |
| 변경 코드 다른 질문 warm | 353.401초 | 0 | 105 / 502 | TBX-13, TBX-15 |

같은 질문의 세 호출은 prompt 및 grammar가 바이트 단위로 같고, 다른 질문의 prompt는 다르다. 각 결과의 원본 검색 자료 필드가 보존됐고 선택 ID는 해당 요청의 prompt 후보에 포함됐다. 다른 질문의 결과는 이전 질문의 결과와 달랐다. 각 warm 호출 전 엔진이 유지됨을 확인했으며 마지막 release 후 엔진 종료와 잠금 해제를 확인했다. 외부 요청은 없었다. 엔진 보유 시간과 입력 공통 부분에 따라 효과는 달라진다.

상세 단계, 입력, 진행 이벤트, usage, 결과, 해시는 `tactics-speed-2026-11-17-app.json`에 보존했다. 독립 엔진 batch 실험은 `tactics-speed-2026-11-17-pilot.md`를 참조한다.
