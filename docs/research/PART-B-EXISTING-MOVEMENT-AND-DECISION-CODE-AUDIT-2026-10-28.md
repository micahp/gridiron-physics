# Part B: audit of the existing movement and QB decision code, 2026-10-28

Status: audit only. Read-only. No physics code, simulation default, or engine behavior was changed. No 2026 data was used.

Scope: `/root/gridiron-statistical-full-game` at commit `ec73c46` (worktree `HEAD`). The relevant code is in `engine/`,
`engine/autonomous/`, `scripts/evaluate-autonomous-bdb.mjs`, and the evidence under `docs/evidence/autonomous-acceptance/`.

## Summary

- The physics layer is real. Bodies have mass, a propulsive force that falls with speed, and a neuromuscular response
  delay. The ball has a flight model. Contacts are impulses.
- The autonomous controller is narrow. It implements two plays: an inside-zone run and a slant-flat pass, against Cover 1
  and Cover 3 only. Its route, block, coverage, and throw logic are hand-set heuristics, not fitted.
- **The quarterback reads live simulator positions.** There is no perception model. Defenders and rushers also act on
  live positions. The `visible` helper in the pass executor is defined but never called, so it is dead code.
- **Pre-snap movement is not simulated.** Every player is held at rest until the snap. Pre-snap history is only an input.
- **The existing evidence says the current controller loses to a constant-velocity predictor** on the 2022 inside-zone
  cohort, at both 0.5 s and 1.0 s. This contradicts the "3.7 mm over constant acceleration" figure in the movement-policy
  decision. The two come from different harnesses and have not been reconciled.
- `engine/play.js` is the **historical play director**. It sets intent from the real play-by-play, including outcomes. Its
  results are replays, not predictive evidence.

## Component inventory

Status key: **implemented** (working mechanism, parameters documented), **heuristic** (working but hand-set and
unfitted), **placeholder** (not modelled), **ground truth** (uses information a real player could not have at that moment),
**dead** (present but unused).

| component | where | status | notes |
|---|---|---|---|
| Body dynamics: mass, propulsive force falling with speed, neuromuscular response | `engine/world.js:63` to `~110` (`locomote`, `F0 (1 - v/vmax)`) | implemented | Speed caps and acceleration limits come from ratings through hand-set mappings. |
| Ball flight and launch solver | `engine/ball.js`, `solveLaunch`, `AERO` | implemented | Real flight model used by the pass executor. |
| Contact and tackle | `engine/world.js` (impulses); `passing.js:570` (`startTackle`), `:601` (`rushPasser`) | implemented | Not audited in depth beyond the function boundaries. |
| Pre-snap movement | `passing.js:649`, `:767`, `:907` (`if (!snapped)` returns zero velocity) | **placeholder** | No pre-snap motion, shifts, or motion. History is an input only. |
| Route progression | `passing.js:345` (`routeTarget`) | heuristic, partial | Hand-set landmarks for a slant, a flat, a backside clear-out, and a running back checkdown. No route library. BDB `routeRan` labels are not used. |
| Blocking assignment | `passing.js:298` (`chooseBlockTarget`), `:648` (`offenseBrain`) | heuristic | Nearest free defensive lineman, with a 0.15 s retarget. Not a scheme assignment. |
| QB decision: read and throw choice | `passing.js:370` (`readOptions`), `:430` (`qbDecision`) | heuristic, **ground truth** | Utility is a weighted sum with hand-set constants (for example `1.6`, `0.75`, `0.55`). Thresholds `0.62` and `0.34`. Readiness times `0.35`, `0.55`, `1.05` s. Drop `0.75` s. Separation, lane and pressure use live defender and rusher positions. |
| Throw accuracy | `passing.js:399` (`launchPass`) | heuristic | Location error `sigma = 0.28 + 0.026 * distance + pressure term + accuracy term`, all hand-set. |
| Defensive coverage | `passing.js:766` (`defenseBrain`), `cover_1` and `cover_3` branches | heuristic, **ground truth** | Pursuit delay `0.34 - PUR * 0.0026`, bounded. Pursuit uses the live carrier position. |
| Defensive reaction to the ball | `passing.js` (`break on the thrown ball`) | heuristic, **ground truth** | Uses the live ball landing spot. |
| Pass-side reaction delay | none | **placeholder** | The pass executor has a drop time and receiver readiness, but no perception or recognition delay. |
| Run-side reaction delay | `engine/autonomous-run.js:505`, `:673` to `:680` | heuristic | `runReadDelay = baseDelay + (68 - recognition) * 0.003`, triggered by a visible run cue. This is the only cue-based delay in the code. |
| Perception filter | `passing.js:296` (`const visible = ...`) | **dead** | Defined and never called. Team membership only; no occlusion or information limit. |
| Outcome guard | `engine/autonomous/schema.js:12` (`PROHIBITED_FIELDS`), `:47` (`assertNoOutcomeFields`) | implemented | Blocks outcome, tracking, and history fields from autonomous inputs. |
| Historical play director | `engine/play.js` (header lines 1 to 12) | **replay, not predictive** | Sets intent from the real play-by-play, including the result. Outcome-constrained by design. Its outputs are not movement evidence. |

