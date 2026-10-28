# LP Part A review findings: team-season playbooks

Read-only source audit against the build at `d62fe702874e96bbd034f87466ad31d1c35da7f1`. The generated profiles and frozen 2026 Weeks 1 to 7 inputs were not changed. Part B remains blocked pending review of these findings.

## Shotgun cross-source exceptions, 2023 to 2024

The 272 discrepancies are exact PBP/participation play-key matches, not failed joins. All 242 rows where PBP says `shotgun=0` and participation says SHOTGUN/PISTOL, plus all 30 reverse-direction rows, have a participation observation. The participation inputs used were the pinned `pbp_participation_2023.csv` (SHA-256 `ad01aeb4045ee19a4f086ff38b52b14c8f427d3401e529c3078a4545921650a9`) and `pbp_participation_2024.csv` (SHA-256 `b1f436a98b2a7759eb4ed1181e072a35c2666f9aeb356a49c943d28d6be6b0b9`).

Of the 242 PBP-zero/participation-shotgun rows, 82 are two-point attempts with no regulation down. The remaining 160 are down 1 to 4 plays. All 30 reverse-direction rows are down 1 to 4 and participation labels them UNDER CENTER. Across those 190 regulation-down disagreements, the PBP-zero/participation-shotgun side has 121 passes and 39 runs; the reverse side has 18 passes and 12 runs. Overall, the 272 rows are 202 passes and 70 runs, spread across 152 games; no one game has more than six. Thus two-point attempts explain a measurable subset, but the remaining differences are source classification disagreements on ordinary downs; the available sources do not establish which label is correct. No rows were recoded.

| Team-season | Disagreements: PBP 0 / part shotgun; PBP 1 / part other | PBP 0 / part shotgun that are 2PT | Remaining down 1 to 4: first direction pass/run; reverse direction pass/run | Games |
|---|---:|---:|---:|---:|
| ARI-2023 | 13 / 2 | 10 | 2/1; 1/1 | 12 |
| CLE-2023 | 20 / 5 | 7 | 5/8; 2/3 | 14 |
| DET-2023 | 17 / 2 | 4 | 11/2; 2/0 | 11 |
| NE-2023 | 16 / 4 | 0 | 15/1; 3/1 | 10 |
| NYG-2023 | 13 / 0 | 4 | 6/3; 0/0 | 10 |
| NYJ-2023 | 16 / 2 | 4 | 8/4; 1/1 | 11 |
| CHI-2024 | 19 / 2 | 10 | 8/1; 1/1 | 12 |
| DET-2024 | 11 / 0 | 2 | 9/0; 0/0 | 5 |
| IND-2024 | 12 / 1 | 4 | 5/3; 1/0 | 9 |
| JAX-2024 | 12 / 2 | 7 | 4/1; 1/1 | 9 |
| LV-2024 | 12 / 1 | 4 | 6/2; 0/1 | 9 |
| NE-2024 | 14 / 1 | 4 | 5/5; 1/0 | 11 |
| NO-2024 | 17 / 0 | 4 | 10/3; 0/0 | 9 |
| NYG-2024 | 18 / 2 | 6 | 12/0; 2/0 | 10 |
| NYJ-2024 | 18 / 4 | 9 | 6/3; 2/2 | 12 |
| TB-2024 | 14 / 2 | 3 | 9/2; 1/1 | 9 |

The existing tolerance is an absolute share difference over 1 percentage point. These are documented cross-source differences, not missing-data or key-resolution defects.

## 2025 shotgun gate

I ran the same exact-key comparison over the pinned 2025 regular-season PBP and participation files. The PBP SHA-256 is `2f135887790a013fd004e609e37096bb4816d5cc80b9f19122e1bad478961978`; participation SHA-256 is `59069adfee7b0f464befba8a5e8be331e523633cc6a7ab403d37bcbcdfbe66ac`.

- Eligible offense plays: 32,941; paired with a known participation formation: 32,885; no participation row/formation for 56.
- Paired-play disagreements: 243.
- ARI is the only team over tolerance: 1.025 percentage points on 1,073 paired plays (13 PBP-zero/participation-shotgun, 2 reverse; net 11 plays). The next largest difference is IND at 0.991 points. The other 31 teams meet the 1.0-point tolerance.

The committed builder currently runs this gate only for seasons 2022 to 2024, so 2025 was absent from the generated gate table. This read-only calculation uses the same gate function and pinned source rows; it does not alter the profile outputs.

## 2026 offense count and decision universe

The profile builder counts 13,179 Weeks 1 to 7 offense pass/run plays with both teams identified. The decision-universe filter requires `down` 1 to 4, nonnegative `ydstogo`, and `yardline_100` in 0 to 99; applying it to the same PBP leaves 13,131. The entire 48-play difference is two-point attempts with blank regulation `down`: 41 pass attempts and 7 run attempts. Their distance and field-position values are valid, so the down requirement alone excludes them. These rows remain valid plays in the broader offense profile and are outside the regulation-down decision universe.

The pinned 2026 PBP input is SHA-256 `30f31f1faf184be5a3014395c6830ed81ac5f60a03790e3e4a849dc020a70396`. The 2026 playbooks remain labeled in-season, through Week 7, frozen; they were not used to tune tests or called unseen.

## Third-source check: FTN charting on the shotgun disagreements

Method. FTN charting `qb_location` was joined to the same plays on nflverse game and play IDs, using the pinned 2023 and 2024 FTN CSVs. `S` and `P` count as shotgun and `U` as under center. Before the check ran, it reproduced the addendum counts exactly: 272 disagreements, 242 PBP-zero, 30 reverse, 82 two-point, and 190 on down 1 to 4.

Row level. FTN agrees with each source as follows.

| Set | Rows | FTN agrees with participation | FTN agrees with PBP | FTN missing |
|---|---:|---:|---:|---:|
| PBP-zero, all | 242 | 237 | 3 | 2 |
| Reverse, all | 30 | 27 | 3 | 0 |
| PBP-zero, two-point | 82 | 80 | 0 | 2 |
| PBP-zero, down 1 to 4 | 160 | 157 | 3 | 0 |
| Reverse, down 1 to 4 | 30 | 27 | 3 | 0 |

On the 190 regulation-down rows, FTN agrees with participation on 184 and with PBP on 6. The pattern holds in 2023 and 2024 separately.

Team-season level. Over all paired plays in each of the 16 team-seasons, the PBP shotgun share sits 1.00 to 1.66 points below the FTN share in 15 of 16. In those 15, the participation share is within 0.10 points of FTN. TB 2024 is the exception: FTN sits 0.24 points below PBP and 1.35 points below participation, and FTN covers 1,025 of 1,081 plays there. This check does not explain TB 2024.

Baseline. Across 67,055 paired plays with FTN in 2023 and 2024, the participation shotgun group agrees with FTN on 99.99%, and the PBP flag agrees on 98.84%.

What this settles. The statement above that the sources "do not establish which label is correct" does not hold for the 190 regulation-down rows. FTN supports participation on 184 of them. The PBP `shotgun` flag is the outlier on these plays.

What it does not settle. FTN and participation agree almost exactly at team-season level, so they may draw on a common source. The check shows that PBP departs from both. It does not show that FTN and participation are independent of each other.

Consequence for the profiles. The profile's `shotgun` tendency reads the PBP flag. The separate `formation` tendency reads participation's `offense_formation`. For 15 of the 16 team-seasons, the PBP-based shotgun share sits 1.00 to 1.66 points below the FTN and participation shares. Before a simulation uses shotgun share, the profile should either use the participation formation or label the PBP-based figure. This is a recommendation for review, not a change made here.
