# Context summary: Gridiron Physics, 2026-10-28

Purpose: a reference for the Gridiron Physics research work as of 2026-10-28. It records what was built, verified, decided,
and left open. It does not replace the detailed documents it links to. Where a figure is quoted, the source document or
output file is named.

## 1. Repositories and state

| checkout | path | ref | state |
|---|---|---|---|
| playbook and research checkout | `/root/gridiron-playbooks-research` | branch `research/nfl-team-season-playbooks-2026-10-27`, HEAD `d307d19` | pushed to origin; one untracked file, `data/playbooks/research-2026-10-27-rev2/shotgun_null_plays.csv`, left as found |
| physics engine checkout | `/root/gridiron-statistical-full-game` | branch `research/statistical-full-game-2026-10-25`, HEAD `ec73c46` | read only in this work; no changes |

Both checkouts are the same GitHub repository, `gridiron-physics`. Two agents have written to the playbook checkout: this
agent and hermes2. The worktree rule adopted on 2026-10-28 is in section 9.

## 2. Status at a glance

| workstream | status | authority |
|---|---|---|
| Team-season playbooks, 2022 to 2026 (rev1 to rev7) | built; the revised shotgun reconciliation is in progress | `docs/research/TEAM-SEASON-PLAYBOOKS-*`, rev3 BUILD-REPORT |
| 2025 canonical drives, v1 and v2 | v2 accepted for research use; v1 and v2 immutable | section 4 |
| Drive-benchmark readiness and export schema | written; reference ready; simulator benchmark not ready | section 4 |
| Gate 1: legacy 2025 reproduction (NE, CHI) | pass for the 2025 content | section 5 |
| Gate 3: shotgun source reconciliation, 2022 to 2024 | **open**; old gate reproduced; revised rule applied; 15 2022 team-seasons fail | section 5 |
| Part B movement research | baselines reported; **development only** (2023 reclassified); final movement acceptance unavailable | section 6 |
| 2026 holdout | **exposure-uncertain**, not certified untouched | section 7 |

## 3. Playbook research, 2022 to 2026

- **Builder.** `pipeline/build_playbooks.py`, research mode (`--research`). Output schema `gridiron.playbook.v1`. 160 team-season
  profiles: 32 teams for 2022 to 2025, and 2026 through Week 7 as an in-season cohort (labelled in season, frozen, not an
  unseen cohort).
- **Revisions.** rev1 is frozen. rev2 (`be6bce1`) carries a formation-mapping bug, superseded by rev3. rev3 fixes the mapping
  and removes fake punts from ordinary denominators. rev4 and rev5 add event classes and aborted definitions from source text.
  rev6 adds `event_history` to every play record and was verified as additions only across 294,634 records. rev7 splits kicking
  classes and was verified as label differences only.
- **Shotgun source.** The hierarchy is FTN first (`S` or `P` shotgun, `U` under centre), then participation (formation mapped),
  then the PBP flag only in FTN-charted games. Each play records its source.
- **Event classes.** `event_class` returns snap type, formation origin and execution type. Two-point attempts, aborted
  unknown-intent plays and kicking-formation events are kept out of ordinary designed-play denominators and retained for
  event accounting.
- **Event history.** Every regular-season row from 2022 to 2026 gets one event type: 207,020 rows, including 14,933
  administrative rows. The output is outside git; the summary is under `data/playbooks/research-2026-10-27-event-history/`.
- **Aborted audit.** 440 events. 375 are fumbled snaps. 10 are kicking-formation aborts, resolved to 2 direct-snap fumbles and
  8 aborted kicking operations, with 53 left as unknown handling.
- **Formation and FTN.** 162 plays have a blank participation formation. Denver 2025 formation: SHOTGUN 60.1%, under centre 35.4%,
  pistol 4.5%. FTN is delayed for DAL and PHI in 2026 Week 7 (a source lag, not a data error).
- **2026 cohort.** Weeks 1 to 7 only, frozen. Participation fields for 2026 are missing, not zero.
- **Decision model v1.** Research model for team decision distributions, frozen, prior hash `ed70a4af...`. Its single 2026 test
  was run before the holdout exposure record in section 7. Result: null headline (team 0.0605, league 0.0627, difference
  -0.0022, interval [-0.0056, +0.0012]). Counted as a use of the 2026 holdout.

