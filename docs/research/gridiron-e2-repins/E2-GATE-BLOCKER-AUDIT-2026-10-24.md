# E2 gate blocker and shared-v1 audit

Date: 2026-10-24

LP evidence head: `a442dcd72559cfaf2d04737fc2454cea486faf09`

Gridiron baseline head: `2dc21c80e019127ca40fd6a9c1eb6f2db5f2a1b2`

Shared full-game v1 contract SHA-256: `ae7b8a304dda480c3708b2543172f3fdc5064b156bf1b25816855acf31bc21b7`

This inventory uses the seven ordered review blockers in LP's `docs/HANDOFF-E2-REVIEW-2026-10-24.md`, section 5. It does not alter the LP E2 evidence package. The corresponding Gridiron repin report is [E2-REPIN-A442DCD7-2026-10-24.md](E2-REPIN-A442DCD7-2026-10-24.md), copied byte-for-byte from the verification run.

## Seven review blockers

| # | Blocker | Fixing commit / disposition | Test evidence | Gridiron-side independent verification |
|---:|---|---|---|---|
| 1 | Extra-point and two-point rates must use publisher result fields, never EPA `success`. | Fixed by LP `444475092eb639fc43be77f8a5a78501a8f3b9cc`. LP `606991c9` is a later output-manifest/recount change, not the result-field fix. | `python3 -m unittest scripts.nfl_sequence.test_kick_results`: 4 passed. Includes contradictory `success` fixtures and committed totals. | Rebuilt from `/root/nflverse-raw` with the pinned builder: 9,704 rows; generated CSV SHA-256 `193f2d2390c36a968b42da1e851eba9c0b0c79bb2822fbcaff4aa3d6d0ce0a93`, byte-identical to LP's committed table. Totals: EP good/failed 4,643/178, blocked/missing 38/11; two-point success/failure 240/269. |
| 2 | Missed field goals must award the kick spot, or the receiving team's 20 when the kick is inside that 20. | Implemented in LP `028aaf7b2dd56f628dc33eba7cc18a0fd19f15eb`. | `python3 -m unittest scripts.nfl_sequence.test_game_state`: 53 passed, including the 20/21-yard boundary and matrix negative cases. | The implementation and boundary outputs reproduce. The cited Rule 11-4-2 text is not in the repository; this verifies code behavior, not authoritative rulebook provenance. |
| 3 | Every play state's `drive_index` must equal its enclosing game-level drive index; retain all 23 old defects as a failing regression. | Producer fix LP `a450b01a8e060ab07333c14ae93627838178c417`; counted regression and hard-reject evidence LP `2e23235b8c0edb4aaa002bf9bb02c8f322c9dfeb`. | LP `test_game_state.py` pins all 23 old mismatches and rejects before/after mismatches. | `node test/lp-game-record-adapter.mjs`: current 1ca payload has 0 football-state findings and 0 drive-index mismatches; archived 5fc payload remains hard-rejected for 23. Browser navigation also passed with 0 runtime errors. |
| 4 | Coin-toss winner and receive/defer choice must not be fixed to team A. | Fixed by LP `32541795998048a2970e240ca936a42698dfe5b6`. | `TossSymmetry` in the 53-test `test_game_state.py` run covers all four winner/choice combinations and a 40-seed coverage check. | Independent 300-seed, one-drive run reproduced all combinations: A/receive 83, A/defer 70, B/receive 72, B/defer 75; winner A/B 153/147 and receive/defer 155/145. |
| 5 | Clock, timeout, two-minute-warning and penalty behavior must be implemented or explicitly guarded; provisional rules cannot report PASS. | Guard/provisional handling LP `aaf4ca40327655d27298ca95f84953ad7fbe719d`; timeout guard and reset test LP `7f40f815f2e68483dd6edde226ce6b4fa8ad8d6a`. | `test_game_state.py` (53) includes `Guards`, `ProvisionalIsNeverPass`, and `TimeoutCharges`; the 14-test evidence suite also passed. | The guard, timeout-count bounds, and halftime reset are reproducible. The record still lists all seven unsupported rules and keeps `valid_full_game=false`; these checks do not establish that timeout, two-minute-warning, penalty, or other guarded rules are modeled. |
| 6 | Overtime ties and thin kick cells must be blocked, named, and counted as incomplete per seed. | Scope-out implementation LP `a78558554ec9f0643b4857c7c4bb46104852c1df`; frozen evidence package LP `a442dcd72559cfaf2d04737fc2454cea486faf09`. | `ScopedOut` in `test_game_state.py`; 14 negative/positive evidence tests; `survey_legality_300.py` across seeds 1–300. | Recomputed survey: 293 complete regulation, 7 blocked (5 overtime, 2 thin 50+ field-goal cell), 0 matrix FAIL rows, 300/300 checker-legal, and 300/300 rows match the frozen status/blocker/completion/matrix survey. The seven blocked seeds remain incomplete. |
| 7 | Shared full-game v1 conformance. | **No full-record fix by design.** LP `f88a8d437db12d7f3b453610ce871fa6da5a8240` adds a v1 projection for source-supplied fields; it does not make the retrospective E2 record a pregame full game. Standing decision: keep v1 unchanged, do not fill or relabel missing source facts, and keep `valid_full_game=false`. | LP `python3 -m unittest scripts.nfl_sequence.test_shared_v1`: 11 passed for projection and rejection behavior. | Gridiron audit still reports 8 raw-record v1 gaps; the current payload is correctly not signed off as `valid_full_game`. This blocker remains open for any producer claiming v1 full-game conformance. |

