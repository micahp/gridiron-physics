# Formation-gap audit: ordinary run or pass plays with no formation label, 2022 to 2025

Status: audit only. No rev3 output, profile, or builder rule was changed. The audit covers the 162 ordinary run or pass plays from 2022 to 2025 that have no participation formation label. 2026 is excluded, because participation data does not exist for that season, so every 2026 play lacks a formation label.

Files (committed under `data/playbooks/research-2026-10-27-rev3-audit/` and `pipeline/audit_formation_gaps.py`):
- `formation_gap_audit.csv`: one row per play, 162 rows. Columns include the original PBP description, down, distance, game ID, play ID, FTN `qb_location`, participation personnel and formation, the resolved shotgun value and its source, the reason code, unusual-play flags, and the proposed disposition.
- `formation_gap_summary.json`: the aggregate counts and the reconciliation.

## 1. Reason split

| Reason code | Plays |
|---|---:|
| PARTICIPATION_ROW_ABSENT (game absent or play absent) | 0 |
| PARTICIPATION_FORMATION_BLANK (row present, `offense_formation` blank) | 162 |
| UNRECOGNIZED_FORMATION_LABEL | 0 |
| JOIN_OR_PARSE_ISSUE | 0 |

Every one of the 162 plays has a participation row. None of them has an unrecognized label or a join or parsing problem.

## 2. Reconciliation

The builder counts a missing offense formation when the participation row is absent or its label is blank. The rev3 profiles count 7 (2022), 89 (2023), 18 (2024) and 48 (2025), which is 162 in total. That matches the audit exactly, by season. The audit's play-type split is 87 runs and 75 passes.

Shotgun resolution for the 162 plays: 153 from the PBP flag (in games FTN has charted), 9 from FTN. No shotgun value is null.

## 3. Counts by season, play type and team

| Season | Run | Pass | Total |
|---|---:|---:|---:|
| 2022 | 3 | 4 | 7 |
| 2023 | 53 | 36 | 89 |
| 2024 | 12 | 6 | 18 |
| 2025 | 19 | 29 | 48 |
| **Total** | **87** | **75** | **162** |

By team (sorted by total plays):

| Team | Run | Pass | Total | Seasons with at least one row |
|---|---:|---:|---:|---|
| DEN | 7 | 28 | 35 | 2023, 2024, 2025 |
| CLE | 8 | 1 | 9 | 2023, 2025 |
| TB | 5 | 4 | 9 | 2023, 2024 |
| BAL | 6 | 2 | 8 | 2023, 2024 |
| KC | 2 | 5 | 7 | 2022, 2023, 2024, 2025 |
| NYG | 4 | 2 | 6 | 2022, 2023, 2024, 2025 |
| ATL | 2 | 3 | 5 | 2023, 2024, 2025 |
| CIN | 5 | 0 | 5 | 2022, 2023 |
| DAL | 3 | 2 | 5 | 2022, 2023, 2025 |
| MIA | 4 | 1 | 5 | 2023, 2024 |
| PIT | 2 | 3 | 5 | 2023 |
| SEA | 3 | 2 | 5 | 2023, 2025 |
| BUF | 4 | 0 | 4 | 2023, 2025 |
| CAR | 3 | 1 | 4 | 2023 |
| CHI | 1 | 3 | 4 | 2023 |
| GB | 1 | 3 | 4 | 2023 |
| IND | 3 | 1 | 4 | 2023, 2024 |
| PHI | 2 | 2 | 4 | 2023 |
| SF | 2 | 2 | 4 | 2023, 2025 |
| TEN | 3 | 1 | 4 | 2023, 2024 |
| WAS | 2 | 2 | 4 | 2023 |
| DET | 3 | 0 | 3 | 2023, 2025 |
| HOU | 2 | 1 | 3 | 2023, 2025 |
| NE | 2 | 1 | 3 | 2023, 2025 |
| ARI | 2 | 0 | 2 | 2023 |
| JAX | 0 | 2 | 2 | 2023 |
| LA | 2 | 0 | 2 | 2022, 2023 |
| MIN | 1 | 1 | 2 | 2023, 2024 |
| NO | 1 | 1 | 2 | 2023, 2024 |
| NYJ | 1 | 1 | 2 | 2022, 2024 |
| LV | 1 | 0 | 1 | 2023 |

## 4. Concentration: one game

32 of the 162 plays come from one game, `2025_03_DEN_LAC`. In that game, 32 of 127 PBP run or pass plays have a blank participation formation. FTN has no alignment for those 32 plays either. The gap is spread across all four quarters (6, 12, 5 and 9 plays), so it is not one drive or one quarter. The game's other 95 run or pass plays have formation labels. The other 103 games with a gap have one to five plays each.

This is a partial recording gap for one game. It is not an outage of the whole game, and it is not a join problem. It stays null in the profiles.

## 5. Unusual plays