## 4. 2025 canonical drives and the drive-benchmark reference

- **v1** (`pipeline/canonical_drives_2025.py`; `data/playbooks/research-2026-10-28-canonical-drives-2025/`). 5,722 drives in
  2025 regular season, 5,682 offensive. Immutable.
- **Reconciliation.** Final scores 272 of 272; points 544 of 544 team-games; touchdowns 32 of 32 (1,395). The 5,733 - 17 + 6 = 5,722
  reconciliation is in `docs/research/CANONICAL-DRIVES-2025-2026-10-28.md`. Attempt differences are fully explained by two-point
  conversions (`docs/research/ATTEMPT-DIFFERENCES-2025-2026-10-28.md`).
- **v2** (`pipeline/canonical_drives_2025_v2.py`; `data/playbooks/research-2026-10-28-canonical-drives-2025-v2/`). Explicit
  end classes, no quarter rule. Immutable. Points tie 544 of 544 (v1 gives 475 of 544, because v1 drops a conversion after a
  defensive touchdown and never credits a safety). Impact report: `docs/research/CANONICAL-DRIVES-2025-V2-2026-10-28.md`.
- **Two timings.** `possession_seconds` (first offensive play to end; provisional benchmark) and `kickoff_to_end_seconds`
  (kickoff to end). Means 170.6 and 173.3 seconds; medians 142 and 145.
- **Continuity.** 27,242 checked pairs; v2 counts match v1 exactly (58 field-position, 2 down, 1 clock). The audit
  (`pipeline/audit_drive_benchmark_2025.py`) explains 58 field-position and 2 down exceptions from the play text (the end spot
  of a fumble, and the net gain). **1 remains unresolved:** 2025_03_NYJ_TB, a clock inconsistency on play 4796 (1:41, between
  plays at 1:31 and 0:52). It does not change any drive's start or end.
- **Simulator clock convention.** Verified on 121 simulated drives in the e2 fixtures: start equals first play, end equals last
  play's post-play clock, kickoff restart equals `clock_before - runoff` (48 of 48; 2 expired).
- **Decisions (2026-10-28).** v2 accepted for research use; no v3 needed. `possession_seconds` adopted as provisional. Keep
  `kickoff_to_end_seconds` separately. Evaluation is descriptive; no thresholds set.
- **Readiness.** `docs/research/DRIVE-BENCHMARK-READINESS-2026-10-28.md`. Reference ready; simulator benchmark not ready (no
  complete export under the schema). The reference file count is seven hashed files, reconciled with the manifest.
- **Export schema.** `docs/research/DRIVE-BENCHMARK-EXPORT-SCHEMA-2026-10-28.md` and `drive_export_schema.json`. Drive fields,
  end classes and their subtypes, the simulator terminal map (proposed, to be confirmed), segmentation rules, buckets, and
  reference values.

## 5. Gates

**Gate 1, legacy reproduction (NE, CHI, 2025 content only).** `pipeline/reproduce_legacy_2025.py`. Both teams rebuilt from the
2025 inputs only and compared with the committed files after removing two 2026 keys. Identical. Compared SHA-256:
NE `908084b4...`, CHI `5209dd85...`. The 2026 pre-game blocks are not recomputed, by design. Report:
`docs/research/GATE-1-LEGACY-REPRODUCTION-2026-10-28.md`.

**Gate 3, shotgun source reconciliation, 2022 to 2024 (open).** Rule: `docs/research/GATE-3-SHOTGUN-RECONCILIATION-REVISED-2026-10-28.md`.
Results: `docs/research/GATE-3-RECONCILIATION-RESULTS-2026-10-28.md`. Script: `pipeline/reconcile_shotgun_sources.py`.

- Old gate (PBP vs participation, 1.0 point): reproduced. The same 16 team-seasons fail; paired and disagreement counts
  match rev3. Two displayed differences differ by 0.001 point from rev3's rounding.
