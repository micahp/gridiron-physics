# Drive benchmark readiness, 2026-10-28

Status: research only. No deployment. No model promotion. No change to the simulation engine. The 2025 reference
(v1 and v2) is unchanged, and the hashes are recorded in `manifest.json`.

## Verdict

- **Reference dataset (2025 canonical drives, v2): ready** as the research reference. Its checks pass, and every
  continuity exception but one is explained from the play text. The open one does not change any drive's start or end.
- **`possession_seconds` as the benchmark field: verified against the simulator's clock convention**, on the simulator's
  own records. It stays provisional until a simulator export meets the schema.
- **Simulator benchmark: not ready.** Three blockers, below. The first needs a decision from you.

Blockers:

1. **No S0 control export that this work may read.** The hermes2 pane reports the unconditioned S0 pool from the Week 8
   simulation runs, in `lp-week08-simulation-error-fix`, report `week08-simulator-runs-2026-10-27.md`. Those are 2026
   holdout games, and you asked this work not to read or evaluate them. I did not open their results, including for schema
   matching. To proceed, either (a) you authorize reading only the field names and shapes of the S0 export, or (b) an
   S0-equivalent unconditioned run is produced on 2025 matchups. Option (b) is a new simulation run, so it needs your
   approval too.
2. **No simulator export under the schema.** The five simulated games in the e2 fixtures include one complete game
   (24 drives). All five records are marked `valid_full_game: false`, and they lack the touchdown subtype and an explicit
   `points_against`.
3. **No pass or fail threshold** for the matching comparison. That is a decision for you.

## Criteria

| # | criterion | result | evidence |
|---|---|---|---|
| 1 | Reference frozen | 8 files hashed. Unchanged across two audit runs. | `manifest.json` |
| 2 | Drive construction | 5,722 kept drives, same as v1. 5,682 offensive. No negative elapsed times. | `canonical_drives_2025_v2_summary.json` |
| 3 | Points tie to official final scores | v2: 544 of 544 team-games. v1: 475 of 544. | v2 summary |
| 4 | Continuity counts match v1 | Identical on all 8 keys. | `continuity_matches_v1` |
| 5 | Possession change after a drive ends | 5,145 transitions checked, half and game boundaries excluded. 0 exceptions. | `drive_checks_2025.json` |
| 6 | `touchdown_allowed` cause and points | 66 drives. Cause flags consistent in 66 of 66. Points against: 6 (6 drives), 7 (59), 8 (1). Consistent with a touchdown plus a conversion result. I spot-checked three drives, not all 66. Points for 0 in every case. 63 are followed by a kickoff to the team scored upon. The other 3 are the last drive of a game. | `drive_checks_2025.json` |
| 7 | Clock convention, simulator side | 121 simulated drives. Start clock equals first play's clock in 121 of 121. End clock equals last play's post-play clock in 121 of 121. Kickoff restart equals `clock_before - runoff` in 48 of 48. 2 kickoffs expired the quarter. | `simulator_clock_convention` |
| 8 | Clock convention, reference side | Assumption: the next row's clock is the post-play clock of the last play. nflverse records no post-play clock, so this cannot be checked directly. | this report |
| 9 | Continuity exceptions | 61 in v2. 60 explained from the play text (below). 1 unresolved (source clock). | `continuity_audit_2025.csv` |
| 10 | nflverse cross-checks | `fixed_drive_result`: 5,703 agree, 14 match the next possession, 5 share an nflverse ID with the next possession, 0 disagree. `drive_end_transition`: 5,719 agree, 2 share an ID, 1 disagrees (TEN-ARI, explained in the v2 report). | v2 CSV |
| 11 | Export schema | Documented. The simulator already emits most fields. Gaps: touchdown subtype, explicit `points_against`, blocked kicks, and the split of turnover terminals. | schema document and JSON |
| 12 | Holdout | No 2026 game data used in the drive work. Earlier in this work I read only the header of one 2026 simulator file, to identify it. Its drives were not used. | this report |
| 13 | Simulator engine and E2 runs | Unchanged. The E2 records were read only for the clock convention. No tuning. The simulator repository has no modified files. | `git status` |

## Continuity classification (61 exceptions)

v2's labels are kept as they were. The audit adds a mechanism to each row, in `continuity_audit_2025.csv`.

| kind | count | audit status and mechanism |
|---|---:|---|
| field position | 58 | Explained by `fumble_end_spot`. The yardage fails, the pair has no penalty flag, the play text has a fumble, and the last spot named in the text equals the next play's `yardline_100` in 58 of 58 cases. |
| down progression | 2 | Explained by `fumble_end_spot_net_gain`. The first-down test from the end spot matches the next play's down in both cases. |
| clock | 1 | Unresolved. `source_clock_unexplained_rise`. See below. |

Five of the 58 field-position cases carry the wrong v2 label. They show timeout (3), reversal (1) or penalty text (1),
because v2's text check finds those words before it finds the fumble. The mechanism in each is the fumble spot:

- 2025_06_DAL_CAR: two fumbles on one play. The last recovery is at DAL 45, which is the next play's spot.
- 2025_07_TB_DET: fumble recovered by TB at DET 29, the next play's spot.
- 2025_09_MIN_DET: fumble recovered at DET 46. The reversal belongs to the next play's own text, not to this spot.
- 2025_12_TB_LA: fumble recovered at TB 40. The next play starts at TB 40, which is a yardline_100 of 60.
- 2025_16_CIN_MIA: fumble recovered by MIA at CIN 37, then a 3-yard run to CIN 34. The penalty in the next play's
  text was declined, so it does not change the spot.

Two down cases:

