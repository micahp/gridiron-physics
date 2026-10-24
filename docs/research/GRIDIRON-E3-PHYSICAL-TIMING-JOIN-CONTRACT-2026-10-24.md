# E3 physical-timing join contract (2026-10-24)

Machine-readable schema: `gridiron.bdb2025.snap_physical_timing.v2` in `gridiron-e3-physical-timing-2026-10-24.json`.

## Join keys and coverage

Each of the 9,289 records retains the BDB source identifiers `game_id` (integer) and `play_id` (integer). These identify the tracking play; they are **not** LP `nfl_pbp` keys.

The exact LP play join is the composite pair:

- `lp_game_id` (string) → `nfl_pbp.game_id`
- `lp_play_id` (integer) → `nfl_pbp.play_id`

These values are copied from the read-only LP BDB-to-PBP crosswalk pinned in `input_manifest.lp_clock_audit_crosswalk_and_crosscheck`. Join only when both are non-null and `lp_join_status` is `matched`. The pair is unique for all 9,066 matched records. `unmatched` means no LP key was present in that crosswalk; it does not assert that an LP play could never be found through another mapping.

| Records | Have LP join keys | Partial / unresolved |
| --- | ---: | ---: |
| All cohort plays | 9,066 of 9,289 | 223 have no LP keys |
| Timing-resolved plays | 9,060 of 9,283 | 223 have timing but no LP keys |
| Carrier-candidate plays | 7,386 of 7,576 | 190 have no LP keys |

Six records have LP keys but no terminal event/time. Of the 7,386 carrier-candidate records with LP keys, five lack terminal timing; the remaining 7,381 have both a carrier candidate and resolved timing. The JSON marks these cases with `lp_join_status`, `timing_status`, null fields, and the `coverage` counts.

## Per-play fields

| JSON field | Meaning and permitted inference | Do not infer |
| --- | --- | --- |
| `game_id`, `play_id` | BDB source game/play IDs; stable key for joining back to the tracking source. | They are not LP `nfl_pbp` IDs. |
| `lp_game_id`, `lp_play_id` | LP's exact `nfl_pbp` composite key when crosswalked. | Null does not mean a zero-valued key or a failed play. |
| `lp_join_status` | `matched` when both LP key fields exist; otherwise `unmatched`. | It does not describe timing or outcome completeness. |
| `week` | Development-data week, always 1–5. | No held-out weeks 6–9 are represented. |
| `snap_frame`, `snap_event_frame`, `snap_event_time` | Manifest frame, matched tracking `ball_snap` frame, and source timestamp. `snap_event_matches_manifest` reports the equality check. | A timestamp is sampled tracking time, not sub-frame precision. |
| `terminal_frame`, `terminal_event_time` | Earliest supported terminal tracking marker at or after the matched snap. Both are null when unresolved. | The marker is not a whistle timestamp or an official play-end ruling. |
| `terminal_event` | Raw terminal event marker from tracking, such as `tackle` or `pass_outcome_incomplete`. | It is not an LP result label. |
| `outcome_family_tracking_only` | Normalized family derived only from `terminal_event`; null when unresolved. | It does not imply a credited tackler, exact play type, or model prediction. |
| `timing_status` | `resolved` when event-to-event duration and family are present; otherwise `unresolved_terminal`. | It does not signal LP key availability. |
| `elapsed_seconds` | Difference between terminal-event and snap-event timestamps; retrospective in-play duration estimate. | It is not clock runoff or stoppage duration. |
| `elapsed_frames`, `elapsed_seconds_from_frames` | Frame difference and its 10 Hz conversion, retained for consistency checks. | They do not add timing resolution beyond the source sampling. |
| `carrier_candidates` | Empty or a one-item array for the selected nearest-player candidate at an acquisition marker, with supported terminal-marker fallback. | It is not adjudicated possession or a certified ball-carrier label. |
| `carrier_candidates[].nfl_id` | BDB tracking player ID for that candidate. | Do not use it as a prospective input; candidate identity is retrospective. |
| `carrier_candidates[].event_marker`, `event_frame` | Tracking marker and frame used to identify the candidate. | The marker frame does not contribute to snap kinematics. |
| `carrier_candidates[].distance_to_football_yards` | Candidate's distance to the tracked football at the identity frame; retained as an uncertainty diagnostic. | A small distance alone does not prove possession. |
| `carrier_candidates[].kinematics_at_snap` | Candidate's snap kinematics, derived from `x/y` at snap and the two preceding frames. | No post-snap player position is included in these values. |
| `clock_audit_crosscheck_only` | Separate LP outcome/event/duration references used only for auditing. | These labels do not define the tracking-only family or duration. |

The exact per-player kinematics fields inside `kinematics_at_snap` are:

- `velocity_x_yards_per_second`, `velocity_y_yards_per_second`, `speed_yards_per_second`
- `acceleration_x_yards_per_second_squared`, `acceleration_y_yards_per_second_squared`, `acceleration_magnitude_yards_per_second_squared`
- `tracking_speed_at_snap_yards_per_second`, `tracking_acceleration_at_snap_yards_per_second_squared` (source `s`/`a` reference values)

## Consumer rules

For LP `nfl_pbp`, join on `(lp_game_id, lp_play_id)` only. Use `elapsed_seconds` as a tracking-informed retrospective in-play duration estimate; leave null timing null. Do not substitute it for game-clock runoff. The LP clock audit cannot infer stoppage attribution from this cohort.

The pinned LP E3 clock-decomposition artifact is consumed as an independent, labelled record and joined by the same composite key. Its source header, hashes, producer provenance, null policy, and exact overlap with this cohort are recorded in [the LP clock consumer addendum](GRIDIRON-E3-LP-CLOCK-DECOMPOSITION-CONSUMER-2026-10-24.md). LP's `in_play_s`, `game_clock_delta_s`, `residual_s`, and `real_snap_to_next_snap_s` remain separate measurements; the consumer never substitutes this cohort's `elapsed_seconds` for an LP clock field.

The dataset uses snap-anchored, all-22-player cohort eligibility, but the carrier candidate is chosen retrospectively. It is suitable for descriptive timing and kinematics evaluation, not for constructing a prospective-from-snap carrier input or predicting tackle, yards, scoring, or game outcomes. Sampling is 10 Hz; there is no whistle timestamp and no stoppage attribution.

## Pins

The JSON SHA-256 is `e885fd20be7fe54f429c31f98dff11425538d331e383c90527141dd78754a63b`. The input file hashes are in the JSON `input_manifest` and the accompanying physical-timing research report.
