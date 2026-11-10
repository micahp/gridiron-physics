# Part B historical development results — 2026-10-28

Status: historical development is active. Gate 1 reproduction and the revised Gate 3 rerun are complete; tracking coverage
and frozen-baseline evaluation are complete. This is not final acceptance. The independent 2025/2026 movement validation
gate is **unavailable** and remains pending. Nothing here promotes a model, changes simulator defaults, changes production,
or runs a full game.

## Holdout-integrity note

Earlier in this session, a broad text search surfaced excerpts from unrelated overtime evidence CSVs, and the supplied
mixed-season rev3 build report was opened before I noticed it contained 2026 aggregates. I did not use or repeat those
values. Subsequent analysis used only the explicitly approved 2022 weeks 1–5, 2023 train weeks 1–7, and historical 2022–25
source files described below. Because 2026 aggregates were exposed earlier in the session, I cannot certify that the
2026 holdout remained sealed for the entire session. No further 2026 data, tracking, simulation output, or split was
accessed.

## Gate 1: NE-2025 and CHI-2025 legacy reproduction

I rebuilt the 2025-only canonical outputs through the current `build_playbooks.build_2025()` path and wrote them to an
isolated temporary directory. This preserves the supplied output files; the reproduction wrapper's fixed output path was
not used. The canonical output bytes exactly match the previously recorded 2025-only baselines for both teams.

| Team | Bytes compared | Rebuilt SHA-256 | Result |
|---|---:|---|---|
| NE | 6,654,008 | `908084b4f46b502b52b573fab8ad1a9e753d70c9b0b2abc4a7bb509e7b48857c` | Exact match |
| CHI | 7,143,594 | `5209dd85c8bddafb3b187080b2a3cf5c8602130b26b4441ebbf5c67599bdbebf` | Exact match |

Inputs and source hashes: 2025 PBP `2f135887790a013fd004e609e37096bb4816d5cc80b9f19122e1bad478961978`,
2025 participation `59069adfee7b0f464befba8a5e8be331e523633cc6a7ab403d37bcbcdfbe66ac`, and current builder
`43d3b371c1fa6464fee81561fe3a036e2a8c8af82e6b7b1fbb95130c4e1f2634`. The original source fields and team-season files
were not edited. The machine-readable reproduction record is
[`gate1_report.json`](../../data/playbooks/research-2026-10-28-gate1-reproduction/gate1_report.json); the reproduction
entry point is [`reproduce_legacy_2025.py`](../../pipeline/reproduce_legacy_2025.py).

## Gate 3: revised shotgun reconciliation

The 2022–2024 rerun keeps PBP, FTN, participation, and the hierarchy result distinct. Of 190 regulation-down plays where
PBP and participation disagree, FTN agrees with participation on 184 and with PBP on 6; none is missing FTN or has all
three values different. The 82 two-point rows without regulation downs are reported separately. The 272 source rows
preserve raw `pbp_shotgun`, raw `ftn_qb_location` plus its mapped value, and raw participation formation plus its mapped
value; no source fields were changed.

The old 1.0 percentage-point gate still has 16 failures. Revised R2 passes all 96 team-seasons; revised R1 still fails in
15 2022 team-seasons, while all 2023 and 2024 team-seasons pass R1. The 564 row-level unresolved/fallback records remain
visible. 2024 TB remains open: PBP is 686/1,081 (63.4598%), participation is 698/1,081 (64.5698%), FTN is 648/1,025
(63.2195%) shotgun among known `S`/`P`/`U` values, and the hierarchy is 699/1,084 (64.4834%). FTN sides with
participation on 14 of TB's 16 PBP/participation disagreements and is missing on 2; the three PBP-only fallbacks are
listed. TB passes R1 and R2 but is not treated as explained or closed.

See the full [Gate 3 results report](GATE-3-SHOTGUN-RECONCILIATION-RESULTS-2026-10-28.md), the frozen [revised rule](GATE-3-SHOTGUN-RECONCILIATION-REVISED-2026-10-28.md), and the copied
[current rerun files](../../data/playbooks/research-2026-10-28-gate3-current-rerun/).

## Existing movement and QB code audit

The audit is against local `/root/gridiron-physics` commit `c576384` on `main`; that checkout is 11 commits behind its
configured remote. I did not fetch or update it, so these findings describe the local snapshot only.

