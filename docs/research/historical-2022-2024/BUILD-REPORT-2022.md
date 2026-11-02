# Team-season playbook research build

Research-only output from the historical builder for regular seasons 2022 to 2025. No production defaults are changed.

## Reproduction

Each season-specific PBP, participation, and FTN file must match its SHA-256 pin in `pipeline/build_playbooks.py::RESEARCH_SOURCE_PINS`. The build refuses any input whose SHA-256 differs from its pin.

## Aggregate counts

- Team-season profiles: 32 (expected 128).
- PBP regular-season games by season: 2022=271.
- FTN charting games present by season: 2022=271/271.
- Eligible offense plays: 33,770; eligible defense plays: 33,770.
- Participation joins: 67,540; missing joins: 0.
- FTN charting joins: 67,352; missing joins: 188.

## Shotgun cross-source gate (2022 to 2024)

PBP `shotgun=1` was compared on paired eligible offense plays with participation formation categories. Pistol is grouped with shotgun in all years; the 2022 taxonomy additionally groups Empty and Wildcat because those are explicit formation labels in that release.

Nonreconciling team-seasons (>1 percentage point): 0.

Every team-season met the 1 percentage-point tolerance.

## Per-team-season counts

| Season | Team | Games | Offense | Defense | Participation joined / plays | FTN joined / plays | Shotgun difference |
|---:|:---:|---:|---:|---:|---:|---:|---:|
| 2022 | ARI | 17 | 1142 | 1060 | 2202 / 2202 | 2195 / 2202 | 0.702 pp |
| 2022 | ATL | 17 | 1000 | 1075 | 2075 / 2075 | 2067 / 2075 | 0.300 pp |
| 2022 | BAL | 17 | 1030 | 1039 | 2069 / 2069 | 2064 / 2069 | 0.485 pp |
| 2022 | BUF | 16 | 1018 | 994 | 2012 / 2012 | 2007 / 2012 | 0.295 pp |
| 2022 | CAR | 17 | 971 | 1090 | 2061 / 2061 | 2054 / 2061 | 0.309 pp |
| 2022 | CHI | 17 | 985 | 1023 | 2008 / 2008 | 1999 / 2008 | 0.305 pp |
| 2022 | CIN | 16 | 1034 | 987 | 2021 / 2021 | 2013 / 2021 | 0.581 pp |
| 2022 | CLE | 17 | 1099 | 1025 | 2124 / 2124 | 2120 / 2124 | 0.091 pp |
| 2022 | DAL | 17 | 1101 | 1092 | 2193 / 2193 | 2187 / 2193 | 0.273 pp |
| 2022 | DEN | 17 | 1070 | 1066 | 2136 / 2136 | 2132 / 2136 | 0.374 pp |
| 2022 | DET | 17 | 1081 | 1068 | 2149 / 2149 | 2141 / 2149 | 0.278 pp |
| 2022 | GB | 17 | 1036 | 978 | 2014 / 2014 | 2011 / 2014 | 0.193 pp |
| 2022 | HOU | 17 | 1011 | 1114 | 2125 / 2125 | 2118 / 2125 | 0.396 pp |
| 2022 | IND | 17 | 1100 | 1081 | 2181 / 2181 | 2170 / 2181 | 0.455 pp |
| 2022 | JAX | 17 | 1066 | 1101 | 2167 / 2167 | 2157 / 2167 | 0.751 pp |
| 2022 | KC | 17 | 1085 | 1084 | 2169 / 2169 | 2164 / 2169 | 0.646 pp |
| 2022 | LA | 17 | 987 | 1038 | 2025 / 2025 | 2023 / 2025 | 0.000 pp |
| 2022 | LAC | 17 | 1137 | 994 | 2131 / 2131 | 2128 / 2131 | 0.176 pp |
| 2022 | LV | 17 | 1048 | 1065 | 2113 / 2113 | 2106 / 2113 | 0.382 pp |
| 2022 | MIA | 17 | 995 | 1067 | 2062 / 2062 | 2057 / 2062 | 0.402 pp |
| 2022 | MIN | 17 | 1114 | 1113 | 2227 / 2227 | 2222 / 2227 | 0.360 pp |
| 2022 | NE | 17 | 986 | 1078 | 2064 / 2064 | 2057 / 2064 | 0.507 pp |
| 2022 | NO | 17 | 1005 | 1070 | 2075 / 2075 | 2065 / 2075 | 0.398 pp |
| 2022 | NYG | 17 | 1077 | 1064 | 2141 / 2141 | 2135 / 2141 | 0.745 pp |
| 2022 | NYJ | 17 | 1063 | 1078 | 2141 / 2141 | 2141 / 2141 | 0.377 pp |
| 2022 | PHI | 17 | 1105 | 1062 | 2167 / 2167 | 2161 / 2167 | 0.181 pp |
| 2022 | PIT | 17 | 1101 | 1008 | 2109 / 2109 | 2106 / 2109 | 0.273 pp |
| 2022 | SF | 17 | 1030 | 1017 | 2047 / 2047 | 2044 / 2047 | 0.097 pp |
| 2022 | SEA | 17 | 1033 | 1102 | 2135 / 2135 | 2130 / 2135 | 0.097 pp |
| 2022 | TB | 17 | 1146 | 1062 | 2208 / 2208 | 2199 / 2208 | 0.699 pp |
| 2022 | TEN | 17 | 979 | 1092 | 2071 / 2071 | 2067 / 2071 | 0.409 pp |
| 2022 | WAS | 17 | 1135 | 983 | 2118 / 2118 | 2112 / 2118 | 0.705 pp |

## Gate status

- NE-2025 and CHI-2025 legacy reproduction gate: passed byte-for-byte before this expanded build.
- Emitted offense and defense records reconcile to eligible play counts; every distribution reconciles observed + missing to denominator.
- Shotgun cross-source gate: passed.
- Shotgun exceptions are cross-source label disagreements at exact joined game/play keys, not missing participation joins; each cause is itemized in the manifest with the original source labels and IDs.
- This is Part A only; no movement evaluation is included.