## Measurement harnesses and existing results

### Harnesses

- `engine/tracking-eval.js` (`scoreAutonomousTracking`, line 47). Outcome-blind scoring after the simulation. It reports
  xy error at 0.5 s and 1.0 s, by team and role. Its baseline is **constant velocity from origin velocity only**. It has no
  constant-acceleration baseline, no paired confidence intervals, no 2.0 s horizon, and no separation, route-timing or
  reaction measures. Its leakage guard (line 104) is correct: observed rows are read after simulation only.
- `scripts/evaluate-autonomous-bdb.mjs`. A snap-only, 22-player benchmark on the 2022 weeks 1 to 5 inside-zone cohort.
  The PFF run fields select the subset only, and the simulator input is built separately.

### Existing results (development, 2022 weeks 1 to 5)

From `docs/evidence/autonomous-acceptance/bdb53-tracking-comparison.json` and `bdb53-tracking-perimeter-fix.json`.

| horizon | model (mean xy error) | constant-velocity baseline | model minus baseline | notes |
|---|---:|---:|---:|---|
| 0.5 s, after perimeter patch | 0.815 m (1,144 player samples) | 0.266 m | +0.549 m | Model worse than the baseline in 27 of 28 team-and-role groups. The exception is D.NT (-0.092 m). |
| 1.0 s, before perimeter patch | 2.388 m (53 plays) | 0.992 m | | From `movement_fix_comparison.paired_1_0s`. Same 53 simulated inside-zone plays. |
| 1.0 s, after perimeter patch | 2.189 m (1,144 player samples) | 0.992 m | +1.197 m | Worse than the baseline in 26 of 28 groups. D.NT (-0.189 m) and D.RDE (-0.038 m) are better. |

Paired on the 53 plays at 1.0 s, the patch improved 47, worsened 5, and left 1 unchanged. Mean error fell by 0.199 m.

The perimeter patch was a development change made on the same weeks, so these numbers are development evidence only.

### Reconciliation needed

`docs/research/MOVEMENT-POLICY-MATERIALITY-DECISION-2026-10-24.md` says the current controller adds about 3.7 mm at one
second over a constant-acceleration predictor, and that about 97% of the benefit comes from the predictor. I did not
reproduce that figure. The related 2026-10-24 observed-movement review tests a different arm (acceleration extrapolation
through the pinned legacy `Player.locomote()` on observed tackle plays, without teammates or pursuit). The two results are
not on the same harness, so they cannot be compared directly. The two claims must be reconciled before either is used as a benchmark. Until then the
inside-zone result (controller worse than constant velocity) is the only measured comparison of the autonomous controller
against a baseline on this data.

## What the audit means for Part B

1. **Movement behavior is partly implemented and partly placeholder.** The physics is real. Pre-snap motion and any
   perception or information limit are not modelled.
2. **The QB decision is a heuristic on live truth.** It cannot be read as a learned or observed decision policy. Any
   claim that a QB decision matches observed behavior is outside what the code can show.
3. **Observed movement cannot establish a QB audible or a read.** The audit found no code path that infers pre-snap
   intent from tracking, and none is proposed here.
4. **The only controller comparison on record is unfavourable** against constant velocity and has not been reproduced
   against constant acceleration on the same plays.
5. **The historical play director is not a movement model.** It may be used for play-level replay, but its trajectories
   must not be scored as predictions.

## What was not audited

- Contact resolution and the pass-rush and tackle functions were checked only at their boundaries.
- The run executor (`autonomous-run.js`, about 900 lines) was checked only for the reaction-delay path.
- The test suite (`test/autonomous-*.mjs`) was not run in this audit.
- The `M4c` Rapier and Jolt physics paths and the `legacy` branch were not reviewed; the 2026-10-24 review documents them
  separately.
