# Football-first agent directive — 2026-10-23

> **2026-10-24 higher-priority update:** [End-to-end football simulator delivery plan](END-TO-END-FOOTBALL-SIMULATOR-DELIVERY-PLAN-2026-10-24.md) is now the **active critical-path work order**. This football-first directive retains the data-cutoff, reuse-existing-tools, truth-label, real-world evaluation and no-unapproved-deployment guardrails. Its earlier instruction to make tracking/trajectory benchmarks the *first sprint* is superseded: complete generated play → drive → game E0–E2 first, then selective motion/physics evaluation E3. Do not rewrite its historical results.

**Status: ACTIVE, supersedes previous "next task" guidance in older roadmaps, handoffs and research reports.** Historical results and safety rules remain valid. Applies to Gridiron Physics and Legendary Picks simulation, NFL movement, ratings and evaluation research.

**North star:** Starting with *only allowed information available at a declared decision time*, generate plausible player movement and football decisions, resolve or estimate interactions using the **simplest sufficient established mechanism**, and reproduce **observed NFL trajectories, play outcomes, possessions, and game distributions** better than strong, cheaper baselines. A convincing replay is not a predictive result.

## Direction change

1. **Do not invent general-purpose rigid-body physics, locomotion, PID controllers, grasp solvers or new rating scales when established engines/libraries already implement the generic mechanism.** Three.js remains visualization, Rapier and Jolt remain available research solvers. Reuse, cite and test existing tools first.
2. **Stop open-ended synthetic stress sweeps and rating-to-force tuning as the default next milestone.** The M1b/M4b/M4c/M4d archives and the legacy tackle defect reports are preserved evidence, *not a queue of every imaginable physical subproblem to solve before touching real football*. Run a narrow synthetic reproduction **only if** a measured NFL-play mismatch, numerical safety failure or concrete integration blocker requires it.
3. **Football behavior is the main modeling challenge.** Learn and evaluate player intent, pursuit, blocking, coverage, routes, timing, ball decisions and group coordination from eligible real NFL examples. Let mature physics impose contact and feasible-motion constraints when necessary. A statistical or hybrid contact/outcome model is acceptable if it outperforms a physically detailed alternative on predeclared relevant outcomes; label fallbacks.
4. **Use Madden ratings as uncertain covariates/alternative input snapshots, not physical laws or supervised targets by default.** Keep the historical 35/60-attribute training project parked until observed football evaluation identifies an ability that contributes measurable value. No uncalibrated 0–99-to-newtons conversion or commercial training/deployment decision in this sprint.
5. **The aim is plays → drives → games.** Evaluate *separately*: tracking fidelity, interactions, play statistics/outcomes, down/distance/clock, drive ending and scoring, game-score/player-stat distributions and held-out forecasting. Do not claim improvement in a higher level from improvement in a lower one.
6. **Keep the old work and failure record.** Freeze report SHA, code SHA, source snapshots, failing scenario metrics and replays. Existing M4d possession-retention failures and the legacy 3 m far-wrap / 17.5 kN spring defect remain known research defects. Don't merge broken code; don't burn another iteration optimizing them without a real-play acceptance target or a narrowly scoped safety repair.
7. **Production remains isolated.** No changes to live Legendary Picks predictions, official locks, grading, prod DB, or Gridiron main player solver. Work on separate research branches/worktrees, obey each repo's `AGENTS.md`/runbook, and use focused PRs for reusable infrastructure only after tests and explicit approval. Publishing a report is not approval to deploy.

## First work item: real NFL tracking feasibility and initial benchmark

**Deliver Phase 0 first.** Inventory any *existing* local NFL full-player tracking, play-by-play, labels and licenses before downloading or implementing a new model. Consult current published source documentation; use publisher definitions, stable `gameId/playId/nflId` joins and source hashes. Avoid unnecessary scraping or copied giant assets.

