# Drive benchmark export schema, version 1

Date: 2026-10-28. Status: research only. Not promoted. No pass or fail threshold is defined.

This is the contract a simulator run must meet before its drives can be compared with the 2025 reference. The machine
copy is `data/playbooks/research-2026-10-28-drive-benchmark-audit/drive_export_schema.json`. The two must agree.

## Reference

- Dataset: `canonical-drives-2025-v2`, 2025 regular season, 272 games. Frozen; hashes in
  `data/playbooks/research-2026-10-28-drive-benchmark-audit/manifest.json`.
- Comparison population: drives with `offensive = true` (5,682 in the reference).
- Reference values for the offensive drives:

| measure | value |
|---|---:|
| offense plays per drive, mean / median | 6.42 / 6 |
| possession seconds, median / mean | 142 / 170.6 |
| kickoff-to-end seconds, median / mean | 145 / 173.3 |
| points for per drive, mean | 2.11 |
| points against per drive, mean | 0.08 |
| scoring rate | 39.7% |
| turnover rate (interception, fumble lost, turnover on downs) | 16.0% |

## Units

- Clock: seconds of game clock. In regulation, `game_seconds_remaining = (4 - quarter) * 900 + clock_seconds`.
  Overtime is not validated against the simulator.
- `yardline_100`: yards from the offense's opponent goal line, 0 to 100. 100 is the offense's own goal line.

## Drive fields

| field | type | null | definition |
|---|---|---|---|
| `game_id` | string | no | Game identifier. |
| `drive_index` | integer >= 1 | no | 1-based position in game order. Counts non-offensive segments. |
| `team` | string | no | The drive's possession team. |
| `half` | 1, 2 or "OT" | no | 1 = quarters 1 and 2; 2 = quarters 3 and 4. |
| `start_quarter` | integer 1 to 5 | yes | Quarter of the first offensive play. 5 = overtime. |
| `offensive` | boolean | no | True when `offense_plays > 0`. The comparison population. |
| `offense_plays` | integer >= 0 | no | Run, pass (including sacks), qb_kneel, qb_spike, punt and field goal plays. Kickoffs, extra points, two-point attempts and no-play rows are not counted. |
| `scrimmage_plays` | integer >= 0 | no | Run, pass (including sacks), qb_kneel and qb_spike plays. |
| `yards_run_pass` | number | no | Yards gained on run and pass plays. Sacks count as negative pass yards. |
| `first_down_gained` | boolean | no | Any run or pass play in the drive records a first down. |
| `start_yardline_100` | number 0 to 100 | yes | `yardline_100` at the first scrimmage play. |
| `score_diff_at_start` | integer | yes | Team score minus opponent score before the first offensive play. |
| `kickoff_to_end_seconds` | number >= 0 | yes | Clock at the first timed row minus the end clock. Includes the kickoff. |
| `possession_seconds` | number >= 0 | yes | Clock at the first offensive play minus the end clock. Excludes the kickoff. **Provisional benchmark field.** |
| `end_clock_basis` | enum | no | `half_end_row`, `game_end_row` or `next_drive_first_row`. A simulator uses `post_play_clock_of_last_play`. |
| `points_for` | integer >= 0 | no | Points the drive's team scored while on the field. Touchdown 6, extra point 1, two-point try 2, field goal 3. |
| `points_against` | integer >= 0 | no | Points the opponent scored while on the drive. Defensive or return touchdown 6, the conversion after it, a defensive two-point try 2, a safety 2. |
| `end_class` | enum | no | How the drive ended. See below. |
| `end_subtype` | string | no | Cause within the end class. Empty when the class has no subtype. |

`possession_seconds` is not official time of possession. Official time of possession is not on this machine, and the
two measures must not be treated as the same quantity.

## End classes

