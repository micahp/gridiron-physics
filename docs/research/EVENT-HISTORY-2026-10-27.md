# Event history: every regular-season play-by-play row, 2022 to 2026

Status: built and reconciled. The event history is the chronological layer described in `EVENT-TAXONOMY-DESIGN-2026-10-27.md`. It is kept outside git because it is large. Output: `/root/lp-snapshots/nfl-event-history-2026-10-27/event_history.csv` (207,020 rows) with `event_history_summary.json` alongside. The builder is `pipeline/build_event_history.py`. A small summary is committed under `data/playbooks/research-2026-10-27-event-history/`.

## 1. Reconciliation

| Check | Result |
|---|---|
| Rows in the source, regular season, 2022 to 2026 | 207,020 |
| Rows written | 207,020 |
| Duplicate (game, play) keys | 0 |
| Rows with an event type | 207,020 (none unclassified) |
| Run and pass rows | 147,317, equal to the run and pass universe used by the profiles |

Rows by season: 2022 47,157; 2023 47,399; 2024 47,274; 2025 46,452; 2026 (Weeks 1 to 7) 18,738.

## 2. Event types and subtypes

| Event type | Subtype | Rows |
|---|---|---:|
| run_pass | scrimmage | 146,252 |
| run_pass | fumbled_snap | 368 |
| run_pass | aborted_unknown_handling | 53 |
| run_pass | two_point_conversion | 550 |
| run_pass | special_teams_run_pass | 94 |
| kickoff | kickoff | 12,098 |
| punt | punt | 9,241 |
| field_goal | field_goal | 4,772 |
| extra_point | extra_point | 5,365 |
| qb_kneel | qb_kneel | 1,852 |
| qb_spike | qb_spike | 317 |
| no_play | penalty_or_no_play | 11,118 |
| no_play | no_play_fumbled_snap | 7 |
| administrative | timeout | 8,859 |
| administrative | period_end | 3,654 |
| administrative | game_marker | 2,388 |
| administrative | game_delay | 26 |
| administrative | penalty_text | 2 |
| administrative | play_did_not_occur | 2 |
| administrative | replay_or_clock_note | 2 |

Administrative events total 14,933. They are events in the history, not plays, and no profile counts them.

## 3. Source conflicts kept visible

- Ten rows whose description says "FUMBLES (Aborted)" have the source fumble flag at 0. Seven are no-play rows and three are pass plays. The flag is kept as recorded, and the text-based class is kept beside it.
- Two punt-formation runs describe a direct snap to a named player. They are classed `direct_snap_fumble` in rev7. The source does not record player positions, so the recipient's role is not established.

## 4. What the history does not yet reconcile

- Drives and final scores against the official 2025 team statistics. Not yet done.
- The 32 rushing and 15 passing attempts that the official stats differ on. Not yet explained.
- Possession and clock continuity across events. The fields are carried, but no continuity check has been run.

The per-play profile records now carry the event fields (`event_history`) for every run and pass play, as revision rev6 records. The event history file itself holds every row, including the events that no profile uses.
