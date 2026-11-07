# S5.1 PAPS 기록·수정 이력 검증

날짜: 2026-11-07. S5.1.1 데이터 계약, S5.1.2 교사 수기 입력, S5.1.3 수정 이력·삭제·PIN 초기화 경계를 다룬다. 공식 PAPS 점수·등급·백분위와 건강 판정은 구현하지 않았다.

## 구현

- 측정 원자료는 S3 학급 저장소의 `measurements` 배열에 들어가며 기존 교사 PIN 기반 AES-GCM 암호화 경로를 사용한다. 원자료를 outbox, 개발 허브, 서버로 보내지 않는다.
- 학년도, S3 학생 ID, 측정일, 종목 ID, 값·단위, 입력 시각과 미수정 시각(null)을 분리한다. 결측은 값 null과 이유 코드로 저장하고 값 0과 구분한다. S5.1에서는 기준 버전이 null이며, S5.2 화면에서 교사가 별표 4 기준을 명시 선택한 경우에만 학년군·평가표 구분·기준 버전을 기록에 추가한다.
- 학년도는 한국 학년도 시작(3월)에 맞는 측정일과 함께 검사한다. 기술 입력 경계는 왕복 오래달리기 0–300회(정수), 앉아 윗몸 앞으로 굽히기 -50–100cm(소수 첫째 자리), 윗몸 말아 올리기 0–300회(정수), 제자리멀리뛰기 0–400cm, 악력 0–100kg(소수 첫째 자리)이다. 제자리멀리뛰기는 S5.1 당시 정수 입력이었고, S5.2에서 별표 3의 공식 기록 단위에 맞춰 소수 첫째 자리로 조정했다. 이 입력 경계는 잘못된 값을 잡기 위한 앱 범위이며 공식 등급 기준이 아니다.
- 측정값이 있는 동안 해당 학생과 학급의 이름을 기존 7일 만료에 맡기지 않고 동일한 로컬 암호화 경계에서 보존한다. 기록은 입력 학년도를 포함해 최대 3개 학년도 보관하고 `schoolYear + 3`의 3월 1일 이후 다음 교사 데이터 열기에서 정리한다. 마지막 기록 만료 뒤 참조된 학생·학급 데이터도 기존 만료 경계로 돌아간다. 학급 삭제는 기록을 즉시 제거한다.
- 교사는 측정값을 수정할 수 있다. 기록에는 `inputAt`, `modifiedAt`, `changeHistory`가 따로 있고 이력은 이전/새 값, 단위, 결측 상태, 선택한 경우 이전/새 등급 기준 범위와 버전, 시각, 교사 역할을 담는다. 학생 ID와 학년도는 고정해 잘못된 연결은 삭제 후 다시 입력하게 한다.
- 개별 삭제, 학급 삭제, 학년도 만료는 측정값과 연결된 수정 이력을 함께 제거한다. PIN 초기화는 클립과 암호화 학급 메타데이터를 새 PIN 설정과 같은 IndexedDB transaction에서 변경한다. 취소·저장 실패는 기존 클립·측정값·이력을 보존하고 성공 시 이전 PIN으로 복호화할 데이터가 남지 않는다.

## 실행한 검사

- `node --test tests/classroom-model.test.cjs tests/classroom-retention.test.cjs tests/classroom-measurements.test.cjs tests/shot-history.test.cjs tests/shot-history-storage.test.cjs` — 모두 통과. 값/단위/범위/정밀도, 결측, 동명이인, 수정 전·후 값과 시각, 원본 입력 시각 보존, 재배정 방지, 3학년도 만료와 이력 정리를 확인했다.
- `node tests/browser-classroom-measurements.cjs` — PIN 접근, 연속 입력, 결측에서 값으로 수정, audit 표시, 암호문 저장, 개별·학급 삭제를 Chromium과 IndexedDB에서 확인했다.
- `node tests/browser-reset.cjs`, `node tests/browser-classroom-reset.cjs` — 취소/실패 시 측정값·수정 이력 rollback, 성공 시 삭제, 새 PIN, 기존 탭의 stale key/write 거부를 확인했다.
- `node tests/browser-classroom-flow.cjs`, `node tests/browser-classroom-privacy.cjs`, `node tests/browser-pwa.cjs` — 기존 명단·제출·허브 흐름, PIN/개인정보 경계, 셸 v16 offline/업데이트 흐름을 확인했다.
- `node --check classroom-model.js`, `node --check classroom-ui.js`, 관련 browser test 파일, `git diff --check` — 통과.

이 검사는 가상 학급과 브라우저 개발 환경에서만 수행했다. 실제 학교 자료, PAPS 공식 기준, Android, BLE, 사용자 승인 흐름은 검사하지 않았다. 사용자가 앞서 이번 범위에서 제외한 Android·학교 환경·발열·40분 연속 사용 검증도 하지 않았다. 전체 회귀 모음은 실행하지 않았다.
