# Gridiron E2 open finding register — 2026-10-24

Viewer pin remains LP E2 producer `5fcaa6bc3ab92ab54cb584511f5205a2e1b4be0f`; raw seed-1 payload SHA-256 `ff061723ccbc09d61d6715a3d10aae27d32911f4ee5c95211415d78bd2543b4e`; Gridiron transport SHA-256 `b18d1c864685c0f7f3ef7682165cda83eed16d198939a0760cfe4df8696cc66c`. The latest committed LP producer checked here is `f12c1c6bf9faaf3f070726ead017f2c5854353f2`. A clean-commit seed-1 regeneration has raw SHA-256 `0a3ed1cb216fa3f23784b427d2bf6e68ac877ab1995fb86cd5998d35d5b47821`: 24 drives, 143 plays, A 14–B 10, and `valid_full_game=false`. The viewer pin has not moved; its 5fc payload remains the failing regression fixture.

Latest LP f12 output has zero independent football-state findings: all 23 drive-index defects are closed, score snapshots reconcile to the A 14–B 10 drive ledger, and score/timeout boundary checks pass. The adapter retains a hard reject and the pinned 5fc payload retains all 23 index mismatches as a regression fixture. The latest source explicitly keeps `valid_full_game=false`. The consumer v1 audit now verifies the score and timeout fields, closing those two gaps; eight v1 gaps remain open and are triaged below. Timeout rules remain listed unsupported, so populated timeout snapshots do not establish timeout-call behavior. `GRIDIRON-CONTRACT-v1.md` is unchanged.

## Drive-index findings (23): closed in LP f12; retained as pinned regression

These are the 23 historical findings from the pinned 5fc payload: both state values are `1`, while the drive index is 2–24. LP commit `a450b01a` writes the enclosing game-level drive index into both states; the clean f12 regeneration verifies all 23 are closed. Each old finding remains a hard-failing adapter regression.

| # | File | Field | Fault side | Current status |
|---:|---|---|---|---|
| 1 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[1].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `2` | LP E2 producer-side | CLOSED in f12; retained in 5fc regression |
| 2 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[2].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `3` | LP E2 producer-side | CLOSED in f12; retained in 5fc regression |
| 3 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[3].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `4` | LP E2 producer-side | CLOSED in f12; retained in 5fc regression |
| 4 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[4].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `5` | LP E2 producer-side | CLOSED in f12; retained in 5fc regression |
| 5 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[5].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `6` | LP E2 producer-side | CLOSED in f12; retained in 5fc regression |
| 6 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[6].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `7` | LP E2 producer-side | CLOSED in f12; retained in 5fc regression |
| 7 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[7].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `8` | LP E2 producer-side | CLOSED in f12; retained in 5fc regression |
| 8 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[8].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `9` | LP E2 producer-side | CLOSED in f12; retained in 5fc regression |
| 9 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[9].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `10` | LP E2 producer-side | CLOSED in f12; retained in 5fc regression |
| 10 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[10].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `11` | LP E2 producer-side | CLOSED in f12; retained in 5fc regression |
| 11 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[11].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `12` | LP E2 producer-side | CLOSED in f12; retained in 5fc regression |
| 12 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[12].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `13` | LP E2 producer-side | CLOSED in f12; retained in 5fc regression |
| 13 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[13].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `14` | LP E2 producer-side | CLOSED in f12; retained in 5fc regression |
| 14 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[14].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `15` | LP E2 producer-side | CLOSED in f12; retained in 5fc regression |
| 15 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[15].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `16` | LP E2 producer-side | CLOSED in f12; retained in 5fc regression |
| 16 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[16].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `17` | LP E2 producer-side | CLOSED in f12; retained in 5fc regression |
| 17 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[17].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `18` | LP E2 producer-side | CLOSED in f12; retained in 5fc regression |
| 18 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[18].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `19` | LP E2 producer-side | CLOSED in f12; retained in 5fc regression |
| 19 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[19].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `20` | LP E2 producer-side | CLOSED in f12; retained in 5fc regression |
| 20 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[20].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `21` | LP E2 producer-side | CLOSED in f12; retained in 5fc regression |
| 21 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[21].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `22` | LP E2 producer-side | CLOSED in f12; retained in 5fc regression |
| 22 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[22].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `23` | LP E2 producer-side | CLOSED in f12; retained in 5fc regression |
| 23 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[23].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `24` | LP E2 producer-side | CLOSED in f12; retained in 5fc regression |

## Shared-contract audit violations (10): two closed, eight remain open in latest LP output

| # | File | Field | Fault side | V1 triage for LP / Claude | Current status |
|---:|---|---|---|---|---|
| 1 | `scripts/nfl_sequence/game_state.py` | `record.mode`: `legal_game_state_first_piece`, not `pregame_full_game` | LP E2 producer-side | Expected for this retrospective E2 artifact; a v1 producer must emit the required mode. | OPEN |
| 2 | `scripts/nfl_sequence/game_state.py` | `record.game_id`: stable scheduled game ID absent | LP E2 producer-side | Required for v1; do not synthesize a scheduled matchup in Gridiron. | OPEN |
| 3 | `scripts/nfl_sequence/game_state.py` | `record.model_version`: absent as a top-level record field | LP E2 producer-side | Required explicit field for v1; do not infer it from `simulation_id`. | OPEN |
| 4 | `scripts/nfl_sequence/game_state.py` | `record.rules_version`: absent | LP E2 producer-side | Required explicit field for v1. | OPEN |
| 5 | `scripts/nfl_sequence/game_state.py` | top-level `record.as_of_utc` and `record.scheduled_kickoff_utc`: absent; source says as-of unknown | LP E2 producer-side | Required pregame cutoff for v1; current source is retrospective. Gridiron now checks the documented top-level fields. | OPEN |
| 6 | `scripts/nfl_sequence/game_state.py` | `record.teams.home` and `record.teams.away`: real team identities absent (record uses A/B) | LP E2 producer-side | Required for v1; A/B cannot be promoted to team identities. | OPEN |
| 7 | `scripts/nfl_sequence/game_state.py` | `record.roster_snapshot_id`: eligible roster snapshot absent | LP E2 producer-side | Required for v1; sampled participants are not a roster snapshot. | OPEN |
| 8 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[*].plays[*].state_before/state_after.home_score/away_score`: null | LP E2 producer-side | Required at both state boundaries for v1; Gridiron preserves nulls. | CLOSED in f12; consumer audit verifies both states |
| 9 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[*].plays[*].state_before/state_after.home_timeouts/away_timeouts`: null | LP E2 producer-side | Required at both state boundaries for v1; timeout rules remain unsupported. | CLOSED in f12; consumer audit verifies both states |
| 10 | `scripts/nfl_sequence/game_state.py` | `record.valid_full_game`: `false` | LP E2 producer-side | Correct guard for this artifact while rules are unsupported; do not flip it to satisfy the v1 gate. | OPEN |

The LP-side rows above are a pinned note for Claude. The drive-index rows are closed by current LP output but retained as a failing regression. Score and timeout state rows are closed by the consumer audit; eight shared-v1 rows remain open. The E2 payload is a retrospective first piece and cannot be represented as shared v1. Gridiron does not fill fields, relabel the mode, or set `valid_full_game`.

Gridiron's consumer audit is `auditGridironContractV1Record` in `web/lp-game-record-adapter.js`. It now checks top-level pregame metadata, rejects placeholder A/B team IDs, and checks both `state_before` and `state_after`. The viewer verifies that its wrapped record is structurally identical to the pinned LP record before rendering it.
