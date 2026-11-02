# HPV1 data contract, 2022 to 2025: personnel, play classes, observed joint records

Status: research only. Data contract and coverage report. It defines what HPV1 may use and what it may not. It does not
implement a simulator sampling layer, and it does not approve any feature for simulation. No 2026 input is read. No SLC
default changes. Nothing is deployed or merged.

Outputs (counts only, no play or player IDs): `docs/research/hpv1-contract-2026-11-02/`
- `hpv1-counts.json`: coverage, classes, vocabulary, package and formation counts, missingness, identity, reconciliation,
  roster coverage, and the input manifest (SHA-256 and bytes of the 10 inputs, builder commit).
- `joint-observed-counts.csv`: observed joint records only (1,622 / 1,098 / 1,025 / 1,036 keys; 139,798 plays).
- `package-counts.csv`, `play-classes.csv`.

Code: `pipeline/hpv1_contract.py` (rules), `pipeline/hpv1_build.py` (build). Tests: `test/test_hpv1_contract.py`, 32 tests.
Run the build with `python3 pipeline/hpv1_build.py` (about 18 seconds). Read the package columns as text: codes such as
`01` and `00` are two-digit strings and become numbers in a default CSV reader.

## 1. Inputs and guards

Only these files are read: `pbp_{2022..2025}.csv.gz`, `pbp_participation_{2022..2025}.csv`, `roster_weekly_2025.csv.gz`
(REG rows, coverage only) and `players.csv` (identity crosswalk). The build refuses any input whose name carries a season
outside 2022 to 2025 (`check_input_paths`). The raw directory also holds 2026 files and ESPN roster JSON stamped 2026; they
are not read. Season is taken from the file name, not from a column.

## 2. Schema (one record per participation row)

| Field | Type and allowed values | Rule |
|---|---|---|
| `season` | 2022, 2023, 2024, 2025 | from the file name |
| `play_class` | `scrimmage`, `two_point`, `fake_kick`, `cross_side_label`, `non_play`, `participation_only`, `other:<pbp play type>` | first matching rule in section 3 |
| `play_family` | `run`, `pass`, `UNKNOWN` | pbp `play_type`, only for run or pass |
| `package` | two-digit string, RB count then TE count, or `UNKNOWN` | the SLC `personnel_code` convention (RB and TE only) |
| `package_comparable` | two-digit string, (RB + FB) count then TE count, or `UNKNOWN` | the cross-season code (section 4) |
| `rb`, `te`, `wr`, `fb`, `qb` | counts or null | `fb` and `qb` are null in 2022 (not observable, not zero) |
| `players_listed` | integer | sum of listed counts |
| `vocabulary` | `skill_only`, `ol_group` (2022), `full` (2023 onward) | season-specific |
| `personnel_reason` | `ok`, `null`, `unparseable`, `cross_side_label`, `special_teams_token`, `unexpected_vocabulary` | why `package` is or is not known |
| `formation` | published `offense_formation`, season-specific label, or `UNKNOWN` | 2022 non-gun labels are prefixed `2022_` |
| `down` | 1 to 4 or `UNKNOWN` | pbp `down` |
| `distance` | bucket `d1_2` ... `d15p` (SLC boundaries) or `UNKNOWN` | pbp `ydstogo`; a value outside 1 to 99 is `OUT_OF_RANGE` and counted |
| `red_zone` | 0, 1 or `UNKNOWN` | pbp `yardline_100` at most 20 |

Only `play_class = scrimmage` rows enter the joint table and the package and formation distributions.

## 3. Play classes (first match wins)

1. `non_play`: pbp `play_type` is missing (2022: 1,449 rows; 2023: 8).
2. `two_point`: pbp `two_point_attempt` is 1. These rows are coded as run or pass, and most carry no other marker
   (in 2022, 121 of 126 run or pass two-point rows had no defensive or special-teams token), so the flag is what excludes them.
