# Canonical 2025 drives, version 2: validation revision

Date: 2026-10-28. Scope: 2025 regular season, 272 games. Research only, on the research branch.

Not changed: version 1 (`pipeline/canonical_drives_2025.py`, `data/playbooks/research-2026-10-28-canonical-drives-2025/`,
`docs/research/CANONICAL-DRIVES-2025-2026-10-28.md`). No production code, no simulator default, no 2026 data.

## Outcome

- Version 1 has two defects. v2 corrects both.
  - **Safety attribution.** A safety row's `posteam` is the team that gave up the safety. v1 checks `defteam`, the
    scorer, so it never labels a safety drive and never assigns its points to any drive.
  - **Point attribution.** v1's drive points match the official final scores in 475 of 544 team-games. v2 matches 544 of
    544. The first mismatch traced (2025_01_MIN_CHI) is CHI's extra point after its interception-return touchdown. That
    point's `posteam` is CHI, but it sits in MIN's drive, and v1 credits a conversion only to the drive whose team matches
    `posteam`, so it is dropped.
- The drive-end class is now read from explicit row fields. The quarter number is not used. v1 labelled 394 drives
  `end_of_half_or_game` from the quarter; v2 gives 385 of them `end_of_half` or `end_of_game` from transition fields,
  8 are `safety_allowed`, and 1 is `touchdown_allowed`.
- Two timings per drive. `kickoff_to_end_seconds` and `possession_seconds`, both reported. Recommendation for simulator
  benchmarks: `possession_seconds` (see Decisions).
- Continuity: the same 27,242 checked pairs and the same 58 field-position, 2 down and 1 clock exceptions as v1. Every
  exception is listed with its play IDs, its text, and an evidence category. No exception is left without a category.
  The categories are text-based leads, not verified causes (see Continuity).
- The simulator comparison is descriptive only. See Simulator comparison.

## Definitions (v2)

Drives. The v1 splitter is imported unchanged (`canonical_drives_2025.split_game`). Administrative-only segments are
dropped, as in v1. 5,722 drives are kept, matching v1. 5,682 are offensive (at least one run, pass, kneel, spike, punt or
field goal row). 40 are non-offensive.

Clock. `game_seconds_remaining` at the drive's end is taken from the first explicit boundary that applies:

| basis | drives |
|---|---:|
| next drive's first timed row | 5,187 |
| half end row (`END QUARTER 2`, gsr 1800) | 272 |
| game end row (`END QUARTER 4` or `END GAME`) | 263 |

`END QUARTER 1` and `END QUARTER 3` are mid-half breaks and are not boundaries. No drive used the last-row fallback.

- `kickoff_to_end_seconds`: first timed row of the drive (the kickoff, if there is one) minus the end clock.
- `possession_seconds`: first offensive play minus the end clock.

End class, from explicit fields, in this order:

1. `touchdown_scored`: a touchdown whose `td_team` is the drive's team. Subtype: the play type of the scoring row.
2. `touchdown_allowed`: a touchdown whose `td_team` is the other team. Subtype: the cause, `interception_return`,
   `fumble_return`, `punt_return`, `blocked_punt_return`, `field_goal_return` or `kickoff_return`.
3. `safety_allowed`: a safety whose `posteam` is the drive's team.
4. From the last offensive play: `field_goal_made`, `field_goal_missed`, `punt`, `blocked_punt`, `interception`,
   `fumble_lost`, `turnover_on_downs` (`DOWNS`), `end_of_half` (`END_HALF`), `end_of_game` (`END_GAME`).
5. Non-offensive segments: `end_of_half` or `end_of_game` from a kickoff row's transition, `kickoff_fumble_lost`
   (`FUMBLE`), `onside_kick_lost` (an onside kick whose text names the kicking team as recoverer), otherwise
   `no_offensive_play`.
6. Otherwise `unclassified`. No drive reached this class.

A defensive touchdown takes precedence over the last play, as nflverse's own `Opp touchdown` result does. The cause is
kept in the subtype, so a pick-six is `touchdown_allowed / interception_return`, not lost.

Points. Each scoring event is credited to its team, using the rules of `reconcile_2025_drives_scores.py`, which ties to
the official scores. `points_for` is what the drive's team scored. `points_against` is what the opponent scored while
the drive was on, which includes a conversion after a defensive touchdown, a defensive two-point try, and a safety.

Negative elapsed times: 0.

## Verification

- Unit tests: `python3 -m unittest discover -s test -p 'test_canonical_drives_2025_v2.py'`, 27 tests, all pass. They use
  synthetic rows and pin each rule above, including the v1 safety defect.
- Points tie-out, drive level: 544 of 544 team-games equal the official final score (`points_tie_out_to_official`).
- Continuity: v2's counts equal v1's on all eight keys (`continuity_matches_v1`).
- nflverse cross-checks, per kept drive:

