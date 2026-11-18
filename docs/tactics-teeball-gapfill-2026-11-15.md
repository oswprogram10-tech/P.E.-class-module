# 티볼 공통 기술의 빈 질문 13개 부분 관련 보강

갱신일: **2026-11-15**

후보가 없던 공통 기술 질문 13개에 부분 관련 참고 연결을 각각 1개씩 추가했다. Luna(`gpt-6-luna`)가 새 원문 6건을 조사했고 부모 에이전트가 문단·게시일·질문 조건을 다시 확인했다. 새 비교 후보는 `TBX-14`~`TBX-19`이며 기존 후보도 재활용했다. 13개를 모두 완전 일치 사례로 채웠다는 뜻은 아니다.

12개 질문에는 실제 경기의 일부 공통 행동·배치를 연결했다. TE-14-06에는 기사로 확인된 협력 움직임을 참고하는 범위만 기록했다. 실제 영상·음성은 관찰하지 않았으므로 해당 질문의 영상 검증은 보류했다. 이 연결의 용도는 `evidence-boundary-reference`이며 일반 경기 장면 연결과 구분한다.

모든 새 연결의 관련성 제안은 `partial`, 사람 검토는 `pending`, 운영 사용 가능 상태는 `false`다. 질문 문장은 바꾸지 않았다. 원문에 없는 의도·콜·선수 움직임·성공 효과는 채워 넣지 않는다.

## 질문별 참고 근거와 한계

