# 티볼–야구 경기 사례 비교 조사

조사일: **2026-11-15**

티볼 질문 v2의 공통 기술을 비교할 야구 경기 장면 19개를 기사 본문과 대조했다. 기존 8개를 재검토하고, 사용자가 지정한 Luna(`gpt-6-luna`)가 두 조사 묶음에서 찾은 새 장면 11개를 부모 에이전트가 원문과 다시 대조해 추가했다. 아래 기록은 경기 장면 후보이며, 최선의 전술이나 학생 팀에 대한 실행 지시가 아니다. 모든 장면은 야구로 유지한다.

구조화한 근거는 [후보 JSON](tactics-teeball-baseball-candidates.json), 질문별 임시 연결은 [연결 CSV](tactics-teeball-baseball-links.csv)에 기록했다. 기존 티볼 직접 후보 필드에는 야구 ID를 넣지 않고 조사 리드 필드에만 추가했다. 기존 앱은 이 자료를 읽지 않으며, 런타임 티볼 카드는 늘리지 않았다. TE-03-02의 기존 라이너성 타구 카드를 부분 관련으로 재연결해 티볼 직접 후보 공백은 69개에서 68개가 됐다.

현재 19개 장면에 대해 50개 질문–사례 연결을 제안했다. 대상 질문은 36개이며, 요청한 핵심 비교 기술의 근거가 있는 후보 8쌍·부분 관련 참고 42쌍이다. 이 중 TE-14-06의 1쌍은 관찰 범위 참고이며 실제 영상 검증을 대신하지 않는다. 후보는 질문의 모든 조건이 일치한다는 뜻이 아니다. 한 질문에 여러 사례가 붙을 수 있어 연결 수와 질문 수는 다르다. 기존 21쌍 중 3쌍은 원문 재대조로 부분 관련으로 낮췄다. 후속 16쌍과 이번 빈 질문 보강 13쌍도 AI가 대조했으며 사람 관련성 검토는 모두 대기 중이다. [기존 연결 재검토](tactics-teeball-link-review.md), [질문별 공백 현황](tactics-teeball-coverage.md)을 참조한다.

## 기사에서 확인한 범위