- 2025_12_CAR_SF: a 1-yard run to SF 18, then a fumble recovered at SF 33. The net gain from the start spot is 16 yards,
  so the next play is first down.
- 2025_17_HOU_LAC: a pass reached the first-down marker, then a fumble ran out of bounds at HOU 21. The net gain is 6
  yards, so the next play is third down with 4 to go. v2's `yards_gained` rule expected first down and missed this.

### Why the rule is applied only to these cases

The end-spot rule is not general. It is exact within the exception set. On the rest of the checked pairs it is a
weaker predictor:

| group (checked pairs) | yardage check | penalty flag | end-spot rule |
|---|---|---|---|
| fumble text | fails | no | hit 58 of 58 |
| fumble text | fails | yes | hit 1, miss 19 (not tested: the penalty moves the ball) |
| fumble text | ok | no | hit 104, miss 23 |
| no fumble text | ok | no | hit 20,758, miss 29 |
| no fumble text | fails | yes | miss 1,862, no spot 309 (not tested: penalties) |

So the rule should apply only where the yardage fails and no penalty is flagged. The 58 exceptions are exactly that
group. The 2,191 yardage failures with a penalty flag are labelled `explained` by v2 on the strength of the flag. This
work did not check those labels, and they are not among the 61.

### The unresolved case: 2025_03_NYJ_TB

Play 4761 (gsr 91, 1:31) is an incomplete pass at TB's 38. Play 4796 (gsr 101, 1:41) starts at the same spot and gains 20
yards. Play 4828 (gsr 52) follows. The timeout row 4808 also reads 1:41. The yardline chain puts 4796 between 4761 and
4828, so its clock of 1:41 is later than the play before it, which cannot happen in one drive.

The source cannot be corrected from the file. Play 4796 sits at position 5 of 11 in drive 22, so it is neither the first
nor the last row. Drive start and end clocks, and therefore every duration, are unaffected.

## Clock rises in file order (whole season)

- 14 overtime starts: the period clock resets from 0 to 600. Expected.
- 1 unresolved: 2025_03_NYJ_TB above.

## Exact fixes (proposed, not applied)

None of these changes a v2 drive row or a v2 summary number. A v3 is therefore not needed for benchmarking. The fixes
change how the checks label exceptions.

| fix | where | rows affected | changes v2 drive numbers? |
|---|---|---|---|
| F1. Apply the end-spot rule before the text categories, and only where the yardage fails with no penalty flag. | continuity check | 5 labels change: timeout 3, reversal 1, penalty 1, to `fumble_end_spot` | no |
| F2. Down-progression expectation uses net movement from the end spot on fumble plays, not `yards_gained`. | continuity check | 2 labels, both already right in the audit | no |
| F3. Spot parsing: last spot named in the text, bare numbers ("at 50"), skip clock times and player numbers. | continuity check | the 58 cases depend on it; without it the rule misses NYJ-MIA ("at 50") | no |
| F4. Kickoff parser: for onside kicks the receiving team is the opponent of the kicking team. Handle "from 50" with no team. | audit checker only | 46 apparent mismatches were parser errors. 15 kickoffs have no team in the from-spot. | no |
| F5. Possession expectation after a safety is the scoring team, by kickoff. | audit checker only | 11 apparent exceptions were the checker's expectation, reversed | no |
| F6. Report every clock rise in file order except overtime starts. | audit checker only | adds visibility; 1 open case stays open at the source | no |

The v2 point attribution is correct, and the v1 points stay wrong (475 of 544 tie). v1 is immutable, so downstream
users should read v2 for drive points. Anything that reads v1's `end_reason` or `points_against` inherits the v1 defects
described in the v2 report.

## What is needed to move the simulator benchmark forward

1. Your decision on the S0 control: option (a) or (b) above.
2. A simulator export under `drive_export_schema.json`, from either the S0 control or an agreed run. Until then the
   comparison is not run.
3. A decision on pass and fail thresholds, or a decision that the comparison stays descriptive.
4. Confirmation of `possession_seconds` as the benchmark field. The simulator-side convention is verified. The
   reference-side equivalence is an assumption, stated in criterion 8.

## Limits

- The reference uses nflverse play-by-play. No official drive count is on this machine. Drive counts are internal
  consistency checks.
- The 2025 reference and the simulator's E1 drive pool (2022 to 2025) overlap. The simulator's inputs include 2025 data.
- Overtime is not validated against the simulator. The e2 records are regulation only.
- The end-spot rule is a text-based mechanism. It is exact on the 58 exceptions and was not validated beyond that
  group.

## Files

- `docs/research/DRIVE-BENCHMARK-EXPORT-SCHEMA-2026-10-28.md`: export schema.
- `docs/research/DRIVE-BENCHMARK-READINESS-2026-10-28.md`: this report.
- `pipeline/audit_drive_benchmark_2025.py`, `test/test_audit_drive_benchmark_2025.py`: audit and its 14 tests.
- `data/playbooks/research-2026-10-28-drive-benchmark-audit/`:
  - `continuity_audit_2025.csv`: the 61 exceptions with v2 labels and audit mechanisms.
  - `drive_checks_2025.json`: possession, touchdown, clock, control and simulator-convention checks.
  - `drive_export_schema.json`: machine-readable schema.
  - `manifest.json`: SHA-256 hashes of the immutable v1 and v2 files.

Reproduce:

```
python3 -m unittest discover -s test -p 'test_canonical_drives_2025_v2.py'
python3 -m unittest discover -s test -p 'test_audit_drive_benchmark_2025.py'
python3 pipeline/audit_drive_benchmark_2025.py
```