- Of 272 disagreements in those 16, FTN sides with participation on 264, with the PBP flag on 6, and has no value on 2.
- **R1** (FTN and participation agree on at least 99.0%): passes for all 2023 and 2024 team-seasons. Fails for **15 of 32 in
  2022**, at 98.1% to 99.0%. The pattern is systematic (SINGLEBACK, SHOTGUN, I_FORM, EMPTY, WILDCAT). Not a rounding effect.
- **R2** (the profile reproduces from source fields): passes for 96 of 96 team-seasons, play by play (101,130 plays).
  The earlier totals-based R2 compared different denominators; the change is recorded in the rule document.
- **R3** (no silent fallback): 564 unresolved rows, all listed in `unresolved_plays.csv`.
- **Tampa Bay 2024** stays visible: 5 unresolved plays (3 PBP-fallback, 2 with no FTN value).
- **Open, not waived.** The 15 2022 team-seasons and the TB 2024 plays are not waived to move forward. Disputed labels keep
  their provenance and are excluded from any analysis that requires verified formation agreement.

## 6. Part B: movement research

**Scope.** Physical and autonomous football movement, separate from the event simulator. Development only in this record.

**Code audit** (`docs/research/PART-B-EXISTING-MOVEMENT-AND-DECISION-CODE-AUDIT-2026-10-28.md`, physics engine at `ec73c46`).

- Implemented: force-limited body locomotion (`engine/world.js` `locomote`), ball flight, contact and tackle.
- Heuristic and hand-set: route landmarks, block target choice, QB utility weights and thresholds, throw error, coverage
  pursuit delay.
- **Ground truth:** the QB reads live defender and rusher positions. Pursuit and defensive reactions use the live carrier.
  There is no perception boundary. The `visible` helper is defined and never called.
- **Placeholder:** pre-snap movement. Every player is at rest until the snap.
- The historical play director (`engine/play.js`) sets intent from real outcomes. Its runs are replays, not predictions.
- Existing evidence (2022 Weeks 1 to 5, inside-zone, 53 plays): the controller is worse than constant velocity at 0.5 s (0.815
  against 0.266 m) and at 1.0 s (2.189 against 0.992 m after a development patch). The 2026-10-24 decision cites about 3.7 mm
  over constant acceleration on a different harness; not reproduced here.

**Tracking inventory** (`data/playbooks/research-2026-10-28-partb-tracking-inventory/`, `pipeline/partb/inventory_tracking.py`).

- 2022 Weeks 1 to 5: 9,456 tracked plays; 9,439 with a ball-snap marker; all with 22 players at the snap frame; 9,289 LP
  eligible; 5,502 with route labels. Frame rate 10 Hz (verified). Weeks 6 to 9 not read.
- 2023 train Weeks 1 to 7: 5,580 plays; every play has one target, output and ball landing. Inputs carry 10 to 14 players per
  play, not 22. Four roles only: targeted receiver, other route runner, passer, defensive coverage. Frame rate 10 Hz (verified).

**Protocol.** `docs/research/PART-B-MOVEMENT-EVALUATION-PROTOCOL-2026-10-28.md`, frozen at `f58952a`. Calibration on 2022 Weeks 1
to 3 (one scalar for damped constant acceleration), development check on Weeks 4 to 5, validation on 2023. Amendments
(in the log): (1) 2023 reclassified to development; (2) the 2023 frame-alignment rule corrected (output frame IDs are
file-local).

**Hermes2 historical results** (commit `321396c`, its own protocol and estimators). Constant acceleration beat constant
velocity in aggregate: 2023 endpoint error 0.882 to 0.332 m at 0.5 s, and 2.393 to 1.394 m at 1.0 s. 2022 all-player cohort:
0.301 to 0.216 m and 1.138 to 0.939 m. The 2022 cornerback 0.5 s RMSE worsened. These figures are not verified by this agent.
They are benchmarks, not evidence that the physics controller improves.

**Reclassification.** 2023 Weeks 1 to 7 is development and exploratory. Hermes2 evaluated it before this agent's protocol
freeze, so it can't be an untouched validation set again. Results are kept, not discarded.

**Experiment script.** `pipeline/partb/movement_experiment_1.py` is **not run** and marked as such. Its alignment check contradicts
amendment 2.

