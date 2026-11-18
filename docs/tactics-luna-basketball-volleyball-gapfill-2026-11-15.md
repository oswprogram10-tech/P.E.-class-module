# Basketball and volleyball gap-fill research (2026-11-15)

These are four official league/federation match-report sources proposed as **partial** evidence for BA-08, BA-15, and VO-13. The six prompt phrasings within each family share the same evidence boundary. No article quotes are reproduced. Embedded or linked videos were not played; descriptions below rely on article text. Every link remains pending human, educator, and expert review, and is not runtime eligible.

## Cases

| Case | Source / scene | Date handling | Best-supported connection | Main limit |
|---|---|---|---|---|
| LBBV-01 | [NBA.com: Film Study—How LeBron James leads Lakers' transition offense](https://www.nba.com/news/film-study-lakers-transition-lebron-james-anthony-davis), “Passing Ahead,” Play 1, line 230: McGee rebounds for the Lakers–Bucks, gives the ball to James, who passes ahead to Green for an open shot. | Published 2020-05-13. `matchDate` null because the cited passage does not identify the match date. The article describes other separate plays, which are not combined in this case. | BA-08-01–06: rebound followed by an outlet and pass ahead; BA-15-01–06: observable rebounder, advancing passer, and receiver roles. | This case is limited to one Lakers–Bucks sequence. Verbal communication is not reported. Embedded clip not played. |
| LBBV-02 | [NBA.com: Timberwolves–Lakers: 4 takeaways from a showdown in L.A.](https://www.nba.com/news/4-takeaways-timberwolves-lakers-oct-24), opening match recap, lines 168–171: Dončić defensive rebound, advance pass to Reaves, run, return pass, and dunk. | Published 2025-10-25. The body says Friday night but does not print an ISO match date; `matchDate` null. | BA-08-01–06: rebound-to-fast-attack sequence. BA-15-01–06: rebounder/runner and pass receiver have different movement roles. | The recap does not describe the full defensive response or any spoken role assignment. Video not played. |
| LBBV-03 | [USA Volleyball: U.S. Men Block Way Past Costa Rica to Start 2026 Men's Pan Am Cup](https://usavolleyball.org/story/u-s-men-block-way-past-costa-rica-to-start-2026-mens-pan-am-cup/), second-set sequence, lines 229–232. After an apparent communication lapse on a ball that seemed to be going out, Rogers saved it and Gooch sent it back over. | Match date 2026-08-09 is explicit at line 221 and in the schedule. No separate exact publication date verified, so `publishedDate` null. | VO-13-01–06: the strongest fit; the recap explicitly describes communication trouble around a difficult-looking ball and then names two subsequent actions. | The report does not identify who said what, who was expected to receive the ball, or how responsibility was decided. Video not played. |
| LBBV-04 | [USA Volleyball: U.S. Men to Play for Paris Bronze After 5-Setter with Poland](https://usavolleyball.org/story/u-s-men-to-play-for-paris-bronze-after-5-setter-with-poland/), third-set rally at lines 242–246: libero Pawel Zatorski collided with setter Marcin Janusz. | Match date 2024-08-07 is explicit at line 221. The USA Volleyball archive/search listing gives the same date for publication; body has no separate publication timestamp. | VO-13-01–06: weak contextual comparison only, for teammate contact during a rally. | Collision alone does not show an ambiguous ball, miscommunication, or role assignment. The article does not say that the players approached the same ball. Do not infer cause, intention, or what either player saw. Video not played. |

## Question-level link plan

Every link below is `partial`; the JSON records the full `supported` and `missing` conditions per question ID.

- **BA-08-01–06:** LBBV-01 and LBBV-02. Supported: rebound followed by an outlet/pass ahead or a run and a fast attacking sequence. Missing: full context/spacing and a direct match to a particular team situation; LBBV-01 is restricted to one Lakers–Bucks play while the source article also describes distinct plays elsewhere.
- **BA-15-01–06:** LBBV-01 and LBBV-02. Supported: visible role sequence among rebounder, advancing passer, and receiver/runner. Missing: actual spoken communication or explicit verbal role assignment.
- **VO-13-01–06:** LBBV-03 is the primary partial source because its prose explicitly reports an apparent communication lapse on a ball that seemed to be going out, then rescue/return actions. LBBV-04 is only a weak additional comparison about teammate collision during a rally. Neither source substantiates a specific call or prior role decision; LBBV-04 does not establish that both players pursued the same ball, ambiguity, or miscommunication.

## Review and evidence boundaries

- `matchDate` is null when the source does not give an explicit date for the exact scene. Article publication and match dates are separate fields in the JSON.
- All links remain `humanRelevanceReviewStatus: pending`, `educatorReviewStatus: pending`, `expertReviewStatus: pending`, and `runtimeEligible: false`.
- All four sources are official NBA or USA Volleyball reporting. No linked videos were watched. Do not describe video-derived details as observations.
- Volleyball collision and basketball transition role comparisons are cross-sport analogies, not identical game conditions.
