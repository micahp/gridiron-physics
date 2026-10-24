# Gridiron E2 open finding register — 2026-10-24

Evidence pins: LP E2 producer `5fcaa6bc3ab92ab54cb584511f5205a2e1b4be0f`; raw LP seed-1 payload SHA-256 `ff061723ccbc09d61d6715a3d10aae27d32911f4ee5c95211415d78bd2543b4e`; Gridiron transport fixture SHA-256 `b18d1c864685c0f7f3ef7682165cda83eed16d198939a0760cfe4df8696cc66c`.

The exact pinned LP payload has 24 drives and 144 plays. The adapter reports 23 per-drive state findings and 10 shared `GRIDIRON-CONTRACT-v1` gaps. Every drive-index finding is LP producer-side. The v1 gaps are triaged below; three Gridiron audit defects were corrected: as-of is read from the contract's top-level field, score/timeout checks inspect both play states, and A/B placeholders fail the team-identity check. The source record and outcomes remain unchanged. `GRIDIRON-CONTRACT-v1.md` is unchanged.

## Drive-index findings (23)

Each line records the adapter's one finding for that drive: both before and after state values are `1`, while the drive index is 2–24.

| # | File | Field | Fault side |
|---:|---|---|---|
| 1 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[1].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `2` | LP E2 producer-side |
| 2 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[2].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `3` | LP E2 producer-side |
| 3 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[3].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `4` | LP E2 producer-side |
| 4 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[4].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `5` | LP E2 producer-side |
| 5 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[5].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `6` | LP E2 producer-side |
| 6 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[6].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `7` | LP E2 producer-side |
| 7 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[7].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `8` | LP E2 producer-side |
| 8 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[8].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `9` | LP E2 producer-side |
| 9 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[9].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `10` | LP E2 producer-side |
| 10 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[10].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `11` | LP E2 producer-side |
| 11 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[11].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `12` | LP E2 producer-side |
| 12 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[12].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `13` | LP E2 producer-side |
| 13 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[13].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `14` | LP E2 producer-side |
| 14 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[14].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `15` | LP E2 producer-side |
| 15 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[15].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `16` | LP E2 producer-side |
| 16 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[16].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `17` | LP E2 producer-side |
| 17 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[17].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `18` | LP E2 producer-side |
| 18 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[18].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `19` | LP E2 producer-side |
| 19 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[19].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `20` | LP E2 producer-side |
| 20 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[20].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `21` | LP E2 producer-side |
| 21 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[21].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `22` | LP E2 producer-side |
| 22 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[22].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `23` | LP E2 producer-side |
| 23 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[23].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `24` | LP E2 producer-side |

## Shared-contract audit violations (10)

| # | File | Field | Fault side | V1 triage for LP / Claude |
|---:|---|---|---|---|
| 1 | `scripts/nfl_sequence/game_state.py` | `record.mode`: `legal_game_state_first_piece`, not `pregame_full_game` | LP E2 producer-side | Expected for this retrospective E2 artifact; a v1 producer must emit the required mode. |
| 2 | `scripts/nfl_sequence/game_state.py` | `record.game_id`: stable scheduled game ID absent | LP E2 producer-side | Required for v1; do not synthesize a scheduled matchup in Gridiron. |
| 3 | `scripts/nfl_sequence/game_state.py` | `record.model_version`: absent as a top-level record field | LP E2 producer-side | Required explicit field for v1; do not infer it from `simulation_id`. |
| 4 | `scripts/nfl_sequence/game_state.py` | `record.rules_version`: absent | LP E2 producer-side | Required explicit field for v1. |
| 5 | `scripts/nfl_sequence/game_state.py` | top-level `record.as_of_utc` and `record.scheduled_kickoff_utc`: absent; source says as-of unknown | LP E2 producer-side | Required pregame cutoff for v1; current source is retrospective. Gridiron now checks the documented top-level fields. |
| 6 | `scripts/nfl_sequence/game_state.py` | `record.teams.home` and `record.teams.away`: real team identities absent (record uses A/B) | LP E2 producer-side | Required for v1; A/B cannot be promoted to team identities. |
| 7 | `scripts/nfl_sequence/game_state.py` | `record.roster_snapshot_id`: eligible roster snapshot absent | LP E2 producer-side | Required for v1; sampled participants are not a roster snapshot. |
| 8 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[*].plays[*].state_before/state_after.home_score/away_score`: null | LP E2 producer-side | Required at both state boundaries for v1; Gridiron preserves nulls. |
| 9 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[*].plays[*].state_before/state_after.home_timeouts/away_timeouts`: null | LP E2 producer-side | Required at both state boundaries for v1; timeout rules remain unsupported. |
| 10 | `scripts/nfl_sequence/game_state.py` | `record.valid_full_game`: `false` | LP E2 producer-side | Correct guard for this artifact while rules are unsupported; do not flip it to satisfy the v1 gate. |

The LP-side rows above are a pinned note for Claude. The E2 payload is allowed to remain a retrospective first piece, but it cannot be represented as shared v1. Gridiron does not fill fields, relabel the mode, or set `valid_full_game`.

Gridiron's consumer audit is `auditGridironContractV1Record` in `web/lp-game-record-adapter.js`. It now checks top-level pregame metadata, rejects placeholder A/B team IDs, and checks both `state_before` and `state_after`. The viewer verifies that its wrapped record is structurally identical to the pinned LP record before rendering it.
