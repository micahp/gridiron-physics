# Gridiron full-game consumer ingest guards

Date: 2026-10-24
Scope: successor consumer validation only. The shared full-game v1 contract and frozen E2 evidence are unchanged.

`engine/full-game-ingest-guards.js` enforces four producer-repair gates before a record is consumed:

1. For each play nested in game-level `drives[n]`, `state_before.drive_index`, `state_after.drive_index`, and `drive.index` must all be the same positive integer. A mismatch is a hard reject; the consumer does not relabel either state.
2. A `points_scored_on_drive.try` or a standalone `extra_point` / `two_point_try` event must carry its publisher result field. A touchdown-scoring drive with no try record is also rejected. LP drive records label a two-point try as `kind=two_point`; the shared event spelling is `two_point_try`. Extra points require `extra_point_result` (`good`, `failed`, or `blocked`); two-point attempts require `two_point_conv_result` (`success` or `failure`). The consumer derives the conversion's points from that field, may cross-check an accompanying `made` or `points_scored`, and rejects disagreement. Generic EPA `success` is ignored and cannot fill either missing result.
3. A record that declares `valid_full_game=true` is rejected if any play carries `event_type=penalty`, a penalty marker, or a two-minute-warning event/transition marker. Scoped records may carry those rows but remain non-valid.
4. Any quarter-5-or-later drive, play, kickoff, boundary, or final-quarter marker requires producer `pool_scope.regulation_only=true`. Such rows are tagged as `regulation_only_not_overtime_simulation` and cannot be declared `valid_full_game=true`.

`test/full-game-ingest-guards.mjs` contains negative fixtures for both drive-index mismatch classes, missing publisher result fields with EPA `success` present, legal-complete penalty/two-minute-warning transitions, and overtime rows without the required regulation-only label. It also checks result-driven scoring where EPA success disagrees. These guards are Gridiron-side; LP owns supplying the correct fields and values.

The event-clock envelope independently requires producer-supplied `model_version` and `rules_version` in both its JSON Schema and `ingestEventClockEnvelope`. Neither consumer defaults or infers those labels.
