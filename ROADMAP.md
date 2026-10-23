# Gridiron Physics — Roadmap

**Status:** Living engineering and research roadmap  
**Established:** 2026-10-22  
**Source of research learnings:** [Legendary Picks simulation learnings](https://github.com/micahp/legendarypicks/blob/dev/docs/SIMULATION-LEARNINGS.md)  
**Related repositories:** [Gridiron Physics](https://github.com/micahp/gridiron-physics) · [Legendary Picks](https://github.com/micahp/legendarypicks)

> **North star:** Simulate a football game in which real, pregame-eligible players with estimated abilities make football decisions and physically interact in three dimensions. Those interactions should produce the individual play results, which change downs, drives, field position, clock, scoring, and ultimately game outcomes. Then demonstrate which parts look like real football and whether they improve held-out predictions.

This document translates the cross-project research notebook into **concrete Gridiron Physics milestones**. It is a roadmap, not proof that the proposed architecture has been implemented. Keep research claims, existing behavior, hypotheses and accepted implementation separate.

## Ground rules

1. **Everything physically modeled should live in 3D.** Preserve the existing **Three.js 3D viewer**, camera modes, and assets. The existing ball flies in 3D, but the custom player's underlying collision/contact model is primarily horizontal circles and impulses with 3D character animation. That is **not** the final player-contact architecture. Use actual 3D rigid bodies, orientations, volumetric collision shapes, forces/torques and, where required, physically effective articulated joints. A visually 3D animation does not satisfy this.
2. **Outcomes must be caused, not secretly supplied.** In prospective physics mode, no historical end spot, actual tackler, forced catch, predetermined interception, or postgame information can determine the outcome. Preserve historical outcome-constrained reconstruction as a **separate, visibly labeled mode**.
3. **A solver isn't a football brain.** Rapier/Jolt can resolve 3D contacts and joints; football policies must still determine coverage, route running, passing, blocking, tackling intentions, body control and recovery. Validate the policies independently of the solver.
4. **Player ratings are estimates, not truth.** Make uncertainty/imputed data visible, trace attributes into controllers and physics, and test realistic perturbations rather than only extreme interventions.
5. **Simulate linked events.** A pass rush can change throw timing; that changes the ball/receiver/defender interaction; a catch can create YAC; a tackle determines the spot; the spot determines the next down; drives determine scoring opportunities.
6. **Measure separately:** physically valid motion, realistic play outcomes, realistic drives, realistic game-score and player-stat distributions, and **actual forecast skill**. Do not substitute one measure for another.
7. **Retain the statistical baseline.** Physical causality is a research hypothesis, not automatic predictive superiority. Compare it to the existing NFL statistical sequence model, a hybrid, and held-out real drives on aligned samples.
8. **No unearned promotion.** This roadmap does not authorize production forecasts, wagers, replacing functioning components without tests, or training against historical future information.

## Where we stand (as of 2026-10-22)

| Area | State | Evidence / boundary |
| --- | --- | --- |
| Historical film-room reconstruction | **Implemented, historically constrained** | 22-player, 120 Hz replay of the Seahawks–Broncos game on `main`; uses historical ball spots/credited outcomes; this is not forecasting |
| Player ratings and 3D viewer | **Implemented with known limitations** | Approximately 35 estimated ratings plus physical body attributes; Three.js renders players and 3D ball flight; contact solver remains predominantly planar |
| Patriots–Bears playbook and pregame roster work | **Pushed on feature branch** | [`feat/patriots-bears-playbook-2026-10-22`](https://github.com/micahp/gridiron-physics/tree/feat/patriots-bears-playbook-2026-10-22) and [playbooks documentation](https://github.com/micahp/gridiron-physics/blob/feat/free-run-pass-physics/docs/PLAYBOOKS.md); 2025 tendencies are charted **attribute combinations**, not licensed full play designs |
| Prospective free-run / free-pass experiments | **Research prototype, not calibrated** | [`feat/free-run-pass-physics`](https://github.com/micahp/gridiron-physics/tree/feat/free-run-pass-physics); runs gain/lose yards, passes can complete/drop/be broken up; fixed seeds reproduce examples |
| Free-play smoke distribution | **Measured, unvalidated** | [Outcome probe](https://github.com/micahp/gridiron-physics/blob/feat/free-run-pass-physics/docs/research/FREE-PHYSICS-OUTCOME-PROBE-2026-10-22.md): earlier 60-seed/team snapshot had 14/60 NE and 11/60 CHI catches; a **newer, separate 200-seed/team** smoke run reports **41.5% NE** and **44.0% CHI** catches, after targeted mechanics changes. Neither is a league-calibrated completion estimate or reliable prediction |
| Rare physical events | **Partial / unsupported** | Free-mode sacks/interceptions have code paths, but zero observed in the early 60-seed/team probe. Real prospective fumbles/recoveries and physics-resolved FG misses are not established. Do not substitute statistical outcomes and claim physical execution |
| Full game generator | **Separate statistical model, not yet physical game** | [NFL sequence v0.1](https://github.com/micahp/legendarypicks/blob/feat/gridiron-pbp-engine/docs/NFL-SEQUENCE-INTEGRATION-v0.1.md) owns legal states, choices and an outcome-sampling baseline. Physics integration and shared ownership of prospective outcomes require an explicit new interface |
| Drive evaluation | **Completed diagnostic, failures identified** | [2022–2023 held-out drive evaluation](https://github.com/micahp/legendarypicks/blob/feat/gridiron-pbp-engine/docs/DRIVE-EVAL-nfl-sequence-v0.1-2026-10-22.md), 543 games × 100 seeds, is a **statistical-only** result, not a physics-integrated result |
| Established 3D solver | **To evaluate** | Rapier 3D vs Jolt; no decision or migration has been validated yet |

**Important interface caveat:** The shared [`GRIDIRON-CONTRACT-v1.md`](https://github.com/micahp/gridiron-physics/blob/main/docs/GRIDIRON-CONTRACT-v1.md) currently describes **Legendary Picks as owner of sampled play outcomes**, with Gridiron rendering those outcomes. That remains valid for the *statistical-script playback* path. A physically causal experiment needs a **versioned v2/experimental execution contract** in which LP supplies **state, action and allowed inputs** while physics resolves the play **without LP's preselected result**, then LP's reducer applies the resulting events. Do **not** silently reinterpret or edit the byte-identical v1 contract in one repository.

## Priority order and milestone gates

### M0. Freeze the existing baseline and interfaces

**Goal:** Ensure we can measure improvement instead of losing a reference when the physics solver changes.

- [ ] Record SHA + test commands for `main`, Patriots–Bears playbook, and free-run/pass feature branches.
- [ ] Keep three distinct run modes and clear UI labels: `historical_reconstruction`, `statistical_script_playback` (outcome-constrained), and `prospective_physics` (outcomes unconstrained).
- [ ] Specify one versioned input for pre-snap state/action, ratings, formation, players, field direction, seed, rules and source provenance.
- [ ] Specify one versioned **physical play-result event** consumed by the game-state reducer: run gain/loss, completion/incompletion, sack, turnover, out of bounds, touchdown, elapsed time and player statistics.
- [ ] Preserve matchable play IDs and immutable result/frame logs so a rendered replay cannot secretly change an already-scored forecast.
- [ ] Resolve mismatch in reported simulated drive counts: game-level evaluation **22.08** vs drive evaluator **22.89** drives/game, including kickoff/administrative counting conventions.

**Gate:** Existing historical replay, prospective mock outputs and statistical sequence evaluation remain reproducible, distinguishable and independently runnable. No observed outcome can leak into the prospective result.

### M1. Evaluate a real 3D physics foundation **(next architecture decision)**

**Goal:** Stop depending on horizontal-only player contact in a project intended to simulate 3D physical interactions.

- [ ] Audit the current renderer vs world solver: which 3D visuals are physically driven, which are animated, and which player contacts only use horizontal circles.
- [ ] Prototype **Rapier 3D** and **Jolt** without rewriting the whole site. Evaluate a representative headless Node runner and browser/Three.js binding.
- [ ] Build one RB and one defender using actual **3D rigid bodies with orientation**, volumetric colliders and collision/constraint feedback.
- [ ] Test head-on, oblique, rear, side and low-speed contact; mass and speed changes; attempted wrap, missed wrap, drag, fall and escape. Don't pick the result through a random `tackleWon` gate.
- [ ] Test grounded player balance and fall/recovery controls; decide where articulated joints/active ragdolls are necessary. A capsule-only collision prototype is a starting experiment, **not** final tackle realism.
- [ ] Verify 3D ball collision interaction with bodies; maintain believable projectile dynamics.
- [ ] Test identical seed/initial condition repeatability, 22-player simulation stability, performance on Node/browser/mobile, and licenses.

**Gate:** A documented head-to-head comparison recommends a solver with reproducible **physical** 3D collisions and a practical migration boundary, with a working tackle prototype whose outcome isn't secretly anchored or selected. If neither candidate meets requirements, report the failure rather than committing blindly.

**Decision today:** **No solver adopted yet.** Three.js stays the renderer; replace or refactor the underlying player physics layer only after M1 evidence.

### M1 research result — 2026-10-22 (committed, not adopted)

**Status: comparative prototype completed; migration gate still open.** See [3D physics evaluation report](https://github.com/micahp/gridiron-physics/blob/e130f3a101adae59a276613a81c34956e22de1fb/research/physics-3d-evaluation/REPORT.md), [machine-readable results](https://github.com/micahp/gridiron-physics/blob/e130f3a101adae59a276613a81c34956e22de1fb/research/physics-3d-evaluation/results.json) and [commit `e130f3a`](https://github.com/micahp/gridiron-physics/commit/e130f3a101adae59a276613a81c34956e22de1fb). Branch: `research/3d-physics-engine-evaluation`, based on `feat/free-run-pass-physics` at `7385acb`. Main production physics files were not modified.

**Measured:** Both Rapier 3D and Jolt resolved genuine 3D dynamic body contacts and falls using five rigidly attached 3D colliders per player. Head-on, side, rear, fast, slow and oblique collisions were exercised. In a controlled escape-with-strength-motor scenario, **both carriers still fell**. A football-shaped rigid body made receiver contact under both engines, but neither a secure catch nor ball control/deflection outcome was modeled. The figures represent **contact feasibility**, not completed NFL actions.

**Runtime:** On one AMD EPYC / Node 22 host, 1,000 22-player episodes each simulating 0.25 seconds / 30 physics steps / 110 player colliders: **Rapier 7.62 ms per episode; Jolt 3.53 ms**. Jolt was about 2.16× faster in this *proxy only*. Costs of articulated players, balance controllers, grasp, ball handling, full plays, startup and mobile performance were **not** measured. Cross-platform determinism was **not** demonstrated; fixed initial-state replay worked within the harness. Its seed was metadata because the test had no random behavior policy.

**Architecture finding:** Preserve custom **football decisions and locomotion/balance controllers** but pass dynamic forces/torques into a mature solver for 3D contact. Do not preserve the existing planar contact integrator as the player collision authority. Keep Three.js. Rapier remains the **first integration candidate**, Jolt an active challenger. **No production solver change is justified yet.**

**Next M1b gate, before selecting or migrating the solver:**

- [ ] Build a physically resolved **wrap/grab and grip-release** scenario with an actual hold/constraint and measured failure, not just impact, tilt or a random success draw.
- [ ] Demonstrate a successful **broken tackle** with controlled differences in balance, momentum, contact geometry or grip force; a strength motor that still falls is not a broken tackle.
- [ ] Add **upright balance, grounded recovery and control** to avoid treating any rigid-body tip as completed football tackling.
- [ ] Demonstrate **ball-hand contact and secure possession**, and a physically driven incomplete/deflection alternative. Merely colliding with the receiver torso does not count as a catch.
- [ ] Rerun both engines under the **same** controllers, shapes and grasp/ball policies; compare football outcomes and runtime, not uncalibrated cross-engine impulses.
- [ ] Test 22-player full-play-length and repeated-drive scenes, memory and startup, browser/mobile, cross-machine replay, and multi-player piles.
- [ ] Keep a strict migration seam (`engine/physics3d/`) so historical reconstruction and existing tests continue working.

**Decision rule:** Promote a solver only when a grasp/balance/ball-control prototype passes physically meaningful football cases and remains reproducible and performant. If both pass, compare measured integration costs and validated results, not the 0.25-second speed proxy alone.

### M1 contact-energy follow-up — 2026-10-23 (diagnostic, not adoption)

**Source:** [3D engine evaluation revision `ba5661a`](https://github.com/micahp/gridiron-physics/commit/ba5661ac912d89e2d66ae1cb56fdd55d0bfa0eef), [report](https://github.com/micahp/gridiron-physics/blob/ba5661ac912d89e2d66ae1cb56fdd55d0bfa0eef/research/physics-3d-evaluation/REPORT.md), and [1,440-frame contact-energy ledger](https://github.com/micahp/gridiron-physics/blob/ba5661ac912d89e2d66ae1cb56fdd55d0bfa0eef/research/physics-3d-evaluation/results/contact-energy.json). Branch `research/3d-physics-engine-evaluation`; no production physics changes.

- **Question:** Does the Jolt 60°/6 m/s lower carrier peak tilt arise from coupled energy transfer into the defender or from numerical/accounting differences? Follow-up traced two angles/speeds, each engine and dynamic/kinematic defender modes (8 runs × 180 frames).
- **Observed:** Jolt 60° 4/6/8 m/s peak carrier tilts **86.4° / 58.0° / 67.7°** vs Rapier **84.4° / 90.0° / 92.7°**. The quaternion tilt metric was independently checked; a kinematic-defender control does not reproduce the 6 m/s dynamic reversal. The energy ledger heuristically labels the central Jolt case as dominated by defender-motion energy activity rather than the measured normal-impulse residual; corresponding Rapier case is residual-dominant.
- **Do not overinterpret:** Jolt normal impulses are inferred from point-velocity change; Rapier reports solver impulses. Normal-only impulse work is not total contact work; tangential friction, damping, positional correction and kinematic external work remain unmeasured. A large residual is **not proof of nonphysical energy** or a broken solver. Ground/body contact persisted every frame, so the strict contact-free gravity-only conservation bound had **zero qualifying frames** and remains untested.
- **Interpretation:** Paired-player and ground-contact dynamics can produce nonmonotonic tilt even when an isolated impulse response is monotone. The scene still has no active balance controller, grasp, grip break, articulated limbs, secure catch or football-level tackle outcome.
- **Next gate:** Construct a truly contact-free ballistic/gravity control that exercises the energy bound; when evaluating tackle realism, include full external-force/contact work or explicitly report what is missing. Prioritize physical grasp/balance/catch scenarios rather than inferring football quality from energy-ledger heuristics.

**Related work outside this repo:** [Legendary Picks NFL v0.2 clock intervention `b439fe8`](https://github.com/micahp/legendarypicks/blob/b439fe86e5e0fe6896bcbd87911d2e4e4803ba5e/docs/DRIVE-EVAL-nfl-sequence-v0.2-clock-2026-10-22.md) improved kneel timing and drive endings but still lacks realistic clock runoff. It changes the **statistical play-call model**, not the 3D physics layer, and is not a production predictive improvement.

### M2. Build and validate core physical football interactions

**Goal:** A tackle, blocked rusher and pass should be genuine 3D interactions that can fail or succeed for explainable reasons.

- [ ] Runner locomotion: controlled acceleration, turns, lateral cuts, balance and ball carriage in 3D; avoid animation that contradicts body geometry.
- [ ] Blocking: engagement, contact angle, leverage, resistance, block shedding, pursuit and pocket collapse.
- [ ] Tackling: attempt, arm/torso contact, grip or constraint, drag, assisted tackle, failed wrap, true after-contact movement and falls. Record what *physically* caused loss of possession or stop.
- [ ] Passing: QB posture/release, throw trajectory, receiver route position, defender positioning and physically meaningful contest/reach/catch or deflection.
- [ ] Instrument intermediate events: contact positions and normals, impulses, forces/torques, orientation, foot/ground contacts, receiver separation, ball position/height, QB time-to-throw, time-to-pressure, carry termination.
- [ ] Test paired scenarios with only one changed geometry/control input. Replays must show *why* the outcome changed.
- [ ] Compare feasible tracking/film examples without implying source footage provides the missing biomechanics.

**Gate:** At least one independently resolved run, tackle/broken tackle, completion/incompletion and defender contest per matchup direction, with annotated diagnostic replay, physically plausible geometry, stable simulation, and no hidden statistical target spot.

### M3. Player-rating and behavioral sensitivity audit

**Goal:** Make ratings change *behavior and physical capacity* rather than simply assigning a success label.

- [ ] Trace `SPD/ACC/AGI/STR`, `THA/THP/AWR`, `CTH/RTE`, `PBK/RBK`, `PMV/FMV/BSH`, `TAK/PUR`, `BTK/ELU/CAR`, `MCV/ZCV/CIT`, and kicker ratings from historical source → computed attribute → solver/controller → observable event.
- [ ] Track per-attribute uncertainty, production volume, imputed combine inputs and missingness.
- [ ] Run **paired-seed, one-at-a-time** changes of realistically sized ±5/±10 rating points. Report response direction, magnitude, uncertainty and unsupported effects.
- [ ] Separate movement-derived influences (e.g., speed affecting separation) from random skill checks (e.g., catch probability after reaching the ball).
- [ ] Audit failure modes: bad pass timing, receiver-ball misalignment, impossible contact, overly frequent broken tackles, unused ratings and unearned team skill advantages.
- [ ] Preserve real roster eligibility and stable IDs; no post-kickoff data in a pregame snapshot.

**Gate:** Core ratings have documented, interpretable sensitivity curves; important nonresponses or unrealistic effects remain explicitly open. No unverified ratings are presented as measured player capabilities.

### M3 research result — 2026-10-22 (ratings audit, no engine changes)

**Status: reproducible diagnostic completed; ratings are not validated or adopted.** The ratings agent pushed [commit `c9d4e6f`](https://github.com/micahp/gridiron-physics/commit/c9d4e6f51630f911a671d1b60f23513d8e5e7e30) on [`research/rating-audit-2026-10-22`](https://github.com/micahp/gridiron-physics/tree/research/rating-audit-2026-10-22), based on `feat/free-run-pass-physics` at `7385acb`. See [35-rating inventory](https://github.com/micahp/gridiron-physics/blob/c9d4e6f51630f911a671d1b60f23513d8e5e7e30/docs/RATING-AUDIT-2026-10-22.md), [paired-seed rating probes](https://github.com/micahp/gridiron-physics/blob/c9d4e6f51630f911a671d1b60f23513d8e5e7e30/docs/RATING-PROBE-2026-10-22.md), and JSON results. The engine itself was **not modified**.

- **Attribute wiring:** Of **35 player ratings**, **16 are referenced in engine logic and 19 are not**. This is an engine-read audit, not a claim that all 19 are unrelated to physical performance: e.g. sprint `vmax` is calculated directly from a measured/imputed 40-yard time, while visible `SPD` comes from that same underlying input. The `+10` WR1 pass null probe found **0/200** event/end-state changes for each of the 19 unread ratings, within that specific scenario.
- **Critical correctness defect:** Sack chance consults **the QB's `PBK`** against defender `PMV`, rather than the actual blocker or modeled rush/contact. All seven QBs in the snapshot have a `PBK=48` low-confidence placeholder. This needs an explicit mechanism/correctness fix, not new rating data alone.
- **Defensive interception placeholder:** `CIT` is 48 for **all 64 CB/S/LB/EDGE** players in the snapshot, yet the interception path reads defender `CIT`. This rating is derived for receivers, whose `CIT` isn't read by their catch path.
- **Weak or thresholded sensitivity:** Drake Maye's `THA=91` aim-error standard deviation is only about **2.3 cm**, against receiver horizontal reach of radius +1.6 m; +5/+10 THA changed **0/200** outcomes, −5/−10 only **1/200**. `max(BTK, ELU)` and `max(ELU, AGI)` create threshold effects: Henderson's smaller BTK changes are masked, while ELU +10 moved mean run gain **2.07 → 4.46 yards** in one controlled scenario. Odunze `CTH+10` moved catch rate **0.560 → 0.650**, consistent with the hand-authored formula, not independently validated.
- **Probe coverage failure:** **0 sacks, 0 pressures, 0 INT and 0 pass breakups across 6,000 pass-probe executions**. In these scenarios defenders did not reach the QB/ball, so pass-rush and interception sensitivities remain **unmeasured**. All baseline throws ended in catch or drop; this is not realistic pass-outcome coverage.
- **Seed diagnostic:** A `THP` change shifted release/ball timing and random draw consumption, causing 37–49% outcome flips and nonmonotonic catch totals. Paired play IDs do **not** guarantee aligned random substreams after a branch divergence; establish event-specific draw streams or fixed-trajectory controls before causal attribution.
- **Uncertainty:** Forty times were imputed for **50/84 NE (60%)** and **40/82 CHI (49%)** players; Maye's six combine drills were all imputed. Several formula-derived attributes inherit the low `0.15` placeholder-confidence label instead of evidence-appropriate confidence. All OL `PBK` confidence is zero. This limits physical-strength claims.
- **Coverage:** The agent probed **10 of the 16 engine-read attributes** on one route/run formation per case. This is a research audit, **not** a complete cross-position validation harness, historical Madden-data study, or NFL validation.

**M3 next gates (coordinate with M1/M2 3D solver work):**

- [ ] Classify every attribute as physical input, independent controller input, derived/display-only, intentionally reserved, or wiring defect; don't fabricate effects just to use all 35.
- [ ] Instrument real *opportunities* for QB pressure/sack, defender pass contest/INT, incompletion, and true tackle contacts; create scenarios that reach those mechanics and ensure failures remain possible.
- [ ] Correct the QB-PBK sack dependency behind dedicated regression tests, then transition to a physics-based blocker/rusher/QB contact and decision model.
- [ ] Replace placeholder defender `CIT` with a documented eligible, defensible estimator or keep it explicitly unvalidated; distinguish interception opportunity from hand-catch success.
- [ ] Give `THA` meaningful, measurable effects on release/targeting under actual 3D coverage and receiver separation, but **do not arbitrarily widen throws** to match league rates.
- [ ] Audit and decompose `ELU/AGI/BTK` masking and `THP` timing/RNG divergence; require controlled policies and stable event-specific streams in sensitivity tests.
- [ ] Repair confidence propagation for formula-derived attributes and publish individual ratings with uncertainty, especially imputed drills and OL estimates.
- [ ] Evaluate on multiple routes, pressure states, player pairs, and calibrated physical events; compare to real observed conditional outcomes with named denominators and held-out cuts.
- [ ] Keep historical Madden rating availability, licensing and training as a separate **feasibility study**. Better rating targets won't cure unwired behaviors or invalid interactions.

**Promotion rule:** Realistic changes in estimated ratings must produce intelligible changes in *causal intermediate events*, and those changes must be calibrated independently; a matched formula alone isn't validation.

### M4. **One complete physical drive per offense**, then full games

**Goal:** Establish the missing link between a believable play and a believable *possession*.

- [ ] Connect a **prospective action-selection** adapter: statistical generator chooses play/formation/participants given state, but **does not hand physics an answer**.
- [ ] Physically resolve every eligible run/pass. After each result, use LP's legal game-state reducer to update ball spot, first down, possession, clock, team and player counters.
- [ ] Generate **one full Patriots offensive drive against Bears defense**, then **one Bears drive against Patriots defense**, with different seeds and no manually forced outcome.
- [ ] Render the entire sequence in Three.js (play chooser, field position, down/distance, score, clock, replay and provenance).
- [ ] Compare full drives against real NFL examples: runs/passes, snaps/drive, first downs, net yards, time elapsed, conversion opportunities and ending categories.
- [ ] Give all unsupported branches (punt, field goal, penalty, safety, turnover recovery) explicit **statistical fallback / not-physically-modeled** labels. Keep fallback share in evaluations.
- [ ] Extend to full games **only after** drive-state reconciliation and possession continuity pass.

**Gate:** Two independently executed, reproducible drives complete with valid legal state, traceable player outcomes and no fabricated physics. Differences from statistically generated outcomes are recorded, not suppressed.

### M1b result — 2026-10-23: physical grip and balance research completed

**Source:** [M1b report](https://github.com/micahp/gridiron-physics/blob/research/m1b-physical-tackling-grip-balance/research/physics-3d-evaluation/m1b/REPORT.md), [versioned research branch](https://github.com/micahp/gridiron-physics/tree/research/m1b-physical-tackling-grip-balance), commit `75b07d2`. Changes remain off `main`.

**Observed:** Both Rapier and Jolt produce contact-dependent **retained-grip tackle**, **grip overload followed by fall, recovery and escape**, and **clean missed-contact attempt**, plus bounded-torque balance recovery/failure and asymmetric falls. The grip is a compliant torso-to-torso spring/damper applying forces/torques, **not** articulated hands, arms or solver-native grasp constraints. The broken-tackle demonstration includes the carrier falling and recovering; it is not yet an upright break. Variations in strength advantage, low grip height and stronger drive were inconclusive; only a weak grip capacity consistently created escapes in the current controlled sweep. No calibrated NFL tackle thresholds established.

**Energy control:** Isolated airborne gravity-only run (2,400 steps at 1/1200 s): max relative frame drift **Rapier 1.225%**, **Jolt 2.286%**, inside the experiment's 4% tolerance. This is a different timestep/harness than prior 120 Hz energy controls; it does not overturn them or prove exact conservation.

**Continuous 22-player proxy:** 100 seconds simulated per repeat, 3 repeats/engine, median wall time per simulated second **Rapier 54.92 ms**, **Jolt 33.79 ms**. Not a production speed verdict; body representation, iteration defaults and exposed diagnostics differ. Process memory deltas are too noisy to rank.

**Viewer:** [M1b Three.js replay UI](https://github.com/micahp/gridiron-physics/blob/research/m1b-physical-tackling-grip-balance/research/physics-3d-evaluation/m1b/index.html) can select Rapier/Jolt and four animations, scrub frames and overlay colliders, contacts, torque and grip. This is the foundation for a **per-version immutable visual regression archive**, but it is not yet a public hosted archive.

**Decision:** M1b **controlled feasibility accepted**, neither solver adopted into production. Move next to M4b adversarial gang-tackle / half-sack / tush-push / loose-ball pileups with archived fixed-camera recordings, and a matched secure ball–hand contact/possession test. When evaluating agent reports, distinguish a completed specific controlled case from unimplemented biomechanical mechanism.

### M4b. Adversarial many-body football physics and visual regression archive (new priority)

**Requirement, 2026-10-23:** Before replacing the low-level player solver or claiming realistic tackling, stress-test the highest-contact situations in true 3D and keep a reviewable **visual archive for each tested version**. This runs as **isolated physics research** on the current `research/3d-physics-engine-evaluation` workstream, not a production migration.

**Mandatory scenario fixtures:** (1) fumble with a truly loose 3D football and 2-v-2, 4-v-4 and crowded pileup/recovery attempts; (2) simultaneous 2-, 3-, and 4-defender tackles of a moving carrier with defenders approaching from multiple angles; (3) two-defender shared quarterback sack and a one-defender counterfactual; (4) tush push / short-yardage scrum with offensive and defensive lines and a quarterback/carrier being driven forward. Include near-miss, failed grip and recovered balance controls. Progress from simplified geometry to articulated contacts explicitly; never label mere torso contact a secure fumble recovery or a completed tackle.

**Physical questions:** contact stacking, penetration, stability, friction and traction, balance/recovery, grip and release, forces/torques through multiple bodies, ball escape/occlusion and secure possession, frame-safe outcome attribution (half sack requires two defenders meaningfully contributing, not a random label), and ball spot/forward progress derived from the simulated sequence. Distinguish raw physical events from official scorer attribution. The presence of 22 bodies on a field is not a multi-body pileup benchmark.

**Archive output:** Each versioned fixture has pinned seed, solver/version/WASM hash, code commit, player shape/controller/ratings/input snapshot, timestep, starting geometry, duration, contact/energy/constraint-event JSON, and **actual viewable browser replay/video** at fixed All-22, sideline and contact-close cameras. Three.js remains the viewer. A viewer index should choose fixture × solver × version and play/pause/scrub a deterministic recorded transform timeline with contact/constraint overlays. Preserve prior clips and representative golden frames; never overwrite a historical version in place. Keep manageable visual artifacts under a versioned research folder; use an explicitly linked versioned release/artifact store if video sizes are excessive. Programmatic tests should check event invariants and finite state; visual diffs are diagnostics, not an excuse to reject legitimate solver rendering changes.

**Acceptance:** Every fixture runs headlessly and in Chromium with fixed seeds, every replay can be reopened at a pinned version, and contact outcomes are demonstrated or explicitly labeled unsupported. Benchmark warm/cold, memory and time-to-simulate full-contact intervals on both Rapier and Jolt where feasible. Do **not** choose a solver on the earlier 0.25-second low-contact proxy alone.

**Latest research correction:** [Gridiron physics commit `edd4057`](https://github.com/micahp/gridiron-physics/commit/edd4057d97af61700fdec9bca3433f9065bf63d1) extends contact testing to 900 ticks and withdraws the prior Jolt “energy diverted into defender motion” attribution: the limited normal-impulse ledger **cannot identify** the mechanism. Contact-free tackle-scale gravity controls measured max per-step / cumulative energy drift **Rapier 0.090421 / 4.222032 J**, **Jolt 0.360987 / 16.963764 J**, exceeding the earlier 0.05 J-per-step hypothesis. These values apply to the controlled free-fall configurations, **not** full player-contact energy conservation.

### M4b result — 2026-10-23: multi-contact archive complete; football mechanism gates still open

**Evidence:** [M4b report](https://github.com/micahp/gridiron-physics/blob/f7a346fbba76601a1f6cd6e3ef9713a0f8d4ce8b/research/physics-3d-evaluation/m4b/REPORT.md) and [commit `f7a346f`](https://github.com/micahp/gridiron-physics/commit/f7a346fbba76601a1f6cd6e3ef9713a0f8d4ce8b) on `research/m4b-multiplayer-contact-archive`. **No production solver change or engine adoption.** The branch and `research/m1b-physical-tackling-grip-balance` have diverged, so isolate/adapt the valuable mechanisms before integration rather than merging the entire experimental branch history.

**Observed:** 16 controlled 7.5-second scenarios, two rigid proxy body profiles, Rapier/Jolt, 64 current replay files, 41-input sweeps / **164 stress runs** with zero nonfinite states. The versioned Three.js archive supports synchronized replay across solver/profile/commit and three fixed cameras, with 60 referenced screenshots and 10 VP9 videos. Runs and failures remain archived. Local viewer: `npm run serve` then `http://localhost:8080/research/physics-3d-evaluation/m4b/archive/`.

**Causal-contact boundaries:** Opposing two-defender tackle and compound two-rusher quarterback contact each physically occur within one 120-Hz step; the latter has **no completed sack**. Some three-defender and staged-sack fixtures have **no body contact**. A compound eight-player pile releases a dynamic football, but configured impulses/contact-triggered release are **not force-derived grip failure**, and secure possession/recovery is **unimplemented**. An eight-player tush push and 22-player line produce contacts, but snap reception, official spot and first-down outcome remain unresolved. No articulated player bodies or hands.

**Numerical concern:** Maximum reported player-proxy penetration is **0.300 m (Rapier capsule)**, **0.307 m (Jolt capsule)**, **0.250 m (compound)**. This is too large to ignore in crowded contact, even though simulation stays finite; record maximum **and duration/distribution** of penetration before/after solver/controller changes. Neither solver has been validated against NFL tackle, joint or pileup behavior.

**Next gated tasks:**
- [ ] Converge M1b balance/grip event vocabulary and M4b many-body archive on **one research adapter** without production changes; replay historical fixtures exactly for regression.
- [ ] Fix no-contact intended interaction cases, with explicit per-fixture physical opportunity assertions and passed/failed/inconclusive criteria.
- [ ] Diagnose deep penetration under line/pile loads; compare timestep, collider sizing, solver iterations, effective material, balance/drive force and spawn geometry using the same scenes on both engines. Do not simply clip positions to hide overlap.
- [ ] Create a **physically derived** ball release: contact force/constraint loading causes cradle or hand-proxy attachment failure. Demonstrate both retained and lost possession, then an *actual secure recovery* requiring sustained hand/ball control, versus deflection and failed recovery.
- [ ] Make a completed joint sack and credible short-yardage ball possession/forward progress possible before adopting football outcome labels; retain separately attributed physical contributors versus official grading.
- [ ] Preserve pinned screenshot/video/replay archive per code/solver version; control artifact sizes and validate archive integrity. No solver promotion until mechanism + numerics + independently calibrated outcomes pass.

**Decision:** M4b **research infrastructure completed**; **physical football mechanisms still partially missing**. Do not promote either solver or claim NFL predictive validity.

### Cross-sport movement research result — 2026-10-23: hockey v0.1 shared movement interface

**Evidence:** [Legendary Picks ten-game hockey multi-agent movement report](https://github.com/micahp/legendarypicks/blob/e43c09fe7d1f955794717099f53be3392ee8e6ea/docs/research/NHL-MULTI-AGENT-MOVEMENT-REPORT-2026-10-23.md) and [Gridiron hockey controller/replay research](https://github.com/micahp/gridiron-physics/tree/896e71e533259b39df6223183ed2b052b9ab7487/research/hockey-movement-v0.1); research commits LP `e43c09f`, Gridiron `896e71e`. Both off main/development and production solvers unchanged.

**Working infrastructure:** A separate sport-neutral `engine/movement/` API offers `initializeMovementScene`, `proposeMovement`, `stepMovement`, `recordMovementFrame` and `replayMovement`; hockey supplies rink geometry, independently learned policy and explicit ordinal 2D position constraints. A browser-validated Three.js four-panel viewer compares observed tracks with M0 independent, M1 interaction-aware and M2 interaction-plus-constraints policies. **206** archived scenes, **seven** reference clips, and exact reported archived-vs-browser policy path parity (**0.00000 ft**) demonstrate a reproducible research/UI seam without modifying the NFL solver or invoking Rapier/Jolt.

**Failed model promotion gate:** Ten previously examined *anonymized high-calibre hockey* games, **200** rollout starts, prediction at +1/+5/+15/+30/+45 **ordinal Image Id increments (not seconds)**. Autonomous +45 position error M0 **13.575 ft**, M1 **12.178 ft**, M2 **12.170 ft**; but M1 worsened the +1 position error **0.200→0.205 ft**, violating the frozen rule. At +45, M1 also worsened **pair-distance error 7.929→8.554 ft** and **team spacing 5.615→6.674 ft**. M2 reduced boundary violations **0.069→0** and below-floor pairs **0.395→0.109 per scored state**, but its +45 position improvement relative to M1 was not established. Thus these policies do not establish coherent joint movement or physical dynamics and are **not adopted**.

**Important scope:** There is **no documented subsecond timebase**, verified across-game athlete identities, reliable event/tracking alignment, physical contact labels, known puck possession or true 3D motion. The rink-side display is a camera rendering of 2D positions. Puck advancement is an explicitly nonphysical helper. There is no licensed NHL live-forecast upgrade or evidence that these ordinal controls map to football locomotion. Any shared code merge should be **an isolated infrastructure-only PR**, not a model or solver change.

**Next cross-sport movement gate:** Analyze relative pair distances, defense/teammate spacing and coordinated cut/closing trajectories over the full rollout, not just individual end-position or global occupancy; evaluate a shared-state joint policy with correlated movement intents and a preregistered short-horizon **plus** pair-spacing success criterion. Preserve M0, archived negative findings and per-version viewers; don't use the ten inspected games as a new untouched validation set. Time-calibrated physical claims await independent timestamped, identity-validated tracking.

### M4c result — 2026-10-23: force-derived control and shared takedowns work; penetration tails still fail

**Source:** [M4c report](https://github.com/micahp/gridiron-physics/blob/8ead484e08de6acdc934f33fe279347713dc289e/research/physics-3d-evaluation/m4b/M4C-REPORT.md), [preregistered gates](https://github.com/micahp/gridiron-physics/blob/8ead484e08de6acdc934f33fe279347713dc289e/research/physics-3d-evaluation/m4b/M4C-PREREG.md), branch `research/m4c-contact-possession-resolution`, final commit `8ead484e` (simulation source `82a484fe`). Production solver unchanged.

**Controlled mechanisms:** Shared M1b/M4b research interface preserves original three M1b tackle outcomes and 16 M4b cases. Both solvers demonstrated independent two-defender contact and completed takedown, completed shared and staggered sacks, grip release with a second grip retained, upright multi-grip escape, retained two-point ball control during contact, force-overload fumble, failed hand-proxy recovery, secure sustained two-point recovery, and center-to-QB reception during short-yardage scrums. Competing ball recovery remains unresolved; the throw-window ball departs QB before later fall but never completes a pass/catch. The three-defender upright fixture makes contact but does not reach a fall condition. Grips and catches remain *force-based rigid-body proxies*, **not articulated hands or empirically calibrated mechanics**.

**Matrix and numerical gates:** **104/104** mechanism-assertion runs (13 fixtures × 2 engines × 2 nominal seeds × 2 input configurations) passed, with **57** sensitivity runs finite. Seeds are fixture identifiers; no random draws exercised. At fixed 120 Hz across 52 runs/engine and 55,104 step samples, measured maximum penetration **Rapier 0.11874 m**, **Jolt 0.10294 m** (both under preregistered 0.15 m per-run max), but **20/104** runs exceeded the registered **0.05 m per-run p95** and **10/104** exceeded **0.025 m per-run duration-weighted mean** thresholds. Pooled statistics including zero-contact frames cannot replace per-run gates. M4b maxima of 0.300/0.307 m are different scenarios/geometry, not a controlled numerical improvement estimate. A Jolt 1/60-second sensitivity case reached **0.24261 m max / 0.15925 m p95**; robustness is timestep-sensitive. Cross-machine/release determinism is not established.

**Decision:** **M4c mechanism milestone accepted, numerical gate incomplete, no solver promotion.** Prefer **Rapier as first telemetry-rich isolated ratings-to-physics prototype**, retaining Jolt as active competitor. Jolt currently lacks comparable exposed native contact impulses in this JS wrapper; estimates are not identical measurements. No NFL outcome-rate validity or production readiness established.

**Next gated experiment:** Freeze a small football-mechanism suite at **1/120 s**, use matched athlete geometry and independently varied *measured physical parameters* to test acceleration, balance, grip strength, ball security, blocking and tackling. Contrast Gridiron's current estimated inputs with carefully mapped Madden 27 rating *proxies* in a separate immutable research snapshot; do not convert 0–99 ratings directly to SI forces without an explicit calibrated sensitivity mapping. Trace each change to contact/force/intermediate outcomes, preserve neutral controls, and report unused attributes. In parallel, isolate problematic p95/duration-weighted penetration fixtures, vary solver/timestep/geometry independently, and explicitly retain failure status. Do not activate the production solver or choose a winner before numerical and empirical gates pass.

### M5. Rare events and special teams

**Goal:** The engine can eventually produce both ordinary and exceptional outcomes for football reasons.

- [ ] Sacks: pass-protection breakdown, pursuit, QB evasion and contact **before** ball release.
- [ ] Interceptions: arrival geometry, catchability, defender hands/contests and return opportunity.
- [ ] Fumbles: physical ball-control/release condition, genuinely loose 3D football, recoverability, possession and return yards.
- [ ] Kicks: FG attempt policy belongs to the game-state layer; physics resolves foot/ball interaction, distance, crossbar/uprights, wind/drag as relevant, makes/misses and potential blocks/returns.
- [ ] Include punts, kickoffs, PAT/2-point decisions, penalties, timeouts and clock events through versioned rules/appropriately labeled temporary fallbacks. Separate rules policy from solver.
- [ ] Measure **opportunities until event**, not merely event totals. Name denominators: sacks/dropbacks, interceptions/pass attempts, fumbles/carries or plays with possession, FG misses/attempts at known distances.
- [ ] Compare event distributions and return outcomes to historical rates with uncertainty, including zero-event samples and conditional splits.

**Gate:** Supported events arise from real mechanics in matched examples; event frequencies and opportunity distributions are measured rather than invented to match a benchmark. Unsupported mechanics remain listed publicly.

### M6. Realism and forecasting evaluations

**Goal:** Determine whether the extra physical detail actually helps.

- [ ] Reuse the [drive evaluation's definitions](https://github.com/micahp/legendarypicks/blob/feat/gridiron-pbp-engine/docs/DRIVE-EVAL-nfl-sequence-v0.1-2026-10-22.md) and source manifests.
- [ ] Run a **paired** comparison on identical eligible pre-snap states and frozen pregame inputs: **A** statistical-only outcome sampler, **B** physical resolution, **C** predeclared hybrid/fallback.
- [ ] Measure physics quality, play outcome distribution, **drive endings**, points/drive, possessions, score variance/tails, player-stat joint coherence, and held-out probability quality (Brier/log loss, MAE/CRPS as applicable).
- [ ] Identify origins of errors rather than directly increasing scoring: clock/kneels, down-conditional pass yardage, 4th-down choices, red-zone behavior, kick placement, defensive-return scores.
- [ ] Compare against simple and stronger incumbent baselines, never only an unskilled constant.
- [ ] Report performance and compute budget for 1 play, 1 drive, 1 game and many seeded games; consider surrogate models for expensive micro-interactions.
- [ ] Preserve chronological train/tuning/holdout separation and prospective locks; no repeated holdout tuning.

**Gate:** Physics or hybrid earns adoption only with demonstrated value on the chosen metric and no unacceptable regression elsewhere. An impressive animation alone cannot pass the gate.

### M7. Playable research product and operations

**Goal:** Make the simulation inspectable and repeatable without confusing a prototype with a validated prediction.

- [ ] Keep **Three.js** for all camera modes and actual 3D player/ball rendering. Upgrade animation to follow physical rigid-body/joint states instead of only playing the result label.
- [ ] Add physics-debug mode: collider geometry, contact normals, constraints, forces, player centers of mass, trajectories, hit and throw timing, and provenance.
- [ ] In the browser: select matchup, lineup/ratings snapshot, play/drive, seed and run mode; rerun identical seed or vary one input.
- [ ] Show side-by-side statistical vs physics results with a **visible** baseline and confidence limitations.
- [ ] Check mobile performance and memory; keep rendering separate from high-volume headless simulation.
- [ ] Export versioned immutable scripts and physics frames that can be independently audited or replayed.

**Gate:** Another researcher can reproduce a specific play and drive, understand why the result occurred, and see the boundary between observation, generated decision, physical execution and statistical fallback.

## The current statistical baseline we are trying to improve

The following is a **Legacy/LP statistical sequence evaluation**, not a Gridiron Physics result. Test seasons 2022–2023, 543 games, 100 seeded simulated games per actual game. Trained on 2010–2021.

| Per-game / per-drive measure | Real | Statistical sim |
| --- | ---: | ---: |
| Team points per game | **21.83** | **18.59** |
| Team score standard deviation | **9.66** | **8.30** |
| Offensive TD-ended drives/game (both teams) | **4.54** | **3.73** |
| Punts/game (both teams) | **8.18** | **9.50** |
| Field-goal attempts/game (both teams) | **3.91** | **4.17** |
| FG make rate | **85.5%** | **84.9%** |
| Mean FG attempt distance | **39.2 yd** | **36.6 yd** |
| Third-down conversion | **40.4%** | **38.7%** |
| Fourth-down go share | **18.8%** | **14.4%** |
| Red-zone entry → TD | **54.9%** | **48.2%** |
| Drives ending in kneel/game | **0.97** | **0.07** |

The mean gap of **3.24 points per team** is “roughly one field goal,” **not** a proposed points adjustment. The average score and spread of outcomes both need work. Statistical model v0.1 has **no modeled team-strength outcome adjustment** and a winner Brier **0.2543** versus a **0.2466** constant home-win baseline. That is **not** an adopted forecasting edge.

## How we will work and record decisions

**Repositories have different jobs:**

- **Gridiron Physics** owns physical actors and contact, behavioral execution, replay visualization, physical ratings and micro-interaction tests.
- **Legendary Picks** owns the probabilistic baseline, historical data, game rules/reducer, locked forecasts and scoring evaluation.
- **Shared** owns schemas, identity, as-of snapshots, reproducibility and the explicit v1 playback vs future physically causal experiment distinction.

**Branch practice:** Development experiments run on separate branches/worktrees. Keep the baseline, source and evaluation outputs immutable. Do not merge unvalidated solver/behavior changes into the production forecasting path. The fact that this roadmap is on `main` does not mean any experimental implementation has been promoted.

**Experiment record (append per milestone):**

```md
### YYYY-MM-DD — [experiment / change]
- Status: proposed | in progress | tested | adopted | rejected | blocked
- Question and hypothesis:
- Branch, commit and input-as-of snapshot:
- Baseline, variant and controlled difference:
- Historical sample / restrictions / denominators:
- Seed setup, count and runtime:
- Physical / play / drive / game metrics + uncertainty:
- Representative replays or result files:
- Unexpected results and limitations:
- Decision and rationale:
- Next falsifiable test:
```

**Update rules:** Link the source experiment and commit, preserve negative findings, label assumptions, and annotate any superseded conclusions. Avoid overwriting old evaluation figures with newer experiments that use a different denominator or scenario. Review the [LP research notebook](https://github.com/micahp/legendarypicks/blob/dev/docs/SIMULATION-LEARNINGS.md) when changing cross-project architecture or evaluation claims.

## Decision log

| Date | Type | Decision |
| --- | --- | --- |
| 2026-10-22 | **Requirement** | All prospective player contact that claims physical causality must be computed in genuine 3D, not a 3D visual playback of 2D contact. |
| 2026-10-22 | **Keep** | Three.js is the existing renderer and continues to draw the field, models, ball, cameras and replays. |
| 2026-10-22 | **Evaluation, not adoption** | Compare Rapier 3D and Jolt to replace the custom low-level player physics solver; no winner yet. |
| 2026-10-22 | **Research result, not adoption** | Both Rapier and Jolt passed 3D contact/fall feasibility and receiver-ball contact; neither demonstrated wrap escape or secure catches. Rapier remains first candidate; Jolt's simpler proxy benchmark was faster. Require grip/balance/ball possession and full-play comparisons before solver promotion. |
| 2026-10-22 | **Keep separate** | Historical reconstruction, statistical-script playback and free prospective physics have different sources and claims. |
| 2026-10-22 | **Metric priority** | Evaluate realistic **drives** and scoring pathways, not just isolated plays or final averages. |
| 2026-10-22 | **No premature forecasting claims** | LP sequence v0.1 and prototype free-physics distributions are research baselines until validated. |
| 2026-10-22 | **Rating audit, not adoption** | 16/35 attribute reads; QB PBK sack mismatch, defender CIT placeholder, THA near-inert and 6,000 unpressured/uncontested pass probes. Fix opportunities, mapping and uncertainty before rating-model promotion. |

## Next actions

1. **Immediately:** Continue physically resolved wrap/grip break, balance recovery and secure hand-ball capture, **then prioritize M4b's many-body adversarial fixtures and pinned Three.js visual replay archive**. Do not merge a solver on contact-only evidence.
2. **In parallel:** LP team fixes/diagnoses the statistical sequence engine's drive failures (clock/kneels, down-specific pass gains, fourth-down policy, red-zone TDs, turnover returns) without modifying the physics benchmark to make up the scoring gap.
3. **Then:** Select a solver by evidence, integrate a minimal prospective play with real 3D contacts, run a complete **Patriots and Bears drive**, and compare those possessions to both real drives and the unchanged statistical baseline.
4. **Only after that:** Expand to rare events, full games, player-stat coherence and prospective forecast tests.

**The standard:** Our goal is not to make simulated football merely *look* convincing. The motion, decisions, contact and ball interactions should explain **why** a play happened, and repeated plays should produce believable drives and measurable improvements when compared to reality.
