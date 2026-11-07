# S5.2 공식 PAPS 종목 기준 개발 검증

검증일: 2026-11-06

## 검증한 범위

- 교육부령 제354호 「학교건강검사규칙」 별표 4의 왕복오래달리기, 앉아 윗몸 앞으로 굽히기, 윗몸말아올리기, 악력, 제자리멀리뛰기를 남녀 × 초3~고3으로 등록했다. 카탈로그는 100개 적용 행이다.
- 학년도, 학년군, 종목, 단위, 대상 구분과 기준 버전의 일치 여부를 검사했다. 대상 구분을 명시 확인하지 않은 조회는 차단한다.
- 100개 각 행의 5개 등급 구간에 대해 모든 하한·상한 값을 조회하고 올바른 종목 등급인지 확인했다. 각 구간은 등록 측정 정밀도 기준으로 겹치거나 비지 않도록 카탈로그 생성 때 검증한다.
- 별표 4 각주에 적힌 최저·최고 범위 밖 값의 끝 등급 처리, 소수 정밀도가 맞지 않는 입력, 미등록 학년도, 잘못된 단위, 백분위 미제공 상태를 확인했다.
- 별표 3 기록 방법에 맞춰 제자리멀리뛰기 0.1cm 입력을 허용하고 0.01cm 입력은 거부하는 측정 모델 회귀를 확인했다.
- 교사 PIN 화면에서 기준 학년과 남자/여자 평가표 구분을 명시 선택한 뒤 실시간 개별 등급을 보고, 저장된 기록에서 등급·적용 범위·기준 버전을 다시 확인했다.
- 학년 또는 평가표 구분 하나만 고른 채 등급을 저장하려 하면 막히는지, 학급 입력을 다음 학생으로 넘길 때 두 선택이 초기화되는지 확인했다.
- 결측 기록에는 적용 기준이 붙지 않고, 수정 때 기준 범위 변경도 PIN 암호화 변경 이력에 남는지 확인했다.
- 서비스 워커 캐시 버전을 올려 업데이트 후 최신 기준 화면과 모듈이 함께 적용되도록 했다.
- PWA 오프라인 재시작·업데이트 흐름에서 신규 기준 데이터가 앱 셸에 포함되고, 누락 자원 및 설치 실패 안내가 유지되는지 검사했다.

## 실행 결과

```text
node --test tests/paps-criteria.test.cjs tests/classroom-measurements.test.cjs tests/classroom-model.test.cjs
PASS (3 test files)

node tests/browser-classroom-measurements.cjs
PASS explicit criteria selection, item-grade preview, encrypted source scope and correction history

node tests/browser-pwa.cjs
PASS offline restart, PIN, fake camera, 5s encrypted WebM and library playback
PASS version waiting, query consistency, protected states, natural activation and encrypted data preservation
PASS missing cache asset reported
PASS initial installation failure reported

node --check paps-criteria-data.js
node --check paps-criteria.js
node --check classroom-model.js
node --check classroom-ui.js
git diff --check
PASS
```

병렬 실행에서는 기존 5초 영상 재생 단언이 5.115초 측정값으로 한 차례 실패했다(허용 상한 5.1초). 단독 재실행은 통과했다. 이 시간 허용 오차는 PAPS 기준 데이터와 무관하며 기존 PWA 테스트의 타이밍 여유가 좁다는 점을 기록한다.

## 제한

교사 화면에서 개별 종목 등급을 조회할 수 있지만 2026학년도 기준만 제공한다. 전체 PAPS 점수·종합등급은 현재 입력 항목이 다섯 체력요소를 모두 채우지 않고 BMI가 별도로 필요하므로 산출하지 않는다. 규칙에서 백분위 산식도 확인되지 않아 제공하지 않는다. 실제 NEIS 파일 출력이나 현장 교사 검증은 수행하지 않았다. 기준 개정 후에는 법령 최신 별표와 적용 연도를 확인하고 버전을 추가해야 한다.

검증은 개발 워크스페이스에서만 했다. 환경 게시나 외부 서비스 전송은 하지 않았다.