| 질문 | 참고 사례 | 부분적으로 확인되는 것 | 빠졌거나 다른 조건 |
| --- | --- | --- | --- |
| TE-01-03 | [TBX-14](https://www.mlb.com/phillies/news/carlos-santana-nola-strong-in-phillies-loss-c270848420) | 앞쪽 약한 타구를 대비한 전진 배치 뒤 머리 위 타구 허용 | 앞뒤 공간을 성공적으로 나눠 지킨 사례가 아닌 예상과 달랐던 장면 |
| TE-01-06 | [TBX-14](https://www.mlb.com/phillies/news/carlos-santana-nola-strong-in-phillies-loss-c270848420) | 예상한 짧은 타구와 실제 뒤쪽 타구 사이의 불일치 | 같은 타자가 짧고 긴 타구를 번갈아 보낸 순서는 기록에 없음 |
| TE-03-02 | [TBX-15](https://www.mlb.com/twins/news/twins-sweep-red-sox-at-fenway-park) | 뜬공을 추적해 포구한 결과; 기존 티볼 라이너 사례와 함께 비교 가능 | 타구 높이만 바꿔 비교한 동일 조건 장면이 아니며 타구 높이 수치·학생 영상은 없음 |
| TE-03-03 | [TBX-17](https://www.mlb.com/news/tigers-use-extreme-shift-vs-joey-gallo) | 한쪽 수비 집중과 반대쪽 빈 공간 | 그 빈 왼쪽 공간으로 정상 타격해 안타를 냈다는 기록은 없음; 실제 타구는 중앙 땅볼 |
| TE-03-06 | [TBX-14](https://www.mlb.com/phillies/news/carlos-santana-nola-strong-in-phillies-loss-c270848420) | 약한 타구 예상의 전진 배치 뒤 수비수 머리 위로 간 타구 | 티볼에서 정지한 공을 친 조건과 다름; 타자의 공간 공략 의도는 불명 |
| TE-09-05 | [TBX-16](https://www.mlb.com/amp/news/orlando-arcia-leaves-game-keston-hiura-collide.html) | 같은 땅볼을 향해 두 수비수가 접근해 담당 범위가 겹침 | 서로 상대가 잡을 것이라 생각한 조건과 반대이며 콜·담당 결정의 성공 과정은 불명 |
| TE-11-01 | [TBX-17](https://www.mlb.com/news/tigers-use-extreme-shift-vs-joey-gallo) | 내야수 이동과 한쪽에 생긴 빈 공간 | 빈 공간을 메우려고 다음 배치를 조정한 장면은 아님 |
| TE-11-05 | [TBX-17](https://www.mlb.com/news/tigers-use-extreme-shift-vs-joey-gallo) | 외야 네 명 배치·내야수 이동으로 달라진 빈 공간과 역할 | 티볼처럼 전체 수비수가 늘어난 경우가 아니며 학생 수비 인원·간격과 동일하지 않음 |
| TE-13-04 | [TBX-19](https://www.mlb.com/news/world-series-game-4-2020-recap) | 중계 송구의 수신 실패와 뒤쪽 백업 부재 | 외야수의 후속 이동은 불명이며 성공적으로 백업을 계속한 장면은 아님 |
| TE-13-05 | [TBX-01](https://www.mlb.com/news/carlos-correa-throws-out-shohei-ohtani-as-twins-beat-dodgers) | 중계자가 이동할 때 다른 수비수가 비워진 수신 위치를 지원 | 공을 놓친 학생이 혼자 쫓아간 상황은 아니며 공 회수 뒤 추가 연결 장면과 차이 |
| TE-13-06 | [TBX-12](https://www.mlb.com/news/mets-relay-throws-out-cubs-jake-marisnick-at-home) | 중계 송구와 다른 수비수의 뒤쪽 백업 이동 | 백업을 양방향으로 나눴거나 한 명에게 집중한 조건은 불명 |
| TE-14-05 | [TBX-18](https://www.mlb.com/amp/news/near-home-run-in-nlcs-game-1-causes-chaos-on-basepaths.html) | 뒤 동료가 중계자의 송구 대상을 정해 전달 | 여러 콜의 충돌이나 외야수의 망설임은 기록에 없음 |
| TE-14-06 | [TBX-01](https://www.mlb.com/news/carlos-correa-throws-out-shohei-ohtani-as-twins-beat-dodgers) | 기사로 확인되는 중계자 이동과 다른 수비수의 커버만 비교 근거로 사용 | 기사 기반 참고이며 실제 영상·음성은 미검토; 무음 영상임을 확인한 사례가 아님. 발화·콜 유무 추정 금지 |

TE-03-02에는 기존 티볼 카드 `teeball_case_03`도 부분 관련 후보로 연결했다. [원래 팀 경기 회고](https://uehira.blogspot.com/2023/05/4.html?m=0)의 결승 문단은 외야 앞 라이너성 타구를 설명한다. 이 자료와 TBX-15의 뜬공 포구를 비교할 수 있으나 같은 타자·수비 위치·장면에서 높이만 달라진 비교는 아니다. 높이만으로 결과 차이가 났다고 단정하지 않는다.

## 이번 보강 뒤 현황

| 범위 | 상태 | 수 |
| --- | --- | ---: |
| 야구 비교 장면 | 기사 본문 확인·사람 미검토 | 19 |
| 질문–야구 비교 연결 | 핵심 기술 후보 8쌍 + 부분 관련 42쌍 | 50 |
| 공통 기술 질문 | 핵심 기술 후보 있음·사람 미검토 | 6 |
| 공통 기술 질문 | 부분 관련 경기 자료만 있음·사람 미검토 | 35 |
| 공통 기술 질문 | 관찰 범위 참고만 있음·영상 검증 보류 | 1 |
| 공통 기술 질문 | 참고 연결 없음 | 0 |
| 조건부 질문 | 규칙 대조 미완료 | 48 |

질문 13개에 참고 연결이 생겼다는 뜻이며 정확도·충분성·교사 승인을 뜻하지 않는다. 조건부 질문 48개는 이번 공통 기술 보강 집계와 별개다. 티볼 직접 카드 후보는 후보 10개·부분 관련 12개·후보 없음 68개다. 직접 후보 집계와 야구 비교를 포함한 현황을 혼동하지 않는다.

## 파일

- [이번 13개 연결 CSV](tactics-teeball-gapfill-2026-11-15.csv)
- [전체 질문별 근거 상태](tactics-teeball-coverage.csv)
- [전체 야구 비교 연결](tactics-teeball-baseball-links.csv)
- [원문 근거와 최소 사실 JSON](tactics-teeball-baseball-candidates.json)
- [Luna 원자료](tactics-luna-gapfill-2026-11-15.json) · [Luna 조사 메모](tactics-luna-gapfill-2026-11-15.md)

Luna의 원자료에는 통합 전 연결 제안과 영상 미관찰 보류가 포함되어 있다. 통합 CSV의 지원 근거·빠진 조건·용도 필드를 최종 조사 상태로 사용한다. 기사 게시일을 경기일로 사용하지 않았으며 경기일은 별도 확인 전 `null`이다.
