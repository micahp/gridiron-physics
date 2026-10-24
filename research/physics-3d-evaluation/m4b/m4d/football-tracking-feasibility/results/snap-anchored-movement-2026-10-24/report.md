# Snap-anchored, all-22-player movement benchmark (weeks 1–5)

**Status:** descriptive, paired, no fitting, no holdout. Weeks 6–9 were not read. Movement accuracy only: this does not
establish tackle prediction, yards, scoring, or game forecasts.

## Effect size first

Mean of per-play differences A − B over **9,289 eligible plays in 80 games**. Intervals resample **games**, not
plays. Units are millimetres of mean per-player error.

| Comparison (A − B) | 0.5 s position | 1.0 s position |
| --- | ---: | ---: |
| Constant acceleration − constant velocity | **−32.8 mm** [−35.4, −30.1] | **−113.2 mm** [−121.9, −104.6] |
| Locomotion − constant velocity | −33.5 mm [−36.1, −30.9] | −116.9 mm [−125.2, −108.5] |
| **Locomotion − constant acceleration** | **−0.74 mm** [−1.13, −0.51] | **−3.72 mm** [−5.10, −2.71] |
| Locomotion − bounded acceleration | −0.43 mm [−0.49, −0.37] | −2.42 mm [−2.69, −2.17] |

Acceleration extrapolation accounts for about **97.8%** of the locomotion arm's gain over constant velocity at 0.5 s
and **96.8%** at 1.0 s. The existing controller adds a small, consistent improvement on top: about **0.4%** of the
1.0 s position error (3.7 mm of 0.92 m). Locomotion − constant acceleration is negative in all five weeks at both
horizons. Its effect on nearest-defender pair distance is −5.0 mm (game-clustered CI [−6.4, −3.8]) and on velocity is
−9 mm/s against 1.91 m/s (CI [−11.8, −7.1]).

## Literal preregistered decision

`decisionRule.moreSophisticatedPolicyJustified = true` in `summary.json`. The rule requires that the locomotion arm beat
each kinematic arm on position (M1), with a 95% interval below zero and the sign negative in every week, and that M4
and M5 pass too. **Under the game-clustered interval the same result holds** (`game_clustered_check.json`).

**The rule has no materiality floor.** It did not say how large the improvement has to be, so a 3.7 mm gain over a
0.92 m error passes it. Read literally the rule is met. On effect size, the controller's contribution over the simplest
adequate kinematic baseline is negligible. That judgement is post hoc and is recorded as such. A materiality threshold
should be preregistered before any held-out check of weeks 6–9.

## All-player metrics (median / mean per play, metres unless stated)

| Metric | Constant velocity | Constant acceleration | Bounded (6.5 m/s²) | Locomotion |
| --- | ---: | ---: | ---: | ---: |
| Position error, 0.5 s (all 22) | 0.237 / 0.240 | 0.206 / 0.208 | 0.206 / 0.207 | 0.206 / 0.207 |
| Position error, 1.0 s (all 22) | 1.033 / 1.038 | 0.923 / 0.924 | 0.923 / 0.923 | 0.921 / 0.921 |
| Offense position error, 1.0 s | 1.137 / 1.142 | 1.008 / 1.010 | 1.008 / 1.009 | 1.005 / 1.005 |
| Defense position error, 1.0 s | 0.925 / 0.933 | 0.831 / 0.839 | 0.831 / 0.837 | 0.830 / 0.836 |
| Team centroid error, 1.0 s | 0.385 / 0.460 | 0.342 / 0.398 | 0.342 / 0.397 | 0.341 / 0.396 |
| All-pair spacing error, 1.0 s | 0.246 / 0.271 | 0.214 / 0.239 | 0.214 / 0.237 | 0.213 / 0.236 |
| Offense spacing error, 1.0 s | 0.275 / 0.312 | 0.259 / 0.291 | 0.259 / 0.290 | 0.258 / 0.288 |
| Defense spacing error, 1.0 s | 0.346 / 0.386 | 0.290 / 0.328 | 0.290 / 0.325 | 0.289 / 0.324 |
| Nearest-defender pair distance error, 1.0 s | 0.703 / 0.720 | 0.666 / 0.689 | 0.666 / 0.688 | 0.663 / 0.684 |
| Nearest-defender identity agreement, 1.0 s (share) | 0.727 / 0.763 | 0.818 / 0.775 | 0.818 / 0.775 | 0.818 / 0.775 |
| Velocity error, 1.0 s (m/s) | 2.090 / 2.071 | 1.917 / 1.910 | 1.917 / 1.907 | 1.912 / 1.901 |
| Speed error, 1.0 s (m/s) | 1.964 / 1.944 | 1.611 / 1.606 | 1.610 / 1.604 | 1.600 / 1.596 |
| Minimum-separation error, origin excluded, 1.0 s | 0.533 / 0.538 | 0.455 / 0.463 | 0.455 / 0.463 | 0.455 / 0.463 |
| Minimum at the horizon end (share), 1.0 s | 0.818 / 0.827 | 0.818 / 0.791 | 0.818 / 0.791 | 0.818 / 0.791 |

