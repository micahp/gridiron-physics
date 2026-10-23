# M4d STR contact sensitivity diagnosis

Generated 2026-10-23T23:20:03.901Z; source commit `c96f9eedbc894fdbf9f4d8c7f323e63ecc2cc0d4`.

## Scope and method

This is a research-only follow-up on the pinned M4c solver wrapper. Production engine files and the separate TAK/BTK hold-drag branch were not changed. Three existing M4c outcome fixtures were replayed at the same 120 Hz timestep in Rapier 0.21.0 and Jolt 1.1.0: a retained-possession impact, a completed two-defender tackle, and a completed staggered three-defender tackle. The possession outcome holds, but its baseline penetration p95 exceeds the unchanged gate in both solvers; those failures remain reported.

Mass and STR were varied in separate phases. Mass sweeps changed one player mass at a time while all strengths were 80. STR sweeps changed one player strength at a time at the exact fixture masses; values include 0.1 steps from 80 through 81. The 103/102 kg plus STR 81 combined input was run only after both isolated sweeps had completed and the checkpoint had been written. After the interaction appeared, a second one-factor STR sweep held the 103/102 kg masses fixed and varied runner or tackler STR independently from 80.1 through 81.0. All runs use M4c behavior, compound proxies, seed 41027, 120 Hz, Rapier 8 solver iterations, and Jolt 1 collision step.

Every full-rate frame records player position/orientation/velocity, signed analytic surface gaps for every pair, the 0.10 m opportunity flag, engine-reported physical contact, torque requests and applied torque, applied force vectors with source labels, wrap and possession grip loads, and the unchanged per-step penetration samples. Full traces are gzip-compressed under `traces/`; use `viewer.html` for synchronized Rapier/Jolt playback.

## Preregistered numerical gates

The original M4c limits remain unchanged: maximum penetration ≤0.15 m, per-step p95 ≤0.05 m, and duration-weighted mean ≤0.025 m. Each run’s first-step penetration and counts above 0.01/0.05/0.10/0.15 m are preserved in the report JSON and trace. Physical contact and the fixture outcome gates are also checked per run.

## Key run results

| Scenario | Input | Engine | Focus min gap (m) | First contact (s) | p95 (m) | weighted mean (m) | max (m) | failures |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| possession-retained | baseline | rapier3d-compat | -0.0001 | 0.1167 | 0.0945 | 0.0481 | 0.1121 | 2 |
| possession-retained | baseline | jolt-physics-js | -0.0096 | 0.0917 | 0.0550 | 0.0093 | 0.0730 | 1 |
| possession-retained | madden-masses-103-102kg | rapier3d-compat | -0.0001 | 0.1167 | 0.0977 | 0.0504 | 0.1222 | 2 |
| possession-retained | madden-masses-103-102kg | jolt-physics-js | -0.0098 | 0.0917 | 0.0545 | 0.0077 | 0.0731 | 1 |
| gang-two-opposite-open | baseline | rapier3d-compat | -0.0351 | 0.2250 | 0.0090 | 0.0025 | 0.0351 | 0 |
| gang-two-opposite-open | baseline | jolt-physics-js | -0.0026 | 0.2083 | 0.0047 | 0.0037 | 0.0047 | 0 |
| gang-staggered-three | baseline | rapier3d-compat | -0.0016 | 0.1917 | 0.0324 | 0.0179 | 0.0616 | 0 |
| gang-staggered-three | baseline | jolt-physics-js | -0.0005 | 0.1750 | 0.0218 | 0.0169 | 0.0239 | 0 |
| possession-retained | baseline | rapier3d-compat | -0.0001 | 0.1167 | 0.0945 | 0.0481 | 0.1121 | 2 |
| possession-retained | baseline | jolt-physics-js | -0.0096 | 0.0917 | 0.0550 | 0.0093 | 0.0730 | 1 |
| possession-retained | str-carrier-80.10 | rapier3d-compat | 0.0180 | — | 0.1012 | 0.0366 | 0.1227 | 3 |
| possession-retained | str-carrier-80.10 | jolt-physics-js | -0.0096 | 0.0917 | 0.0550 | 0.0099 | 0.0730 | 1 |
| possession-retained | str-carrier-80.20 | rapier3d-compat | -0.0001 | 0.1167 | 0.1007 | 0.0488 | 0.1226 | 2 |
| possession-retained | str-carrier-80.20 | jolt-physics-js | -0.0096 | 0.0917 | 0.0550 | 0.0092 | 0.0730 | 1 |
| possession-retained | str-carrier-80.30 | rapier3d-compat | -0.0001 | 0.1167 | 0.1055 | 0.0664 | 0.1213 | 2 |
| possession-retained | str-carrier-80.30 | jolt-physics-js | -0.0096 | 0.0917 | 0.0550 | 0.0093 | 0.0730 | 1 |
| possession-retained | str-carrier-80.40 | rapier3d-compat | -0.0003 | 0.1167 | 0.0960 | 0.0529 | 0.1044 | 2 |
| possession-retained | str-carrier-80.40 | jolt-physics-js | -0.0096 | 0.0917 | 0.0550 | 0.0091 | 0.0730 | 1 |
| possession-retained | str-carrier-80.50 | rapier3d-compat | -0.0001 | 0.1167 | 0.1045 | 0.0489 | 0.1205 | 2 |
| possession-retained | str-carrier-80.50 | jolt-physics-js | -0.0096 | 0.0917 | 0.0550 | 0.0090 | 0.0730 | 1 |
| possession-retained | str-carrier-80.60 | rapier3d-compat | 0.0015 | 0.1250 | 0.0841 | 0.0532 | 0.1200 | 2 |
| possession-retained | str-carrier-80.60 | jolt-physics-js | -0.0096 | 0.0917 | 0.0550 | 0.0093 | 0.0730 | 1 |
| possession-retained | str-carrier-80.70 | rapier3d-compat | -0.0001 | 0.1167 | 0.0902 | 0.0523 | 0.1205 | 2 |
| possession-retained | str-carrier-80.70 | jolt-physics-js | -0.0096 | 0.0917 | 0.0550 | 0.0094 | 0.0730 | 1 |
| possession-retained | str-carrier-80.80 | rapier3d-compat | 0.0015 | 0.1250 | 0.0836 | 0.0517 | 0.1187 | 2 |
| possession-retained | str-carrier-80.80 | jolt-physics-js | -0.0096 | 0.0917 | 0.0550 | 0.0092 | 0.0730 | 1 |
| possession-retained | str-carrier-80.90 | rapier3d-compat | -0.0001 | 0.1167 | 0.1036 | 0.0573 | 0.1223 | 2 |
| possession-retained | str-carrier-80.90 | jolt-physics-js | -0.0096 | 0.0917 | 0.0550 | 0.0093 | 0.0730 | 1 |
| possession-retained | str-carrier-81.00 | rapier3d-compat | -0.0004 | 0.1167 | 0.1026 | 0.0501 | 0.1228 | 2 |
| possession-retained | str-carrier-81.00 | jolt-physics-js | -0.0096 | 0.0917 | 0.0550 | 0.0093 | 0.0730 | 1 |
| gang-two-opposite-open | baseline | rapier3d-compat | -0.0351 | 0.2250 | 0.0090 | 0.0025 | 0.0351 | 0 |
| gang-two-opposite-open | baseline | jolt-physics-js | -0.0026 | 0.2083 | 0.0047 | 0.0037 | 0.0047 | 0 |
| gang-two-opposite-open | str-lead-tackler-80.10 | rapier3d-compat | -0.0025 | 0.2250 | 0.0028 | 0.0015 | 0.0140 | 0 |
| gang-two-opposite-open | str-lead-tackler-80.10 | jolt-physics-js | -0.0027 | 0.2083 | 0.0047 | 0.0037 | 0.0047 | 0 |
| gang-two-opposite-open | str-lead-tackler-80.20 | rapier3d-compat | -0.0022 | 0.2250 | 0.0022 | 0.0008 | 0.0050 | 0 |
| gang-two-opposite-open | str-lead-tackler-80.20 | jolt-physics-js | -0.0029 | 0.2083 | 0.0047 | 0.0037 | 0.0047 | 0 |
| gang-two-opposite-open | str-lead-tackler-80.30 | rapier3d-compat | -0.0027 | 0.2250 | 0.0069 | 0.0038 | 0.0136 | 0 |
| gang-two-opposite-open | str-lead-tackler-80.30 | jolt-physics-js | -0.0029 | 0.2083 | 0.0047 | 0.0037 | 0.0047 | 0 |
| gang-two-opposite-open | str-lead-tackler-80.40 | rapier3d-compat | -0.0042 | 0.2250 | 0.0108 | 0.0024 | 0.0367 | 0 |
| gang-two-opposite-open | str-lead-tackler-80.40 | jolt-physics-js | -0.0029 | 0.2083 | 0.0047 | 0.0037 | 0.0047 | 0 |
| gang-two-opposite-open | str-lead-tackler-80.50 | rapier3d-compat | -0.0027 | 0.2250 | 0.0038 | 0.0013 | 0.0121 | 0 |
| gang-two-opposite-open | str-lead-tackler-80.50 | jolt-physics-js | -0.0028 | 0.2083 | 0.0047 | 0.0037 | 0.0047 | 0 |
| gang-two-opposite-open | str-lead-tackler-80.60 | rapier3d-compat | -0.0024 | 0.2250 | 0.0034 | 0.0015 | 0.0039 | 0 |
| gang-two-opposite-open | str-lead-tackler-80.60 | jolt-physics-js | -0.0028 | 0.2083 | 0.0047 | 0.0037 | 0.0047 | 0 |
| gang-two-opposite-open | str-lead-tackler-80.70 | rapier3d-compat | -0.0026 | 0.2250 | 0.0039 | 0.0019 | 0.0045 | 0 |
| gang-two-opposite-open | str-lead-tackler-80.70 | jolt-physics-js | -0.0027 | 0.2083 | 0.0047 | 0.0037 | 0.0047 | 0 |
| gang-two-opposite-open | str-lead-tackler-80.80 | rapier3d-compat | -0.0523 | 0.2250 | 0.0056 | 0.0020 | 0.0523 | 0 |
| gang-two-opposite-open | str-lead-tackler-80.80 | jolt-physics-js | -0.0029 | 0.2083 | 0.0047 | 0.0037 | 0.0047 | 0 |
| gang-two-opposite-open | str-lead-tackler-80.90 | rapier3d-compat | -0.0027 | 0.2250 | 0.0039 | 0.0028 | 0.0330 | 0 |
| gang-two-opposite-open | str-lead-tackler-80.90 | jolt-physics-js | -0.0027 | 0.2083 | 0.0047 | 0.0037 | 0.0047 | 0 |
| gang-two-opposite-open | str-lead-tackler-81.00 | rapier3d-compat | -0.0025 | 0.2250 | 0.0044 | 0.0024 | 0.0452 | 0 |
| gang-two-opposite-open | str-lead-tackler-81.00 | jolt-physics-js | -0.0029 | 0.2083 | 0.0047 | 0.0037 | 0.0047 | 0 |
| gang-staggered-three | baseline | rapier3d-compat | -0.0016 | 0.1917 | 0.0324 | 0.0179 | 0.0616 | 0 |
| gang-staggered-three | baseline | jolt-physics-js | -0.0005 | 0.1750 | 0.0218 | 0.0169 | 0.0239 | 0 |
| gang-staggered-three | str-lead-tackler-80.10 | rapier3d-compat | -0.0016 | 0.1917 | 0.0423 | 0.0205 | 0.0634 | 0 |
| gang-staggered-three | str-lead-tackler-80.10 | jolt-physics-js | -0.0004 | 0.1750 | 0.0249 | 0.0182 | 0.0252 | 0 |
| gang-staggered-three | str-lead-tackler-80.20 | rapier3d-compat | -0.0010 | 0.1917 | 0.0338 | 0.0154 | 0.0628 | 0 |
| gang-staggered-three | str-lead-tackler-80.20 | jolt-physics-js | -0.0004 | 0.1750 | 0.0235 | 0.0168 | 0.0297 | 0 |
| gang-staggered-three | str-lead-tackler-80.30 | rapier3d-compat | -0.0006 | 0.1917 | 0.0450 | 0.0178 | 0.0609 | 0 |
| gang-staggered-three | str-lead-tackler-80.30 | jolt-physics-js | -0.0004 | 0.1750 | 0.0235 | 0.0180 | 0.0242 | 0 |
| gang-staggered-three | str-lead-tackler-80.40 | rapier3d-compat | -0.0018 | 0.1917 | 0.0406 | 0.0148 | 0.0539 | 0 |
| gang-staggered-three | str-lead-tackler-80.40 | jolt-physics-js | -0.0003 | 0.1750 | 0.0247 | 0.0179 | 0.0320 | 0 |
| gang-staggered-three | str-lead-tackler-80.50 | rapier3d-compat | -0.0015 | 0.1917 | 0.0387 | 0.0180 | 0.0555 | 0 |
| gang-staggered-three | str-lead-tackler-80.50 | jolt-physics-js | -0.0004 | 0.1750 | 0.0236 | 0.0170 | 0.0247 | 0 |
| gang-staggered-three | str-lead-tackler-80.60 | rapier3d-compat | -0.0016 | 0.1917 | 0.0459 | 0.0161 | 0.0635 | 0 |
| gang-staggered-three | str-lead-tackler-80.60 | jolt-physics-js | -0.0004 | 0.1750 | 0.0237 | 0.0176 | 0.0259 | 0 |
| gang-staggered-three | str-lead-tackler-80.70 | rapier3d-compat | -0.0017 | 0.1917 | 0.0333 | 0.0180 | 0.0532 | 0 |
| gang-staggered-three | str-lead-tackler-80.70 | jolt-physics-js | -0.0003 | 0.1750 | 0.0235 | 0.0176 | 0.0245 | 0 |
| gang-staggered-three | str-lead-tackler-80.80 | rapier3d-compat | -0.0007 | 0.1917 | 0.0374 | 0.0175 | 0.0558 | 0 |
| gang-staggered-three | str-lead-tackler-80.80 | jolt-physics-js | -0.0004 | 0.1750 | 0.0230 | 0.0164 | 0.0266 | 0 |
| gang-staggered-three | str-lead-tackler-80.90 | rapier3d-compat | -0.0014 | 0.1917 | 0.0352 | 0.0151 | 0.0600 | 0 |
| gang-staggered-three | str-lead-tackler-80.90 | jolt-physics-js | -0.0006 | 0.1750 | 0.0243 | 0.0183 | 0.0247 | 0 |
| gang-staggered-three | str-lead-tackler-81.00 | rapier3d-compat | -0.0006 | 0.1917 | 0.0352 | 0.0119 | 0.0552 | 0 |
| gang-staggered-three | str-lead-tackler-81.00 | jolt-physics-js | -0.0005 | 0.1750 | 0.0244 | 0.0182 | 0.0247 | 0 |
| possession-retained | combined-madden-masses-103-102kg-runner-str-81 | rapier3d-compat | 0.0190 | — | 0.1062 | 0.0304 | 0.1289 | 3 |
| possession-retained | combined-madden-masses-103-102kg-runner-str-81 | jolt-physics-js | -0.0098 | 0.0917 | 0.0545 | 0.0069 | 0.0731 | 1 |
| possession-retained | target-masses-str-carrier-80.10 | rapier3d-compat | -0.0001 | 0.1167 | 0.1080 | 0.0486 | 0.1224 | 2 |
| possession-retained | target-masses-str-carrier-80.10 | jolt-physics-js | -0.0098 | 0.0917 | 0.0545 | 0.0071 | 0.0731 | 1 |
| possession-retained | target-masses-str-carrier-80.20 | rapier3d-compat | -0.0001 | 0.1167 | 0.1158 | 0.0531 | 0.1322 | 2 |
| possession-retained | target-masses-str-carrier-80.20 | jolt-physics-js | -0.0098 | 0.0917 | 0.0545 | 0.0078 | 0.0731 | 1 |
| possession-retained | target-masses-str-carrier-80.30 | rapier3d-compat | 0.0128 | — | 0.0807 | 0.0338 | 0.1196 | 3 |
| possession-retained | target-masses-str-carrier-80.30 | jolt-physics-js | -0.0098 | 0.0917 | 0.0545 | 0.0075 | 0.0731 | 1 |
| possession-retained | target-masses-str-carrier-80.40 | rapier3d-compat | -0.0001 | 0.1167 | 0.1075 | 0.0505 | 0.1219 | 2 |
| possession-retained | target-masses-str-carrier-80.40 | jolt-physics-js | -0.0098 | 0.0917 | 0.0545 | 0.0074 | 0.0731 | 1 |
| possession-retained | target-masses-str-carrier-80.50 | rapier3d-compat | -0.0001 | 0.1333 | 0.0904 | 0.0520 | 0.1213 | 2 |
| possession-retained | target-masses-str-carrier-80.50 | jolt-physics-js | -0.0098 | 0.0917 | 0.0545 | 0.0068 | 0.0731 | 1 |
| possession-retained | target-masses-str-carrier-80.60 | rapier3d-compat | 0.0161 | — | 0.0933 | 0.0324 | 0.1216 | 3 |
| possession-retained | target-masses-str-carrier-80.60 | jolt-physics-js | -0.0098 | 0.0917 | 0.0545 | 0.0069 | 0.0731 | 1 |
| possession-retained | target-masses-str-carrier-80.70 | rapier3d-compat | -0.0001 | 0.1250 | 0.0904 | 0.0593 | 0.1236 | 2 |
| possession-retained | target-masses-str-carrier-80.70 | jolt-physics-js | -0.0098 | 0.0917 | 0.0545 | 0.0069 | 0.0731 | 1 |
| possession-retained | target-masses-str-carrier-80.80 | rapier3d-compat | -0.0001 | 0.1167 | 0.0928 | 0.0478 | 0.1081 | 2 |
| possession-retained | target-masses-str-carrier-80.80 | jolt-physics-js | -0.0098 | 0.0917 | 0.0545 | 0.0071 | 0.0731 | 1 |
| possession-retained | target-masses-str-carrier-80.90 | rapier3d-compat | -0.0001 | 0.1250 | 0.0925 | 0.0545 | 0.1215 | 2 |
| possession-retained | target-masses-str-carrier-80.90 | jolt-physics-js | -0.0098 | 0.0917 | 0.0545 | 0.0070 | 0.0731 | 1 |
| possession-retained | target-masses-str-carrier-81.00 | rapier3d-compat | 0.0190 | — | 0.1062 | 0.0304 | 0.1289 | 3 |
| possession-retained | target-masses-str-carrier-81.00 | jolt-physics-js | -0.0098 | 0.0917 | 0.0545 | 0.0069 | 0.0731 | 1 |