3. `fake_kick`: a run or pass row whose description contains `Kick formation`, `Punt formation`, `Field Goal` or
   `Extra Point`, or whose personnel carries a K, P or LS token. nflverse `special_teams_play` is 0 on every such row, so
   that flag cannot be used.
4. `cross_side_label`: a run or pass row whose offense personnel carries a defensive position token.
5. `scrimmage`: any other run or pass row.
6. `participation_only`: a participation row with no pbp row (2022: 716, all with `n_offense` 0 and no personnel).
7. `other:<type>`: kickoff, punt, field goal, extra point, no play, kneel, spike.

## 4. Normalization rules and the two package codes

**Vocabulary by season.** 2022 strings list skill positions (`1 RB, 1 TE, 3 WR`, 34,180 scrimmage rows) or an `OL` group
count (`6 OL, 2 RB, 0 TE, 2 WR`, 1,063 rows). They never list a QB or a fullback. In the OL-group rows the total is 10
(1,041 of 1,063 scrimmage rows, from the build), which is consistent with the QB being left out. 2023 onward lists every position on the field
(`1 C, 2 G, 1 QB, 1 RB, 2 T, 1 TE, 3 WR`), and the total equals `n_offense` on every scrimmage play. A 2023 or later
`OL` token is recorded as `unexpected_vocabulary`, not parsed.

**Two package codes, because 2022 cannot separate fullbacks.** The 2022 vocabulary has no `FB` token. Fullbacks appear on
8.3%, 7.9% and 8.6% of scrimmage plays in 2023, 2024 and 2025 (2,954 / 2,757 / 2,950 plays). Two checks on the 2022 coding:
- The RB-only two-back share (`21`) is 8.2% in 2022 but 1.7%, 1.7% and 1.9% in 2023, 2024 and 2025.
- Merging FB into RB for 2023 to 2025 gives `21` shares of 7.5%, 6.4% and 7.0%, close to 2022.

That pattern is what it would look like if 2022 coded fullbacks as running backs. It is an inference from distributions,
not a labelled fact. The contract therefore uses `package_comparable` (RB plus FB) for any cross-season comparison, and
keeps `package` (RB only) because it is the SLC `personnel_code` definition. SLC's `personnel_code` is unchanged.

**Cross-side tokens.** A defensive position on an offense player's line (for example `1 OLB` in an offensive set). The
offense and defense player IDs did not overlap on any run or pass row checked (2022 to 2025), so this is a position
label on an offense player, not a defender on the field. The package is `UNKNOWN` for the whole play. Which label is wrong cannot be known, and
guessing would change the RB or TE count.

**Special-teams tokens.** K, P and LS on run or pass rows are fake kicks, classed `fake_kick` (section 3).

**Not used.** The builder's shotgun field, FTN `qb_location`, and any fill of formation from FTN. Shotgun-dependent features
are not approved for 2022 (owner decision, D2).

## 5. Normalized counts (scrimmage class)

| Season | Scrimmage plays | `cross_side_label` | `fake_kick` | `two_point` | `non_play` | `participation_only` |
|---|---:|---:|---:|---:|---:|---:|
| 2022 | 35,243 | 33 | 28 | 128 | 1,449 | 716 |
| 2023 | 35,398 | 50 | 26 | 132 | 8 | 0 |
| 2024 | 34,815 | 62 | 25 | 148 | 0 | 0 |
| 2025 | 34,342 | 145 | 15 | 130 | 0 | 0 |

Comparable package shares of scrimmage plays (`package_comparable`):

| Code (RB+FB, TE) | 2022 | 2023 | 2024 | 2025 |
|---|---:|---:|---:|---:|
| `11` | 62.9% | 64.2% | 62.8% | 58.8% |
| `12` | 20.0% | 20.3% | 23.3% | 24.0% |
| `21` | 8.2% | 7.5% | 6.4% | 7.0% |
| `13` | 4.1% | 3.4% | 3.6% | 5.2% |
| `22` | 2.8% | 1.5% | 1.9% | 2.6% |
| `10` | 0.8% | 1.3% | 0.5% | 0.8% |