Position error grows smoothly across the horizon. Median per-player error at 0.1, 0.5 and 1.0 s is 0.016, 0.237 and
1.033 m for constant velocity, and 0.015, 0.206 and 0.923 m for constant acceleration. The locomotion arm tracks
constant acceleration at every step (`summary.json`, `growthMedianPos_by_frame`).

**Nearest-defender identity.** Persistence of the origin-nearest defender as the nearest one (observed) is 0.898 at
0.5 s and 0.720 at 1.0 s. Both acceleration arms predict the observed nearest defender more often than constant velocity
does at 1.0 s (median share 0.818 vs 0.727).

**Minimum separation.** The minimum is over (0, H], so the origin cannot match trivially. The minimum falls at the
horizon end in about 82% of pairs, so the minimum-separation metric is largely a closing-rate measure. It is reported
for completeness but is not a timing test.

**Position error by position group, 1.0 s (median m, locomotion arm).** Wide receivers 1.31, tight ends 1.15, running
backs 1.03, cornerbacks 0.54, free safeties 0.56, strong safeties 0.55. Defensive ends 1.13 and offensive tackles 0.91.
Errors are small for defensive backs and large for receivers; this descriptive split was not tested against anything.

**Ball (label only).** Median displacement of the football over 1.0 s after the snap is 4.05 m across 9,289 plays. The ball
was not predicted and is not part of any arm.

## Reading the result

1. **The gain over constant velocity comes from acceleration extrapolation.** Constant acceleration, which uses the same
   five pre-snap velocity samples and no physics, carries about 97% of the locomotion arm's gain at both horizons.
2. **The locomotion controller adds a consistent but negligible improvement** on top of constant acceleration: 0.7 mm at
   0.5 s and 3.7 mm at 1.0 s. The game-clustered interval excludes zero, so the effect is real at this sample size, but
   the magnitude is about 0.4% of the 1.0 s error.
3. **Bounded acceleration is equivalent to unbounded here** because the 6.5 m/s² bound rarely binds in these plays.
4. **The sample is not a validation.** Weeks 1–5 were used for description and for the preregistered comparison. Weeks 6–9
   remain untouched for a later held-out check, which should use a materiality threshold preregistered in advance.

## Method and provenance

- Cohort: `docs/research/bdb2025-snap-anchored-cohort-v1.csv` in the LP repo (branch `research/nfl-snap-anchored-benchmark-2026-10-24`).
  Origin is the `ball_snap` frame, cross-checked against `SNAP`. Inputs are frames ≤ origin, and scoring is at origin + 5 and
  origin + 10 frames. Preregistration: `docs/research/BDB2025-SNAP-ANCHORED-BENCHMARK-PREREG-2026-10-24.md`.
- Arms receive identical snap-available inputs. Locomotion is the unchanged pinned `Player.locomote()`, with the horizon
  taken from the request. Its 0.5 s output reproduces the earlier run exactly (max abs difference 0.0 m).
- `summary.json` (arm statistics, paired intervals, decision block, provenance hashes), `per_play.csv` (9,289 plays × 4 arms),
  `game_clustered_check.json` (game-clustered re-check; computed by `cluster_decision_check.py`).
- Limits: a 2022-season mirror of 2025 Big Data Bowl tracking with user-reported rights; 10 Hz tracking; no pursuit, collision
  or ball model; the bootstrap describes variation across these 80 games only, not a holdout.
