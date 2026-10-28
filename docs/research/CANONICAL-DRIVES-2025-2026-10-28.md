# Canonical 2025 drives, continuity and drive distributions

Status: built and checked against the source's own fields. Script: `pipeline/canonical_drives_2025.py`. Output: `data/playbooks/research-2026-10-28-canonical-drives-2025/` (one row per drive, and a summary with continuity examples). rev4 through rev7 are unchanged, and the 2026 holdout was not used.

## 1. Definition

Drives are built from possession, not from nflverse's drive IDs.

- A drive starts when the possession team (posteam) changes. A kickoff carries the receiving team, so a kickoff receipt starts a drive. A kickoff recovered by the kicking team starts a new drive for that team.
- A touchdown ends the scoring drive. Only the conversion attempt and penalty or administrative rows that follow stay with it. The next play starts a new drive.
- A drive starts at the first row of each half (quarters 1 and 2, quarters 3 and 4, overtime). It does not split at the end of quarters 1 and 3.
- Extra points and two-point attempts never start a drive. Administrative rows with no play are not drives. A segment made only of administrative rows is dropped, and it is counted.
- Offensive drives are drives with at least one run or pass, or that end in a punt or field goal. Kickoff-only drives (for example, a kick return touchdown) are kept in the list but not counted as offensive.

## 2. Reconciliation to nflverse drive IDs

| Step | Drives |
|---|---:|
| nflverse drive IDs, 2025 regular season | 5,733 |
| Less: nflverse splits one possession into two IDs, with no change of possession (17 cases, 15 in the same quarter and 2 across a quarter break) | −17 |
| Plus: nflverse joins two possessions into one ID (6 cases, each with a change of possession) | +6 |
| **Canonical drives** | **5,722** |

The reconciliation is exact. Every canonical drive is accounted for by these three movements.

## 3. Drive distributions, 2025 regular season

Offensive drives: 5,682.

| Measure | Mean | Median | 10th percentile | 90th percentile |
|---|---:|---:|---:|---:|
| Plays per drive (run, pass, kneel, spike, punt, field goal) | 6.42 | 6 | 3 | 11 |
| Run and pass yards per drive | 31.4 | 25 | 0 | 71 |
| Seconds per drive | 169.5 | 139 | 39 | 339 |
| Points scored by the drive's offense | 2.11 | 0 | 0 | 7 |
| Starting field position (yardline_100: yards to the opponent's end zone) | 69.5 | 71 | 50 | 88 |

Rates per offensive drive:

- Scoring drives: 39.7%
- Three-and-outs (three run or pass plays, a punt, no first down): 20.0%
- Turnover drives (interception, fumble lost, or turnover on downs): 16.8%

How drives end, all 5,722 canonical drives:

| End | Drives |
|---|---:|
| Touchdown | 1,329 |
| Punt | 1,918 |
| Field goal made | 931 |
| Field goal missed or blocked | 156 |
| Turnover | 598 |
| Turnover on downs | 358 |
| End of half or game | 394 |
| No offensive play (kickoff only) | 34 |
| Other | 4 |

## 4. Continuity checks

Checked on consecutive run and pass plays inside one drive, when nothing other than no-play rows lies between them. Pairs that include a touchdown or a two-point attempt are skipped, since play-to-play continuity restarts there. 27,242 pairs were checked.

| Check | Result |
|---|---:|
| Down progression consistent with yards gained and the previous down | 759 explained by a penalty, a turnover or a first-down reset; 2 unexplained |
| Field position consistent with yards gained | 2,191 explained by a penalty on the pair or between; 58 unexplained |
| Score continuity (score after one play equals score before the next, same team) | 0 violations |
| Game clock never rises within a drive | 1 violation |

The two unexplained down cases and the one clock violation are listed in the summary. Of the 58 unexplained field-position pairs, 29 differ by 1 to 3 yards, 13 by 4 to 6, 10 by 7 to 9, and 6 by 10 or more. In 39 the offense ends farther back than the recorded gain implies, and in 19 farther forward. No penalty flag explains them, so they may be unrecorded penalties or spot adjustments. They are not yet resolved.

## 5. Limits

- No independent drive logs are on this machine. The drives are validated against the source's own flags and the final scores, not against official drive logs.
- The 759 down-progression cases counted as explained include a penalty, a turnover, or a reset to first down. The play-by-play cannot separate a reset from an unrecorded event on the same pair, so this check is weaker than the score check.
- Plays per drive exclude kickoffs. Seconds per drive run from the first row of the drive, which includes the kickoff that started it, to its last row, on the game clock.
- The distributions are for 2025 regular-season drives only. They are the benchmarks the simulator's drives would be compared against. They do not yet feed any playbook or simulator default.