## STR 80–81 continuity

The machine-readable matrix contains the full adjacent strength sweep. Controller torque is a continuous scalar gain in the existing M4c balance law; contact itself is a thresholded solver event. The table below reports every 0.1 STR sample for the carrier in the retention fixture and the lead tackler in each tackle fixture. Read the adjacent `minimumSurfaceGapM`, torque, and actual-contact results together to distinguish a smooth approach from a solver event transition.

| Scenario | Engine | Actor | STR | Focus min gap (m) | First contact (s) | Contact steps | Peak requested torque (Nm) | failures |
|---|---|---|---:|---:|---:|---:|---:|---:|
| possession-retained | rapier3d-compat | runner | 80.10 | 0.0180 | — | 0 | 363.1119 | 3 |
| possession-retained | jolt-physics-js | runner | 80.10 | -0.0096 | 0.0917 | 250 | 435.7889 | 1 |
| possession-retained | rapier3d-compat | runner | 80.20 | -0.0001 | 0.1167 | 125 | 363.2942 | 2 |
| possession-retained | jolt-physics-js | runner | 80.20 | -0.0096 | 0.0917 | 249 | 436.1357 | 1 |
| possession-retained | rapier3d-compat | runner | 80.30 | -0.0001 | 0.1167 | 126 | 363.5282 | 2 |
| possession-retained | jolt-physics-js | runner | 80.30 | -0.0096 | 0.0917 | 252 | 436.4237 | 1 |
| possession-retained | rapier3d-compat | runner | 80.40 | -0.0003 | 0.1167 | 128 | 363.7277 | 2 |
| possession-retained | jolt-physics-js | runner | 80.40 | -0.0096 | 0.0917 | 250 | 436.7624 | 1 |
| possession-retained | rapier3d-compat | runner | 80.50 | -0.0001 | 0.1167 | 111 | 369.6245 | 2 |
| possession-retained | jolt-physics-js | runner | 80.50 | -0.0096 | 0.0917 | 246 | 437.0628 | 1 |
| possession-retained | rapier3d-compat | runner | 80.60 | 0.0015 | 0.1250 | 103 | 369.8259 | 2 |
| possession-retained | jolt-physics-js | runner | 80.60 | -0.0096 | 0.0917 | 251 | 437.4420 | 1 |
| possession-retained | rapier3d-compat | runner | 80.70 | -0.0001 | 0.1167 | 112 | 370.0272 | 2 |
| possession-retained | jolt-physics-js | runner | 80.70 | -0.0096 | 0.0917 | 251 | 437.8272 | 1 |
| possession-retained | rapier3d-compat | runner | 80.80 | 0.0015 | 0.1250 | 95 | 370.2496 | 2 |
| possession-retained | jolt-physics-js | runner | 80.80 | -0.0096 | 0.0917 | 251 | 438.0963 | 1 |
| possession-retained | rapier3d-compat | runner | 80.90 | -0.0001 | 0.1167 | 100 | 364.6865 | 2 |
| possession-retained | jolt-physics-js | runner | 80.90 | -0.0096 | 0.0917 | 251 | 438.4912 | 1 |
| possession-retained | rapier3d-compat | runner | 81.00 | -0.0004 | 0.1167 | 118 | 364.8962 | 2 |
| possession-retained | jolt-physics-js | runner | 81.00 | -0.0096 | 0.0917 | 251 | 438.8077 | 1 |
| gang-two-opposite-open | rapier3d-compat | defender-left | 80.10 | -0.0025 | 0.2250 | 768 | 1314.9000 | 0 |
| gang-two-opposite-open | jolt-physics-js | defender-left | 80.10 | -0.0027 | 0.2083 | 782 | 1163.8426 | 0 |
| gang-two-opposite-open | rapier3d-compat | defender-left | 80.20 | -0.0022 | 0.2250 | 768 | 1266.5654 | 0 |
| gang-two-opposite-open | jolt-physics-js | defender-left | 80.20 | -0.0029 | 0.2083 | 782 | 1164.6082 | 0 |
| gang-two-opposite-open | rapier3d-compat | defender-left | 80.30 | -0.0027 | 0.2250 | 717 | 1315.4661 | 0 |
| gang-two-opposite-open | jolt-physics-js | defender-left | 80.30 | -0.0029 | 0.2083 | 781 | 1165.3674 | 0 |
| gang-two-opposite-open | rapier3d-compat | defender-left | 80.40 | -0.0042 | 0.2250 | 766 | 1288.3632 | 0 |
| gang-two-opposite-open | jolt-physics-js | defender-left | 80.40 | -0.0029 | 0.2083 | 781 | 1166.0615 | 0 |
| gang-two-opposite-open | rapier3d-compat | defender-left | 80.50 | -0.0027 | 0.2250 | 763 | 1240.5915 | 0 |
| gang-two-opposite-open | jolt-physics-js | defender-left | 80.50 | -0.0028 | 0.2083 | 781 | 1166.9691 | 0 |
| gang-two-opposite-open | rapier3d-compat | defender-left | 80.60 | -0.0024 | 0.2250 | 769 | 1295.1739 | 0 |
| gang-two-opposite-open | jolt-physics-js | defender-left | 80.60 | -0.0028 | 0.2083 | 781 | 1167.6504 | 0 |
| gang-two-opposite-open | rapier3d-compat | defender-left | 80.70 | -0.0026 | 0.2250 | 768 | 1296.5999 | 0 |
| gang-two-opposite-open | jolt-physics-js | defender-left | 80.70 | -0.0027 | 0.2083 | 780 | 1168.4160 | 0 |
| gang-two-opposite-open | rapier3d-compat | defender-left | 80.80 | -0.0523 | 0.2250 | 767 | 1279.6390 | 0 |
| gang-two-opposite-open | jolt-physics-js | defender-left | 80.80 | -0.0029 | 0.2083 | 782 | 1169.7563 | 0 |
| gang-two-opposite-open | rapier3d-compat | defender-left | 80.90 | -0.0027 | 0.2250 | 757 | 1263.8844 | 0 |
| gang-two-opposite-open | jolt-physics-js | defender-left | 80.90 | -0.0027 | 0.2083 | 780 | 1170.1292 | 0 |
| gang-two-opposite-open | rapier3d-compat | defender-left | 81.00 | -0.0025 | 0.2250 | 761 | 1247.8842 | 0 |
| gang-two-opposite-open | jolt-physics-js | defender-left | 81.00 | -0.0029 | 0.2083 | 780 | 1171.2992 | 0 |
| gang-staggered-three | rapier3d-compat | first-hit | 80.10 | -0.0016 | 0.1917 | 876 | 550.2107 | 0 |
| gang-staggered-three | jolt-physics-js | first-hit | 80.10 | -0.0004 | 0.1750 | 847 | 391.4090 | 0 |
| gang-staggered-three | rapier3d-compat | first-hit | 80.20 | -0.0010 | 0.1917 | 869 | 541.0644 | 0 |
| gang-staggered-three | jolt-physics-js | first-hit | 80.20 | -0.0004 | 0.1750 | 847 | 463.2053 | 0 |
| gang-staggered-three | rapier3d-compat | first-hit | 80.30 | -0.0006 | 0.1917 | 865 | 542.2314 | 0 |
| gang-staggered-three | jolt-physics-js | first-hit | 80.30 | -0.0004 | 0.1750 | 847 | 391.8638 | 0 |
| gang-staggered-three | rapier3d-compat | first-hit | 80.40 | -0.0018 | 0.1917 | 869 | 559.7897 | 0 |
| gang-staggered-three | jolt-physics-js | first-hit | 80.40 | -0.0003 | 0.1750 | 847 | 464.9631 | 0 |
| gang-staggered-three | rapier3d-compat | first-hit | 80.50 | -0.0015 | 0.1917 | 878 | 519.4416 | 0 |
| gang-staggered-three | jolt-physics-js | first-hit | 80.50 | -0.0004 | 0.1750 | 847 | 392.3109 | 0 |
| gang-staggered-three | rapier3d-compat | first-hit | 80.60 | -0.0016 | 0.1917 | 878 | 558.1825 | 0 |
| gang-staggered-three | jolt-physics-js | first-hit | 80.60 | -0.0004 | 0.1750 | 847 | 392.5360 | 0 |
| gang-staggered-three | rapier3d-compat | first-hit | 80.70 | -0.0017 | 0.1917 | 866 | 554.1456 | 0 |
| gang-staggered-three | jolt-physics-js | first-hit | 80.70 | -0.0003 | 0.1750 | 847 | 392.7539 | 0 |
| gang-staggered-three | rapier3d-compat | first-hit | 80.80 | -0.0007 | 0.1917 | 865 | 537.7776 | 0 |
| gang-staggered-three | jolt-physics-js | first-hit | 80.80 | -0.0004 | 0.1750 | 847 | 464.8255 | 0 |
| gang-staggered-three | rapier3d-compat | first-hit | 80.90 | -0.0014 | 0.1917 | 854 | 543.8153 | 0 |
| gang-staggered-three | jolt-physics-js | first-hit | 80.90 | -0.0006 | 0.1750 | 847 | 393.2060 | 0 |
| gang-staggered-three | rapier3d-compat | first-hit | 81.00 | -0.0006 | 0.1917 | 864 | 551.5881 | 0 |
| gang-staggered-three | jolt-physics-js | first-hit | 81.00 | -0.0005 | 0.1750 | 847 | 393.4249 | 0 |
| possession-retained | rapier3d-compat | runner | 80.10 | -0.0001 | 0.1167 | 127 | 372.5890 | 2 |
| possession-retained | jolt-physics-js | runner | 80.10 | -0.0098 | 0.0917 | 238 | 430.0829 | 1 |
| possession-retained | rapier3d-compat | runner | 80.20 | -0.0001 | 0.1167 | 124 | 372.7430 | 2 |
| possession-retained | jolt-physics-js | runner | 80.20 | -0.0098 | 0.0917 | 238 | 430.4697 | 1 |
| possession-retained | rapier3d-compat | runner | 80.30 | 0.0128 | — | 0 | 372.9387 | 3 |
| possession-retained | jolt-physics-js | runner | 80.30 | -0.0098 | 0.0917 | 237 | 430.7848 | 1 |
| possession-retained | rapier3d-compat | runner | 80.40 | -0.0001 | 0.1167 | 119 | 373.1047 | 2 |
| possession-retained | jolt-physics-js | runner | 80.40 | -0.0098 | 0.0917 | 237 | 431.1204 | 1 |
| possession-retained | rapier3d-compat | runner | 80.50 | -0.0001 | 0.1333 | 84 | 373.2876 | 2 |
| possession-retained | jolt-physics-js | runner | 80.50 | -0.0098 | 0.0917 | 238 | 431.4678 | 1 |
| possession-retained | rapier3d-compat | runner | 80.60 | 0.0161 | — | 0 | 373.5607 | 3 |
| possession-retained | jolt-physics-js | runner | 80.60 | -0.0098 | 0.0917 | 238 | 431.8044 | 1 |
| possession-retained | rapier3d-compat | runner | 80.70 | -0.0001 | 0.1250 | 91 | 373.7405 | 2 |
| possession-retained | jolt-physics-js | runner | 80.70 | -0.0098 | 0.0917 | 235 | 432.1363 | 1 |
| possession-retained | rapier3d-compat | runner | 80.80 | -0.0001 | 0.1167 | 126 | 373.9413 | 2 |
| possession-retained | jolt-physics-js | runner | 80.80 | -0.0098 | 0.0917 | 234 | 432.4489 | 1 |
| possession-retained | rapier3d-compat | runner | 80.90 | -0.0001 | 0.1250 | 91 | 374.0978 | 2 |
| possession-retained | jolt-physics-js | runner | 80.90 | -0.0098 | 0.0917 | 233 | 432.8035 | 1 |
| possession-retained | rapier3d-compat | runner | 81.00 | 0.0190 | — | 0 | 374.3305 | 3 |
| possession-retained | jolt-physics-js | runner | 81.00 | -0.0098 | 0.0917 | 234 | 433.0961 | 1 |
| possession-retained | rapier3d-compat | impact-defender | 80.10 | 0.0118 | — | 0 | 228.0459 | 3 |
| possession-retained | jolt-physics-js | impact-defender | 80.10 | -0.0098 | 0.0917 | 238 | 249.5617 | 1 |
| possession-retained | rapier3d-compat | impact-defender | 80.20 | 0.0120 | — | 0 | 228.1848 | 3 |
| possession-retained | jolt-physics-js | impact-defender | 80.20 | -0.0098 | 0.0917 | 237 | 249.7254 | 1 |
| possession-retained | rapier3d-compat | impact-defender | 80.30 | -0.0001 | 0.1333 | 92 | 228.3206 | 2 |
| possession-retained | jolt-physics-js | impact-defender | 80.30 | -0.0098 | 0.0917 | 237 | 249.8672 | 1 |
| possession-retained | rapier3d-compat | impact-defender | 80.40 | 0.0122 | — | 0 | 228.4542 | 3 |
| possession-retained | jolt-physics-js | impact-defender | 80.40 | -0.0098 | 0.0917 | 238 | 249.9968 | 1 |
| possession-retained | rapier3d-compat | impact-defender | 80.50 | 0.0159 | — | 0 | 224.8800 | 3 |
| possession-retained | jolt-physics-js | impact-defender | 80.50 | -0.0098 | 0.0917 | 237 | 250.1502 | 1 |
| possession-retained | rapier3d-compat | impact-defender | 80.60 | 0.0170 | — | 0 | 225.0046 | 3 |
| possession-retained | jolt-physics-js | impact-defender | 80.60 | -0.0098 | 0.0917 | 237 | 250.2986 | 1 |
| possession-retained | rapier3d-compat | impact-defender | 80.70 | 0.0123 | — | 0 | 225.1341 | 3 |
| possession-retained | jolt-physics-js | impact-defender | 80.70 | -0.0098 | 0.0917 | 235 | 250.4180 | 1 |
| possession-retained | rapier3d-compat | impact-defender | 80.80 | -0.0001 | 0.1167 | 126 | 225.2802 | 2 |
| possession-retained | jolt-physics-js | impact-defender | 80.80 | -0.0098 | 0.0917 | 235 | 250.5691 | 1 |
| possession-retained | rapier3d-compat | impact-defender | 80.90 | -0.0001 | 0.1167 | 125 | 225.4113 | 2 |
| possession-retained | jolt-physics-js | impact-defender | 80.90 | -0.0098 | 0.0917 | 234 | 250.7367 | 1 |
| possession-retained | rapier3d-compat | impact-defender | 81.00 | -0.0001 | 0.1250 | 101 | 225.5294 | 2 |
| possession-retained | jolt-physics-js | impact-defender | 81.00 | -0.0098 | 0.0917 | 234 | 250.8880 | 1 |

