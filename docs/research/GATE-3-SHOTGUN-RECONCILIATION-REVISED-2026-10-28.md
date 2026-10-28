# Gate 3, revised: shotgun source reconciliation, 2022 to 2024

Status: rule written before the revised run. Historical development only. Not a final acceptance. No 2026 data is used.

## Why the rule changes

The original gate compared the PBP `shotgun` flag with the participation formation, team by team, and required the two
shares to agree within 1.0 percentage point. Sixteen team-seasons failed (2023: ARI, CLE, DET, NE, NYG, NYJ; 2024: CHI,
DET, IND, JAX, LV, NE, NO, NYG, NYJ, TB), with differences from 1.003 to 1.658 points.

Two facts from the earlier source check make the flag an unreliable reference for these seasons:

- FTN agrees with participation on 184 of the 190 regulation-down plays where the PBP flag disagreed with participation.
- The PBP flag is only one of three sources. The builder already uses a documented hierarchy, not the flag alone.

So the gate is revised to test the hierarchy and the agreement between sources, not the flag against participation.
The PBP flag is still reported and is not changed.

## Sources and hierarchy (unchanged, from `shotgun_with_source`)

For each eligible offense scrimmage play, in order:

1. **FTN** `qb_location`: `S` or `P` is shotgun, `U` is under center. Other values (`0`, blank) give no value.
2. **Participation** `offense_formation`, mapped by `participation_shotgun_equivalent` (SHOTGUN and PISTOL; 2022 also
   EMPTY and WILDCAT). A blank formation gives no value.
3. **PBP flag** `shotgun`, used only when the game has FTN charting rows and neither source above gives a value. A game
   with no FTN rows keeps the play null.

Each play records which source supplied its value. Historical source fields are read, never written.

## Values reported separately, per team-season

- PBP flag share on plays where the flag and participation both exist (the old gate's basis).
- Participation share on the same plays.
- FTN share on FTN-charted plays.
- Hierarchy share (the value the profile uses) and its source counts (FTN, participation, PBP flag, none).
- Pairwise agreement: PBP vs participation, FTN vs participation, FTN vs PBP.
- Disagreements between PBP and participation, split by what FTN says:
  - FTN sides with participation,
  - FTN sides with PBP,
  - all three values differ,
  - FTN missing.

## Revised rule

A team-season **passes** the revised gate when all three hold:

- **R1 (source agreement).** Where FTN and participation both give a value, they agree on at least **99.0%** of those
  plays. The 99.0% bound is the revised threshold. It is looser than the 184-of-190 disputed-play agreement, and it is
  applied to all plays with both values, not only the disputed ones.
- **R2 (reproducibility).** The hierarchy share is recomputed from source fields with the rule above and matches the
  value the builder would write for that team-season.
- **R3 (no silent fallback).** Every play that the hierarchy resolves from the PBP flag alone is listed in
  `unresolved_plays.csv` with its season, team, game and play ID. The count is reported per team-season.

The PBP flag is **not** pass/fail on its own. Its disagreement with participation is reported as a count and explained by
the FTN split above. A PBP disagreement that FTN does not explain stays visible in `unresolved_plays.csv`. Nothing is
recoded to force a pass.

## Unexplained cases, kept visible

- Any team-season that fails R1, R2 or R3 is listed as **unexplained** with its play rows.
- The 2024 TB team-season stays on the list until its cause is found. It is not closed by the revised rule unless R1 to
  R3 pass for it on their own terms.
- Plays where all three values differ, and plays with no FTN value where the PBP and participation values disagree, are
  listed as unresolved, whatever the team-season result.

## Old gate results, recomputed

The old 1.0-point test is recomputed first (`old_gate_*` columns in `team_season_sources.csv`). Its results must match the
committed rev3 table before the revised numbers are used. The revised gate does not replace the old numbers; it sits
beside them.

## Scope

- Seasons 2022, 2023 and 2024 only.
- Regular season, offense scrimmage plays (run, pass, including sacks), as in the builder.
- No 2025 or 2026 data is used for this gate.
- The rule and the 99.0% threshold are fixed in this document before the revised run. They are not changed after seeing
  the results. A change would need a new written rule.

## Revision record

Recorded after the first revised run. This is the only change to the rule.

- **R2 was first written as a totals test.** It compared this run's ordinary-play counts with the rev3 profile's shotgun
  counts. The first run returned 0 of 96 matches. The diagnosis: the committed rev3 profiles were built under the earlier
  event classes. Their shotgun denominator also includes two-point conversions, fumbled snaps and aborted plays, which the
  current `snap_kind` puts in separate classes. A totals test therefore compared different denominators and could not test
  the hierarchy. That run is not a result and is not used for pass or fail.
- **R2 is now a per-play test.** For each play in the rev3 profile's `source_ids`, this run's shotgun value and source must
  match exactly. The profile may omit only special-teams run and pass plays, which the current classes keep out of ordinary
  plays. Any other omission fails R2. This change was made after the totals test failed, and it is recorded here so it
  cannot pass unnoticed.
- R1 (99.0% FTN and participation agreement) and R3 (every PBP-fallback play listed) are unchanged.