| ID·비교 관점 | 출처에서 확인한 최소 사실 | 근거 위치 |
| --- | --- | --- |
| TBX-01 · 중계 위치·회전 | Kirilloff는 우측으로 이동한 Correa에게 연결했다. Correa는 돌아서 송구했고 Julien은 2루를 맡았다. [출처](https://www.mlb.com/news/carlos-correa-throws-out-shohei-ohtani-as-twins-beat-dodgers) | Correa positions and throws; 본문 110, 120, 132–133행 |
| TBX-02 · 중계 중 시야 확인 | Smith가 Newman에게 연결했다. Newman은 Marte의 콜을 듣지 못해 받은 뒤 돌아보았다. [출처](https://www.mlb.com/news/d-backs-rally-late-to-beat-tigers) | Newman couldn’t hear Marte; 본문 120–131행 |
| TBX-03 · 타구 백업에서 중계로 | Kwan이 뒤에서 타구를 회수해 Rocchio에게 연결했고 Rocchio가 다음 송구를 했다. [출처](https://www.mlb.com/news/lane-thomas-guardians-12-inning-win-over-yankees) | 본문 130–131행; Kwan·Rocchio의 중계 설명 |
| TBX-04 · 악송구 백업과 빈 수신 위치 | Dickerson의 송구가 중계자를 넘었다. Peralta가 백업했지만 Tromp도 공을 쫓아 홈을 비웠다. [출처](https://www.mlb.com/giants/news/giants-hit-3-homers-drop-series-opener) | 본문 181–186행; Dahl 타구 이후 수비 설명 |
| TBX-05 · 경계 뜬공·서로 다른 콜 설명 | Rios·Odor 사이에 뜬공이 떨어졌다. 콜 여부를 설명한 선수와 기록원의 진술이 달랐다. [출처](https://www.mlb.com/news/error-ruling-on-david-ortizs-pop-fly-ends-yu-darvishs-bid-for-perfect-game/c-74977316) | 본문 109–124행; 선수 설명과 공식 기록원의 해석을 각각 확인 |
| TBX-06 · 콜 이후에도 포구 실패 | Kurtz와 Clarke가 같은 뜬공으로 접근했다. Clarke가 콜했으나 공을 잡지 못했다. [출처](https://www.mlb.com/guardians/news/athletics-nick-kurtz-makes-first-trek-into-outfield-in-fall-league) | 본문 176–181행; 3회 Briceño 타구 |
| TBX-07 · 외야수 사이 포구 담당 콜 | Doyle은 Beck에게 콜한 뒤 뜬공을 잡았다고 설명했다. [출처](https://www.mlb.com/news/ryan-feltner-earns-first-win-since-april-for-rockies) | 본문 132–138행; Doyle의 콜 설명 |
| TBX-08 · 짧은 땅볼 뒤 빈 베이스 지원 | Lowe가 짧은 땅볼을 처리한 뒤 1루를 지원한 King에게 던졌지만 King이 잡지 못했다. [출처](https://www.mlb.com/news/matt-bush-texas-bullpen-piece-together-nine-innings) | 본문 134행; slow grounder to first 설명 |
| TBX-09 · 느린 땅볼에 전진했으나 처리 실패 | Mercer는 느린 땅볼에 전진했으나 처리하지 못했다. [출처](https://www.mlb.com/news/pirates-jordy-mercer-strong-on-defense-in-rain/c-135813232) | 본문 185–190행; Scruggs의 slow roller 처리 문단 |
| TBX-10 · 중앙 쪽 출발 위치와 땅볼 접근 | Swanson은 중앙에 가까운 출발 위치에서 짧게 이동해 땅볼을 처리했다. [출처](https://www.mlb.com/news/the-secret-to-atlantas-defensive-turnaround) | 본문 178–182행; NLDS Game 3 Swanson 출발 위치·땅볼 접근 |
| TBX-11 · 송구 방향 변화와 중계 위치·정보 전달 | McLain은 송구 방향에 맞춰 위치를 바꿨다. 뒤에서 정보를 전달할 동료가 가까이 없었다. [출처](https://www.mlb.com/reds/news/reds-lapse-on-defense-aids-braves-late-rally) | 본문 233–250행; 특히 239–247행 중계 위치 변경과 정보 전달 공백 |
| TBX-12 · 중계 수신·회전과 뒤쪽 백업 이동 | Guillorme가 중계 공을 받아 돌아서 송구했다. Lugo는 홈 뒤 백업 위치로 달려갔다. [출처](https://www.mlb.com/news/mets-relay-throws-out-cubs-jake-marisnick-at-home) | 본문 108–110행; 홈 뒤 백업 이동·Pillar–Guillorme 연결 |
| TBX-13 · 라인 쪽 첫 발과 출발 위치 | McGonigle은 출발 위치에서 라인 쪽으로 먼저 움직인 뒤 땅볼을 막고 송구했다. [출처](https://www.mlb.com/dbacks/news/kevin-mcgonigle-shines-on-defense-behind-justin-verlander) | 본문 238–241행; pre-pitch positioning·첫 발·라인 쪽 타구 접근 |
| TBX-14 · 앞쪽 타구 대비 배치 뒤 머리 위 뜬공 | 얕게 선 Williams의 머리 위로 Rosario의 뜬공이 넘어갔다. 앞쪽의 약한 타구를 대비한 배치였다. [출처](https://www.mlb.com/phillies/news/carlos-santana-nola-strong-in-phillies-loss-c270848420) | 본문 159–167행; outfield positioning·weaker contact 설명 |
| TBX-15 · 얕은 외야 위치에서 뒤 타구를 추적해 포구 | 얕게 선 Martin이 뒤쪽으로 날아온 타구를 달려가 잡았다. [출처](https://www.mlb.com/twins/news/twins-sweep-red-sox-at-fenway-park) | 본문 148–154행; Martin의 얕은 출발 위치·running catch 설명 |
| TBX-16 · 같은 내야 땅볼로 두 수비수가 접근 | Arcia와 Hiura가 같은 땅볼로 접근하다 충돌했다. [출처](https://www.mlb.com/amp/news/orlando-arcia-leaves-game-keston-hiura-collide.html) | 본문 13, 26–31행; 두 선수의 출발 위치·같은 땅볼 접근 및 Hiura 설명 |
| TBX-17 · 외야 4명 배치와 왼쪽 내야 공간 | Tigers는 외야 4명 배치를 사용했고 왼쪽 내야에 공간이 남았다. [출처](https://www.mlb.com/news/tigers-use-extreme-shift-vs-joey-gallo) | 본문 109–123행; 네 명 외야·내야수 이동·비어 있는 왼쪽 설명. 131행 실제 타구는 중앙 땅볼로 명시 |
| TBX-18 · 동료가 중계자의 송구 대상을 알려줌 | Turang이 송구 대상을 알려주자 Ortiz가 중계 송구를 이어갔다. [출처](https://www.mlb.com/amp/news/near-home-run-in-nlcs-game-1-causes-chaos-on-basepaths.html) | 본문 33–35행; Turang의 대상 전달·Ortiz의 수신 회고 |
| TBX-19 · 중계 수신 실패 뒤 백업 부재 | 중계 송구를 Smith가 잡지 못했고 뒤쪽 백업도 없었다. [출처](https://www.mlb.com/news/world-series-game-4-2020-recap) | 본문 168–175행; 중계 송구·수신 실패·백업 부재 |

이 표의 날짜 메타데이터는 기사 게시일이다. 경기 날짜는 별도 대조 전 `null`이며 게시일을 경기일로 자동 채우지 않았다. 근거 위치는 이번 접근 당시 기사 절·본문 행으로 기록했고, 행 번호가 달라지면 절 제목과 선수 이름으로 다시 찾는다. 영상은 직접 재생·관찰하지 않았으므로 기사에 없는 좌표·시각·콜 문구를 추가하지 않는다.

## 비교 적용 범위

중계 위치·수신 뒤 방향 확인·역할 분담·백업·콜만 공통 기술로 비교한다. 타격 방식, 수비 인원, 거리, 공의 차이는 검토 시 함께 표시한다. 실제 야구 장면에 투수나 포수가 등장하더라도 비교 대상은 타격 뒤 수비 역할이다. 티볼에 같은 포지션이 있다는 뜻이 아니며, 투구·도루·번트 작전은 조사 대상으로 넣지 않는다. 아웃·주루·득점 판단까지 넓히려면 티볼 규칙을 확인한 별도 조건부 연결이 필요하다. 이번 묶음에는 조건부 연결을 만들지 않았다.

질문의 조건 중 일부가 기사에 없으면 부분 관련으로 표시했다. 예를 들어 백업이 존재하는 장면을 백업이 전혀 없는 질문의 완전 일치 사례로 세지 않고, 콜만 있는 기록으로 후속 백업까지 있었다고 쓰지 않는다. 선수 회고와 다른 해석이 함께 있는 자료는 그 차이를 유지한다.

## 티볼 직접 사례의 다음 조사 경로

일본소년야구연맹 공식 안내에서 오타구청장배 경기별 영상 임베드 6개를 찾았다. [공식 경기 중계 안내](https://east.boys-app.com/branch/shogaku/15092/)의 3월 1일 경기 목록을 `TBL-02`로 기록했다. 첫 영상 임베드 fetch는 throttled로 실패해 플레이는 확인하지 못했다. 대회 중계 링크의 존재와 특정 수비 장면의 확보를 구분하며, 영상 시각을 추측해 넣지 않는다.

## Luna 조사와 통합 시 수정한 범위

Luna 원자료는 [조사 JSON](tactics-luna-research-2026-11-15.json)과 [조사 메모](tactics-luna-research-2026-11-15.md)에 보존했다. `TLR-01`~`TLR-05`는 통합 후보 `TBX-09`~`TBX-13`에 대응한다. 원자료의 연결 제안은 최종 판정이 아니며 아래 수정 후 통합 CSV를 기준으로 한다.

- 중앙 쪽 출발 위치를 홈 방향 전진으로 표현하지 않았다.
- 뒤 동료의 정보 전달 공백을 악송구 회수 백업의 부재로 해석하지 않았다.
- 송구 방향에 따른 중계 위치 변경과 옆으로 굴러가는 타구에 따른 변경을 구분해 후자의 질문에는 부분 관련으로 연결했다.
- 모든 경기일 필드는 별도 대조 전 `null`로 유지했다. 기사 게시일만 정확한 날짜 메타데이터로 기록했다.
- 짧은 타구 길이, 선수별 능력에 따른 배치, 여러 내야수 사이의 간격이 없는 자료는 완전한 일치 사례로 올리지 않았다.

## 빈 질문 13개 부분 관련 보강

Luna가 찾은 새 자료 6개와 기존 자료를 사용해 13개 질문에 각각 참고 연결을 추가했다. [13개 질문별 근거·한계](tactics-teeball-gapfill-2026-11-15.md)에 이번 연결을 정리했다. 원자료는 [Luna gap-fill JSON](tactics-luna-gapfill-2026-11-15.json), [조사 메모](tactics-luna-gapfill-2026-11-15.md)에 보존했다. 이번 모든 새 연결은 부분 관련이며, 실제 영상·음성이 없는 TE-14-06은 관찰 범위 참고로만 표시했다.

## 남은 일

공통 기술 질문 42개 중 핵심 비교 후보가 있는 질문은 6개, 부분 관련 경기 자료만 있는 질문은 35개, 관찰 범위 참고만 있는 질문은 1개다. 최소 참고 연결이 없는 질문은 0개이며, 관찰 범위 참고를 실제 영상 검증 완료로 세지 않는다. 이는 승인이나 검색 성능 수치가 아닌 조사 현황이다. [질문별 현황 CSV](tactics-teeball-coverage.csv)에 기록한 부분 관련 후보의 불일치 조건을 보완하고 관찰 범위 참고 질문은 실제 자료가 제공된 뒤 별도로 검증한다. 조건부 질문은 실제 적용할 티볼 규칙의 출처·판본과 경기 규칙을 대조한 뒤 연결한다. 이용 조건·교사/코치 검토는 모두 미완료다.
