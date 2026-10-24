# Independent E2 football-state audit — 2026-10-24

## Current producer result

`web/lp-game-state-audit.js` independently checks LP record fields and never imports, calls, or trusts `rules_matrix`. The adapter hard-rejects a play state whenever either `state_before.drive_index` or `state_after.drive_index` differs from its enclosing drive index.

The latest committed LP producer checked here is `f12c1c6bf9faaf3f070726ead017f2c5854353f2`. Seed 1 was regenerated from a clean archive of that commit. Raw payload SHA-256: `0a3ed1cb216fa3f23784b427d2bf6e68ac877ab1995fb86cd5998d35d5b47821`; 24 drives, 143 plays, points A 14–B 10, and `valid_full_game: false`. Its audit-only record is [pinned here](../fixtures/e2/audit-current-seed1-f12-record.json), SHA-256 `622ce2881e64dacb31135fe36a2972da620b7ccd70a41ae41a17c80108ecb1e1`.

The independent football-state audit reports **zero findings** on the f12 record. This includes drive indexes, downs and distances, possession, field position, kickoff restart and runoff linkage, quarter and halftime boundaries, score monotonicity and reconciliation against the drive score ledger, timeout count range and transitions, and regulation termination. Q3's first snap is at 14:52 because the linked halftime kickoff records an 8-second runoff from 15:00; the audit verifies that relationship.

LP's earlier a785 record and the original 5fc viewer record remain in the baseline for comparison. The a785 audit had 1,144 missing-state findings: 572 score fields and 572 timeout fields. The original 5fc fixture has 1,175 findings: 23 drive-index mismatches, 576 missing score fields, and 576 missing timeout fields. The 5fc fixture is unchanged and remains a failing regression case; the adapter hard-rejects it.

The current f12 payload closes the score and timeout **v1 field-coverage** findings: the shared-contract consumer audit checks both values at both play boundaries and no longer reports either gap. This closes two of the former ten v1 gaps. Eight remain: mode, game ID, model version, rules version, pregame as-of/kickoff, real team IDs, roster snapshot, and `valid_full_game: true`. `valid_full_game` stays false. The record also continues to declare timeout rules unsupported; present counts passing range and transition checks do not establish timeout-call behavior or full legal-game status.

The full path-level output for current f12, prior a785, and pinned 5fc is in [the machine-readable baseline](GRIDIRON-E2-INDEPENDENT-STATE-AUDIT-BASELINE-2026-10-24.json). The viewer manifest remains pinned to 5fc; the audit-only f12 record is not in that manifest.

## Independent checks

The auditor checks:

- Down and distance validity and progression from yards gained.
- Distinct offense/defense sides, possession changes on punts and turnovers, and next-drive possession.
- Field position in the 0–100 offense-relative coordinate and spot change against yards gained. For the authored field assignment, stadium LOS is `yardline_100` when `dir=-1`, and `100-yardline_100` when `dir=+1`.
- Kick restart teams, receivers, drive boundaries, quarters, clock runoff, scoring linkage, and Q1/Q3 half-start linkage to the toss ledger.
- Quarter progression, quarter-start clocks after linked kickoff runoff, Q1/Q3 in-play clock resets, and Q2-to-Q3 halftime boundaries.
- Nondecreasing score snapshots and per-play snapshots against cumulative A/B drive scoring, allowing either A/home mapping when the final score identifies it.
- Timeout snapshot presence, the 0–3 range, nonincreasing counts within each half, and reset allowance at halftime.
- Final score against drive scoring and the terminal regulation state.

No missing value is substituted. A poison getter on `rules_matrix` verifies it is not read. The negative-fixture suite starts from the zero-finding f12 record and injects 18 separate defects covering before/after drive indexes, downs, possession, field position, score, kickoff restart, quarter and halftime boundaries, timeouts, and termination. All 18 produce the expected finding.

## Conversion-source semantics

The conversion source hook rejects EPA `success` as an extra-point or two-point result. The viewer-pinned 5fc source has `measure_kick_outcomes.py` SHA-256 `f16616f80adfb4108dd189557d968cdacad680c77eea0bdec1fe46198cb622d0`; the hook fails both conversion families because that code uses `success`.

At f12, the script hash is `04a06c9e80ab99676b8ec76144386ad127c928eb534aa8776895a33418600988`. Its source description names publisher `extra_point_result` and `two_point_conv_result` fields, and the hook passes both. The E3 manifest defines its generic `success` flag as EPA-positive, not a scoring flag. The old 5fc viewer source therefore remains a conversion-semantics regression failure.

## E3 observed comparison

The viewer reads the read-only E3 tables pinned to LP commit `4d538b6d161247f156454fd2a0a757dc47a99a5d`: 188,282 PBP rows, 23,579 drives, and 1,087 games from 2022–2025 regular-season weeks 1–18. The browser verifies each CSV SHA-256. The E3 panel currently compares the viewer-pinned 5fc sample (24 drives, 144 plays); f12 remains an audit-only source record.

- **Play:** E2 `dropback` maps to pass; `run`, `punt`, and `field-goal attempts` map to the matching observed categories. Generated denominator is 144. Observed comparison denominator is 146,905 retained pass/run/punt/field-goal rows; other PBP categories are excluded, not redistributed.
- **Drive:** generated play-record counts across 24 drives are compared with observed `offensive_play_rows_per_drive` across 23,579 drives, using bins 0–2, 3–4, 5–6, 7–9, and 10+.
- **Game:** all bins are shown for total points, absolute margin, and drive count against the 1,087-game observed distributions. One generated seed is marked as a descriptive sample, not fit or predictive skill.
- **Clock:** the visible panel states 594 of 7,016 plays (8.5%) were clamped at a sampled quarter boundary. This is E1 bookkeeping, not predictive clock behavior.
- **Unsupported rules:** source labels render as visible chips, including timeouts, two-minute warning, penalties, onside kicks, overtime, exception coin toss, and lineups.

The E3 panel remains visible when the pinned 5fc adapter rejects game navigation. Distribution similarity does not establish play-outcome, drive-result, or forecast improvement.

## Verification

- `node test/lp-game-state-audit.mjs`: f12 baseline reproduced with 0 state findings; prior a785 and pinned 5fc findings reproduced; 18/18 negative fixtures rejected.
- `node test/lp-game-record-adapter.mjs`: pinned 5fc hard-rejected; f12 record passes consumer structural checks; 23 old index rows are closed in f12 and retained in the 5fc regression; eight v1 rows remain open.
- `node test/e2-game-viewer.mjs`: E3 panel, failure counts, unsupported labels, clock caveat, and pinned-source conversion failure render.
- `node test/e2-game-viewer.browser.mjs`: two real Chromium page loads; pinned 5fc rejected; in-memory control navigated to Drive 24 / Play 144; zero browser runtime errors.
- `docs/GRIDIRON-CONTRACT-v1.md` remains byte-identical (SHA-256 `ae7b8a304dda480c3708b2543172f3fdc5064b156bf1b25816855acf31bc21b7`).