| check | agree | explained | disagree |
|---|---:|---|---:|
| `fixed_drive_result` | 5,703 | 14 `fixed_result_is_next_possession`, 5 `nflverse_id_spans_next_drive` | 0 |
| `drive_end_transition` | 5,719 | 2 `nflverse_id_spans_next_drive` | 1 |

"Next possession" means the next kept drive's end class matches the nflverse value. The check is run, not assumed.
The one transition disagreement is 2025_05_TEN_ARI drive 23: an interception, then a fumble on the return that TEN
recovered in the end zone (`TOUCHDOWN` in the text). v2 says `touchdown_scored`, which is what the text describes. The
nflverse transition field carries the drive's first event, `INTERCEPTION`.

## Results

### Timing (offensive drives, n = 5,682)

| measure | n | mean (s) | median (s) | p10 | p90 |
|---|---:|---:|---:|---:|---:|
| `kickoff_to_end_seconds` (v2) | 5,682 | 173.3 | 145 | 42 | 341 |
| `possession_seconds` (v2) | 5,682 | 170.6 | 142 | 40 | 337 |
| v1 `seconds` (first to last row) | 5,642 | 169.5 | 139 | 39 | 339 |

43.5% of offensive drives begin with a kickoff row. The kickoff row sits 4.9 seconds before the first offensive play on
average (median 5), so the kickoff adds little time to the drive. That is why the two v2 measures differ by only 2.7
seconds on average.

### Plays and points per offensive drive

| measure | mean | median | p10 | p90 |
|---|---:|---:|---:|---:|
| plays | 6.42 | 6 | 3 | 11 |
| points for | 2.11 | 0 | 0 | 7 |
| points against | 0.08 | 0 | 0 | 0 |

Scoring rate (drive scores at least once): 39.7%. Turnover rate (interception, fumble lost, or turnover on downs): 16.0%.

### End class (offensive drives, n = 5,682)

| end class | n | share |
|---|---:|---:|
| punt | 1,896 | 33.4% |
| touchdown_scored | 1,323 | 23.3% |
| field_goal_made | 931 | 16.4% |
| turnover_on_downs | 362 | 6.4% |
| interception | 349 | 6.1% |
| end_of_game | 216 | 3.8% |
| fumble_lost | 199 | 3.5% |
| end_of_half | 170 | 3.0% |
| field_goal_missed | 153 | 2.7% |
| touchdown_allowed | 65 | 1.1% |
| safety_allowed | 11 | 0.2% |
| blocked_punt | 7 | 0.1% |

Non-offensive drives (n = 40): 6 kickoff-return touchdowns, 14 kickoff fumbles lost, 5 onside kicks lost, 12 halves ending
on a kickoff return, 1 game ending on a kickoff return, 1 kickoff-return touchdown allowed, 1 safety.

Subtypes: `touchdown_allowed` = 28 `interception_return`, 17 `fumble_return`, 15 `punt_return`, 3 `field_goal_return`,
2 `blocked_punt_return`, 1 `kickoff_return`. `interception` = 349 `pass`.

### Distributions by situation (offensive drives)

Start field is the `yardline_100` of the first scrimmage play. Quarter is the quarter of the first offensive play. Score
difference is the offense's score minus the defense's before the first offensive play. Groups under 30 drives are flagged
`small`; none of the groups below is.

Start field

| start field | drives | plays/drive | possession median (s) | pts for | pts against | scoring rate |
|---|---:|---:|---:|---:|---:|---:|
| own 0-19 | 1,496 | 6.85 | 148 | 1.61 | 0.11 | 29.3% |
| own 20-49 | 3,623 | 6.49 | 147 | 2.12 | 0.08 | 39.9% |
| opp 49-20 | 489 | 5.10 | 121 | 3.12 | 0.03 | 63.0% |
| opp 19-0 | 72 | 3.17 | 57 | 4.99 | 0.10 | 81.9% |

Quarter

| quarter | drives | plays/drive | possession median (s) | pts for | pts against | scoring rate |
|---|---:|---:|---:|---:|---:|---:|
| 1 | 1,319 | 7.01 | 183 | 2.37 | 0.12 | 44.6% |
| 2 | 1,487 | 5.88 | 108 | 1.92 | 0.08 | 38.1% |
| 3 | 1,357 | 6.86 | 180 | 2.42 | 0.08 | 43.7% |
| 4 | 1,488 | 6.03 | 116 | 1.77 | 0.06 | 32.9% |
| OT | 31 | 6.71 | 188 | 2.81 | 0.00 | 58.1% |

Score difference at drive start