## Cause of the Rapier/Jolt split

The combined target-mass + runner STR 81 case is trajectory mediated. At the first split tick (0.09167 s), Rapier still has a positive analytic player-surface gap while Jolt has crossed into overlap and reports contact. In the combined Rapier trace the minimum gap stays positive for the entire run. The player proxy layout is fixed, and Rapier checks all player collider pairs; the evidence does not support a missed Rapier contact query. The split begins during the early ground-contact response: the adapters produce different angular states, then the same state-feedback balance controller requests different torques, and the player gap grows before a player-player contact event. Once Jolt establishes contact, its wrap force further changes the later paths.

STR changes only the M4c balance-controller gain `(0.55 + STR/120) × balanceScale`; moving 80→81 changes that gain by about 0.685%. At the fixture’s original 98/106 kg masses, runner STR 81 still yields Rapier player contact. At 103/102 kg, the mass-only run also contacts in Rapier, but adding runner STR 81 leaves a 0.01899 m minimum gap and no player contact; Jolt maintains contact. In Rapier at those fixed masses, the runner torque request at tick 5 changes from 226.19 Nm at STR 80 to 227.72 Nm at STR 81, while the tick 11 analytic gap changes from 0.02325 m to 0.03172 m. This is a near-grazing mass/strength interaction amplified by solver-dependent ground and balance feedback, not a direct tackle drag or grip-rating effect.

