# Gridiron E2 open finding register — 2026-10-24

## 2026-10-24 accepted-baseline delta

The active Gridiron adapter pin is now LP evidence commit `a442dcd72559cfaf2d04737fc2454cea486faf09`, accepted for the scoped completed-regulation research milestone. Its raw payload SHA-256 remains `0a3ed1cb216fa3f23784b427d2bf6e68ac877ab1995fb86cd5998d35d5b47821`; the a442 Gridiron envelope SHA-256 is `bbccd70a224035cb09d328194de66368e517524fe1d07df8aabbb7e037134788`. The shared-v1 and full legal-game gates remain OPEN / BLOCKED. A real scheduled game ID and kickoff, real team identities and rosters, as-of/snapshot hashes, producer model/rules versions, explicit durations for all 143 plays, and producer-supported `valid_full_game=true` remain unavailable.

The original `1ca75609` pin described below is the prior envelope history; its raw record is byte-identical to the a442 artifact. The old failing v1 projection is hash-pinned as a separate regression, and the 5fc payload remains a failing drive-index regression. Exhaustive Chromium rendering results and exact remaining pregame inputs are in [the a442 integration proof](GRIDIRON-E2-INTEGRATION-PROOF-A442DCD7-2026-10-24.md).

## Prior 1ca pin and finding baseline

Before the a442 evidence-only pin, the viewer used LP record commit `1ca7560924fe7da3eb452b142176bf09d7aeb1f0` with envelope commit `45381829488e43813a31793ee546df0b95dee856`. Raw record payload SHA-256 `0a3ed1cb216fa3f23784b427d2bf6e68ac877ab1995fb86cd5998d35d5b47821`; prior envelope SHA-256 `b573713b10b2201c32a0827ab499a5b2b2a6d7de985ab05b7e4bfc51dce1f1a1`. Seed 1 has 24 drives, 143 plays, A 14–B 10, and `valid_full_game=false`.

Final LP 1ca output has zero independent football-state findings: all 23 drive-index defects are closed, score snapshots reconcile to the A 14–B 10 drive ledger, and score/timeout boundary checks pass. The adapter retains a hard reject and the archived 5fc payload retains all 23 index mismatches as a regression fixture. The final source explicitly keeps `valid_full_game=false`. The consumer v1 audit now verifies the score and timeout fields, closing those two gaps; eight v1 gaps remain open and are triaged below. Timeout rules remain listed unsupported, so populated timeout snapshots do not establish timeout-call behavior. `GRIDIRON-CONTRACT-v1.md` is unchanged.

## Drive-index findings (23): closed in final LP 1ca; retained as archived regression

These are the 23 historical findings from the pinned 5fc payload: both state values are `1`, while the drive index is 2–24. LP commit `a450b01a` writes the enclosing game-level drive index into both states; the final 1ca record verifies all 23 are closed. Each old finding remains a hard-failing adapter regression.