| score (offense minus defense) | drives | plays/drive | possession median (s) | pts for | pts against | scoring rate |
|---|---:|---:|---:|---:|---:|---:|
| -8 or less | 1,184 | 6.62 | 132 | 1.93 | 0.09 | 34.3% |
| -7 to -1 | 1,439 | 6.61 | 144 | 2.23 | 0.11 | 42.0% |
| tied | 1,023 | 6.68 | 164 | 2.22 | 0.10 | 43.5% |
| +1 to +7 | 1,127 | 6.19 | 142 | 2.10 | 0.06 | 39.7% |
| +8 or more | 909 | 5.85 | 134 | 2.04 | 0.07 | 38.6% |

By team (drives, plays/drive, possession median in seconds, points for and against per drive, scoring rate)

| team | drives | plays | poss. median | pts for | pts against | scoring |
|---|---:|---:|---:|---:|---:|---:|
| ARI | 170 | 6.89 | 150 | 1.99 | 0.12 | 37.1% |
| ATL | 181 | 6.38 | 146 | 1.91 | 0.12 | 37.6% |
| BAL | 178 | 5.97 | 132 | 2.30 | 0.04 | 42.7% |
| BUF | 174 | 6.67 | 175 | 2.64 | 0.00 | 44.8% |
| CAR | 164 | 6.71 | 152.5 | 1.81 | 0.09 | 34.8% |
| CHI | 183 | 6.60 | 161 | 2.33 | 0.04 | 43.7% |
| CIN | 179 | 6.45 | 144 | 2.24 | 0.36 | 40.2% |
| CLE | 194 | 5.95 | 128 | 1.29 | 0.12 | 25.8% |
| DAL | 176 | 6.85 | 155.5 | 2.57 | 0.01 | 48.3% |
| DEN | 188 | 6.41 | 134.5 | 2.06 | 0.00 | 37.8% |
| DET | 187 | 6.17 | 139 | 2.52 | 0.01 | 44.4% |
| GB | 165 | 6.64 | 155 | 2.37 | 0.01 | 43.6% |
| HOU | 190 | 6.41 | 144 | 2.00 | 0.04 | 43.2% |
| IND | 172 | 6.42 | 139 | 2.67 | 0.09 | 50.0% |
| JAX | 189 | 6.30 | 137 | 2.35 | 0.07 | 42.9% |
| KC | 169 | 6.85 | 156 | 2.14 | 0.07 | 42.0% |
| LA | 181 | 6.43 | 154 | 2.79 | 0.16 | 47.0% |
| LAC | 174 | 6.88 | 164.5 | 2.10 | 0.12 | 42.5% |
| LV | 181 | 5.81 | 127 | 1.32 | 0.13 | 26.0% |
| MIA | 174 | 6.00 | 137.5 | 1.94 | 0.08 | 36.8% |
| MIN | 180 | 5.88 | 128.5 | 1.83 | 0.16 | 36.7% |
| NE | 174 | 6.49 | 161.5 | 2.60 | 0.08 | 46.0% |
| NO | 176 | 6.69 | 125.5 | 1.62 | 0.09 | 33.0% |
| NYG | 170 | 6.91 | 160 | 2.16 | 0.12 | 38.8% |
| NYJ | 180 | 6.21 | 138.5 | 1.50 | 0.04 | 30.0% |
| PHI | 178 | 6.25 | 135 | 2.02 | 0.01 | 35.4% |
| PIT | 176 | 6.15 | 130 | 2.13 | 0.05 | 39.2% |
| SEA | 185 | 6.04 | 141 | 2.34 | 0.07 | 45.9% |
| SF | 169 | 6.91 | 155 | 2.54 | 0.09 | 47.9% |
| TB | 179 | 6.59 | 141 | 2.03 | 0.12 | 39.7% |
| TEN | 180 | 6.21 | 133.5 | 1.45 | 0.16 | 30.0% |
| WAS | 166 | 6.52 | 153 | 2.05 | 0.04 | 37.4% |

Team sample sizes run 164 to 194 offensive drives, so team differences of about 0.3 points per drive are inside the noise.
These tables are descriptive; no test is run on them.

### Continuity exceptions (27,242 checked pairs, all matching v1 counts)

| kind | count | evidence category | count |
|---|---:|---|---:|
| field position, unexplained | 58 | `fumble_kept_by_offense` | 53 |
| | | `timeout_text` | 3 |
| | | `reversal_text` | 1 |
| | | `penalty_text_not_flagged` | 1 |
| down progression, unexplained | 2 | `fumble_kept_by_offense` | 2 |
| clock increase within drive | 1 | `timeout_text` | 1 |

