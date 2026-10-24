# End-to-end football simulator delivery plan — 2026-10-24

**Status: ACTIVE HIGHEST-PRIORITY WORK ORDER for both Gridiron Physics and Legendary Picks NFL simulation agents.** Supersedes older *next-task priorities* in the football-first tracking directive, 2026-10-24 tracking review, M1–M4d reports and roadmap. All earlier measurements, license cautions, branch boundaries and no-production/no-merge safety rules still apply. This document is a delivery instruction, **not evidence that this end-to-end integration has already shipped**.

## Why the work exists

**Product goal:** Generate an entire, coherent NFL game from a pregame-eligible matchup state and football decisions. Repeated simulations produce internally consistent plays, downs, drives, clock, scores, possession changes and player statistics. Gridiron Physics makes the simulated football inspectable/playable; Legendary Picks uses the resulting distributions, where validated, to explain and improve game/team/player projections and ultimately player props.

The hypothesis worth testing is that *shared player/football causes* make game/play/statistics more coherent or predictive than separately sampled outcomes. That hypothesis is **not automatically true**. A strong statistical-only game model may outperform physical play generation; the answer can be hybrid. We will evaluate honestly.

**Do not confuse these outputs:**
- **A. Statistical-scripted hypothetical game:** LP samples legal hypothetical play events and outcomes; Gridiron renders the unchanged play script. It can already establish a complete end-to-end product pipeline and UI, but rendering is **not proof the play's outcome was physically caused**.
- **B. Prospective physics/hybrid game (research mode):** LP provides state, eligible action/participants/constraints, and the physical/behavioral executor determines a subset of outcomes without LP feeding the realized result. Unsupported interactions use explicit statistical fallbacks. LP's reducer remains the sole authority for football rules and state.
- **C. Observed-game reconstruction:** tracking/PBP/filming may contain the true result and future frames for debugging or teaching; visibly label as reconstruction and **never grade as forecasting**.

These can coexist. **Ship research mode A vertical integration first, then test B on selected plays**. Do not force every game event through an unfinished 3D contact solver merely to claim causality.

## Current verified foundations (as of 2026-10-24)

- LP already has extensive NFL PBP and a **statistical play/drive/game sequence baseline** (v0.1/v0.2 research). Existing 2022–2023 drive tests reveal too many punts/clock ends and too few TDs, plus kneel/fourth-down/red-zone/state problems. Forecast lift and production promotion have **not** been established.
- Gridiron already has a Three.js viewer, historical reconstructed 3D plays, a prospective free run/pass *research* prototype and various collision/movement experiments. **M4c/M4d did not promote a production physics solver**.
- Current [GRIDIRON-CONTRACT v1](../docs/GRIDIRON-CONTRACT-v1.md) is a **proposed, mirrored, byte-identical** LP-to-Gridiron **statistical script/playback** contract. Keep v1 unchanged and compatible. A distinct v2/experimental interface is needed only when physics resolves results.
- The 2022-season 2025-Big-Data-Bowl mirror is staged/audited: 16,124 plays / 9 weeks, and 40 development tackles have an initial 0.5s event-conditioned 2D movement comparison (0.170 vs 0.141 m median pair-separation RMSE). That is **real observed motion evidence, not** a full-play execution, tackle-probability, or game prediction result. Keep the 49-play manifest frozen; weeks 6–9 are reserved for later *model comparisons* despite earlier aggregate profiling.
- Madden STR/TKL/BTK/force mappings remain uncalibrated. Legacy far-wrap spring speed violations and M4d possession-retention penetration failures remain open. Do not let those diagnostic projects indefinitely block a complete statistical/hybrid game.

## Immediate delivery: one **generated** game, end-to-end

