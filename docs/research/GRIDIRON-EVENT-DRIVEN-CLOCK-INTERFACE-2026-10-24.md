# Gridiron event-driven clock interface v1

Date: 2026-10-24
Interface identifier: `gridiron.event-driven-clock.v1`
Status: consumer contract proposal; no clock engine implementation implied.

This interface carries a producer-authored event sequence for a complete game clock. It does not alter the shared full-game v1 contract or the accepted E2 artifact. The producer must supply non-empty top-level `model_version` and `rules_version`; the consumer rejects missing values and never derives either from a branch, commit, filename, seed, or local default.

## Required event stream

The envelope uses [the v1 JSON Schema](event-driven-clock-v1.schema.json) and contains ordered `events`. Every event has a unique increasing `sequence`, monotonically nondecreasing `game_elapsed_ms`, `period`, `game_clock_seconds`, and `game_clock_status` (`running` or `stopped`). `game_elapsed_ms` is a monotonic timeline within the game, not a wall-clock timestamp. `rules_version` defines period lengths and which transitions are legal.

| Event | Required meaning and fields |
|---|---|
| `period_start` | Opens a period with `period_kind`, `transition_reason`, and its starting game clock. First period, next regulation period, overtime, and resumption after halftime are explicit cases. |
| `play_start` | Snap boundary with `play_id`; starts the physical live-play interval. |
| `play_end` | Whistle/terminal boundary with the same `play_id` and producer-supplied `live_play_duration_ms`. It records the game-clock state after the play. Duration is not computed from the clock runoff. |
| `clock_status_change` | Explicit start or stop with `clock_change_reason`. A consumer does not infer it from an event label such as incomplete pass or out of bounds. |
| `stoppage_start` / `stoppage_end` | Matched `stoppage_id`, `stoppage_type`, and explicit start/end times; include `charged_team` when applicable. No hidden timeout, warning, injury, review, penalty, or administrative interval. |
| `between_play_start` / `between_play_end` | Bound the interval from one play's whistle to the next snap, with `after_play_id`, `before_play_id`, and producer-supplied `between_play_duration_ms`. It is separate from live-play duration and from game-clock runoff. |
| `period_end` | Closes the current period with `period_end_reason` and clock value. A period transition is not inferred solely because a quarter number changed. |
| `game_end` | Ends the game only after a legal final-period transition under the declared rules version. |

The event stream carries the official clock value at every boundary. Consumers check its delta separately across snap-to-whistle and whistle-to-next-snap intervals; a clock delta is not a substitute for live-play duration or between-play elapsed time. Clock-status events and stoppages explain when the official clock runs or stops. A semantic validator checks matched play and stoppage IDs, monotonic event order, clock continuity, no unexplained clock increases, period lengths, and legal period transitions using the producer's `rules_version`.

## What the frozen E2 record supplies

The seed-1 E2 record has per-play `state_before.quarter`, `state_before.clock_seconds`, `state_after.quarter`, `state_after.clock_seconds`, `outcome.clock_runoff_seconds`, `outcome.clock_clamped_to_zero`, `outcome.quarter_change`, and `outcome.clock_only_terminal`. It also has coarse `record.boundaries[]` rows (`from_quarter`, `to_quarter`, `kind`, `clock_before`, `drive_index`) and kickoff `runoff_seconds`. Those values describe the authored retrospective clock sequence; they are not event timestamps or a complete clock audit.

The E2 record cannot supply:

- `live_play_duration_ms` from snap to whistle;
- game-clock `running`/`stopped` state at snap, whistle, or during intervals;
- `between_play_duration_ms` separately from the sampled runoff;
- explicit stoppage start/end, cause, duration, or charged team (timeouts and the two-minute warning are unsupported in E2);
- a complete event-level, rule-validated period-transition sequence. Its boundary rows are summaries, and its quarter/clamp flags do not encode each clock event;
- producer `model_version` and `rules_version` in the raw E2 record.

Therefore a consumer must leave these clock fields unavailable for E2, preserve its supplied runoff and boundary summaries as such, and refuse to claim an event-driven clock reconstruction. It must not invent durations, clock status, stoppages, period events, or version labels. `valid_full_game` and the shared v1 gate remain outside this interface and unchanged.

## Field-goal spot extension

The successor consumer requires `outcome.kick_spot_yardline_100` on the terminal `field_goal_attempt` play and producer-supplied `drive.field_goal_made=false`. The kick spot is the offense-relative position of the ball at the instant of the kick. `state_before.yardline_100` remains the snap position and is never used as a fallback. Missing or invalid kick-spot data rejects the transition. The receiving-team-20 exception uses the separate kick-spot value; `test/missed-field-goal-consumer.mjs` includes a snap-at-19/kick-at-26 counterexample that must not be moved to the receiving 20.

This is a successor consumer requirement. The frozen E2 record and LP repository are not changed by this work.
