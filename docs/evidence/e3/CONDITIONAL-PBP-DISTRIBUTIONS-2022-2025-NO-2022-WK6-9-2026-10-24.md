# Conditional PBP distributions for E3 — 2026-10-24

## Scope

Read-only observed cohort: 896 regular-season games, 155,124 PBP rows, and 109,932 eligible pass/run plays. It uses 2022 weeks 1–5 plus 2023–2025; 2022 weeks 6–9 were excluded in SQL and not queried. No tracking, clock-audit join, LP game payload, or physical features are used.

These are descriptive conditional frequencies and outcome summaries, not a forecast model or proof of calibration. Conditions are available pre-play state fields only. Quarter-clock bands are derived from game_seconds_remaining and quarter as `game_seconds_remaining - (4 - quarter) * 900`. The source schema has no score-differential field, so score-conditioned tables are omitted.

## Pass/run mix by down and distance

| Down | Distance | Eligible plays | Pass | Pass share | Run | Run share |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 0-3 | 1014 | 290 | 0.2860 | 724 | 0.7140 |
| 1 | 11+ | 1869 | 1253 | 0.6704 | 616 | 0.3296 |
| 1 | 4-6 | 1143 | 398 | 0.3482 | 745 | 0.6518 |
| 1 | 7-10 | 43982 | 21008 | 0.4776 | 22974 | 0.5224 |
| 2 | 0-3 | 5924 | 2112 | 0.3565 | 3812 | 0.6435 |
| 2 | 11+ | 5386 | 4176 | 0.7753 | 1210 | 0.2247 |
| 2 | 4-6 | 8687 | 4336 | 0.4991 | 4351 | 0.5009 |
| 2 | 7-10 | 16474 | 10847 | 0.6584 | 5627 | 0.3416 |
| 3 | 0-3 | 6590 | 3140 | 0.4765 | 3450 | 0.5235 |
| 3 | 11+ | 4207 | 3528 | 0.8386 | 679 | 0.1614 |
| 3 | 4-6 | 5662 | 4844 | 0.8555 | 818 | 0.1445 |
| 3 | 7-10 | 6337 | 5621 | 0.8870 | 716 | 0.1130 |
| 4 | 0-3 | 1739 | 822 | 0.4727 | 917 | 0.5273 |
| 4 | 11+ | 188 | 171 | 0.9096 | 17 | 0.0904 |
| 4 | 4-6 | 452 | 408 | 0.9027 | 44 | 0.0973 |
| 4 | 7-10 | 278 | 254 | 0.9137 | 24 | 0.0863 |

## Pass/run mix by field zone

| Field zone | Eligible plays | Pass share | Run share |
| --- | ---: | ---: | ---: |
| backed_up_81-99 | 8582 | 0.5669 | 0.4331 |
| opponent_half_21-50 | 34335 | 0.5699 | 0.4301 |
| own_half_51-80 | 50349 | 0.6024 | 0.3976 |
| red_zone_0-20 | 16666 | 0.5069 | 0.4931 |

## Conditional yards, series conversions and drive endings

Yards summaries use rows with observed `yards_gained`. First-down rates use only eligible plays that are the resolved terminal row of a series and have a source `series_result`.

