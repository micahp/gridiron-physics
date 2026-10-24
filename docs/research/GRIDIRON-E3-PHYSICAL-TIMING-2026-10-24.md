# E3 snap-anchored physical timing cohort (2026-10-24)

## Result

Built a play-level weeks 1–5 development cohort keyed by `game_id` and `play_id`, using LP's canonical snap-anchored manifest. It contains 9,289 eligible plays, selected from the 9,456-row manifest; each included play passed the all-22-player snap cohort criteria. Weeks 6–9 were not read or included.

For every eligible play, the JSON records BDB IDs (`game_id`, `play_id`) plus the LP `nfl_pbp` composite key (`lp_game_id`, `lp_play_id`) where crosswalked, the manifest snap frame, matching tracking snap event/time, earliest resolved terminal event/frame/time, physical elapsed seconds, and a tracking-event terminal family. It also records a retrospective carrier-candidate list and candidate snap velocity/acceleration when the candidate can be inferred from the tracked football. The exact field contract and null semantics are in [the join contract](GRIDIRON-E3-PHYSICAL-TIMING-JOIN-CONTRACT-2026-10-24.md).

The LP weeks 1–5 clock audit independently matches the tracking terminal event on all 9,066 overlapping eligible plays. Elapsed seconds match on 9,060; the remaining six overlap plays have no terminal event and remain unresolved. The 9,283 primary durations include plays outside the LP clock-audit join.

The same crosswalk supplies unique LP keys for those 9,066 overlap plays. Of 9,283 resolved timing records, 9,060 have LP keys and 223 are partial for LP joining; of 7,576 carrier-candidate records, 7,386 have LP keys and 190 are partial. Six mapped records lack terminal timing, and five mapped carrier-candidate records also lack terminal timing.

## Primary tracking-only terminal-family durations

Durations use the earliest tracking event from LP's terminal-event taxonomy at or after the matched `ball_snap` timestamp. Family labels below are normalized from that tracking event only. Percentiles use the lower empirical order statistic `floor(p * (n - 1))`; medians use the standard sample median. Seconds are rounded to three decimals.

| Tracking terminal family | Count | Median seconds | P10 seconds | P90 seconds |
| --- | ---: | ---: | ---: | ---: |
| Fumble recovery | 52 | 6.100 | 3.300 | 8.600 |
| Incomplete pass | 1,720 | 4.400 | 3.100 | 6.400 |
| Interception | 110 | 4.600 | 3.600 | 7.000 |
| Out of bounds | 974 | 5.700 | 4.300 | 7.800 |
| Quarterback slide | 56 | 5.400 | 3.400 | 6.900 |
| Sack | 329 | 4.200 | 3.100 | 6.200 |
| Tackle | 5,709 | 4.700 | 3.400 | 6.800 |
| Touchback | 2 | 6.850 | 5.300 | 5.300 |
| Touchdown | 331 | 4.400 | 2.900 | 7.900 |
| **Resolved total** | **9,283** |  |  |  |

Six plays have no resolved terminal event; their duration and tracking family remain null. No event was substituted from PBP.

## LP audit's eight outcome buckets

This is a separate retrospective cross-check using the outcome labels already present in LP's clock-audit CSV; these labels did not select plays or determine the primary tracking-only family. The table reports only rows with a resolved audit duration in the 9,066-play overlap. The audit's `other` label has zero rows in the canonical cohort overlap; the 116 `other` rows in the full weeks 1–5 audit are outside the eligible canonical cohort.

| LP audit outcome label | Resolved count | Median seconds | P10 seconds | P90 seconds |
| --- | ---: | ---: | ---: | ---: |
| Fumble | 63 | 5.100 | 2.700 | 8.400 |
| Interception | 104 | 4.600 | 3.600 | 7.100 |
| Other | 0 | — | — | — |
| Pass complete | 2,983 | 5.400 | 4.000 | 7.500 |
| Pass incomplete | 1,687 | 4.400 | 3.100 | 6.400 |
| Run | 3,573 | 4.400 | 3.300 | 6.300 |
| Sack | 307 | 4.300 | 3.200 | 6.500 |
| Touchdown | 343 | 4.400 | 2.900 | 7.600 |
| **Resolved total** | **9,060** |  |  |  |

## Carrier kinematics

The tracking `event` value is repeated across player rows at an event frame, so its row's `nflId` is not treated as the carrier. Instead, for the earliest acquisition event (`handoff`, catch, interception, or QB run marker), the candidate is the tracked player nearest the football at that frame. If no acquisition marker exists, the earliest supported terminal marker is used as a fallback. The candidate ID and ball-to-player distance are retained because BDB has no explicit possession bit and this inference is not adjudicated ground truth.

