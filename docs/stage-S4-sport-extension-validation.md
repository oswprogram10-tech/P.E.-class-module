# S4.6 후속 종목·프로필 확장 검증

기록일: 2026-11-06. 기준 HEAD `f1ba4c2`, hostname `eb97ffefba06`, Linux Chromium 155·Node v24.22.1 개발 환경이다. [사용·신뢰 경계](S4-sport-extension-guide.md)를 함께 따른다. 이번 사용자 요청에서 Android·학교 환경·발열·40분 연속 사용을 명시적으로 제외했다. 해당 검사는 실행하지 않았고 대기로 유지한다.

## 선행 S4.6 검토

기존 합성 harness와 결과 JSON을 재적용하거나 다시 생성하지 않았다. Luna가 `report()`의 fixture/source hash와 evaluation 전체를 기존 JSON과 비교해 일치 확인했다. 사건의 inclusive 일대일 매칭·micro 집계·null 분모 처리와 한계는 유지한다. 기존 농구 합성 TP 3·FP 1·FN 2를 배구 결과로 인용하지 않는다. 기존 문서의 “확장 완료” 경계는 로컬 기능 구현과 실제 정확도/교육적 타당성 검증을 구분하도록 명확히 했다.

## 구현 범위

- `volleyball-cue.js`: 별도 2D 오버헤드 팔 동작 연습 규칙. 준비/스윙/팔 내림 유지, 좌우·민감도, 신뢰도·시각/추적/설정 초기화. 이벤트 type/ruleVersion은 농구와 다르다.
- `model-profiles.js`, `pose-runtime.js`: 공식 Lite 하나의 불변 registry를 실제 runtime에 연결. 승인 ID만 resolve하고 임의 옵션·assets·URL·직접 weights를 거부한다. 동일 출처·SHA-256 재검사와 redirect 거부를 적용한다. 대체 licensed weights가 없어 다른 모델 통합은 하지 않았다.
- `pose-ui.js`, `app.js`, `index.html`: PIN 뒤 세션 한정 종목·배구 사용/팔 선택. 재실행은 농구 기본, 저장 농구 설정 보존. 적용 시 상태·추가 피드백·이력 중단. 배구 분기는 `onCueState`만 호출하며 농구 evidence를 만들지 않는다. 앱 sport guard, 이력 UI의 배구 type/ruleVersion 거부와 기존 농구 schema의 ruleVersion 제한을 유지한다.
- `sw.js`: 셸 v14와 신규 로컬 모듈 캐시. 모델 pins·모델 cache version·worker 설정은 보존했다.

## 실행한 검사

작업 디렉터리는 `/workspace/P.E.-class-module`이다. loopback/Chromium 및 기존 zip 검사에는 승인된 `sandbox_permissions: require_escalated`를 사용했다. 네트워크/환경 설정을 바꾸지 않았다.

| 명령 | 결과와 근거 |
| --- | --- |
| `node tests/volleyball-cue.test.cjs` | 4개 통과. 좌우 typed cue·재준비·농구 위쪽 신전 구별·가림/시각/설정/추적 초기화 |
| `node tests/model-profiles.test.cjs` | 3개 통과. pins/출력/근거·깊은 불변성·미등록 ID/URL/객체/override 거부 |
| `node --test tests/*.test.cjs` | 통합 후 한 번, 71개 통과·실패/건너뜀 0. 기존 합성 40분 **시각** 버퍼 단위 검사도 포함되지만 실제 40분 사용 검사가 아님 |
| `node tests/browser-sport-extension.cjs` | 최종 통과. UI 종목 선택·합성 배구 cue 1개·농구 record 호출 0·직접 typed cue 이력 거부·상태/피드백/이력 초기화·저장 설정 보존·reload 농구 복귀·실제 runtime API의 ID/URL/assets/weights 거부 |
| `node tests/browser-pose-runtime.cjs` | 통과. 취소·무결성/변조 거부·오프라인 캐시·worker timeout/restart. 실제 로컬 Lite 정지 사진 33관절·추론 5회 및 오프라인 재시작 확인 |
| `node tests/browser-shot-ui.cjs` | 통과. 농구 PIN·저장 실패·기존 설정·합성 READY/SHOOT·오프라인 worker·맥락/카메라 초기화·PIN 데이터 초기화 |
| `node tests/browser-shot-history.cjs` | 통과. 기존 바인딩·암호화 이력·조회/삭제·빈 outbox |
| `node tests/browser-pwa.cjs` | 통과. 신규 셸 offline 재시작·가상 촬영·5초 암호화 저장/재생·버전 대기/안전 전환·누락/설치 실패 |
| `node tests/browser-feedback-real.cjs` | 통과. 실제 로컬 worker 온라인/오프라인과 입력 프레임 시각 연결. 피드백 동작 이벤트는 stub |
| `node tests/browser-shot-history-failures.cjs` | 통과. 합성 event·실제 IDB 취소와 주입 quota 오류 뒤 가상 카메라 지속 |

서로 다른 브라우저 실행 파일은 총 7개다. 새 종목 검사만 최종 옵션 거부/이력 경계 보강 후 재확인했다. 기존 전체 브라우저 스위트나 장시간 검사를 중복 실행하지 않았다. 실제 모델 정지 사진 추론, fake camera, 합성 landmark, stub 피드백을 각각 구분하며 스포츠 정확도의 근거로 삼지 않는다.

runtime 테스트의 synthetic assets는 테스트 페이지의 `fixturePoseRuntime` helper에서 registry를 일시 교체하고 `finally`로 복원한다. production API에는 해당 주입 옵션이 없다. profile module 자체가 일반 동일 페이지 JavaScript 신뢰 경계 안에 있다는 한계를 보존한다.

Luna 최종 read-only 검토에서 event/history 분리·프로필 실행 연결·test fixture 격리·이용조건 근거와 250ms 연습 표시를 확인했고 추가 차단 문제를 찾지 못했다. 전체 회귀를 중복 실행하지 않았다.

## 남은 범위

실제 동작/방향별 농구·배구 정확도와 교사 검토는 미확인이다. 실제 배구의 빠른 운동·공 접촉·성공·기술 정확성·성적 평가를 구현하지 않았다. 다른 모델 weights·임의 모델 파일 로더·학생 자료 수집·전송·실배포는 수행하지 않았다. 사용자 제외 항목(Android·학교 환경·발열·40분)은 계속 대기다. S5에는 착수하지 않았다.

기존 dirty 상태의 변경을 보존했고 되돌리거나 재적용하지 않았다. 게시·배포·commit·push·새 모델 다운로드·네트워크/환경 설정 변경을 하지 않았다.