**Tests.** `test/test_partb_inventory.py` has seven synthetic tests (permitted-data guards, per-play summary, 2023 parser,
eligibility join). They pass.

**2022 extraction.** `pipeline/partb/extract_2022_windows.py` writes Weeks 1 to 5 windows to scratch (eligible plays 1,913, 1,782,
1,925, 1,802 and 1,867 across the five weeks). Not committed.

## 7. 2026 holdout: exposure record

Status: **exposure-uncertain, not certified untouched.** No evidence so far shows that any 2026 value informed a decision.
The full itemised record is in `docs/research/PART-B-EVALUATION-DECISION-RECORD-2026-10-28.md`, section 8. In brief:

- **This agent.** A 2026 simulator game file (`web/data/game.json`, SEA at DEN, 2026-10-16) was read. The output showed scores
  (DEN 17), records, drive-result counts (25 drives) and a play's text. An earlier report said only the header was read; that
  was incomplete and is corrected. An earlier summary recorded a different final (SEA 17, DEN 14). **Resolved:** the user
  confirmed the final was SEA 14, DEN 17 in overtime, so the earlier summary was wrong.
- Name-only searches and some content-reading greps touched 2026 files (`data/raw/stats_player_week_2026.csv`, the 2026 pre-game
  fixture, mixed-season build files). Rows are recorded in section 8a.
- Gate 1 loaded the 2026 pre-game blocks of two committed files, removed them before hashing, and printed none.
- **Hermes2.** Reports a mixed-season build report opened before 2026 aggregates were recognised, and a broad search that
  surfaced overtime excerpts. Its exact list is outstanding.
- **Decision model v1's 2026 test** (section 3) is a documented use of the holdout.
- No further 2026 access is authorised for any research task.

## 8. Open items

1. Hermes2's exposure list (decision record section 8b).
2. Reconcile the summary conflict for the 2026 game (section 7); it needs a decision about who may check it.
3. Gate 3: the 15 2022 team-seasons under R1, the 138 PBP-fallback plays, and TB 2024's 5 plays. Decisions requested from the user.
4. Part B: hermes2's implementation planning (decision record section 6). Secondary to the event simulator.
5. The experiment script stays unrun.
6. Final movement acceptance and the 2026 holdout status: unavailable and pending, respectively.

## 9. Rules in force

- 2026 holdout: sealed for these tasks. No 2026 game, simulation output, tracking, or mixed-season research file is read.
- 2022 Weeks 6 to 9: reserved. Not opened or scored.
- Each agent commits only its own files, from its own worktree. Commit messages name the work, not the agent.
- No production changes, no model promotion, no simulator default changes, no full-game runs in Part B.
- No em or en dashes in replies, commits or documents.

## 10. Index of key files

- Decision record: `docs/research/PART-B-EVALUATION-DECISION-RECORD-2026-10-28.md`
- Protocol: `docs/research/PART-B-MOVEMENT-EVALUATION-PROTOCOL-2026-10-28.md`
- Code audit: `docs/research/PART-B-EXISTING-MOVEMENT-AND-DECISION-CODE-AUDIT-2026-10-28.md`
- Drive reference v2: `docs/research/CANONICAL-DRIVES-2025-V2-2026-10-28.md`
- Readiness and schema: `docs/research/DRIVE-BENCHMARK-READINESS-2026-10-28.md`, `docs/research/DRIVE-BENCHMARK-EXPORT-SCHEMA-2026-10-28.md`
- Gate 1: `docs/research/GATE-1-LEGACY-REPRODUCTION-2026-10-28.md`
- Gate 3: `docs/research/GATE-3-SHOTGUN-RECONCILIATION-REVISED-2026-10-28.md`, `docs/research/GATE-3-RECONCILIATION-RESULTS-2026-10-28.md`
- Hermes2 Part B reports: `docs/research/PART-B-HISTORICAL-RESULTS-2026-10-28.md`, `docs/research/PART-B-TRACKING-COVERAGE-2026-10-28.md`, `docs/research/PART-B-2023-VALIDATION-PROTOCOL-2026-10-28.md`
