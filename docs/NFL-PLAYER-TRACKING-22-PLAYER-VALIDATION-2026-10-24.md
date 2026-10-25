# NFL player movement, tracking, and 22-player physics validation

Project: Gridiron Physics (trajectory generation and 3D execution), consuming Legendary Picks play context
Status: Engineering specification, 2026-10-24
Purpose: Establish whether simulated player and football motion corresponds to real tracked football, separately from whether a play's statistical outcome is correct.

## 1. Analogy to historical play-by-play validation

PBP provides the observed sequence of football states. Player tracking provides the observed sequence of physical states.

For each tracked play, start the Gridiron simulator with the real pre-snap and snap information only. Run it forward without the actual future trajectories, then compare the 22 simulated player tracks against NFL tracking observations at corresponding times. A 12-yard completion does not prove the receiver ran the correct route, the defense pursued correctly, or the line blocked realistically.

Keep three distinct claims:

1. **Historical tracked replay.** Show real recorded x/y tracks. This verifies rendering and coordinate alignment, not a predictive movement model.
2. **Forward player-movement generation.** From permitted snap-time inputs, predict or generate all 22 paths. This is the principal accuracy benchmark.
3. **Outcome-constrained visual reconstruction.** Given an LP sampled result, create a plausible picture of it. This is a separately labeled product mode. Because the eventual result is an input, it must not be scored or marketed as an unconditioned motion forecast.

## 2. Existing evidence and usable source data

| Asset | Confirmed scope | Notes |
| --- | --- | --- |
| Big Data Bowl 2025 public tracking (2022 NFL weeks 1 to 9) | 16,124 tracked plays across 136 games; all 16,124 PBP IDs joined to LP, 15,768 verified on game-state fields | A play join, not a claim that every trajectory or football outcome has been validated |
| LP verified PBP and tracking joins | E3 tracking coverage, `scripts/bdb/e3_tracking_join.py` | 222 NA-spot and 134 OT rows not fully verified; 62 SNAP versus `ball_snap` marker discrepancies |
| Gridiron canonical weeks 1 to 5 movement cohort | 9,289 eligible plays, 9,248 with all required 22-player pre-snap history frames (-10, -5, 0) | Do not silently remove the 41 with missing input history |
| Gridiron complete-tracks inventory | 9,283 of 9,289 with 22 full snap-to-terminal paths; six lack a terminal marker | 9,282 of 9,283 have full ball paths; one is missing two ball frames |
| Gridiron movement research | Team movement interface and ablation | Defines versioned, snap-only inputs and outputs; preserve this contract |
| Week 5 existing evaluated baseline | `week5-summary.json`, 1,859 evaluated plays | 1 s mean per-play error: constant acceleration about 1.071 m, league-role prior about 0.792 m, role plus team about 0.789 m. Development only; not a pristine holdout |
| Current 3D and physics code | `gridiron-physics/engine/`, `web/` renderer and research runner | Inventory the actual current player controller and visualizer before modifying it. Do not assume historical trajectories already drive live game playback |

**Available external sources for expansion:** Big Data Bowl 2024 tackling (2022 tracking, overlapping the 2025 source season); Big Data Bowl 2022 special teams (2018 to 2020 tracking); Big Data Bowl 2026 passing and ball-flight tracking (competition-defined 2023 to 2024 plays); Big Data Bowl 2027 Combine-to-game tracking (availability, exact source and terms, and local possession to be reverified). Do not sum overlapping BDB releases as independent seasons. Check competition licenses and downstream commercial, training and redistribution permissions before adoption.

**Relevant public dataset pages:** BDB 2025, BDB 2024, BDB 2022, BDB 2026 prediction. Treat any BDB 2027-specific fields or availability as unverified here until inventoried.

## 3. Tracking records and coordinate conventions

A tracking stream normally identifies `{gameId, playId, nflId, frameId, time}` with measured x, y location, speed `s`, acceleration `a`, movement heading `dir`, body orientation `o`, and event tags. Include a distinct football track where available. Data are 10 Hz, roughly one frame per 0.1 s. Observations may be missing or have inconsistent event tags.

- Preserve every player's source `nflId`, team, role, and original units. Link to LP PBP with audited game and play identifiers. Do not resolve ambiguous players by name.
- At snap, establish exactly 22 distinct player IDs on the field. Audit duplicate and missing tracks, offense and defense membership, football presence, and snap marker disagreement.
- Normalize into a versioned snap-ball-relative coordinate frame: longitudinal x positive in the offensive attack direction, lateral y, positions in meters. Preserve the original raw field coordinates and the transform, including field-end assignment and origin confidence.
- Use exactly the permitted observation budget in the current v1 spec: frames -10, -5 and 0 for both teams. No post-snap position, terminal event, observed outcome, credited tackler or retrospectively inferred ball carrier may be an input.
- Define the time origin (snap marker), terminal marker semantics, frame interpolation, and clock drift. A tracking terminal event is not automatically the official whistle and must not be used to infer game-clock stoppage.
- Distinguish tracked x/y from animation joints. BDB 10 Hz tracking does not reveal exact knee, shoulder, hand, cleat or ball-grip motion, or contact forces.

