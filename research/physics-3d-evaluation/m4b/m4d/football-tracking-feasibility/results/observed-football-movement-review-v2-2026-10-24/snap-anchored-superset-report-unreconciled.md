> Archived before per-play cohort reconciliation. This 9,388-play report is not the canonical movement benchmark. See `report.md` and the LP canonical report pinned there.

# Observed football movement review: fair baselines and snap cohort

**Decision:** Movement results are descriptive trajectory evidence. They do not establish better tackle probabilities, yards, scoring, play outcomes, drive results, or game forecasts. No movement policy or production solver is adopted here.

## A. Event-centered 40-play diagnostic

This preserves the 40-play development population and the previous exploratory artifacts. The frozen 49-row LP manifest was read-only and its published hash was checked before scoring. Forecast origin remains tackle-event frame − 5, and multi-credit focal defender identity remains the nearest eventually credited defender at the event; this is a hindsight-defined conditional diagnostic.

All four arms receive the same six positions ending at the prediction origin. Velocity and acceleration are derived from those same five 10 Hz intervals. Constant velocity ignores the acceleration estimate; constant acceleration extrapolates it; bounded acceleration clips its magnitude to the smaller of 6.5 m/s² and 1100 N / listed mass; the existing `Player.locomote()` controller receives the same acceleration proposal with its original 0.12 s response and pinned source code. Scoring uses only future samples 0.1–0.5 s; the exactly anchored origin is excluded from position and separation errors.

| Model | Position MAE (m), mean / median | Separation MAE (m), mean / median | Event separation MAE (m), mean / median | Origin was full-window predicted min | Origin-excluded min error (m), median |
| --- | ---: | ---: | ---: | ---: | ---: |
| Constant velocity | 0.204 / 0.207 | 0.177 / 0.161 | 0.354 / 0.267 | 24/40 (60.0%) | 0.054 |
| Constant acceleration | 0.178 / 0.172 | 0.140 / 0.125 | 0.302 / 0.275 | 19/40 (47.5%) | 0.044 |
| Bounded acceleration | 0.178 / 0.172 | 0.144 / 0.125 | 0.309 / 0.278 | 19/40 (47.5%) | 0.044 |
| Existing locomotion controller | 0.178 / 0.172 | 0.141 / 0.128 | 0.303 / 0.277 | 19/40 (47.5%) | 0.044 |

Paired per-play differences versus constant velocity (negative is lower error):

| Model vs constant velocity | Position MAE: mean paired Δ / improved plays | Separation MAE: mean paired Δ / improved plays | Event separation MAE: mean paired Δ / improved plays |
| --- | ---: | ---: | ---: |
| Constant acceleration | -0.026 m / 60.0% | -0.037 m / 60.0% | -0.052 m / 50.0% |
| Bounded acceleration | -0.027 m / 60.0% | -0.033 m / 57.5% | -0.044 m / 47.5% |
| Existing locomotion controller | -0.026 m / 62.5% | -0.036 m / 60.0% | -0.051 m / 52.5% |

Minimum separation and timing are recomputed only over 0.1–0.5 s. The last column above is the median absolute difference between predicted and observed minima on that origin-excluded window. The origin-minimum count reports how often including time zero would have selected the anchored starting separation. Event separation error is reported as absolute error; signed error is retained in the per-play CSV.

## B. Snap-anchored all-player cohort

The independent cohort contains **9,388 plays** from weeks 1–5: week 1: 1,938, week 2: 1,798, week 3: 1,946, week 4: 1,817, week 5: 1,889. Weeks 6–9 remain reserved and were not scanned by this run.

Eligibility uses a unique `ball_snap` frame, pre-snap play metadata, the 11/11 offense/defense split, and tracking-row presence for all 22 players and the football from snap−0.5 s through snap+1.0 s. Each prediction receives only each player's six positions from snap−0.5 s through the snap, plus listed roster mass for the controller. No future coordinates, football track, play outcomes, tackle frame, tackler credit, or drive outcomes enter the model request. The football is retained as an observable label; these four player-motion arms do not forecast it.

Constant acceleration and bounded acceleration use the same position-history-derived velocity and acceleration as the other arms. Bounded acceleration applies the fixed 6.5 m/s² / 1100 N-per-mass limit. The existing controller source and reference settings are unchanged. No parameters were fit on this cohort.

### 0.5 s

| Model | Position MAE (m) | Velocity vector MAE (m/s) | Spacing pair MAE (m) | Nearest defender distance MAE (m) | Nearest defender ID agreement | Team centroid displacement error (m) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Constant velocity | 0.239 | 0.896 | 0.185 | 0.218 | 93.1% | 0.115 |
| Constant acceleration | 0.207 | 0.782 | 0.165 | 0.191 | 93.6% | 0.096 |
| Bounded acceleration | 0.206 | 0.781 | 0.164 | 0.190 | 93.6% | 0.096 |
| Existing locomotion controller | 0.206 | 0.780 | 0.164 | 0.190 | 93.6% | 0.095 |

| Model vs constant velocity | Position MAE: mean paired Δ / improved plays | Spacing MAE: mean paired Δ / improved plays | Velocity error: mean paired Δ / improved plays | Team centroid error: mean paired Δ / improved plays |
| --- | ---: | ---: | ---: | ---: |
| constantAcceleration | -0.032 m / 90.1% | -0.020 m / 82.0% | -0.114 m/s / 88.5% | -0.019 m / 82.9% |
| boundedAcceleration | -0.033 m / 90.2% | -0.020 m / 82.2% | -0.115 m/s / 88.7% | -0.020 m / 83.0% |
| locomotionController | -0.033 m / 90.1% | -0.021 m / 82.1% | -0.116 m/s / 88.9% | -0.020 m / 83.1% |

