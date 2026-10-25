# Game-level clock realism gap — frozen E2 seed 1

## Scope

The immutable E2 fixture at LP payload SHA `0a3ed1cb216fa3f23784b427d2bf6e68ac877ab1995fb86cd5998d35d5b47821` was replayed once with its current sampled per-play runoffs and once with the weeks 1–5 two-regime pre-snap clock model. The fixture has one seed (1), 143 event-stream plays, 24 drives, score A 14–B 10, and `valid_full_game=false`. Its producer selected the first seed in 1–300 that completed regulation untied and unblocked; this is a selected singleton, not a random-seed sample. No LP engine or E2 producer file was run or changed.

The observed reference uses 896 regular-season games: 2022 weeks 1–5 and 2023–2025. 2022 weeks 6–9 were not queried. Confidence intervals below describe uncertainty in the observed mean only; a single frozen E2 seed supplies no generated-policy interval.

## Metrics

Differences and their intervals are E2 seed-1 value minus observed mean. The intervals transform the observed-mean 95% normal CI; they do not include simulation variance.

| Metric | Observed mean (95% CI) | Current sampled runoff | Difference (95% CI) | Two-regime clock | Difference (95% CI) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Pass/run plays per game | 123.17 (122.61, 123.72) | 128.00 | +4.83 (+4.28, +5.39) | Not estimable |
| Possession clock-span proxy (s) | 3505.91 (3499.59, 3512.24) | 3364.00 | -141.91 (-148.24, -135.59) | Not estimable |
| Drive groups per game | 21.64 (21.43, 21.84) | 24.00 | +2.36 (+2.15, +2.57) | Not estimable |
| Total points (score distribution) | 45.00 (44.11, 45.89) | 24.00 | -21.00 (-21.89, -20.11) | Not estimable |

The current fixture scoreline is `14–10`; total points are 24. Score components: home 14 vs observed mean 23.56 (E2-minus-mean -9.56, 95% CI -10.21 to -8.91); away 10 vs observed mean 21.44 (E2-minus-mean -11.44, 95% CI -12.07 to -10.81); absolute margin 4 vs observed mean 11.00 (E2-minus-mean -7.00, 95% CI -7.60 to -6.41). These are marginal comparisons; one scoreline does not establish a score-distribution fit.

## Interpretation

The current sampled-runoff fixture has 128 pass/run plays, 24 drive groups, and a 14–10 score. Under the two-regime clock replay, play sequence 27 in drive 4 predicts 33 seconds with only 13.5 seconds left in quarter 1. Clamping that runoff to period end makes the fixture's next snap (sequence 28, still labeled quarter 1) impossible. Therefore the candidate has no complete-game plays/game, time-of-possession, drive-count, or score metric; these are marked not estimable instead of treating the unchanged fixture outcome as a valid counterfactual. Continuing after that boundary would require the game executor to decide what happens next. The LP E2 successor engine remains untouched and full legal-game status is unsigned.

The clock replay evaluated 27 fixture plays and could not replay the remaining 116. It applied 27 model predictions before period expiry and preserved 0 period-boundary runoffs. The raw sum of stored sampled per-play runoff fields is 3613.0s; the applied two-regime prefix is 894.0s. These sums include terminal/clamp and period-boundary behavior and are not whole-game elapsed-time estimates. The current fixture's within-drive snap-clock-span proxy is 3364.0s; the counterfactual full-game proxy is not estimable.

The reference possession metric is a snap-clock-span proxy, not official time of possession. The E2 fixture itself is `valid_full_game=false`, uses one seed, and declares timeouts, two-minute warnings, penalties, and overtime unsupported. The reported intervals therefore describe observed-reference sampling uncertainty only; they do not establish policy uncertainty or legal game realism.

The E2 event sequence was retrospectively sampled from 2022–2025 PBP and is not protected from 2022 weeks 6–9 donor rows. The observed comparison excludes those weeks, but the frozen generated fixture itself is not blind-holdout evidence.

## Provenance

- Frozen E2 fixture SHA-256: `b573713b10b2201c32a0827ab499a5b2b2a6d7de985ab05b7e4bfc51dce1f1a1`; upstream payload SHA-256: `0a3ed1cb216fa3f23784b427d2bf6e68ac877ab1995fb86cd5998d35d5b47821`.
- Frozen two-regime development baseline SHA-256: `4f1af788f3ca3a0ee18a994439acf8c8491ddffff945882b285202787de8e302`.
- Weeks 1–5 clock-state crosswalk SHA-256: `f030e9c6da3d69f1b1a9a15da0d5f14074639b1697f52d9e964eeabdb6f844c9`.
- Observed fixture manifest SHA-256: `5d27cc3b0c39f327ad657d14bd5dcac3805b659d6c7d4387389991780cbf59ff`.
- Observed source PBP fingerprint SHA-256: `745c49c8e0ab18b66c4af77c724e0cbdc7016abca3dbb7be00ccae563eb0cddc`; checked-in game/drive/play distribution table hashes: `{"drive_distribution.csv": "4e401f42666bd8fdaea341d00a4dc95f382255bbf72cb8d088545ec044ecdf58", "game_distribution.csv": "bdd89eb6a971b2fd32704793261ff05a0265135ce58e797134f9669578c1fd55", "play_distribution.csv": "b5d2e07347c26674552ae70bdeedf9f47e54233afe9a003662f2cf19d2ffc57d"}`.
- Observed PBP subset SHA-256: `95d5259cb894a06dc1e9884c3d3148afc6d0220df5b2a0104c260cfaa06a7cf7`; schedule subset SHA-256: `ac9d3c5a2cb84156aa26f412795b3d5c02bb71b91b1dbc4c73e63edcfa0da4a5`.
- The machine-readable report retains per-play clock replay values and all four comparison distributions.

## Reproduction

```bash
python scripts/research/e3_game_level_clock_realism_gap.py \
  --db /root/legendarypicks/backend/data/picks.dev.db \
  --json-output docs/evidence/e3/game-level-clock-realism-gap-seed1-2022-2025-2026-10-24.json \
  --markdown-output docs/evidence/e3/GAME-LEVEL-CLOCK-REALISM-GAP-SEED1-2022-2025-2026-10-24.md
```