The Gridiron simulator operates at a finer engine timestep (previously reported at 120 Hz). For comparison, evaluate its states at the exact 10 Hz observation timestamps. Interpolate the simulator output deterministically. Never interpolate the withheld observed future into model inputs. Evaluate with correct real-player and role identities.

## 4. Model interfaces and provenance

### Required inputs, at snap

`game_id`, `play_id`, `simulation_id`, rules and coordinate version, 22 unique current player IDs and roles, available roster and physics estimates with confidence, three pre-snap observation frames, formation and LP-selected play concept where genuinely known at snap, down and distance, ball spot, score and clock as pre-snap context, and a fixed random seed.

A real historical source may describe the play post hoc. Do not present post-event `isDropback`, target receiver, ball carrier, credited defender, realized pass depth, sack or ultimate play result as a pre-snap-known feature. For a retrospective conditional model, explicitly label information supplied by the evaluator rather than by the snap-time agent.

### Required outputs

Immutable predicted paths for 22 players at each evaluation timestamp, with position, velocity and heading (and uncertainty where supported), model and source SHA, and independent observed targets kept outside the model. Group geometry outputs include offense and defense centroids, pairwise spacing and nearest defender. Ball path and physical-contact outcomes are separate components and may remain unsupported until explicitly modeled. They must not be silently filled.

Label every motion layer as one of: observed historical tracking, learned movement tendency, inferred or authored assignment, or generated physical motion. LP outcomes remain authoritative for an outcome-constrained replay, with no claim that physical motion caused them.

## 5. Main benchmark: full-play 22-player reconstruction

1. **Select the cohort before looking at future targets.** Start with canonical weeks 1 to 5 development plays. Preserve every selection and exclusion reason and the source hash. Use the existing 9,248 all-22 pre-snap-history plays for equal-input comparisons, and report the 41 missing-history plays separately. Do not select only easy tracked plays with favorable movement outcomes.
2. **Initialize at the observed snap.** Restore all 22 positions, velocity estimates, and permitted known roles and contexts. No positional reset after t=0, except in a separately labeled teacher-forced debug experiment.
3. **Run the simulator forward continuously.** Predict all 22 trajectories through fixed horizons and, where supported, the tracking terminal marker. Do not use observed future frames to steer agents, choose block targets, infer routes or force tackles.
4. **Score against withheld tracking.** Align identifiers and timestamps. Compare every player at +0.5 and +1.0 s, then publish errors over the remaining full-play path by time band and event phase. A full path uses a consistent stopping definition. Report terminal-time ambiguity separately.
5. **Compare equally informed baselines.** Constant velocity, constant acceleration, bounded acceleration, the current locomotion controller, league role prior, relational-context prior, team-continuity prior, and player deviations must use the same permissible pre-snap inputs within paired comparisons.
6. **Diagnose failure visually.** Render optional All-22 overlays (observed solid, simulated dashed) with identity, direction, speed and per-frame error. Include failure cases, not just successful clips. The overlay is a diagnostic artifact. Passing the drawing is not passing the movement benchmark.
7. **Do not retune against the reserved 2022 weeks 6 to 9 tracking.** They are a future model-level holdout, not an exploratory hyperparameter sweep. Freeze features, data splits, evaluation thresholds, source versions and model SHA before the first confirmatory holdout scoring.

## 6. Metrics that must be reported

| Dimension | Primary and diagnostic metrics | Why it matters |
| --- | --- | --- |
| Absolute player motion | Mean and median XY Euclidean position error (meters) at 0.5 and 1.0 s; trajectory error by frame and length of play | Whether simulated players occupy plausible actual positions |
| Velocity and movement | Velocity vector error, speed error, acceleration-change error, heading and turn-rate error | Whether movement is physically plausible, not teleporting or over-accelerating |
| Team geometry | Offense and defense centroid error, intra-unit separation and dispersion, offense to defense pairwise distances | Whether formations and group behavior make sense |
| Interaction geometry | Nearest-defender distance and nearest-player identity agreement, leverage, pursuit angles and approach timing | Whether coverage, gap fills and defensive pursuit reproduce football structure |
| Role and play-specific behavior | QB dropback depth, OL and DL lane and blocking geometry, receiver route shape, DB coverage separation, RB path and pursuit | Whether equal-looking average movement hides football failures |
| Ball trajectory (separate) | Ball XY track error, available event-time displacement and completeness | Whether a kick, pass or hand-off looks coherent. Do not claim detailed ball physics from XY alone |
| Runtime and constraints | Wall time and physics steps per play, large penetrations, impossible acceleration or turns, boundary crossings | Whether the model is usable in a game engine |
| Coverage | Games, plays, players, frames, and missing or ambiguous source observations by stratum | Whether the benchmark is actually representative |