## Intermediate response check

The fixed-mass STR sweep confirms continuous controller-input changes but non-monotonic physical outcomes. Several adjacent 0.1 STR steps switch Rapier between a tiny analytic overlap (about 0.1 mm) with contact and a positive minimum gap of 1.3–1.9 cm without contact; contact returns at nearby values. These transitions align with whether the transformed proxy reaches the geometry threshold, while the full-run path changes after collision and wrap feedback. The Boolean contact transition is therefore explained by geometric crossing, but the full trajectory response is solver-sensitive and not monotonic in STR. Per-adjacent-step response data is in `responseContinuity`; per-tick torque and gap samples are in every trace.

## Engine split details

Across 70 matched comparisons, Rapier had a positive gap while Jolt had crossed into analytic overlap at the first contact-state split; those are trajectory-mediated separations. In 96 comparisons, Jolt reported contact while both analytic gaps were still positive. Those cases expose a mismatch between the shared analytic surface-gap proxy and the engines’ contact boundaries; they cannot be classified as a Rapier detection failure from this telemetry alone. No split had a nonpositive Rapier gap with Rapier reporting no contact. Exact ticks and paired trajectories are in `sensitivity-report.json`.

- `possession-retained` / `baseline`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0254 m, Jolt gap -0.0063 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `mass-carrier--2kg`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0311 m, Jolt gap -0.0060 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `mass-carrier--1kg`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0257 m, Jolt gap -0.0061 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `mass-carrier--0.5kg`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0299 m, Jolt gap -0.0062 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `mass-carrier-+0.5kg`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0236 m, Jolt gap -0.0063 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `mass-carrier-+1kg`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0255 m, Jolt gap -0.0064 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `mass-carrier-+2kg`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0326 m, Jolt gap -0.0065 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `mass-carrier-+4kg`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0217 m, Jolt gap -0.0068 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `mass-lead-tackler--2kg`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0271 m, Jolt gap -0.0061 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `mass-lead-tackler--1kg`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0290 m, Jolt gap -0.0062 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `mass-lead-tackler--0.5kg`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0272 m, Jolt gap -0.0062 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `mass-lead-tackler-+0.5kg`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0248 m, Jolt gap -0.0063 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `mass-lead-tackler-+1kg`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0290 m, Jolt gap -0.0063 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `mass-lead-tackler-+2kg`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0241 m, Jolt gap -0.0064 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `mass-lead-tackler-+4kg`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0255 m, Jolt gap -0.0066 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `madden-masses-103-102kg`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0232 m, Jolt gap -0.0066 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `gang-two-opposite-open` / `baseline`: first contact-state split at tick 25 (0.2083 s), Rapier gap 0.0282 m, Jolt gap 0.0203 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-two-opposite-open` / `mass-carrier--2kg`: first contact-state split at tick 25 (0.2083 s), Rapier gap 0.0282 m, Jolt gap 0.0203 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-two-opposite-open` / `mass-carrier--1kg`: first contact-state split at tick 25 (0.2083 s), Rapier gap 0.0282 m, Jolt gap 0.0203 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-two-opposite-open` / `mass-carrier--0.5kg`: first contact-state split at tick 25 (0.2083 s), Rapier gap 0.0282 m, Jolt gap 0.0203 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-two-opposite-open` / `mass-carrier-+0.5kg`: first contact-state split at tick 25 (0.2083 s), Rapier gap 0.0282 m, Jolt gap 0.0203 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-two-opposite-open` / `mass-carrier-+1kg`: first contact-state split at tick 25 (0.2083 s), Rapier gap 0.0282 m, Jolt gap 0.0203 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-two-opposite-open` / `mass-carrier-+2kg`: first contact-state split at tick 25 (0.2083 s), Rapier gap 0.0282 m, Jolt gap 0.0203 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-two-opposite-open` / `mass-carrier-+4kg`: first contact-state split at tick 25 (0.2083 s), Rapier gap 0.0282 m, Jolt gap 0.0203 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-two-opposite-open` / `mass-lead-tackler--2kg`: first contact-state split at tick 25 (0.2083 s), Rapier gap 0.0287 m, Jolt gap 0.0209 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-two-opposite-open` / `mass-lead-tackler--1kg`: first contact-state split at tick 25 (0.2083 s), Rapier gap 0.0285 m, Jolt gap 0.0206 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-two-opposite-open` / `mass-lead-tackler--0.5kg`: first contact-state split at tick 25 (0.2083 s), Rapier gap 0.0283 m, Jolt gap 0.0204 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-two-opposite-open` / `mass-lead-tackler-+0.5kg`: first contact-state split at tick 25 (0.2083 s), Rapier gap 0.0281 m, Jolt gap 0.0202 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-two-opposite-open` / `mass-lead-tackler-+1kg`: first contact-state split at tick 25 (0.2083 s), Rapier gap 0.0282 m, Jolt gap 0.0200 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-two-opposite-open` / `mass-lead-tackler-+2kg`: first contact-state split at tick 25 (0.2083 s), Rapier gap 0.0280 m, Jolt gap 0.0198 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-two-opposite-open` / `mass-lead-tackler-+4kg`: first contact-state split at tick 25 (0.2083 s), Rapier gap 0.0275 m, Jolt gap 0.0192 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-staggered-three` / `baseline`: first contact-state split at tick 21 (0.1750 s), Rapier gap 0.0266 m, Jolt gap 0.0094 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-staggered-three` / `mass-carrier--2kg`: first contact-state split at tick 21 (0.1750 s), Rapier gap 0.0260 m, Jolt gap 0.0095 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-staggered-three` / `mass-carrier--1kg`: first contact-state split at tick 21 (0.1750 s), Rapier gap 0.0240 m, Jolt gap 0.0095 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-staggered-three` / `mass-carrier--0.5kg`: first contact-state split at tick 21 (0.1750 s), Rapier gap 0.0228 m, Jolt gap 0.0095 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-staggered-three` / `mass-carrier-+0.5kg`: first contact-state split at tick 21 (0.1750 s), Rapier gap 0.0261 m, Jolt gap 0.0094 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-staggered-three` / `mass-carrier-+1kg`: first contact-state split at tick 21 (0.1750 s), Rapier gap 0.0231 m, Jolt gap 0.0094 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-staggered-three` / `mass-carrier-+2kg`: first contact-state split at tick 21 (0.1750 s), Rapier gap 0.0264 m, Jolt gap 0.0094 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-staggered-three` / `mass-carrier-+4kg`: first contact-state split at tick 21 (0.1750 s), Rapier gap 0.0230 m, Jolt gap 0.0093 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-staggered-three` / `mass-lead-tackler--2kg`: first contact-state split at tick 21 (0.1750 s), Rapier gap 0.0232 m, Jolt gap 0.0100 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-staggered-three` / `mass-lead-tackler--1kg`: first contact-state split at tick 21 (0.1750 s), Rapier gap 0.0246 m, Jolt gap 0.0097 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-staggered-three` / `mass-lead-tackler--0.5kg`: first contact-state split at tick 21 (0.1750 s), Rapier gap 0.0246 m, Jolt gap 0.0096 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-staggered-three` / `mass-lead-tackler-+0.5kg`: first contact-state split at tick 21 (0.1750 s), Rapier gap 0.0253 m, Jolt gap 0.0093 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-staggered-three` / `mass-lead-tackler-+1kg`: first contact-state split at tick 21 (0.1750 s), Rapier gap 0.0219 m, Jolt gap 0.0092 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-staggered-three` / `mass-lead-tackler-+2kg`: first contact-state split at tick 21 (0.1750 s), Rapier gap 0.0216 m, Jolt gap 0.0089 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-staggered-three` / `mass-lead-tackler-+4kg`: first contact-state split at tick 21 (0.1750 s), Rapier gap 0.0229 m, Jolt gap 0.0084 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `possession-retained` / `baseline`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0254 m, Jolt gap -0.0063 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `str-carrier-79.00`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0258 m, Jolt gap -0.0063 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `str-carrier-79.50`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0233 m, Jolt gap -0.0063 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `str-carrier-79.75`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0238 m, Jolt gap -0.0063 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `str-carrier-80.10`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0316 m, Jolt gap -0.0063 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `str-carrier-80.20`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0242 m, Jolt gap -0.0063 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `str-carrier-80.30`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0237 m, Jolt gap -0.0063 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `str-carrier-80.40`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0254 m, Jolt gap -0.0062 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `str-carrier-80.50`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0267 m, Jolt gap -0.0062 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `str-carrier-80.60`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0298 m, Jolt gap -0.0062 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `str-carrier-80.70`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0288 m, Jolt gap -0.0062 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `str-carrier-80.80`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0297 m, Jolt gap -0.0062 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `str-carrier-80.90`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0242 m, Jolt gap -0.0062 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `str-carrier-81.00`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0242 m, Jolt gap -0.0062 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `str-carrier-81.25`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0232 m, Jolt gap -0.0062 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `str-carrier-81.50`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0256 m, Jolt gap -0.0062 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `str-carrier-82.00`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0296 m, Jolt gap -0.0061 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `str-lead-tackler-79.00`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0230 m, Jolt gap -0.0063 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `str-lead-tackler-79.50`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0235 m, Jolt gap -0.0063 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `str-lead-tackler-79.75`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0341 m, Jolt gap -0.0063 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `str-lead-tackler-80.10`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0297 m, Jolt gap -0.0063 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `str-lead-tackler-80.20`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0248 m, Jolt gap -0.0063 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `str-lead-tackler-80.30`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0247 m, Jolt gap -0.0063 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `str-lead-tackler-80.40`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0235 m, Jolt gap -0.0063 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `str-lead-tackler-80.50`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0238 m, Jolt gap -0.0063 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `str-lead-tackler-80.60`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0284 m, Jolt gap -0.0063 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `str-lead-tackler-80.70`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0249 m, Jolt gap -0.0063 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `str-lead-tackler-80.80`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0303 m, Jolt gap -0.0062 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `str-lead-tackler-80.90`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0270 m, Jolt gap -0.0062 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `str-lead-tackler-81.00`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0291 m, Jolt gap -0.0062 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `str-lead-tackler-81.25`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0232 m, Jolt gap -0.0062 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `str-lead-tackler-81.50`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0303 m, Jolt gap -0.0062 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `str-lead-tackler-82.00`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0236 m, Jolt gap -0.0062 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `gang-two-opposite-open` / `baseline`: first contact-state split at tick 25 (0.2083 s), Rapier gap 0.0282 m, Jolt gap 0.0203 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-two-opposite-open` / `str-carrier-79.00`: first contact-state split at tick 25 (0.2083 s), Rapier gap 0.0282 m, Jolt gap 0.0203 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-two-opposite-open` / `str-carrier-79.50`: first contact-state split at tick 25 (0.2083 s), Rapier gap 0.0282 m, Jolt gap 0.0203 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-two-opposite-open` / `str-carrier-79.75`: first contact-state split at tick 25 (0.2083 s), Rapier gap 0.0282 m, Jolt gap 0.0203 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-two-opposite-open` / `str-carrier-80.10`: first contact-state split at tick 25 (0.2083 s), Rapier gap 0.0282 m, Jolt gap 0.0203 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-two-opposite-open` / `str-carrier-80.20`: first contact-state split at tick 25 (0.2083 s), Rapier gap 0.0282 m, Jolt gap 0.0203 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-two-opposite-open` / `str-carrier-80.30`: first contact-state split at tick 25 (0.2083 s), Rapier gap 0.0282 m, Jolt gap 0.0203 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-two-opposite-open` / `str-carrier-80.40`: first contact-state split at tick 25 (0.2083 s), Rapier gap 0.0282 m, Jolt gap 0.0203 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-two-opposite-open` / `str-carrier-80.50`: first contact-state split at tick 25 (0.2083 s), Rapier gap 0.0282 m, Jolt gap 0.0203 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-two-opposite-open` / `str-carrier-80.60`: first contact-state split at tick 25 (0.2083 s), Rapier gap 0.0282 m, Jolt gap 0.0203 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-two-opposite-open` / `str-carrier-80.70`: first contact-state split at tick 25 (0.2083 s), Rapier gap 0.0282 m, Jolt gap 0.0203 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-two-opposite-open` / `str-carrier-80.80`: first contact-state split at tick 25 (0.2083 s), Rapier gap 0.0282 m, Jolt gap 0.0203 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-two-opposite-open` / `str-carrier-80.90`: first contact-state split at tick 25 (0.2083 s), Rapier gap 0.0282 m, Jolt gap 0.0203 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-two-opposite-open` / `str-carrier-81.00`: first contact-state split at tick 25 (0.2083 s), Rapier gap 0.0282 m, Jolt gap 0.0203 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-two-opposite-open` / `str-carrier-81.25`: first contact-state split at tick 25 (0.2083 s), Rapier gap 0.0282 m, Jolt gap 0.0203 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-two-opposite-open` / `str-carrier-81.50`: first contact-state split at tick 25 (0.2083 s), Rapier gap 0.0282 m, Jolt gap 0.0203 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-two-opposite-open` / `str-carrier-82.00`: first contact-state split at tick 25 (0.2083 s), Rapier gap 0.0282 m, Jolt gap 0.0203 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-two-opposite-open` / `str-lead-tackler-79.00`: first contact-state split at tick 25 (0.2083 s), Rapier gap 0.0283 m, Jolt gap 0.0201 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-two-opposite-open` / `str-lead-tackler-79.50`: first contact-state split at tick 25 (0.2083 s), Rapier gap 0.0284 m, Jolt gap 0.0202 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-two-opposite-open` / `str-lead-tackler-79.75`: first contact-state split at tick 25 (0.2083 s), Rapier gap 0.0282 m, Jolt gap 0.0203 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-two-opposite-open` / `str-lead-tackler-80.10`: first contact-state split at tick 25 (0.2083 s), Rapier gap 0.0282 m, Jolt gap 0.0203 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-two-opposite-open` / `str-lead-tackler-80.20`: first contact-state split at tick 25 (0.2083 s), Rapier gap 0.0282 m, Jolt gap 0.0204 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-two-opposite-open` / `str-lead-tackler-80.30`: first contact-state split at tick 25 (0.2083 s), Rapier gap 0.0283 m, Jolt gap 0.0204 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-two-opposite-open` / `str-lead-tackler-80.40`: first contact-state split at tick 25 (0.2083 s), Rapier gap 0.0283 m, Jolt gap 0.0204 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-two-opposite-open` / `str-lead-tackler-80.50`: first contact-state split at tick 25 (0.2083 s), Rapier gap 0.0283 m, Jolt gap 0.0204 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-two-opposite-open` / `str-lead-tackler-80.60`: first contact-state split at tick 25 (0.2083 s), Rapier gap 0.0283 m, Jolt gap 0.0204 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-two-opposite-open` / `str-lead-tackler-80.70`: first contact-state split at tick 25 (0.2083 s), Rapier gap 0.0283 m, Jolt gap 0.0205 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-two-opposite-open` / `str-lead-tackler-80.80`: first contact-state split at tick 25 (0.2083 s), Rapier gap 0.0284 m, Jolt gap 0.0205 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-two-opposite-open` / `str-lead-tackler-80.90`: first contact-state split at tick 25 (0.2083 s), Rapier gap 0.0284 m, Jolt gap 0.0205 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-two-opposite-open` / `str-lead-tackler-81.00`: first contact-state split at tick 25 (0.2083 s), Rapier gap 0.0284 m, Jolt gap 0.0205 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-two-opposite-open` / `str-lead-tackler-81.25`: first contact-state split at tick 25 (0.2083 s), Rapier gap 0.0284 m, Jolt gap 0.0206 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-two-opposite-open` / `str-lead-tackler-81.50`: first contact-state split at tick 25 (0.2083 s), Rapier gap 0.0285 m, Jolt gap 0.0206 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-two-opposite-open` / `str-lead-tackler-82.00`: first contact-state split at tick 25 (0.2083 s), Rapier gap 0.0286 m, Jolt gap 0.0207 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-staggered-three` / `baseline`: first contact-state split at tick 21 (0.1750 s), Rapier gap 0.0266 m, Jolt gap 0.0094 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-staggered-three` / `str-carrier-79.00`: first contact-state split at tick 21 (0.1750 s), Rapier gap 0.0244 m, Jolt gap 0.0094 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-staggered-three` / `str-carrier-79.50`: first contact-state split at tick 21 (0.1750 s), Rapier gap 0.0266 m, Jolt gap 0.0094 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-staggered-three` / `str-carrier-79.75`: first contact-state split at tick 21 (0.1750 s), Rapier gap 0.0246 m, Jolt gap 0.0094 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-staggered-three` / `str-carrier-80.10`: first contact-state split at tick 21 (0.1750 s), Rapier gap 0.0240 m, Jolt gap 0.0094 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-staggered-three` / `str-carrier-80.20`: first contact-state split at tick 21 (0.1750 s), Rapier gap 0.0233 m, Jolt gap 0.0094 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-staggered-three` / `str-carrier-80.30`: first contact-state split at tick 21 (0.1750 s), Rapier gap 0.0256 m, Jolt gap 0.0095 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-staggered-three` / `str-carrier-80.40`: first contact-state split at tick 21 (0.1750 s), Rapier gap 0.0263 m, Jolt gap 0.0095 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-staggered-three` / `str-carrier-80.50`: first contact-state split at tick 21 (0.1750 s), Rapier gap 0.0273 m, Jolt gap 0.0095 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-staggered-three` / `str-carrier-80.60`: first contact-state split at tick 21 (0.1750 s), Rapier gap 0.0234 m, Jolt gap 0.0095 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-staggered-three` / `str-carrier-80.70`: first contact-state split at tick 21 (0.1750 s), Rapier gap 0.0255 m, Jolt gap 0.0095 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-staggered-three` / `str-carrier-80.80`: first contact-state split at tick 21 (0.1750 s), Rapier gap 0.0266 m, Jolt gap 0.0095 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-staggered-three` / `str-carrier-80.90`: first contact-state split at tick 21 (0.1750 s), Rapier gap 0.0236 m, Jolt gap 0.0095 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-staggered-three` / `str-carrier-81.00`: first contact-state split at tick 21 (0.1750 s), Rapier gap 0.0252 m, Jolt gap 0.0095 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-staggered-three` / `str-carrier-81.25`: first contact-state split at tick 21 (0.1750 s), Rapier gap 0.0224 m, Jolt gap 0.0095 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-staggered-three` / `str-carrier-81.50`: first contact-state split at tick 21 (0.1750 s), Rapier gap 0.0229 m, Jolt gap 0.0095 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-staggered-three` / `str-carrier-82.00`: first contact-state split at tick 21 (0.1750 s), Rapier gap 0.0232 m, Jolt gap 0.0095 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-staggered-three` / `str-lead-tackler-79.00`: first contact-state split at tick 21 (0.1750 s), Rapier gap 0.0244 m, Jolt gap 0.0092 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-staggered-three` / `str-lead-tackler-79.50`: first contact-state split at tick 21 (0.1750 s), Rapier gap 0.0258 m, Jolt gap 0.0093 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-staggered-three` / `str-lead-tackler-79.75`: first contact-state split at tick 21 (0.1750 s), Rapier gap 0.0233 m, Jolt gap 0.0094 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-staggered-three` / `str-lead-tackler-80.10`: first contact-state split at tick 21 (0.1750 s), Rapier gap 0.0236 m, Jolt gap 0.0095 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-staggered-three` / `str-lead-tackler-80.20`: first contact-state split at tick 21 (0.1750 s), Rapier gap 0.0262 m, Jolt gap 0.0095 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-staggered-three` / `str-lead-tackler-80.30`: first contact-state split at tick 21 (0.1750 s), Rapier gap 0.0277 m, Jolt gap 0.0095 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-staggered-three` / `str-lead-tackler-80.40`: first contact-state split at tick 21 (0.1750 s), Rapier gap 0.0266 m, Jolt gap 0.0095 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-staggered-three` / `str-lead-tackler-80.50`: first contact-state split at tick 21 (0.1750 s), Rapier gap 0.0259 m, Jolt gap 0.0095 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-staggered-three` / `str-lead-tackler-80.60`: first contact-state split at tick 21 (0.1750 s), Rapier gap 0.0267 m, Jolt gap 0.0096 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-staggered-three` / `str-lead-tackler-80.70`: first contact-state split at tick 21 (0.1750 s), Rapier gap 0.0267 m, Jolt gap 0.0096 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-staggered-three` / `str-lead-tackler-80.80`: first contact-state split at tick 21 (0.1750 s), Rapier gap 0.0267 m, Jolt gap 0.0096 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-staggered-three` / `str-lead-tackler-80.90`: first contact-state split at tick 21 (0.1750 s), Rapier gap 0.0237 m, Jolt gap 0.0096 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-staggered-three` / `str-lead-tackler-81.00`: first contact-state split at tick 21 (0.1750 s), Rapier gap 0.0248 m, Jolt gap 0.0096 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-staggered-three` / `str-lead-tackler-81.25`: first contact-state split at tick 21 (0.1750 s), Rapier gap 0.0275 m, Jolt gap 0.0097 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-staggered-three` / `str-lead-tackler-81.50`: first contact-state split at tick 21 (0.1750 s), Rapier gap 0.0241 m, Jolt gap 0.0097 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `gang-staggered-three` / `str-lead-tackler-82.00`: first contact-state split at tick 21 (0.1750 s), Rapier gap 0.0234 m, Jolt gap 0.0098 m. Jolt reported contact while both analytic gaps were positive; this exposes proxy/contact-boundary mismatch, not a demonstrated missed Rapier overlap.
- `possession-retained` / `combined-madden-masses-103-102kg-runner-str-81`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0317 m, Jolt gap -0.0065 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `target-masses-str-carrier-80.10`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0233 m, Jolt gap -0.0066 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `target-masses-str-carrier-80.20`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0229 m, Jolt gap -0.0066 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `target-masses-str-carrier-80.30`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0292 m, Jolt gap -0.0066 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `target-masses-str-carrier-80.40`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0232 m, Jolt gap -0.0066 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `target-masses-str-carrier-80.50`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0292 m, Jolt gap -0.0066 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `target-masses-str-carrier-80.60`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0292 m, Jolt gap -0.0066 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `target-masses-str-carrier-80.70`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0262 m, Jolt gap -0.0066 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `target-masses-str-carrier-80.80`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0246 m, Jolt gap -0.0066 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `target-masses-str-carrier-80.90`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0290 m, Jolt gap -0.0065 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `target-masses-str-carrier-81.00`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0317 m, Jolt gap -0.0065 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `target-masses-str-lead-tackler-80.10`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0286 m, Jolt gap -0.0066 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `target-masses-str-lead-tackler-80.20`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0289 m, Jolt gap -0.0066 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `target-masses-str-lead-tackler-80.30`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0289 m, Jolt gap -0.0066 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `target-masses-str-lead-tackler-80.40`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0289 m, Jolt gap -0.0066 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `target-masses-str-lead-tackler-80.50`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0290 m, Jolt gap -0.0066 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `target-masses-str-lead-tackler-80.60`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0304 m, Jolt gap -0.0066 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `target-masses-str-lead-tackler-80.70`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0292 m, Jolt gap -0.0066 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `target-masses-str-lead-tackler-80.80`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0242 m, Jolt gap -0.0066 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `target-masses-str-lead-tackler-80.90`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0226 m, Jolt gap -0.0066 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.
- `possession-retained` / `target-masses-str-lead-tackler-81.00`: first contact-state split at tick 11 (0.0917 s), Rapier gap 0.0259 m, Jolt gap -0.0066 m. Jolt had crossed analytic overlap while Rapier remained separated; this split is trajectory mediated.

## Failures

Every numerical or fixture-outcome failure from the sweep is listed below. No thresholds were relaxed.

- `possession-retained` / `baseline` / `rapier3d-compat`: p95 penetration 0.09454275667667389 m > 0.05 m; weighted mean penetration 0.0480588460470447 m > 0.025 m.
- `possession-retained` / `baseline` / `jolt-physics-js`: p95 penetration 0.05500793531537056 m > 0.05 m.
- `possession-retained` / `mass-carrier--2kg` / `rapier3d-compat`: p95 penetration 0.12162884995341289 m > 0.05 m; weighted mean penetration 0.0392972083451848 m > 0.025 m; required physical contact missing: impact-defender::runner.
- `possession-retained` / `mass-carrier--2kg` / `jolt-physics-js`: p95 penetration 0.055069214850664135 m > 0.05 m.
- `possession-retained` / `mass-carrier--1kg` / `rapier3d-compat`: p95 penetration 0.10311205685138702 m > 0.05 m; weighted mean penetration 0.05394346479119544 m > 0.025 m.
- `possession-retained` / `mass-carrier--1kg` / `jolt-physics-js`: p95 penetration 0.05504073537886142 m > 0.05 m.
- `possession-retained` / `mass-carrier--0.5kg` / `rapier3d-compat`: p95 penetration 0.08194559812545776 m > 0.05 m; weighted mean penetration 0.050086465146806376 m > 0.025 m.
- `possession-retained` / `mass-carrier--0.5kg` / `jolt-physics-js`: p95 penetration 0.05501854121685028 m > 0.05 m.
- `possession-retained` / `mass-carrier-+0.5kg` / `rapier3d-compat`: p95 penetration 0.11272013187408447 m > 0.05 m; weighted mean penetration 0.0529122603022389 m > 0.025 m.
- `possession-retained` / `mass-carrier-+0.5kg` / `jolt-physics-js`: p95 penetration 0.05499752797186374 m > 0.05 m.
- `possession-retained` / `mass-carrier-+1kg` / `rapier3d-compat`: p95 penetration 0.10305751860141754 m > 0.05 m; weighted mean penetration 0.05436124983761047 m > 0.025 m.
- `possession-retained` / `mass-carrier-+1kg` / `jolt-physics-js`: p95 penetration 0.054985947161912914 m > 0.05 m.
- `possession-retained` / `mass-carrier-+2kg` / `rapier3d-compat`: p95 penetration 0.08528076112270355 m > 0.05 m; weighted mean penetration 0.05574940077753522 m > 0.025 m.
- `possession-retained` / `mass-carrier-+2kg` / `jolt-physics-js`: p95 penetration 0.05498040840029716 m > 0.05 m.
- `possession-retained` / `mass-carrier-+4kg` / `rapier3d-compat`: p95 penetration 0.1001298576593399 m > 0.05 m; weighted mean penetration 0.04949958627629615 m > 0.025 m.
- `possession-retained` / `mass-carrier-+4kg` / `jolt-physics-js`: p95 penetration 0.05490862876176834 m > 0.05 m.
- `possession-retained` / `mass-lead-tackler--2kg` / `rapier3d-compat`: p95 penetration 0.10007919892668707 m > 0.05 m; weighted mean penetration 0.05006215441972022 m > 0.025 m.
- `possession-retained` / `mass-lead-tackler--2kg` / `jolt-physics-js`: p95 penetration 0.054855474084615705 m > 0.05 m.
- `possession-retained` / `mass-lead-tackler--1kg` / `rapier3d-compat`: p95 penetration 0.09578756988048553 m > 0.05 m; weighted mean penetration 0.05229321510220564 m > 0.025 m.
- `possession-retained` / `mass-lead-tackler--1kg` / `jolt-physics-js`: p95 penetration 0.054928994178771964 m > 0.05 m.
- `possession-retained` / `mass-lead-tackler--0.5kg` / `rapier3d-compat`: p95 penetration 0.09840121865272522 m > 0.05 m; weighted mean penetration 0.048639079840440004 m > 0.025 m.
- `possession-retained` / `mass-lead-tackler--0.5kg` / `jolt-physics-js`: p95 penetration 0.0549696572124958 m > 0.05 m.
- `possession-retained` / `mass-lead-tackler-+0.5kg` / `rapier3d-compat`: p95 penetration 0.09731161594390869 m > 0.05 m; weighted mean penetration 0.052420549456857805 m > 0.025 m.
- `possession-retained` / `mass-lead-tackler-+0.5kg` / `jolt-physics-js`: p95 penetration 0.05505005866289138 m > 0.05 m.
- `possession-retained` / `mass-lead-tackler-+1kg` / `rapier3d-compat`: p95 penetration 0.08318756520748138 m > 0.05 m; weighted mean penetration 0.0467212423423512 m > 0.025 m.
- `possession-retained` / `mass-lead-tackler-+1kg` / `jolt-physics-js`: p95 penetration 0.05509210601449012 m > 0.05 m.
- `possession-retained` / `mass-lead-tackler-+2kg` / `rapier3d-compat`: p95 penetration 0.1025097519159317 m > 0.05 m; weighted mean penetration 0.049381832488709095 m > 0.025 m.
- `possession-retained` / `mass-lead-tackler-+2kg` / `jolt-physics-js`: p95 penetration 0.055184911191463466 m > 0.05 m.
- `possession-retained` / `mass-lead-tackler-+4kg` / `rapier3d-compat`: p95 penetration 0.08947300910949707 m > 0.05 m; weighted mean penetration 0.0353513022160367 m > 0.025 m; required physical contact missing: impact-defender::runner.
- `possession-retained` / `mass-lead-tackler-+4kg` / `jolt-physics-js`: p95 penetration 0.05535700134932994 m > 0.05 m.
- `possession-retained` / `madden-masses-103-102kg` / `rapier3d-compat`: p95 penetration 0.09765263125300389 m > 0.05 m; weighted mean penetration 0.05036279155562329 m > 0.025 m.
- `possession-retained` / `madden-masses-103-102kg` / `jolt-physics-js`: p95 penetration 0.05453933142125606 m > 0.05 m.
- `gang-staggered-three` / `mass-carrier--1kg` / `rapier3d-compat`: p95 penetration 0.05311262607574463 m > 0.05 m; weighted mean penetration 0.04576179865333774 m > 0.025 m.
- `possession-retained` / `baseline` / `rapier3d-compat`: p95 penetration 0.09454275667667389 m > 0.05 m; weighted mean penetration 0.0480588460470447 m > 0.025 m.
- `possession-retained` / `baseline` / `jolt-physics-js`: p95 penetration 0.05500793531537056 m > 0.05 m.
- `possession-retained` / `str-carrier-79.00` / `rapier3d-compat`: p95 penetration 0.10233861207962036 m > 0.05 m; weighted mean penetration 0.05015747807919967 m > 0.025 m.
- `possession-retained` / `str-carrier-79.00` / `jolt-physics-js`: p95 penetration 0.055016632378101345 m > 0.05 m.
- `possession-retained` / `str-carrier-79.50` / `rapier3d-compat`: p95 penetration 0.10292193293571472 m > 0.05 m; weighted mean penetration 0.05378852826025772 m > 0.025 m.
- `possession-retained` / `str-carrier-79.50` / `jolt-physics-js`: p95 penetration 0.05501232594251632 m > 0.05 m.
- `possession-retained` / `str-carrier-79.75` / `rapier3d-compat`: p95 penetration 0.11286310851573944 m > 0.05 m; weighted mean penetration 0.05381345001256303 m > 0.025 m.
- `possession-retained` / `str-carrier-79.75` / `jolt-physics-js`: p95 penetration 0.05500948950648307 m > 0.05 m.
- `possession-retained` / `str-carrier-80.10` / `rapier3d-compat`: p95 penetration 0.10119118466973295 m > 0.05 m; weighted mean penetration 0.03658515623667189 m > 0.025 m; required physical contact missing: impact-defender::runner.
- `possession-retained` / `str-carrier-80.10` / `jolt-physics-js`: p95 penetration 0.055006955191493026 m > 0.05 m.
- `possession-retained` / `str-carrier-80.20` / `rapier3d-compat`: p95 penetration 0.1007152646780014 m > 0.05 m; weighted mean penetration 0.04880845052604044 m > 0.025 m.
- `possession-retained` / `str-carrier-80.20` / `jolt-physics-js`: p95 penetration 0.055005874484777444 m > 0.05 m.
- `possession-retained` / `str-carrier-80.30` / `rapier3d-compat`: p95 penetration 0.10554499924182892 m > 0.05 m; weighted mean penetration 0.06635709598453503 m > 0.025 m.
- `possession-retained` / `str-carrier-80.30` / `jolt-physics-js`: p95 penetration 0.05500469207763671 m > 0.05 m.
- `possession-retained` / `str-carrier-80.40` / `rapier3d-compat`: p95 penetration 0.09604577720165253 m > 0.05 m; weighted mean penetration 0.0528860559893979 m > 0.025 m.
- `possession-retained` / `str-carrier-80.40` / `jolt-physics-js`: p95 penetration 0.0550038743764162 m > 0.05 m.
- `possession-retained` / `str-carrier-80.50` / `rapier3d-compat`: p95 penetration 0.10452072322368622 m > 0.05 m; weighted mean penetration 0.04888235177430851 m > 0.025 m.
- `possession-retained` / `str-carrier-80.50` / `jolt-physics-js`: p95 penetration 0.05500258542597293 m > 0.05 m.
- `possession-retained` / `str-carrier-80.60` / `rapier3d-compat`: p95 penetration 0.08411175236105896 m > 0.05 m; weighted mean penetration 0.053214304511332015 m > 0.025 m.
- `possession-retained` / `str-carrier-80.60` / `jolt-physics-js`: p95 penetration 0.055002219229936596 m > 0.05 m.
- `possession-retained` / `str-carrier-80.70` / `rapier3d-compat`: p95 penetration 0.09015987068414688 m > 0.05 m; weighted mean penetration 0.05225172468150668 m > 0.025 m.
- `possession-retained` / `str-carrier-80.70` / `jolt-physics-js`: p95 penetration 0.055001812428236 m > 0.05 m.
- `possession-retained` / `str-carrier-80.80` / `rapier3d-compat`: p95 penetration 0.08357283473014832 m > 0.05 m; weighted mean penetration 0.051734115824931245 m > 0.025 m.
- `possession-retained` / `str-carrier-80.80` / `jolt-physics-js`: p95 penetration 0.05500009283423423 m > 0.05 m.
- `possession-retained` / `str-carrier-80.90` / `rapier3d-compat`: p95 penetration 0.1035803593695163 m > 0.05 m; weighted mean penetration 0.057280494572801814 m > 0.025 m.
- `possession-retained` / `str-carrier-80.90` / `jolt-physics-js`: p95 penetration 0.054999272152781484 m > 0.05 m.
- `possession-retained` / `str-carrier-81.00` / `rapier3d-compat`: p95 penetration 0.10255883634090424 m > 0.05 m; weighted mean penetration 0.05008156864076025 m > 0.025 m.
- `possession-retained` / `str-carrier-81.00` / `jolt-physics-js`: p95 penetration 0.0549982089549303 m > 0.05 m.
- `possession-retained` / `str-carrier-81.25` / `rapier3d-compat`: p95 penetration 0.10418352484703064 m > 0.05 m; weighted mean penetration 0.0578838895695905 m > 0.025 m.
- `possession-retained` / `str-carrier-81.25` / `jolt-physics-js`: p95 penetration 0.05499614924192428 m > 0.05 m.
- `possession-retained` / `str-carrier-81.50` / `rapier3d-compat`: p95 penetration 0.09510612487792969 m > 0.05 m; weighted mean penetration 0.049108554997170886 m > 0.025 m.
- `possession-retained` / `str-carrier-81.50` / `jolt-physics-js`: p95 penetration 0.05499392189085483 m > 0.05 m.
- `possession-retained` / `str-carrier-82.00` / `rapier3d-compat`: p95 penetration 0.1034235805273056 m > 0.05 m; weighted mean penetration 0.03253353024936378 m > 0.025 m; required physical contact missing: impact-defender::runner.
- `possession-retained` / `str-carrier-82.00` / `jolt-physics-js`: p95 penetration 0.05498925819993018 m > 0.05 m.
- `possession-retained` / `str-lead-tackler-79.00` / `rapier3d-compat`: p95 penetration 0.10261255502700806 m > 0.05 m; weighted mean penetration 0.05906438537769852 m > 0.025 m.
- `possession-retained` / `str-lead-tackler-79.00` / `jolt-physics-js`: p95 penetration 0.05500958114862441 m > 0.05 m.
- `possession-retained` / `str-lead-tackler-79.50` / `rapier3d-compat`: p95 penetration 0.11518190950155224 m > 0.05 m; weighted mean penetration 0.05363952125319163 m > 0.025 m.
- `possession-retained` / `str-lead-tackler-79.50` / `jolt-physics-js`: p95 penetration 0.055008611828088756 m > 0.05 m.
- `possession-retained` / `str-lead-tackler-79.75` / `rapier3d-compat`: p95 penetration 0.08554346859455109 m > 0.05 m; weighted mean penetration 0.03620384198923881 m > 0.025 m; required physical contact missing: impact-defender::runner.
- `possession-retained` / `str-lead-tackler-79.75` / `jolt-physics-js`: p95 penetration 0.05500816740095615 m > 0.05 m.
- `possession-retained` / `str-lead-tackler-80.10` / `rapier3d-compat`: p95 penetration 0.08606167137622833 m > 0.05 m; weighted mean penetration 0.04812527820467951 m > 0.025 m.
- `possession-retained` / `str-lead-tackler-80.10` / `jolt-physics-js`: p95 penetration 0.05500780194997787 m > 0.05 m.
- `possession-retained` / `str-lead-tackler-80.20` / `rapier3d-compat`: p95 penetration 0.09593147039413452 m > 0.05 m; weighted mean penetration 0.04948290680638619 m > 0.025 m.
- `possession-retained` / `str-lead-tackler-80.20` / `jolt-physics-js`: p95 penetration 0.05500786192715167 m > 0.05 m.
- `possession-retained` / `str-lead-tackler-80.30` / `rapier3d-compat`: p95 penetration 0.09389616549015045 m > 0.05 m; weighted mean penetration 0.049056064596192654 m > 0.025 m.
- `possession-retained` / `str-lead-tackler-80.30` / `jolt-physics-js`: p95 penetration 0.055007333680987355 m > 0.05 m.
- `possession-retained` / `str-lead-tackler-80.40` / `rapier3d-compat`: p95 penetration 0.11615142226219177 m > 0.05 m; weighted mean penetration 0.05935655518745393 m > 0.025 m.
- `possession-retained` / `str-lead-tackler-80.40` / `jolt-physics-js`: p95 penetration 0.05500740557909011 m > 0.05 m.
- `possession-retained` / `str-lead-tackler-80.50` / `rapier3d-compat`: p95 penetration 0.10090884566307068 m > 0.05 m; weighted mean penetration 0.0518165114853118 m > 0.025 m.
- `possession-retained` / `str-lead-tackler-80.50` / `jolt-physics-js`: p95 penetration 0.055007590353488914 m > 0.05 m.
- `possession-retained` / `str-lead-tackler-80.60` / `rapier3d-compat`: p95 penetration 0.09814035892486572 m > 0.05 m; weighted mean penetration 0.0518560642893943 m > 0.025 m.
- `possession-retained` / `str-lead-tackler-80.60` / `jolt-physics-js`: p95 penetration 0.05500735007226466 m > 0.05 m.
- `possession-retained` / `str-lead-tackler-80.70` / `rapier3d-compat`: p95 penetration 0.10009217262268066 m > 0.05 m; weighted mean penetration 0.047754660798495316 m > 0.025 m.
- `possession-retained` / `str-lead-tackler-80.70` / `jolt-physics-js`: p95 penetration 0.05500713624060154 m > 0.05 m.
- `possession-retained` / `str-lead-tackler-80.80` / `rapier3d-compat`: p95 penetration 0.08997099846601479 m > 0.05 m; weighted mean penetration 0.03475843887362198 m > 0.025 m; required physical contact missing: impact-defender::runner.
- `possession-retained` / `str-lead-tackler-80.80` / `jolt-physics-js`: p95 penetration 0.05500759407877921 m > 0.05 m.
- `possession-retained` / `str-lead-tackler-80.90` / `rapier3d-compat`: p95 penetration 0.09476205706596375 m > 0.05 m; weighted mean penetration 0.033176016528159706 m > 0.025 m; required physical contact missing: impact-defender::runner.
- `possession-retained` / `str-lead-tackler-80.90` / `jolt-physics-js`: p95 penetration 0.05500692091882228 m > 0.05 m.
- `possession-retained` / `str-lead-tackler-81.00` / `rapier3d-compat`: p95 penetration 0.09677478671073914 m > 0.05 m; weighted mean penetration 0.05120455949670726 m > 0.025 m.
- `possession-retained` / `str-lead-tackler-81.00` / `jolt-physics-js`: p95 penetration 0.055006749555468554 m > 0.05 m.
- `possession-retained` / `str-lead-tackler-81.25` / `rapier3d-compat`: p95 penetration 0.10381515324115753 m > 0.05 m; weighted mean penetration 0.061213890970167065 m > 0.025 m.
- `possession-retained` / `str-lead-tackler-81.25` / `jolt-physics-js`: p95 penetration 0.05500642731785774 m > 0.05 m.
- `possession-retained` / `str-lead-tackler-81.50` / `rapier3d-compat`: p95 penetration 0.09367693960666656 m > 0.05 m; weighted mean penetration 0.03397537410880135 m > 0.025 m; required physical contact missing: impact-defender::runner.
- `possession-retained` / `str-lead-tackler-81.50` / `jolt-physics-js`: p95 penetration 0.05500566251575946 m > 0.05 m.
- `possession-retained` / `str-lead-tackler-82.00` / `rapier3d-compat`: p95 penetration 0.11576010286808014 m > 0.05 m; weighted mean penetration 0.06677394142995291 m > 0.025 m.
- `possession-retained` / `str-lead-tackler-82.00` / `jolt-physics-js`: p95 penetration 0.055005319789052 m > 0.05 m.
- `gang-two-opposite-open` / `str-lead-tackler-81.50` / `rapier3d-compat`: p95 penetration 0.05589522421360016 m > 0.05 m.
- `gang-staggered-three` / `str-carrier-80.40` / `rapier3d-compat`: weighted mean penetration 0.026784720545013168 m > 0.025 m.
- `possession-retained` / `combined-madden-masses-103-102kg-runner-str-81` / `rapier3d-compat`: p95 penetration 0.10616615414619446 m > 0.05 m; weighted mean penetration 0.030399411454393704 m > 0.025 m; required physical contact missing: impact-defender::runner.
- `possession-retained` / `combined-madden-masses-103-102kg-runner-str-81` / `jolt-physics-js`: p95 penetration 0.05452853143215179 m > 0.05 m.
- `possession-retained` / `target-masses-str-carrier-80.10` / `rapier3d-compat`: p95 penetration 0.1080458015203476 m > 0.05 m; weighted mean penetration 0.048600216396152994 m > 0.025 m.
- `possession-retained` / `target-masses-str-carrier-80.10` / `jolt-physics-js`: p95 penetration 0.054537846893072124 m > 0.05 m.
- `possession-retained` / `target-masses-str-carrier-80.20` / `rapier3d-compat`: p95 penetration 0.11579908430576324 m > 0.05 m; weighted mean penetration 0.05307398392404934 m > 0.025 m.
- `possession-retained` / `target-masses-str-carrier-80.20` / `jolt-physics-js`: p95 penetration 0.05453703217208385 m > 0.05 m.
- `possession-retained` / `target-masses-str-carrier-80.30` / `rapier3d-compat`: p95 penetration 0.08067896962165833 m > 0.05 m; weighted mean penetration 0.033763924044453573 m > 0.025 m; required physical contact missing: impact-defender::runner.
- `possession-retained` / `target-masses-str-carrier-80.30` / `jolt-physics-js`: p95 penetration 0.0545361191034317 m > 0.05 m.
- `possession-retained` / `target-masses-str-carrier-80.40` / `rapier3d-compat`: p95 penetration 0.10745116025209403 m > 0.05 m; weighted mean penetration 0.050529193547036916 m > 0.025 m.
- `possession-retained` / `target-masses-str-carrier-80.40` / `jolt-physics-js`: p95 penetration 0.054535061866044995 m > 0.05 m.
- `possession-retained` / `target-masses-str-carrier-80.50` / `rapier3d-compat`: p95 penetration 0.09039311781525582 m > 0.05 m; weighted mean penetration 0.05198061398954861 m > 0.025 m.
- `possession-retained` / `target-masses-str-carrier-80.50` / `jolt-physics-js`: p95 penetration 0.054533683136105536 m > 0.05 m.
- `possession-retained` / `target-masses-str-carrier-80.60` / `rapier3d-compat`: p95 penetration 0.09329864606261207 m > 0.05 m; weighted mean penetration 0.03235045629036089 m > 0.025 m; required physical contact missing: impact-defender::runner.
- `possession-retained` / `target-masses-str-carrier-80.60` / `jolt-physics-js`: p95 penetration 0.05453278832137585 m > 0.05 m.
- `possession-retained` / `target-masses-str-carrier-80.70` / `rapier3d-compat`: p95 penetration 0.0903887152671814 m > 0.05 m; weighted mean penetration 0.059345447406586524 m > 0.025 m.
- `possession-retained` / `target-masses-str-carrier-80.70` / `jolt-physics-js`: p95 penetration 0.054531963914632796 m > 0.05 m.
- `possession-retained` / `target-masses-str-carrier-80.80` / `rapier3d-compat`: p95 penetration 0.09277299046516418 m > 0.05 m; weighted mean penetration 0.04778481992737706 m > 0.025 m.
- `possession-retained` / `target-masses-str-carrier-80.80` / `jolt-physics-js`: p95 penetration 0.05453050024807453 m > 0.05 m.
- `possession-retained` / `target-masses-str-carrier-80.90` / `rapier3d-compat`: p95 penetration 0.09249155223369598 m > 0.05 m; weighted mean penetration 0.05451237762139897 m > 0.025 m.
- `possession-retained` / `target-masses-str-carrier-80.90` / `jolt-physics-js`: p95 penetration 0.05452967509627342 m > 0.05 m.
- `possession-retained` / `target-masses-str-carrier-81.00` / `rapier3d-compat`: p95 penetration 0.10616615414619446 m > 0.05 m; weighted mean penetration 0.030399411454393704 m > 0.025 m; required physical contact missing: impact-defender::runner.
- `possession-retained` / `target-masses-str-carrier-81.00` / `jolt-physics-js`: p95 penetration 0.05452853143215179 m > 0.05 m.
- `possession-retained` / `target-masses-str-lead-tackler-80.10` / `rapier3d-compat`: p95 penetration 0.08160930871963501 m > 0.05 m; weighted mean penetration 0.029611422318958452 m > 0.025 m; required physical contact missing: impact-defender::runner.
- `possession-retained` / `target-masses-str-lead-tackler-80.10` / `jolt-physics-js`: p95 penetration 0.05453890897333622 m > 0.05 m.
- `possession-retained` / `target-masses-str-lead-tackler-80.20` / `rapier3d-compat`: p95 penetration 0.0836682915687561 m > 0.05 m; weighted mean penetration 0.03294208206029408 m > 0.025 m; required physical contact missing: impact-defender::runner.
- `possession-retained` / `target-masses-str-lead-tackler-80.20` / `jolt-physics-js`: p95 penetration 0.054538962244987485 m > 0.05 m.
- `possession-retained` / `target-masses-str-lead-tackler-80.30` / `rapier3d-compat`: p95 penetration 0.08503524959087372 m > 0.05 m; weighted mean penetration 0.049642868960897105 m > 0.025 m.
- `possession-retained` / `target-masses-str-lead-tackler-80.30` / `jolt-physics-js`: p95 penetration 0.05453878194093704 m > 0.05 m.
- `possession-retained` / `target-masses-str-lead-tackler-80.40` / `rapier3d-compat`: p95 penetration 0.08555091917514801 m > 0.05 m; weighted mean penetration 0.03286636884634686 m > 0.025 m; required physical contact missing: impact-defender::runner.
- `possession-retained` / `target-masses-str-lead-tackler-80.40` / `jolt-physics-js`: p95 penetration 0.05453832447528839 m > 0.05 m.
- `possession-retained` / `target-masses-str-lead-tackler-80.50` / `rapier3d-compat`: p95 penetration 0.08529432192444775 m > 0.05 m; weighted mean penetration 0.032493322932471744 m > 0.025 m; required physical contact missing: impact-defender::runner.
- `possession-retained` / `target-masses-str-lead-tackler-80.50` / `jolt-physics-js`: p95 penetration 0.05453784018754959 m > 0.05 m.
- `possession-retained` / `target-masses-str-lead-tackler-80.60` / `rapier3d-compat`: p95 penetration 0.0903730511665342 m > 0.05 m; weighted mean penetration 0.032707580158279806 m > 0.025 m; required physical contact missing: impact-defender::runner.
- `possession-retained` / `target-masses-str-lead-tackler-80.60` / `jolt-physics-js`: p95 penetration 0.05453778877854347 m > 0.05 m.
- `possession-retained` / `target-masses-str-lead-tackler-80.70` / `rapier3d-compat`: p95 penetration 0.08169886469841003 m > 0.05 m; weighted mean penetration 0.03603763593774694 m > 0.025 m; required physical contact missing: impact-defender::runner.
- `possession-retained` / `target-masses-str-lead-tackler-80.70` / `jolt-physics-js`: p95 penetration 0.054537659510970116 m > 0.05 m.
- `possession-retained` / `target-masses-str-lead-tackler-80.80` / `rapier3d-compat`: p95 penetration 0.09564320743083954 m > 0.05 m; weighted mean penetration 0.050480760530465206 m > 0.025 m.
- `possession-retained` / `target-masses-str-lead-tackler-80.80` / `jolt-physics-js`: p95 penetration 0.05453710816800594 m > 0.05 m.
- `possession-retained` / `target-masses-str-lead-tackler-80.90` / `rapier3d-compat`: p95 penetration 0.0997525155544281 m > 0.05 m; weighted mean penetration 0.05030110217113465 m > 0.025 m.
- `possession-retained` / `target-masses-str-lead-tackler-80.90` / `jolt-physics-js`: p95 penetration 0.05453721657395363 m > 0.05 m.
- `possession-retained` / `target-masses-str-lead-tackler-81.00` / `rapier3d-compat`: p95 penetration 0.09433184564113617 m > 0.05 m; weighted mean penetration 0.04835266723401024 m > 0.025 m.
- `possession-retained` / `target-masses-str-lead-tackler-81.00` / `jolt-physics-js`: p95 penetration 0.054537003859877586 m > 0.05 m.

## Reproduction and artifacts

From the repository root, run `node research/physics-3d-evaluation/m4b/m4d-str-contact-diagnosis/run.mjs`. This rewrites the report and full-rate traces. Serve the results directory over HTTP to use the replay viewer; the browser decompresses each trace and synchronizes by fixed-step tick.

- Full sensitivity matrix and matched-timestep metrics: `sensitivity-report.json`.
- Synchronized replay selector: `viewer.html` with `replay-index.json` and `traces/`.
- Isolated-phase checkpoint written before combined inputs: `isolated-sweeps-checkpoint.json`.

Limitations: player proxies are rigid and non-articulated; STR changes only the existing M4c balance-controller gain; Jolt’s JavaScript binding does not expose Rapier-equivalent solver normal impulses. No Madden rating was added, no production file was changed, and the old TAK/BTK hold-drag formula was not evaluated as a candidate for M4c.
