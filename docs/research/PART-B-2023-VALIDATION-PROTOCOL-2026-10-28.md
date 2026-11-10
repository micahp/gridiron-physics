# Part B: frozen 2023 movement validation protocol

Status: frozen before trajectory scoring. Historical development only. This protocol is not final acceptance and does not
use, open, or evaluate any 2026 season data, file, tracking, simulation output, or split.

## Data boundary and cohort

- Development/calibration: 2022 BDB tracking, weeks 1–5 only. Weeks 6–9 remain reserved and excluded.
- Validation: the 2023 `train` files `input_2023_w01..w07.csv` and `output_2023_w01..w07.csv` only, in
  `/root/nfl-tracking-data/bdb2026-prediction/train`. The containing directory name does not define the data season;
  the manifest-listed filenames and records identify these files as 2023 train data. All fourteen SHA-256 values must
  match `/root/nfl-tracking-data/bdb2026-prediction/SHA256SUMS.txt` before scoring.
- A validation unit is one distinct `(game_id, play_id, nfl_id)` with `player_to_predict=True` and a matching output
  track. Input and output `frame_id` values are local to their file type; align horizons by output-frame order, not by
  subtracting input and output frame IDs. The output length must equal `num_frames_output`.
- Score horizons are output frames 5 and 10 (0.5 s and 1.0 s at 10 Hz). Include a track at a horizon only if it has
  that many output labels. The currently verified support is 18,262 target tracks at 0.5 s and 10,951 at 1.0 s.
- Coordinates are in yards and are converted to meters with 0.9144 m/yard. The published [BDB field definitions](https://www.kaggle.com/competitions/nfl-big-data-bowl-2026-prediction/data)
  document the units, file-local frame numbering, and input-before-pass/output-after-pass meaning. This is schema
  documentation only; no 2026 data or split is used. No fields from output may enter a predictor.

## Frozen predictors and scores

The only predictors in this validation are analytic kinematic baselines. For each target, use its last six observed
input positions, or all available positions if fewer than six exist. Fit both baselines to the same observations and
time points at 10 Hz:

1. Constant velocity: ordinary least-squares linear position against time, independently for x and y.
2. Constant acceleration: ordinary least-squares quadratic position against time, independently for x and y.

Evaluate each at future output frames 5 and 10. Do not clip predictions to the field. Do not use `s`, `a`, `dir`,
`ball_land_x/y`, player ratings, or any label/outcome field as predictor input. This keeps the two baselines on the same
information budget and leaves a direct, simple reference for later movement-controller work.

Report endpoint Euclidean error and mean displacement error (ADE over output frames 1 through the scored horizon), in
meters. Report means and RMSEs by horizon, `player_role`, `player_position`, and role-by-position. Also report paired
constant-acceleration minus constant-velocity changes on the same target tracks. Resample whole games, with replacement,
for 2,000 bootstrap replicates using seed `20261028`; report percentile 95% intervals. No player/frame-level bootstrap.

For movement context, report measured target-player speed, acceleration, and change in direction from position
sequences, with the same role and position groups. These are descriptive labels, not features fed to the predictors.

For separation/pursuit, use only plays with at least one `Targeted Receiver` and one `Defensive Coverage` target whose
output covers the horizon. Choose the nearest coverage player to each targeted receiver using only the last input
positions. Keep that origin-selected pair fixed through the scored horizon. Report observed separation change and
constant-velocity/quadratic pair-separation errors at frames 5 and 10, with paired game-clustered intervals. Do not
select a defender using future separation.

## Supported questions and limits

- The target subset supports receiver and coverage-player trajectories, and paired receiver/coverage separation and
  closure for the origin-selected pairs. It does not cover all 22 players; offensive linemen and most non-target players
  lack output labels.
- Route assignments are absent, so route completion or route-break timing is not a scored target. Report trajectories
  and direction changes without naming them as designed route breaks.
- The 2023 files do not contain a ball-snap timestamp, so they cannot support a pre-snap-motion estimate. Their pre-pass
  input period must not be relabeled as pre-snap.
- The files do not expose a synchronized pass-release timestamp or ball-flight trajectory. Defensive turning/closure
  is measurable, but reaction delay to release is not identified; do not report it as a measured reaction time.
- Play-level context is limited to fields in these files. Situation breakdowns use target role and position plus whether
  receiver and coverage labels coexist; do not infer down, route, coverage call, or assignment.
- No fitting, threshold selection, or model choice is allowed on the 2023 results. Any later candidate must be frozen on
  2022 development data before this protocol is run again. This report is historical validation only, not independent
  2025/2026 acceptance.

## Verification record

Coverage and all fourteen file hashes were checked before this protocol was frozen. The 2023 scan used only the seven
manifest-listed 2023 train weeks. The frozen decision-model v1 was inspected as source only and was not run.
