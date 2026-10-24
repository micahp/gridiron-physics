# The rating engine

`pipeline/ratings.py` gives every player on both rosters two things:

1. **Madden-style attributes** on a 0–99 scale (SPD, ACC, AGI, STR, JMP, AWR, THP, THA, CTH, RTE, BCV, ELU, BTK, TRK, CAR, RBK, PBK, PMV, FMV, BSH, TAK, POW, PUR, PRC, MCV, ZCV, PRS, KPW, KAC, …) and a position OVR.
2. **A physical body** for the simulator: mass, collision radius, top speed `v_max`, acceleration time constant `τ`, maximum propulsive force `F0`, leg drive when engaged, lateral (cutting) acceleration, and reach.

Physical attributes and the physics body come from the same numbers. A player's SPD rating and the speed he actually runs at in the sim are two views of one 40-yard dash.

## What public research exists on Madden ratings?

There is **no published EA formula** and very little peer-reviewed work on Madden ratings themselves. Here is what is public:

| Source | What it tells us |
|---|---|
| CBS SF interview with Madden's ratings analyst (2014) | Speed is set from the 40-yard dash, **acceleration from the 10-yard split**, agility from the 20-yard shuttle. Film is used to "capture game speed with pads on". |
| [Madden School, 40 → SPD testing](https://madden-school.com/madden-21-scouting-guide-how-combine-results-affect-physical-attributes) | Community testing across years of rookie ratings. A 40 time maps to a narrow band of SPD (a 4.51 lands at 87–91, usually 88–89). Position barely matters. QBs get about −2. |
| [FiveThirtyEight: "Madden's player speed scores are surprisingly good"](https://fivethirtyeight.com/features/maddens-player-speed-scores-are-surprisingly-good-but-whose-ratings-did-the-game-get-wrong) | A multilevel model predicts Madden speed from combine 40s plus Next Gen Stats max speed by position. It concludes EA also uses tracking data. |
| [FiveThirtyEight: team speed](https://fivethirtyeight.com/features/another-way-to-measure-the-nfls-fastest-teams-and-more-evidence-it-doesnt-matter) | Madden team speed correlates only weakly (≈ −0.31) with a 40-time-based measure. |
| [Univ. of Minnesota, Dengel](https://news.cehd.umn.edu/dengel-dengel-publishes-part-two-on-madden-nfl-video-game) | An informal look at body composition vs. Madden OVR and category scores (blog, not peer-reviewed). |

The research on **whether the inputs mean anything** is much deeper:

- **Kuzmits & Adams (2008)**, *J Strength Cond Res* 22(6):1721–7. Across QBs, RBs and WRs drafted 1999–2004, combine drills did not predict NFL performance, with one exception: the **40 predicted RB success**. That's why skill ratings here come from production, not drills.
- **Robbins (2010)**, *J Strength Cond Res*. Normalising combine data by position improves its relationship with draft order. That's why missing drills here are estimated relative to body type and position, not raw.
- **Clark, Rieger, Bruno & Stearne (2019)**, *J Strength Cond Res*, "The NFL Combine 40-yd dash: how important is maximum velocity?" Max velocity explains 94% of the variance in the 36.6 m time. Fast and slow athletes accelerate in nearly the same pattern relative to their own top speed. That justifies deriving the whole sprint curve from one 40 time.
- **Samozino et al. (2016)**, *Scand J Med Sci Sports* 26(6):648–658, doi:10.1111/sms.12490. The mono-exponential sprint model `v(t) = v_max(1 − e^(−t/τ))` and the linear force–velocity profile `F(v) = F0(1 − v/v_max)` it implies, validated against force plates.

## Pipeline

### 1. Identity

ESPN athlete id → nflverse `players.csv` (ESPN ↔ GSIS ↔ PFR crosswalk, draft slot). All 161 rostered players match.

### 2. Measurables

The nflverse `combine.csv` covers every combine since 2000 (8,968 athletes). For each position group and drill, we fit `drill ≈ a + b·weight + c·height` by least squares and store the residual SD (coefficients are in `data/ratings.json → meta.regressions`). A player who skipped a drill gets the body-type prediction, and the drill is flagged `est.` in the UI. Each real drill is also expressed as a residual z-score: how much better than expected for his size.

### 3. Physics from the 40

Given the 40 time, body mass `m` and broad-jump residual `z_bj`:

```
τ     = 0.86 + 0.0021·(m − 90) − 0.035·z_bj      (clamped 0.75–1.20 s)
v_max : solve 36.58 = v_max·(t − τ(1 − e^(−t/τ)))  at t = 40 time
F0    = m · v_max / τ
t10   : time to 9.14 m under the same curve  →  ACC
```

`τ` varies only modestly, as Clark et al. found. Explosive (broad jump) and lighter athletes get a smaller `τ`. The sim uses `v_max × 0.96` ("game speed with pads on"), minus 0.6% per year past age 28. Some sample outputs: a 4.38 receiver (Marvin Mims Jr.) gets `v_max` ≈ 9.8 m/s (21.9 mph), and a 4.99 guard (Quinn Meinerz) ≈ 8.6 m/s. NFL Next Gen Stats tracking (10 Hz, as published in the Big Data Bowl data) tops out around 22–23 mph, so the scale is right.

### 4. Physical ratings

| Rating | Source |
|---|---|
| SPD | 40 time through the community-measured Madden curve (4.22→99, 4.40→93, 4.50→89, 4.60→85, 4.80→77, 5.00→69, 5.30→57), −1/yr past 28, QB −2 |
| ACC | Modelled 10-yard time (1.50 s→95, 1.60→85, 1.70→75, 1.85→60) |
| AGI | 3-cone + shuttle, league-pooled z |
| STR | Bench reps z + 0.11 per lb over 230 |
| JMP | Vertical (inches) through a fixed curve |

### 5. Skill ratings from production

Rates come from the 2025 regular season plus 2026 weeks 1–5. Week 6, the reconstructed game, is excluded so the game cannot leak into its own ratings. 2026 counts 1.5×.

Each rate is **shrunk toward the position mean** (empirical Bayes: `(x + k·μ)/(n + k)`, where `k` is a pseudo-sample of e.g. 150 attempts for CPOE). It is then z-scored against every NFL player at the position and blended with a **draft-capital prior** (#1 overall ≈ +1.2σ, undrafted ≈ −0.9σ), weighted by how much evidence the player has. The `confidence` field records that weight. Examples:

| Attribute | Production inputs |
|---|---|
| THA | CPOE, YPA, INT rate, EPA/play |
| THP | air yards/att, 20+ yd completions, YPA (+ broad-jump residual) |
| CTH (WR/TE) | catches over expected, with expected catch rate decreasing with aDOT |
| RTE | target share, first downs/target, yards/target |
| BCV / ELU / BTK | rushing EPA, 10+ yd run rate, YPC, YAC |
| PMV / FMV | (sacks + ½ QB hits)/game, plus strength or agility |
| BSH / TAK / PUR | TFL/game, tackles/game, speed |
| MCV / ZCV | (PD + 2·INT)/game |
| KPW / KAC | 50+ yd FGs, FG%, XP%; punters gross, net, inside-20 |
| AWR | experience curve + draft prior, blended with **playing-time share** (the depth chart is the coaches' own rating) |

**Offensive linemen** have no clean public production stat (pressures allowed is proprietary charting). Their PBK/RBK come from strength, burst, mass, draft capital and experience, and are flagged `confidence: 0`.

### 6. OVR

Each position has a weighted formula, e.g. `QB = 5·THA + 3·THP + 4·AWR + …`. The raw score is turned into a **percentile among all 1,686 active NFL players at that position**, all rated by the same pipeline. That percentile is then mapped onto a Madden-shaped scale (median 72, 90th pct 86, 99.5th 97). An OVR is "where he ranks league-wide", not an arbitrary number.

## Known limitations

- Production-driven ratings are noisy for low-volume players. Two examples: a returner-heavy RB (Velus Jones Jr.) rates high on speed, and a corner with a big takeaway year (Riley Moss) outranks Pat Surtain II.
- No public data separates route running from QB/scheme. RTE leans on target share.
- OL ratings are tools-and-pedigree estimates.
- The Madden SPD curve is fan-measured; EA's exact mapping is private.

## Patriots–Bears pregame snapshot

`pipeline/build_matchup_snapshot.py` reuses `pipeline/ratings.py`'s `CombineModel`, `SkillModel`, `physical_profile`, `skill_ratings`, and `OvrCalibration`; it does not introduce a parallel rating formula. For the Oct. 22, 2026 snapshot, the builder sets the shared rating framework to include 2025 regular-season totals plus 2026 Weeks 1–6, then rates players on nflverse's 2026 Week 7 regular-season roster. The official Week 7 inactive list is applied after roster identity joins.

The result is `data/teams/matchup-2026-10-22.json`. It carries stable GSIS IDs, team membership, listed position and depth-chart position, status/availability, all 35 attributes, physical parameters, combine measurables, imputed-drill names, and per-attribute evidence confidence. Week 7 depth-chart position has role labels but not a complete official ordering; demo unit selection is an explicitly labeled rating-based proxy. Roster changes versus the 2025 Week 18 roster are membership differences only, not claims about why a player moved.

These values are estimated public-research ratings, not EA ratings or measured tracking. See [the frozen roster and ratings inputs](../data/teams/matchup-2026-10-22.json) and [the team/venue interface](MATCHUP-CONFIGURATION.md) for sources and availability handling. Rebuild with `python3 pipeline/build_matchup_snapshot.py` after fetching the pinned files.
