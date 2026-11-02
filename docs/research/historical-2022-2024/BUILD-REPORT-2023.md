# Team-season playbook research build

Research-only output from the historical builder for regular seasons 2022 to 2025. No production defaults are changed.

## Reproduction

Each season-specific PBP, participation, and FTN file must match its SHA-256 pin in `pipeline/build_playbooks.py::RESEARCH_SOURCE_PINS`. The build refuses any input whose SHA-256 differs from its pin.

## Aggregate counts

- Team-season profiles: 32 (expected 128).
- PBP regular-season games by season: 2023=272.
- FTN charting games present by season: 2023=272/272.
- Eligible offense plays: 33,957; eligible defense plays: 33,957.
- Participation joins: 67,914; missing joins: 0.
- FTN charting joins: 67,914; missing joins: 0.

## Shotgun cross-source gate (2022 to 2024)

PBP `shotgun=1` was compared on paired eligible offense plays with participation formation categories. Pistol is grouped with shotgun in all years; the 2022 taxonomy additionally groups Empty and Wildcat because those are explicit formation labels in that release.

Nonreconciling team-seasons (>1 percentage point): 6.

Each exception is an exact-key cross-source classification disagreement. In these 2023 to 2024 data, PBP marks more of the discrepant plays `shotgun=0` while participation labels their formation SHOTGUN or PISTOL; fewer plays go the other way (`shotgun=1` with a non-shotgun formation). The table gives the two disagreement directions per team-season; the manifest retains each discrepant source row with game/play ID, week, play type, and both labels. These rows are distributed across multiple weeks/games, with no missing participation joins in these seasons. The source labels are preserved; no rows were recoded to force the tolerance.

| Season | Team | Difference (pp) | Paired plays | PBP 0 / participation shotgun | PBP 1 / participation other | Discrepant plays | Games | Weeks |
|---:|:---:|---:|---:|---:|---:|---:|---:|:---|
| 2023 | ARI | 1.031 | 1067 | 13 | 2 | 15 | 12 | 2, 3, 4, 5, 7, 8, 10, 11, 12, 15, 16, 17 |
| 2023 | CLE | 1.279 | 1173 | 20 | 5 | 25 | 14 | 2, 3, 4, 6, 7, 10, 11, 12, 13, 14, 15, 16, 17, 18 |
| 2023 | DET | 1.347 | 1114 | 17 | 2 | 19 | 11 | 1, 4, 5, 7, 12, 13, 14, 15, 16, 17, 18 |
| 2023 | NE | 1.182 | 1015 | 16 | 4 | 20 | 10 | 1, 2, 3, 7, 9, 10, 12, 15, 16, 17 |
| 2023 | NYG | 1.242 | 1047 | 13 | 0 | 13 | 10 | 1, 2, 3, 4, 5, 9, 12, 14, 16, 17 |
| 2023 | NYJ | 1.336 | 1048 | 16 | 2 | 18 | 11 | 1, 2, 4, 5, 6, 8, 11, 14, 15, 17, 18 |

## Per-team-season counts

