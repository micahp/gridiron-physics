# M4c — Contact Resolution, Secure Possession, and Completed Football Outcomes

**Research source commit:** `82a484fe1d89b5bec9f93ae01a8b932776d82280`
**Branch:** `research/m4c-contact-possession-resolution`
**Scenario library:** `m4c-scenario-library-v5`
**Scope:** Rapier 0.21.0 and Jolt 1.1.0 remain competing research solvers. The production solver was not changed.

## Results

The shared M1b/M4b interface reproduces the original successful, broken, and missed M1b tackle on both engines. The full M4b regression still passes all 16 scenarios on both engines. M4c's acceptance matrix passed **104/104 runs**: 13 asserted fixtures × two engines × two seeds × two physical input configurations. Both solvers also reproduced the registered two-defender signature exactly on two repeated runs within the same process. The seeds are recorded fixture labels; these scenarios do not draw randomness.

The interface is in [interface.mjs](interface.mjs), the M1b regression in [m1b-regression-test.mjs](m1b-regression-test.mjs), and the unchanged thresholds are in [M4C-PREREG.md](M4C-PREREG.md). The preserved M1b baseline is in [BASELINE-REPORT.md](m1b/BASELINE-REPORT.md) and [m1b-results-baseline.json](m1b/m1b-results-baseline.json); the previous M4b findings remain in [REPORT.md](REPORT.md). Machine-readable runs are in [m4c-validation.json](results/m4c-validation.json); the parameter and causal-ablation runs are in [m4c-sensitivity.json](results/m4c-sensitivity.json).

## Penetration

M4b previously reported maxima of 0.300 m for Rapier capsules, 0.307 m for Jolt capsules, and 0.250 m for compound bodies. M4c's compound-proxy acceptance matrix reports lower maxima. This is evidence of improvement, not a strict solver-only A/B: fixture inputs changed, and M4c's per-step measure includes player, football, and ground contact snapshots.

The pooled values below use all 55,104 fixed-step samples (459.2 simulated seconds), including zero-contact steps. The preregistered percentile and mean gates are also checked per run.

| Engine | Runs | Maximum | Pooled per-step p95 | Duration-weighted mean | Per-run p95 failures | Per-run mean failures |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Rapier | 52 | 0.11874 m | 0.03836 m | 0.00844 m | 12/52 | 6/52 |
| Jolt | 52 | 0.10294 m | 0.02121 m | 0.00597 m | 8/52 | 4/52 |

All 104 runs passed the **0.15 m maximum** gate. **20/104** missed the per-run p95 gate of 0.05 m, and **10/104** missed the per-run duration-weighted mean gate of 0.025 m. Those failures remain visible even though the pooled p95 is 0.03400 m and pooled weighted mean is 0.00721 m. The largest initial analytic player-player overlap estimate was zero; the largest first-step snapshot was 0.080 m. No player was teleported or reset after simulation began.

Across the matrix, contact-pair samples exceeding 0.01 m numbered **20,214**, exceeding 0.05 m numbered **2,068**, exceeding 0.10 m numbered **58**, and exceeding 0.15 m numbered **0**. These count pair samples, so simultaneous contacts can contribute multiple observations in a step.

The 57-run sensitivity matrix was finite throughout. Its Jolt 1/60 s timestep case reached **0.24261 m maximum** and **0.15925 m p95**, failing the registered maximum and p95 limits. Rapier's 1/60 s maximum was 0.13415 m. Both engines were below 0.0024 m maximum at 1/240 s. The matrix varied spawn separation, proxy scale, Rapier contact skin and solver iterations, Jolt collision steps, timestep, cradle stiffness, player drive, balance, traction, overall and team mass scales, grip strength, defender count, ball control, and eight- and 22-player contact counts.

The JavaScript bindings did not expose native solver contact stiffness/stabilization controls or a Jolt equivalent to Rapier contact skin. Rapier solver iterations and Jolt collision steps are different settings and were not treated as equivalent. These are investigation limits, not passes.

## Football outcomes and remaining failures