| Down | Distance | Type | Plays | Yard rows | Yards p10 / p50 / p90 | Resolved series terminals | First downs | First-down rate | TD rows |
| ---: | --- | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| 1 | 0-3 | pass | 290 | 290 | 0.0 / 0.0 / 3.0 | 7 | 2 | 0.286 | 133 |
| 1 | 0-3 | run | 724 | 724 | -1.0 / 1.0 / 2.0 | 12 | 4 | 0.333 | 338 |
| 1 | 11+ | pass | 1253 | 1253 | 0.0 / 5.0 / 16.0 | 134 | 100 | 0.746 | 26 |
| 1 | 11+ | run | 616 | 616 | 0.0 / 4.0 / 10.0 | 38 | 26 | 0.684 | 2 |
| 1 | 4-6 | pass | 398 | 398 | 0.0 / 0.0 / 9.0 | 67 | 58 | 0.866 | 94 |
| 1 | 4-6 | run | 745 | 745 | -1.0 / 3.0 / 6.0 | 60 | 54 | 0.900 | 121 |
| 1 | 7-10 | pass | 21008 | 21008 | 0.0 / 5.0 / 19.0 | 5798 | 5305 | 0.915 | 587 |
| 1 | 7-10 | run | 22974 | 22974 | 0.0 / 3.0 / 11.0 | 2708 | 2578 | 0.952 | 278 |
| 2 | 0-3 | pass | 2112 | 2112 | 0.0 / 3.0 / 17.0 | 982 | 935 | 0.952 | 208 |
| 2 | 0-3 | run | 3812 | 3812 | 0.0 / 3.0 / 9.0 | 2119 | 2101 | 0.992 | 327 |
| 2 | 11+ | pass | 4176 | 4176 | 0.0 / 4.0 / 17.0 | 656 | 559 | 0.852 | 87 |
| 2 | 11+ | run | 1210 | 1210 | 0.0 / 4.0 / 12.0 | 97 | 89 | 0.918 | 8 |
| 2 | 4-6 | pass | 4336 | 4336 | 0.0 / 4.0 / 17.0 | 1713 | 1624 | 0.948 | 262 |
| 2 | 4-6 | run | 4351 | 4351 | 0.0 / 3.0 / 10.0 | 1302 | 1276 | 0.980 | 133 |
| 2 | 7-10 | pass | 10847 | 10847 | 0.0 / 4.0 / 17.0 | 3006 | 2743 | 0.913 | 345 |
| 2 | 7-10 | run | 5627 | 5627 | 0.0 / 4.0 / 11.0 | 912 | 878 | 0.963 | 91 |
| 3 | 0-3 | pass | 3140 | 3140 | 0.0 / 2.0 / 17.0 | 1354 | 1291 | 0.953 | 246 |
| 3 | 0-3 | run | 3450 | 3450 | 0.0 / 2.0 / 8.0 | 1987 | 1959 | 0.986 | 213 |
| 3 | 11+ | pass | 3528 | 3528 | -3.0 / 4.0 / 17.0 | 592 | 470 | 0.794 | 72 |
| 3 | 11+ | run | 679 | 679 | 1.0 / 6.0 / 14.0 | 79 | 74 | 0.937 | 9 |
| 3 | 4-6 | pass | 4844 | 4844 | -1.0 / 2.0 / 18.0 | 1834 | 1710 | 0.932 | 297 |
| 3 | 4-6 | run | 818 | 818 | 0.0 / 4.0 / 11.0 | 348 | 340 | 0.977 | 36 |
| 3 | 7-10 | pass | 5621 | 5621 | -4.0 / 0.0 / 18.0 | 1638 | 1470 | 0.897 | 229 |
| 3 | 7-10 | run | 716 | 716 | 0.5 / 6.0 / 14.0 | 229 | 224 | 0.978 | 15 |
| 4 | 0-3 | pass | 822 | 822 | 0.0 / 2.0 / 17.0 | 585 | 287 | 0.491 | 114 |
| 4 | 0-3 | run | 917 | 917 | 0.0 / 2.0 / 7.0 | 734 | 524 | 0.714 | 80 |
| 4 | 11+ | pass | 171 | 171 | -5.0 / 0.0 / 19.0 | 134 | 21 | 0.157 | 4 |
| 4 | 11+ | run | 17 | 17 | -6.2 / 6.0 / 16.6 | 14 | 3 | 0.214 | 0 |
| 4 | 4-6 | pass | 408 | 408 | 0.0 / 0.0 / 17.0 | 327 | 137 | 0.419 | 32 |
| 4 | 4-6 | run | 44 | 44 | 0.3 / 6.0 / 14.4 | 36 | 24 | 0.667 | 3 |
| 4 | 7-10 | pass | 254 | 254 | -2.0 / 0.0 / 17.7 | 186 | 51 | 0.274 | 15 |
| 4 | 7-10 | run | 24 | 24 | -6.8 / 4.0 / 18.1 | 19 | 10 | 0.526 | 0 |

