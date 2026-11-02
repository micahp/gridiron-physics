# Historical playbooks 2022 to 2024: validation status

Date: 2026-11-02. Status: research only. Not a final acceptance. The revised Gate 3 is **not passed**. No 2026 file was read.

## Verdict

- **M3 folds (playbook prior for cutoffs 2023, 2024, 2025): ready for the prior.** The loader reads the season before each cutoff, is deterministic, and its labelled totals equal an independent recount from the observation streams. The prior uses run gap, pass depth, and pass location only, none of which depend on shotgun. The 2022 R1 failures and TB 2024 do not enter it.
- **Shotgun-dependent features: not ready from 2022.** Fifteen 2022 team-seasons fail R1, and the new population omits 227 plays that the rev3 profiles include (see R2). Any shotgun feature must use the provenance sidecar and exclude or label `pbp_flag` rows and PBP disagreements.
- **HPV1 historical variation: not ready as-is.** The team profiles carry personnel, personnel code, formation, and shotgun, but `playbook_prior.load` reads only families C, D, and E. HPV1 needs a personnel family mapping and a spec decision before the experiment starts.
- **Revised gate: not passed.** 2022 R1 fails in 15 team-seasons. TB 2024 stays open under the gate's rule.

## What was built

- Build directory, outside git: `/root/gridiron-playbook-builds/historical-2022-2024`, 1.8 GB. Contents: 96 team-season profiles (`{TEAM}-{season}.json`), `observations-{2022,2023,2024}.jsonl`, `BUILD-REPORT-{season}.md`, `build-manifest.{season}.json`, `shotgun-provenance-{season}.jsonl`, `shotgun-provenance-summary.json`, and `SHA256SUMS.txt` (109 entries).
- `SHA256SUMS.txt` SHA-256: `0ade84bc70f0984c088a67eb128fc487a1cccb1d473e5e5fa36099649d5ee5bc`. The copy in `docs/research/historical-2022-2024/` is identical.
- Builder: `pipeline/build_playbooks.py` blob `facd9f51f395206d76572af8d10eeb1617e4b8313e00e9609f282eca8613874d` (matches HEAD). Export: `pipeline/build_historical_playbooks.py` blob `09204b13bcb95641ed108b395514a81518234a075ffd0f09c0cfdb0ce1da72fe`.
- One season per process, RSS capped at 2,457,600 KB. Peak RSS: 2022 1,784,156 KB, 2023 1,875,492 KB, 2024 1,866,968 KB. All three exited 0 and no cap was hit.
- Source pins: all three PBP, FTN, and participation inputs per season match `RESEARCH_SOURCE_PINS` (checked again by `pipeline/verify_historical_shotgun.py`).

## Population and denominators

| Season | Build report eligible offense plays | Profile population (`eligible_scrimmage_plays`) | Plays outside population | Sidecar rows |
|---|---:|---:|---:|---:|
| 2022 | 33,770 | 33,519 | 251 | 33,519 |
| 2023 | 33,957 | 33,721 | 236 | 33,721 |
| 2024 | 33,470 | 33,204 | 266 | 33,204 |

- The build report uses the Gate 3 denominator. The profile population is a strict subset: zero plays are new in the profile.
- 2022 plays outside the population (earlier analysis, scratch `population_diff.py`): fumble or aborted 111, two-point 118, penalty-only 2, unflagged `special_teams_run_pass` 20.
- Open: some `special_teams_run_pass` plays have a participation formation that is blank or SHOTGUN. The classifier is the source of truth for this population, but the inconsistency is not resolved.

## Old 1.0-point gate (kept, not changed)

