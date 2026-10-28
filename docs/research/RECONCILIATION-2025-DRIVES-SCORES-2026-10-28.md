# Reconciliation: 2025 regular-season drives and final scores

Status: reconciled. Script: `pipeline/reconcile_2025_drives_scores.py`. Summary: `data/playbooks/research-2026-10-28-reconciliation-2025/reconciliation_2025_summary.json`. Mismatch file: `reconciliation_2025_mismatches.csv` (no rows).

## Official sources

- Final scores: `games.parquet` (nflverse schedules), 272 regular-season games.
- Touchdowns: `stats_team_week_2025.parquet`, summed over regular-season weeks.
- Drives: no official drive count exists on this machine. The drive checks below are internal to the play-by-play, and they are reported as such.

## Results

| Check | Result |
|---|---|
| Final score, PBP last play against official | 272 of 272 match |
| Points rebuilt from scoring events, by team and game | 544 of 544 match |
| Touchdowns by team against official | 32 of 32 match; 1,395 in total on both sides |
| Drive IDs with one possession team | 5,726 of 5,733 with one team; 7 with two, all explained |
| Drives ending with a score (nflverse flag against scoring events) | 5,733 of 5,733 match |
| Unexplained mismatches | 0 |

## What the first pass got wrong, and the corrections

1. **Touchdowns.** The first pass summed `receiving_tds` and `pt_return_tds` with the other official fields. `receiving_tds` repeats `passing_tds`, and `pt_return_tds` repeats `special_teams_tds`. Summing the five non-overlapping fields (passing, rushing, special teams, defence, fumble recovery) matches the play-by-play for all 32 teams. Pick-sixes are included: they carry the touchdown flag with the defence as `td_team`.
2. **Points.** A defensive two-point conversion scores for the defence whatever the result text says. This covers two cases: a failed two-point attempt returned by the defence (MIA at NO, 2025 week 13), and a blocked PAT returned for two (DAL at GB, 2025 week 4). The rule now credits the defence in both cases.
3. **Safeties.** The safety flag is correct. The one safety that appears in the text without the flag (DAL at DET, 2025 week 14) was reversed on replay, so it is correctly not counted.

## The seven drive IDs with two possession teams

| Explanation | Drives | Basis in the source |
|---|---:|---|
| Onside kickoff | 5 | Kickoff description says "onside." The receiving team is the row's possession team; the kicking team's recovery continues the same drive ID. |
| Kickoff recovered by the kicking team | 1 | Kickoff description says "RECOVERED by" the kicking team (SEA, 2025 week 2, touchdown on the recovery). |
| Turnover on downs, drive ID not split | 1 | The row's `fixed_drive_result` is "Turnover on downs" and `drive_end_transition` is DOWNS. The drive ID stays the same after the change of possession (NO at CAR, 2025 week 10). |

These are source conventions and one numbering quirk, not missing data. The turnover-on-downs case is the only drive where the source's drive ID doesn't mark the change of possession. Anyone counting drives from drive IDs should split that drive.

## Not reconciled

- **Official drive counts.** None on this machine. The 5,733 drive IDs are the source's own count, and they are not checked against an official total.
- **Official scores for drives.** Drive-level points are checked only through the game totals, not against official drive logs.
