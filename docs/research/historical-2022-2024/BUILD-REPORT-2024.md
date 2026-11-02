# Team-season playbook research build

Research-only output from the historical builder for regular seasons 2022 to 2025. No production defaults are changed.

## Reproduction

Each season-specific PBP, participation, and FTN file must match its SHA-256 pin in `pipeline/build_playbooks.py::RESEARCH_SOURCE_PINS`. The build refuses any input whose SHA-256 differs from its pin.

## Aggregate counts

- Team-season profiles: 32 (expected 128).
- PBP regular-season games by season: 2024=272.
- FTN charting games present by season: 2024=272/272.
- Eligible offense plays: 33,470; eligible defense plays: 33,470.
- Participation joins: 66,940; missing joins: 0.
- FTN charting joins: 66,940; missing joins: 0.

## Shotgun cross-source gate (2022 to 2024)

PBP `shotgun=1` was compared on paired eligible offense plays with participation formation categories. Pistol is grouped with shotgun in all years; the 2022 taxonomy additionally groups Empty and Wildcat because those are explicit formation labels in that release.

Nonreconciling team-seasons (>1 percentage point): 10.

Each exception is an exact-key cross-source classification disagreement. In these 2023 to 2024 data, PBP marks more of the discrepant plays `shotgun=0` while participation labels their formation SHOTGUN or PISTOL; fewer plays go the other way (`shotgun=1` with a non-shotgun formation). The table gives the two disagreement directions per team-season; the manifest retains each discrepant source row with game/play ID, week, play type, and both labels. These rows are distributed across multiple weeks/games, with no missing participation joins in these seasons. The source labels are preserved; no rows were recoded to force the tolerance.

| Season | Team | Difference (pp) | Paired plays | PBP 0 / participation shotgun | PBP 1 / participation other | Discrepant plays | Games | Weeks |
|---:|:---:|---:|---:|---:|---:|---:|---:|:---|
| 2024 | CHI | 1.605 | 1059 | 19 | 2 | 21 | 12 | 1, 3, 4, 5, 6, 8, 9, 11, 12, 13, 14, 15 |
| 2024 | DET | 1.003 | 1097 | 11 | 0 | 11 | 5 | 7, 10, 15, 17, 18 |
| 2024 | IND | 1.065 | 1033 | 12 | 1 | 13 | 9 | 1, 2, 4, 5, 6, 8, 11, 13, 17 |
| 2024 | JAX | 1.009 | 991 | 12 | 2 | 14 | 9 | 1, 4, 6, 7, 8, 9, 10, 13, 15 |
| 2024 | LV | 1.045 | 1053 | 12 | 1 | 13 | 9 | 2, 3, 5, 6, 7, 11, 13, 14, 16 |
| 2024 | NE | 1.273 | 1021 | 14 | 1 | 15 | 11 | 1, 5, 7, 8, 10, 12, 13, 15, 16, 17, 18 |
| 2024 | NO | 1.658 | 1025 | 17 | 0 | 17 | 9 | 3, 4, 6, 9, 10, 11, 13, 14, 15 |
| 2024 | NYG | 1.525 | 1049 | 18 | 2 | 20 | 10 | 2, 3, 4, 6, 7, 8, 9, 10, 14, 16 |
| 2024 | NYJ | 1.382 | 1013 | 18 | 4 | 22 | 12 | 1, 4, 5, 7, 8, 10, 11, 13, 14, 15, 17, 18 |
| 2024 | TB | 1.110 | 1081 | 14 | 2 | 16 | 9 | 1, 3, 6, 7, 8, 12, 16, 17, 18 |

## Per-team-season counts

