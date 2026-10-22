# Gridiron Physics as a predictive research environment

> **Updated research priority:** Read [Predictive research direction](PREDICTIVE-RESEARCH-DIRECTION-2026-10-22.md) and the [ten-game hockey agent task](HOCKEY-TEN-GAME-AGENT-TASK-2026-10-22.md) first. They supersede this document's recommendation to start with an NFL Big Data Bowl experiment. Start with the existing anonymized hockey tracking, reconcile LP's NFL data inventory, and audit NBA acquisition. The ten hockey games have already been analyzed and are development data, not a fresh independent holdout.


Date: 2026-10-22
Status: proposal only; no engine implementation, model adoption, or production change.

## Decision

Retain the custom solver for reconstruction and the first bounded predictive experiment. Do not rewrite the engine now. If a later experiment requires reliable multi-body contact, use Rapier as the first established-engine candidate and compare it behind a small physics interface. A better collision solver does not provide football decisions, observed player ability, or calibrated outcome probabilities.

This is the NFL companion to [Legendary Picks: Simulation Architecture and Research Lessons](https://github.com/micahp/legendarypicks/blob/research/simulation-architecture-learnings-2026-10-22/docs/research/SIMULATION-ARCHITECTURE-LEARNINGS-2026-10-22.md), read on this date (Git blob SHA: ff3bd4cd91e2bb0bb9587f5ea2d66c83e9f1e962). It applies that note's three layers:

| Layer | Responsibility |
| --- | --- |
| Predictive state | As-of player/team ability, usage and availability distributions; immutable forecasts and sequential updates. |
| Generative game | Personnel, play calls, actions, shared events, rules and coherent player/team statistics. |
| Physical and behavioral research | Test whether explicit motion or contact mechanisms improve independently observed conditional outcomes; optionally export a cheap model. |

The NHL lesson transfers as a research principle, not an NFL result: added event detail or variance is not evidence of better forecasts. Neither event simulation nor physics is inherently superior to a statistical baseline.

## Repository evidence

Inspected main at `0c0990f041b60afb9b03456d287fd5c3dc5e2c34` and `feat/what-if-slant-prototype` at `dda18e66a5fcee5f631d800fab83d409feddcacb`. The feature branch is seven commits ahead and two behind main. No AGENTS.md appears in main's complete tree.

| File | Actual behavior and implication |
| --- | --- |
| [engine/world.js](../../engine/world.js) | Planar massive discs, force/traction-limited locomotion, pairwise overlap correction and normal impulses; custom block springs and wraps. This is not a fully articulated human-body simulation. |
| [engine/constants.js](../../engine/constants.js) | Fixed 120 Hz integration, 30 Hz recording and Denver-specific air density. Integration frequency is independent of the choice of engine and is not a measure of empirical fidelity. |
| [engine/ball.js](../../engine/ball.js) | Point-mass gravity/drag. `solveLaunch()` solves toward a supplied endpoint and flight time. Useful mathematics, but the endpoint's provenance decides whether it is aiming or reconstructing a known result. |
| [engine/play.js](../../engine/play.js) | Reads actual kind, air yards, gain, target, sackers and tacklers. Routes are timed toward the catch; tackles are allowed near the required end spot; `updateTackle()` explicitly moves the pile onto that spot. |
| [pipeline/build_game.py](../../pipeline/build_game.py) | Builds scripts from observed PBP outcomes and forces credited participants into inferred lineups. These outputs cannot initialize an independent pregame forecast. |
| [pipeline/ratings.py](../../pipeline/ratings.py) | Hardcodes DEN/SEA, season 2026 and week 6. Uses 2025 production plus 2026 weeks before week 6, with current-season weight 1.5. It has shrinkage and confidence, but no general point-in-time source ledger. Current roster/status, age and league calibration also need historical snapshots. |
| [test/validate.mjs](../../test/validate.mjs) | Checks constrained final spots, speed overshoot and simulation timeouts. It does not score unseen outcomes or test cross-browser bit equality. |
| [Slant generator at inspected commit](https://github.com/micahp/gridiron-physics/blob/dda18e66a5fcee5f631d800fab83d409feddcacb/engine/what-if.js) | Hand-written completion/sack/interception tables, sampled air yards/YAC, and a lineup copied from an existing game. It is labeled illustrative. Outcome sampling happens before physics. |

Reproduced the existing main test in an isolated source snapshot: `npm test` passed, 176 plays, 35,478 recorded frames, 122/124 spot matches, zero players over 108% of their own maximum speed; approximately 2.314 seconds in this environment. This is one reconstruction run including recording overhead, not a rigorous performance benchmark or predictive validation. No tracking dataset was downloaded or new model evaluated.

The docs' broad momentum and determinism descriptions need narrower interpretation in research: collision normal impulses conserve pair momentum, but wrap retention and director position corrections are additional rules. Seeded RNG does not guarantee identical floating-point results across every runtime.

## 1. Custom solver versus established engine

| Criterion | Current custom solver | Rapier candidate | Decision |
| --- | --- | --- | --- |
| Realism | Transparent sprint/cut constraints; planar discs and simplified ball flight. Many constants remain assumptions. | Supports 2D/3D bodies, colliders and articulated constraints. Human intent, balance, grip, effort and football technique still require models. | More geometry only earns predictive value through measurements. |
| Performance | Small dependency-free JS implementation; 22 bodies imply 231 candidate pairs per tick. Existing replay is already fast in Node. | WASM engine with mature collision infrastructure; solver iterations, contacts, JS/WASM traffic and scene complexity determine cost. | No measured speed comparison yet. Benchmark identical scenes without rendering or frame storage. |
| Contact handling | Single pairwise overlap pass; custom springs, no general contact manifold solver or swept player collision detection in inspected code. | Collision solver, joint constraints and continuous collision detection facilities; CCD has cost and documented limitations. | Prefer evaluating Rapier when multi-contact behavior becomes the experiment's bottleneck. |
| Determinism | Fixed step and seeded RNG; uses transcendental Math functions; cross-platform identity unverified. | JS/WASM documents cross-platform determinism for the same version, initial values and insertion order. Surrounding nondeterministic calculations can still break it. | Pin versions, inputs, object order and seeds; compare state hashes across required runtimes. |
| Browser compatibility | Already shared by browser ES modules and Node; no physics dependency/bootstrap. | Official JS/WASM packages; asynchronous initialization and asset packaging required. | Compatible with the current renderer through an adapter. |
| Development cost | Lowest cost for a movement-only experiment; maintaining advanced contact correctness would become our responsibility. | Integration and controller retuning cost now, less ownership of generic contact machinery later. | Keep current code; defer migration until a measured need. |

Rapier documentation supports the capabilities above [S1–S4]. These are engineering judgments, not claims of benchmark superiority. The first experiment does not need joints, ragdolls or a new contact solver. Keep 120 Hz initially; use a development-only timestep sensitivity check before freezing a research run if numerical error becomes material.

A future adapter should separate `policy -> forces/intents -> physics step -> observed state`. Neither renderer nor historical outcome director belongs inside that loop.

## 2. A prospective play generator

Make the forecast cutoff explicit. A pregame forecast, pre-snap forecast and conditional in-play forecast have different permitted inputs.

1. Freeze the as-of roster, availability, depth/usage distributions, player latent skills and uncertainty. Use canonical player IDs and source timestamps.
2. Given game state, sample personnel and formation, offensive call and defensive response jointly or conditionally. Train these policies on earlier games. Marginalize unknown calls; an analyst-selected Slant/Cover 2 scenario is a conditional counterfactual, not the unconditional matchup forecast.
3. Generate assignments and initial positions from earlier observed formation/motion examples where permitted. Model uncertainty when charting is absent. Historical route and coverage labels inferred using full trajectories may be training labels, but cannot be input features from the target play.
4. Run policies that choose desired movement, blocks, reads, pressure reactions, target selection, release timing and aim. The QB sees only the information allowed by the behavioral model. Sample latent intent/reaction/throw error from fitted distributions, preserving shared dependencies.
5. Integrate movement and flight; resolve catches, possession, contact and end-of-play events with mechanisms or calibrated statistical kernels. No need to pretend every event is already physically identifiable.
6. Let one rules reducer derive gain, clock, downs, penalties, possession, score and player statistics from the same generated event log. Continue the game from that state.

For a forward throw, the QB may choose an intended aim point using the generated state, solve for an achievable launch, and add empirically calibrated execution error. It must not read the actual later ball landing point or choose velocity to guarantee a real catch. Launch limits and failures remain possible.

Use distinct schemas and entry points, rather than a flag deep inside `simulatePlay()`:

| Mode | Inputs | Meaning |
| --- | --- | --- |
| Historical reconstruction | Observed outcome anchors | Explain/render a past play. |
| Sampled-game reconstruction | LP's already sampled outcome script | Render one hypothetical LP game. |
| Prospective research | Cutoff state, as-of model/ratings, optional declared call, seed | Generate an outcome without future labels. |

Future labels live in an evaluator-only record. Changing the hidden target, gain, tackler, catch location or final score must leave a prospective prediction unchanged. A prospective module must not import `build_game.py` output or the outcome-constrained play director.

The existing [GRIDIRON-CONTRACT-v1](../GRIDIRON-CONTRACT-v1.md) remains the LP-to-renderer interface. This PR does not edit that byte-identical shared contract. A future, separately versioned research-kernel interface can let Gridiron inform LP probabilities while LP continues to own game chronology and accounting. That avoids turning every game forecast into a 120 Hz simulation.

## 3. Big Data Bowl can validate real movement

Yes. The NFL's own repository demonstrates actual tracking and a 10-frame-per-second animation; its remaining example covers one 2017 game [S5]. That is useful for ingestion debugging, insufficient for independent predictive evaluation.

The 2025 competition release is a better proposed movement-validation source: published primary research describes 2022 weeks 1–9, 10 Hz player positions and movement attributes, including pre-snap and post-snap data [S6]. The 2026 prediction task concerns movement after release, but its published schema includes `ball_land_x`/`ball_land_y` [S7]. Such fields must be removed from a pre-release forecast. Audit horizon lengths, role/target markers and retrospectively derived charting similarly; being provided by a competition does not make a field knowable at our prediction cutoff.

Required data audit before implementation:

- Inspect the actual release/schema, eligible games/play types, complete-frame rates, events, IDs and missingness; hash the raw sources.
- Convert yards/metres, field origin, attack direction, orientation and movement angles explicitly. Orientation and movement direction are different quantities.
- Validate frame cadence and timestamp alignment. Compare simulation at observed 10 Hz timestamps; interpolating to 120 Hz creates no new evidence.
- Use only past frames for feature smoothing or derivative estimation. Future-aware interpolation can leak the evaluated trajectory.
- Measure position error, separation distributions, turns/braking and acceleration against observed tracks, grouped by game and player role.
- Do not infer joint pose, hand contact, true intent, applied forces or full 3D ball aerodynamics from x/y player tracking alone.
- Check overlapping game IDs across competition editions. A different release name is not an independent holdout.

The indexed 2025 official rules restrict competition-data use to non-commercial purposes [S8]. Exact applicable terms and access must be reviewed before acquisition, training or redistribution. Research access does not establish permission to deploy a derived surrogate commercially in LP; distillation does not itself resolve that issue. This proposal uploads no competition data or trained artifacts. Direct Kaggle page rendering was incomplete during inspection; dataset-specific fields and access remain an implementation prerequisite.

## 4. Where physics is most useful

These are hypotheses ranked by feasibility with the available state, not established improvements.

| Mechanism | Useful contribution | Missing information / limit |
| --- | --- | --- |
| Separation and reachability | Speed, acceleration, braking and turn constraints affect who can reach a location and when. | Route choice, defensive assignment and reaction policy often dominate. Best first candidate. |
| Pass trajectories and arrival time | Forward gravity/drag and feasible release velocities constrain flight. | Need launch/aim uncertainty, weather and preferably 3D observations. Current endpoint solving is reconstruction when endpoint is observed. |
| Catch probability | Arrival geometry, reach, relative velocity and defender proximity can improve conditional features. | Hands, attention, timing and control require learned probabilities. Reachable does not mean caught. |
| Contested catches | Relative arrival time and jump/reach envelopes can define the contest. | X/y tracking cannot identify grip, hand contact or body pose. High uncertainty; defer detailed biomechanics. |
| Blocking / pressure | Geometry and closing times can constrain paths to the QB. | Actual assignments, leverage, hand use and balance are weakly observed. Better contact numerics alone will not identify block wins. |
| Tackles | Pursuit angle, closing velocity and opportunity geometry. | Wrap success and balance need real outcome calibration; present tackle logic is endpoint-constrained. |
| Yards after catch | Shared pursuit/reachability plus a calibrated tackle-hazard model can produce dependent outcomes. | Compounds uncertainty in catch state, choices and tackle success. Start only after movement validation. |
| Kicks / loose balls | Flight, reachable recovery regions and boundaries. | Spin, bounce and contact state are often unobserved; random bounce parameters need evidence. |

Start with physical constraints on learned behavior. Full-body simulation is optional, and more detailed dynamics can reduce forecast quality if the inputs or policies are wrong.

## 5. Cheap conditional models for Legendary Picks

Yes, in principle: a validated expensive experiment can produce a small lookup table, spline, regression or compact neural model approximating a conditional distribution.

For example, estimate `P(reach region before opponent | relative position, velocity, ability, time budget)`. Later, a separately validated catch or tackle kernel can consume that result. Keep outputs probabilistic and preserve relevant dependence, rather than independently drawing contradictory player totals.

The sequence is:

1. Fit and validate the physical/behavioral mechanism on real development observations.
2. Sample initial states from an empirically supported distribution and propagate uncertainty in ratings and policies.
3. Fit the cheap surrogate to the expensive model's response distribution.
4. Measure surrogate-to-simulator approximation error on separate simulated cases.
5. Independently score both against untouched real games, with the same information and a statistical baseline.
6. Only after a pass and permitted use, let LP call the kernel within its event generator. Missing/out-of-support states use a declared statistical fallback.

Synthetic agreement proves compression, not accuracy. An expensive simulator is not ground truth. Evaluate the composed pregame model too: success given observed in-play coordinates does not establish success when LP must generate those coordinates. Benchmark throughput on a declared machine, including preprocessing and model transfer; do not assert a speedup before measuring it.

## 6. Updating ratings without changing history

Separate slowly changing physical capacity, more variable football skill, and fast-changing usage/availability. Maintain distributions, effective sample sizes and provenance instead of treating a 0–99 display score as a measurement.

After verified games:

1. Ingest immutable result revisions and record event time, publication/availability time, ingestion time and validation status.
2. Score the original locked predictions against eligible labels before updating the next prediction state.
3. Update only prespecified dynamic parameters using completed, verified evidence available by the next cutoff. Use position/role shrinkage, opportunity denominators, opponent/context adjustment and uncertainty.
4. Publish a new immutable ratings snapshot with a parent version, cutoff, source hashes, training window, model/config/code versions and imputation flags.
5. Freeze each forecast with the exact roster, ratings, rules, model, input and seed versions. Store the issued probability distribution as well as its reproducibility metadata.

Do not raise physical speed merely because a receiver gained many yards, or treat tackles/game as pure tackling ability. Opportunity, scheme, opponent and skill are confounded. Tracking can inform movement capacity where available; production informs outcome rates with appropriate shrinkage.

A date filter is necessary but insufficient: league normalization, combine imputations, roster membership, injuries and corrections must also respect availability time. For historical periods without archived availability evidence, disclose retrospective reconstruction rather than claiming a truly issued forecast.

Corrections append a revised result/scoring record. They do not replace old forecasts or silently refit earlier ratings. Future snapshots may incorporate the correction when it becomes available. Structural/controller changes are new model versions with fresh evaluation gates, distinct from scheduled rating updates.

Compare a frozen-rating arm and a sequential-update arm on identical future games. Both obey the same information cutoff. Fit decay/shrinkage choices on development data only; this is sequential estimation, not reinforcement learning.

## 7. One small experiment: short-horizon separation

**Hypothesis:** explicit acceleration, braking and turning limits improve the predicted distribution of receiver–defender separation over the next 0.5 seconds beyond a simple learned statistical motion model.

This is a conditional in-play mechanism experiment. It is not yet a pregame forecast, completion model or test of a full play-call generator. It may justify further research; it cannot promote a production NFL model by itself.

### Frozen protocol

- Proposed source: permitted Big Data Bowl 2025 tracking. Audit access, rights, coverage and prior use first.
- Prediction origin: exactly 1.0 second after the snap. Input history ends there and uses at most the preceding 0.5 seconds.
- Eligible examples: roster-position WRs present at the cutoff on ongoing scrimmage plays, without selecting the eventual target or filtering by eventual completion. Pair each WR with the nearest opponent at the cutoff, tie-broken by stable player ID. Keep that identity fixed through evaluation; it need not remain the nearest defender.
- Limit this first scope to initially separated pairs: distance 2–10 metres and no other player within 2 metres of either member at the cutoff. These are known-state eligibility rules, not filters on future contact.
- Target: their centre-to-centre distance 0.5 seconds later. This is geometric separation, not a declaration that the receiver is open.
- Missing target frames or plays ending before the horizon are recorded as censored with counts/reasons. Report scoring as conditional on an observed horizon, including censoring by arm-independent initial-state strata. Do not drop future contacts or difficult but observed trajectories.
- Features: past positions/velocities, causal acceleration estimates, relative geometry, position group and situation; historical physical estimates only if genuinely available as of the game. Both arms receive identical features. Do not reuse 2026 ratings to evaluate 2022 players.

### Baseline and candidate

**B0:** a regularized linear Gaussian model for the pair's accelerations, conditional on the allowed history/state. Integrate those accelerations without the football-specific force/traction limits. Fit residual dependence between players and across time on development data; no test-derived noise tuning. Report constant-velocity error as an additional sanity check, not the only comparator.

**P1:** the same learned acceleration proposals and paired random draws, passed through the existing locomotion response with force–velocity, braking, lateral acceleration and traction limits. For the current controller, desired velocity can be formed as current velocity plus the proposal times its response constant. Use a small research harness around locomotion, not the historical director. Disable artificial end-spot, catch and tackle rules. No engine migration and no contact simulation in this first experiment; any later-contact cases remain part of the observed error.

The shared proposal model isolates the contribution of physical limits. Fit/tune controller parameters on training/development only, account for that tuning budget, then freeze both arms. Propagate measured residual uncertainty in both; do not add arbitrary randomness to make the result look realistic.

### Independent evaluation and decision

Proposed chronological split: 2022 weeks 1–5 train, week 6 development, weeks 7–9 sealed final test, conditional on actual eligible coverage and a prior-exposure audit. If the final set has already informed decisions, select a different untouched later block before fitting, or report that an independent test is unavailable. Never relabel repeatedly examined games as fresh.

The evaluator, not model fitting or feature generation, reads post-cutoff targets. Store the exact allowed-column manifest and game IDs before training. Keep all examples from one game in one split. No frames from a test play may leak into training, and no synthetic reconstruction serves as the target.

Primary metric: mean CRPS of separation, averaged within plays and then games so long/populated games do not dominate. Secondary diagnostics: Brier for separation greater than 1 yard, interval coverage, pair position error, runtime and contact/failure strata. The threshold is a prespecified diagnostic, not a catch/open probability.

Proposed go criterion: at least 2% relative CRPS reduction versus B0, with a paired game-block bootstrap 95% interval for candidate-minus-baseline CRPS entirely below zero. Require at least 30 eligible test games and 1,000 pair examples; if the audit cannot support that, report insufficient evidence rather than relaxing the threshold after scoring. Freeze sample counts, seeds and development-selected Monte Carlo precision before unsealing. These are proposal thresholds, not a completed power analysis.

A failed or inconclusive result ends this mechanism attempt without an engine rewrite. A pass supports a separate replication on later untouched games and, eventually, a cheap surrogate plus an LP end-to-end test. Public historical tracking provides a forward-in-time holdout, not a genuinely live forecast issued in 2022; current-season prospective claims require a permitted future tracking feed and predictions locked before those observations arrive.

## Scope of this PR

Only this research document is added. No changes to the solver, Slant prototype, ratings, LP contract, data ingestion, UI or production models. No new dependencies or competition data. Implementation begins only after reviewing this proposal and confirming the experiment's data/access prerequisites.

## Sources inspected

- S1: [Rapier JavaScript getting started](https://rapier.rs/docs/user_guides/javascript/getting_started_js/)
- S2: [Rapier JavaScript determinism](https://rapier.rs/docs/user_guides/javascript/determinism/)
- S3: [Rapier continuous collision detection](https://rapier.rs/docs/user_guides/javascript/rigid_body_ccd/)
- S4: [Rapier joints](https://rapier.rs/docs/user_guides/javascript/joints/)
- S5: [NFL Football Operations Big Data Bowl repository](https://github.com/nfl-football-ops/Big-Data-Bowl/blob/master/README.md)
- S6: [Nguyen and Yurko, A multilevel model with heterogeneous variances for snap timing in the NFL](https://doi.org/10.1093/jrsssa/qnaf185), primary research describing the 2025 release.
- S7: [NFL Big Data Bowl 2026 prediction data](https://www.kaggle.com/competitions/nfl-big-data-bowl-2026-prediction/data), indexed schema.
- S8: [NFL Big Data Bowl 2025 rules](https://www.kaggle.com/c/nfl-big-data-bowl-2025/rules), indexed Data Access and Use provision.
