# Prospective-from-snap clock comparison: 2022 weeks 1–5

## Result

This is the strict pre-snap follow-up to the earlier retrospective conditional comparison. It scores a PBP-only pre-snap model against the same model with all-22 tracking summaries observed strictly before the snap.

| Model | MAE | Plays | Drives |
| --- | ---: | ---: | ---: |
| PBP pre-snap state | 12.2427 s | 8,977 | 1,654 |
| PBP state + pre-snap tracking | 12.5706 s | 8,977 | 1,654 |

Adding tracking worsened MAE by 0.3278 s. The PBP model had lower error on 1,988 rows, the tracking model on 1,693, and 5,296 tied. Tracking-specific backoff bins were used on 4,816 rows; on those rows, PBP MAE was 11.2625 s and tracking MAE was 11.8735 s. On the 4,161 rows where tracking fell back to PBP-only buckets, predictions were identical.

Tracking MAE was higher in each held-week fold:

| Scored week | Plays | Drives | PBP pre-snap MAE | Tracking pre-snap MAE |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 1,823 | 332 | 12.0222 s | 12.2345 s |
| 2 | 1,716 | 315 | 12.3969 s | 12.8322 s |
| 3 | 1,877 | 345 | 12.2933 s | 12.4851 s |
| 4 | 1,747 | 339 | 12.3154 s | 12.6989 s |
| 5 | 1,814 | 323 | 12.1963 s | 12.6257 s |

The previous three-way table's better tracking score was retrospective: it used the target play's future tracking duration. Its PBP conditional model also used the observed current `play_type` and terminal outcome family. Those original A/B/C results are not prospective forecasts. The new B/C pair above uses no held-out play type, play result, terminal marker, or future location as a model feature.

## Pre-snap inputs and cohort

The tracking builder scans only the five pinned week files. For each manifest play, it requires the same 22 tracked player IDs at frames `snap−3`, `snap−2`, and `snap−1`, with 11 players per side at the last pre-snap frame. It derives player velocity and acceleration by finite differences, then emits team means, speed spread, acceleration, teammate spacing, and offense-defense spacing aggregates. It does not emit player IDs.

The manifest contributes only `gameId`, `playId`, `week`, `origin_frame`, `possessionTeam`, and `defensiveTeam`; the future `eligible_input` and scoring labels are not used. The raw tracking reader accesses `gameId`, `playId`, `nflId`, `frameId`, `club`, `x`, and `y`. It discards every frame at or after `origin_frame` before reading coordinates, and never reads event markers. The LP crosswalk contributes identifiers only.

The model uses pre-snap PBP state (`qtr`, current game clock, down, distance, yardline, offense and defense) and the derived tracking aggregates. It uses fixed categorical backoff bins with a 25-row support floor. `play_type` is used only to identify actual PBP play rows and define the target clock interval; it is not a predictor. The target is current `game_seconds_remaining` minus the next non-null-`play_type` PBP row in the same quarter.

The feature builder emits 9,441 complete all-22 pre-snap plays from the 9,456-row weeks 1–5 manifest; 9,213 have LP keys. Fifteen plays lack the required pre-snap history. The scoring intersection contains 8,977 resolved targets with complete all-22 pre-snap features.

## Validation limits

Every fold trains on the other four development weeks; week 5 trains on weeks 1–4. Fixed feature bins were set before scoring; no weeks 6–9 data were queried by these builders. However, weeks 6–9 were already examined in prior E3 work, so these weeks 1–5 results are **not holdout-validated**. This is a development comparison, not evidence of forecast skill or a promotion result.

The available pre-snap tracking summaries did not improve this clock-delta baseline. No more complex movement or clock policy is justified by this result alone.

## Reproduction and provenance

```bash
python scripts/research/build_bdb2025_presnap_features.py \
  --tracking-root /root/nfl-tracking-data/bdb2025/code-data \
  --cohort-manifest /root/lp-nfl-snap-benchmark/docs/research/bdb2025-snap-anchored-cohort-v1.csv \
  --lp-crosswalk /root/lp-nfl-bdb-join/docs/research/bdb2022-clock-audit-weeks1-5-2026-10-24.csv \
  --output docs/research/gridiron-e3-presnap-tracking-features-weeks1-5-2026-10-24.json
python scripts/research/e3_presnap_clock_models.py \
  --tracking-features docs/research/gridiron-e3-presnap-tracking-features-weeks1-5-2026-10-24.json \
  --output docs/evidence/e3/presnap-clock-model-comparison-weeks1-5-2026-10-24.json
```

- Canonical snap manifest SHA-256: `45325d55103da9a7eca5139f3fda9506cb38d8f0af76d7753868c8f40fbd548a`.
- LP crosswalk SHA-256: `f030e9c6da3d69f1b1a9a15da0d5f14074639b1697f52d9e964eeabdb6f844c9`.
- Per-week tracking hashes and scan row counts are recorded in the feature JSON; only weeks 1–5 appear there.
- Pre-snap feature JSON SHA-256: `5ca5cabd3ed5c262fbf60a96af62f7921d0402fab11b7dfc0274dfbfc816e506`.
- PBP scoring slice SHA-256: `df489d92ea0b676b3d551d7e019ccd6815c0c6ac6668495e88886eab318f7ff2`.
- Feature builder SHA-256: `faba9a2dd08ce17e71783334bc8251c14327e5bfa5fa8e8a3c3e0b2819d0e416`.
- Model script SHA-256: `b5ac3b964f29067755bec452c1c6d8a630a14d73d74397a683940ef72baa4f9f`.
- Prospective comparison JSON SHA-256: `4f1af788f3ca3a0ee18a994439acf8c8491ddffff945882b285202787de8e302`.
