# BDB-2022 tracking-informed clock model: frozen weeks 6–9 evaluation

> Weeks 6–9 were previously examined in E3. These results are a frozen retrospective evaluation, not blind holdout validation.

## Shared target and common cohort

The target is same-quarter PBP game-clock seconds remaining at the current play minus the next non-null-play_type play row. The common table scores **5,650 plays**, **1,136 drives**, and **56 games** where all three models produced a prediction and a resolved target.

All models use the same common rows. The game-level metric sums predicted and observed PBP inter-play deltas over those rows within each game; it is not a complete-game simulation.

| Model | Information available | Plays | MAE / play (s) | P90 abs error (s) | P99 abs error (s) | Mean signed game gap (s) | Game-gap MAE (s) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| A_sampled_runoff | E1 donor sample; held-out event family observed | 5650 | 8.0824 | 19.559 | 34.455 | -4.58 | 118.84 |
| B_pbp_presnap | PBP pre-snap state only | 5650 | 11.8890 | 31.000 | 38.255 | 10.86 | 159.38 |
| C_tracking_presnap | PBP pre-snap state + BDB all-22 pre-snap motion | 5650 | 12.0407 | 31.000 | 37.000 | 283.16 | 296.91 |

## Native coverage

| Model | Predictions on resolved weeks 6–9 target rows |
| --- | ---: |
| A_sampled_runoff | 6,408 |
| B_pbp_presnap | 9,157 |
| C_tracking_presnap | 6,379 |

## Stopped-clock and stoppage-context buckets

The zero-delta bucket is directly observed from adjacent PBP clock stamps. Incomplete-pass and late-half buckets are inferred from PBP state; the penalty flag is observed but does not establish its clock effect. Conditional MAE is descriptive, not a binary legal-clock pass/fail.

| Bucket | Rows | A MAE (s) | B MAE (s) | C MAE (s) | A positive on zero-delta rows | B positive on zero-delta rows | C positive on zero-delta rows |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| incomplete_pass_source_flag | 1266 | 2.894 | 19.093 | 21.845 | 63 | 63 | 63 |
| late_half_pre_snap_context | 615 | 14.657 | 10.567 | 14.330 | 109 | 109 | 109 |
| touchdown_flag | 195 | 18.006 | 12.156 | 13.246 | 15 | 15 | 15 |
| zero_displayed_clock_delta | 215 | 24.048 | 15.384 | 21.109 | 215 | 215 | 215 |

Timeout and out-of-bounds causes cannot be separately scored: those source fields are absent from the pinned PBP schema. Quarter-boundary intervals are unresolved under the frozen target and excluded.

Penalty rows are also absent from the three-model bucket table: the current E1 sampled-runoff classifier rejects any row with `penalty=1`, so it has no prediction for that bucket. There are **650 penalty-flagged resolved targets** across the full weeks 6–9 PBP evaluation population; A's coverage on them is zero. They are excluded from the three-way paired metrics rather than patched with a default. No penalty-specific clock effect is inferred from the flag.

Tracking did not improve the PBP-only pre-snap model on this paired sample: C is **0.1517 s/play worse** in MAE and **137.54 s/game worse** in cumulative-gap MAE. Its P99 per-play error is 1.255 s lower, but the overall and game-aggregate results do not support the tracking addition.

## Scope and interpretation

- Training weeks: [1, 2, 3, 4, 5]; evaluation weeks: [6, 7, 8, 9]. All model fitting uses weeks 1–5 only.
- LP tracking join: `6a169bead09496d4a569000522a6e293d7176548`; verified pairs `15,768`. Unverified joins are excluded.
- Weeks 6–9 raw tracking hashes and scan counts are recorded by week in the JSON. Model C uses frames snap−3 through snap−1 only, with 11 players per side.
- Model A is retrospective because it receives the held-out event family. B and C use pre-snap predictors only.
- The target includes both live-play clock reduction and whatever time passes before the next play stamp; it is not whistle time or possession duration.
- E2 files, LP E2 legality, and the shared v1 contract were not read or changed.

## Reproduction

```bash
python scripts/research/e3_tracking_presnap_clock_holdout.py \
  --lp-repo /root/lp-nfl-bdb-join \
  --db /root/legendarypicks/backend/data/picks.dev.db \
  --tracking-root /root/nfl-tracking-data/bdb2025/code-data \
  --json-output docs/evidence/e3/tracking-presnap-clock-holdout-weeks6-9-2026-10-24.json \
  --markdown-output docs/evidence/e3/TRACKING-PRESNAP-CLOCK-HOLDOUT-WEEKS6-9-2026-10-24.md
```

PBP input hashes: weeks 1–5 `c1846eb50bb662b07e11f8c70bf7f4c5a65c34e10a2d88bd3413171c7a080eef`, weeks 6–9 `72eca5864f78134b8671c6e378f2eb0282ad80021cadd8c54a8faff3642b31ee`.
Weeks 6–9 JSON SHA-256 is recorded at publication; model script SHA-256: `c300c6a8cdc52eab878a3a4991b607db53f20b9fe2c2887c01c2d4e14e39a133`.
