# E3 possession-duration comparison: week-5 starts, weeks 1–4 training

## Result

This is the next E3 realism check from the delivery plan: possession duration. It compares observed 2022 week-5 PBP drives with the pinned E1 empirical drive generator, whose donor pool is restricted to weeks 1–4. The initial state for each generated drive comes from an observed week-5 drive start; the simulated outcomes do not.

The metric is same-quarter **game-clock seconds**, from the first scrimmage snap through the PBP row immediately following the final E1-vocabulary play. It does not measure wall-clock time between possessions.

| Measure | Observed week-5 drives | E1 generated from those starts |
| --- | ---: | ---: |
| Drive count | 61 paired starts | 198 successful generated drives |
| Mean game-clock duration | 161.639 s | 139.899 s |
| P10 / median / P90 / P95 / max | 50 / 121 / 335 / 400 / 475 s | 52 / 124.5 / 258.9 / 293.45 / 424 s |
| Mean scrimmage plays | 6.770 | 5.859 |
| Median scrimmage plays | 6 | 5 |

Mean per-start expected absolute duration error is 106.203 seconds, averaged across available E1 draws for each paired start. Across drives, expected absolute error has median 77.5 s, P90 243.25 s, P95 271 s, and maximum 338.5 s. E1 attempted five draws for each of 66 starts with supported training cells (330 attempts); 198 draws remained after 93 incomplete runs and 39 quarter-crossing or clock-clamped runs were excluded. The original observed PBP cohort contains 73 same-quarter drives; 7 lacked E1 start-cell support, and five supported starts yielded no retained simulation.

The median match hides a substantial tail. Eleven of 61 observed drives lasted at least 300 game-clock seconds; they account for 39.9% of the per-start absolute-error sum. Examples include CIN–BAL drive 18 (464 s observed, 13 scrimmage plays; E1 median 86.5 s) and PHI–ARI drive 16 (475 s, 17 plays; E1 median 151.5 s). The error also runs the other way: HOU–JAX drive 16 lasted 22 s, while its E1 generated median was 259 s.

At the play level, 477 observed PBP-row transitions have median runoff 19 s and P90 43 s; 1,160 accepted generated E1 plays have median runoff 28 s and P90 44 s. Sixty-four observed rows inside the scored drive intervals are outside E1's scrimmage vocabulary. Sequence-position diagnostics are included in the tail artifact, but the position counts are not one-to-one observations: generated and observed sequences have different lengths and E1 omits events such as `no_play`.

**Evidence judgment:** this is useful as a descriptive debugging diagnostic for these selected week-5 starts. It is not usable as acceptance evidence that E1 reproduces possession duration or generalizes. The sample has 61 paired starts, five supported starts with no retained simulation, and only 60% of attempted draws survive the incomplete/period-crossing/clamp filters. That survivor selection can distort the generated tail. Weeks 6–9 were already examined, so this is not holdout validation.

## Scope and limitations

- The database query is fixed to season 2022, weeks 1–5. The E1 donor pool uses weeks 1–4 only; week 5 supplies observed starts and comparison targets.
- Starts are conditioned on observed week-5 quarter, clock, offense, defense, down, distance, and yardline. Field direction is the E1 authored `dir=+1` convention.
- PBP terminal events and subsequent states are not supplied to the generator. The observed terminal family is used only to stratify the report; generated outcomes are sampled normally from the training pool.
- Drives crossing a quarter boundary or with unresolved clock stamps are excluded. Generated drives with quarter changes, clock clamps, or incomplete runs are excluded and counted.
- The metric captures game-clock runoff only. PBP does not provide whistle times or stoppage durations, so this is not elapsed real-world possession duration.
- Weeks 6–9 were already examined in prior E3 work. **This comparison is not holdout-validated.**

## Reproduction and pins

```bash
python scripts/bdb/e3_possession_duration_comparison.py \
  --output docs/evidence/e3/possession-duration-tail-decomposition-weeks1-5-2026-10-24.json
```

- PBP slice SHA-256: `4e39e51ab30931ff1f5cda0ee44052a2edad59d3ced7e7cfcd73b4dece21dc13`.
- E1 commit: `2248f7e1f9710daa3092104526ab6003a0fc3b18`.
- E1, E0 bucket, and reducer source hashes are verified by the builder and recorded in the JSON.
- Comparison script SHA-256: `9d4e135b84bc17cfd1fec93139217e56f6632542d0d5bd150adfa36a1dae93ac`.
- Tail decomposition JSON SHA-256: `f64ba3dbde41db2f2f459d11607e9b7c07611ac843e8af29de474cf8f6bc8f11`.
