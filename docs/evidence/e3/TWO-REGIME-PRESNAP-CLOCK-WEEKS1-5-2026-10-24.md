# Two-regime pre-snap clock comparison — 2022 weeks 1–5

## Result

The frozen two-regime model scored on the same 8,977 paired plays and 1,654 drives as the existing **12.2427 s** single-model pre-snap baseline. Its overall MAE was **11.8287 s**, a 0.4140 s (3.38%) reduction. The change is concentrated in the late-half bucket: regulation MAE rose by 0.2283 s, while late-half MAE fell by 5.2688 s. The candidate does not meet the predeclared 5% overall MAE improvement threshold on these development weeks, and late-half P99 is 5.13% above baseline. These are development results, not a holdout pass.

| Pre-snap regime | Plays | Drives | Baseline MAE | Baseline P90 | Baseline P99 | Two-regime MAE | Two-regime P90 | Two-regime P99 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Regulation | 7,928 | 1,493 | 12.0322 s | 31.0 s | 37.0 s | 12.2605 s | 31.5 s | 37.0 s |
| Stoppage drill proxy | 1,049 | 301 | 13.8341 s | 31.5 s | 39.0 s | 8.5653 s | 23.0 s | 41.0 s |
| Overall | 8,977 | 1,654 | 12.2427 s | 31.0 s | 37.5 s | 11.8287 s | 31.0 s | 37.0 s |

Quantiles are Type-7 linear interpolation over per-play absolute errors. All comparisons are paired on identical rows. The fold for each development week trains on the other four weeks.

## Regime and inputs

The deterministic regime selector is **stoppage drill proxy** when the pre-snap quarter is 2 or 4 and the quarter clock is at most 120 seconds; all other regulation snaps are **regulation**. This is a pre-snap clock-state proxy, not an observed drill or stoppage label. It uses no play type, outcome family, terminal event, timeout-called flag, target, or future location.

The two conditional-median models use quarter, quarter-clock band, offense-relative score-differential band, down band, and distance band. Backoff order and the 25-row bucket support floor are frozen in the model and the protocol manifest. The timeout-left column is unresolvable in the pinned source: 0 of 9,225 source rows have a value, including 0 of these 8,977 scored plays. It is kept null and excluded; no default or imputation is used.

The LP crosswalk's `score_diff` is offense-relative: pre-snap home score minus visitor score when the offense is home, reversed otherwise. The clock and down/distance are current pre-snap state. Labels are used only for scoring and are never model features.

## Tail context and interpretation

The possession-duration audit is a different target from the play-level same-quarter clock delta in the table. In that separate audit, **11 of 61** observed drives lasting at least 300 seconds contributed **39.9%** of the total per-start absolute-error sum. Per-start expected absolute duration error was 106.203 s on average, with median 77.5 s, P90 243.25 s, P95 271 s, and maximum 338.5 s. Those long-drive findings motivate tail scrutiny, but they do not mean the regime split predicts possession duration or that its play-level P99 resolves that drive-level tail.

The two-regime model improves average and P90 error in the stoppage-drill proxy, but increases that regime's P99 from 39 to 41 seconds. Regulation MAE rises from 12.0322 to 12.2605 seconds. The overall MAE gain is below the frozen 5% criterion. This evidence does not justify acceptance or a holdout claim.

## Frozen evaluation protocol and holdout status

The machine-readable protocol was committed at `cd9480f` **before** these scores were computed: [holdout protocol](../../research/E3-PRESNAP-CLOCK-HOLDOUT-PROTOCOL-2026-10-24.json), SHA-256 `e9d0920ff9d54d88bb45fa8f263e01483571c9b73482ce1541cab3c2b3b42392` (sidecar included). It fixes the target, cohort, features, model forms, metrics, quantiles, and acceptance thresholds.

Weeks 6–9 were not read or queried during this model build or protocol freeze. They were examined in prior E3 work, so even a future execution of the frozen protocol cannot restore untouched-holdout status; report any such results as a frozen later-period evaluation, **not holdout-validated**. No result from this run is holdout evidence.

The earlier physical-timing branch `research/gridiron-e3-physical-timing-2026-10-24` at `7ee6703e` is superseded for clock-comparison evidence by `research/gridiron-e3-clock-comparison-2026-10-24`.

## Reproduction and provenance

```bash
python scripts/research/e3_two_regime_presnap_clock.py \
  --baseline-json docs/evidence/e3/presnap-clock-model-comparison-weeks1-5-2026-10-24.json \
  --state-csv /root/lp-nfl-bdb-join/docs/research/bdb2022-clock-audit-weeks1-5-2026-10-24.csv \
  --output docs/evidence/e3/two-regime-presnap-clock-weeks1-5-2026-10-24.json
```

- Baseline JSON SHA-256: `4f1af788f3ca3a0ee18a994439acf8c8491ddffff945882b285202787de8e302`.
- Weeks 1–5 state crosswalk SHA-256: `f030e9c6da3d69f1b1a9a15da0d5f14074639b1697f52d9e964eeabdb6f844c9`.
- Frozen protocol SHA-256: `e9d0920ff9d54d88bb45fa8f263e01483571c9b73482ce1541cab3c2b3b42392`.
- Two-regime output JSON SHA-256: `9e402aa703b80e31f472f2bc992d81d5b4a1b642dc41f3e6de4404ec1e2a3abc`.
- Two-regime builder SHA-256: `8cfc94513dbf3d2dd33b658ff0e20275231d737ccf2430d4e5b2df2729dc4b6c`.
- Possession-duration tail artifact SHA-256: `f64ba3dbde41db2f2f459d11607e9b7c07611ac843e8af29de474cf8f6bc8f11`.
- The output JSON records the model script SHA-256 and per-play paired predictions and errors.
