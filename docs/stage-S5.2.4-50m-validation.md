# S5.2.4 PAPS 50m 달리기 검증 기록

검증일: 2026-11-07

## 구현 범위

- 업로드된 「학교건강검사규칙」 교육부령 제354호 PDF와 기존 기준 출처 해시를 대조했다. 별표 3 PDF 14쪽은 50m 달리기를 0.01초 단위로 기록하도록 하고, 별표 4 PDF 17~18쪽은 남자·여자 각각 초3~고3의 5등급 경계를 제시한다.
- 50m 달리기(`sprint-50m`, 초)를 수기 측정 목록에 추가했다. 입력은 0.01~60초, 0.01초 정밀도다. 숫자 입력 상한은 오입력 방지용 기술 범위이며 공식 점수 범위가 아니다.
- 남녀 × 10개 학년군 기준 20행을 등록했다. 기존 5종목과 합쳐 총 6종목·120개 적용 기준이다. 개별 기준은 2026학년도에 한정되며 학년·평가표 구분은 교사가 직접 확인한다.
- 50m 달리기는 낮은 시간이 높은 등급이다. 등급별 범위의 인접·겹침을 낮은 시간 방향으로 검증하고, 별표 4 각주에 따라 느린 끝은 5등급, 빠른 끝은 1등급으로 처리한다. 등록 범위 사이의 빈 값은 등급을 만들지 않는다.
- 추이·학급 분포·학생 선택 CSV는 기존 PAPS 경로를 사용한다. 값·등급 기준 버전은 기존 PIN 암호화 로컬 자료로 저장한다. 총점·종합등급·백분위·BMI 판정·NEIS 출력은 추가하지 않았다.

## 검증 결과

```text
node --test tests/*.test.cjs
PASS 127 tests, 0 failures

node tests/browser-classroom-measurements.cjs
PASS teacher PIN input, correction history, duplicate students, missing values, encryption and deletion

node tests/browser-paps-reports.cjs
PASS 50m input at 0.01-second precision, grade preview, trend/distribution and selected CSV

node tests/browser-pwa.cjs
PASS offline restart, waiting update, data preservation, missing asset and install-failure paths

node --check classroom-model.js
node --check paps-criteria-data.js
node --check paps-criteria.js
node --check classroom-ui.js
node --check sw.js
git diff --check
PASS
```

순수 기준 검사는 남녀 10개 학년군 120개 적용 행 각각의 5개 등급 하한·상한을 분류하고, 0.01초 정밀도, 낮은 시간이 높은 등급인 판정, 양쪽 범위 밖 클램프, 대표 원문 행을 확인한다. Chromium 화면 검사는 입력 단계에서 기준 학년·평가표 구분을 직접 고른 뒤 결과를 저장하고, 추이·분포·확인형 CSV에 반영되는 흐름을 확인한다. 서비스워커 캐시 버전은 v24로 바꿔 업데이트와 오프라인 재실행을 확인했다.

## 미확인 범위

실제 학교 측정 현장·교사 검토·실제 타이밍 장비 연결은 검증하지 않았다. 지원 기준은 2026학년도에 한정한다. 기존 제한대로 Android·학교 환경·발열·실제 40분 연속 사용은 이번 검증 범위에 포함하지 않았다. 게시·배포·commit/push는 하지 않았다.