| Component | Already implemented | Missing or limited |
|---|---|---|
| Trajectories and movement | `simulateInsideZone()` and `simulatePassPlay()` produce player trajectories, decision events, and physical outcomes. `World.step()` advances player movement, contacts, ball flight, and collisions. | Initial formations are synthetic. Archetype speeds, forces, masses, turn limits, and ratings are authored values, not estimated from these tracking cohorts. |
| Blocking | Run blockers make live target assignments; the runner scores lanes against current defenders. Pass protection reselects a target during play. | Assignments are rule-based and limited to the small declared play menu; they are not learned blocking assignments or route-specific historical labels. |
| Routes | The pass executor advances a fixed slant, flat, backside clear-out, and checkdown from live simulated positions. | Only `slant_flat` is accepted, with `cover_1` and `cover_3`; route library and progression are hard-coded, not a general route tree fitted to assignments. |
| QB decisions | `readOptions()` scores simulated receivers by separation, throwing-lane risk, pressure, readiness, and distance; the QB can hold, throw, or respond to pressure. | The QB reads full simulator `World` positions and ball state. There is no separate perception/observation object, uncertainty, occlusion, or information-delay boundary. |
| Defensive response | Run defenders have ratings-based recognition delays and live pursuit; pass defenders follow man/zone rules and can break toward the simulated landing point. | Reactions and assignment rules are authored; they are not calibrated to observed coverage-player response or release timing. |
| Physics and outcomes | `Player.locomote()` limits acceleration, speed, lateral force, and turning; `World` resolves engagements, shedding, collisions, wraps, tackles, and ball flight. Outcomes emerge from the simulated contacts and actions. | The mechanics are not empirically calibrated by player role or position from the audited data. Physical richness alone is not evidence of forecast skill. |
| Tracking evaluator | `scoreAutonomousTracking()` evaluates observed rows after a completed simulation and rejects extra fields, preserving an evaluation-only boundary. It includes a constant-velocity baseline. | It accepts only the inside-zone result schema, not the pass result schema; it lacks a constant-acceleration comparison, game-clustered intervals, and direct 2023 target-track identity mapping. |
| Historical play director | `engine/play.js` has broader route and blocking logic for film/history playback. | It uses known play outcomes, target, gain, and result-specific setup. It is not an autonomous predictor or a valid movement-policy evaluation path. |

Relevant source: [run controller](</root/gridiron-physics/engine/autonomous-run.js:396>), [pass/QB controller](</root/gridiron-physics/engine/autonomous/passing.js:369>), [physics](</root/gridiron-physics/engine/world.js:91>), [tracking evaluator](</root/gridiron-physics/engine/tracking-eval.js:47>), [result adapter](</root/gridiron-physics/engine/autonomous/results.js:65>), and [historical outcome-specific playback](</root/gridiron-physics/engine/play.js:1041>).

The frozen decision-model v1 was read as source only and not executed. It estimates team-level decision distributions
from 2025, shrunk toward league priors by role/situation/alignment; it is not a player movement controller or a live QB
read policy. Its previously used 2026 test was not rerun. The model should remain separate from the physics agent until
the observation contract is explicit.

## Tracking measurements and baseline results

Detailed source coverage is in [PART-B-TRACKING-COVERAGE-2026-10-28.md](PART-B-TRACKING-COVERAGE-2026-10-28.md). The
2023 scoring protocol was frozen before any 2023 coordinate scoring; its SHA-256 is
`2a1031e96bc84ee095c10985ada2b61db3372fa85d40738bd78487049690a012`. The reproducible evaluator is
[`partb_movement_metrics.py`](../../pipeline/partb_movement_metrics.py), and all group-level metrics, cohort counts, and
data hashes are in [`movement_metrics.json`](../../data/playbooks/research-2026-10-28-partb-movement/movement_metrics.json).

Both analytic baselines fit the same last six positions: a least-squares constant-velocity line and a least-squares
constant-acceleration quadratic. Scores are within each dataset and use 0.5 s and 1.0 s horizons; 2022 snap-anchored and
2023 post-pass tasks are different cohorts and their absolute errors should not be compared as if they were the same
forecast problem. Intervals resample whole games (2,000 replicates, seed `20261028`).

| Dataset / group | Horizon | Tracks | CV mean endpoint / RMSE | CA mean endpoint / RMSE | Paired CA−CV mean, 95% game-bootstrap CI |
|---|---:|---:|---:|---:|---:|
| 2022 all players | 0.5 s | 206,536 | 0.301 / 0.371 m | 0.216 / 0.286 m | −0.085 m [−0.091, −0.080] |
| 2022 all players | 1.0 s | 206,536 | 1.138 / 1.301 m | 0.939 / 1.143 m | −0.199 m [−0.211, −0.185] |
| 2023 all target tracks | 0.5 s | 18,262 | 0.882 / 0.975 m | 0.332 / 0.379 m | −0.550 m [−0.558, −0.541] |
| 2023 all target tracks | 1.0 s | 10,951 | 2.393 / 2.647 m | 1.394 / 1.580 m | −0.999 m [−1.025, −0.972] |