The 2025 share of `11` is lower and of `13` higher than in earlier seasons. That could be real, or a 2025 coding change, and
the contract does not decide which.

Rare back counts: 15 / 16 / 13 / 9 scrimmage plays a season have three or more backs (RB plus FB). The strings are plausible
(for example `1 C, 1 FB, 2 G, 1 QB, 2 RB, 2 T, 2 WR`), so they are kept as observed.

Formation (scrimmage class; published labels, no fill):

| Season | Labels | Nulls |
|---|---|---:|
| 2022 | `SHOTGUN` 19,540; `2022_SINGLEBACK` 8,603; `2022_EMPTY` 2,869; `2022_I_FORM` 2,150; `PISTOL` 1,526; `2022_JUMBO` 303; `2022_WILDCAT` 249 | 3 |
| 2023 | `SHOTGUN` 24,258; `UNDER CENTER` 9,658; `PISTOL` 1,401 | 81 |
| 2024 | `SHOTGUN` 21,565; `UNDER CENTER` 9,967; `PISTOL` 3,268 | 15 |
| 2025 | `SHOTGUN` 21,021; `UNDER CENTER` 11,631; `PISTOL` 1,643 | 47 |

2022 has seven formation labels and 2023 onward has three. There is no verified mapping between them, so `2022_SINGLEBACK`
and `2022_I_FORM` are not mapped to `UNDER CENTER`. Down and distance are known on every scrimmage play in every season.

## 6. Source quality, coverage and missingness

**Join coverage** (participation to pbp on `nflverse_game_id` and `play_id`, all season types, duplicates refused):
- Run and pass pbp rows with no participation row: 0 in every season.
- 2022: 49,434 pbp rows, all matched. Participation rows with no pbp row: 716.
- 2023 to 2025: all participation rows matched. pbp rows with no participation row: 3,497 / 3,573 / 3,587. Of these,
  about 1,445 a season are markers with no play type (`GAME`, `END QUARTER n`, `END GAME`) and 2,053 / 2,127 / 2,142 are
  `no_play` rows (timeouts and similar). None is a run or pass.
- Duplicate keys: 0 on either side.

**Cross-side label rate, scrimmage class:** 33 of 35,243 (0.09%), 50 of 35,398 (0.14%), 62 of 34,815 (0.18%), 145 of 34,342
(0.42%). The 2025 rise is driven by CB labels: 90 offensive player-labels in 2025, against 2 in 2023 and 5 in 2024. This is a
source-quality flag for the 2025 participation file. HPV1 excludes these plays, and the flag does not change the excluded
count.

**Missingness:** on scrimmage plays, personnel is never null (2022 to 2025). Formation is null on 3, 81, 15 and 47 plays.
Down, distance and red zone are never null. Across all participation rows, personnel is null on 11,922 rows in 2022
(kickoffs, punts, no-plays, and the participation-only rows). It is null on none in 2023 to 2025.

**Reconciliation:** `joint_total` equals `scrimmage_total` in every season (35,243 / 35,398 / 34,815 / 34,342), and the build
stops if it does not. The defense-label positions by class are in `hpv1-counts.json` under `reconciliation`.

## 7. Identity: on-field evidence versus personnel counts

- **Player IDs (all seasons):** on every scrimmage play the count of offense player IDs equals `n_offense` (100%). All
  offense IDs are in `players.csv` (100%, 387,670 / 389,374 / 382,965 / 377,755 IDs by season).
- **Names, positions and numbers (2023 to 2025 only):** complete on every scrimmage play (no nulls). The position list
  equals the personnel token multiset on every scrimmage play (100%). 2022 has no names, positions or numbers.
- **Consequence:** 2022 supports personnel counts and player IDs, but not position-level identity. Personnel counts from
  2023 onward can be checked against the position list.
