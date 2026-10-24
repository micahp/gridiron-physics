# 2025–2026 coaching continuity

Frozen as of the Oct. 22, 2026 pregame snapshot. Machine-readable records are in `data/teams/coaching-continuity-2026-10-22.json`.

| Team / side | 2025 title and caller | 2026 title and caller | Continuity assessment |
|---|---|---|---|
| NE head coach | Mike Vrabel | Mike Vrabel | Same head coach. |
| NE offense | Josh McDaniels, OC and offensive play caller | Josh McDaniels, OC and play caller | Same coordinator and caller. |
| NE defense | Terrell Williams was appointed DC; Zak Kuhr assumed defensive play calling during the season, from Week 2 onward | Zak Kuhr, DC and caller | DC title changed; the caller had already led most of the 2025 defense. Treat as caller continuity, not proof of an unchanged scheme. |
| CHI head coach | Ben Johnson, head coach and offensive play caller | Ben Johnson, head coach and offensive play caller | Same head coach and caller. |
| CHI offense | Declan Doyle, OC; Ben Johnson called plays | Press Taylor, OC; Ben Johnson called plays | Coordinator title changed, but Doyle did not call plays under Johnson. Play-caller continuity is stronger evidence than OC-title turnover. |
| CHI defense | Dennis Allen, DC and defensive play caller | Dennis Allen, returning DC; caller reported as Allen | Same coordinator and likely same caller. Confidence is medium because the 2026 caller statement is in the Patriots' official matchup preview; Chicago's official staff notice confirms the coordinator return but does not state the call assignment directly. |

## Simple continuity model

The record tracks three separate identities: head coach, side coordinator, and actual play caller. A confirmed same person scores 1, a confirmed change scores 0, and an unverified identity is `null`. These are staff-continuity indicators, not a scheme similarity score. Coordinator title changes do not automatically create an assumed playbook change.

The model retains 2025 observed frequencies as the prior. PBP-only 2026 Weeks 1–6 profiles are supplied as descriptive comparisons. No coaching-effect adjustment is applied: a change in observed frequency does not establish that a coach caused it, and 2026 participation data was not available for a matching formation/personnel analysis. Play-action and motion are missing from the pinned PBP schema. Some official 2026 team articles report those concepts, but without row-level play IDs and complete denominators they are not merged into the machine-readable frequency profile.

## Official sources

- [Patriots 2025 staff announcement](https://www.patriots.com/news/patriots-announce-new-additions-to-coaching-staff-x8810) and [2026 coaching roster](https://www.patriots.com/team/coaches-roster/).
- [Patriots on Kuhr taking over defensive play calling in 2025](https://www.patriots.com/news/patriots-linebackers-coach-zak-kuhr-stepping-up-as-defense-s-primary-play-caller) and [Kuhr's official 2026 profile](https://www.patriots.com/team/coaches-roster/zak-kuhr).
- [Patriots on McDaniels as the 2026 play caller](https://www.patriots.com/news/patriots-position-snapshot-quarterbacks-x3476) and the [2025 McDaniels hire and play-calling role](https://www.patriots.com/news/analysis-breaking-down-josh-mcdaniels-s-offense-and-how-it-fits-patriots-qb-drake-maye).
- [Bears 2025 staff announcement](https://www.chicagobears.com/news/bears-add-to-coaching-staff) and [2026 staff promotion](https://www.chicagobears.com/news/chicago-bears-announce-coaching-staff-promotion-and-additions).
- [Johnson calling plays in 2025](https://www.chicagobears.com/news/ben-johnson-bears-offense-still-a-work-in-progress-caleb-williams-passing-running-backs) and [Johnson retaining play-calling while Taylor replaces Doyle as OC](https://www.chicagobears.com/news/bears-hc-ben-johnson-believes-in-new-oc-running-backs-coach).
- [Bears identifying Allen as the 2025 defensive play caller](https://www.chicagobears.com/news/how-c-j-gardner-johnson-the-energizer-bunny-helped-bears-complete-fourth-quarter-comeback-vs-giants); [2026 Bears confirmation of Allen's DC return](https://www.chicagobears.com/team/coaches/dennis-allen); and the [Oct. 21 Patriots matchup report identifying Allen as a play caller](https://www.patriots.com/news/patriots-gameplan-maye-off-play-action-johnson-s-staples-and-key-matchups-in-thursday-night-football-vs-the-bears).