Score continuity: 0 violations. The evidence categories are checked against the text of the plays on the pair. They are
leads, not verified causes. `fumble_kept_by_offense` (the text says the offense recovered its own fumble, or the ball went
out of bounds, so the spot moved with the fumble) is the strongest. The other categories name something in the text that
the yardage does not record, and need a look at the source rows before they are called explained. Full rows are in
`continuity_exceptions_2025_v2.csv`, including the six non-fumble cases:

- 2025_03_NYJ_TB: clock 91 to 101 between plays 4761 and 4796, with play 4808 between them; timeout text.
- 2025_06_DAL_CAR: plays 1848 and 1923, with play 1935 between them; timeout text, delta +5.
- 2025_07_TB_DET: plays 3868 and 3898, no play between; timeout text, delta -3.
- 2025_12_TB_LA: plays 2030 and 2057, with play 2069 between them; timeout text, delta +11.
- 2025_09_MIN_DET: plays 2478 and 2505, no play between; reversal text, delta +2.
- 2025_16_CIN_MIA: plays 1486 and 1527, no play between; penalty text with no penalty flag, delta -3.

### Simulator comparison (read-only, descriptive)

Simulator records are in `docs/fixtures/e2` of the gridiron-statistical-full-game repository. Five distinct simulations
exist, counted once each by `simulation_id`: seed 1 (complete, 24 drives), and seeds 9, 11, 101 and 176 (incomplete, 30, 24,
21 and 22 drives). All five records have `valid_full_game: false`.

| end type | simulated (n = 121) | observed 2025 offensive (n = 5,682) |
|---|---:|---:|
| punt | 40.5% | 33.5% |
| touchdown | 18.2% | 23.3% |
| field goal | 19.0% | 19.1% |
| turnover (interception or fumble) | 9.1% | 9.6% |
| turnover on downs | 5.8% | 6.4% |
| end of half or game | 6.6% | 6.8% |
| touchdown allowed | not modelled | 1.1% |
| safety | 0.8% | 0.2% |

Plays per drive: 6.03 simulated, 6.42 observed. Possession median: 108 s simulated (mean 147.7), 142 s observed (mean
170.6). The observed punt share (33.5%) and touchdown share (23.3%) both fall inside rough 95% intervals around the simulated
shares at n = 121. That is a loose check, not a test, and the sample is too small and too incomplete to calibrate against.

Not used: `web/data/game.json` in the simulator repository is a reconstruction of a 2026 game (SEA @ DEN, event 401872995,
dated 2026-10-16). It falls in the sealed 2026 holdout, so I did not use its drives. I read its header only to identify it.

The simulator's drives draw from an E1 pool built on 2022-2025 observed drives, which includes 2025. The simulator sample
is therefore not independent of the 2025 observed data.

## Decisions for you

1. **Which timing for simulator benchmarks.** I recommend `possession_seconds`. Simulator drive records start at the
   drive's first play, and kickoffs are separate records (`kickoffs`). I have not verified the simulator's exact clock
   convention, so check before adopting.
2. **Defensive touchdown precedence.** A pick-six or punt-return touchdown is `touchdown_allowed` with its cause in the
   subtype, not the turnover or the punt. This matches nflverse's `Opp touchdown`. A simulator that records the turnover
   as the drive's end would need the subtype mapped back.
3. **Continuity categories.** Confirm whether the text-based categories are acceptable as labels, or whether each
   unexplained pair needs a row-level look at the spot data before anything is called explained.

## Limits

- No official drive count exists on this machine. Drive counts are internal consistency checks, not official totals.
- nflverse drive-level fields are used only as cross-checks. Their disagreements are recorded in
  `end_class_disagreements_2025_v2.csv`.
- The simulator comparison is descriptive. Its sample is one complete game and four incomplete ones, flagged invalid by
  the simulator itself.

## Files

- `pipeline/canonical_drives_2025_v2.py`: v2 build and checks. Imports v1's splitter and the reconciliation helpers.
- `pipeline/compare_sim_drives_2025_v2.py`: the simulator comparison.
- `test/test_canonical_drives_2025_v2.py`: 27 unit tests on synthetic rows.
- `data/playbooks/research-2026-10-28-canonical-drives-2025-v2/`:
  - `canonical_drives_2025_v2.csv`: one row per kept drive, v2 and v1 fields side by side.
  - `canonical_drives_2025_v2_summary.json`: all counts in this report.
  - `continuity_exceptions_2025_v2.csv`: 61 rows, the 58 field-position, 2 down and 1 clock exceptions, with play IDs
    and text.
  - `end_class_disagreements_2025_v2.csv`: the one transition disagreement.
  - `sim_comparison_2025_v2.json`: the simulator comparison.

Reproduce (about two minutes for the build):

```
python3 -m unittest discover -s test -p 'test_canonical_drives_2025_v2.py'
python3 pipeline/canonical_drives_2025_v2.py
python3 pipeline/compare_sim_drives_2025_v2.py
```