- The 16 flagged team-seasons reproduce exactly: 2023 ARI, CLE, DET, NE, NYG, NYJ; 2024 CHI, DET, IND, JAX, LV, NE, NO, NYG, NYJ, TB. They stay as failures.
- Percentage-point values: 89 of 96 match the Gate 3 table at three decimals. Seven differ by 0.001 pp: 2022 JAX (build 0.751, Gate 3 0.750), 2023 DET (1.347 vs 1.346), 2024 BUF (0.298 vs 0.299), CAR (0.810 vs 0.811), CIN (0.093 vs 0.094), NO (1.658 vs 1.659), TEN (0.876 vs 0.875).
- Cause: the builder rounds the difference to six decimals as a fraction and then to three decimals as pp (double rounding). Gate 3 (`pipeline/reconcile_shotgun_sources.py`) rounds once. Both models reproduce their own values for all 96 team-seasons. No pass or fail changes. The builder's report formatting should be fixed at the next rebuild. This is not changed here.
- Gate 3 committed hashes: `gate3_summary.json` e26a1f4b..., `team_season_sources.csv` 06c20162..., `unresolved_plays.csv` e0ccaba4.... The committed script reproduced the first three byte-for-byte when run on a scratch copy. `gate3_failing_disputed_source_values.csv` (38e6053c...) is not produced by that script and is checked only as a committed fixture.

## Revised gate (Gate 3, rules unchanged)

**R1, FTN vs participation agreement at least 99.0%.** Fails in 15 team-seasons in 2022. Recomputed on the new population with `pipeline/verify_historical_shotgun.py`; the same 15 fail. 2023 and 2024 have no failures. The new denominators are no larger than Gate 3's for every team-season.

| Team | New population (agree / both) | Rate | Gate 3 (agree / both) | Gate 3 rate |
|---|---:|---:|---:|---:|
| ATL | 979 / 990 | 0.9889 | 984 / 995 | 0.9889 |
| BAL | 1008 / 1021 | 0.9873 | 1012 / 1025 | 0.9873 |
| CAR | 950 / 960 | 0.9896 | 956 / 966 | 0.9896 |
| CHI | 959 / 969 | 0.9897 | 968 / 978 | 0.9898 |
| CLE | 1076 / 1093 | 0.9844 | 1078 / 1095 | 0.9845 |
| GB | 1013 / 1028 | 0.9854 | 1016 / 1031 | 0.9855 |
| JAX | 1041 / 1052 | 0.9895 | 1045 / 1056 | 0.9896 |
| LA | 964 / 978 | 0.9857 | 967 / 981 | 0.9857 |
| LAC | 1113 / 1127 | 0.9876 | 1115 / 1129 | 0.9876 |
| MIA | 969 / 979 | 0.9898 | 973 / 984 | 0.9888 |
| NYG | 1054 / 1065 | 0.9897 | 1054 / 1065 | 0.9897 |
| NYJ | 1028 / 1048 | 0.9809 | 1028 / 1048 | 0.9809 |
| SEA | 1011 / 1023 | 0.9883 | 1013 / 1025 | 0.9883 |
| SF | 1014 / 1025 | 0.9893 | 1017 / 1028 | 0.9893 |
| TB | 1120 / 1133 | 0.9885 | 1123 / 1136 | 0.9886 |

**R2, reproduction per play.**
- On all 33,519 (2022), 33,721 (2023), and 33,204 (2024) population plays, the build's value and source match the rev3 profile exactly: zero value mismatches, zero source mismatches.
- Direction issue (open decision). The rev3 shotgun profiles contain 227, 213, and 246 plays that the new population does not. By PBP class: two-point attempts (2022 88 pass and 30 run; 2023 77 pass and 44 run; 2024 99 pass and 36 run); fumble plays (2022 105 run, 2 pass; 2023 90 run, 1 pass; 2024 108 run); and a few other plays (2022 2 pass; 2023 1 run; 2024 3 pass). The new population therefore omits some plays that rev3 counts.
- The written R2 rule allows the profile to omit only special-teams run and pass plays. It does not cover a run that omits plays the profile has. The committed Gate 3 R2 table (96 of 96 pass) tests the profile against the Gate 3 population, which contains these plays, so it cannot see this. Decision needed: accept the narrower ordinary-play population and amend the R2 wording, or keep two-point and fumble plays in the shotgun population.

