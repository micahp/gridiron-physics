# Observed football movement — coordinated benchmark review (2026-10-24)

**Decision:** Accept as a reproducible **conditional movement baseline**; do **not** claim open-loop from-snap play prediction, tackle-success prediction, calibrated player physics, or a general solver improvement. Move to an information-fair, snap-anchored **all-player movement benchmark**, and only then selective observed tackle/contact work. No production or solver adoption.

## Pinned sources and verification

- [Gridiron observed-tackle movement report](https://github.com/micahp/gridiron-physics/blob/b4ba357db66fa21222cd31a3b9cf7a70a5ce6956/research/physics-3d-evaluation/m4b/m4d/football-tracking-feasibility/results/observed-tackle-movement-2026-10-24/report.md), branch `research/m4d-str-contact-diagnosis`, remote `b4ba357db66fa21222cd31a3b9cf7a70a5ce6956`; source engine `a09329185451faad44ef7453c7c47bea9d7253a4`, analysis checkout `357014ea008b12c8e0f5057f6f52606b3f2fa1f2`.
- [LP tackler identity/label audit](https://github.com/micahp/legendarypicks/blob/c780bcc6f0e5faf4818e4ea9aba82a5f3c5cc9cc/docs/research/BDB2025-TACKLER-AUDIT-2026-10-24.md), branch `research/nfl-tracking-feasibility-2026-10-23` at `c780bcc6f0e5faf4818e4ea9aba82a5f3c5cc9cc`; [49-row cohort manifest](https://github.com/micahp/legendarypicks/blob/c780bcc6f0e5faf4818e4ea9aba82a5f3c5cc9cc/docs/research/bdb2025-observed-tackle-manifest-v1.csv), SHA-256 `3c16d3814847170edfc35ba3ca098ff3c82bbc5f8b36b22c05639780d6b41353`.
- Both research branch remote heads have been independently compared against those commits and found identical. The review inspected report, manifest, movement runner and the pinned legacy `Player.locomote()` implementation; **the actual 10 Hz raw tracking CSVs and simulation were not independently rerun by this coordinator**.
- Dataset is an unofficial mirror of **2022 season** tracking from the 2025 Big Data Bowl, **not** 2025-game tracking. Rights remain user-reported, not independently certified. Bulk tracking is staged outside Git. All **nine weeks** were profile-audited by LP; weeks **6–9** were **not sampled for this model comparison** and remain reserved for later confirmation rather than described as never inspected.

## LP observed labels and cohort

- Nine-week profile: **16,124** tracked plays, **10,046** exact frame-level `tackle` event plays; **10,000** with tackle event and solo/assist credit. Remaining: **46** event-only, **2,242** credit-only.
- Tracking `tackle` is a *broadcast frame event* on 22 players and football; `nflId` on such a row does not identify a tackler. `player_play.csv` assigns solo/assist credit. *Credited tackler* is not guaranteed initial contact maker. No official missed-tackle field.
- For the **9,813** single-carrier, event-plus-credit plays, all **13,127** credited-defender ID rows have a track at the tackle frame. Median credited-defender distance from carrier **0.76 m**, 3.4% exceed 3 m, 0.72% exceed 5 m; on **3,450** plays the closest defender is not a credited tackler. Out-of-bounds or sack events explain many, **not all**, credit-only plays; **92** remain unexplained, as do **46** event-only plays. Differences between `tackleAssist` and `assistedTackle` are undocumented in the mirror.
- Frozen LP 49-row manifest includes **9** week-1 exploratory entries (**5 included visualizations + 4 excluded ambiguous examples**) and **40** included weeks-2–5 development plays from 33 games. The Gridiron movement report correctly scores only the 40 development plays and displays the 5 included exploratory cases. Those counts do not conflict.

## What was actually tested

- Both arms start at **eventFrame − 5** (0.5 s before a *known future tackle event*) using observed carrier/defender positions and preceding tracking-derived velocities. For multi-credited-defender plays, the focal defender is selected as the **nearest ultimately credited tackler at the tackle frame**. Thus both the play inclusion, forecast origin and sometimes actor selection depend on future outcomes. **This is a conditional, hindsight-defined diagnostic** even though numerical acceleration inputs use only samples at/before the origin.
- Six points at 10 Hz, at offsets 0.0–0.5 s, are evaluated. The **constant velocity** arm holds origin velocity. The **existing locomotion response** arm gets an additional past-derived acceleration proposal (linear slope of five velocity observations from the 0.5 s before origin) and passes a velocity target through pinned legacy **2D `Player.locomote()`** for 60 steps of 1/120 s, without teammates, pursuit, collisions, ball dynamics or M4c Rapier/Jolt. It therefore tests **acceleration extrapolation plus locomotion limits**, not the isolated value of physics and not an NFL decision model.
- Locomotion generic references: top speed 9 m/s, propulsive force 1100 N, lateral acceleration 6.5 m/s², common global friction `MU`, weights from 2022 metadata; these are **not empirically fitted player abilities**.

## 40-development-play descriptive results

| Median per-play statistic | Constant velocity | Acceleration + legacy locomotion |
| --- | ---: | ---: |
| Carrier XY position RMSE | 0.218 m | 0.212 m |
| Defender XY position RMSE | 0.215 m | 0.180 m |
| Carrier–defender separation RMSE | **0.170 m** | **0.141 m** |
| Signed separation error at known tackle event | **+0.245 m** | **+0.133 m** |

- Separation RMSE decreases ~**17.0%** as a *ratio of reported per-play medians*. Carrier improvement is small. There is no holdout estimate or uncertainty quantification here; these medians cannot establish future-sample model lift.
- Signed event errors are not absolute error measures; report event **MAE, median absolute error, RMSE, and paired per-play improvement share**, not just signed medians.
- The reported **0.000 m median error of minimum separation and its timing** may be dominated by the exactly matched starting separation, because the 0.0-second origin is included in the minima. This is not evidence of accurate tackle distance/timing; recompute end-of-horizon and minimum separation **excluding the anchored origin**, and quantify cases whose predicted minimum occurs at the origin.
- The locomotion arm has additional past-acceleration information; add an **unconstrained constant-acceleration predictor with the identical velocity-history input** and a constrained bounded-acceleration baseline to isolate whether `Player.locomote()` adds information beyond straightforward kinematic extrapolation.

## Required next coordinated experiment (one new preregistration, no generic physics project)

**LP tracking owner:** Keep 49-play manifest immutable. Produce a **separate snap-anchored benchmark manifest**, selecting games/plays/players based on metadata, tracking presence, roles and *snap-available inputs only*. Do not select the focal defender using eventual tackle credit or nearest-at-tackle geometry. Include all 22 tracked players and football **as observable labels**, but do not feed any post-snap positions or outcomes to prospective predictors. Specify source frame rate/coordinate orientation, alignment, ball policy, and as-of eligibility. Register small early-snap 0.5 s and 1.0 s horizons, later 2.0 s if data supports; preserve 2022 weeks 6–9 for held-out assessment. Establish whether a contextual formation/assignment/play-call baseline has legally observable inputs.

**Gridiron movement owner:** Add **constant acceleration** (same pre-origin velocity history) and **bounded-acceleration** baselines to the existing event-centered diagnostic, with paired per-play absolute metrics and origin-excluded minima. Then move the **unchanged existing movement controller** to the snap-anchored cohort **without adding tackle labels as input**. Evaluate all players, spacing, pursuit-nearest defender chosen **at prediction origin**, speed/turn constraints, group coherence and how error grows across horizon. Reuse Three.js/current visualization. Do **not** convert this into a new Rapier/Jolt collision-sensitivity project until a scored observed-play error demands it.

**LP game/drive owner:** Keep the statistical PBP sequence baseline separate. Extract actual play endpoints from the same games and define future play-outcome and drive metrics only where available; no claim that this 0.5s conditional movement test improves yards gained, scoring or forecasts.

**Integrator:** Freeze model/data hashes, fair input budgets, all failures, per-play paired statistics, and explicit **no hindsight for free-snap experiments**. Compare simple statistical/kinematic baselines before higher-complexity models and check a later-held-out cohort only after model choice is frozen.

**Research guardrails:** No updates to prod LP locks/picks/grading, Gridiron main solver, or Madden-to-force mappings; no broad synthetic M4d sweep, no automatic branch merges. Existing contact-penetration and far-wrap defects remain documented but do not dominate the next sprint unless blocking the real-play benchmark.
