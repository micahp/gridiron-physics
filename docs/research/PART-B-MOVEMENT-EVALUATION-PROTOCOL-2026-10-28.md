# Part B movement evaluation protocol (frozen before any validation run)

Status: frozen by the commit that adds this file. Any change after that commit is an amendment, recorded in the amendment
log at the end, and any cohort whose outcomes informed the change is reclassified as development data. No validation
result exists when this protocol is written.

Scope: historical development only. This protocol does not promote any model, does not change any simulator default, and
does not use any 2026 data, any reserved 2022 week, or any hidden test split.

## 1. Questions, kept apart

The protocol separates three things that the data cannot resolve jointly.

- **Pre-snap movement.** Described, not scored. No candidate model predicts it. The protocol reports pre-snap speed and the
  presence of motion events, descriptively.
- **QB decision-making.** Not scored. Target identity and throw events are reported as events. Observed receiver movement is
  not read as a quarterback audible, read, or intent. No claim about a decision is made from tracking alone.
- **Post-snap physical execution.** Scored. The question is whether a predictor's positions match observed positions after
  the snap, against simple kinematic baselines.

## 2. Data and split

| cohort | source on disk | use | weeks |
|---|---|---|---|
| 2022 calibration (fit) | `bdb2025` tracking, 2022 season | fit one scalar (section 5) | Weeks 1 to 3 |
| 2022 development check | `bdb2025` tracking, 2022 season | descriptive comparison of baselines | Weeks 4 to 5 |
| 2023 validation | `bdb2026-prediction`, train split | frozen comparison of baselines | Weeks 1 to 7 |
| reserved 2022 held-out | `bdb2025` Weeks 6 to 9 | **not read by this protocol** | 6 to 9 |
| 2024 to 2026 tracking | none on disk | not used | none |
| 2023 hidden test split | not on disk | not used | none |

The 2022 weeks 6 to 9 are reserved for model-level held-out evaluation in `docs/research/MOVEMENT-POLICY-MATERIALITY-DECISION-2026-10-24.md` and `docs/NFL-PLAYER-TRACKING-22-PLAYER-VALIDATION-2026-10-24.md`. The fit and development split inside 2022 (Weeks 1 to 3 and 4 to 5) is a choice made here. The plan's Weeks 1 to 9 calibration is superseded for this reason.

The 2023 cohort is the `train` split only. Its test split is absent from disk and is not read.

Permitted paths are checked in code. Any read of a 2022 file for Week 6 to 9, or any path with 2026 in it, stops the run.

## 3. Eligibility and samples

**2022 play eligible** when all hold:

- `cohort_week_N.csv` (LP snap-anchored audit, `bdb2025/snap-anchored-v1`) has `eligible_input = True`;
- a `ball_snap` frame exists (`origin`);
- the frames `origin - 2` to `origin` exist for at least 22 players (the origin is the `ball_snap` frame, verified equal to the LP `origin_frame` on the 200 plays checked);
- positions at `origin + 5`, `origin + 10` and `origin + 20` frames exist per player.

A player sample is dropped, and counted, when any of its required frames is missing. Plays are not dropped for one missing player.

**2023 play eligible** when all hold:

- an input file row set and an output file row set exist for the play, with exactly one `player_to_predict = True` target;
- the target has input rows for its last three input frames;
- the output frames for the target reach `origin + 5`, `origin + 10` and `origin + 20`, where `origin` is the last input frame of the play.

The first output frame must equal `origin + 1`. The run checks this for every play. If it fails for more than 1% of plays, the validation is not run and the failure is reported. Plays that fail for a single play-level reason are dropped and counted.

**Horizons.** 0.5 s, 1.0 s and 2.0 s after the origin, at 10 Hz (5, 10 and 20 frames). Frame rate was verified at 10 Hz on 2022 Week 1 (median frame interval 0.100 s; displacement over speed times interval 1.006) and on 2023 Week 1 (0.099 s per frame).

## 4. Roles

Role groups are derived from the source's own position fields and reported as separate groups.

- 2022: `players.csv` position, mapped to QB, RB (RB, FB), WR, TE, OL (T, G, C), DL (DE, DT, NT), LB (LB, ILB, OLB, MLB), CB, S (FS, SS, S, DB), and other.
- 2023: `player_position` mapped with the same groups. The `player_role` field is reported separately: `Targeted Receiver`, `Other Route Runner`, `Passer`, `Defensive Coverage`. Only these four roles appear in the train split, so 2023 role results are coarse.

