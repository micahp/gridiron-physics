# Team-season playbook research build

**Status:** Part A complete; awaiting review before the Part B movement evaluation.

## Scope and sources

The research build covers 32 teams for each regular season from 2022 through 2025, plus 2026 Weeks 1–7 only: 160 team-season profiles total. The 2026 season is treated as a sealed descriptive holdout. Participation data is unavailable for 2026, so participation fields are marked missing rather than zero. Postseason plays are excluded.

Inputs are nflverse play-by-play for 2022–2026, participation for 2022–2025, and FTN charting for 2022–2026. The build records each asset's URL and SHA-256 in the generated profiles and manifest. FTN charting fields and attribution follow the [nflverse FTN charting documentation](https://nflreadr.nflverse.com/reference/load_ftn_charting.html) and [field dictionary](https://nflverse.r-universe.dev/nflreadr/doc/dictionary_ftn_charting.html).

## Build counts

| Season | Regular-season PBP games | Teams |
|---:|---:|---:|
| 2022 | 271 | 32 |
| 2023 | 272 | 32 |
| 2024 | 272 | 32 |
| 2025 | 272 | 32 |
| 2026 Weeks 1–7 | 107 | 32 |

The build emitted 147,317 eligible offense plays and 147,317 eligible defense plays. Participation joined to 268,276 of 294,634 side-play records; all 26,358 missing joins are from 2026. FTN charting joined to 294,190 records; 444 records lack a charting join. FTN covers 106 of the 107 2026 games; `2026_07_DAL_PHI` has no FTN charting row.

## Reconciliation gates

The NE-2025 and CHI-2025 reproduction check passed byte-for-byte against the existing legacy outputs:

- NE-2025 SHA-256: `8a95fe75a4b0c9d3fce5b92649115387d9fcbe5d218a6dad828d96b28f206c19`
- CHI-2025 SHA-256: `d4e589b0bf45ad319ece0d4b5b0a85eea78dc0edd25328cbaa23e6b911e81039`

For every profile, emitted play records equal eligible play counts, and distribution category counts and observed/missing counts reconcile to their denominators.

The 2022–2024 shotgun comparison groups Pistol with shotgun in all years; 2022 participation additionally labels Empty and Wildcat separately, and those are grouped with shotgun for this comparison. Sixteen team-seasons exceed the 1 percentage-point tolerance:

- **2023:** ARI (1.031 pp), CLE (1.279), DET (1.347), NE (1.182), NYG (1.242), NYJ (1.336).
- **2024:** CHI (1.605 pp), DET (1.003), IND (1.065), JAX (1.009), LV (1.045), NE (1.273), NO (1.658), NYG (1.525), NYJ (1.382), TB (1.110).

All 2022 teams met the tolerance. The 16 exceptions are disclosed as gate failures; they were not adjusted to force reconciliation.

## Boundaries

This work did not run the simulator, fit probabilities, evaluate movement, or change engine defaults or director outcome constraints. Part B has not started. The document-only branch contains no generated profile JSON, manifest, or other playbook data artifacts.
