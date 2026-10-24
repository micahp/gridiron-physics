# Independent E2 football-state audit — 2026-10-24

## Current pinned evidence

The viewer now consumes the final LP record from producer commit `1ca7560924fe7da3eb452b142176bf09d7aeb1f0`, inside the exact LP envelope committed at `45381829488e43813a31793ee546df0b95dee856`.

- Raw LP payload SHA-256: `0a3ed1cb216fa3f23784b427d2bf6e68ac877ab1995fb86cd5998d35d5b47821`.
- LP envelope SHA-256: `b573713b10b2201c32a0827ab499a5b2b2a6d7de985ab05b7e4bfc51dce1f1a1`.
- Shared-v1 projection SHA-256: `c4a7c66418172b9101fbae2a6f1ac40d28c6461761db9c6a23116e7cd77a8b5c`.
- Game: 24 drives, **143 source plays**, score A 14–B 10, `valid_full_game: false`.

The Grid transport record equals the pinned LP record object, and the adapter accepts it with zero structural findings. The independent football-state audit reports **zero findings** across drive indexes, downs and distance, possession, field position, kick restarts, quarter/halftime transitions, score monotonicity and drive-ledger reconciliation, timeout range/transitions, and regulation termination. The 18 negative fixtures still fail with their expected finding.

The shared-v1 projection has 156 events because it adds 13 kickoff, try, period-end, and game-end events around the 143 source plays. The E3 generated play denominator remains 143. The earlier 144-play count belongs to the archived 5fc viewer fixture, which is retained as a regression and still fails with **1,175 findings**: 23 drive-index mismatches, 576 missing score fields, and 576 missing timeout fields. The a785 history remains at 1,144 missing-state findings (572 score and 572 timeout fields).

## Shared-v1 count reconciliation

The three earlier counts were produced by different checks over different shapes. The corrected document-specific audit now reports the same seven unsourced source fields as LP's `shared_v1.check_document`; the raw E2 record continues to have its separate eight-item Gridiron record-level audit.

| Audit surface | Count | What it counts |
|---|---:|---|
| LP `check_document` on the v1 projection | 7 | `mode`, `game_id`, `scheduled_kickoff_utc`, `as_of_utc`, `snapshot_hash`, `roster_snapshot_id`, and one grouped `duration_seconds` finding for 143 source plays |
| Earlier generic Gridiron record audit called on the v1 projection | 6 | It combined the two missing timestamps into one; counted A/B labels and `valid_full_game: false`; and omitted `snapshot_hash` and `duration_seconds` |
| Gridiron raw E2 record audit | 8 | `mode`, `game_id`, missing `model_version`, missing `rules_version`, combined as-of/kickoff, A/B team labels, roster snapshot, and the safe `valid_full_game: false` guard |
| Current `auditGridironV1SourceGaps` on the v1 projection | **7** | Independently checks the seven LP-reported unsourced fields individually, including snapshot hash and missing play durations |

The LP seven-item count is a source-availability tally. A/B labels and `valid_full_game: false` are additional Gridiron annotations, not two more LP unsourced fields; `false` is the correct guard while rules remain unsupported. `model_version` and `rules_version` are present in the projection, though absent from the raw E2 record, which explains why the record-level audit has two more metadata gaps. The seven v1 findings are enumerated in the machine-readable [audit baseline](GRIDIRON-E2-INDEPENDENT-STATE-AUDIT-BASELINE-2026-10-24.json).

The LP integration proof at envelope commit 453 still cites Gridiron adapter HEAD `854cea5`, so that adapter pin predates this recheck; the proof itself reports 143 plays. The 144-play figure belongs to the old Gridiron 5fc fixture, now retained only as a named regression. No LP code or shared contract was changed.

## Independent football-state checks

`web/lp-game-state-audit.js` reads record fields directly and never imports, calls, or trusts LP `rules_matrix`. The adapter hard-rejects a play if either `state_before.drive_index` or `state_after.drive_index` differs from the enclosing game-level drive index.