### Dropback events by down and distance

Rates use known source flags as denominators. The machine-readable table includes total dropbacks and known-flag counts.

| Down | Distance | Dropbacks | Sacks / known | INT / known | Lost fumbles / known |
| ---: | --- | ---: | --- | --- | --- |
| 1 | 0-3 | 299 | 7 / 299 | 5 / 299 | 2 / 299 |
| 1 | 11+ | 1309 | 74 / 1309 | 23 / 1309 | 17 / 1309 |
| 1 | 4-6 | 420 | 20 / 420 | 9 / 420 | 5 / 420 |
| 1 | 7-10 | 22072 | 1111 / 22072 | 385 / 22072 | 168 / 22072 |
| 2 | 0-3 | 2204 | 126 / 2204 | 37 / 2204 | 16 / 2204 |
| 2 | 11+ | 4407 | 237 / 4407 | 99 / 4407 | 26 / 4407 |
| 2 | 4-6 | 4550 | 264 / 4550 | 74 / 4550 | 28 / 4550 |
| 2 | 7-10 | 11376 | 648 / 11376 | 199 / 11376 | 97 / 11376 |
| 3 | 0-3 | 3353 | 247 / 3353 | 63 / 3353 | 19 / 3353 |
| 3 | 11+ | 3758 | 374 / 3758 | 96 / 3758 | 39 / 3758 |
| 3 | 4-6 | 5161 | 491 / 5161 | 115 / 5161 | 40 / 5161 |
| 3 | 7-10 | 5993 | 650 / 5993 | 146 / 5993 | 42 / 5993 |
| 4 | 0-3 | 884 | 57 / 884 | 26 / 884 | 3 / 884 |
| 4 | 11+ | 181 | 21 / 181 | 14 / 181 | 2 / 181 |
| 4 | 4-6 | 429 | 26 / 429 | 18 / 429 | 3 / 429 |
| 4 | 7-10 | 265 | 28 / 265 | 14 / 265 | 5 / 265 |

### Third and fourth down series outcomes

First down or TD share counts those source results among all resolved terminal series rows, grouped by terminal play type. Since the denominator includes punts, field goals and no-play rows, this is not an attempt-only conversion probability.

| Down | Type | Resolved terminal series | First down or TD | Share | Terminal results |
| ---: | --- | ---: | ---: | ---: | --- |
| 3 | field_goal | 15 | 0 | 0.000 | {"Field goal": 13, "Missed field goal": 2} |
| 3 | no_play | 767 | 766 | 0.999 | {"First down": 766, "Safety": 1} |
| 3 | pass | 5418 | 4943 | 0.912 | {"Field goal": 2, "First down": 4941, "Safety": 8, "Touchdown": 2, "Turnover": 465} |
| 3 | qb_kneel | 1 | 1 | 1.000 | {"First down": 1} |
| 3 | run | 2643 | 2597 | 0.983 | {"First down": 2597, "Safety": 1, "Turnover": 45} |
| 4 | field_goal | 2900 | 0 | 0.000 | {"Field goal": 2500, "Missed field goal": 400} |
| 4 | no_play | 170 | 170 | 1.000 | {"First down": 170} |
| 4 | pass | 1232 | 496 | 0.403 | {"First down": 496, "Safety": 1, "Turnover": 66, "Turnover on downs": 669} |
| 4 | punt | 6476 | 0 | 0.000 | {"Punt": 6473, "Safety": 3} |
| 4 | qb_kneel | 8 | 0 | 0.000 | {"Turnover on downs": 8} |
| 4 | run | 803 | 561 | 0.699 | {"First down": 561, "Safety": 2, "Turnover": 9, "Turnover on downs": 231} |