| Season | Team | Games | Offense | Defense | Participation joined / plays | FTN joined / plays | Shotgun difference |
|---:|:---:|---:|---:|---:|---:|---:|---:|
| 2024 | ARI | 17 | 1031 | 1032 | 2063 / 2063 | 2063 / 2063 | 0.679 pp |
| 2024 | ATL | 17 | 1073 | 1052 | 2125 / 2125 | 2125 / 2125 | 0.373 pp |
| 2024 | BAL | 17 | 1039 | 1058 | 2097 / 2097 | 2097 / 2097 | 0.482 pp |
| 2024 | BUF | 17 | 1005 | 1045 | 2050 / 2050 | 2050 / 2050 | 0.298 pp |
| 2024 | CAR | 17 | 987 | 1136 | 2123 / 2123 | 2123 / 2123 | 0.810 pp |
| 2024 | CHI | 17 | 1059 | 1021 | 2080 / 2080 | 2080 / 2080 | 1.605 pp |
| 2024 | CIN | 17 | 1069 | 1075 | 2144 / 2144 | 2144 / 2144 | 0.093 pp |
| 2024 | CLE | 17 | 1121 | 1011 | 2132 / 2132 | 2132 / 2132 | 0.981 pp |
| 2024 | DAL | 17 | 1095 | 1029 | 2124 / 2124 | 2124 / 2124 | 0.549 pp |
| 2024 | DEN | 17 | 1038 | 1084 | 2122 / 2122 | 2122 / 2122 | 0.290 pp |
| 2024 | DET | 17 | 1099 | 1013 | 2112 / 2112 | 2112 / 2112 | 1.003 pp |
| 2024 | GB | 17 | 1022 | 1027 | 2049 / 2049 | 2049 / 2049 | 0.783 pp |
| 2024 | HOU | 17 | 1045 | 1046 | 2091 / 2091 | 2091 / 2091 | 0.957 pp |
| 2024 | IND | 17 | 1034 | 1099 | 2133 / 2133 | 2133 / 2133 | 1.065 pp |
| 2024 | JAX | 17 | 991 | 1109 | 2100 / 2100 | 2100 / 2100 | 1.009 pp |
| 2024 | KC | 17 | 1069 | 1019 | 2088 / 2088 | 2088 / 2088 | 0.750 pp |
| 2024 | LA | 17 | 1028 | 1049 | 2077 / 2077 | 2077 / 2077 | 0.584 pp |
| 2024 | LAC | 17 | 998 | 1027 | 2025 / 2025 | 2025 / 2025 | 0.301 pp |
| 2024 | LV | 17 | 1054 | 1031 | 2085 / 2085 | 2085 / 2085 | 1.045 pp |
| 2024 | MIA | 17 | 1076 | 999 | 2075 / 2075 | 2075 / 2075 | 0.931 pp |
| 2024 | MIN | 17 | 1029 | 1074 | 2103 / 2103 | 2103 / 2103 | 0.681 pp |
| 2024 | NE | 17 | 1021 | 1060 | 2081 / 2081 | 2081 / 2081 | 1.273 pp |
| 2024 | NO | 17 | 1026 | 1104 | 2130 / 2130 | 2130 / 2130 | 1.658 pp |
| 2024 | NYG | 17 | 1051 | 1033 | 2084 / 2084 | 2084 / 2084 | 1.525 pp |
| 2024 | NYJ | 17 | 1014 | 1056 | 2070 / 2070 | 2070 / 2070 | 1.382 pp |
| 2024 | PHI | 17 | 1093 | 998 | 2091 / 2091 | 2091 / 2091 | 0.640 pp |
| 2024 | PIT | 17 | 1066 | 1031 | 2097 / 2097 | 2097 / 2097 | 0.845 pp |
| 2024 | SF | 17 | 1014 | 1018 | 2032 / 2032 | 2032 / 2032 | 0.888 pp |
| 2024 | SEA | 17 | 1018 | 1056 | 2074 / 2074 | 2074 / 2074 | 0.491 pp |
| 2024 | TB | 17 | 1084 | 1053 | 2137 / 2137 | 2137 / 2137 | 1.110 pp |
| 2024 | TEN | 17 | 1030 | 998 | 2028 / 2028 | 2028 / 2028 | 0.876 pp |
| 2024 | WAS | 17 | 1091 | 1027 | 2118 / 2118 | 2118 / 2118 | 0.733 pp |

## Gate status

- NE-2025 and CHI-2025 legacy reproduction gate: passed byte-for-byte before this expanded build.
- Emitted offense and defense records reconcile to eligible play counts; every distribution reconciles observed + missing to denominator.
- Shotgun cross-source gate: has 10 exceptions listed above.
- Shotgun exceptions are cross-source label disagreements at exact joined game/play keys, not missing participation joins; each cause is itemized in the manifest with the original source labels and IDs.
- This is Part A only; no movement evaluation is included.
