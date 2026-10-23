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
| 2026-10-22 | **Keep separate** | Historical reconstruction, statistical-script playback and free prospective physics have different sources and claims. |
| 2026-10-22 | **Metric priority** | Evaluate realistic **drives** and scoring pathways, not just isolated plays or final averages. |
| 2026-10-22 | **No premature forecasting claims** | LP sequence v0.1 and prototype free-physics distributions are research baselines until validated. |

## Next actions

1. **Immediately:** Freeze current feature-branch baselines, compare Rapier/Jolt using one *physical 3D tackle* and a pass/contest, and establish a controlled rating/seed diagnostic.
2. **In parallel:** LP team fixes/diagnoses the statistical sequence engine's drive failures (clock/kneels, down-specific pass gains, fourth-down policy, red-zone TDs, turnover returns) without modifying the physics benchmark to make up the scoring gap.
3. **Then:** Select a solver by evidence, integrate a minimal prospective play with real 3D contacts, run a complete **Patriots and Bears drive**, and compare those possessions to both real drives and the unchanged statistical baseline.
4. **Only after that:** Expand to rare events, full games, player-stat coherence and prospective forecast tests.

**The standard:** Our goal is not to make simulated football merely *look* convincing. The motion, decisions, contact and ball interactions should explain **why** a play happened, and repeated plays should produce believable drives and measurable improvements when compared to reality.
