# E3 game-realism evaluator smoke run — 2026-10-24

This is an evaluation-only harness. It imports no LP code and reads only LP game-record JSON plus the frozen observed-distribution CSV export.

**Status:** `EXPLORATORY_SMOKE_ONLY`; `1` generated game(s); all records valid full games: `False`.

**Validation boundary:** NOT_HELD_OUT: current E2 baseline is sampled from the 2022-2025 PBP window, and the available observed export spans that same window. The current accepted E2 record declares `valid_full_game=false`; this run is an ingestion/scoring smoke test, not legal-game sign-off or evidence of forecast skill.

## Marginal comparisons

TVD is total-variation distance between categorical distributions; 0 is identical and 1 is disjoint. Intervals use the declared bootstrap and are exploratory because the observed export is aggregated and the generated baseline has one game.

| Metric | Generated n | Observed n | TVD | Bootstrap 95% CI | Status |
|---|---:|---:|---:|---:|---|
| `pass_run_mix` | 128 | 134138 | 0.0664 | [0.0636, 0.0693] | compared_exploratory |
| `pass_run_by_game_state` | 128 | — | — | — | reference_unavailable |
| `yards_by_play_type` | 128 | 134138 | 0.2326 | [0.2304, 0.2355] | compared_exploratory |
| `yards_by_down_distance` | 128 | — | — | — | reference_unavailable |
| `first_down_by_down_distance` | 128 | — | — | — | reference_unavailable |
| `sacks_per_dropback` | 65 | 81113 | 0.0039 | [0.0021, 0.0056] | compared_exploratory |
| `turnovers_per_scrimmage_play` | 128 | 134138 | 0.0109 | [0.0102, 0.0117] | compared_exploratory |
| `third_fourth_conversion` | 31 | — | — | — | reference_unavailable |
| `red_zone_conversion` | 5 | — | — | — | reference_unavailable |
| `plays_per_drive` | 24 | 23579 | 0.3488 | [0.3424, 0.3553] | compared_exploratory |
| `pass_run_plays_per_drive` | 24 | 23579 | 0.1751 | [0.1692, 0.1816] | compared_exploratory |
| `possession_duration` | 24 | 23576 | 0.3306 | [0.3245, 0.3368] | compared_exploratory |
| `drive_endings` | 24 | 23579 | 0.2929 | [0.2869, 0.2995] | compared_exploratory |
| `total_points` | 1 | 1087 | 0.9917 | [0.9856, 0.9962] | compared_exploratory |
| `score_margin_abs` | 1 | 1087 | 0.9466 | [0.9315, 0.9598] | compared_exploratory |

## Requested metric coverage

The evaluator emits generated-only conditional tables for down, distance, quarter, field zone and play family. The checked-in PBP export has no matching joint game-state/down-distance tables, so those splits are reported without fabricated observed values or confidence intervals.

| Gate E3 metric | Current result |
|---|---|
| Pass/run mix by game state | Generated conditional table; observed joint reference unavailable |
| Yards and first downs by down/distance | Generated table; observed reference unavailable; first down is an inferred line-to-gain proxy |
| Sacks/turnovers per eligible play | Sacks per flagged dropback and turnovers per pass/run row are compared; conditional splits are unavailable |
| Plays per drive | Compared to observed offensive rows per drive; a pass/run-only sensitivity is also emitted |
| Possession duration | Compared in 30-second bins as snap-clock span, not wall time |
| TD/FG/punt/turnover/clock drive endings | Compared after categories are collapsed to event families; opponent TD and QB kneel stay separate |
| Third/fourth down and red-zone conversion | Generated-only; observed cross-tabs unavailable |
| Total points, score variance and tails | Total-point and margin histograms compared; generated variance/tails unestimable from one game |
| Team/player stat coherence | Internal team and player-role totals: 47 checks, 0 failure(s); no historical team/player reference table in this export |

## Bootstrap and stop rule

Bootstrap: 500 replicates, seed 20261024; generated samples resample whole games. Observed CSV histogram proportions use a Dirichlet(counts) approximation to multinomial resampling because the export has no game keys, so observed clustering and cross-metric covariance are not preserved.

Promotion requires at least 300 generated games, every payload `valid_full_game=true`, support floors per metric/cell, and all predeclared 95% bounds inside thresholds. Reject after two independent frozen batches if a primary lower bound exceeds threshold; otherwise result is inconclusive. The current run fails the legality and sample-size gates by construction.

Reproduction command:

```sh
python scripts/research/e3_game_realism_evaluator.py --generated docs/fixtures/e2/lp-e2-game-seed1-1ca75609.json --lp-evidence-sha a442dcd7 --observed-dir docs/fixtures/e3/observed-2022-2025 --json-out docs/evidence/e3/e3-game-realism-smoke-seed1-2026-10-24.json --report-out docs/evidence/e3/E3-GAME-REALISM-EVALUATOR-SMOKE-SEED1-2026-10-24.md --bootstrap-replicates 500
```

Verification output: 8 evaluator tests pass; evaluator status `EXPLORATORY_SMOKE_ONLY`; 1 generated game; 10 marginals compared, 5 references unavailable; 182 generated conditional rows; internal stat checks 47/47 pass; stop rule not met.

## Provenance and limits

Observed export: `lp.nfl.e3-observed-distributions.v1`, 1087 games and 188282 PBP rows, 2022–2025. Manifest SHA-256: `5d27cc3b0c39f327ad657d14bd5dcac3805b659d6c7d4387389991780cbf59ff`.

LP E2 evidence pin: `a442dcd7`. Generated payload raw SHA-256 values:

- `docs/fixtures/e2/lp-e2-game-seed1-1ca75609.json` — `0a3ed1cb216fa3f23784b427d2bf6e68ac877ab1995fb86cd5998d35d5b47821` (`e2-e1-empirical-v0-seed1`)

The current E2 record is a one-game 2022–2025 retrospective sample. Because its source window overlaps the observed reference, the score is not held-out validation. Weeks 6–9 were not queried as a separate split; they are included in the pooled 2022–2025 reference and had already been examined in earlier E3 work, so they are not a blind holdout.

The tracking-informed pre-snap clock route is closed as a negative finding: 12.04 s MAE versus 11.89 s for PBP-only pre-snap on the reported comparison. No further tracking-clock calibration is authorized or performed here.

The full machine-readable result is `e3-game-realism-smoke-seed1-2026-10-24.json`.
