# Part B readiness review (2026-10-27)

Status: not ready. Part B (movement evaluation) stays blocked. This review does not reopen the Part A items that are resolved, and it does not change any Part A result. It checks each gate in `NFL-PLAYBOOK-AI-MOVEMENT-PLAN-2026-10-27.md` (section 6 build gates, section 8A protocol, section 8B revised direction) against the current state.

Scope: the playbook build (rev3), the decision model (v1), and the data on disk. The movement code in the physics repository was not checked in this review.

## 1. Playbook build gates (plan section 6)

| Gate | Status | Evidence |
|---|---|---|
| 1. NE-2025 and CHI-2025 reproduce committed files | Not re-run for rev3 | The rev3 changes are research-only. The legacy 2025 path calls `observed_candidates` with its default arguments, and its shotgun value still uses the PBP flag. Re-run before Part B. |
| 2. Other 2025 teams: counts reconcile, eligible equals emitted | Met for rev3 | rev3 verification: observed plays identical to rev2 for all 160 profiles and both sides; ordinary denominators drop by exactly the recorded fake punts. |
| 3. 2022 to 2024: PBP shotgun share matches participation within 1 point | Not met | 16 team-seasons exceed 1 point (1.003 to 1.658). The gap is the PBP flag: FTN agrees with participation on 184 of 190 regulation-down disagreements, and 82 two-point rows have no regulation down. TB 2024 is unexplained. rev3 does not change this gate, which compares PBP with participation. |
| 4. 2026 through Week 7: participation fields missing, not zero; 107 games | Met | 2026 participation fields are null. The build covers 107 games. FTN covers 106; the missing game is DAL and PHI, a source publication lag (see the addendum). |
| 5. Build report: counts, missing shares, non-reconciling team-seasons | Met for rev3 | rev3 BUILD-REPORT and manifest. The 16 non-reconciling team-seasons are listed in gate 3. |

## 2. Protocol (plan section 8A)

| Step | Status | Evidence |
|---|---|---|
| 1. Playbook priors fitted on 2025 | Partly met | The decision-model prior (v1) is fitted on 2025 and frozen (hash in the v1 validation note). The movement priors are not yet defined as a separate fit. |
| 2. Movement calibration on 2022 tracking (`bdb2025`, Weeks 1 to 9) | Data present; not checked | The folder is on disk. The calibration code was not checked in this review. |
| 3. Movement validation on 2023 tracking (`bdb2026-prediction` train, Weeks 1 to 7) | Data present; not checked | The folder is on disk. The validation code was not checked in this review. |
| 4. Tuning only on steps 1 to 3 | Rule, not testable yet | No tuning has been done. |
| 5. One 2026 holdout test on outcomes, target and metric written before the run | Not met | No target or metric is written for this test. The 2026 Weeks 1 to 7 holdout was already used once, by the decision-model v1 test (13,131 plays). A second use needs an explicit decision. |
| 6. 2025 or 2026 tracking for a movement check on the holdout season | Not met | No 2025 or 2026 tracking is on disk. Acquiring it is a separate decision. |

## 3. Revised direction (plan section 8B)

| Item | Status | Evidence |
|---|---|---|
| 1. Movement matching needs frame-level 2025 and 2026 tracking | Blocked | Not on disk. |
| 2. Decision matching can run now | Possible, pending a decision | Categories are available for 2025 (participation and charting) and 2026 (PBP and charting, Weeks 1 to 7; no 2026 participation). The v1 decision model covers categories A to N. Running it again on 2026 is a second use of the holdout. |
| 3. Training: priors fitted on 2025 | As step 1 above | |
| 4. Metric: total-variation distance per category with a game-level bootstrap | Implemented | `decision_model.py` (v1). |
| 5. One holdout test on 2026 Weeks 1 to 7, set and metric fixed before the run | Not met | As step 5 above. |
| 6. Movement check later, once tracking is named | Blocked | As item 1. |

## 4. Resolved items (not reopened)

- Shotgun source: FTN check on the 190 regulation-down disagreements (addendum, section "Third-source check"). The PBP flag is the outlier on these plays. The gate itself is still failed (gate 3).
- 2025 shotgun gate: only ARI is over tolerance, at 1.025 points.
- 48-play gap: two-point attempts with a blank regulation down (41 pass, 7 run).
- NGS: withdrawn from the decision model.
- Formation mapping bug in rev2: 2022 labels SINGLEBACK, I_FORM and JUMBO returned null. Fixed in rev3. The committed rev2 build (`be6bce1`) carries the bug and is superseded by rev3.
- Fake punts: 83 snaps, classified and kept out of ordinary play-selection denominators (rev3). Document: `FAKE-PUNT-FREQUENCY-2026-10-27.md`.
- DAL and PHI, 2026 Week 7: FTN has no rows for the game. Classified as source publication lag. The frozen FTN file is unchanged; a refresh check found no update.

## 5. Open items that block Part B

1. Gate 3: decide whether the 16 team-seasons are an accepted, documented exception or a rule change. TB 2024 stays unexplained.
2. Holdout: decide whether Part B's test reuses the 2026 Weeks 1 to 7 holdout (a second use) or is a new test. Either way, write the target and the metric before any run.
3. Tracking: decide whether to acquire 2025 or 2026 frame-level tracking. Without it, movement matching cannot run.
4. Re-run the NE-2025 and CHI-2025 legacy reproduction (gate 1) on the current code.
5. Check the movement code and calibration status in the physics repository.

## Verdict

Part B is not ready. Decision matching can run after items 1 and 2 are decided. Movement matching cannot run until tracking is acquired (item 3).