### Drive endings by starting field zone

| Starting field zone | Resolved drives | Terminal result counts |
| --- | ---: | --- |
| red_zone_0-20 | 304 | {"Field goal": 85, "Missed field goal": 3, "Opp touchdown": 1, "QB kneel": 19, "Touchdown": 167, "Turnover": 13, "Turnover on downs": 16} |
| opponent_half_21-50 | 1643 | {"End of half": 22, "Field goal": 463, "First down": 3, "Missed field goal": 81, "Opp touchdown": 9, "Punt": 156, "QB kneel": 209, "Touchdown": 512, "Turnover": 103, "Turnover on downs": 85} |
| own_half_51-80 | 13625 | {"End of half": 332, "Field goal": 2115, "First down": 6, "Missed field goal": 373, "Opp touchdown": 150, "Punt": 4926, "QB kneel": 469, "Safety": 7, "Touchdown": 2974, "Turnover": 1428, "Turnover on downs": 845} |
| backed_up_81-99 | 3724 | {"End of half": 121, "Field goal": 365, "First down": 2, "Missed field goal": 68, "Opp touchdown": 53, "Punt": 1751, "QB kneel": 163, "Safety": 44, "Touchdown": 583, "Turnover": 402, "Turnover on downs": 172} |
| unknown | 92 | {"End of half": 40, "Field goal": 7, "First down": 16, "Missed field goal": 1, "Opp touchdown": 1, "Punt": 1, "Touchdown": 23, "Turnover": 2, "Turnover on downs": 1} |