| end class | subtypes | meaning |
|---|---|---|
| `touchdown_scored` | run, pass, kickoff, punt | The drive's team scored a touchdown. |
| `touchdown_allowed` | interception_return, fumble_return, punt_return, blocked_punt_return, field_goal_return, kickoff_return | The opponent scored a defensive or return touchdown on this drive. The cause is kept in the subtype. |
| `safety_allowed` | run, pass, no_play | The drive's team gave up a safety. |
| `field_goal_made` | none | The last offensive play was a made field goal. |
| `field_goal_missed` | missed, blocked | The last offensive play was a missed or blocked field goal. |
| `punt` | none, fumble_on_return | The last offensive play was a punt that was not blocked. |
| `blocked_punt` | none | The last offensive play was a blocked punt. |
| `interception` | pass | The drive's team threw an interception that ended the drive. |
| `fumble_lost` | run, pass | The drive's team lost a fumble that ended the drive. |
| `turnover_on_downs` | none | The drive ended on downs. |
| `end_of_half` | none, kickoff_return | The first half ended during the drive. From the transition field. |
| `end_of_game` | none, kickoff_return | The game ended during the drive. From the transition field. |

Non-offensive classes, outside the comparison population: `kickoff_fumble_lost`, `onside_kick_lost`,
`no_offensive_play`.

The end class is read from explicit row fields, not from the quarter. A touchdown or safety takes precedence over the
last play. This matches nflverse's own `Opp touchdown` and `Safety` results.

## Simulator terminal map (proposed)

The simulator's current terminals are `touchdown`, `field_goal_attempt`, `punt`, `turnover`, `turnover_on_downs`,
`safety`, `halftime` and `end_of_regulation`. Each needs a check on a worked example before use.

| simulator value | end class | gap |
|---|---|---|
| `touchdown`, points team = offense | `touchdown_scored` | Subtype not recorded. |
| `touchdown`, points team != offense | `touchdown_allowed` | Subtype not recorded. Must come from the play events. |
| `field_goal_attempt`, made | `field_goal_made` | None. |
| `field_goal_attempt`, not made | `field_goal_missed` | Blocked kicks are not modelled. |
| `punt` | `punt` | Blocked punts are not modelled. |
| `turnover` | `interception` or `fumble_lost` | The terminal does not separate them. Use the last play's event type. |
| `turnover_on_downs` | `turnover_on_downs` | None. |
| `safety` | `safety_allowed` | Confirm which team the terminal belongs to. |
| `halftime` | `end_of_half` | Confirm. |
| `end_of_regulation` | `end_of_game` | Confirm that it is the game's last drive. |

Points: the simulator's `points_scored_on_drive` records `team`, `points` and `try`. It does not record
`points_against` for the other team. The export must supply both values.

Kickoffs are separate records in the simulator. A kickoff segment that starts a drive must be exported as a drive, with
`offense_plays = 0` when no scrimmage play follows.

## Segmentation rules

1. A drive starts at each change of possession and at each regulation half start.
2. A kickoff received starts a drive. A kickoff segment with no scrimmage play is a non-offensive drive.
3. A touchdown ends the scoring drive. The extra point or two-point attempt stays with that drive.
4. After a safety, the team that gave it up kicks a free kick from its own 20. The team that scored receives. The
   next drive therefore belongs to the scoring team and starts with a kickoff.
5. `possession_seconds` starts at the first offensive play's clock, so the kickoff runoff is excluded. The simulator's
   records confirm this convention; see the readiness report.

## Matching comparison

Compare offensive drives only, in these buckets:

- Start field: own 0 to 19 (`yardline_100 >= 80`), own 20 to 49 (`50 <= yardline_100 < 80`), opponent 49 to 20
  (`20 <= yardline_100 < 50`), opponent 19 to 0 (`yardline_100 < 20`).
- Quarter of the first offensive play: 1, 2, 3, 4, OT.
- Score difference at start: -8 or less, -7 to -1, tied, +1 to +7, +8 or more.
- End class, as listed above.

Metrics: offense plays (mean and median), yards run and pass (mean), possession seconds (median and mean), points for
and against per drive, end-class shares, scoring rate, and turnover rate. Each metric is reported with its sample size.
Buckets with fewer than 30 drives are flagged and not compared.

The comparison is descriptive. No pass or fail threshold is defined. Setting one needs a decision from you.

## Control runs

The unconditioned S0 runs are the control for any comparison. Their export must meet this schema. See the readiness
report: the S0 pool that hermes2 reported is 2026 holdout games, and this work does not read it.