Mean speed above 9 m/s: constantVelocity 0.0%; constantAcceleration 0.0%; boundedAcceleration 0.0%; locomotionController 0.0%.
Mean predicted lateral acceleration above 6.5 m/s²: constantVelocity 0.0%; constantAcceleration 0.0%; boundedAcceleration 0.0%; locomotionController 0.0%.

### 1.0 s

| Model | Position MAE (m) | Velocity vector MAE (m/s) | Spacing pair MAE (m) | Nearest defender distance MAE (m) | Nearest defender ID agreement | Team centroid displacement error (m) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Constant velocity | 1.030 | 2.054 | 0.746 | 0.738 | 76.3% | 0.456 |
| Constant acceleration | 0.919 | 1.897 | 0.699 | 0.668 | 77.4% | 0.396 |
| Bounded acceleration | 0.917 | 1.894 | 0.697 | 0.667 | 77.4% | 0.395 |
| Existing locomotion controller | 0.915 | 1.887 | 0.694 | 0.666 | 77.4% | 0.394 |

| Model vs constant velocity | Position MAE: mean paired Δ / improved plays | Spacing MAE: mean paired Δ / improved plays | Velocity error: mean paired Δ / improved plays | Team centroid error: mean paired Δ / improved plays |
| --- | ---: | ---: | ---: | ---: |
| constantAcceleration | -0.111 m / 89.2% | -0.047 m / 74.6% | -0.157 m/s / 82.9% | -0.060 m / 75.0% |
| boundedAcceleration | -0.112 m / 89.3% | -0.049 m / 74.7% | -0.160 m/s / 83.1% | -0.061 m / 75.1% |
| locomotionController | -0.115 m / 89.7% | -0.052 m / 75.2% | -0.167 m/s / 84.5% | -0.062 m / 75.5% |

Mean speed above 9 m/s: constantVelocity 0.0%; constantAcceleration 0.3%; boundedAcceleration 0.3%; locomotionController 0.0%.
Mean predicted lateral acceleration above 6.5 m/s²: constantVelocity 0.0%; constantAcceleration 0.0%; boundedAcceleration 0.0%; locomotionController 0.0%.


Spacing MAE averages absolute pair-distance error over all 55 within-offense and 55 within-defense pairs per play. The frozen snap-nearest relationship is defined from positions at the prediction origin; its paired distance error is retained in the metrics JSON. Nearest-defender ID agreement compares each offense player's predicted nearest defender at the horizon with the observed nearest defender. Team movement uses offense and defense centroid displacement and centroid velocity errors. The metrics JSON and per-play CSV also report speed changes, turn-angle error, inter-team centroid separation, speed-cap exceedance, and lateral-acceleration exceedance.

## Outcome boundary and decision

Play outcomes and drive outcomes are separate evaluation targets and were not scored here. This movement-only comparison cannot establish a change in tackle probability, yards gained, scoring, drive success, or game forecasts. A future sequence evaluation must use its own outcome labels, prediction origin, inputs, and scoring unit; play-level and drive-level results must remain separate.

No more sophisticated movement policy is justified for adoption by these descriptive development results alone. Keep the four arms as research baselines, preserve weeks 6–9 for the later held-out comparison, and make no production, solver, or Madden-calibration change. Any future complexity decision should be based on paired gains at the snap horizon in the reserved weeks, together with the movement metrics relevant to its intended use.

## Files and provenance

- `event-centered-per-play.csv`: paired 40-play errors for all four models.
- `event-centered-summary.json`: paired aggregates and origin-excluded minimum-separation statistics.
- `snap-anchored-per-play.csv`: per-play, per-model metrics at 0.5 and 1.0 s.
- `snap-anchored-summary.json`: aggregate metrics and paired comparisons against constant velocity.

- M4d analysis checkout at run: `b4ba357db66fa21222cd31a3b9cf7a70a5ce6956`.
- LP tracking checkout at run: `c780bcc6f0e5faf4818e4ea9aba82a5f3c5cc9cc`.
- Locomotion source commit: `a09329185451faad44ef7453c7c47bea9d7253a4`; `world.js` SHA-256 `bc82736164fcd06fffd379efea5b71f6a1373b3dadeb27fe5fa3c1be0f9c0dac`.
- Existing 49-row tackle manifest SHA-256: `3c16d3814847170edfc35ba3ca098ff3c82bbc5f8b36b22c05639780d6b41353` (unchanged).
- Reused prior 40-play observation file SHA-256: `731de8c6ec29a1631cb134399d3f5f31c3d6327d940f1c893b2765595ea0ffd7`.
- Snap manifest SHA-256: `5d4abe0b6584c4ce0be6dc23ade410e13a4a63a9ab8282de05383d8403fd5193`; cohort builder summary SHA-256 `42ddd126faf132fe9884aed7d462802d809053fb469ca38b8b2c2dc92299c642`.
- Snap cohort builder SHA-256: `bfe8a5cea5bbc4cd993f1aace58f3ee271cc51933edf263875de7162ad801fd1`.
- Movement runner SHA-256: `6e59e849909c6df31fe31872e6f974b1a0a07cf49f5982d5c5ad08985bdb1239`; analysis script SHA-256 `605677936b141eb142e8b1a51dcf048787b83b5ddc6396ed1a57bd9edddd5f8c`.
- Tracking source: unofficial mirror of the 2022 season data distributed for Big Data Bowl 2025; staged input hashes are recorded in the LP cohort summary. Rights remain user-reported, not independently certified.
