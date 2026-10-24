# Gridiron full-game consumer ingest guards

Date: 2026-10-24
Scope: successor consumer validation only. The shared full-game v1 contract and frozen E2 evidence are unchanged.

`engine/full-game-ingest-guards.js` enforces two producer-repair gates before a record is consumed:

1. For each play nested in game-level `drives[n]`, `state_before.drive_index`, `state_after.drive_index`, and `drive.index` must all be the same positive integer. A mismatch is a hard reject; the consumer does not relabel either state.
2. A `points_scored_on_drive.try` or a standalone `extra_point` / `two_point_try` event must carry its publisher result field. Extra points require `extra_point_result` (`good`, `failed`, or `blocked`); two-point attempts require `two_point_conv_result` (`success` or `failure`). The consumer derives the conversion's points from that field, may cross-check an accompanying `made` or `points_scored`, and rejects disagreement. Generic EPA `success` is ignored and cannot fill either missing result.

`test/full-game-ingest-guards.mjs` contains negative fixtures for both drive-index mismatch classes and for missing publisher result fields with EPA `success` present. It also checks result-driven scoring where EPA success disagrees. These guards are Gridiron-side; LP owns supplying the correct fields and values.

The event-clock envelope independently requires producer-supplied `model_version` and `rules_version` in both its JSON Schema and `ingestEventClockEnvelope`. Neither consumer defaults or infers those labels.