## Eight raw-record v1 harness gaps

The classification is about this retrospective E2 artifact. **Every row still blocks a claim that this raw record conforms to the shared full-game v1 contract.** E2 remains a retrospective first piece, not a pregame simulation; the standing decision is to preserve the immutable LP record and not synthesize missing facts in the Gridiron adapter.

| Harness gap | Classification | Standing decision / required next action |
|---|---|---|
| `mode` is not `pregame_full_game` | Deliberate E2 scope | The record is an authored retrospective game-state artifact. Do not relabel it. A future pregame v1 producer must emit the required mode. |
| Stable scheduled `game_id` absent | Deliberate E2 scope | There is no actual scheduled matchup behind A/B. Do not invent a schedule identity. A true v1 run must supply its canonical game key. |
| `model_version` absent | **Real raw-record contract violation** | This is producer metadata, not an observed game fact. LP must emit an explicit version before claiming the raw record is v1-conformant; Gridiron must not infer it from a commit or simulation ID. |
| `rules_version` absent | **Real raw-record contract violation** | LP must name the explicit ruleset/version for any v1 producer. The current partial/provisional rules do not justify assigning a complete NFL rules version. |
| Top-level `as_of_utc` and `scheduled_kickoff_utc` absent | Deliberate E2 scope | The source is retrospective and has no pregame cutoff. Do not backdate or infer an as-of snapshot. A pregame v1 producer must provide both valid timestamps. |
| Real home and away identities absent; record uses A/B | Deliberate E2 scope | A/B are authored sides, not real franchises. Do not map them to home/away. A true scheduled-game producer must supply actual identities. |
| Eligible `roster_snapshot_id` absent | Deliberate E2 scope | Sampled observed-play participants are not a current eligible roster. Do not present them as a roster snapshot. |
| `valid_full_game` is `false` | Deliberate and correct guard | Unsupported rules and unresolved rulebook claims prevent full-game sign-off. Do not flip it to true to satisfy the contract; resolve the scope and legal-state blockers first. |

The two real metadata violations above remain producer-side requirements for a v1 record. The other six are expected for this E2 scope, but remain failures under the full-game v1 gate. The Gridiron adapter preserves the source and reports those failures; it does not patch the payload.

## Verification pins and limits

- Gridiron E2 head: `2dc21c80e019127ca40fd6a9c1eb6f2db5f2a1b2`.
- LP E2 evidence head: `a442dcd72559cfaf2d04737fc2454cea486faf09`.
- Seed-1 payload SHA-256: `0a3ed1cb216fa3f23784b427d2bf6e68ac877ab1995fb86cd5998d35d5b47821`.
- Raw-record audit: 24 drives, 143 plays, 0 state findings, 8 v1 gaps; current score A 14–B 10.
- The Rule 11-4-2 source text is not in either repository. Tests reproduce the stated boundary convention, not its authoritative NFL rule citation.
- The old repin report's blocker-1 ledger labels `606991c9`; commit-history inspection shows the actual publisher-result rebuild is `44447509`. The report is preserved byte-for-byte; this correction is recorded here.
