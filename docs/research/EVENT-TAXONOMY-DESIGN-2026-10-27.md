# Event taxonomy design: chronological events, kneels, spikes, kicks, conversions, penalties and period transitions

Status: design only. No code or profile changes. This document sets the structure that the next revisions will build. The counts are regular-season, 2022 to 2026, from the nflverse play-by-play, unless marked.

## 1. Principle

Four dimensions are kept separate, so no one field has to answer more than one question.

1. **Event history.** Every event in the game, in order, with no deletions. Each event has a type, the source flags, and the source text. Nothing is removed from this layer.
2. **Statistical accounting.** What the official record credits: rush and pass attempts, sacks, completions, yards, fumbles, interceptions, touchdowns, returns, kicks and penalties. Built from source flags and checked against the official team stats.
3. **Coach decision categories.** The designed calls that a coach made: run or pass, formation, personnel, concept, route, coverage. These are observed only where the source records them, and only for designed plays. Decisions that are not play calls (kneels, spikes, kicks) get their own decision categories.
4. **Physical execution categories.** What happened on the snap or kick: a clean snap, a fumbled snap, a dropped kicking operation, a made, missed or blocked kick, a return, a touchback, a fair catch. Execution is recorded as it happened. Intent is never inferred from it.

A play may appear in layers 2 to 4 with different labels. It appears once in layer 1.

## 2. Event types, with source fields

| Event type | Source identification | Count 2022 to 2026 | Layer 2 credit | Layer 3 decision | Layer 4 execution |
|---|---|---:|---|---|---|
| Scrimmage run | `play_type` = run | 62,668 | Rush attempt, yards | Designed call, observed | Handoff result |
| Scrimmage pass | `play_type` = pass | 84,649 | Pass attempt, completion, yards | Designed call, observed | Pass result |
| Sack | `sack` = 1 on a pass play | 1,287 (2025 check) | Sack, sack yards | None (outcome) | Sack |
| QB kneel | `play_type` = qb_kneel | 1,852 | Rush attempt? (to confirm against official rules) | Clock decision: kneel | Kneel |
| QB spike | `play_type` = qb_spike | 317 | Pass attempt flag set in source; counted in official attempts | Clock decision: spike | Spike |
| Kickoff | `play_type` = kickoff | 12,098 | Kickoff, return yards | Kick decision (no direction in source) | Kick result: touchback, returned, out of bounds, downed, fair catch |
| Punt | `play_type` = punt | 9,241 | Punt, return yards | Punt decision | Punt result: returned, fair catch, downed, blocked, touchback |
| Field goal | `play_type` = field_goal | 4,772 | Field goal attempt and result | Kick decision | Made, missed, blocked |
| Extra point | `play_type` = extra_point | 5,365 | Extra point attempt and result | Kick decision | Made, missed, blocked |
| Two-point conversion | `two_point_attempt` = 1 (run or pass) | 550 | Conversion attempt and result | Conversion decision (separate) | Success or failure, as recorded |
| Run or pass from kicking formation | Description with punt or field-goal formation, run or pass play type | 94 | Attributed as recorded | Special-teams decision, intent only where source text states it | Direct snap fumble (2), aborted kicking operation (8), or unknown |
| Aborted snap | `aborted_play` = 1, text "FUMBLES (Aborted)" | 368 run or pass (plus 7 no-play) | Per source | None (intended play unknown) | Fumbled snap |
| Aborted, handling unknown | `aborted_play` = 1, other text | 53 run (plus 2 no-play) | Per source | None | Unknown handling |
| Penalty or no-play | `play_type` = no_play, penalty flags | 19,983 | Penalty yards, down and distance effects | None | Penalty |
| Administrative marker | Period ends, game delays, timeouts, two-minute warnings, game start and end, replay and clock notes (blank play type, or timeout text on a no-play row) | 14,933 | None | None | None |

Kick direction (left, middle, right) for kickoffs and punts is not in any source. The descriptions name the kicker, the distance and the landing spot only. Until a source is found, these events are recorded without direction.

## 3. What the event history must carry

The current per-play profile records carry play type, yards, touchdown and interception attributes. They do not yet carry the rush attempt, pass attempt, sack, fumble, fumble lost, penalty and score flags. Drive, possession and clock accounting need all of them, so the event history must add:
- rush attempt, pass attempt, sack, scramble, fumble, fumble lost, interception, touchdown, safety, penalty flags;
- drive identifier, possession team, period, clock, score before and after;
- the source text;
- FTN `is_motion`, kept on every play that FTN charts (TRUE or FALSE). It is a play-level flag: it says whether any player was in motion, not which player or whether a receiver. It is null where the play is not charted, and the availability field says so.

## 4. Checks before any simulator use

1. Every event in layer 1 has exactly one event type.
2. Layer 2 totals reconcile with the official team stats for each team-season: carries, attempts, sacks, yards and touchdowns. The 2025 check so far: sacks exact, carries within 32 league-wide, passing differences explained by two-point passes. The open exceptions are in `ABORTED-EVENT-AUDIT-2026-10-27.md`.
3. Layer 3 contains only designed plays with observed labels. Kneels, spikes, kicks, conversions, aborted and unknown-handling plays are excluded from the designed-call denominators, and each exclusion is named.
4. No layer 4 label is used as evidence of a designed call.
5. Counts in each layer sum to the event history total for the same season and team.

## 5. Order of work

1. Add the missing flags and the drive and clock fields to the event history, for all event types, without changing any profile.
2. Reconcile layer 2 against the official team stats, team-season by team-season, for 2022 to 2025.
3. Build layer 3 from the observed designed plays, with exclusions named.
4. Only then consider the simulator's use of these events.

Nothing here changes a simulator default or uses the 2026 holdout for selection.