- Two defenders established separate contacts and grips and physically brought down one runner. A three-defender staggered tackle also completed on both engines. The ledger records contact times, impulses or labeled estimates, grip loads, and carrier velocity changes.
- `grip-escape-one-held` released the weaker grip while the second remained active on both engines. `grip-break-multiple-forward` overloaded both grips; the runner stayed upright and finished forward of the starting position.
- Both engines resolved the shared sack and the initiate/finish sack after the quarterback met the registered physical fall condition. In `sack-throw-window`, the quarterback released at 0.525 s, before falling at 4.52 s (Rapier) or 4.78 s (Jolt); the later physical takedown occurred at 4.72 s and 4.98 s. The pass remains in flight with no receiver possession or catch result.
- The `gang-three-upright` setup now makes five physical contact pairs on each solver, but the carrier never meets the fall condition. It is a recorded non-terminal outcome, not a completed tackle.
- The runner-retention fixture records one second of active two-point control after player contact. The force-fumble fixture records ball-striker contact, two overload ticks, and solver-resolved separation. Rapier ends that fixture with an unresolved loose ball; Jolt later re-establishes control. The eight-player pile releases the ball under overload and records a later secure recovery on both engines.
- Failed recovery requires and records actual loose-ball contact but ends without control after the registered 0.25 s interval. Secure recovery records sustained two-point control for at least 0.50 s. Contested recovery records physical contact between opponents and control attempts by both; neither is declared the winner.
- The eight-player push and 22-player line both record center-to-quarterback snap contact and maintained quarterback possession. The 22-player replay contains 21 Rapier and 24 Jolt player-contact pairs. Carrier and football positions are recorded separately. The eight-player quarterback advances to x=0.87 m from x=-1.15 m, then finishes at x=-1.12 m; the raw trajectory shows a late stall/backward drive. No first down, touchdown, down-by-contact, official spot, or sack credit is assigned.

Analytic player-pair contact opportunities (surface gap ≤0.10 m) led to physical engine contact in **214 of 232** observed pair opportunities. This is descriptive fixture data, not a registered acceptance threshold or an estimate of football event rates.

## Solver comparison and integration recommendation

Jolt had the lower maximum and fewer per-run p95/mean misses in the registered matrix; its 1/60 s sensitivity case was substantially worse. Rapier exposes solver manifold normal impulses used in the contribution ledger. The tested Jolt wrapper does not expose equivalent impulses, so its impulse values are relative-velocity/reduced-mass estimates that can be confounded by simultaneous contacts and external forces.

Keep both engines in research. Use Rapier for the next instrumented isolated prototype because its contact impulse telemetry is more direct, while retaining Jolt as a competing implementation. Do not select a production solver until comparable Jolt impulse telemetry and solver-setting comparisons are available.

These are rigid, non-articulated player proxies with force-based balance and cradle models. They do not establish full-body biomechanics, NFL predictive accuracy, or production readiness. No empirical event-rate tuning was performed.

## Replay archive and reproduction

The immutable M4c archive is at `results/m4c-contact-possession-v1/82a484fe1d/seed-41027/`; it contains full-rate 120 Hz player and football transforms, contacts, grip events, penetration samples, physical inputs, solver metadata, and outcomes for 16 scenarios on both engines. Earlier M4c source versions and the old M4b archive remain indexed in [archive-index.json](results/archive-index.json). The manifest omits duplicate per-step penetration arrays; those remain in each compressed replay.

The runner-retention comparison uses a matched replay of the same fixture and seed with `behaviorVersion: m4b` and the M4c force-driven policy. That control is stored under `results/proxy-v2-compound/82a484fe1d/seed-41027/`; its source commit is recorded in the manifest. The other comparisons use the archived M4b compound profile. This policy-control replay is not mislabeled as an older historical M4b source recording.

The existing Three.js viewer is at `research/physics-3d-evaluation/m4b/archive/`. Capture produced **96 fixed-camera stills** (16 scenarios × two engines × three cameras at 0.8 s) under `screenshots/m4c/`, and **12 synchronized VP9 side-by-side clips** (six comparison scenarios × two engines, 12 fps, 1440×600) under `videos/m4c/`. The clips are 2.416 s for possession retention and 7.583 s for the other five scenarios. The viewer draws possession state, grip points, contact forces, and body orientation.

From the repository root, reproduce with:

```sh
npm ci
npm run eval:m1b:regression
npm run eval:m4b:test
npm run eval:m4c:test
npm run eval:m4c:sensitivity
npm run eval:m4c:archive -- 41027
npm run eval:m4c:capture -- 41027
```

To browse the archive, start `npm run serve` in a separate terminal and open `http://localhost:8080/research/physics-3d-evaluation/m4b/archive/`.
