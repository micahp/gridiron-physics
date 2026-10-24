# Gridiron E2 open finding register — 2026-10-24

Evidence pins: LP E2 producer `702f41db569de04a962b6f1336460d5273b66ce0`; Gridiron adapter `83e428b55436bfb2d4104264fd4a038d993cb95f`; seed-1 fixture SHA-256 `0a11cd89558a97cec5a8913cdc517d6efd8c23b15248954d54b77478d0f2d373`.

The adapter reports 23 per-drive state findings and 10 shared `GRIDIRON-CONTRACT-v1` audit violations. All 33 are producer-side LP E2 payload gaps or limitations; the Gridiron adapter detects and reports them without changing the payload. There are no adapter-side defects in this list. `GRIDIRON-CONTRACT-v1.md` is unchanged.

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

| # | File | Field | Fault side |
|---:|---|---|---|
| 1 | `scripts/nfl_sequence/game_state.py` | `record.mode`: `legal_game_state_first_piece`, not `pregame_full_game` | LP E2 producer-side; retrospective E2 mode |
| 2 | `scripts/nfl_sequence/game_state.py` | `record.game_id`: stable scheduled game ID absent | LP E2 producer-side |
| 3 | `scripts/nfl_sequence/game_state.py` | `record.model_version`: absent as a top-level record field | LP E2 producer-side |
| 4 | `scripts/nfl_sequence/game_state.py` | `record.rules_version`: absent | LP E2 producer-side |
| 5 | `scripts/nfl_sequence/game_state.py` | `record.provenance.as_of_utc`: pregame as-of provenance absent | LP E2 producer-side; source is retrospective |
| 6 | `scripts/nfl_sequence/game_state.py` | `record.teams.home` and `record.teams.away`: real team identities absent (record uses A/B) | LP E2 producer-side |
| 7 | `scripts/nfl_sequence/game_state.py` | `record.roster_snapshot_id`: eligible roster snapshot absent | LP E2 producer-side |
| 8 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[*].plays[*].state_before.home_score/away_score`: null; state-after scores are also null | LP E2 producer-side |
| 9 | `scripts/nfl_sequence/e1_drive.py` | `record.drives[*].plays[*].state_before.home_timeouts/away_timeouts`: null; state-after timeouts are also null | LP E2 producer-side; timeouts unsupported |
| 10 | `scripts/nfl_sequence/game_state.py` | `record.valid_full_game`: `false` | LP E2 producer-side; intentional while rules remain unsupported |

Gridiron's detector is `web/lp-game-record-adapter.js` (`validateRecord` and `sharedV1Audit`). It preserves and displays these source values; it does not create the missing values or cause the findings.
