# Team movement prior pilot (2026-10-24)

Research branch base: `research/gridiron-e3-physical-timing-2026-10-24` at `13b18faa9d9dbe78570df7d45636f2313f25d8ea`; this work is isolated from E3 artifacts.

This is a development-only pilot. It does not predict tackles, play outcomes, yards, scores, or games.

## Method

- Canonical LP snap cohort, weeks 1-5 only; 9,289 eligible play rows in the manifest.
- Weeks 1-4 fit the role-conditioned residual means and 2022 club residuals. Week 5 is held out for this check.
- Every arm uses only frames -10 through 0, the snap ball location, player position group, offense/defense side, play family, formation family, and nearest-opponent geometry to form inputs.
- Frames +5 and +10 are targets only. The football is read only at frame 0. No tackle frame, credited tackler, or play outcome field is used.
- The baseline extrapolates constant acceleration from the 1.0 s pre-snap history. The role arm adds a shrinkable historical role/context residual; the team arm adds a 2022 club residual shrunk by `n_plays/(n_plays+50)`. All errors are paired by play.
- Current roster seed is NE offense vs CHI defense, selected from the Oct. 22, 2026 roster snapshot. NE's top 2025 observed play attribute combination and team personnel profiles select the context.

## Week 5 paired position error

Mean of per-play mean Euclidean error across 22 players; meters. The bootstrap resamples games. These 16 games are development data, not a sealed test.

| Horizon | Constant acceleration | Role prior | Role + historical team | Role − baseline (95% game CI) | Role + team − baseline (95% game CI) | Plays |
|---:|---:|---:|---:|---:|---:|---:|
| 0.5s | 0.268 | 0.216 | 0.216 | -0.051 [-0.061, -0.041] | -0.052 [-0.062, -0.041] | 1859 |
| 1.0s | 1.071 | 0.792 | 0.789 | -0.279 [-0.304, -0.253] | -0.282 [-0.306, -0.256] | 1859 |

## Incremental team effect

At 0.5 s, adding the 2022 club residual changes error by -0.75 mm (95% game bootstrap [-1.40, -0.16] mm).
At 1.0 s, adding the 2022 club residual changes error by -2.28 mm (95% game bootstrap [-3.86, -0.83] mm).
This is a small within-season development gain, and the 2022 team effect cannot be carried into 2026 from 2025-26 coach continuity alone. It does not justify a more complex current-team movement policy yet. The role-conditioned prior merits a later untouched evaluation; weeks 6-9 remain reserved.

## Cohort and limits

Week 5 tracked eligible rows seen: 1867; plays with snap-available 22-player inputs: 1859; full-22 labels at both horizons and scored plays: 1859.
The full manifest is preserved. Non-run/pass administrative snaps remain in the cohort inventory but are not used to fit this movement prior. Future-frame availability censors scoring labels only; it is not used to choose players, form inputs, or choose the generated snap template.
The existing all-week generic locomotion comparison reported 0.206 m at 0.5 s and 0.921 m at 1.0 s, but this report's fair paired comparison is the week-5 constant-acceleration arm above; the folds and model inputs differ from that descriptive all-week result.
The 22-person lineup uses available roster players ranked by estimated overall within positional role; it maps those players into historical lateral-rank slots. This is a synthetic lineup proxy, not a verified starting 22 or an assignment sheet.
2022 NE/CHI residuals are historical franchise labels, not 2026 system labels. The available continuity file bridges 2025-26 only; therefore the generated 2026 roster paths use the league role prior and expose, but do not apply, the 2022 team residual.
The seed has 22 current players, role and roster/rating/physics fields, and 0/0.5/1.0 s position estimates. The unchanged 120 Hz Player.locomote() applies each player's current physics profile to the role-prior waypoints. Other-player geometry is only snap-time context; there is no post-snap assignment response, collision response, or future ball trajectory. Madden-style ratings are retained for analysis but are not directly mapped to movement because the historical tracking cohort has no matched Madden ratings for these players.
Tracking is 10 Hz, has no whistle timestamp, and has no stoppage attribution. Weeks 6-9 were not opened.

## Input and output hashes

- `bdb_players`: `dc2b5f923e84a16d789d999e88aea670b5495436ab88c24aef7b97b07d723626`
- `bdb_plays`: `a103cbc3a1ddf7678cb6d77ea5f9919c4292b5d55c7876f7cad6cce3d62dca04`
- `canonical_cohort`: `45325d55103da9a7eca5139f3fda9506cb38d8f0af76d7753868c8f40fbd548a`
- `chi_playbook`: `d4e589b0bf45ad319ece0d4b5b0a85eea78dc0edd25328cbaa23e6b911e81039`
- `coaching_continuity`: `299ee43b7852333c843549b3f752e6ff136e772b70f5a17deb9f498a47ce4441`
- `current_roster_snapshot`: `8d23885500e7c51cc1e21a2520baa959aa626524804910f461ecb3b5cd95c9ad`
- `ne_playbook`: `8a95fe75a4b0c9d3fce5b92649115387d9fcbe5d218a6dad828d96b28f206c19`
- `tracking_week_1`: `9209d77f247a3080a4b8f3a7dd5600336f9e129f5eaa574227445a3424a0659e`
- `tracking_week_2`: `ae807a89609096659eb9e142fbedab60a093052528578911cad57550a329e0df`
- `tracking_week_3`: `1f55568476ce298d2cce5b6da89bed0f2bc4eac8767542ed1e6ebdb0bfae1d3a`
- `tracking_week_4`: `cc7d436dce5c38f661fd9e530e0bbf7c1e295b29be3bd76327f4814f14b4e251`
- `tracking_week_5`: `a0ce6350e4a65d50ef23a95eba5a2fc9c39ea415f74229073ab34cff28248c92`
- generated seed scene SHA-256: `cc911c7b443886644d3d39866ce5e9375d5ca9e30763532ad57a2352bbacb269`

The week-5 per-play CSV and machine-readable summary are beside this document.
