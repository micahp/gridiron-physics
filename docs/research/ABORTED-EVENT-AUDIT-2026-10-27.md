# Aborted-event audit, regular seasons 2022 to 2026

> **Superseded in part.** The rushing (32) and passing (96) differences in section 3 and the open exceptions in section 4 are explained in `ATTEMPT-DIFFERENCES-2025-2026-10-28.md`: two-point conversions, not spikes or other flags. The passing explanation of 81 plays in this file was wrong.

Status: audit only. rev4 is unchanged. The corrections are listed in section 5 and carried into rev5. Source: nflverse play-by-play for 2022 to 2025 and the pinned 2026 Weeks 1 to 7 file. The full row-level audit is `data/playbooks/research-2026-10-27-aborted-audit/aborted_events_audit.csv`, with every source field and the rule that set each category.

## 1. What the source says

The source flag `aborted_play` is set when the play description contains the word "Aborted." It does not record why the play was aborted. Handling is therefore decided only from the description text, and the rules are listed in the audit CSV.

The rev4 description of the 53 unknown-handling plays as "the player called the play off" is not supported by the source. It is withdrawn in rev5.

## 2. Counts

All 440 regular-season events with `aborted_play` = 1:

| Play type | Count |
|---|---:|
| run | 426 |
| pass | 5 |
| no_play | 9 |
| **Total** | **440** |

By handling category, from description text only:

| Category | Run | Pass | No play | Total | Rule |
|---|---:|---:|---:|---:|---|
| Fumbled snap | 363 | 5 | 7 | 375 | Text: "FUMBLES (Aborted)" |
| Dropped kicking operation | 10 | 0 | 0 | 10 | Kicking formation text ("Punt formation" or "Field Goal formation") |
| Unknown handling | 53 | 0 | 2 | 55 | Text: "X Aborted." followed by a fumble by another player. No source states a handoff or backward pass. |
| **Total** | **426** | **5** | **9** | **440** | |

Attribution as recorded in the source: 426 run plays carry a rush attempt, 5 pass plays carry a pass attempt, and the 9 no-play rows carry neither. Six of the events are touchdowns and 15 are first downs.

Examples (2022 CLE at CAR, play 438): "(Shotgun) 6-B.Mayfield FUMBLES (Aborted) at CAR 29, and recovers at CAR 29." Classified fumbled snap.
Example (2022 CLE at CAR, play 2980): "6-B.Mayfield Aborted. 60-P.Elflein FUMBLES at CAR 31." Classified unknown handling. The text does not say whether this was a handoff, a backward pass or something else.
Example (2022 CIN at TB, play 1907): "(Punt formation) Direct snap to 25-G.Bernard. 25-G.Bernard FUMBLES (Aborted)." Classified dropped kicking operation.

## 3. Reconciliation with the official team statistics (2025)

The official team-week file (`stats_team`, season 2025, regular season) is the check. It is an external record, not built from our play-by-play.

| Check | Result |
|---|---|
| Sacks: play-by-play minus official `sacks_suffered`, all teams | 0 difference. League total 1,287 in both. |
| Carries: play-by-play rush attempts minus official `carries` | League 14,633 minus 14,601 = 32. Teams differ by 1 to 3 in 21 teams. |
| Passing attempts: play-by-play pass attempts, minus sacks, minus official `attempts` | League 17,535 minus 17,439 = 96. |
| Of the 96, pass-attempt flags on non-pass plays | 81: 79 QB spikes, 1 no-play, 1 field goal. |
| Passing attempts left after those 81 | 15 league-wide. Team-level remainders are not all zero. |

Observation for the aborted plays: Miami had 7 aborted run plays in 2025, and its play-by-play carries equal the official carries. That suggests the official carries include aborted run plays. It is one team, so it is not yet a general result.

## 4. Unresolved exceptions

1. Rushing: 32 league-wide carries not explained by the source fields. Teams differ by 1 to 3.
2. Passing: 15 pass attempts unexplained after the spike, no-play and field-goal flags.
3. Text and flag mismatch: 10 rows say "FUMBLES (Aborted)" but have the fumble flag at 0. Seven are no-play rows and three are passes.
4. No-play rows: 2 unknown-handling rows are no-play events, outside the run and pass universe.
5. The 53 unknown-handling run plays: the source does not record their handling. Settling them needs another source, such as official game records.

## 5. Corrections carried into rev5

- The "called off" interpretation is removed. The 53 unknown-handling run plays are `aborted_unknown_handling`.
- The 368 fumbled-snap run and pass plays are `fumbled_snap`.
- The 10 kicking-formation aborts are first labelled `dropped_kicking_operation` in rev5. rev7 splits them: 2 are `direct_snap_fumble` and 8 are `aborted_kicking_operation` (see `REV7-IMPACT-2026-10-28.md`).
- Excluding these plays from the designed concept catalog does not change any source field. The rushing and passing totals in section 3 come from the source play-by-play, not from the profiles. The per-play profile records do not yet carry the rush attempt, pass attempt, sack and fumble flags, so the event history needs them added before any drive or possession accounting. That is in the taxonomy design.