**First step: inventory existing implementations, not new physics.** Each agent lists exact branches/commit SHAs, accessible program entry points, current tested state, reusable event/play schemas, v1 contract gaps and smallest integration changes. Coordinate a single selected matchup (e.g. an already supported Patriots–Bears research fixture if confirmed available; don't invent a 2026 schedule) and one frozen **pregame** source manifest. No past actual game's future may be used to generate its hypothetical outcome.

### Gate E0 — implementation map and minimal common adapter
- LP agent proves it can generate **one legal synthetic play-result record** (not a historical recorded outcome): game ID, simulation/sequence IDs, participating players, pre-state, decision, terminal event, gained/lost yards, elapsed time, relevant individual stats, ball/possession/clock effects and provenance.
- Gridiron agent locates a renderer/reconstruction adapter accepting that record without silently changing it. Preserve Three.js, current historical reconstruction and repeatable seeds.
- Agree **one pinned v1 payload** and error-handling/ID tests. If the code is already there, demonstrate it; do not rewrite v1 or make a second ad-hoc contract.
- End-user observable: one generated **hypothetical** play with score/clock/down state and consistent 3D replay, clearly labeled *statistical outcome / visual reconstruction*.

### Gate E1 — **one complete legal drive**
- LP chooses actions/outcomes conditioned on down, distance, field, personnel, game time and rules, applies every result through the *same authoritative reducer*; no manual forcing of first downs, touchdowns or tackles.
- Cover positive/negative plays and one legitimate ending (punt, touchdown, turnover, field-goal attempt or end of period); also test other terminal state types with targeted fixtures. Clock runoff and possession must be reconciled.
- Gridiron renders the **same immutable play stream** through the drive, with replayable state between snaps. No secretly rewritten spots or invented drive-end events.
- Checks: all state transitions legal; `sum(play player stats)` reconciles with drive totals where rules require; spot, yards, first downs, score, clock, possession and terminal event agree; same snapshot/seed reproduce byte-identical event records.

### Gate E2 — **one complete simulated game**
- Generate both teams' possessions with game start through legal regulation termination, versioned NFL rule-era context, kickoffs/field goals/extra points/punts/timeouts/penalties/turnovers via explicitly named mechanisms or labeled statistical fallbacks. Unimplemented overtime/rare events must be disclosed or guarded; never silently skip a required rules transition.
- Gridiron viewer should navigate game → drive → play with score, clock, field/ball state, roster identity, event text, 3D replay and honest source/mode label. Prioritize a finished, inspectable game over visual polish or new solver controls.
- Automatically reconcile final team points vs score events; team and player passing/rushing/receiving stats (including completions/targets/carries/YAC where produced); possession counts and all drive endings; down/distance continuity; play and game clocks. Record any unsupported stat or exceptional play explicitly rather than inventing it.
- Demonstrate deterministic **one-seed game** first, then many seeds without corrupting state/identities. Measure wall time and memory for 1 play, 1 drive, 1 game, and a batch.

### Gate E3 — **football-realism and predictive evaluation**
- **Clock-work provenance update (2026-10-24):** `research/gridiron-e3-physical-timing-2026-10-24` at `7ee6703e` is superseded for clock-comparison work by `research/gridiron-e3-clock-comparison-2026-10-24` (verified head `84a23584`). The earlier physical-timing artifacts remain historical provenance; use the clock-comparison branch for current clock-model evidence.
- Against independent NFL PBP, report both marginal **and joint/conditional** distributions: pass/run mix by game state, yards and first downs by down/distance, sacks/turnovers by eligible plays, plays/drive, possession duration, TD/FG/punt/turnover and clock/kneel endings, third/fourth downs, red-zone conversions, total points, score variance/tails, team/player stat coherence.
- Retain the existing LP sequence engine as **statistical-only benchmark** and build one clearly defined hybrid. Evaluate identical input eligibility, simulation budget and cost; don't invent 'real' tackling from missing labels.
- Reused 2022–2023 drive diagnostics and weeks 1–5 tackle motion are **development** evidence; use a genuinely untouched later period or prospective frozen inputs for model promotion. Report proper probabilistic skill only if forecast probabilities exist, compare with market/simple predictors where relevant, and report calibration/uncertainty.
- Gridiron physical contact is promoted to the game executor **one outcome family at a time** only if it improves observed play distributions/coherence/prediction or provides demonstrable unique visualization/gameplay value without unacceptable reliability/cost. Use statistical fallbacks for everything else.

## Roles: one deliverable, divided by boundaries

**LP sequence/game-state agent — critical-path owner**
1. Map and run existing statistical game generator and authoritative reducer; inventory mismatch to contract v1.
2. Provide a deterministic one-play → one-drive → one-game research stream with all metadata, player stats and legal endings.
3. Create invariants/tests for scoring, line-to-gain, downs, time, possession, drive endings, team/player totals, and seed determinism. Do not modify production locks, model picks, DB or jobs.

**Gridiron execution/viewer agent — critical-path owner**
1. Find the already-existing v1 script playback and historical viewer functionality; adapt it to consume LP generated play sequences **without controlling or changing the statistical result**.
2. Produce a working game/drive/play viewer from the immutable stream; expose execution mode, statistical vs physical provenance, playback, player IDs, ball spots and clock. Reuse movement and animation. Separate a later experimental physical executor.
3. Keep the existing engine and Three.js viewer stable; no change to the production player solver or automatic merge of M4d/legacy tackle branches.

**LP tracking/behavior agent — supporting, *not a blocking critical-path task***
- Preserve 2022 real tracking source/label/identity audit and the 49-play manifest. Continue fair snap-anchored movement experiments in parallel if useful, but **do not block E0–E2** on achieving centimeter-level trajectory fidelity or releasing a new 3D solver.
- Provide 5–10 representative, rights-appropriate observed run/pass/drive examples and evaluation baselines when ready. Future post-snap info may only be used to grade, never to generate a prospective play.

**Physics/Madden agent — bounded support**
- Freeze M4c/M4d synthetic results, known penetration/far-wrap defects and rating hypothesis logs. Fix a narrowly reproduced **safety blocker** only if needed by the chosen executable mode; otherwise no more standalone force/grip/rating tuning this milestone.

**One integration coordinator — owns dependencies and definition of done**
- Keep one versioned cross-repo manifest (both exact commits/branches, source snapshots, v1 vs proposed v2 mode, IDs, allowed inputs, tests, examples, screenshots, known limitations).
- Demand the **smallest working vertical slice** rather than parallel unsynchronized experiments. Establish the LP JSON payload and Gridiron consumer before either agent invents a new interface.
- Publish one per-gate status: existing/reproducible, missing, built, verified, failed; links to exact tests, failure reasons and selected sample.
- Prioritize E0 → E1 → E2, with E3 evaluation in parallel. Stop/defer tasks that cannot say which **game delivery gate** they unblock. Agent communication should be through pinned repo artifacts, not only chat.
- Do not authorize production deployments, merges, PR approvals, or use rights/terms interpretations as assumed facts.

## Decision test for every new research proposal

Before requesting another tackle/trajectory/ratings experiment, answer:
1. **Which broken play, drive or game behavior does this address, measured against what real football or rule oracle?**
2. **Can the existing statistical/hybrid method or existing movement/physics implementation solve it at lower cost?**
3. **Which game gate E0–E3 would become demonstrably better, and what is the acceptance metric/stop rule?**

If those have no clear answer, **defer the experiment**. When 3D physical causality is materially important, keep it as a controlled experimental replacement for a specific event mechanism, not an all-or-nothing prerequisite.

## Acceptance and current limits

**Success for the immediate integration sprint:** a fully generated hypothetical NFL game that is legally coherent, statistically accounted for, reproducible, and navigable through Gridiron 3D replay, compared to the unchanged LP statistical baseline. **This is not by itself physically causal or a validated forecast.** A later experimental v2 can let true player movement/contact determine selected outcomes with real observed NFL grading.

Preserve older documents and negative results. This directive changes **priority and next delivery**, not historical reported metrics or permission to modify live products.