| # | File | Field | Fault side | Current status |
|---:|---|---|---|---|
| 1 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[1].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `2` | LP E2 producer-side | CLOSED in 1ca; retained in 5fc regression |
| 2 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[2].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `3` | LP E2 producer-side | CLOSED in 1ca; retained in 5fc regression |
| 3 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[3].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `4` | LP E2 producer-side | CLOSED in 1ca; retained in 5fc regression |
| 4 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[4].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `5` | LP E2 producer-side | CLOSED in 1ca; retained in 5fc regression |
| 5 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[5].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `6` | LP E2 producer-side | CLOSED in 1ca; retained in 5fc regression |
| 6 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[6].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `7` | LP E2 producer-side | CLOSED in 1ca; retained in 5fc regression |
| 7 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[7].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `8` | LP E2 producer-side | CLOSED in 1ca; retained in 5fc regression |
| 8 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[8].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `9` | LP E2 producer-side | CLOSED in 1ca; retained in 5fc regression |
| 9 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[9].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `10` | LP E2 producer-side | CLOSED in 1ca; retained in 5fc regression |
| 10 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[10].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `11` | LP E2 producer-side | CLOSED in 1ca; retained in 5fc regression |
| 11 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[11].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `12` | LP E2 producer-side | CLOSED in 1ca; retained in 5fc regression |
| 12 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[12].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `13` | LP E2 producer-side | CLOSED in 1ca; retained in 5fc regression |
| 13 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[13].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `14` | LP E2 producer-side | CLOSED in 1ca; retained in 5fc regression |
| 14 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[14].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `15` | LP E2 producer-side | CLOSED in 1ca; retained in 5fc regression |
| 15 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[15].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `16` | LP E2 producer-side | CLOSED in 1ca; retained in 5fc regression |
| 16 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[16].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `17` | LP E2 producer-side | CLOSED in 1ca; retained in 5fc regression |
| 17 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[17].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `18` | LP E2 producer-side | CLOSED in 1ca; retained in 5fc regression |
| 18 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[18].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `19` | LP E2 producer-side | CLOSED in 1ca; retained in 5fc regression |
| 19 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[19].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `20` | LP E2 producer-side | CLOSED in 1ca; retained in 5fc regression |
| 20 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[20].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `21` | LP E2 producer-side | CLOSED in 1ca; retained in 5fc regression |
| 21 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[21].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `22` | LP E2 producer-side | CLOSED in 1ca; retained in 5fc regression |
| 22 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[22].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `23` | LP E2 producer-side | CLOSED in 1ca; retained in 5fc regression |
| 23 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[23].plays[*].state_before.drive_index` and `.state_after.drive_index`: `1`, expected `24` | LP E2 producer-side | CLOSED in 1ca; retained in 5fc regression |

## Shared-contract audit violations (10): two closed, eight remain open in the raw-record audit

| # | File | Field | Fault side | V1 triage for LP / Claude | Current status |
|---:|---|---|---|---|---|
| 1 | `scripts/nfl_sequence/game_state.py` | `record.mode`: `legal_game_state_first_piece`, not `pregame_full_game` | LP E2 producer-side | Expected for this retrospective E2 artifact; a v1 producer must emit the required mode. | OPEN |
| 2 | `scripts/nfl_sequence/game_state.py` | `record.game_id`: stable scheduled game ID absent | LP E2 producer-side | Required for v1; do not synthesize a scheduled matchup in Gridiron. | OPEN |
| 3 | `scripts/nfl_sequence/game_state.py` | `record.model_version`: absent as a top-level record field | LP E2 producer-side | Required explicit field for v1; do not infer it from `simulation_id`. | OPEN |
| 4 | `scripts/nfl_sequence/game_state.py` | `record.rules_version`: absent | LP E2 producer-side | Required explicit field for v1. | OPEN |
| 5 | `scripts/nfl_sequence/game_state.py` | top-level `record.as_of_utc` and `record.scheduled_kickoff_utc`: absent; source says as-of unknown | LP E2 producer-side | Required pregame cutoff for v1; current source is retrospective. Gridiron now checks the documented top-level fields. | OPEN |
| 6 | `scripts/nfl_sequence/game_state.py` | `record.teams.home` and `record.teams.away`: real team identities absent (record uses A/B) | LP E2 producer-side | Required for v1; A/B cannot be promoted to team identities. | OPEN |
| 7 | `scripts/nfl_sequence/game_state.py` | `record.roster_snapshot_id`: eligible roster snapshot absent | LP E2 producer-side | Required for v1; sampled participants are not a roster snapshot. | OPEN |
| 8 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[*].plays[*].state_before/state_after.home_score/away_score`: historically null in 5fc; populated in 1ca | LP E2 producer-side | Required at both state boundaries for v1; Gridiron preserves nulls. | CLOSED in 1ca; consumer audit verifies both states |
| 9 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[*].plays[*].state_before/state_after.home_timeouts/away_timeouts`: historically null in 5fc; populated in 1ca | LP E2 producer-side | Required at both state boundaries for v1; timeout rules remain unsupported. | CLOSED in 1ca; consumer audit verifies both states |
| 10 | `scripts/nfl_sequence/game_state.py` | `record.valid_full_game`: `false` | LP E2 producer-side | Correct guard for this artifact while rules are unsupported; do not flip it to satisfy the v1 gate. | OPEN |

The LP-side rows above are a pinned note for Claude. The drive-index rows are closed by current LP output but retained as a failing regression. Score and timeout state rows are closed by the consumer audit; eight shared-v1 rows remain open. The E2 payload is a retrospective first piece and cannot be represented as shared v1. Gridiron does not fill fields, relabel the mode, or set `valid_full_game`.

Gridiron's consumer audit is `auditGridironContractV1Record` in `web/lp-game-record-adapter.js`. It now checks top-level pregame metadata, rejects placeholder A/B team IDs, and checks both `state_before` and `state_after`. The viewer verifies that its wrapped record is structurally identical to the pinned LP record before rendering it.


## Shared-v1 projection source-gap count reconciliation

The LP shared-v1 projection has seven unsourced source-field findings: mode, game ID, scheduled kickoff, as-of time, snapshot hash, roster snapshot, and one grouped play-duration finding covering 143 source plays. `auditGridironV1SourceGaps` now independently reports those same seven fields against the 156-event v1 projection.

The earlier count of six came from applying the raw-record audit to the projection: it grouped the two timestamp findings, included A/B labels and `valid_full_game=false`, and omitted snapshot hash and duration. The separate raw E2 record audit remains eight: mode, game ID, model version, rules version, grouped as-of/kickoff, A/B labels, roster snapshot, and the safe false validity flag. Model and rules versions are populated in the v1 projection but absent on the engine record. The LP integration proof's `854cea5` adapter pin predates this recheck; the older 144-play fixture is archived, while the final raw record is 143 plays. See the dated count reconciliation in `GRIDIRON-E2-INDEPENDENT-STATE-AUDIT-2026-10-24.md`.
