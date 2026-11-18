# 축구·피구 질문 공백 보충 조사 — 2026-11-15

축구의 SO-15와 피구의 DO-12/DO-13에 대해 공식 경기·대회 주최 측 원문을 열어 확인했다. 연결은 전부 `partial`로 제안한다. `matchDate`는 게시일과 구분했으며 원문에서 개별 경기일을 별도로 확인하지 못한 경우 `null`로 두었다. 원문 영상은 재생하지 않았고, 사용 권리는 확인되지 않았으며, 교육자·전문가 검토는 pending, 런타임 사용은 불가다. 피구 자료는 회피·위치 압박의 상황만 일부 보여준다. 팀 간격 유지나 코트 뒤·가장자리로 몰리지 않고 위치를 유지한 사실은 어느 자료에서도 확인되지 않는다.

## 축구 SO-15

| ID | 실제 경기 장면과 원문 | 날짜 근거 / 정확 locator | 부분 연결과 빠진 근거 |
| --- | --- | --- | --- |
| TLSD-01 | Paris Saint-Germain–Borussia Dortmund, UCL 준결승 2차전: Julian Brandt의 코너킥이 파 포스트에서 공간을 얻은 Mats Hummels의 헤더 득점으로 이어졌다. [UEFA 경기 보고](https://www.uefa.com/uefachampionsleague/news/028d-1ad595ace294-82328f2f6d36-1000--highlights-report-dortmund-beat-paris-to-reach-final/) | 게시일 2024-05-07. 본문 42행(코너킥·파 포스트 공간·헤더), 경기 제목과 순서는 4–18행. 경기 날짜는 게시일과 별도 확인하지 않아 null. | **SO-15-01~06 partial.** 세트피스 전달과 한 공격수의 위치·마무리는 뒷받침된다. 전체 선수 배치와 수비 전환, 역할·콜, 프리킥·스로인 상황은 기사에 없다. |
| TLSD-02 | Manchester City–Copenhagen, UCL 16강 2차전: Julián Álvarez의 코너킥을 Manuel Akanji가 발리로 연결해 득점했다. [UEFA 경기 보고](https://www.uefa.com/uefachampionsleague/news/028b-1a58e9f003fe-e058903a49c2-1000--report-city-cruise-into-quarter-finals/) | 게시일 2024-03-06. 본문 27행에 코너킥과 발리 득점, 제목·경기 요약은 4–20행. 경기 날짜 별도 확인 전 matchDate는 null. | **SO-15-01~06 partial.** 코너킥 이후의 슛 연결은 확인된다. 배치·조직적인 팀 이동·수비 대응 및 이후 재정렬은 적혀 있지 않다. |
| TLSD-03 | Porto–Arsenal, UCL 16강 1차전: 35분 Bukayo Saka 코너킥에서 William Saliba가 헤더를 했고, 종료 직전 Declan Rice 프리킥에서 Gabriel이 헤더했다. 두 장면 모두 득점은 아니었다. [UEFA 경기 보고](https://www.uefa.com/uefachampionsleague/news/028a-1a3cc57ad0b0-69ccf18a34b5-1000--highlights-report-late-galeno-stunner-gives-porto-win/) | 게시일 2024-02-21. 본문 28–29행에 두 헤더 기회; 경기명과 시간은 4–19행. 경기 날짜 별도 확인 전 matchDate는 null. | **SO-15-01~06 partial.** 두 종류의 재개 뒤 헤더 기회를 비교할 수 있다. 조직된 공격인지, 팀 전체 이동·수비 배치가 어떠했는지, 스로인 장면은 기사에 없다. |

세 사례는 모두 코너킥 또는 프리킥에서 실제 헤더·발리 기회나 득점까지 이어진 구간만 보충한다. 질문의 핵심인 세트피스 뒤 조직적인 양 팀 움직임 전부를 설명하는 자료로 쓰면 안 된다. 스로인 사례는 이번에 찾지 못했다.

## 피구 DO-12·DO-13

| ID | 실제 경기 장면과 원문 | 날짜 근거 / 정확 locator | 부분 연결과 빠진 근거 |
| --- | --- | --- | --- |
| TLSD-04 | Michigan State–Kent State, NCDA Summit Street Slugfest 2: 후반에 MSU가 3명만 남은 때 상대 투구를 피하고 재정비했으며, catch로 동료가 복귀했다. [NCDA 경기 회고](https://ncdadodgeball.com/blog/summit-street-slugfest-2-the-sluggening-recap-2/5878) | 게시일 2015-10-15(본문 63행). 25–28행은 Kent 경기, 특히 27행은 세 명만 남은 시점의 회피·재정비·catch를 설명한다. 개별 경기일은 별도 확인하지 않아 null. | **DO-12-01~06 partial.** 회피 뒤 플레이를 계속했다는 최소 공통 행동만 확인된다. 팀 간격, 상대와의 거리, 공의 진행 방향·회피 방식은 없다. DO-13 위치 유지는 뒷받침하지 않는다. |
| TLSD-05 | Ohio State–Michigan State, NCDA Summit Street Slugfest 2: 전반 MSU에 두 선수만 남았을 때 코너의 Matt Jones에게 팀 투구가 갔다. 그는 넘어지며 catch했고, 발을 인바운드에 두어 동료가 복귀했다. [NCDA 경기 회고](https://ncdadodgeball.com/blog/summit-street-slugfest-2-the-sluggening-recap-2/5878) | 게시일 2015-10-15. 15–18행 중 16행은 코너의 Jones를 향한 팀 투구, 17행은 넘어지는 중 catch·발의 경계선 유지·동료 복귀를 설명한다. 개별 경기일은 별도 미확인. | **DO-12-01~06 partial; DO-13-01~06 partial.** 코너에서 투구 압박을 받은 상황과 catch는 자료가 된다. 하지만 회피·간격 유지 사례가 아니며 코너나 후방을 벗어나 위치를 유지한 것도 아니다. 가장자리 압박의 대조 상황으로만 제한한다. |
| TLSD-06 | Resistance–Venom, NDA Morgantown 2025 결승: 팀 투구에 대한 catch 뒤 dodge가 이어져 Resistance가 2대1 선수 우위를 얻었다. [NDA 대회 회고](https://www.ndadodgeball.com/blog-posts/nda-morgantown-2025-recap) | 게시일 2025-06-06(본문 1–9행). 결승 흐름은 39–48행, 특히 46행에 팀 투구·catch·이후 dodge와 수적 결과가 나온다. “지난 주말”이라고만 하여 개별 경기일은 null. | **DO-12-01~06 partial.** 실제 dodge와 상황 변화는 확인되나 팀 간격·회피 방향·위치 유지 정보는 없다. DO-13을 연결할 위치 근거도 없다. |

### 규칙·적용 범위

피구 출처는 NCDA 대학 클럽 경기 2건과 NDA 대회 결승 1건이다. 규칙과 공 종류가 같은 경기로 합쳐 보지 않는다. NCDA 회고는 10초 shot clock, 10개 공, catch 후 동료 복귀를 서술하지만 해당 경기의 공 재질은 원문에서 확인되지 않는다. NDA 회고의 선택 장면은 공 재질·정확한 코트 내 인원·catch 복귀 효과를 명시하지 않는다. 인원, 공 종류, 복귀 규칙은 대회 및 피구 규칙에 따라 달라질 수 있으므로, 본문에 없는 내용을 보충하거나 수업 규칙에 그대로 옮기지 않는다.

DO-12의 공통분모는 기록된 투구 압박 뒤 회피 또는 catch 후 플레이가 이어졌다는 정도다. DO-13은 실제로 코너에서 투구를 받은 장면 외에는 위치를 말할 근거가 없다. 이 자료로 팀 간격 유지, 뒤쪽이나 가장자리에 몰리지 않는 이동, 특정 회피 동작, 코트 좌표, 선수의 말이나 콜을 추정하지 않는다.

## 검토 상태

각 후보의 교육자·전문가 검토는 pending, 권리 상태는 미확인(`unverified`), 영상 검토 상태는 미재생(`not-viewed`), `runtimeEligible=false`다. JSON에는 질문별 뒷받침·누락 조건과 출처 locator를 기록했다.
