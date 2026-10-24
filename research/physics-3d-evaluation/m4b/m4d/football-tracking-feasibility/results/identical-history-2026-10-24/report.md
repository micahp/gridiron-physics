# Identical-history comparison, origin excluded (40 development plays)

**Status:** descriptive, paired, no fitting, no holdout. Scope: the frozen 40 development plays from the
observed-tackle manifest (weeks 1–5). The 5 exploratory-visual plays are in `per_play.csv` only.
These are conditional movement reconstructions, not tackle prediction.

## What changed from the earlier comparison

1. **Identical inputs.** All four arms get the same origin position, origin velocity and the same five
   pre-origin velocity samples. The constant-acceleration arms use their least-squares slope as the
   acceleration; the locomotion arm uses the same slope as its proposal.
2. **Origin excluded from every error window.** The earlier metrics included the origin (t = 0), where every arm
   equals the observation by construction. That made the earlier median minimum-separation error exactly 0.000 m
   for all arms, and it diluted every RMSE. Metrics here use t = 0.1 … 0.5 s only.
3. **Minimum separation** is the minimum over (0, 0.5] s, with the origin excluded, and its timing is reported at
   0.1 s resolution.
4. **Horizon** is a request parameter in the new runner, `run_locomotion_multi_horizon.mjs`. Its controller logic
   is unchanged from `run_locomotion_baseline.mjs`.

## Reproduction check (passed)

The new runner at 0.5 s reproduces the stored locomotion output of the earlier run with maximum absolute difference
**0.0 m**. The origin-included metrics recomputed here match the published table:

| Earlier published metric (median) | Constant velocity | Locomotion | Recomputed here |
| --- | ---: | ---: | --- |
| Carrier RMSE (m) | 0.218 | 0.212 | 0.218 / 0.212 |
| Defender RMSE (m) | 0.215 | 0.180 | 0.215 / 0.180 |
| Separation RMSE (m) | 0.170 | 0.141 | 0.170 / 0.141 |
| Signed separation error at event (m) | +0.245 | +0.133 | +0.245 / +0.133 |
| Minimum-separation error (m) | 0.000 | 0.000 | 0.000 / 0.000 (origin-included artefact) |

## Corrected per-play results (median and mean across 40 plays, metres)

Mean absolute error over (0, 0.5] s, per play. Minimum-separation error is over (0, 0.5] s only.

| Arm | Carrier MAE | Defender MAE | Separation MAE | Separation error at 0.5 s (signed) | Minimum-separation error |
| --- | ---: | ---: | ---: | ---: | ---: |
| Constant velocity | 0.197 / 0.213 | 0.191 / 0.196 | 0.161 / 0.177 | +0.245 / +0.258 | 0.023 / 0.023 |
| Constant acceleration (unbounded) | 0.171 / 0.179 | 0.166 / 0.178 | 0.125 / 0.140 | +0.134 / +0.099 | 0.005 / −0.028 |
| Bounded acceleration (6.5 m/s²) | 0.171 / 0.178 | 0.166 / 0.178 | 0.125 / 0.144 | +0.134 / +0.092 | 0.005 / −0.030 |
| Existing locomotion response | 0.173 / 0.179 | 0.168 / 0.178 | 0.128 / 0.141 | +0.133 / +0.098 | 0.004 / −0.028 |

Each cell is median / mean. The minimum-error mean is signed.

## Paired per-play differences (A − B), mean with 95% bootstrap CI over plays

| Comparison | Carrier MAE | Defender MAE | Separation MAE |
| --- | --- | --- | --- |
| Constant acceleration − constant velocity | −0.034 [−0.063, −0.007] | −0.018 [−0.048, +0.013] | −0.037 [−0.072, −0.002] |
| Locomotion − constant velocity | −0.033 [−0.064, −0.005] | −0.018 [−0.049, +0.012] | −0.036 [−0.071, −0.003] |
| **Locomotion − constant acceleration** | **+0.0006 [−0.0000, +0.0014]** | **−0.0000 [−0.0016, +0.0012]** | **+0.0003 [−0.0014, +0.0022]** |
| Locomotion − bounded acceleration | +0.0015 [−0.0007, +0.0053] | −0.0000 [−0.0016, +0.0012] | −0.0033 [−0.0076, +0.0001] |

Bootstrap: 2,000 resamples over plays, seed 20261024.

## Reading the result

- **Almost all of the gain over constant velocity comes from acceleration extrapolation.** Constant acceleration,
  which uses the same five-sample history and no physics, reduces separation MAE by about 0.037 m in mean
  (CI excludes 0). The existing locomotion response adds nothing measurable over it. Its differences from constant
  acceleration are at most about 0.0015 m in mean, and every CI contains or touches 0.
- **The bound rarely binds here.** The 6.5 m/s² bound changes the proposal in 2 of 90 actor-plays (maximum
  |a| = 8.6 m/s²), so bounded and unbounded acceleration are almost identical on these plays.
- **The origin artefact is real, and the separation ratio is not.** The origin-included minimum-separation error is
  exactly 0 for every arm. The origin-included RMSE scales every arm by the same √(5/6), so the ratio between
  arms is unchanged by including the origin. The earlier ~17% separation RMSE reduction therefore stands. On the
  corrected per-play basis the locomotion arm's separation MAE falls from 0.161 to 0.128 (median), and constant
  acceleration gives 0.125. The extra accuracy comes from extrapolating acceleration, not from the locomotion model.
- **Origin is ≤ every later separation in 19 of 40 plays** (observed, over 0–0.5 s). In these plays the
  origin-included minimum is the origin for both trajectories, so the error is exactly 0. That gives 19 zeros for
  constant velocity and 17 for the other arms. The median lands on zero for every arm, which is why the earlier
  table scored a 0.000 m minimum-separation error.

## Limits

- 40 development plays, one tackle-conditioned event per play, selected with hindsight. These are the conditional
  diagnostic only; they cannot support a claim about prediction accuracy or about tackle success.
- The locomotion arm has no pursuit, collision, teammate or ball model. Carrier and defender move independently.
- Bootstrap intervals describe sampling variation across these 40 plays only. They are not a holdout.

## Provenance

- Run: `python3 run_identical_history_comparison.py` (this directory). It reuses the frozen manifest and decoding
  from `run_observed_movement_comparison.py`, which is unchanged.
- `summary.json` contains all arm statistics and paired comparisons, with the manifest SHA-256
  `3c16d3814847170edfc35ba3ca098ff3c82bbc5f8b36b22c05639780d6b41353`, the runner SHA-256, and the engine
  source commit `a09329185451faad44ef7453c7c47bea9d7253a4` (`world.js` and `constants.js` hashes verified).
- `per_play.csv`: one row per play per arm (45 plays × 4 arms), with origin-excluded metrics and the
  origin-included recomputation (`old_*` columns).