| Starting field zone | Terminal result | Drives | Plays/drive p10 / p50 / p90 |
| --- | --- | ---: | --- |
| backed_up_81-99 | End of half | 121 | 2.0 / 5.0 / 12.0 |
| backed_up_81-99 | Field goal | 365 | 8.4 / 13.0 / 18.0 |
| backed_up_81-99 | First down | 2 | 3.8 / 7.0 / 10.2 |
| backed_up_81-99 | Missed field goal | 68 | 8.0 / 12.0 / 16.0 |
| backed_up_81-99 | Opp touchdown | 53 | 2.0 / 4.0 / 9.0 |
| backed_up_81-99 | Punt | 1751 | 4.0 / 6.0 / 10.0 |
| backed_up_81-99 | QB kneel | 163 | 2.0 / 2.0 / 8.8 |
| backed_up_81-99 | Safety | 44 | 1.0 / 2.0 / 4.7 |
| backed_up_81-99 | Touchdown | 583 | 6.0 / 12.0 / 18.0 |
| backed_up_81-99 | Turnover | 402 | 2.0 / 5.0 / 13.0 |
| backed_up_81-99 | Turnover on downs | 172 | 6.0 / 10.0 / 15.0 |
| opponent_half_21-50 | End of half | 22 | 2.0 / 3.5 / 11.0 |
| opponent_half_21-50 | Field goal | 463 | 4.0 / 7.0 / 11.0 |
| opponent_half_21-50 | First down | 3 | 7.0 / 11.0 / 13.4 |
| opponent_half_21-50 | Missed field goal | 81 | 4.0 / 7.0 / 9.0 |
| opponent_half_21-50 | Opp touchdown | 9 | 2.8 / 4.0 / 6.6 |
| opponent_half_21-50 | Punt | 156 | 4.0 / 5.0 / 8.0 |
| opponent_half_21-50 | QB kneel | 209 | 2.0 / 4.0 / 8.0 |
| opponent_half_21-50 | Touchdown | 512 | 3.0 / 7.0 / 11.0 |
| opponent_half_21-50 | Turnover | 103 | 1.0 / 4.0 / 8.0 |
| opponent_half_21-50 | Turnover on downs | 85 | 4.0 / 6.0 / 11.0 |
| own_half_51-80 | End of half | 332 | 3.0 / 5.0 / 11.0 |
| own_half_51-80 | Field goal | 2115 | 7.0 / 11.0 / 16.0 |
| own_half_51-80 | First down | 6 | 6.0 / 10.5 / 13.0 |
| own_half_51-80 | Missed field goal | 373 | 7.0 / 10.0 / 14.0 |
| own_half_51-80 | Opp touchdown | 150 | 2.0 / 5.0 / 9.0 |
| own_half_51-80 | Punt | 4926 | 4.0 / 6.0 / 9.0 |
| own_half_51-80 | QB kneel | 469 | 2.0 / 3.0 / 12.0 |
| own_half_51-80 | Safety | 7 | 3.2 / 5.0 / 7.0 |
| own_half_51-80 | Touchdown | 2974 | 6.0 / 11.0 / 16.0 |
| own_half_51-80 | Turnover | 1428 | 2.0 / 5.0 / 10.0 |
| own_half_51-80 | Turnover on downs | 845 | 5.0 / 9.0 / 14.0 |
| red_zone_0-20 | Field goal | 85 | 4.0 / 5.0 / 8.0 |
| red_zone_0-20 | Missed field goal | 3 | 4.2 / 5.0 / 6.6 |
| red_zone_0-20 | Opp touchdown | 1 | 4.0 / 4.0 / 4.0 |
| red_zone_0-20 | QB kneel | 19 | 2.0 / 4.0 / 6.0 |
| red_zone_0-20 | Touchdown | 167 | 2.0 / 4.0 / 6.0 |
| red_zone_0-20 | Turnover | 13 | 1.0 / 3.0 / 4.8 |
| red_zone_0-20 | Turnover on downs | 16 | 4.0 / 4.0 / 5.0 |
| unknown | End of half | 40 | 2.0 / 2.0 / 2.0 |
| unknown | Field goal | 7 | 1.0 / 1.0 / 1.0 |
| unknown | First down | 16 | 1.0 / 1.0 / 1.0 |
| unknown | Missed field goal | 1 | 1.0 / 1.0 / 1.0 |
| unknown | Opp touchdown | 1 | 2.0 / 2.0 / 2.0 |
| unknown | Punt | 1 | 1.0 / 1.0 / 1.0 |
| unknown | Touchdown | 23 | 1.0 / 2.0 / 2.0 |
| unknown | Turnover | 2 | 1.0 / 1.0 / 1.0 |
| unknown | Turnover on downs | 1 | 1.0 / 1.0 / 1.0 |

Resolved drive terminal coverage: 19,388 drives. Drive groups with no terminal series_result: 0.

## Provenance and limits

- PBP rows SHA-256: `ba645cc87bafd70fc744d37f75f4c8111ee72019f247f8385293dc364a7f7f76`; official schedule score rows SHA-256: `ac9d3c5a2cb84156aa26f412795b3d5c02bb71b91b1dbc4c73e63edcfa0da4a5`.
- Conditions use down, distance, yardline_100 field zone, quarter and derived quarter-clock bands. All outcome fields remain retrospective source labels.
- `score differential` is not in this nfl_pbp schema. It is not imputed from score outcomes or schedule finals.
- Weeks 6–9 of 2022 were not queried. The observed set is development/reference evidence, not an untouched holdout.
- No 2022 tracking data, physical timing cohort, LP game payload, or simulator engine was read.

## Reproduction

```bash
python scripts/research/e3_conditional_pbp_distributions.py \
  --db /root/legendarypicks/backend/data/picks.dev.db \
  --json-output docs/evidence/e3/conditional-pbp-distributions-2022-2025-no-2022-wk6-9-2026-10-24.json \
  --markdown-output docs/evidence/e3/CONDITIONAL-PBP-DISTRIBUTIONS-2022-2025-NO-2022-WK6-9-2026-10-24.md
```
