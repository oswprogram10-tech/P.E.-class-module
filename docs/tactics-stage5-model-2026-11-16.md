# 전술 검색·로컬 3B 선택 표본 평가

실행일(UTC): 2026-11-16. 시작 2026-11-16T05:37:40.342Z, 종료 2026-11-16T06:13:07.115Z. [상세 JSON](tactics-stage5-model-2026-11-16.json).

450문항 전수 모델 평가가 아닌 결정적 15문항 표본이다. 다섯 종목마다 기존 검색 평가 결과를 질문 ID 순으로 정렬하여 후보가 있는 partial 상태 첫 문항, 다른 상황군의 candidate 상태 첫 문항, 후보 없음 첫 문항을 골랐다. 각 선택지가 없으면 순서상 첫 후보를 사용한다. 기존 검색 결과를 계층화에 사용한 편의 표본으로 전체 성능·정확도 추정이나 일반화는 할 수 없다. 질문마다 기존 평가의 제안 연결은 사람이 검증한 정답이 아니다. 질문 ID와 연결 힌트는 평가 기록에만 있으며 모델 입력에는 종목·목표·질문과 앱 검색 후보만 사용한다.

실제 앱의 TacticsLocalAdvisor.suggest를 사용했다. 빈 결과 5문항은 모델 미설치 상태에서 호출해 loadModel과 createCompletion이 모두 0회였다. 나머지는 검증된 로컬 파일로 앱 설치 후 로컬 서버를 종료하고 브라우저 오프라인 상태로 호출했다. 생성 시 외부 요청은 관찰되지 않았다(전체 기록 외부 요청 0). Chromium 155, Linux, CPU affinity 2개 및 hardwareConcurrency override 2, 엔진 관찰 2 threads, cgroup cpu.max 200000/100000(2 CPU) 환경이다. 모델 크기 2,104,932,768바이트, SHA-256 `626b4a6678b86442240e33df819e00132d3ba7dddfe1cdc4fbb18e0a9615c62d`. 생성은 앱 그대로 매번 모델을 로드·종료했다. 최대 12분 watchdog 및 실패 기록을 적용했고 실제 10건은 시간 초과나 오류 없이 완료됐다. temperature 0.2, 명시 seed 없음: 표본 선택은 결정적이어도 출력은 결정적이라고 보장할 수 없다.

생성 10건 모두 JSON 구조가 유효하고 실제 프롬프트에 포함된 ID만 반환했다. 6건은 전달된 2개 모두 선택, 1건은 전달된 2개 중 1개 선택, 3건은 512 토큰 예산 때문에 전달 후보가 2개에서 1개로 축소됐고 모두 그 1개를 선택했다. 빈 선택은 0건, 실패 0건이다. 예산 계산은 토크나이저 수 + 4의 예약치이며 표의 값은 그 합이다. 모델은 후보의 일부 필드만 보며 scopes, ruleExplanation 및 전체 원문은 보지 않는다. 생성 결과는 자유로운 설명문이 아니라 선택된 검색 카드 투영이다. 반환 카드의 검색 결과 필드 일치 10/10은 앱의 필드 보존 확인이지 모델이 조건·근거를 이해했거나 설명의 사실성을 검증했다는 뜻이 아니다.

| 질문 | 계층 | 검색 전체 | 예산 전 | 실제 입력 | 선택 | 토큰+4 | 시간(초) | 기존 참고 연결과 선택 겹침 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| BA-01-04 | partial-preferred | 5 | 2 | 2 | basketball_case_29, basketball_case_40 | 504 | 266.0 | 없음 |
| BA-02-01 | candidate-other-family | 8 | 2 | 2 | basketball_case_09, basketball_case_03 | 411 | 216.7 | 없음 |
| VO-06-01 | partial-preferred | 8 | 2 | 2 | volleyball_case_14, volleyball_case_15 | 510 | 266.2 | 없음 |
| VO-01-01 | candidate-other-family | 8 | 2 | 1 | volleyball_case_15 | 321 | 172.6 | 없음 |
| SO-04-04 | partial-preferred | 8 | 2 | 2 | soccer_case_30, soccer_case_22 | 432 | 230.4 | 없음 |
| SO-01-01 | candidate-other-family | 7 | 2 | 1 | soccer_case_24 | 333 | 172.5 | soccer_case_24 |
| TE-01-04 | partial-preferred | 8 | 2 | 2 | TBX-03, TBX-15 | 243 | 135.6 | 없음 |
| TE-02-01 | candidate-other-family | 8 | 2 | 2 | teeball_case_01 | 338 | 171.6 | teeball_case_01 |
| DO-14-01 | partial-preferred | 7 | 2 | 1 | dodgeball_case_04 | 302 | 168.5 | dodgeball_case_04 |
| DO-01-01 | candidate-other-family | 5 | 2 | 2 | dodgeball_case_01, dodgeball_case_04 | 496 | 258.9 | dodgeball_case_01 |

기존 참고 연결과 선택이 겹친 것은 4/10문항이다. 이는 정답 적중률이 아니다. 예를 들어 BA-01-04의 기존 참고 연결 basketball_case_34는 검색 후보 자체에 없었으며, 모델 선택은 이를 복구할 수 없다. 나머지 사례도 개별 관련성과 학교 규칙은 사람 검토가 필요하다.

후보 없음 문항: BA-01-01, VO-04-01, SO-04-01, TE-01-02, DO-03-01. 다섯 건 모두 실제 suggest가 빈 배열을 반환했으며 엔진 로드·생성 호출은 0회였다.

첫 시도는 host watchdog을 추가하기 위해 설치 중 수동 중단했다. 이후 부모 프로세스에서 InvalidStateError가 관찰됐으나 중단과의 인과는 미확정이다. 당시 기록은 [초기 시도 JSON](tactics-stage5-model-initial-attempt-2026-11-16.json)에 보존했고 새 프로필에서 설치를 다시 완료했다. 이 시도에서는 모델 생성이 시작되지 않았다.

실제 실행 당시 하네스 SHA-256: `34f3900b5151d6c60b80e9fa57c3eb36ba6ebca86bf846b02526d60cb51079df`. 실행 후 CLI 경로 지정 및 기존 결과 덮어쓰기 방지 등을 추가한 현재 하네스 SHA-256: `30ff9fa328aa5faa9affab168545d48d726ed1e24d7a181457987376f1e487f9`. 재실행: `taskset -c 1,2 node scripts/manual/tactics-stage5-3b.cjs /tmp/pe-wllama-review/qwen.gguf /tmp/new-result.json` (CPU 번호는 환경에 맞춰 조정). 로컬 모델을 새로 다운로드하지 않는다. 명시된 출력이 이미 있으면 기본적으로 중단한다. 검증: `node --test tests/tactics-stage5-harness.test.cjs` 2개 통과.