The acceleration baseline lowers mean endpoint error for both 2023 target roles: at 0.5 s, defensive coverage is 0.874→
0.348 m and targeted receivers 0.899→0.295 m; at 1.0 s, coverage is 2.359→1.448 m and receivers 2.485→1.246 m. It
also improves position groups such as WR (0.988→0.309 m at 0.5 s; 2.669→1.291 m at 1.0 s) and CB (0.906→0.365 m;
2.483→1.519 m). This is a strong simple baseline result, not a measured improvement to the Gridiron Physics controller.

The 2022 results also improve in mean and aggregate RMSE, but the gain is not uniform: CB 0.5 s endpoint RMSE worsens
from 0.266 m under CV to 0.356 m under CA even while mean error falls. The role/position tables should therefore guide
the next calibration step; a single aggregate score would hide this failure mode.

Other supported movement findings:

- On the 2022 all-player cohort, the final 0.4 s before snap supports a pre-snap movement proxy. Using net displacement
  divided by 0.4 s for speed, and the published BDB motion rule of speed above 0.62 yd/s and displacement of at least
  1.2 yd, 1,722 of 103,268 offensive player-plays
  (1.67%) cross the threshold: WR 1,148/23,906 (4.80%), TE 222/12,148 (1.83%), RB 260/9,586 (2.71%), and FB 80/992
  (8.06%). This is a position-derived proxy, not a charted motion label. [BDB 2025 field definitions](https://www.kaggle.com/competitions/nfl-big-data-bowl-2025/data?select=games.csv)
- Actual post-pass target trajectories have measurable movement: in the 2023 first 0.5 s, mean path speed is 4.33 m/s
  overall (5.03 m/s for targeted receivers, 4.02 m/s for coverage players), with mean finite-difference acceleration
  3.72 m/s² overall. These are descriptive track statistics, not fitted player abilities.
- Origin-selected nearest coverage pairs show mean separation changing from 3.558 m to 3.490 m at 0.5 s (5,150 pairs);
  at 1.0 s it changes from 3.289 m to 3.382 m (2,874 pairs). Pair separation error is 0.475→0.268 m for CV→CA at
  0.5 s and 1.206→1.134 m at 1.0 s. Pair selection uses only input positions and stays fixed within each scored
  horizon.
- Route assignments are not present, so route-break or route-completion timing is not identified. The 2023 file has no
  snap timestamp, so it cannot identify pre-snap motion. It also lacks a synchronized pass-release timestamp and ball
  flight, so reaction delay to release is not identified. Those measures are explicitly left unreported.

The 2022 prepared observation hashes were independently rechecked; the underlying large raw tracking files were not
rehashed in this pass, so their source hashes are the values in the staged manifest. All fourteen 2023 train input/output
hashes were recomputed and matched the local manifest. The frozen 2023 protocol was not changed after scoring.

## Staged Part B implementation plan

1. **Keep the research benchmark fixed.** Continue with 2022 weeks 1–5 only and retain weeks 6–9 as reserved. Keep the
   frozen 2023 train protocol and use CV and CA as minimum comparators. Report role, position, and available situation
   groups with game-level intervals; inspect outlier groups such as 2022 CB before fitting more parameters.
2. **Calibrate movement on 2022 trajectories.** Estimate role-conditioned speed, acceleration, turn response, and
   pre-snap motion distributions from past-only inputs. Do not infer route names or defensive assignments absent labels.
   Fit only parameters the observed trajectories can identify; keep authored collision/blocking mechanics separate from
   fitted movement terms.
3. **Build an explicit observation boundary before changing QB behavior.** Give the QB a time-stamped observation view
   built from information available at that simulation instant. Keep `World` positions, future tracking labels, and
   physical ground truth inaccessible through the QB interface. Test the boundary with synthetic fixtures before any
   controller integration.
4. **Add a research-only movement adapter.** Extend evaluation to both run and pass result schemas and actual player
   identities; score observed trajectories after simulation only. Add the frozen CV/CA comparators and game-clustered
   summaries. Do not change production defaults or the current autonomous controller.
5. **Freeze a 2022-developed candidate, then validate once on the frozen 2023 cohort.** Compare on identical eligible
   tracks, by role/position and origin-selected separation pairs. No 2023 tuning or hard-coded behavior to match aggregate
   outcomes. Independent 2025/2026 movement acceptance remains unavailable and pending; Part B is neither blocked nor
   closed.

## Scope of changes

Only research documentation, one historical metric script, and read-only result artifacts were added in
`gridiron-playbooks-research`. The `gridiron-physics` production tree and simulator defaults were not changed. No 2026
holdout was used for the reported metrics; the session-integrity limitation above prevents certifying a sealed-session
claim.