- **Roster, 2025 REG (team, week, gsis_id):** 359,064 of 359,220 offense IDs (99.96%) are on the same team's weekly roster
  for that week. 156 of 32,657 plays have at least one unmatched ID. This is an outcome-side check. It shows the IDs are on
  the roster, not that the roster was known before kickoff.

## 8. Pregame eligibility: not available

Held-out participation (`offense_players`, `offense_names`, `offense_positions`, `offense_numbers`) is not a pregame input.
`assert_pregame_source` refuses those columns, and refuses any roster source without an as-of time.

- **2022 to 2024:** no roster or depth-chart file for these seasons is in the raw directory. Eligibility is not available.
- **2025:** `roster_weekly_2025` has status values ACT, DEV, RES, INA, CUT, RET, EXE, TRD and TRC, and no publication
  time. It is a candidate only. Its as-of time before kickoff has to be verified from the source before use.

## 9. Joint records (observed only)

`joint-observed-counts.csv` has one row per observed combination of season, play family, formation, `package_comparable`,
down, distance bucket and red zone. It holds 1,622 / 1,098 / 1,025 / 1,036 keys and 139,798 plays. No combination is
built from marginals. A key is present only when at least one scrimmage play had it. Formation `UNKNOWN` occurs in 146
plays and `UNKNOWN` does not appear in down, distance or red zone.

## 10. Join requirements

1. Key: `participation.nflverse_game_id` with `participation.play_id` against `pbp.game_id` with `pbp.play_id`. Both season
   types are needed (2022 has 2,277 POST rows in the participation file).
2. Duplicate keys on either side stop the build.
3. pbp fields: `play_type`, `season_type`, `posteam`, `week`, `down`, `ydstogo`, `yardline_100`, `desc`, `two_point_attempt`.
4. Roster coverage join: (`team` = `posteam`, `week`, `gsis_id`), REG rows only, 2025 only.
5. Identity crosswalk: `gsis_id` in `players.csv`.
6. Season from the file name. Never from a row value.

## 11. Tests

`test/test_hpv1_contract.py`: 32 tests, all passing (`python3 test/test_hpv1_contract.py`). The tests were written first and
failed on import before the module existed. They cover: vocabulary by season (2022 skill-only, 2022 OL-group with no QB,
2023 full), fullbacks (not observable in 2022, separate in 2023, counted with running backs in the comparable code),
cross-side and special-teams tokens, null and unparseable strings (recorded, not raised, and not zero), season refusal,
play classes (two-point, fake kick, cross-side, non-play, other), situation buckets and season-specific formation labels,
observed-only joint records, duplicate-key refusal, two-sided join coverage, 2026 input refusal, 2022 to 2025 inputs
allowed, and the pregame guard.

## 12. Decisions needed from the owner

1. **Cross-season package code.** Use `package_comparable` (RB plus FB) for HPV1 comparisons, or keep the RB-only SLC
   definition (not comparable with 2022). The contract recommends the comparable code. Confirm it before any HPV1 modelling.
2. **Pregame eligibility source for 2022 to 2025.** None is in the raw directory for 2022 to 2024. Needs a roster or depth
   snapshot with a publication time before kickoff. Participation IDs are not an option.
3. **Formation mapping across 2022 and 2023 onward.** No mapping is approved. Until one is, formation is season-specific.
4. **2025 cross-side labels.** The 2025 CB-label rise needs a source-quality check before 2025 is used for personnel
   shares. The contract currently excludes these plays.

## 13. Not done

- No simulator sampling layer, no player-share model and no eligibility build. The contract must pass review first.
- No 2026 input read. No merge to `main`. No deployment. No change to SLC defaults.
- The historical 2022 to 2024 playbook artifacts are unchanged. Their storage and restore notes are in
  `historical-2022-2024-v2/RESTORE.md`. That storage is one copy on this machine with no off-box copy, and the raw source
  files are not in the archive.