Positions are not inferred from the tracked trajectory.

## 5. Predictors

All predictors use positions and frames up to and including the origin. None uses any frame after the origin.

- **B0 hold.** The origin position, unchanged.
- **B1 constant velocity (CV).** Velocity `v0 = (x0 - x_{-1}) / 0.1` per axis. Predicted position `x0 + v0 t`.
- **B2 constant acceleration (CA).** `v0` as in B1, and `a = ((x0 - x_{-1}) - (x_{-1} - x_{-2})) / 0.01` per axis. Predicted position `x0 + v0 t + 0.5 a t^2`, unbounded.
- **B3 damped constant acceleration (DCA).** As CA, with the acceleration term scaled by one scalar `k`: `x0 + v0 t + 0.5 k a t^2`.

**Fit.** `k` is chosen once, on 2022 Weeks 1 to 3 only, from the grid `{0.0, 0.1, ..., 1.0}`. The criterion is the mean position error at 1.0 s over all calibration player samples, and ties go to the smaller `k`. The chosen `k` is then frozen for every later step.

No other parameter is fitted. The DCA with its frozen `k` is the only fitted predictor in this protocol.

No candidate movement model is evaluated by this protocol. A candidate, such as the autonomous controller, enters only by amendment, which names it, its inputs and its parameters before any run on the validation cohort.

## 6. Metrics

For every predictor, horizon and role group, reported with the sample count:

- mean and median Euclidean position error, in metres (1 yard = 0.9144 m);
- paired difference against CA, `error(predictor) - error(CA)`, mean and 95% interval from a game-clustered bootstrap (2000 resamples, seed `20261028`);
- speed-change error at 1.0 s: the absolute difference between the predicted and observed change in speed over 1.0 s, as an acceleration proxy.

**Descriptive only** (reported, not compared with any predictor):

- pre-snap speed over the second before the snap, and the count of plays with a `man_in_motion` event;
- receiver route timing, where `routeRan` is labelled: the first time after the snap at which heading changes by at least 30 degrees within 0.3 s while speed is at least 2 yd/s;
- receiver-to-nearest-defender separation at the origin and at 1.0 s (2022 only, all 22 players present);
- target identity and throw events as events.

Route timing, separation and pursuit are described only. They are not scored against any predictor in this protocol.

## 7. Decision rule for a future candidate

A candidate counts as a material improvement only if, at 1.0 s, its paired difference against CA is below `-0.05 m` (50 mm)
with an interval that excludes zero, on a cohort it was not fitted on, and in the role groups that have at least 200 samples.
The 50 mm figure is a **new proposal in this protocol, not taken from prior evidence**. The margin in the 2026-10-24 movement
decision (about 3.7 mm) is recorded for reference and is not used here until it is reconciled with the existing evidence. A null result is reported as null.

This rule is not applied in this protocol, because no candidate is evaluated.

## 8. Execution order

1. **Calibration.** Fit `k` on 2022 Weeks 1 to 3. Record the chosen `k` and the full error curve over the grid.
2. **Development check.** Compute section 6 on 2022 Weeks 4 to 5 with the frozen `k`. Descriptive. Results are not used to change any setting.
3. **Validation.** Compute section 6 on 2023 train Weeks 1 to 7 with the frozen `k`. Report separately from steps 1 and 2.
4. **Stop.** No model is tuned after step 3. Any further change is an amendment, and the validation cohort is then reclassified as development.

Steps 1 to 3 are run once, in this order, from the frozen code. The code path and the cohort lists (game and play identifiers, with sample counts) are recorded in the results artifact with their SHA-256 hashes.

## 9. Limits stated in advance

- 2023 tracking holds 10 to 14 players per play, not 22. Its roles are coarse, and its origin is the last pre-throw frame, not the snap. The 2022 and 2023 cohorts are reported separately and are not pooled as one test.
- The 2022 development split is a within-season choice, not a locked split.
- Velocity and acceleration are finite differences of rounded positions and speeds. Acceleration is noisy, and CA inherits that noise. CA is kept as the baseline because the repository's movement decision uses it.
- No physics controller is run. This protocol measures baselines and the descriptive behaviour around them.

## Amendment log

- 2026-10-28: protocol frozen with this commit. No amendments.