Velocity and acceleration are finite differences of the candidate's tracking `x/y` at the snap and the two immediately preceding 10 Hz frames. Coordinates are in yards; output vectors are in yards/second and yards/second². The JSON also retains the tracking-provided snap `s` and `a` values as a reference. Candidate identity uses a retrospective event frame only to name the subject; no post-snap coordinate contributes to the reported kinematics or a model input.

- Candidate identified and snap velocity/acceleration available: 7,576 plays.
- Candidate unresolved: 1,713 plays. These are left null rather than guessed.
- The candidate list has an LP play key on 7,386 of those 7,576 plays; 190 lack a crosswalk key.
- Example: game `2022090800`, play `1009` selects player `52494` at the tracked handoff frame; the candidate is 0.522 yards from the football. Snap velocity and acceleration are zero in the two-frame finite-difference estimate.

## Coverage and audit checks

- Eligible input keys: 9,289 unique `(game_id, play_id)` pairs; weeks 1–5 only.
- LP `nfl_pbp` keys `(lp_game_id, lp_play_id)` are present and unique on 9,066 plays.
- Manifest snap frame agrees with a raw tracking `SNAP` / `ball_snap` event for 9,289/9,289 plays.
- A tracking terminal family and duration resolve for 9,283/9,289 plays.
- On the LP clock-audit overlap, terminal event names match 9,066/9,066 records; elapsed seconds match 9,060/9,066 resolved comparisons.
- Across resolved records, `terminal_frame - snap_frame` divided by 10 equals the timestamp duration to 0.001 seconds for every play.
- Durations are nonnegative; observed resolved range is 1.1–42.6 seconds.
- No weeks 6–9 tracking rows were scanned. The scan read only `tracking_week_1.csv` through `tracking_week_5.csv`.

The external clock audit's terminal taxonomy is pinned by `scripts/bdb/bdb2022_clock_audit.py`, SHA-256 `26499e9a5b1067fbf9c26b6328ee4235593c3fc3bec23f77cf804400bb2063de`. Its original LP outcome labels are used only in the separate eight-bucket cross-check above.

## Inputs and hashes

The tracking mirror is `b00nk3r/NFL-Big-Data-Bowl-2025`, source commit `e28d3b25725799ef2213680016db5325f6f90014`. Only weeks 1–5 were used.

| Input | SHA-256 |
| --- | --- |
| LP canonical cohort `bdb2025-snap-anchored-cohort-v1.csv` | `45325d55103da9a7eca5139f3fda9506cb38d8f0af76d7753868c8f40fbd548a` |
| BDB `tracking_week_1.csv` | `dc47c829ef917cb6533c6baedd01964823939a4e9cba807090d2784aa1fd149c` |
| BDB `tracking_week_2.csv` | `d735b37f04bdf324132b9cb0f084a4ca583fadbbf02653e1873dad39c36924aa` |
| BDB `tracking_week_3.csv` | `db2965ad61a5ad3895a8878a3754c3d3e4bf4b2dce75732c0b6b4d9d094887bb` |
| BDB `tracking_week_4.csv` | `2e931bc9cd7f6126d6cd1e7eb71a3c711b748a0cece9d04dcace870e7298774f` |
| BDB `tracking_week_5.csv` | `1c10136562b82f3e2d5405247540d890fc02f38804109bdaaba5e63bd816c3e9` |
| LP weeks 1–5 clock-audit CSV (LP key crosswalk and retrospective cross-check) | `f030e9c6da3d69f1b1a9a15da0d5f14074639b1697f52d9e964eeabdb6f844c9` |

## Limitations

- Tracking is sampled at 10 Hz; event timing is quantized and sub-frame movement is not observed.
- The terminal tracking marker is not a whistle timestamp.
- The data do not attribute clock stoppage/runoff to rules, officials, timeouts, penalties, or other causes.
- Carrier identity is a nearest-player-to-football inference at an event frame, not a possession adjudication; candidate distances and unresolved cases are exposed.
- The terminal family describes an observed tracking event. It is not a tackle, yards, scoring, or game prediction, and the LP outcome cross-check is retrospective.

No engine rules, OOB thresholds, main, or production artifacts changed.

## Reproduction and artifact pin

Run the builder against the pinned local tracking and LP artifacts:

```sh
python3 scripts/research/build_bdb2025_physical_timing.py \
  --tracking-root /path/to/bdb2025/code-data \
  --cohort-manifest /path/to/bdb2025-snap-anchored-cohort-v1.csv \
  --clock-audit-csv /path/to/bdb2022-clock-audit-weeks1-5-2026-10-24.csv \
  --output docs/research/gridiron-e3-physical-timing-2026-10-24.json
python3 test/test_e3_physical_timing_guard.py
python3 test/verify_e3_physical_timing_repro.py
```

Machine-readable output: `gridiron-e3-physical-timing-2026-10-24.json`

Output SHA-256: `e885fd20be7fe54f429c31f98dff11425538d331e383c90527141dd78754a63b`