The checks cover:

- Down and distance ranges and progression from yards gained.
- Distinct offense/defense sides, possession changes on punts and turnovers, and next-drive possession.
- Offense-relative field position and spot changes; the authored LOS convention maps `yardline_100` directly for `dir=-1` and as `100-yardline_100` for `dir=+1`.
- Kick receiver and restart linkage, drive boundaries, quarter/clock runoff, score restarts, and Q1/Q3 half-starts against the toss ledger.
- Quarter progression, quarter-start clocks after kickoff runoff, in-play Q1/Q3 resets, and Q2-to-Q3 halftime boundaries.
- Nondecreasing score snapshots and per-play scores against cumulative A/B drive scoring.
- Timeout snapshot presence, 0–3 range, nonincreasing counts within each half, and halftime reset allowance.
- Final score and terminal regulation state.

No missing values are substituted. A poison getter confirms the independent auditor does not read `rules_matrix`. Historical a785 and 5fc results remain fully listed in the baseline JSON.

## Conversion source semantics

The final envelope's producer-file hash list does not include `measure_kick_outcomes.py`, so the Grid manifest separately pins that script at LP commit `1ca7560924fe7da3eb452b142176bf09d7aeb1f0`, SHA-256 `04a06c9e80ab99676b8ec76144386ad127c928eb534aa8776895a33418600988`. The matching raw LP source description names publisher `field_goal_result`, `extra_point_result`, and `two_point_conv_result`; the audit passes both try families. The archived 5fc source uses EPA-positive `success` and fails the extra-point and two-point checks. E3's generic `success` field remains explicitly labelled EPA-positive, not a scoring result.

## E3 observed comparison

The viewer reads the read-only E3 tables pinned to LP commit `4d538b6d161247f156454fd2a0a757dc47a99a5d`: 188,282 PBP rows, 23,579 drives, and 1,087 games from 2022–2025 regular-season weeks 1–18. The panel compares the final one-seed LP record (143 source plays, 24 drives) with the observed tables. Each generated/observed denominator and all game-distribution bins are rendered.

The panel visibly reports the **594 / 7,016** clock-clamp caveat and unsupported-rule labels. The clamp is E1 bookkeeping, not predictive clock behavior. Distribution similarity does not establish improved play outcomes, drive results, or forecasts.

## Dated delta — 2026-10-24, final LP repin

This delta supersedes the prior audit's viewer pin to LP 5fc and its audit-only f12 reference. The raw record bytes are unchanged from the f12 audit source, but the final record commit and envelope commit are now explicitly pinned and loaded by the viewer. The envelope no longer embeds `payload_sha256` or `payload_path`; the manifest pins the envelope and raw source separately, and the viewer verifies both hashes plus exact record equality. The old 5fc envelope and its failure baseline remain archived.

The count discrepancy is corrected with a shape-specific source-gap audit rather than treating the v1 projection as the raw E2 record. LP's seven source findings are reported individually; the eight raw-record gaps remain separately labelled. `valid_full_game` remains false.

## Verification

- `node test/lp-game-record-adapter.mjs`: final envelope accepted, exact LP record preserved, 24 drives / 143 plays / A 14–B 10; raw-record v1 gaps 8; projected-v1 source gaps 7; archived 5fc hard-rejected.
- `node test/lp-game-state-audit.mjs`: final LP state audit 0 findings; prior a785 and archived 5fc baselines reproduced; **18/18** negative fixtures rejected.
- `node test/e2-game-viewer.mjs`: current fixture loads and E3 labels, denominator, and clock caveat render.
- `node test/e2-game-viewer.browser.mjs`: real Chromium navigates the final payload to Drive 24 / Play 143 and hard-rejects archived 5fc; zero browser errors.
- `docs/GRIDIRON-CONTRACT-v1.md` remains byte-identical (SHA-256 `ae7b8a304dda480c3708b2543172f3fdc5064b156bf1b25816855acf31bc21b7`).