**R3, PBP-fallback plays listed.** Gate 3 lists 564 unresolved rows (`unresolved_plays.csv`). Per-play values for the rows that fall in the population match the sidecar: 415 of the unresolved rows and 181 of the failing-disputed rows match; 149 and 91 are outside the population.

**TB 2024: open.** R1 passes (1,018 of 1,018 on the new population), and R2 passes in the Gate 3 table. It has three PBP-fallback plays, 16 PBP-vs-participation disagreements (14 with FTN on the participation side, 2 with FTN missing), and an old-gate difference of 1.110 pp. The gate's rule keeps it open until the cause is found.

## Per-play shotgun provenance

- `pipeline/verify_historical_shotgun.py` recomputes every population play's hierarchy value and source from the pinned inputs with the builder's own functions. Results in `docs/research/historical-2022-2024/verification-{season}.json`: 33,519, 33,721, and 33,204 matched; zero mismatches; zero population rows missing.
- Sidecar counts (`shotgun-provenance-summary.json`): 2022 FTN 33,409, participation 109, PBP flag 1; 290 PBP disagreements, all FTN-sourced. 2023 FTN 33,644, PBP flag 77; 290 disagreements, all FTN-sourced. 2024 FTN 32,953, participation 239, PBP flag 12; 262 disagreements (260 FTN, 2 participation).
- Consumer rule: join on `(game_id, play_id)`, and exclude or label rows with `shotgun_source` equal to `pbp_flag` or with `shotgun_pbp_flag_disagrees` true. The observation attribute `shotgun` is the raw PBP flag, not the hierarchy value.
- Label issue, one play: in 2022 FTN, `qb_location` is `" S"` (leading space) for `2022_15_DAL_JAX` play 4021 (JAX). The builder compares the exact value `"S"`, so the play is labelled `participation` instead of `ftn`. Its value is correct, since FTN, PBP, and participation all say shotgun. Fix at the next rebuild by stripping the value in `shotgun_with_source`.

## FTN and participation joins

- 2022: 188 FTN misses. All are two-point attempts (94 offense: 69 pass and 25 run; the defense side has the same 94). None are inside the population.
- 2023 and 2024: zero FTN misses.
- Participation joined every eligible play in all three seasons (build reports).

## Source schema by season

The source files change between seasons. Checked against the pinned inputs:

- **PBP:** 372 columns in each season, with the same names and vocabularies for the fields the builder reads.
- **FTN:** 29 columns in each season. `qb_location` values: 2022 `{"", " S", "P", "S", "U"}`; 2023 and 2024 `{"0", "P", "S", "U"}`. The meaning of `"0"` is not stated in the file. The builder treats it as no value, which is the existing behaviour.
- **Participation:** 20 columns in 2022 and 26 in 2023 and 2024 (adds names, numbers, and positions). `offense_formation` values: 2022 `{"", EMPTY, I_FORM, JUMBO, PISTOL, SHOTGUN, SINGLEBACK, WILDCAT}`; 2023 and 2024 `{"", PISTOL, SHOTGUN, UNDER CENTER}`. The builder's EMPTY and WILDCAT shotgun-equivalent mapping applies to 2022 only, which is correct for this vocabulary.
- `test/test_historical_2022_2024_artifacts.py::HistoricalSourceSchema` pins the required columns and the exact value sets for each season, so a change in any season fails loudly.

## Comparison with the committed rev3 profiles