Report results by game, week, team or side, position, play family, formation and temporal horizon, with denominators and a fixed source manifest. Confidence intervals must cluster by game, not treat millions of player frames as independent observations.

### Materiality and promotion gate

Existing Gridiron decision documentation specifies that a new movement policy beyond the strongest equally informed kinematic baseline should be promoted only after the frozen holdout confirms:

- (a) at least 0.05 m absolute AND 5% relative reduction in paired one-second position error;
- (b) a game-clustered 95% interval for the paired error difference entirely below zero;
- (c) acceptable spatial, feasibility and runtime guardrails.

These floors were chosen after development results and must not be described as originally preregistered. The prior locomotion-controller improvement over constant acceleration was measured in millimeters in a separate development study. It must not be conflated with the larger role-prior improvement over constant acceleration.

Reference: `docs/MOVEMENT-POLICY-MATERIALITY-DECISION-2026-10-24.md`.

## 7. Evaluation stages and acceptance

- **M0: Provenance and coverage parity.** Reproduce the LP tracking joins: 16,124 tracked and ID-matched, 15,768 verified contextual matches, and exclusions. Reproduce Gridiron's 9,289 eligible, 9,248 complete pre-snap history, 9,283 full player tracks, and 9,282 ball tracks on terminal-resolved plays. Explain any change in source snapshot or denominators before running new accuracy claims.
- **M1: Coordinates and timestamp parity.** Select deterministic, varied plays with formations moving in both field directions. Prove player identity, x/y transforms, snap frame, 10 Hz target alignment, and reference route drawing. Test known rotations, mirrored direction, missing players and missing frames.
- **M2: Full-play prediction from snap.** Evaluate the unchanged Gridiron controller and the strongest equal-information baselines at fixed +0.5 and +1.0 second horizons and full-play horizons where labels are valid. Keep a clean no-hindsight score and a separate, clearly labeled outcome-constrained visual reconstruction score.
- **M3: Football geometry and role-stratified failures.** Add explicit run-blocking, route, coverage, QB pocket motion, pursuit and contact-candidate geometry diagnostics. Diagnose where individual position error is low but defender spacing, block direction, route timing or team coherence is wrong.
- **M4: Reserved holdout and promotion.** Only after methods are frozen, use reserved weeks 6 to 9 as a one-time model-level confirmatory test with the predeclared statistical and practical gates. If tuning follows, obtain a new independent holdout. No promotion on millimeter improvements or cherry-picked visual examples.

A successful M2 report is evidence of tracked player movement accuracy. It is not evidence of tackle accuracy, correct yards, legal football state, a realistic full game, or correct animation-joint biomechanics. Validate those separately with PBP, collision-specific ground truth, and rig or animation references.

## 8. Deliverables and owners

1. A pinned, read-only tracking and PBP join and coverage manifest with missingness.
2. A normalized `22_player_snap_input_v1` and `22_player_trajectory_output_v1`, preserving the current versioned schema and provenance.
3. A deterministic simulator-versus-tracking evaluator with per-play, per-player and per-frame output, group geometry metrics, and game-level summaries.
4. A reproducible evaluation on the existing development cohort, with an explicit holdout reservation.
5. Comparison against constant-velocity, acceleration, role-prior and current locomotion baselines with identical information budgets.
6. A compact visual overlay with at least one passing example and one worst-error example per role and play family.
7. A failure taxonomy for identification and coordinate errors, assignment mistakes, player-motion dynamics, group-coherence errors, missing tracking, and unavailable physical-contact ground truth.

**Ownership:** Legendary Picks provides historical PBP joins, player and play context, and immutable selected outcomes. Gridiron owns trajectories, physical ratings, the physics controller and the overlay. Neither workstream can certify the other's accuracy from its own metric.

## 9. Reference links

- LP BDB and PBP join and counts: LP repository, E3 tracking join documentation
- Gridiron complete trajectory inventory: `docs/research/gridiron-e3-presnap-tracking-features-weeks1-5-2026-10-24.json`
- Gridiron team movement interface and ablation plan: `docs/OBSERVED-FOOTBALL-MOVEMENT-REVIEW-2026-10-24.md`
- Existing movement week-5 results: `week5-summary.json`
- Gridiron movement policy decision: `docs/MOVEMENT-POLICY-MATERIALITY-DECISION-2026-10-24.md`
