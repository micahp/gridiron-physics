# Play classification, rev4

Status: rev4 is built and reconciled. rev3 and the source observations are unchanged. This is the classification report that accompanies the rev4 commit. It covers run and pass snaps only. Special-teams events that are not run or pass snaps (kickoffs, field goals, extra points, punts that are not fakes, QB kneels and QB spikes) are not yet classified and are listed under open items.

Output: `/root/lp-snapshots/nfl-team-season-playbooks-2026-10-27-rev4` (outside git). Its BUILD-REPORT and manifest are committed under `data/playbooks/research-2026-10-27-rev4/`. The comparison with rev3 is `pipeline/compare_rev3_rev4.py`.

## 1. Rules

Each regular-season run or pass snap with a team on each side gets exactly one class (`snap_type`). A play sits in one denominator at most.

| Class | Rule | Enters ordinary play selection? |
|---|---|---|
| `two_point_conversion` | Source `two_point_attempt` = 1 (the description text agrees on every play) | No. Reported in its own conversion block. |
| `special_teams_run_pass` | Description has "(Punt formation)" or "(Field Goal formation)" and the play is a run or pass | No. Reported in the special-teams block. |
| `aborted_snap` | Source `aborted_play` = 1 and the description says the ball was fumbled on the snap ("FUMBLES (Aborted)") | No. Kept in the play history and in game totals. |
| `aborted_play` | Source `aborted_play` = 1 and the description says the player called the play off ("X aborted.") | No. Kept in the play history and in game totals. |
| `scrimmage` | Everything else with a down of 1 to 4 | Yes. This is the ordinary run and pass sample. |
| `other_scrimmage` | Everything else without a down | No. Count is 0 in 2022 to 2026. |

Formation origin is recorded for special-teams plays (`punt` or `field_goal`). Execution type is one of:
- `broken_kick`: the source flags the snap as aborted (`aborted_play` = 1).
- `designed_fake`: the description states a fake. No description in 2022 to 2026 does, so this count is 0.
- `unknown`: anything else. Intent is never inferred from the formation, the action, or the outcome.

The two-point class takes precedence over the formation rules. The aborted classes apply only to run and pass snaps that are not special-teams. The 10 aborted plays that carry a punt or field-goal formation are `special_teams_run_pass` with `broken_kick`.

## 2. Counts by season (run and pass snaps, regular season)

| Season | Scrimmage | Aborted snap | Aborted play | Two-point | Special teams | Total |
|---:|---:|---:|---:|---:|---:|---:|
| 2022 | 33,519 | 94 | 12 | 118 | 27 | 33,770 |
| 2023 | 33,721 | 82 | 9 | 121 | 24 | 33,957 |
| 2024 | 33,204 | 93 | 16 | 135 | 22 | 33,470 |
| 2025 | 32,712 | 75 | 11 | 128 | 15 | 32,941 |
| 2026 (Weeks 1 to 7) | 13,096 | 24 | 5 | 48 | 6 | 13,179 |
| **Total** | **146,252** | **368** | **53** | **550** | **94** | **147,317** |

147,317 is the run and pass universe in the play-by-play, with no play left unclassified and no play missing a team. The total matches the eligible offense count in the rev4 profiles.

Special teams, by execution: `punt|unknown` 74, `punt|broken_kick` 9, `field_goal|unknown` 10, `field_goal|broken_kick` 1. The punt-origin plays were the 83 fake punts from earlier revisions. Their class is unchanged from rev3.

Two-point conversions: 550 attempts. Action: 401 pass, 149 run. Result: 262 success, 288 failure, as recorded in the source.

## 3. Formation coverage

Ordinary plays (scrimmage class): 146,252. Observed formation labels: 133,014. Missing: 13,238.

Missing splits into 13,096 plays from 2026, where participation data does not exist, and 142 plays from 2022 to 2025. The 142 are the 162 gap plays from the formation audit, less the 20 that now sit in other classes (12 two-point, 7 field-goal-origin, 1 aborted snap). Missing is counted and never imputed.

## 4. rev3 versus rev4 impact

Offense, all team-seasons:

| Quantity | rev3 | rev4 | Change |
|---|---:|---:|---:|
| Ordinary plays | 147,234 | 146,252 | -982 |
| Formation observed | 133,897 | 133,014 | -883 |
| Formation missing | 13,337 | 13,238 | -99 |
| Punt-origin special plays | 83 | 83 | 0 |

The 982 plays that left the ordinary sample are 550 two-point, 368 aborted snaps, 53 aborted plays and 11 field-goal-origin plays. Each team-side drop equals the plays that left, with 0 mismatches. The 883 + 99 split of the observed and missing change also sums to 982.

Defense ordinary plays change by the same 982, from 147,234 to 146,252.

Per-play classes in rev4 change only where the rules above differ from rev3. rev3 had no classes for two-point, aborted or field-goal-origin plays, and those were all in the ordinary sample.

## 5. DEN at LAC 2025 sensitivity

Formation tendency over observed ordinary offense plays, 2025, with missing counted separately.

| Formation | All games | Excluding 2025_03_DEN_LAC |
|---|---:|---:|
| SHOTGUN | 20,069 (61.44%) | 20,003 (61.41%) |
| UNDER CENTER | 10,990 (33.64%) | 10,962 (33.65%) |
| PISTOL | 1,608 (4.92%) | 1,607 (4.93%) |
| Missing | 45 | 13 |

The game changes no share by more than 0.03 points. DEN at LAC is reported as a game-level coverage gap (95 of 127 run and pass plays had a formation). Formation tendencies are reported over observed plays, and the 32 missing plays are not imputed.

## 6. Open items (not in rev4)

1. QB kneels (1,852) and QB spikes (317) are real snaps with no class yet. They are not run or pass plays, so they sit outside the ordinary sample. Proposed classes: `qb_kneel` and `qb_spike`, outside ordinary play selection, kept in the history.
2. Special-teams events that are not run or pass: kickoffs (12,098), field goals (4,772), extra points (5,365), and punts that are not fakes (9,158). Proposed: a separate special-teams history, not feeding any profile yet.
3. No-play rows (19,983) are penalty or no-play events. Proposed: keep in history, outside profiles.
4. Administrative rows (period ends, game delays, timeouts, warnings, replay notes) are not plays. They are kept in the event history as administrative events (`EVENT-HISTORY-2026-10-27.md`) and are excluded from every profile.
5. Kick and punt direction (left, middle, right) is not in the play-by-play. The descriptions name a kicker, a distance and a landing spot, not a direction. Left, middle and right cannot be classified from this source. A source is needed.
6. Receiver motion is not in any source. FTN `is_motion` is a play-level flag only.

## 7. Verification

- Unit tests: 18 pass (`test/test_playbook_shotgun.py`).
- The rev4 build completed and its manifest report hash matches.
- The class totals reconcile to 147,317 on the play-by-play and to the profiles on both sides.
- rev3 outputs were not modified.
- The 2026 holdout was not used for any selection.