Candidate public research resources:
- [NFL Big Data Bowl 2025 data](https://www.kaggle.com/competitions/nfl-big-data-bowl-2025/data) documents pre-snap player/ball tracking with `x, y, s, a, o, dir, frameId`, snap/football context, and event references; **audit the actual time intervals present**, do not assume the competition contains full free-running post-snap trajectories for the desired play cohort.
- [NFL Big Data Bowl 2026 prediction data](https://www.kaggle.com/competitions/nfl-big-data-bowl-2026-prediction/data) is a narrower **throw-time → ball-arrival** prediction task: input frames stop at ball release; published inputs include *targeted receiver and ball-landing coordinates*, which are only admissible for that **conditional post-throw benchmark**, not for an unrestricted pre-snap simulator. Do not describe that contest as a full-drive/full-play dataset.
- Use existing Legendary Picks nflverse and PBP cohorts for observed plays, outcomes, and the **separate** drive/game baselines; check identity and game/play joins and avoid source-mismatch claims.

**Deliver a data/access/rights feasibility report** with: mounted files vs merely described public resources, exact local paths or accessible data fetch mechanism, licensing/terms and approved internal use, source edition/season/coverage, player completeness, timestamp cadence, snap/throw/terminal events, position/ball location continuity, target availability, team/field orientation, missingness, source keys, train/development/holdout eligibility, and whether **fully free-running from snap** is possible with the observed data. No claim that tracking is locally accessible until it is actually found and read. If usable full-play tracking is unavailable, do not invent it: run the narrower throw-time conditional experiment or deliver the data blocker plus a credible acquisition path.

## Benchmark design and non-leakage contract

Pick **one feasible benchmark** after Phase 0, not both by assumption:
- **A. Throw-time conditional movement:** start at the actual throw, with all inputs explicitly allowed by that published task (including landing coordinates only if that task supplies them), predict only subsequent player positions while the ball is in flight. This **cannot** demonstrate free-snap football simulation or full play outcome skill.
- **B. Prospective from-snap movement/play:** if genuine post-snap full-play tracking is verified, start from a real pre-snap state and only context available at that cutoff. Hide realized target, trajectory, catch, tackler, gain/loss, terminal spot, future defender intent and recorded result from model input. Forecast or simulate them. Do not secretly teacher-force recorded player positions or play calls after cutoff.
- **C. Historical reconstruction** is allowed solely as a visually labeled debugging/control mode with observed future data. Never score it as open-loop prediction.

Create a **game-grouped, chronological and as-of-eligible split**, pin a fixed small exploratory sample (e.g. 5–10 complete eligible examples), then preregister a larger **20–50 play** development benchmark if coverage exists. Define a truly unused subsequent game/season or prospective holdout for later decisions. Report cohort counts, exclusions, missing/late data, play families and event denominators. Never tune against an already inspected holdout and call it untouched.

Compare cheap baselines before any new neural or physics model:
1. Hold-last-position / constant velocity and, if supported, simple bounded acceleration.
2. Existing published/open trajectory or role-aware baseline when accessible; cite source/implementation.
3. Minimal interaction-aware movement / policy baseline with separation, team/defender context.
4. Existing Gridiron movement adapter and contact infrastructure *only on the same eligible states*.
5. A preregistered hybrid/statistical outcome fallback if reliable full rigid-body contact makes overall behavior worse.

Capture the **information budget** of each competitor: if a baseline knows ball landing/target and another does not, **they are not comparable on the same question**. No invented true 3D player coordinates from 2D NFL tracking; distinguish renderer Z/poses and tracking XY from observed vertical movement.

## Required measures and viewer

For eligible **player movement**: time-aligned x/y path error by horizon, speed/turn errors where source supports them, pair separation and nearest defender, team spacing, spacing violations, broken/unknown identities, missing frames, and error growth for free-running rollouts. Include opportunity counts and uncertainty. If only conditional post-throw motion exists, report conditional position metrics, not yards-per-carry/tackle outcome skill.

For eligible **real-play outcomes** with post-snap labels: first/last contact timing if observed, carrier/ball terminal spot, yards gained vs actual, YAC where supported, completion/incompletion, first down, tackle/pressure/sack, turnover and time elapsed. Do **not** score unavailable contact forces or hand-ball grip as NFL ground truth. Grade probabilities with Brier/log loss only if the system outputs genuine probabilities.

For **drive/game evaluation**: use LP's existing NFL sequence evaluator (2010–2021 train, 2022–2023 previously inspected holdout) as the bounded comparison scaffold. Match drives/game and plays/drive **and** distribution of TD/FG/punt/turnover, third/fourth down, red-zone TDs, clock/kneels, score margin/total and player-stat correlations. Mark earlier inspected cohorts as development diagnostics, not fresh validation. Track simulation compute/runtime versus statistical alternative.

Viewer/archive: observed, cheap statistical baseline, and candidate/hybrid side by side at synchronized *actual* timestamps when available. Display source/decision cutoff, observed vs generated, allowed conditional information, uncertain/absent frames, trajectories and outcome deltas. Reuse the current Three.js visual archive rather than constructing another competing viewer unless a small adapter is demonstrably inadequate. Preserve immutable source, code, run and evaluation hashes.

**Success is not a nice clip.** For the first sprint: a verified real-data source and information boundary; 5–10 accurately joined reference examples; baseline metrics and a genuine held-out/future plan; a feasible 20–50-play report or documented coverage blocker; a reproducible side-by-side comparison; and a justified **next model/data decision**. A candidate that does not beat simple baselines remains research-only.

## Agent ownership and handoffs

**Legendary Picks tracking/data agent — owner of reality and cutoffs**
- Audit local/public NFL tracking availability and data terms; own schema, joins, event-time cutoffs, normalization, missingness and frozen train/holdout manifests.
- Export minimal, rights-aware, versioned **observed state and allowed input** files to Gridiron; never hand the prospective model the actual future. Do not edit Gridiron's engine files.

**Legendary Picks behavior/baseline agent — owner of learned football movement**
- Implement cheap movement baselines and one small policy challenger on the same cohort; measure one-step and free-running error separately, and pair/team coherence. Reuse existing LP tracking/model code if applicable; do not train 35 Madden targets or new large architectures first.
- Output trajectories with player IDs, timestamps, prediction cutoff, confidence and frozen model version; no engine/solver forks.

**Gridiron Physics execution/visualization agent — owner of replay and established contact tools**
- Integrate frozen observed/predicted player states via a research-only adapter to existing `engine/movement/`, Three.js and optionally pinned Rapier/Jolt 3D M4c mechanisms. Do not alter NFL main physics or rebuild generic collision/grasp/character controllers.
- Report exactly when and why physical constraints change a play versus a cheap movement model. Prioritize a realistic **observed** movement comparison over an increasingly elaborate synthetic tackle suite.

**Legendary Picks sequence/drive agent — owner of football consequences**
- Retain NFL PBP statistical sequence baseline; evaluate played-out downs/field position/clock/drive endings. Introduce a versioned *research-only* play-result → game-state reducer interface; record statistical fallback and do not impute physically unimplemented events as observed.
- Preserve official live NFL model and locked grades. Do not backfit the already inspected 2022–2023 result into a fake holdout win.

**Ratings/Madden agent — on limited support**
- Produce only identity-verified, as-of-eligible player metadata/covariates needed by the selected observed-play test, clearly flagging estimated abilities and source rights. Keep broad Madden historical supervised-rating training paused. Do not apply 0–99 physical-force formulas.

**Integrator/coordinator — one owner of the decision**
- Pin all baseline/report/source commits, enforce stable play IDs and input cutoffs, gate leakage, replay and evaluation reproducibility, and publish *one* comparison with failed cases and reasons.
- Prevent redundant physics implementation, overlapping file changes, cherry-picked demos or premature claims. Make explicit decisions: improve behavior/policy, improve data, keep statistical fallback, require narrow contact fix, or stop. No PR merging without authorization.

All agents: inspect existing repos, docs, relevant installed skills and previous experiments first. Ask **"what existing tool or published data/model already solves this?"** before writing new code. Assign files per agent and coordinate through a pinned repo-tracked manifest/protocol rather than unreliable inter-session messages. A scoped, independently validated bug fix is fine; repeated solver contact or Madden attribute sweeps without a real-football hypothesis are **paused by default**.

## Pre-existing reports and compatibility

The following stay historically intact rather than being rewritten or deleted: M1b, M4b, M4c, M4d, [ratings-to-physics integration review](research/RATINGS-TO-PHYSICS-INTEGRATION-REVIEW-2026-10-23.md), [rating research coordination contract](research/RATINGS-TO-PHYSICS-COORDINATION-2026-10-23.md), LP [simulation learnings](https://github.com/micahp/legendarypicks/blob/dev/docs/SIMULATION-LEARNINGS.md), and the NFL sequence v0.2 drive eval. If a prior document labels a synthetic physics milestone the "**next**" task, **this directive supersedes its priority**; its experimental metrics remain historical evidence.

**No current task authorizes modifying the production Gridiron engine, training or shipping Madden-derived models, changing LP live picks or grading, or merging branches.** Submit self-contained research diffs, checked against baselines, then request an independent integration review.