- `docs/research/historical-2022-2024/rev3-field-diff-2022-2024.csv`: field-level diff, 31 fields by 96 team-seasons (2,976 rows).
- Differs in all 96 team-seasons: `eligible_scrimmage_plays`, `run_pass`, `run_pass_denominator`, `run_play_count` (93), `shotgun`, `shotgun_pbp_flag`, `shotgun_source`, `personnel`, `is_screen_pass`, `is_trick_play`, `motion`, `n_blitzers`, `no_huddle`, `play_action`, `pass_play_count_including_sacks` (90), `target_available` (90), and others.
- Differs in 6 team-seasons only: `air_yards`, `pass_depth`, `pass_location`. Each comes from one rev3-only pass play.
- No difference: `rpo`, `run_gap`.
- Most of these differences come from the narrower population and the newer classes. Per-play checks in this session covered shotgun (zero mismatches on shared plays). Pass depth and location were checked earlier with no label changes on shared plays. The other fields are not per-play verified.

## Loader (playbook prior, cutoffs 2023, 2024, 2025)

- `prior_season` = 2022, 2023, 2024 respectively. `k` = 20.
- Families C, D, E populated. Unlabelled families A, B, F to N are empty.
- 2024 cutoff: league C 22 cells / 10,352 counts; D 23 cells / 18,247; E 23 cells / 18,247. Team-level C 572 cells; D and E 673 cells each.
- Deterministic: repeated loads give identical digests (test). Labelled family totals equal an independent recount from `observations-{season}.jsonl` (test).
- Existing code, not changed (SLC branch): `scripts/nfl_sequence/playbook_prior.py:54` opens files with `json.load(open(path))`, which emits ResourceWarnings in the consumer test.

## Test results

- `test/test_historical_2022_2024_artifacts.py`: 10 tests pass. Covers inventory, SHA-256 manifest, profile identity, observation counts, sidecar against profiles, Gate 3 fixture rows, repo copies against the build directory, committed verification outputs, and the source schema per season.
- `scripts/nfl_sequence/test_playbook_prior_historical.py` (`slc-v1`): 4 tests pass. Pins the build's `SHA256SUMS.txt` hash, checks loader determinism and `prior_season`, recounts families C, D, and E, and checks the unlabelled families.

## Consumption path (hash-pinned)

- `slc-v1` reads the build through `playbook_prior.load(cutoff, playbook_dir=...)`. The directory defaults to `/root/gridiron-playbook-builds/historical-2022-2024` and can be overridden with `HISTORICAL_PLAYBOOK_DIR`.
- The consumer test refuses to run against a build whose `SHA256SUMS.txt` hash differs from the pinned value. No SLC defaults change, and no model code is copied.

## Open items

1. **R2 population direction.** Accept the narrower ordinary-play population and amend the R2 wording, or keep two-point and fumble plays in the shotgun population (227, 213, and 246 plays by season).
2. **Gate status.** The revised gate is not passed: 15 team-seasons fail R1 in 2022, and TB 2024 is open.
3. **Rebuild fixes (not applied here).** Format the report's pp from the unrounded difference. Strip whitespace in FTN `qb_location` before the exact `"S"` comparison. Each changes committed build outputs, so both wait for an explicit rebuild decision.
4. **Special-teams classifier.** Some `special_teams_run_pass` plays have a blank or SHOTGUN participation formation.
5. **Data retention.** The 1.8 GB build stays outside git, pinned by `SHA256SUMS.txt`. Decision needed on whether to commit it.
6. **ESPN.** Not used. The user allowed ESPN as a season-totals reference if a check needs it; none of these checks did.

## Reproduce

```bash
cd /root/gridiron-playbooks-research
python3 test/test_historical_2022_2024_artifacts.py -v
for s in 2022 2023 2024; do
  python3 pipeline/verify_historical_shotgun.py $s /root/gridiron-playbook-builds/historical-2022-2024 \
    docs/research/historical-2022-2024/verification-$s.json \
    /root/lp-snapshots/nfl-team-season-playbooks-2026-10-27-rev3
done
cd /root/lp-slc-v1/scripts/nfl_sequence && python3 test_playbook_prior_historical.py -v
```
