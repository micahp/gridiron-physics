# Observed tackle movement comparison

**Status:** descriptive movement-only comparison; no outcome training or contact resolution.

## Sample and method

The comparison uses every manifest row marked included: 45 plays across weeks 1–5, comprising 5 exploratory-visual and 40 development plays. Manifest rows marked excluded are omitted; holdout weeks 6–9 are not sampled. The cohort is conditional on recorded tackle events, so it contains no misses, escapes, or non-tackle opportunities and cannot estimate tackle-success probability.

The prediction origin is 0.5 s before the event. For each play, the ball carrier and a focal labeled defender start from the same observed positions and velocities. The constant-velocity arm holds the last observed velocity. The controller arm estimates acceleration from five observed velocity samples in the preceding 0.5 s and passes that proposal through the existing `Player.locomote()` response for 0.5 s. The two players move independently; pursuit AI, teammate avoidance, ball handling, collision and tackle logic are disabled.

Reference controller inputs are fixed across players: `vmax=9.0 m/s`, `F0=1100.0 N`, `alat=6.5 m/s²`, and `μ=0.95`. Mass comes from each player's listed 2022 weight. These are generic uncalibrated visualization inputs, not player measurements or Madden rating mappings.

## Development-split descriptive metrics

The aggregate below uses only the 40 included development plays. The included exploratory-visual plays are shown individually in the HTML and are excluded from aggregate scoring. No inference, model fitting, or parameter tuning was performed. Minimum separation and its timing are selected from the six 0.1 s samples from prediction origin through event; timing is therefore reported at 0.1 s resolution without interpolation.

| Arm | Carrier position RMSE (m) | Defender position RMSE (m) | Separation RMSE (m) | Signed separation error at event (m) | Predicted minimum separation (m) | Time of minimum (s after origin) | Minimum-separation error (m) | Timing error (s) | Median predicted closing speed (m/s) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Constant velocity | 0.218 | 0.215 | 0.170 | +0.245 | 0.534 | 0.00 | +0.000 | +0.00 | -0.684 |
| Existing locomotion response | 0.212 | 0.180 | 0.141 | +0.133 | 0.475 | 0.10 | +0.000 | +0.00 | -0.489 |

Open [comparison.html](comparison.html) for per-play trajectories and separation curves. `sample.json` freezes IDs and labels; `comparison.json` contains sampled movement series and metrics.

## Interpretation limits

This sample consists of recorded tackle events. It is useful for conditional movement reconstruction only; it cannot establish a tackle-success prediction claim. A later success-prediction study needs an opportunity-based cohort containing misses, escapes, and other non-tackle cases.

The tracking event is broadcast across entity rows and does not identify the tackler. Carrier and credited defender IDs come from the frozen manifest, reconciled to `player_play.csv`. For multi-tackler plays, the focal defender is the nearest credited tackler at the event frame; that choice is conditional and post-event. No grip force or tackle outcome is inferred.

The controller arm reuses the source locomotion response but not the play director's pursuit or carrier path-selection policy. It tests a past-only acceleration proposal under movement limits, not a complete pursuit model. Body orientation and 3D geometry are not modeled.

## Provenance and reproduction

Run from the M4d checkout: `python3 research/physics-3d-evaluation/m4b/m4d/football-tracking-feasibility/run_observed_movement_comparison.py`. The script reads staged local files and does not download data.

- Dataset: unofficial `b00nk3r/NFL-Big-Data-Bowl-2025` mirror, commit `e28d3b25725799ef2213680016db5325f6f90014`; 2022 season.
- Movement source: main commit `a09329185451faad44ef7453c7c47bea9d7253a4`, `engine/world.js` SHA-256 `bc82736164fcd06fffd379efea5b71f6a1373b3dadeb27fe5fa3c1be0f9c0dac`, `engine/constants.js` SHA-256 `98c39f0e2c9deaf4ed390f5f11546de4556642b65c1e10011b4dbeacb132b498`.
- M4d checkout at run: `357014ea008b12c8e0f5057f6f52606b3f2fa1f2`.
- Analysis code SHA-256: `{"run_locomotion_baseline.mjs": "a539fd92bcaf4c12155f41505d25de4ff867afb472ca791110e633999439dc33", "run_observed_movement_comparison.py": "3c2673c2be31b8b688c8d4914c863318cd350a2784cb3228c3750dda3a7e00ed"}`.
- Frozen manifest: `/root/lp-nfl-tracking/docs/research/bdb2025-observed-tackle-manifest-v1.csv`, source commit `c780bcc6f0e5faf4818e4ea9aba82a5f3c5cc9cc`, SHA-256 `3c16d3814847170edfc35ba3ca098ff3c82bbc5f8b36b22c05639780d6b41353`; 49 rows total, 45 included, 4 excluded.
- Included split counts: `{"development": 40, "exploratory_visual": 5}`; only weeks 1–5 are included; holdout weeks 6–9 are untouched.
- Staged source hashes: `{"code-data/player_play.csv": "4dfeba939d0b56e9fca6044c1df709879a22ed239389e155afba571915bd5852", "code-data/players.csv": "dc2b5f923e84a16d789d999e88aea670b5495436ab88c24aef7b97b07d723626", "code-data/plays.csv": "a103cbc3a1ddf7678cb6d77ea5f9919c4292b5d55c7876f7cad6cce3d62dca04", "code-data/tracking_week_1.csv": "dc47c829ef917cb6533c6baedd01964823939a4e9cba807090d2784aa1fd149c", "code-data/tracking_week_2.csv": "d735b37f04bdf324132b9cb0f084a4ca583fadbbf02653e1873dad39c36924aa", "code-data/tracking_week_3.csv": "db2965ad61a5ad3895a8878a3754c3d3e4bf4b2dce75732c0b6b4d9d094887bb", "code-data/tracking_week_4.csv": "2e931bc9cd7f6126d6cd1e7eb71a3c711b748a0cece9d04dcace870e7298774f", "code-data/tracking_week_5.csv": "1c10136562b82f3e2d5405247540d890fc02f38804109bdaaba5e63bd816c3e9", "tackleManifestCsv": "3c16d3814847170edfc35ba3ca098ff3c82bbc5f8b36b22c05639780d6b41353"}`.
- Rights are user-reported; no license text was independently assessed.