| Season | Team | Games | Offense | Defense | Participation joined / plays | FTN joined / plays | Shotgun difference |
|---:|:---:|---:|---:|---:|---:|---:|---:|
| 2023 | ARI | 17 | 1071 | 1047 | 2118 / 2118 | 2118 / 2118 | 1.031 pp |
| 2023 | ATL | 17 | 1083 | 1072 | 2155 / 2155 | 2155 / 2155 | 0.555 pp |
| 2023 | BAL | 17 | 1064 | 1104 | 2168 / 2168 | 2168 / 2168 | 0.189 pp |
| 2023 | BUF | 17 | 1094 | 1007 | 2101 / 2101 | 2101 / 2101 | 0.275 pp |
| 2023 | CAR | 17 | 1094 | 981 | 2075 / 2075 | 2075 / 2075 | 0.367 pp |
| 2023 | CHI | 17 | 1089 | 1029 | 2118 / 2118 | 2118 / 2118 | 0.369 pp |
| 2023 | CIN | 17 | 1032 | 1049 | 2081 / 2081 | 2081 / 2081 | 0.389 pp |
| 2023 | CLE | 17 | 1181 | 991 | 2172 / 2172 | 2172 / 2172 | 1.279 pp |
| 2023 | DAL | 17 | 1104 | 1003 | 2107 / 2107 | 2107 / 2107 | 0.453 pp |
| 2023 | DEN | 17 | 1002 | 1072 | 2074 / 2074 | 2074 / 2074 | 0.599 pp |
| 2023 | DET | 17 | 1117 | 1031 | 2148 / 2148 | 2148 / 2148 | 1.347 pp |
| 2023 | GB | 17 | 1041 | 1052 | 2093 / 2093 | 2093 / 2093 | 0.193 pp |
| 2023 | HOU | 17 | 1078 | 1080 | 2158 / 2158 | 2158 / 2158 | 0.836 pp |
| 2023 | IND | 17 | 1087 | 1123 | 2210 / 2210 | 2210 / 2210 | 0.369 pp |
| 2023 | JAX | 17 | 1102 | 1061 | 2163 / 2163 | 2163 / 2163 | 0.819 pp |
| 2023 | KC | 17 | 1055 | 1033 | 2088 / 2088 | 2088 / 2088 | 0.760 pp |
| 2023 | LA | 17 | 1091 | 1063 | 2154 / 2154 | 2154 / 2154 | 0.917 pp |
| 2023 | LAC | 17 | 1096 | 1094 | 2190 / 2190 | 2190 / 2190 | 0.639 pp |
| 2023 | LV | 17 | 997 | 1072 | 2069 / 2069 | 2069 / 2069 | 0.100 pp |
| 2023 | MIA | 17 | 1036 | 1041 | 2077 / 2077 | 2077 / 2077 | 0.774 pp |
| 2023 | MIN | 17 | 1063 | 1079 | 2142 / 2142 | 2142 / 2142 | 0.472 pp |
| 2023 | NE | 17 | 1016 | 1067 | 2083 / 2083 | 2083 / 2083 | 1.182 pp |
| 2023 | NO | 17 | 1102 | 1042 | 2144 / 2144 | 2144 / 2144 | 0.908 pp |
| 2023 | NYG | 17 | 1049 | 1082 | 2131 / 2131 | 2131 / 2131 | 1.242 pp |
| 2023 | NYJ | 17 | 1049 | 1073 | 2122 / 2122 | 2122 / 2122 | 1.336 pp |
| 2023 | PHI | 17 | 1104 | 1101 | 2205 / 2205 | 2205 / 2205 | 0.182 pp |
| 2023 | PIT | 17 | 1008 | 1065 | 2073 / 2073 | 2073 / 2073 | 0.199 pp |
| 2023 | SF | 17 | 996 | 1034 | 2030 / 2030 | 2030 / 2030 | 0.504 pp |
| 2023 | SEA | 17 | 984 | 1135 | 2119 / 2119 | 2119 / 2119 | 0.408 pp |
| 2023 | TB | 17 | 1028 | 1076 | 2104 / 2104 | 2104 / 2104 | 0.979 pp |
| 2023 | TEN | 17 | 984 | 1089 | 2073 / 2073 | 2073 / 2073 | 0.204 pp |
| 2023 | WAS | 17 | 1060 | 1109 | 2169 / 2169 | 2169 / 2169 | 0.569 pp |

## Gate status

- NE-2025 and CHI-2025 legacy reproduction gate: passed byte-for-byte before this expanded build.
- Emitted offense and defense records reconcile to eligible play counts; every distribution reconciles observed + missing to denominator.
- Shotgun cross-source gate: has 6 exceptions listed above.
- Shotgun exceptions are cross-source label disagreements at exact joined game/play keys, not missing participation joins; each cause is itemized in the manifest with the original source labels and IDs.
- This is Part A only; no movement evaluation is included.