| Flag | Plays |
|---|---:|
| DESC_TAG_SHOTGUN | 81 |
| TWO_POINT | 12 |
| QB_SCRAMBLE | 11 |
| KICK_TEXT | 7 |
| PENALTY_TEXT | 6 |
| ABORTED | 2 |
| TRICK_TEXT | 2 |
| DIRECT_SNAP | 1 |
| KNEEL | 1 |

Notes:
- The 7 `KICK_TEXT` plays are described as "(Field Goal formation)" with a run or pass action. These are fake field goals. The existing classifier handles fake punts only, so it does not catch them. See section 7.
- The 12 `TWO_POINT` plays have the PBP `two_point_attempt` flag set to 1 on all 12, and their descriptions say "TWO-POINT CONVERSION ATTEMPT."
- The 11 `QB_SCRAMBLE` plays are ordinary run or pass plays by the quarterback. They stay in the sample.
- The 6 `PENALTY_TEXT` plays are ordinary plays with a penalty recorded. They stay in the sample.
- No Wildcat or spike plays are present among these 162.
- No fake punt was missed. No description contains the word "punt."

## 6. Explicit formation evidence

No source in the data gives an explicit formation label (SHOTGUN, UNDER CENTER, PISTOL or any other) for any of these 162 plays. The participation formation is blank by definition. The other sources give partial information only:

- FTN `qb_location` gives an explicit QB alignment for 9 plays (5 `S` for shotgun, 4 `U` for under center). It is an alignment field, not the participation formation label, so those plays keep a null formation label.
- The description tag "(Shotgun)" appears on 81 plays, 77 of them without an FTN alignment. It identifies shotgun, and nothing more. It does not say under center, pistol or any other formation.
- The remaining 76 plays have no explicit formation evidence in any source.

No formation label has been inferred from the shotgun value, from the pass or run action, or from the description.

## 7. Proposed dispositions (not applied)

| Disposition | Plays | Basis |
|---|---:|---|
| keep_ordinary (formation null, shotgun value kept) | 142 | Ordinary plays. The PBP-flag tier and FTN tier resolve shotgun. |
| exclude_candidate: two-point attempt | 12 | PBP `two_point_attempt` = 1 on all 12, and the description says "TWO-POINT CONVERSION ATTEMPT." |
| exclude_candidate: fake field goal | 7 | Description "(Field Goal formation)" with a run or pass action. The same evidence was accepted for fake punts. |
| review: aborted snap | 1 | 2023 MIA at NE, play 4529. Description "FUMBLES (Aborted)," source text only. |

The 142 kept plays are 75 runs and 67 passes. Applying the two exclusions and the fake-field-goal class would be a new revision (rev4) and needs your decision. I have not changed rev3.

## 8. Mapping check for the 2022 bug

The 2022 SINGLEBACK, I_FORM and JUMBO mapping is checked here for every distinct value in the full participation source, 2022 to 2025, not only the values seen earlier. Every non-blank value maps to a True or False shotgun value. Only blank values stay null.

| Season | Source value | Plays in source | Mapped shotgun value |
|---|---|---:|---|
| 2022 | (blank) | 13358 | None (missing) |
| 2022 | EMPTY | 3028 | True (not None: True) |
| 2022 | I_FORM | 2238 | False (not None: True) |
| 2022 | JUMBO | 317 | False (not None: True) |
| 2022 | PISTOL | 1584 | True (not None: True) |
| 2022 | SHOTGUN | 20438 | True (not None: True) |
| 2022 | SINGLEBACK | 8919 | False (not None: True) |
| 2022 | WILDCAT | 268 | True (not None: True) |
| 2023 | (blank) | 9209 | None (missing) |
| 2023 | PISTOL | 1458 | True (not None: True) |
| 2023 | SHOTGUN | 25459 | True (not None: True) |
| 2023 | UNDER CENTER | 10042 | False (not None: True) |
| 2024 | (blank) | 9237 | None (missing) |
| 2024 | PISTOL | 3397 | True (not None: True) |
| 2024 | SHOTGUN | 22859 | True (not None: True) |
| 2024 | UNDER CENTER | 10426 | False (not None: True) |
| 2025 | (blank) | 9108 | None (missing) |
| 2025 | PISTOL | 1704 | True (not None: True) |
| 2025 | SHOTGUN | 22227 | True (not None: True) |
| 2025 | UNDER CENTER | 12145 | False (not None: True) |


## 9. Decisions needed

1. Fake field goals (7 plays): add a `fake_field_goal` class to the special-teams block, the same way fake punts are handled?
2. Two-point attempts (12 plays): exclude from the ordinary run and pass sample?
3. The aborted snap (1 play): keep or exclude?
4. `2025_03_DEN_LAC`: a 25 percent formation gap in one game. Report it as a game-level gap, or exclude that game's formation distribution?
5. The 2026 season: no participation, so no formation label for any 2026 play. This is a known limit of the data, not a gap to fill.
