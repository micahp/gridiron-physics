# AGENTS.md — Gridiron Physics

**Read this before editing or launching an experiment.**

## Current priority (2026-10-23)

**The active, cross-project source of truth is [Football-first Agent Directive](docs/FOOTBALL-FIRST-AGENT-DIRECTIVE-2026-10-23.md).** It explicitly supersedes older "next experiment" instructions in `ROADMAP.md` and dated M1b/M4b/M4c/M4d reports, without invalidating their findings.

**Goal:** Use existing movement/physics tools to simulate **real football behavior** and demonstrate improvements over observed NFL tracking, plays, drives and games. **Do not spend the next iteration inventing more general-purpose physics or re-running broad synthetic Madden-to-force sweeps.**

### Before writing code

1. Inspect this repo's current baseline, `ROADMAP.md`, the latest reports, and the Legendary Picks NFL sequence / tracking context. Search for an existing adapter, solver feature, published dataset or baseline before creating a new one.
2. Ask which **observed NFL play/trajectory** the proposed change is supposed to explain. State its source, cutoff, available future labels, and measurable baseline. If no eligible real data exist, first perform the documented **data availability audit** with LP.
3. Separate three modes: `historical_reconstruction` (observed future allowed and prominently labeled), `conditional_post_throw` (only the declared throw-time task inputs), and `prospective_from_snap` (no observed future). Never treat the first two as proof of the third.
4. Preserve results and limitations from pinned M1b/M4b/M4c/M4d experiments. They are diagnostic tools, **not** milestones that must be perfected before testing actual NFL movement.
5. Prefer **existing Rapier/Jolt** for required 3D rigid contact, established movement controllers for feasible movement, and the existing **Three.js** viewer. A simpler statistical/hybrid event model is a valid challenger if explicit and evaluated on the same eligible inputs.
6. Before a new synthetic mechanics task, identify an independently measured football failure or a specific numerical/blocking regression that motivates it, and define a small experiment with a stop condition. Fix true solver/contact safety defects without relaxing acceptance criteria; do not blindly alter historical results.
7. Do not interpret Madden STR/TKL/BTK as measured forces. Pause broad historical Madden rating training. Use only verified, permission-appropriate, as-of-eligible metadata and preserve missingness.

### Ownership and safety

- **Gridiron** owns physical execution, thin research-only adapters, 3D playback and contact/numerical instrumentation. **Legendary Picks** owns observed NFL tracking, canonical player/play joins, movement-policy training/evaluation, game-state reduction and drive/game benchmarks. One integrator owns cross-track comparison. The directive describes handoffs.
- Work in an isolated research branch/worktree for substantial changes; do not modify the shared engine checkout or production solver without approval. Do not merge research branches into `main` just because individual synthetic test suites pass.
- Preserve game/play/player identifiers, permitted decision-time inputs, versioned source hashes, solver version, replay frames and test failures. Keep bulk third-party tracking and rating tables out of Git; document access/rights before exporting or distributing them.
- Before recommending adoption, compare against simple observed-data baselines and report all denominators, missing cases, gates, known leakage risk and compute cost. An accurate replay is not an out-of-sample prediction.
- Keep legacy `engine/world.js` / `engine/play.js` experimental tackle-hold changes separate from the M4c/M4d Rapier/Jolt research code. The legacy long-distance forced-wrap + unbounded spring defect and M4d possession-retention penetration failures are real open limitations, not defaults to conceal.
- Do not change Legendary Picks live picks, official locks, grading or production data. Do not auto-push or merge other agents' branches.

## Current work order

1. **LP tracking owner:** verify which real tracked frames and labels are actually available.
2. **Movement-policy owner:** freeze simple baselines and one informed policy challenger.
3. **Gridiron owner:** replay identical *eligible* NFL segments with existing adapters and optionally existing physics.
4. **LP drive owner:** align play results with state/clock/possession and evaluate drive distributions separately.
5. **Coordinator:** review matched evidence, failing plays, real-observation improvements and integration readiness.

**Stop condition:** If no suitable full-play tracking is available, narrow explicitly to the published 2026 Big Data Bowl throw-to-arrival benchmark or deliver an access blocker. Do not claim a 20–50 full-play validation was performed without the data.

The [Roadmap](ROADMAP.md) records historical milestones. The [ratings-to-physics integration review](docs/research/RATINGS-TO-PHYSICS-INTEGRATION-REVIEW-2026-10-23.md) remains the frozen decision on prior experimental mappings.
