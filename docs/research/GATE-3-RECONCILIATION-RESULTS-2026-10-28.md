# Gate 3 revised reconciliation: results, 2022 to 2024

Status: results of the revised rule in `GATE-3-SHOTGUN-RECONCILIATION-REVISED-2026-10-28.md`. Historical development only.
Not a final acceptance. No 2026 data was used. No historical source field was changed.

Script: `pipeline/reconcile_shotgun_sources.py`. Outputs: `data/playbooks/research-2026-10-28-gate3-shotgun-reconciliation/`
(`team_season_sources.csv`, `unresolved_plays.csv`, `gate3_summary.json`). Each figure below comes from those files.

## Summary

- The old gate is reproduced: the same 16 team-seasons fail the 1.0-point test, with the same paired play counts.
- Of the 272 PBP-versus-participation disagreements in the 16 failing team-seasons, FTN sides with participation on 264.
  FTN sides with the PBP flag on 6 (CLE 2023: 1, NYJ 2023: 1, IND 2024: 2, NE 2024: 2). FTN has no value on 2 (TB 2024).
  None is a three-way disagreement.
- **R1 (FTN and participation agree on at least 99.0% of plays):** passes in all 2023 and 2024 team-seasons (lowest
  99.80%). Fails in 15 of 32 team-seasons in **2022** (98.1% to 99.0%). This is a systematic source disagreement, not a
  rounding effect. It needs your decision (see below).
- **R2 (the profile reproduces from source fields):** passes for all 96 team-seasons, per play. See the revision record
  in the rule document for why R2 is a per-play test.
- **R3 (no silent fallback):** holds. All 564 unresolved plays are listed in `unresolved_plays.csv`.
- **TB 2024 stays visible.** It is listed with 5 unresolved plays. Its cause is not found.

## Reproduction of the old gate

For all 16 rev3 rows, the paired play count and the disagreement count match exactly, and the differences match within
0.001 point. Two displayed differences differ from rev3 by 0.001 point:

| team-season | this run (unrounded) | this run (3 decimals) | rev3 table | disagreeing plays (this run = rev3) |
|---|---:|---:|---:|---:|
| 2023 DET | 1.346499 | 1.346 | 1.347 | 19 = 19 |
| 2024 NO | 1.658540 | 1.659 | 1.658 | 17 = 17 |

The rev3 build report stores the absolute difference as a 6-decimal intermediate (DET 2023: 0.013465) and then displays it
to 3 decimals. The displayed last digit for these two rows does not follow one rounding rule. The paired counts and the
disagreement counts match exactly, so the difference is display rounding only, not data.

## Source values, reported separately

Across all 96 team-seasons, 923 plays have a PBP value and a participation value that disagree.

| what FTN says on those plays | plays | seasons |
|---|---:|---|
| FTN sides with participation (PBP flag is the outlier) | 783 | 2022, 2023, 2024 |
| FTN sides with the PBP flag (participation is the outlier) | 40 | 2022: 30, 2023: 6, 2024: 4 |
| All three values differ | 0 | |
| FTN has no value (listed as unresolved) | 100 | 2022: 96, 2024: 4 |

The 40 plays where FTN sides with the PBP flag are explained: FTN is applied first and agrees with the PBP value. They are
reported here so the disagreement stays visible.

Hierarchy source counts over all team-seasons: FTN 100,589 plays; participation 470; PBP flag 138; none 0.

## R1: FTN and participation agreement

Fails (all 2022): ATL 98.89%, BAL 98.73%, CAR 98.96%, CHI 98.98%, CLE 98.45%, GB 98.55%, JAX 98.96%, LA 98.57%,
LAC 98.76%, MIA 98.88%, NYG 98.97%, NYJ 98.09%, SEA 98.83%, SF 98.93%, TB 98.86%.

The 2022 disagreements follow a clear pattern by participation formation (FTN `qb_location` against participation):

| participation formation | FTN says | plays |
|---|---|---:|
| SINGLEBACK | shotgun (S 166, P 3) | 169 |
| SHOTGUN | under center (U) | 65 |
| WILDCAT, PISTOL, EMPTY | under center (U) | 53 |
| I_FORM | shotgun (S 27, under center P 1) | 28 |
| JUMBO | shotgun (S) | 1 |

So in 2022 the two sources classify the same formations differently, in a consistent direction. Neither is a random error.
The 2022 taxonomy mapping (EMPTY and WILDCAT as shotgun, SINGLEBACK as not shotgun) is one candidate, but it does not
explain the SINGLEBACK cases, which FTN classes as shotgun. The cause is not established.

Under the documented hierarchy, FTN is applied first, so these plays take FTN's value in the profiles. That is the
documented behavior. R1 nonetheless fails as written, and the failure is reported as is.

## R2: profile reproduces from source fields

For each team-season, every play in the rev3 profile's `source_ids` was compared with this run's value and source.

- Profile plays compared: 101,130. Matching values: 101,130. Matching sources: 101,130.
- Profile plays this run does not have: 0.
- Plays this run has but the profile omits: 67, all special-teams run or pass plays (the current `snap_kind` class
  `special_teams_run_pass`). No other omissions.

The earlier totals-based R2 (0 of 96) compared different denominators, because the rev3 profiles predate the current event
classes. It is not a result. See the rule document's revision record.

## R3: unresolved plays

564 rows in `unresolved_plays.csv`:

| season | reason | rows |
|---|---|---:|
| 2022 | FTN and participation disagree (R1 cases) | 316 |
| 2022 | PBP and participation disagree, no FTN value | 96 |
| 2022 | hierarchy falls back to the PBP flag | 14 |
| 2023 | FTN and participation disagree | 6 |
| 2023 | hierarchy falls back to the PBP flag | 97 |
| 2024 | FTN and participation disagree | 4 |
| 2024 | PBP and participation disagree, no FTN value | 4 |
| 2024 | hierarchy falls back to the PBP flag | 27 |

The 138 PBP-fallback plays are the documented third source. They are used only in FTN-charted games, where neither FTN nor
participation gives a value.

## TB 2024: kept visible

TB 2024 fails the old gate at 1.110 points. Under the revised rule:

- R1 passes (FTN and participation agree on all 1,025 plays with both values).
- R2 passes (1,083 shared profile plays match; 1 special-teams play omitted).
- R3 lists 5 unresolved plays, and the cause is not established:
  - 2024_01_WAS_TB, play 3477: PBP-fallback play.
  - 2024_03_DEN_TB, play 3458: PBP-fallback play.
  - 2024_08_ATL_TB, play 3015: PBP-fallback play.
  - 2024_07_BAL_TB, play 3464: PBP and participation disagree, no FTN value.
  - 2024_07_BAL_TB, play 3990: PBP and participation disagree, no FTN value.

Its 14 other disagreements have FTN on the participation side and are explained by the hierarchy.

## Decisions needed

1. **2022 R1:** accept the 2022 FTN-over-participation disagreement, with the formation pattern above, as a documented
   source difference, or hold 2022 as an open source question. The threshold is not changed here.
2. **PBP-fallback plays (138):** accept the documented hierarchy's third source, or require FTN or participation coverage
   before a play enters a profile.
3. **TB 2024:** the 5 listed plays stay unexplained until someone checks their source rows.

No pass or fail decision is made in this document. Final acceptance is pending your decisions.
