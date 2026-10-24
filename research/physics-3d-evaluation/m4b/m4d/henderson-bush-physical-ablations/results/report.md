# M4d Henderson–Bush physical-ability ablations

Code commit: 124e64fe0879653b9c84fa98408a64fa6bc179ce; source snapshot SHA-256: 8b92f09be84ae95600d99881887ccf450f205da13e0b60b43b00776360c27d04.
Updated coordination protocol: [main commit b3ccd729707f2ccc697f750cdad774c71fe5f674](https://github.com/micahp/gridiron-physics/blob/b3ccd729707f2ccc697f750cdad774c71fe5f674/docs/research/RATINGS-TO-PHYSICS-COORDINATION-2026-10-23.md), SHA-256 9e1dc4f55a29f69daebbe4203f3fd547dd880dce7919f57402b5e07ba731659d. Frozen profile provenance retains protocol commit 053093a1ef0da912b19fc3a7566fdac68385e8b5, SHA-256 204ebd336c5c6d772831921692637f75e52f8b8949cf206cbd1eb04e0edffcde.
Legacy comparison: [latest hold report](https://github.com/micahp/gridiron-physics/blob/ec18dee259572f4beabda68a70d0d7f58601900f/docs/research/TACKLE-HOLD-COUNTERFACTUAL-2026-10-23.md), branch research/gridiron-tackle-physics-2026-10-23, commit ec18dee259572f4beabda68a70d0d7f58601900f, report SHA-256 83cb85a7a83029ee4daf282e8f61d0acb143f152c8403ff658d0a7271df6ace1.
Latest legacy diagnosis: [play 18 defect report](https://github.com/micahp/gridiron-physics/blob/51b9d0f85a147dfc3fcc866fb1c18b5186d3a106/research/madden27-tackle-hold-probe/diagnosis-play18/DIAGNOSIS.md), branch research/madden27-tackle-physics-probe, commit 51b9d0f85a147dfc3fcc866fb1c18b5186d3a106, report SHA-256 1f7e28d656ade0cfff76ae40ca02f825e447a8de3f8fbb441b66afeabda8f1d2.

## Scope and source

This is a research-only M4c-based physical sensitivity experiment. It uses the frozen EA Madden NFL 27 Week 6 Henderson–Bush pair: Henderson (Patriots HB, 92 kg, STR 71, BTK 81, TKL 33, HTP 31) and Bush (Bears MIKE, 106 kg, STR 74, BTK 19, TKL 89, HTP 88). These body weights are publisher-provided estimates, not independent measurements. Madden ratings are game ratings, not measured force, torque, grip, or breakaway capacities.
The compact frozen source is m4d/henderson-bush-week6-source.json; SHA-256 8b92f09be84ae95600d99881887ccf450f205da13e0b60b43b00776360c27d04. EA pages: [TreVeyon Henderson](https://www.ea.com/games/madden-nfl/ratings/player-ratings/tre-veyon-henderson/14810), [Devin Bush](https://www.ea.com/games/madden-nfl/ratings/player-ratings/devin-bush/20583). The earlier Barkley–Baun loss-of-contact case is replayed as an additional diagnostic using its separate archived source snapshot (SHA-256 59fc2371333e431ce38eb461313807a92ac2031a07f7d2856599e384d6d186bd); it does not tune the NE–CHI pair. The preceding [STR/contact diagnosis](https://github.com/micahp/gridiron-physics/blob/c4d35b975df80e0f5ddaea34451bf35724e960f6/research/physics-3d-evaluation/m4b/results/m4d-str-contact-diagnosis/sensitivity-report.md) and its per-tick artifacts are also hashed in the manifest.

## Method and gates

Runs use M4c compound proxies at 120 Hz, Rapier 0.21.0 (8 iterations) and Jolt 1.1.0 (1 collision step), with seeds 41027 and 41028. M4c behavior, fixture mechanics, geometry, and registered thresholds are pinned. Each full-rate gzip trace records every tick, including signed pair gaps/opportunities, engine contact, positions/orientations/velocities, controller torque requests, applied force inputs, grip loads, and penetration samples.
The original M4c limits remain: max penetration ≤0.15 m, per-run p95 ≤0.05 m, duration-weighted mean ≤0.025 m. No failed gate is relaxed. Opportunity (analytic gap ≤0.10 m) and physical contact (engine state) remain distinct.
Contact counts in the shared schema are fixed-step samples, not independent tackle events. tackle_selected is null because M4c does not implement legacy pre-contact tackle selection. Rapier solver impulse is reported from its manifold telemetry; Jolt impulse is labeled with its adapter estimate or null when unavailable.

## Ablations

Mass-only and STR-only changes are run separately for Henderson and Bush before any combined profile input. The EA-sourced Bush mass (106 kg) equals the tackler mass in all three M4c fixtures, so mass-bush-only is an audited no-op control; mass-both-after-individual and the combined profile also leave Bush mass unchanged while changing Henderson from the 98 kg fixture value to 92 kg. These cases provide no evidence for a Bush mass effect. Capacity and controller sweeps then vary one research parameter while keeping the selected player-source inputs fixed.
The TKL hold-capacity hypothesis is explicitly uncalibrated: capacity_N = fixture_capacity_N × clamp(1 + 0.005 × (TKL − 50), 0.5, 1.5); rating 50 is neutral. The BTK breakaway-force hypothesis is explicitly uncalibrated: additional_forward_force_N = clamp(10 × (BTK − 50), 0, 500); rating 50 adds 0 N. BTK force starts at 0.20 s in its separate fixture clone; each run records whether physical contact preceded that time. The independent wrap-capacity sweep uses 0.5×–1.5× existing fixture capacity in Newtons. None of these slopes or bounds is empirically calibrated.
The M4d STR pass-through still feeds the existing balance-controller input without calibration. The balance-scale sweep is dimensionless; torque requests are reported in N·m. HTP and legacy ELU are unused.

## Key paired runs

| Scenario | Input | Engine | Min gap (m) | Opportunity samples | Contact samples / events | First contact (s) | Grip load (N) | Takedown | Post-contact travel (m / 1 s) | p95 (m) | weighted mean (m) | Status |
|---|---|---|---:|---:|---:|---:|---:|---|---:|---:|---:|---|
|possession-retained|old-barkley-baun-lost-contact|jolt-physics-js|-0.0098|280|234 / 3|0.0917|1572.6|n/a|0.0581|0.0545|0.0069|failed|
|possession-retained|old-barkley-baun-lost-contact|rapier3d-compat|0.0190|116|0 / 0|—|—|n/a|—|0.1062|0.0304|failed|
|possession-retained|btk-drive-rating-81|jolt-physics-js|-0.0097|280|265 / 2|0.0917|1701.0|n/a|0.1493|0.0547|0.0069|failed|
|possession-retained|btk-drive-rating-81|rapier3d-compat|0.0166|101|0 / 0|—|—|n/a|—|0.0898|0.0381|failed|
|possession-retained|balance-scale-0.80|jolt-physics-js|-0.0097|280|253 / 3|0.0917|1581.4|n/a|0.0643|0.0553|0.0090|failed|
|possession-retained|balance-scale-0.80|rapier3d-compat|0.0001|280|89 / 2|0.1250|382.0|n/a|-0.0235|0.0979|0.0485|failed|
|gang-staggered-three|tkl-capacity-hypothesis|jolt-physics-js|-0.0002|871|848 / 2|0.1750|1963.4|yes|-1.0877|0.0235|0.0176|passed|
|gang-staggered-three|tkl-capacity-hypothesis|rapier3d-compat|-0.0031|882|878 / 1|0.1917|2606.9|yes|-1.0218|0.0340|0.0204|passed|
|gang-staggered-three|tkl-capacity-rating-50-control|jolt-physics-js|-0.0002|871|848 / 2|0.1750|1963.4|yes|-1.0877|0.0235|0.0176|passed|
|gang-staggered-three|tkl-capacity-rating-50-control|rapier3d-compat|-0.0031|882|878 / 1|0.1917|2606.9|yes|-1.0218|0.0340|0.0204|passed|
|grip-escape-one-held|tkl-capacity-hypothesis|jolt-physics-js|-0.0099|34|26 / 1|0.2083|2926.3|n/a|-1.8724|0.0078|0.0007|passed|
|grip-escape-one-held|tkl-capacity-hypothesis|rapier3d-compat|-0.0079|30|19 / 2|0.2167|3014.1|n/a|-1.6860|0.0119|0.0016|passed|
|grip-escape-one-held|tkl-capacity-rating-50-control|jolt-physics-js|-0.0099|32|25 / 1|0.2083|2961.5|n/a|-1.8540|0.0070|0.0007|passed|
|grip-escape-one-held|tkl-capacity-rating-50-control|rapier3d-compat|-0.0079|30|19 / 2|0.2167|3000.4|n/a|-1.6450|0.0139|0.0016|passed|
|possession-retained|tkl-capacity-hypothesis|jolt-physics-js|-0.0097|280|253 / 3|0.0917|1581.4|n/a|0.0643|0.0553|0.0090|failed|
|possession-retained|tkl-capacity-hypothesis|rapier3d-compat|0.0001|280|89 / 2|0.1250|382.0|n/a|-0.0235|0.0979|0.0485|failed|
|possession-retained|tkl-capacity-rating-50-control|jolt-physics-js|-0.0097|280|253 / 3|0.0917|1581.4|n/a|0.0643|0.0553|0.0090|failed|
|possession-retained|tkl-capacity-rating-50-control|rapier3d-compat|0.0001|280|89 / 2|0.1250|382.0|n/a|-0.0235|0.0979|0.0485|failed|
|gang-staggered-three|wrap-capacity-1.50x|jolt-physics-js|-0.0002|871|848 / 2|0.1750|1963.4|yes|-1.0877|0.0235|0.0176|passed|
|gang-staggered-three|wrap-capacity-1.50x|rapier3d-compat|-0.0031|882|878 / 1|0.1917|2606.9|yes|-1.0218|0.0340|0.0204|passed|
|gang-staggered-three|wrap-capacity-1.00x|jolt-physics-js|-0.0002|871|848 / 2|0.1750|1963.4|yes|-1.0877|0.0235|0.0176|passed|
|gang-staggered-three|wrap-capacity-1.00x|rapier3d-compat|-0.0031|882|878 / 1|0.1917|2606.9|yes|-1.0218|0.0340|0.0204|passed|
|gang-staggered-three|wrap-capacity-0.50x|jolt-physics-js|-0.0002|871|848 / 2|0.1750|1963.4|yes|-1.0877|0.0235|0.0176|passed|
|gang-staggered-three|wrap-capacity-0.50x|rapier3d-compat|-0.0031|882|878 / 1|0.1917|2606.9|yes|-1.0218|0.0340|0.0204|passed|
|grip-escape-one-held|wrap-capacity-1.50x|jolt-physics-js|-0.0099|36|29 / 1|0.2083|2879.7|n/a|-1.8584|0.0076|0.0008|passed|
|grip-escape-one-held|wrap-capacity-1.50x|rapier3d-compat|-0.0079|35|25 / 2|0.2167|3157.4|n/a|-1.6934|0.0127|0.0015|passed|
|grip-escape-one-held|wrap-capacity-1.00x|jolt-physics-js|-0.0099|32|25 / 1|0.2083|2961.5|n/a|-1.8540|0.0070|0.0007|passed|
|grip-escape-one-held|wrap-capacity-1.00x|rapier3d-compat|-0.0079|30|19 / 2|0.2167|3000.4|n/a|-1.6450|0.0139|0.0016|passed|
|grip-escape-one-held|wrap-capacity-0.50x|jolt-physics-js|-0.0099|32|21 / 2|0.2083|3067.1|n/a|-1.8817|0.0164|0.0093|passed|
|grip-escape-one-held|wrap-capacity-0.50x|rapier3d-compat|-0.0079|29|17 / 2|0.2167|2985.4|n/a|-1.6116|0.0164|0.0023|passed|
|possession-retained|wrap-capacity-1.50x|jolt-physics-js|-0.0097|280|253 / 3|0.0917|1581.4|n/a|0.0643|0.0553|0.0090|failed|
|possession-retained|wrap-capacity-1.50x|rapier3d-compat|0.0001|280|89 / 2|0.1250|382.0|n/a|-0.0235|0.0979|0.0485|failed|
|possession-retained|wrap-capacity-1.00x|jolt-physics-js|-0.0097|280|253 / 3|0.0917|1581.4|n/a|0.0643|0.0553|0.0090|failed|
|possession-retained|wrap-capacity-1.00x|rapier3d-compat|0.0001|280|89 / 2|0.1250|382.0|n/a|-0.0235|0.0979|0.0485|failed|
|possession-retained|wrap-capacity-0.50x|jolt-physics-js|-0.0097|211|140 / 2|0.0917|834.5|n/a|0.0666|0.0553|0.0067|failed|
|possession-retained|wrap-capacity-0.50x|rapier3d-compat|0.0001|280|89 / 2|0.1250|382.0|n/a|-0.0235|0.0979|0.0485|failed|
|possession-retained|str-continuity-bush-81.00|jolt-physics-js|-0.0094|280|250 / 4|0.0917|1589.0|n/a|0.0648|0.0553|0.0088|failed|
|possession-retained|str-continuity-bush-81.00|rapier3d-compat|0.0172|116|0 / 0|—|—|n/a|—|0.0781|0.0348|failed|
|possession-retained|str-continuity-bush-80.50|jolt-physics-js|-0.0095|280|252 / 3|0.0917|1588.2|n/a|0.0647|0.0553|0.0091|failed|
|possession-retained|str-continuity-bush-80.50|rapier3d-compat|0.0155|61|0 / 0|—|—|n/a|—|0.0991|0.0351|failed|
|possession-retained|str-continuity-bush-80.00|jolt-physics-js|-0.0095|280|247 / 4|0.0917|1588.1|n/a|0.0646|0.0553|0.0089|failed|
|possession-retained|str-continuity-bush-80.00|rapier3d-compat|-0.0005|280|98 / 2|0.1167|441.7|n/a|-0.0160|0.1118|0.0611|failed|
|possession-retained|str-continuity-henderson-81.00|jolt-physics-js|-0.0090|280|243 / 4|0.0917|1581.6|n/a|0.0610|0.0552|0.0090|failed|
|possession-retained|str-continuity-henderson-81.00|rapier3d-compat|0.0082|280|86 / 2|0.1250|392.9|n/a|-0.0315|0.0842|0.0491|failed|
|possession-retained|str-continuity-henderson-80.50|jolt-physics-js|-0.0090|280|243 / 4|0.0917|1581.4|n/a|0.0610|0.0552|0.0093|failed|
|possession-retained|str-continuity-henderson-80.50|rapier3d-compat|-0.0003|280|92 / 2|0.1250|428.9|n/a|-0.0220|0.1012|0.0535|failed|
|possession-retained|str-continuity-henderson-80.00|jolt-physics-js|-0.0091|280|237 / 3|0.0917|1579.7|n/a|0.0614|0.0552|0.0069|failed|
|possession-retained|str-continuity-henderson-80.00|rapier3d-compat|0.0167|117|0 / 0|—|—|n/a|—|0.0977|0.0357|failed|
|gang-staggered-three|madden-pair-combined|jolt-physics-js|-0.0002|871|848 / 2|0.1750|1963.4|yes|-1.0877|0.0235|0.0176|passed|
|gang-staggered-three|madden-pair-combined|rapier3d-compat|-0.0031|882|878 / 1|0.1917|2606.9|yes|-1.0218|0.0340|0.0204|passed|
|grip-escape-one-held|madden-pair-combined|jolt-physics-js|-0.0099|32|25 / 1|0.2083|2961.5|n/a|-1.8540|0.0070|0.0007|passed|
|grip-escape-one-held|madden-pair-combined|rapier3d-compat|-0.0079|30|19 / 2|0.2167|3000.4|n/a|-1.6450|0.0139|0.0016|passed|
|possession-retained|madden-pair-combined|jolt-physics-js|-0.0097|280|253 / 3|0.0917|1581.4|n/a|0.0643|0.0553|0.0090|failed|
|possession-retained|madden-pair-combined|rapier3d-compat|0.0001|280|89 / 2|0.1250|382.0|n/a|-0.0235|0.0979|0.0485|failed|
|gang-staggered-three|str-bush-only|jolt-physics-js|-0.0004|877|850 / 2|0.1750|1943.2|yes|-1.0780|0.0268|0.0193|passed|
|gang-staggered-three|str-bush-only|rapier3d-compat|-0.0012|882|850 / 2|0.1917|2233.3|yes|-1.0578|0.0387|0.0198|passed|
|gang-staggered-three|str-henderson-only|jolt-physics-js|-0.0008|869|847 / 2|0.1750|2092.5|yes|-1.0730|0.0219|0.0172|passed|
|gang-staggered-three|str-henderson-only|rapier3d-compat|-0.0032|882|870 / 2|0.1917|2713.5|yes|-1.0022|0.0401|0.0149|passed|
|grip-escape-one-held|str-bush-only|jolt-physics-js|-0.0062|31|24 / 2|0.2083|2945.0|n/a|-1.9017|0.0080|0.0044|passed|
|grip-escape-one-held|str-bush-only|rapier3d-compat|-0.0048|30|19 / 2|0.2167|3049.9|n/a|-1.7033|0.0154|0.0017|passed|
|grip-escape-one-held|str-henderson-only|jolt-physics-js|-0.0090|32|24 / 2|0.2083|2951.3|n/a|-1.8681|0.0065|0.0006|passed|
|grip-escape-one-held|str-henderson-only|rapier3d-compat|-0.0076|29|19 / 2|0.2167|3038.7|n/a|-1.6570|0.0115|0.0014|passed|
|possession-retained|str-bush-only|jolt-physics-js|-0.0099|280|232 / 3|0.0917|1590.0|n/a|0.0552|0.0550|0.0068|failed|
|possession-retained|str-bush-only|rapier3d-compat|-0.0001|280|127 / 1|0.1167|417.4|n/a|-0.0222|0.1011|0.0537|failed|
|possession-retained|str-henderson-only|jolt-physics-js|-0.0102|280|229 / 3|0.0917|1587.0|n/a|0.0584|0.0551|0.0075|failed|
|possession-retained|str-henderson-only|rapier3d-compat|-0.0004|280|126 / 1|0.1167|437.7|n/a|-0.0191|0.1025|0.0518|failed|
|gang-staggered-three|mass-henderson-only|jolt-physics-js|-0.0034|865|844 / 2|0.1750|2198.5|yes|-1.0472|0.0219|0.0172|passed|
|gang-staggered-three|mass-henderson-only|rapier3d-compat|-0.0011|882|876 / 2|0.1917|2685.6|yes|-1.0270|0.0422|0.0234|passed|
|grip-escape-one-held|mass-henderson-only|jolt-physics-js|-0.0050|32|23 / 2|0.2083|2913.9|n/a|-1.8598|0.0030|0.0003|passed|
|grip-escape-one-held|mass-henderson-only|rapier3d-compat|-0.0037|28|18 / 2|0.2167|2931.4|n/a|-1.6396|0.0127|0.0015|passed|
|possession-retained|mass-henderson-only|jolt-physics-js|-0.0088|280|243 / 4|0.0917|1586.7|n/a|0.0623|0.0552|0.0089|failed|
|possession-retained|mass-henderson-only|rapier3d-compat|-0.0004|280|101 / 2|0.1167|446.2|n/a|-0.0165|0.1033|0.0577|failed|
|gang-staggered-three|m4c-neutral|jolt-physics-js|-0.0005|871|847 / 3|0.1750|2081.9|yes|-1.0839|0.0218|0.0169|passed|
|gang-staggered-three|m4c-neutral|rapier3d-compat|-0.0016|882|878 / 1|0.1917|2474.5|yes|-1.0252|0.0324|0.0179|passed|
|grip-escape-one-held|m4c-neutral|jolt-physics-js|-0.0051|32|25 / 2|0.2083|2920.6|n/a|-1.8678|0.0036|0.0019|passed|
|grip-escape-one-held|m4c-neutral|rapier3d-compat|-0.0040|29|18 / 2|0.2167|2992.6|n/a|-1.6875|0.0128|0.0016|passed|
|possession-retained|m4c-neutral|jolt-physics-js|-0.0096|280|251 / 3|0.0917|1574.1|n/a|0.0567|0.0550|0.0093|failed|
|possession-retained|m4c-neutral|rapier3d-compat|-0.0001|280|126 / 1|0.1167|434.9|n/a|-0.0254|0.0945|0.0481|failed|
## Paired responses within each solver

Every treatment is paired within the same scenario, solver, seed, timestep, gravity, solver settings, geometry, and initial player/football state. Mass/STR substitutions use m4c-neutral; capacity, balance, TKL, and STR-continuity hypotheses use madden-pair-combined; BTK added-force values use the rating-50, 1200 N base-drive control. The trace audit checks these invariants and confirms that only the declared role input or configured BTK force changes. It checks 356 treatment/anchor seed pairs; 16 source-equal/neutral no-op records are retained and labeled in the JSON. The neutral BTK 50 run is an anchor, not a self-paired treatment. The JSON includes per-seed paired values and min/median/max distributions for separation, opportunities, contact samples/events, contact time, grip load, torque, drive force, penetration, and post-contact travel. Only two deterministic fixture seeds are used; these ranges are not confidence intervals.
| Scenario | Input | Engine | Anchor | Δ min gap (m) | Δ opportunities | Δ contact samples | Δ grip load (N) | Δ peak torque (N·m) | Δ p95 (m) | Δ weighted mean (m) | Outcome gate pass count |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|
|possession-retained|btk-drive-rating-81|jolt-physics-js|btk-drive-rating-50|0.0000 [0.0000, 0.0000]|0.0 [0.0, 0.0]|15.0 [15.0, 15.0]|34.5 [34.5, 34.5]|0.00 [0.00, 0.00]|0.0011 [0.0011, 0.0011]|0.0005 [0.0005, 0.0005]|2/2 → 2/2|
|possession-retained|btk-drive-rating-81|rapier3d-compat|btk-drive-rating-50|0.0000 [0.0000, 0.0000]|72.0 [72.0, 72.0]|0.0 [0.0, 0.0]|n/a|0.00 [0.00, 0.00]|0.0000 [0.0000, 0.0000]|0.0016 [0.0016, 0.0016]|0/2 → 0/2|
|possession-retained|balance-scale-1.20|jolt-physics-js|madden-pair-combined|0.0046 [0.0046, 0.0046]|0.0 [0.0, 0.0]|-21.0 [-21.0, -21.0]|-40.5 [-40.5, -40.5]|241.30 [241.30, 241.30]|-0.0006 [-0.0006, -0.0006]|-0.0019 [-0.0019, -0.0019]|2/2 → 2/2|
|possession-retained|balance-scale-1.20|rapier3d-compat|madden-pair-combined|0.0219 [0.0219, 0.0219]|-164.0 [-164.0, -164.0]|-89.0 [-89.0, -89.0]|n/a|127.70 [127.70, 127.70]|0.0002 [0.0002, 0.0002]|-0.0110 [-0.0110, -0.0110]|2/2 → 0/2|
|possession-retained|balance-scale-0.80|jolt-physics-js|madden-pair-combined|0.0000 [0.0000, 0.0000]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.00 [0.00, 0.00]|0.0000 [0.0000, 0.0000]|0.0000 [0.0000, 0.0000]|2/2 → 2/2|
|possession-retained|balance-scale-0.80|rapier3d-compat|madden-pair-combined|0.0000 [0.0000, 0.0000]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.00 [0.00, 0.00]|0.0000 [0.0000, 0.0000]|0.0000 [0.0000, 0.0000]|2/2 → 2/2|
|possession-retained|balance-scale-0.00|jolt-physics-js|madden-pair-combined|-0.0086 [-0.0086, -0.0086]|0.0 [0.0, 0.0]|15.0 [15.0, 15.0]|-546.0 [-546.0, -546.0]|333.91 [333.91, 333.91]|-0.0014 [-0.0014, -0.0014]|-0.0024 [-0.0024, -0.0024]|2/2 → 2/2|
|possession-retained|balance-scale-0.00|rapier3d-compat|madden-pair-combined|-0.0003 [-0.0003, -0.0003]|0.0 [0.0, 0.0]|37.0 [37.0, 37.0]|216.5 [216.5, 216.5]|-123.70 [-123.70, -123.70]|-0.0073 [-0.0073, -0.0073]|0.0038 [0.0038, 0.0038]|2/2 → 2/2|
|gang-staggered-three|tkl-capacity-hypothesis|jolt-physics-js|madden-pair-combined|0.0000 [0.0000, 0.0000]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.00 [0.00, 0.00]|0.0000 [0.0000, 0.0000]|0.0000 [0.0000, 0.0000]|2/2 → 2/2|
|gang-staggered-three|tkl-capacity-hypothesis|rapier3d-compat|madden-pair-combined|0.0000 [0.0000, 0.0000]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.00 [0.00, 0.00]|0.0000 [0.0000, 0.0000]|0.0000 [0.0000, 0.0000]|2/2 → 2/2|
|gang-staggered-three|tkl-capacity-rating-50-control|jolt-physics-js|madden-pair-combined|0.0000 [0.0000, 0.0000]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.00 [0.00, 0.00]|0.0000 [0.0000, 0.0000]|0.0000 [0.0000, 0.0000]|2/2 → 2/2|
|gang-staggered-three|tkl-capacity-rating-50-control|rapier3d-compat|madden-pair-combined|0.0000 [0.0000, 0.0000]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.00 [0.00, 0.00]|0.0000 [0.0000, 0.0000]|0.0000 [0.0000, 0.0000]|2/2 → 2/2|
|grip-escape-one-held|tkl-capacity-hypothesis|jolt-physics-js|madden-pair-combined|0.0000 [0.0000, 0.0000]|2.0 [2.0, 2.0]|1.0 [1.0, 1.0]|146.1 [146.1, 146.1]|121.68 [121.68, 121.68]|0.0008 [0.0008, 0.0008]|0.0001 [0.0001, 0.0001]|2/2 → 2/2|
|grip-escape-one-held|tkl-capacity-hypothesis|rapier3d-compat|madden-pair-combined|0.0000 [0.0000, 0.0000]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|-35.2 [-35.2, -35.2]|-10.10 [-10.10, -10.10]|-0.0021 [-0.0021, -0.0021]|-0.0001 [-0.0001, -0.0001]|2/2 → 2/2|
|grip-escape-one-held|tkl-capacity-rating-50-control|jolt-physics-js|madden-pair-combined|0.0000 [0.0000, 0.0000]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.00 [0.00, 0.00]|0.0000 [0.0000, 0.0000]|0.0000 [0.0000, 0.0000]|2/2 → 2/2|
|grip-escape-one-held|tkl-capacity-rating-50-control|rapier3d-compat|madden-pair-combined|0.0000 [0.0000, 0.0000]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.00 [0.00, 0.00]|0.0000 [0.0000, 0.0000]|0.0000 [0.0000, 0.0000]|2/2 → 2/2|
|possession-retained|tkl-capacity-hypothesis|jolt-physics-js|madden-pair-combined|0.0000 [0.0000, 0.0000]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.00 [0.00, 0.00]|0.0000 [0.0000, 0.0000]|0.0000 [0.0000, 0.0000]|2/2 → 2/2|
|possession-retained|tkl-capacity-hypothesis|rapier3d-compat|madden-pair-combined|0.0000 [0.0000, 0.0000]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.00 [0.00, 0.00]|0.0000 [0.0000, 0.0000]|0.0000 [0.0000, 0.0000]|2/2 → 2/2|
|possession-retained|tkl-capacity-rating-50-control|jolt-physics-js|madden-pair-combined|0.0000 [0.0000, 0.0000]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.00 [0.00, 0.00]|0.0000 [0.0000, 0.0000]|0.0000 [0.0000, 0.0000]|2/2 → 2/2|
|possession-retained|tkl-capacity-rating-50-control|rapier3d-compat|madden-pair-combined|0.0000 [0.0000, 0.0000]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.00 [0.00, 0.00]|0.0000 [0.0000, 0.0000]|0.0000 [0.0000, 0.0000]|2/2 → 2/2|
|gang-staggered-three|wrap-capacity-1.50x|jolt-physics-js|madden-pair-combined|0.0000 [0.0000, 0.0000]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.00 [0.00, 0.00]|0.0000 [0.0000, 0.0000]|0.0000 [0.0000, 0.0000]|2/2 → 2/2|
|gang-staggered-three|wrap-capacity-1.50x|rapier3d-compat|madden-pair-combined|0.0000 [0.0000, 0.0000]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.00 [0.00, 0.00]|0.0000 [0.0000, 0.0000]|0.0000 [0.0000, 0.0000]|2/2 → 2/2|
|gang-staggered-three|wrap-capacity-1.00x|jolt-physics-js|madden-pair-combined|0.0000 [0.0000, 0.0000]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.00 [0.00, 0.00]|0.0000 [0.0000, 0.0000]|0.0000 [0.0000, 0.0000]|2/2 → 2/2|
|gang-staggered-three|wrap-capacity-1.00x|rapier3d-compat|madden-pair-combined|0.0000 [0.0000, 0.0000]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.00 [0.00, 0.00]|0.0000 [0.0000, 0.0000]|0.0000 [0.0000, 0.0000]|2/2 → 2/2|
|gang-staggered-three|wrap-capacity-0.50x|jolt-physics-js|madden-pair-combined|0.0000 [0.0000, 0.0000]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.00 [0.00, 0.00]|0.0000 [0.0000, 0.0000]|0.0000 [0.0000, 0.0000]|2/2 → 2/2|
|gang-staggered-three|wrap-capacity-0.50x|rapier3d-compat|madden-pair-combined|0.0000 [0.0000, 0.0000]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.00 [0.00, 0.00]|0.0000 [0.0000, 0.0000]|0.0000 [0.0000, 0.0000]|2/2 → 2/2|
|grip-escape-one-held|wrap-capacity-1.50x|jolt-physics-js|madden-pair-combined|0.0000 [0.0000, 0.0000]|4.0 [4.0, 4.0]|4.0 [4.0, 4.0]|290.1 [290.1, 290.1]|152.24 [152.24, 152.24]|0.0006 [0.0006, 0.0006]|0.0001 [0.0001, 0.0001]|2/2 → 2/2|
|grip-escape-one-held|wrap-capacity-1.50x|rapier3d-compat|madden-pair-combined|0.0000 [0.0000, 0.0000]|5.0 [5.0, 5.0]|6.0 [6.0, 6.0]|15.2 [15.2, 15.2]|68.05 [68.05, 68.05]|-0.0012 [-0.0012, -0.0012]|-0.0001 [-0.0001, -0.0001]|2/2 → 2/2|
|grip-escape-one-held|wrap-capacity-1.00x|jolt-physics-js|madden-pair-combined|0.0000 [0.0000, 0.0000]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.00 [0.00, 0.00]|0.0000 [0.0000, 0.0000]|0.0000 [0.0000, 0.0000]|2/2 → 2/2|
|grip-escape-one-held|wrap-capacity-1.00x|rapier3d-compat|madden-pair-combined|0.0000 [0.0000, 0.0000]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.00 [0.00, 0.00]|0.0000 [0.0000, 0.0000]|0.0000 [0.0000, 0.0000]|2/2 → 2/2|
|grip-escape-one-held|wrap-capacity-0.50x|jolt-physics-js|madden-pair-combined|0.0000 [0.0000, 0.0000]|0.0 [0.0, 0.0]|-4.0 [-4.0, -4.0]|-258.9 [-258.9, -258.9]|20.53 [20.53, 20.53]|0.0094 [0.0094, 0.0094]|0.0087 [0.0087, 0.0087]|2/2 → 2/2|
|grip-escape-one-held|wrap-capacity-0.50x|rapier3d-compat|madden-pair-combined|0.0000 [0.0000, 0.0000]|-1.0 [-1.0, -1.0]|-2.0 [-2.0, -2.0]|-35.8 [-35.8, -35.8]|10.08 [10.08, 10.08]|0.0024 [0.0024, 0.0024]|0.0007 [0.0007, 0.0007]|2/2 → 2/2|
|possession-retained|wrap-capacity-1.50x|jolt-physics-js|madden-pair-combined|0.0000 [0.0000, 0.0000]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.00 [0.00, 0.00]|0.0000 [0.0000, 0.0000]|0.0000 [0.0000, 0.0000]|2/2 → 2/2|
|possession-retained|wrap-capacity-1.50x|rapier3d-compat|madden-pair-combined|0.0000 [0.0000, 0.0000]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.00 [0.00, 0.00]|0.0000 [0.0000, 0.0000]|0.0000 [0.0000, 0.0000]|2/2 → 2/2|
|possession-retained|wrap-capacity-1.00x|jolt-physics-js|madden-pair-combined|0.0000 [0.0000, 0.0000]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.00 [0.00, 0.00]|0.0000 [0.0000, 0.0000]|0.0000 [0.0000, 0.0000]|2/2 → 2/2|
|possession-retained|wrap-capacity-1.00x|rapier3d-compat|madden-pair-combined|0.0000 [0.0000, 0.0000]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.00 [0.00, 0.00]|0.0000 [0.0000, 0.0000]|0.0000 [0.0000, 0.0000]|2/2 → 2/2|
|possession-retained|wrap-capacity-0.50x|jolt-physics-js|madden-pair-combined|0.0000 [0.0000, 0.0000]|-69.0 [-69.0, -69.0]|-113.0 [-113.0, -113.0]|-747.0 [-747.0, -747.0]|0.00 [0.00, 0.00]|0.0000 [0.0000, 0.0000]|-0.0023 [-0.0023, -0.0023]|2/2 → 2/2|
|possession-retained|wrap-capacity-0.50x|rapier3d-compat|madden-pair-combined|0.0000 [0.0000, 0.0000]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.00 [0.00, 0.00]|0.0000 [0.0000, 0.0000]|0.0000 [0.0000, 0.0000]|2/2 → 2/2|
|possession-retained|str-continuity-bush-81.00|jolt-physics-js|madden-pair-combined|0.0003 [0.0003, 0.0003]|0.0 [0.0, 0.0]|-3.0 [-3.0, -3.0]|7.5 [7.5, 7.5]|0.56 [0.56, 0.56]|-0.0000 [-0.0000, -0.0000]|-0.0002 [-0.0002, -0.0002]|2/2 → 2/2|
|possession-retained|str-continuity-bush-81.00|rapier3d-compat|madden-pair-combined|0.0171 [0.0171, 0.0171]|-164.0 [-164.0, -164.0]|-89.0 [-89.0, -89.0]|n/a|0.00 [0.00, 0.00]|-0.0198 [-0.0198, -0.0198]|-0.0137 [-0.0137, -0.0137]|2/2 → 0/2|
|possession-retained|str-continuity-bush-80.50|jolt-physics-js|madden-pair-combined|0.0002 [0.0002, 0.0002]|0.0 [0.0, 0.0]|-1.0 [-1.0, -1.0]|6.7 [6.7, 6.7]|0.51 [0.51, 0.51]|-0.0000 [-0.0000, -0.0000]|0.0002 [0.0002, 0.0002]|2/2 → 2/2|
|possession-retained|str-continuity-bush-80.50|rapier3d-compat|madden-pair-combined|0.0154 [0.0154, 0.0154]|-219.0 [-219.0, -219.0]|-89.0 [-89.0, -89.0]|n/a|0.00 [0.00, 0.00]|0.0012 [0.0012, 0.0012]|-0.0134 [-0.0134, -0.0134]|2/2 → 0/2|
|possession-retained|str-continuity-bush-80.00|jolt-physics-js|madden-pair-combined|0.0002 [0.0002, 0.0002]|0.0 [0.0, 0.0]|-6.0 [-6.0, -6.0]|6.6 [6.6, 6.6]|0.47 [0.47, 0.47]|-0.0000 [-0.0000, -0.0000]|-0.0001 [-0.0001, -0.0001]|2/2 → 2/2|
|possession-retained|str-continuity-bush-80.00|rapier3d-compat|madden-pair-combined|-0.0006 [-0.0006, -0.0006]|0.0 [0.0, 0.0]|9.0 [9.0, 9.0]|59.7 [59.7, 59.7]|0.00 [0.00, 0.00]|0.0139 [0.0139, 0.0139]|0.0125 [0.0125, 0.0125]|2/2 → 2/2|
|possession-retained|str-continuity-henderson-81.00|jolt-physics-js|madden-pair-combined|0.0007 [0.0007, 0.0007]|0.0 [0.0, 0.0]|-10.0 [-10.0, -10.0]|0.2 [0.2, 0.2]|33.88 [33.88, 33.88]|-0.0001 [-0.0001, -0.0001]|-0.0000 [-0.0000, -0.0000]|2/2 → 2/2|
|possession-retained|str-continuity-henderson-81.00|rapier3d-compat|madden-pair-combined|0.0081 [0.0081, 0.0081]|0.0 [0.0, 0.0]|-3.0 [-3.0, -3.0]|10.9 [10.9, 10.9]|19.54 [19.54, 19.54]|-0.0137 [-0.0137, -0.0137]|0.0006 [0.0006, 0.0006]|2/2 → 2/2|
|possession-retained|str-continuity-henderson-80.50|jolt-physics-js|madden-pair-combined|0.0007 [0.0007, 0.0007]|0.0 [0.0, 0.0]|-10.0 [-10.0, -10.0]|-0.1 [-0.1, -0.1]|32.18 [32.18, 32.18]|-0.0001 [-0.0001, -0.0001]|0.0003 [0.0003, 0.0003]|2/2 → 2/2|
|possession-retained|str-continuity-henderson-80.50|rapier3d-compat|madden-pair-combined|-0.0004 [-0.0004, -0.0004]|0.0 [0.0, 0.0]|3.0 [3.0, 3.0]|46.9 [46.9, 46.9]|18.58 [18.58, 18.58]|0.0033 [0.0033, 0.0033]|0.0049 [0.0049, 0.0049]|2/2 → 2/2|
|possession-retained|str-continuity-henderson-80.00|jolt-physics-js|madden-pair-combined|0.0006 [0.0006, 0.0006]|0.0 [0.0, 0.0]|-16.0 [-16.0, -16.0]|-1.7 [-1.7, -1.7]|30.48 [30.48, 30.48]|-0.0001 [-0.0001, -0.0001]|-0.0020 [-0.0020, -0.0020]|2/2 → 2/2|
|possession-retained|str-continuity-henderson-80.00|rapier3d-compat|madden-pair-combined|0.0166 [0.0166, 0.0166]|-163.0 [-163.0, -163.0]|-89.0 [-89.0, -89.0]|n/a|23.21 [23.21, 23.21]|-0.0002 [-0.0002, -0.0002]|-0.0129 [-0.0129, -0.0129]|2/2 → 0/2|
|gang-staggered-three|madden-pair-combined|jolt-physics-js|m4c-neutral|0.0002 [0.0002, 0.0002]|0.0 [0.0, 0.0]|1.0 [1.0, 1.0]|-118.5 [-118.5, -118.5]|0.37 [0.37, 0.37]|0.0017 [0.0017, 0.0017]|0.0007 [0.0007, 0.0007]|2/2 → 2/2|
|gang-staggered-three|madden-pair-combined|rapier3d-compat|m4c-neutral|-0.0016 [-0.0016, -0.0016]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|-255.5 [-255.5, -255.5]|-1.71 [-1.71, -1.71]|0.0016 [0.0016, 0.0016]|0.0025 [0.0025, 0.0025]|2/2 → 2/2|
|grip-escape-one-held|madden-pair-combined|jolt-physics-js|m4c-neutral|-0.0048 [-0.0048, -0.0048]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|-47.0 [-47.0, -47.0]|-23.61 [-23.61, -23.61]|0.0034 [0.0034, 0.0034]|-0.0013 [-0.0013, -0.0013]|2/2 → 2/2|
|grip-escape-one-held|madden-pair-combined|rapier3d-compat|m4c-neutral|-0.0039 [-0.0039, -0.0039]|1.0 [1.0, 1.0]|1.0 [1.0, 1.0]|-12.8 [-12.8, -12.8]|-27.59 [-27.59, -27.59]|0.0011 [0.0011, 0.0011]|0.0000 [0.0000, 0.0000]|2/2 → 2/2|
|possession-retained|madden-pair-combined|jolt-physics-js|m4c-neutral|-0.0001 [-0.0001, -0.0001]|0.0 [0.0, 0.0]|2.0 [2.0, 2.0]|7.3 [7.3, 7.3]|-28.27 [-28.27, -28.27]|0.0003 [0.0003, 0.0003]|-0.0003 [-0.0003, -0.0003]|2/2 → 2/2|
|possession-retained|madden-pair-combined|rapier3d-compat|m4c-neutral|0.0002 [0.0002, 0.0002]|0.0 [0.0, 0.0]|-37.0 [-37.0, -37.0]|-52.8 [-52.8, -52.8]|-28.10 [-28.10, -28.10]|0.0033 [0.0033, 0.0033]|0.0005 [0.0005, 0.0005]|2/2 → 2/2|
|gang-staggered-three|str-both-after-individual|jolt-physics-js|m4c-neutral|0.0001 [0.0001, 0.0001]|0.0 [0.0, 0.0]|1.0 [1.0, 1.0]|-96.2 [-96.2, -96.2]|4.18 [4.18, 4.18]|0.0021 [0.0021, 0.0021]|0.0006 [0.0006, 0.0006]|2/2 → 2/2|
|gang-staggered-three|str-both-after-individual|rapier3d-compat|m4c-neutral|-0.0016 [-0.0016, -0.0016]|0.0 [0.0, 0.0]|-20.0 [-20.0, -20.0]|-127.8 [-127.8, -127.8]|6.33 [6.33, 6.33]|0.0053 [0.0053, 0.0053]|-0.0003 [-0.0003, -0.0003]|2/2 → 2/2|
|grip-escape-one-held|str-both-after-individual|jolt-physics-js|m4c-neutral|-0.0050 [-0.0050, -0.0050]|0.0 [0.0, 0.0]|-1.0 [-1.0, -1.0]|-11.8 [-11.8, -11.8]|-30.96 [-30.96, -30.96]|0.0041 [0.0041, 0.0041]|-0.0009 [-0.0009, -0.0009]|2/2 → 2/2|
|grip-escape-one-held|str-both-after-individual|rapier3d-compat|m4c-neutral|-0.0043 [-0.0043, -0.0043]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|-11.2 [-11.2, -11.2]|-10.68 [-10.68, -10.68]|-0.0007 [-0.0007, -0.0007]|-0.0000 [-0.0000, -0.0000]|2/2 → 2/2|
|possession-retained|str-both-after-individual|jolt-physics-js|m4c-neutral|-0.0008 [-0.0008, -0.0008]|0.0 [0.0, 0.0]|-12.0 [-12.0, -12.0]|10.6 [10.6, 10.6]|-30.81 [-30.81, -30.81]|0.0001 [0.0001, 0.0001]|-0.0005 [-0.0005, -0.0005]|2/2 → 2/2|
|possession-retained|str-both-after-individual|rapier3d-compat|m4c-neutral|-0.0000 [-0.0000, -0.0000]|0.0 [0.0, 0.0]|-9.0 [-9.0, -9.0]|-38.4 [-38.4, -38.4]|-18.32 [-18.32, -18.32]|-0.0072 [-0.0072, -0.0072]|0.0025 [0.0025, 0.0025]|2/2 → 2/2|
|gang-staggered-three|mass-both-after-individual|jolt-physics-js|m4c-neutral|-0.0029 [-0.0029, -0.0029]|-6.0 [-6.0, -6.0]|-3.0 [-3.0, -3.0]|116.6 [116.6, 116.6]|72.29 [72.29, 72.29]|0.0001 [0.0001, 0.0001]|0.0003 [0.0003, 0.0003]|2/2 → 2/2|
|gang-staggered-three|mass-both-after-individual|rapier3d-compat|m4c-neutral|0.0005 [0.0005, 0.0005]|0.0 [0.0, 0.0]|-2.0 [-2.0, -2.0]|-269.0 [-269.0, -269.0]|15.10 [15.10, 15.10]|0.0098 [0.0098, 0.0098]|0.0055 [0.0055, 0.0055]|2/2 → 2/2|
|grip-escape-one-held|mass-both-after-individual|jolt-physics-js|m4c-neutral|0.0001 [0.0001, 0.0001]|0.0 [0.0, 0.0]|-2.0 [-2.0, -2.0]|-34.5 [-34.5, -34.5]|-9.68 [-9.68, -9.68]|-0.0006 [-0.0006, -0.0006]|-0.0016 [-0.0016, -0.0016]|2/2 → 2/2|
|grip-escape-one-held|mass-both-after-individual|rapier3d-compat|m4c-neutral|0.0004 [0.0004, 0.0004]|-1.0 [-1.0, -1.0]|0.0 [0.0, 0.0]|-1.7 [-1.7, -1.7]|18.30 [18.30, 18.30]|-0.0001 [-0.0001, -0.0001]|-0.0001 [-0.0001, -0.0001]|2/2 → 2/2|
|possession-retained|mass-both-after-individual|jolt-physics-js|m4c-neutral|0.0008 [0.0008, 0.0008]|0.0 [0.0, 0.0]|-8.0 [-8.0, -8.0]|12.6 [12.6, 12.6]|2.76 [2.76, 2.76]|0.0002 [0.0002, 0.0002]|-0.0004 [-0.0004, -0.0004]|2/2 → 2/2|
|possession-retained|mass-both-after-individual|rapier3d-compat|m4c-neutral|-0.0003 [-0.0003, -0.0003]|0.0 [0.0, 0.0]|-25.0 [-25.0, -25.0]|11.3 [11.3, 11.3]|-4.89 [-4.89, -4.89]|0.0088 [0.0088, 0.0088]|0.0096 [0.0096, 0.0096]|2/2 → 2/2|
|gang-staggered-three|str-bush-only|jolt-physics-js|m4c-neutral|0.0001 [0.0001, 0.0001]|6.0 [6.0, 6.0]|3.0 [3.0, 3.0]|-138.7 [-138.7, -138.7]|52.60 [52.60, 52.60]|0.0049 [0.0049, 0.0049]|0.0024 [0.0024, 0.0024]|2/2 → 2/2|
|gang-staggered-three|str-bush-only|rapier3d-compat|m4c-neutral|0.0004 [0.0004, 0.0004]|0.0 [0.0, 0.0]|-28.0 [-28.0, -28.0]|-229.9 [-229.9, -229.9]|31.13 [31.13, 31.13]|0.0063 [0.0063, 0.0063]|0.0019 [0.0019, 0.0019]|2/2 → 2/2|
|gang-staggered-three|str-henderson-only|jolt-physics-js|m4c-neutral|-0.0004 [-0.0004, -0.0004]|-2.0 [-2.0, -2.0]|0.0 [0.0, 0.0]|10.5 [10.5, 10.5]|-1.94 [-1.94, -1.94]|0.0001 [0.0001, 0.0001]|0.0002 [0.0002, 0.0002]|2/2 → 2/2|
|gang-staggered-three|str-henderson-only|rapier3d-compat|m4c-neutral|-0.0016 [-0.0016, -0.0016]|0.0 [0.0, 0.0]|-8.0 [-8.0, -8.0]|-213.8 [-213.8, -213.8]|51.20 [51.20, 51.20]|0.0077 [0.0077, 0.0077]|-0.0030 [-0.0030, -0.0030]|2/2 → 2/2|
|grip-escape-one-held|str-bush-only|jolt-physics-js|m4c-neutral|-0.0011 [-0.0011, -0.0011]|-1.0 [-1.0, -1.0]|-1.0 [-1.0, -1.0]|-24.5 [-24.5, -24.5]|9.84 [9.84, 9.84]|0.0044 [0.0044, 0.0044]|0.0025 [0.0025, 0.0025]|2/2 → 2/2|
|grip-escape-one-held|str-bush-only|rapier3d-compat|m4c-neutral|-0.0007 [-0.0007, -0.0007]|1.0 [1.0, 1.0]|1.0 [1.0, 1.0]|7.8 [7.8, 7.8]|-2.54 [-2.54, -2.54]|0.0026 [0.0026, 0.0026]|0.0001 [0.0001, 0.0001]|2/2 → 2/2|
|grip-escape-one-held|str-henderson-only|jolt-physics-js|m4c-neutral|-0.0039 [-0.0039, -0.0039]|0.0 [0.0, 0.0]|-1.0 [-1.0, -1.0]|14.1 [14.1, 14.1]|-36.31 [-36.31, -36.31]|0.0029 [0.0029, 0.0029]|-0.0013 [-0.0013, -0.0013]|2/2 → 2/2|
|grip-escape-one-held|str-henderson-only|rapier3d-compat|m4c-neutral|-0.0036 [-0.0036, -0.0036]|0.0 [0.0, 0.0]|1.0 [1.0, 1.0]|-17.9 [-17.9, -17.9]|-29.85 [-29.85, -29.85]|-0.0013 [-0.0013, -0.0013]|-0.0003 [-0.0003, -0.0003]|2/2 → 2/2|
|possession-retained|str-bush-only|jolt-physics-js|m4c-neutral|-0.0002 [-0.0002, -0.0002]|0.0 [0.0, 0.0]|-19.0 [-19.0, -19.0]|15.9 [15.9, 15.9]|-0.50 [-0.50, -0.50]|0.0000 [0.0000, 0.0000]|-0.0025 [-0.0025, -0.0025]|2/2 → 2/2|
|possession-retained|str-bush-only|rapier3d-compat|m4c-neutral|0.0000 [0.0000, 0.0000]|0.0 [0.0, 0.0]|1.0 [1.0, 1.0]|-17.5 [-17.5, -17.5]|0.00 [0.00, 0.00]|0.0065 [0.0065, 0.0065]|0.0056 [0.0056, 0.0056]|2/2 → 2/2|
|possession-retained|str-henderson-only|jolt-physics-js|m4c-neutral|-0.0006 [-0.0006, -0.0006]|0.0 [0.0, 0.0]|-22.0 [-22.0, -22.0]|12.9 [12.9, 12.9]|-30.36 [-30.36, -30.36]|0.0001 [0.0001, 0.0001]|-0.0018 [-0.0018, -0.0018]|2/2 → 2/2|
|possession-retained|str-henderson-only|rapier3d-compat|m4c-neutral|-0.0003 [-0.0003, -0.0003]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|2.9 [2.9, 2.9]|-18.32 [-18.32, -18.32]|0.0080 [0.0080, 0.0080]|0.0037 [0.0037, 0.0037]|2/2 → 2/2|
|gang-staggered-three|mass-bush-only|jolt-physics-js|m4c-neutral|0.0000 [0.0000, 0.0000]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.00 [0.00, 0.00]|0.0000 [0.0000, 0.0000]|0.0000 [0.0000, 0.0000]|2/2 → 2/2|
|gang-staggered-three|mass-bush-only|rapier3d-compat|m4c-neutral|0.0000 [0.0000, 0.0000]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.00 [0.00, 0.00]|0.0000 [0.0000, 0.0000]|0.0000 [0.0000, 0.0000]|2/2 → 2/2|
|gang-staggered-three|mass-henderson-only|jolt-physics-js|m4c-neutral|-0.0029 [-0.0029, -0.0029]|-6.0 [-6.0, -6.0]|-3.0 [-3.0, -3.0]|116.6 [116.6, 116.6]|72.29 [72.29, 72.29]|0.0001 [0.0001, 0.0001]|0.0003 [0.0003, 0.0003]|2/2 → 2/2|
|gang-staggered-three|mass-henderson-only|rapier3d-compat|m4c-neutral|0.0005 [0.0005, 0.0005]|0.0 [0.0, 0.0]|-2.0 [-2.0, -2.0]|-269.0 [-269.0, -269.0]|15.10 [15.10, 15.10]|0.0098 [0.0098, 0.0098]|0.0055 [0.0055, 0.0055]|2/2 → 2/2|
|grip-escape-one-held|mass-bush-only|jolt-physics-js|m4c-neutral|0.0000 [0.0000, 0.0000]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.00 [0.00, 0.00]|0.0000 [0.0000, 0.0000]|0.0000 [0.0000, 0.0000]|2/2 → 2/2|
|grip-escape-one-held|mass-bush-only|rapier3d-compat|m4c-neutral|0.0000 [0.0000, 0.0000]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.00 [0.00, 0.00]|0.0000 [0.0000, 0.0000]|0.0000 [0.0000, 0.0000]|2/2 → 2/2|
|grip-escape-one-held|mass-henderson-only|jolt-physics-js|m4c-neutral|0.0001 [0.0001, 0.0001]|0.0 [0.0, 0.0]|-2.0 [-2.0, -2.0]|-34.5 [-34.5, -34.5]|-9.68 [-9.68, -9.68]|-0.0006 [-0.0006, -0.0006]|-0.0016 [-0.0016, -0.0016]|2/2 → 2/2|
|grip-escape-one-held|mass-henderson-only|rapier3d-compat|m4c-neutral|0.0004 [0.0004, 0.0004]|-1.0 [-1.0, -1.0]|0.0 [0.0, 0.0]|-1.7 [-1.7, -1.7]|18.30 [18.30, 18.30]|-0.0001 [-0.0001, -0.0001]|-0.0001 [-0.0001, -0.0001]|2/2 → 2/2|
|possession-retained|mass-bush-only|jolt-physics-js|m4c-neutral|0.0000 [0.0000, 0.0000]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.00 [0.00, 0.00]|0.0000 [0.0000, 0.0000]|0.0000 [0.0000, 0.0000]|2/2 → 2/2|
|possession-retained|mass-bush-only|rapier3d-compat|m4c-neutral|0.0000 [0.0000, 0.0000]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.0 [0.0, 0.0]|0.00 [0.00, 0.00]|0.0000 [0.0000, 0.0000]|0.0000 [0.0000, 0.0000]|2/2 → 2/2|
|possession-retained|mass-henderson-only|jolt-physics-js|m4c-neutral|0.0008 [0.0008, 0.0008]|0.0 [0.0, 0.0]|-8.0 [-8.0, -8.0]|12.6 [12.6, 12.6]|2.76 [2.76, 2.76]|0.0002 [0.0002, 0.0002]|-0.0004 [-0.0004, -0.0004]|2/2 → 2/2|
|possession-retained|mass-henderson-only|rapier3d-compat|m4c-neutral|-0.0003 [-0.0003, -0.0003]|0.0 [0.0, 0.0]|-25.0 [-25.0, -25.0]|11.3 [11.3, 11.3]|-4.89 [-4.89, -4.89]|0.0088 [0.0088, 0.0088]|0.0096 [0.0096, 0.0096]|2/2 → 2/2|
## STR continuity around 80–81

At the frozen H-B masses (92/106 kg), each actor is varied independently while the other retains its source STR. The full 79–82 sweep, including 0.1 increments from 80 through 81, is reported below for both solvers. Torque is the maximum requested balance-controller torque over the full trace; every step-level request remains in its gzip trace. The additional step-5 audit samples controller torque at 0.04167 s, before the players reach contact.
At step 5 the tested torque series is nondecreasing for every actor, solver, and seed: true. Representative 79→82 requests at seed 41027: henderson rapier3d-compat 79→82: 224.356→228.936 N·m; henderson jolt-physics-js 79→82: 153.267→156.414 N·m; bush rapier3d-compat 79→82: 127.053→129.663 N·m; bush jolt-physics-js 79→82: 86.612→88.390 N·m. Smooth controller-input changes can legitimately alter subsequent feedback-driven trajectories. Contact formation remains a discrete engine event. Across 22 adjacent contact/no-contact STR transitions, the first engine-contact sample has a positive analytic proxy gap in 22 cases (0.01021–0.01751 m); neighboring no-contact runs have closest opportunity gaps from 0.01132 to 0.02077 m. These transitions are not explained by crossing analytic gap zero: the proxy boundary differs from the engines’ contact boundary, pointing to a geometry/contact-query mismatch. Separately, 30 full-matrix cases with nonpositive Rapier proxy gap but no Rapier contact remain candidate detection discrepancies. Across all comparisons, the evidence supports trajectory-mediated contact splits in some cases and contact-boundary mismatch in others; it does not establish a general missed-detection defect.
| Actor | STR | Engine | Min gap (m) | First contact (s) | Contact samples | Peak torque request (N·m) | Status |
|---|---:|---|---:|---:|---:|---:|---|
|Bush (tackler)|82|jolt-physics-js|-0.00939|0.0917|231|253.92|failed|
|Bush (tackler)|82|rapier3d-compat|0.00221|0.1167|90|227.89|failed|
|Bush (tackler)|81.5|jolt-physics-js|-0.00941|0.0917|231|253.17|failed|
|Bush (tackler)|81.5|rapier3d-compat|0.01193|—|0|227.19|failed|
|Bush (tackler)|81.25|jolt-physics-js|-0.00942|0.0917|249|252.80|failed|
|Bush (tackler)|81.25|rapier3d-compat|0.01704|—|0|226.82|failed|
|Bush (tackler)|81|jolt-physics-js|-0.00943|0.0917|250|252.43|failed|
|Bush (tackler)|81|rapier3d-compat|0.01724|—|0|226.48|failed|
|Bush (tackler)|80.9|jolt-physics-js|-0.00943|0.0917|249|252.27|failed|
|Bush (tackler)|80.9|rapier3d-compat|-0.00012|0.1250|96|226.34|failed|
|Bush (tackler)|80.8|jolt-physics-js|-0.00943|0.0917|249|252.09|failed|
|Bush (tackler)|80.8|rapier3d-compat|-0.00009|0.1167|100|226.22|failed|
|Bush (tackler)|80.7|jolt-physics-js|-0.00944|0.0917|251|251.99|failed|
|Bush (tackler)|80.7|rapier3d-compat|0.00134|0.1250|84|226.09|failed|
|Bush (tackler)|80.6|jolt-physics-js|-0.00944|0.0917|242|251.85|failed|
|Bush (tackler)|80.6|rapier3d-compat|-0.00035|0.1250|94|225.98|failed|
|Bush (tackler)|80.5|jolt-physics-js|-0.00945|0.0917|252|251.68|failed|
|Bush (tackler)|80.5|rapier3d-compat|0.01553|—|0|225.79|failed|
|Bush (tackler)|80.4|jolt-physics-js|-0.00945|0.0917|251|251.53|failed|
|Bush (tackler)|80.4|rapier3d-compat|0.01484|—|0|225.68|failed|
|Bush (tackler)|80.3|jolt-physics-js|-0.00945|0.0917|252|251.38|failed|
|Bush (tackler)|80.3|rapier3d-compat|0.01801|—|0|225.54|failed|
|Bush (tackler)|80.2|jolt-physics-js|-0.00946|0.0917|252|251.24|failed|
|Bush (tackler)|80.2|rapier3d-compat|0.01681|—|0|225.38|failed|
|Bush (tackler)|80.1|jolt-physics-js|-0.00946|0.0917|247|251.11|failed|
|Bush (tackler)|80.1|rapier3d-compat|-0.00003|0.1250|94|225.24|failed|
|Bush (tackler)|80|jolt-physics-js|-0.00946|0.0917|247|250.95|failed|
|Bush (tackler)|80|rapier3d-compat|-0.00050|0.1167|98|225.10|failed|
|Bush (tackler)|79.75|jolt-physics-js|-0.00947|0.0917|251|250.58|failed|
|Bush (tackler)|79.75|rapier3d-compat|0.00527|0.1250|94|224.74|failed|
|Bush (tackler)|79.5|jolt-physics-js|-0.00948|0.0917|251|250.21|failed|
|Bush (tackler)|79.5|rapier3d-compat|-0.00012|0.1167|104|224.42|failed|
|Bush (tackler)|79|jolt-physics-js|-0.00950|0.0917|240|249.46|failed|
|Bush (tackler)|79|rapier3d-compat|-0.00029|0.1167|96|223.71|failed|
|Henderson (carrier)|82|jolt-physics-js|-0.00892|0.0917|236|444.51|failed|
|Henderson (carrier)|82|rapier3d-compat|0.00110|0.1250|89|367.70|failed|
|Henderson (carrier)|81.5|jolt-physics-js|-0.00896|0.0917|237|442.78|failed|
|Henderson (carrier)|81.5|rapier3d-compat|0.00757|0.1333|85|360.99|failed|
|Henderson (carrier)|81.25|jolt-physics-js|-0.00897|0.0917|237|441.88|failed|
|Henderson (carrier)|81.25|rapier3d-compat|-0.00012|0.1167|93|360.57|failed|
|Henderson (carrier)|81|jolt-physics-js|-0.00899|0.0917|243|441.07|failed|
|Henderson (carrier)|81|rapier3d-compat|0.00822|0.1250|86|360.06|failed|
|Henderson (carrier)|80.9|jolt-physics-js|-0.00900|0.0917|236|440.69|failed|
|Henderson (carrier)|80.9|rapier3d-compat|0.01132|—|0|359.89|failed|
|Henderson (carrier)|80.8|jolt-physics-js|-0.00900|0.0917|232|440.36|failed|
|Henderson (carrier)|80.8|rapier3d-compat|0.01676|—|0|365.23|failed|
|Henderson (carrier)|80.7|jolt-physics-js|-0.00901|0.0917|232|440.02|failed|
|Henderson (carrier)|80.7|rapier3d-compat|0.01413|—|0|359.48|failed|
|Henderson (carrier)|80.6|jolt-physics-js|-0.00902|0.0917|244|439.68|failed|
|Henderson (carrier)|80.6|rapier3d-compat|0.02077|—|0|359.24|failed|
|Henderson (carrier)|80.5|jolt-physics-js|-0.00902|0.0917|243|439.37|failed|
|Henderson (carrier)|80.5|rapier3d-compat|-0.00031|0.1250|92|359.10|failed|
|Henderson (carrier)|80.4|jolt-physics-js|-0.00903|0.0917|243|438.96|failed|
|Henderson (carrier)|80.4|rapier3d-compat|0.01443|—|0|364.56|failed|
|Henderson (carrier)|80.3|jolt-physics-js|-0.00904|0.0917|239|438.68|failed|
|Henderson (carrier)|80.3|rapier3d-compat|0.01573|—|0|364.31|failed|
|Henderson (carrier)|80.2|jolt-physics-js|-0.00904|0.0917|238|438.36|failed|
|Henderson (carrier)|80.2|rapier3d-compat|0.01566|—|0|364.10|failed|
|Henderson (carrier)|80.1|jolt-physics-js|-0.00905|0.0917|238|438.03|failed|
|Henderson (carrier)|80.1|rapier3d-compat|-0.00002|0.1333|91|363.98|failed|
|Henderson (carrier)|80|jolt-physics-js|-0.00906|0.0917|237|437.67|failed|
|Henderson (carrier)|80|rapier3d-compat|0.01671|—|0|363.73|failed|
|Henderson (carrier)|79.75|jolt-physics-js|-0.00908|0.0917|237|436.80|failed|
|Henderson (carrier)|79.75|rapier3d-compat|-0.00018|0.1250|106|363.23|failed|
|Henderson (carrier)|79.5|jolt-physics-js|-0.00909|0.0917|237|435.95|failed|
|Henderson (carrier)|79.5|rapier3d-compat|0.00386|0.1250|98|362.71|failed|
|Henderson (carrier)|79|jolt-physics-js|-0.00913|0.0917|238|434.23|failed|
|Henderson (carrier)|79|rapier3d-compat|0.01663|—|0|361.76|failed|
### Adjacent STR contact transitions and closest approach
| Actor | Engine | Seed | STR pair | Contact pair | Lower closest gap (m, tick/time) | Upper closest gap (m, tick/time) |
|---|---|---:|---|---|---|---|
|bush|rapier3d-compat|41028|81.5→82|no→yes|0.01193 (14/0.1167 s)|0.01272 (14/0.1167 s)|
|bush|rapier3d-compat|41028|80.9→81|yes→no|0.01021 (15/0.1250 s)|0.01724 (14/0.1167 s)|
|bush|rapier3d-compat|41028|80.5→80.6|no→yes|0.01553 (14/0.1167 s)|0.01126 (15/0.1250 s)|
|bush|rapier3d-compat|41028|80.1→80.2|yes→no|0.01088 (15/0.1250 s)|0.01681 (14/0.1167 s)|
|bush|rapier3d-compat|41027|81.5→82|no→yes|0.01193 (14/0.1167 s)|0.01272 (14/0.1167 s)|
|bush|rapier3d-compat|41027|80.9→81|yes→no|0.01021 (15/0.1250 s)|0.01724 (14/0.1167 s)|
|bush|rapier3d-compat|41027|80.5→80.6|no→yes|0.01553 (14/0.1167 s)|0.01126 (15/0.1250 s)|
|bush|rapier3d-compat|41027|80.1→80.2|yes→no|0.01088 (15/0.1250 s)|0.01681 (14/0.1167 s)|
|henderson|rapier3d-compat|41028|80.9→81|no→yes|0.01132 (14/0.1167 s)|0.01751 (15/0.1250 s)|
|henderson|rapier3d-compat|41028|80.5→80.6|yes→no|0.01051 (15/0.1250 s)|0.02077 (14/0.1167 s)|
|henderson|rapier3d-compat|41028|80.4→80.5|no→yes|0.01443 (14/0.1167 s)|0.01051 (15/0.1250 s)|
|henderson|rapier3d-compat|41028|80.1→80.2|yes→no|0.01482 (16/0.1333 s)|0.01566 (14/0.1167 s)|
|henderson|rapier3d-compat|41028|80→80.1|no→yes|0.01671 (14/0.1167 s)|0.01482 (16/0.1333 s)|
|henderson|rapier3d-compat|41028|79.75→80|yes→no|0.01072 (15/0.1250 s)|0.01671 (14/0.1167 s)|
|henderson|rapier3d-compat|41028|79→79.5|no→yes|0.01663 (14/0.1167 s)|0.01484 (15/0.1250 s)|
|henderson|rapier3d-compat|41027|80.9→81|no→yes|0.01132 (14/0.1167 s)|0.01751 (15/0.1250 s)|
|henderson|rapier3d-compat|41027|80.5→80.6|yes→no|0.01051 (15/0.1250 s)|0.02077 (14/0.1167 s)|
|henderson|rapier3d-compat|41027|80.4→80.5|no→yes|0.01443 (14/0.1167 s)|0.01051 (15/0.1250 s)|
|henderson|rapier3d-compat|41027|80.1→80.2|yes→no|0.01482 (16/0.1333 s)|0.01566 (14/0.1167 s)|
|henderson|rapier3d-compat|41027|80→80.1|no→yes|0.01671 (14/0.1167 s)|0.01482 (16/0.1333 s)|
|henderson|rapier3d-compat|41027|79.75→80|yes→no|0.01072 (15/0.1250 s)|0.01671 (14/0.1167 s)|
|henderson|rapier3d-compat|41027|79→79.5|no→yes|0.01663 (14/0.1167 s)|0.01484 (15/0.1250 s)|
## Matched Rapier/Jolt trajectory and contact diagnosis

Each comparison is paired by fixture, input, seed, and tick at 120 Hz. Position divergence is measured for the scripted focus pair. A Jolt contact while both analytic gaps remain positive is classified as a geometry/contact-boundary mismatch; a positive Rapier gap with Jolt proxy overlap is trajectory-mediated. A nonpositive Rapier gap without Rapier contact is flagged as a candidate contact-boundary/detection discrepancy, not presumed to be a missed query.
Across 188 matched pairs, first contact-state splits by class: trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated (128); Rapier proxy overlap without Rapier contact: candidate contact-boundary/detection discrepancy (30); geometry/contact-boundary mismatch: Jolt reports contact while both analytic proxy gaps are positive (30). The table lists every comparison with a contact-state split; full matched trajectories and per-step inputs remain in traces.
The preceding target-mass STR diagnosis found the Barkley–Baun case to be trajectory-mediated: at 0.09167 s Rapier remained at +0.03172 m analytic gap while Jolt had crossed to −0.0065 m and reported contact. Rapier’s gap stayed positive for the run, so that evidence did not support a missed Rapier query. The solver trajectories first diverged during ground response; their angular states changed the feedback balance torques, and the player paths separated before player contact. In other comparisons where both analytic gaps were positive but Jolt reported contact, the shared proxy did not match the engines’ contact boundary. The prior report preserves all 332 runs and exact paired traces; this study replays that source case and repeats H-B inputs.
| Scenario | Input | Seed | First split (tick / s) | Rapier gap (m) | Jolt gap (m) | Classification | Pair position divergence at split (m) |
|---|---|---:|---:|---:|---:|---|---|
|possession-retained|old-barkley-baun-lost-contact|41028|11 / 0.0917|0.03172|-0.00654|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02349|
|possession-retained|old-barkley-baun-lost-contact|41027|11 / 0.0917|0.03172|-0.00654|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02349|
|possession-retained|btk-drive-rating-99|41028|11 / 0.0917|0.03072|-0.00626|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02350|
|possession-retained|btk-drive-rating-99|41027|11 / 0.0917|0.03072|-0.00626|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02350|
|possession-retained|btk-drive-rating-90|41028|11 / 0.0917|0.03072|-0.00626|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02350|
|possession-retained|btk-drive-rating-90|41027|11 / 0.0917|0.03072|-0.00626|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02350|
|possession-retained|btk-drive-rating-82|41028|11 / 0.0917|0.03072|-0.00626|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02350|
|possession-retained|btk-drive-rating-82|41027|11 / 0.0917|0.03072|-0.00626|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02350|
|possession-retained|btk-drive-rating-81|41028|11 / 0.0917|0.03072|-0.00626|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02350|
|possession-retained|btk-drive-rating-81|41027|11 / 0.0917|0.03072|-0.00626|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02350|
|possession-retained|btk-drive-rating-80|41028|11 / 0.0917|0.03072|-0.00626|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02350|
|possession-retained|btk-drive-rating-80|41027|11 / 0.0917|0.03072|-0.00626|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02350|
|possession-retained|btk-drive-rating-79|41028|11 / 0.0917|0.03072|-0.00626|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02350|
|possession-retained|btk-drive-rating-79|41027|11 / 0.0917|0.03072|-0.00626|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02350|
|possession-retained|btk-drive-rating-70|41028|11 / 0.0917|0.03072|-0.00626|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02350|
|possession-retained|btk-drive-rating-70|41027|11 / 0.0917|0.03072|-0.00626|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02350|
|possession-retained|btk-drive-rating-60|41028|11 / 0.0917|0.03072|-0.00626|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02350|
|possession-retained|btk-drive-rating-60|41027|11 / 0.0917|0.03072|-0.00626|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02350|
|possession-retained|btk-drive-rating-50|41028|11 / 0.0917|0.03072|-0.00626|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02350|
|possession-retained|btk-drive-rating-50|41027|11 / 0.0917|0.03072|-0.00626|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02350|
|possession-retained|balance-scale-1.20|41028|11 / 0.0917|0.03515|-0.00162|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02371|
|possession-retained|balance-scale-1.20|41027|11 / 0.0917|0.03515|-0.00162|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02371|
|possession-retained|balance-scale-0.80|41028|11 / 0.0917|0.03072|-0.00626|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02350|
|possession-retained|balance-scale-0.80|41027|11 / 0.0917|0.03072|-0.00626|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02350|
|possession-retained|balance-scale-0.40|41028|11 / 0.0917|0.02109|-0.01141|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02235|
|possession-retained|balance-scale-0.40|41027|11 / 0.0917|0.02109|-0.01141|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02235|
|possession-retained|balance-scale-0.20|41028|11 / 0.0917|0.01812|-0.01204|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02148|
|possession-retained|balance-scale-0.20|41027|11 / 0.0917|0.01812|-0.01204|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02148|
|possession-retained|balance-scale-0.00|41028|11 / 0.0917|0.01765|-0.01498|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02205|
|possession-retained|balance-scale-0.00|41027|11 / 0.0917|0.01765|-0.01498|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02205|
|gang-staggered-three|tkl-capacity-hypothesis|41028|21 / 0.1750|0.02690|0.00816|geometry/contact-boundary mismatch: Jolt reports contact while both analytic proxy gaps are positive|0.00493|
|gang-staggered-three|tkl-capacity-hypothesis|41027|21 / 0.1750|0.02690|0.00816|geometry/contact-boundary mismatch: Jolt reports contact while both analytic proxy gaps are positive|0.00493|
|gang-staggered-three|tkl-capacity-rating-50-control|41028|21 / 0.1750|0.02690|0.00816|geometry/contact-boundary mismatch: Jolt reports contact while both analytic proxy gaps are positive|0.00493|
|gang-staggered-three|tkl-capacity-rating-50-control|41027|21 / 0.1750|0.02690|0.00816|geometry/contact-boundary mismatch: Jolt reports contact while both analytic proxy gaps are positive|0.00493|
|grip-escape-one-held|tkl-capacity-hypothesis|41028|25 / 0.2083|-0.00793|-0.00864|Rapier proxy overlap without Rapier contact: candidate contact-boundary/detection discrepancy|0.01003|
|grip-escape-one-held|tkl-capacity-hypothesis|41027|25 / 0.2083|-0.00793|-0.00864|Rapier proxy overlap without Rapier contact: candidate contact-boundary/detection discrepancy|0.01003|
|grip-escape-one-held|tkl-capacity-rating-50-control|41028|25 / 0.2083|-0.00793|-0.00864|Rapier proxy overlap without Rapier contact: candidate contact-boundary/detection discrepancy|0.01003|
|grip-escape-one-held|tkl-capacity-rating-50-control|41027|25 / 0.2083|-0.00793|-0.00864|Rapier proxy overlap without Rapier contact: candidate contact-boundary/detection discrepancy|0.01003|
|possession-retained|tkl-capacity-hypothesis|41028|11 / 0.0917|0.03072|-0.00626|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02350|
|possession-retained|tkl-capacity-hypothesis|41027|11 / 0.0917|0.03072|-0.00626|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02350|
|possession-retained|tkl-capacity-rating-50-control|41028|11 / 0.0917|0.03072|-0.00626|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02350|
|possession-retained|tkl-capacity-rating-50-control|41027|11 / 0.0917|0.03072|-0.00626|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02350|
|gang-staggered-three|wrap-capacity-1.50x|41028|21 / 0.1750|0.02690|0.00816|geometry/contact-boundary mismatch: Jolt reports contact while both analytic proxy gaps are positive|0.00493|
|gang-staggered-three|wrap-capacity-1.50x|41027|21 / 0.1750|0.02690|0.00816|geometry/contact-boundary mismatch: Jolt reports contact while both analytic proxy gaps are positive|0.00493|
|gang-staggered-three|wrap-capacity-1.25x|41028|21 / 0.1750|0.02690|0.00816|geometry/contact-boundary mismatch: Jolt reports contact while both analytic proxy gaps are positive|0.00493|
|gang-staggered-three|wrap-capacity-1.25x|41027|21 / 0.1750|0.02690|0.00816|geometry/contact-boundary mismatch: Jolt reports contact while both analytic proxy gaps are positive|0.00493|
|gang-staggered-three|wrap-capacity-1.00x|41028|21 / 0.1750|0.02690|0.00816|geometry/contact-boundary mismatch: Jolt reports contact while both analytic proxy gaps are positive|0.00493|
|gang-staggered-three|wrap-capacity-1.00x|41027|21 / 0.1750|0.02690|0.00816|geometry/contact-boundary mismatch: Jolt reports contact while both analytic proxy gaps are positive|0.00493|
|gang-staggered-three|wrap-capacity-0.75x|41028|21 / 0.1750|0.02690|0.00816|geometry/contact-boundary mismatch: Jolt reports contact while both analytic proxy gaps are positive|0.00493|
|gang-staggered-three|wrap-capacity-0.75x|41027|21 / 0.1750|0.02690|0.00816|geometry/contact-boundary mismatch: Jolt reports contact while both analytic proxy gaps are positive|0.00493|
|gang-staggered-three|wrap-capacity-0.50x|41028|21 / 0.1750|0.02690|0.00816|geometry/contact-boundary mismatch: Jolt reports contact while both analytic proxy gaps are positive|0.00493|
|gang-staggered-three|wrap-capacity-0.50x|41027|21 / 0.1750|0.02690|0.00816|geometry/contact-boundary mismatch: Jolt reports contact while both analytic proxy gaps are positive|0.00493|
|grip-escape-one-held|wrap-capacity-1.50x|41028|25 / 0.2083|-0.00793|-0.00864|Rapier proxy overlap without Rapier contact: candidate contact-boundary/detection discrepancy|0.01003|
|grip-escape-one-held|wrap-capacity-1.50x|41027|25 / 0.2083|-0.00793|-0.00864|Rapier proxy overlap without Rapier contact: candidate contact-boundary/detection discrepancy|0.01003|
|grip-escape-one-held|wrap-capacity-1.25x|41028|25 / 0.2083|-0.00793|-0.00864|Rapier proxy overlap without Rapier contact: candidate contact-boundary/detection discrepancy|0.01003|
|grip-escape-one-held|wrap-capacity-1.25x|41027|25 / 0.2083|-0.00793|-0.00864|Rapier proxy overlap without Rapier contact: candidate contact-boundary/detection discrepancy|0.01003|
|grip-escape-one-held|wrap-capacity-1.00x|41028|25 / 0.2083|-0.00793|-0.00864|Rapier proxy overlap without Rapier contact: candidate contact-boundary/detection discrepancy|0.01003|
|grip-escape-one-held|wrap-capacity-1.00x|41027|25 / 0.2083|-0.00793|-0.00864|Rapier proxy overlap without Rapier contact: candidate contact-boundary/detection discrepancy|0.01003|
|grip-escape-one-held|wrap-capacity-0.75x|41028|25 / 0.2083|-0.00793|-0.00864|Rapier proxy overlap without Rapier contact: candidate contact-boundary/detection discrepancy|0.01003|
|grip-escape-one-held|wrap-capacity-0.75x|41027|25 / 0.2083|-0.00793|-0.00864|Rapier proxy overlap without Rapier contact: candidate contact-boundary/detection discrepancy|0.01003|
|grip-escape-one-held|wrap-capacity-0.50x|41028|25 / 0.2083|-0.00793|-0.00864|Rapier proxy overlap without Rapier contact: candidate contact-boundary/detection discrepancy|0.01003|
|grip-escape-one-held|wrap-capacity-0.50x|41027|25 / 0.2083|-0.00793|-0.00864|Rapier proxy overlap without Rapier contact: candidate contact-boundary/detection discrepancy|0.01003|
|possession-retained|wrap-capacity-1.50x|41028|11 / 0.0917|0.03072|-0.00626|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02350|
|possession-retained|wrap-capacity-1.50x|41027|11 / 0.0917|0.03072|-0.00626|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02350|
|possession-retained|wrap-capacity-1.25x|41028|11 / 0.0917|0.03072|-0.00626|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02350|
|possession-retained|wrap-capacity-1.25x|41027|11 / 0.0917|0.03072|-0.00626|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02350|
|possession-retained|wrap-capacity-1.00x|41028|11 / 0.0917|0.03072|-0.00626|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02350|
|possession-retained|wrap-capacity-1.00x|41027|11 / 0.0917|0.03072|-0.00626|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02350|
|possession-retained|wrap-capacity-0.75x|41028|11 / 0.0917|0.03072|-0.00626|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02350|
|possession-retained|wrap-capacity-0.75x|41027|11 / 0.0917|0.03072|-0.00626|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02350|
|possession-retained|wrap-capacity-0.50x|41028|11 / 0.0917|0.03072|-0.00626|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02350|
|possession-retained|wrap-capacity-0.50x|41027|11 / 0.0917|0.03072|-0.00626|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02350|
|possession-retained|str-continuity-bush-82.00|41028|11 / 0.0917|0.03143|-0.00596|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02333|
|possession-retained|str-continuity-bush-82.00|41027|11 / 0.0917|0.03143|-0.00596|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02333|
|possession-retained|str-continuity-bush-81.50|41028|11 / 0.0917|0.02761|-0.00598|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02209|
|possession-retained|str-continuity-bush-81.50|41027|11 / 0.0917|0.02761|-0.00598|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02209|
|possession-retained|str-continuity-bush-81.25|41028|11 / 0.0917|0.03107|-0.00599|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02317|
|possession-retained|str-continuity-bush-81.25|41027|11 / 0.0917|0.03107|-0.00599|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02317|
|possession-retained|str-continuity-bush-81.00|41028|11 / 0.0917|0.03249|-0.00600|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02328|
|possession-retained|str-continuity-bush-81.00|41027|11 / 0.0917|0.03249|-0.00600|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02328|
|possession-retained|str-continuity-bush-80.90|41028|11 / 0.0917|0.02731|-0.00600|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02182|
|possession-retained|str-continuity-bush-80.90|41027|11 / 0.0917|0.02731|-0.00600|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02182|
|possession-retained|str-continuity-bush-80.80|41028|11 / 0.0917|0.02564|-0.00601|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02136|
|possession-retained|str-continuity-bush-80.80|41027|11 / 0.0917|0.02564|-0.00601|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02136|
|possession-retained|str-continuity-bush-80.70|41028|11 / 0.0917|0.03154|-0.00601|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02335|
|possession-retained|str-continuity-bush-80.70|41027|11 / 0.0917|0.03154|-0.00601|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02335|
|possession-retained|str-continuity-bush-80.60|41028|11 / 0.0917|0.02758|-0.00601|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02131|
|possession-retained|str-continuity-bush-80.60|41027|11 / 0.0917|0.02758|-0.00601|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02131|
|possession-retained|str-continuity-bush-80.50|41028|11 / 0.0917|0.02925|-0.00602|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02252|
|possession-retained|str-continuity-bush-80.50|41027|11 / 0.0917|0.02925|-0.00602|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02252|
|possession-retained|str-continuity-bush-80.40|41028|11 / 0.0917|0.02840|-0.00602|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02246|
|possession-retained|str-continuity-bush-80.40|41027|11 / 0.0917|0.02840|-0.00602|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02246|
|possession-retained|str-continuity-bush-80.30|41028|11 / 0.0917|0.03209|-0.00602|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02289|
|possession-retained|str-continuity-bush-80.30|41027|11 / 0.0917|0.03209|-0.00602|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02289|
|possession-retained|str-continuity-bush-80.20|41028|11 / 0.0917|0.03236|-0.00603|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02318|
|possession-retained|str-continuity-bush-80.20|41027|11 / 0.0917|0.03236|-0.00603|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02318|
|possession-retained|str-continuity-bush-80.10|41028|11 / 0.0917|0.02746|-0.00603|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02189|
|possession-retained|str-continuity-bush-80.10|41027|11 / 0.0917|0.02746|-0.00603|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02189|
|possession-retained|str-continuity-bush-80.00|41028|11 / 0.0917|0.02601|-0.00603|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02158|
|possession-retained|str-continuity-bush-80.00|41027|11 / 0.0917|0.02601|-0.00603|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02158|
|possession-retained|str-continuity-bush-79.75|41028|11 / 0.0917|0.03245|-0.00604|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02327|
|possession-retained|str-continuity-bush-79.75|41027|11 / 0.0917|0.03245|-0.00604|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02327|
|possession-retained|str-continuity-bush-79.50|41028|11 / 0.0917|0.02599|-0.00605|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02158|
|possession-retained|str-continuity-bush-79.50|41027|11 / 0.0917|0.02599|-0.00605|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02158|
|possession-retained|str-continuity-bush-79.00|41028|11 / 0.0917|0.02598|-0.00607|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02157|
|possession-retained|str-continuity-bush-79.00|41027|11 / 0.0917|0.02598|-0.00607|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02157|
|possession-retained|str-continuity-henderson-82.00|41028|11 / 0.0917|0.03166|-0.00548|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02341|
|possession-retained|str-continuity-henderson-82.00|41027|11 / 0.0917|0.03166|-0.00548|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02341|
|possession-retained|str-continuity-henderson-81.50|41028|11 / 0.0917|0.03297|-0.00551|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02297|
|possession-retained|str-continuity-henderson-81.50|41027|11 / 0.0917|0.03297|-0.00551|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02297|
|possession-retained|str-continuity-henderson-81.25|41028|11 / 0.0917|0.02644|-0.00553|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02151|
|possession-retained|str-continuity-henderson-81.25|41027|11 / 0.0917|0.02644|-0.00553|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02151|
|possession-retained|str-continuity-henderson-81.00|41028|11 / 0.0917|0.03278|-0.00555|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02311|
|possession-retained|str-continuity-henderson-81.00|41027|11 / 0.0917|0.03278|-0.00555|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02311|
|possession-retained|str-continuity-henderson-80.90|41028|11 / 0.0917|0.02637|-0.00556|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02142|
|possession-retained|str-continuity-henderson-80.90|41027|11 / 0.0917|0.02637|-0.00556|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02142|
|possession-retained|str-continuity-henderson-80.80|41028|11 / 0.0917|0.03109|-0.00556|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02337|
|possession-retained|str-continuity-henderson-80.80|41027|11 / 0.0917|0.03109|-0.00556|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02337|
|possession-retained|str-continuity-henderson-80.70|41028|11 / 0.0917|0.02981|-0.00557|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02235|
|possession-retained|str-continuity-henderson-80.70|41027|11 / 0.0917|0.02981|-0.00557|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02235|
|possession-retained|str-continuity-henderson-80.60|41028|11 / 0.0917|0.03063|-0.00558|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02339|
|possession-retained|str-continuity-henderson-80.60|41027|11 / 0.0917|0.03063|-0.00558|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02339|
|possession-retained|str-continuity-henderson-80.50|41028|11 / 0.0917|0.02762|-0.00558|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02171|
|possession-retained|str-continuity-henderson-80.50|41027|11 / 0.0917|0.02762|-0.00558|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02171|
|possession-retained|str-continuity-henderson-80.40|41028|11 / 0.0917|0.02977|-0.00559|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02272|
|possession-retained|str-continuity-henderson-80.40|41027|11 / 0.0917|0.02977|-0.00559|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02272|
|possession-retained|str-continuity-henderson-80.30|41028|11 / 0.0917|0.02992|-0.00560|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02286|
|possession-retained|str-continuity-henderson-80.30|41027|11 / 0.0917|0.02992|-0.00560|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02286|
|possession-retained|str-continuity-henderson-80.20|41028|11 / 0.0917|0.03063|-0.00560|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02318|
|possession-retained|str-continuity-henderson-80.20|41027|11 / 0.0917|0.03063|-0.00560|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02318|
|possession-retained|str-continuity-henderson-80.10|41028|11 / 0.0917|0.02967|-0.00561|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02350|
|possession-retained|str-continuity-henderson-80.10|41027|11 / 0.0917|0.02967|-0.00561|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02350|
|possession-retained|str-continuity-henderson-80.00|41028|11 / 0.0917|0.03105|-0.00562|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02338|
|possession-retained|str-continuity-henderson-80.00|41027|11 / 0.0917|0.03105|-0.00562|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02338|
|possession-retained|str-continuity-henderson-79.75|41028|11 / 0.0917|0.02739|-0.00564|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02142|
|possession-retained|str-continuity-henderson-79.75|41027|11 / 0.0917|0.02739|-0.00564|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02142|
|possession-retained|str-continuity-henderson-79.50|41028|11 / 0.0917|0.03181|-0.00565|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02299|
|possession-retained|str-continuity-henderson-79.50|41027|11 / 0.0917|0.03181|-0.00565|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02299|
|possession-retained|str-continuity-henderson-79.00|41028|11 / 0.0917|0.03098|-0.00569|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02338|
|possession-retained|str-continuity-henderson-79.00|41027|11 / 0.0917|0.03098|-0.00569|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02338|
|gang-staggered-three|madden-pair-combined|41028|21 / 0.1750|0.02690|0.00816|geometry/contact-boundary mismatch: Jolt reports contact while both analytic proxy gaps are positive|0.00493|
|gang-staggered-three|madden-pair-combined|41027|21 / 0.1750|0.02690|0.00816|geometry/contact-boundary mismatch: Jolt reports contact while both analytic proxy gaps are positive|0.00493|
|grip-escape-one-held|madden-pair-combined|41028|25 / 0.2083|-0.00793|-0.00864|Rapier proxy overlap without Rapier contact: candidate contact-boundary/detection discrepancy|0.01003|
|grip-escape-one-held|madden-pair-combined|41027|25 / 0.2083|-0.00793|-0.00864|Rapier proxy overlap without Rapier contact: candidate contact-boundary/detection discrepancy|0.01003|
|possession-retained|madden-pair-combined|41028|11 / 0.0917|0.03072|-0.00626|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02350|
|possession-retained|madden-pair-combined|41027|11 / 0.0917|0.03072|-0.00626|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02350|
|gang-staggered-three|str-both-after-individual|41028|21 / 0.1750|0.02239|0.00799|geometry/contact-boundary mismatch: Jolt reports contact while both analytic proxy gaps are positive|0.00373|
|gang-staggered-three|str-both-after-individual|41027|21 / 0.1750|0.02239|0.00799|geometry/contact-boundary mismatch: Jolt reports contact while both analytic proxy gaps are positive|0.00373|
|grip-escape-one-held|str-both-after-individual|41028|25 / 0.2083|-0.00838|-0.00881|Rapier proxy overlap without Rapier contact: candidate contact-boundary/detection discrepancy|0.01013|
|grip-escape-one-held|str-both-after-individual|41027|25 / 0.2083|-0.00838|-0.00881|Rapier proxy overlap without Rapier contact: candidate contact-boundary/detection discrepancy|0.01013|
|possession-retained|str-both-after-individual|41028|11 / 0.0917|0.02797|-0.00710|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02242|
|possession-retained|str-both-after-individual|41027|11 / 0.0917|0.02797|-0.00710|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02242|
|gang-staggered-three|mass-both-after-individual|41028|21 / 0.1750|0.02799|0.00962|geometry/contact-boundary mismatch: Jolt reports contact while both analytic proxy gaps are positive|0.00481|
|gang-staggered-three|mass-both-after-individual|41027|21 / 0.1750|0.02799|0.00962|geometry/contact-boundary mismatch: Jolt reports contact while both analytic proxy gaps are positive|0.00481|
|grip-escape-one-held|mass-both-after-individual|41028|25 / 0.2083|-0.00365|-0.00371|Rapier proxy overlap without Rapier contact: candidate contact-boundary/detection discrepancy|0.00920|
|grip-escape-one-held|mass-both-after-individual|41027|25 / 0.2083|-0.00365|-0.00371|Rapier proxy overlap without Rapier contact: candidate contact-boundary/detection discrepancy|0.00920|
|possession-retained|mass-both-after-individual|41028|11 / 0.0917|0.02809|-0.00540|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02165|
|possession-retained|mass-both-after-individual|41027|11 / 0.0917|0.02809|-0.00540|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02165|
|gang-staggered-three|str-bush-only|41028|21 / 0.1750|0.02200|0.00825|geometry/contact-boundary mismatch: Jolt reports contact while both analytic proxy gaps are positive|0.00351|
|gang-staggered-three|str-bush-only|41027|21 / 0.1750|0.02200|0.00825|geometry/contact-boundary mismatch: Jolt reports contact while both analytic proxy gaps are positive|0.00351|
|gang-staggered-three|str-henderson-only|41028|21 / 0.1750|0.02519|0.00917|geometry/contact-boundary mismatch: Jolt reports contact while both analytic proxy gaps are positive|0.00428|
|gang-staggered-three|str-henderson-only|41027|21 / 0.1750|0.02519|0.00917|geometry/contact-boundary mismatch: Jolt reports contact while both analytic proxy gaps are positive|0.00428|
|grip-escape-one-held|str-bush-only|41028|25 / 0.2083|-0.00478|-0.00492|Rapier proxy overlap without Rapier contact: candidate contact-boundary/detection discrepancy|0.01016|
|grip-escape-one-held|str-bush-only|41027|25 / 0.2083|-0.00478|-0.00492|Rapier proxy overlap without Rapier contact: candidate contact-boundary/detection discrepancy|0.01016|
|grip-escape-one-held|str-henderson-only|41028|25 / 0.2083|-0.00765|-0.00773|Rapier proxy overlap without Rapier contact: candidate contact-boundary/detection discrepancy|0.00925|
|grip-escape-one-held|str-henderson-only|41027|25 / 0.2083|-0.00765|-0.00773|Rapier proxy overlap without Rapier contact: candidate contact-boundary/detection discrepancy|0.00925|
|possession-retained|str-bush-only|41028|11 / 0.0917|0.02539|-0.00649|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02152|
|possession-retained|str-bush-only|41027|11 / 0.0917|0.02539|-0.00649|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02152|
|possession-retained|str-henderson-only|41028|11 / 0.0917|0.02419|-0.00688|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02098|
|possession-retained|str-henderson-only|41027|11 / 0.0917|0.02419|-0.00688|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02098|
|gang-staggered-three|mass-bush-only|41028|21 / 0.1750|0.02659|0.00944|geometry/contact-boundary mismatch: Jolt reports contact while both analytic proxy gaps are positive|0.00463|
|gang-staggered-three|mass-bush-only|41027|21 / 0.1750|0.02659|0.00944|geometry/contact-boundary mismatch: Jolt reports contact while both analytic proxy gaps are positive|0.00463|
|gang-staggered-three|mass-henderson-only|41028|21 / 0.1750|0.02799|0.00962|geometry/contact-boundary mismatch: Jolt reports contact while both analytic proxy gaps are positive|0.00481|
|gang-staggered-three|mass-henderson-only|41027|21 / 0.1750|0.02799|0.00962|geometry/contact-boundary mismatch: Jolt reports contact while both analytic proxy gaps are positive|0.00481|
|grip-escape-one-held|mass-bush-only|41028|25 / 0.2083|-0.00404|-0.00382|Rapier proxy overlap without Rapier contact: candidate contact-boundary/detection discrepancy|0.00929|
|grip-escape-one-held|mass-bush-only|41027|25 / 0.2083|-0.00404|-0.00382|Rapier proxy overlap without Rapier contact: candidate contact-boundary/detection discrepancy|0.00929|
|grip-escape-one-held|mass-henderson-only|41028|25 / 0.2083|-0.00365|-0.00371|Rapier proxy overlap without Rapier contact: candidate contact-boundary/detection discrepancy|0.00920|
|grip-escape-one-held|mass-henderson-only|41027|25 / 0.2083|-0.00365|-0.00371|Rapier proxy overlap without Rapier contact: candidate contact-boundary/detection discrepancy|0.00920|
|possession-retained|mass-bush-only|41028|11 / 0.0917|0.02537|-0.00627|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02120|
|possession-retained|mass-bush-only|41027|11 / 0.0917|0.02537|-0.00627|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02120|
|possession-retained|mass-henderson-only|41028|11 / 0.0917|0.02809|-0.00540|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02165|
|possession-retained|mass-henderson-only|41027|11 / 0.0917|0.02809|-0.00540|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02165|
|gang-staggered-three|m4c-neutral|41028|21 / 0.1750|0.02659|0.00944|geometry/contact-boundary mismatch: Jolt reports contact while both analytic proxy gaps are positive|0.00463|
|gang-staggered-three|m4c-neutral|41027|21 / 0.1750|0.02659|0.00944|geometry/contact-boundary mismatch: Jolt reports contact while both analytic proxy gaps are positive|0.00463|
|grip-escape-one-held|m4c-neutral|41028|25 / 0.2083|-0.00404|-0.00382|Rapier proxy overlap without Rapier contact: candidate contact-boundary/detection discrepancy|0.00929|
|grip-escape-one-held|m4c-neutral|41027|25 / 0.2083|-0.00404|-0.00382|Rapier proxy overlap without Rapier contact: candidate contact-boundary/detection discrepancy|0.00929|
|possession-retained|m4c-neutral|41028|11 / 0.0917|0.02537|-0.00627|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02120|
|possession-retained|m4c-neutral|41027|11 / 0.0917|0.02537|-0.00627|trajectory-mediated: Jolt analytic proxy crossed into overlap while Rapier remained separated|0.02120|
## Full failure ledger

- possession-retained__m4c-neutral__rapier3d-compat__seed41027: p95 penetration 0.09454275667667389 m > 0.05 m; weighted mean penetration 0.0480588460470447 m > 0.025 m
- possession-retained__m4c-neutral__jolt-physics-js__seed41027: p95 penetration 0.05500793531537056 m > 0.05 m
- possession-retained__m4c-neutral__rapier3d-compat__seed41028: p95 penetration 0.09454275667667389 m > 0.05 m; weighted mean penetration 0.0480588460470447 m > 0.025 m
- possession-retained__m4c-neutral__jolt-physics-js__seed41028: p95 penetration 0.05500793531537056 m > 0.05 m
- possession-retained__mass-henderson-only__rapier3d-compat__seed41027: p95 penetration 0.10330207422375676 m > 0.05 m; weighted mean penetration 0.05767135751537134 m > 0.025 m
- possession-retained__mass-henderson-only__jolt-physics-js__seed41027: p95 penetration 0.05519604720175266 m > 0.05 m
- possession-retained__mass-henderson-only__rapier3d-compat__seed41028: p95 penetration 0.10330207422375676 m > 0.05 m; weighted mean penetration 0.05767135751537134 m > 0.025 m
- possession-retained__mass-henderson-only__jolt-physics-js__seed41028: p95 penetration 0.05519604720175266 m > 0.05 m
- possession-retained__mass-bush-only__rapier3d-compat__seed41027: p95 penetration 0.09454275667667389 m > 0.05 m; weighted mean penetration 0.0480588460470447 m > 0.025 m
- possession-retained__mass-bush-only__jolt-physics-js__seed41027: p95 penetration 0.05500793531537056 m > 0.05 m
- possession-retained__mass-bush-only__rapier3d-compat__seed41028: p95 penetration 0.09454275667667389 m > 0.05 m; weighted mean penetration 0.0480588460470447 m > 0.025 m
- possession-retained__mass-bush-only__jolt-physics-js__seed41028: p95 penetration 0.05500793531537056 m > 0.05 m
- possession-retained__str-henderson-only__rapier3d-compat__seed41027: p95 penetration 0.10251477360725403 m > 0.05 m; weighted mean penetration 0.051797370930823164 m > 0.025 m
- possession-retained__str-henderson-only__jolt-physics-js__seed41027: p95 penetration 0.05509436503052711 m > 0.05 m
- possession-retained__str-henderson-only__rapier3d-compat__seed41028: p95 penetration 0.10251477360725403 m > 0.05 m; weighted mean penetration 0.051797370930823164 m > 0.025 m
- possession-retained__str-henderson-only__jolt-physics-js__seed41028: p95 penetration 0.05509436503052711 m > 0.05 m
- possession-retained__str-bush-only__rapier3d-compat__seed41027: p95 penetration 0.10106754153966901 m > 0.05 m; weighted mean penetration 0.05368058476597079 m > 0.025 m
- possession-retained__str-bush-only__jolt-physics-js__seed41027: p95 penetration 0.05501662641763687 m > 0.05 m
- possession-retained__str-bush-only__rapier3d-compat__seed41028: p95 penetration 0.10106754153966901 m > 0.05 m; weighted mean penetration 0.05368058476597079 m > 0.025 m
- possession-retained__str-bush-only__jolt-physics-js__seed41028: p95 penetration 0.05501662641763687 m > 0.05 m
- possession-retained__mass-both-after-individual__rapier3d-compat__seed41027: p95 penetration 0.10330207422375676 m > 0.05 m; weighted mean penetration 0.05767135751537134 m > 0.025 m
- possession-retained__mass-both-after-individual__jolt-physics-js__seed41027: p95 penetration 0.05519604720175266 m > 0.05 m
- possession-retained__mass-both-after-individual__rapier3d-compat__seed41028: p95 penetration 0.10330207422375676 m > 0.05 m; weighted mean penetration 0.05767135751537134 m > 0.025 m
- possession-retained__mass-both-after-individual__jolt-physics-js__seed41028: p95 penetration 0.05519604720175266 m > 0.05 m
- possession-retained__str-both-after-individual__rapier3d-compat__seed41027: p95 penetration 0.08729577288031556 m > 0.05 m; weighted mean penetration 0.05054885211090244 m > 0.025 m
- possession-retained__str-both-after-individual__jolt-physics-js__seed41027: p95 penetration 0.055103314667940134 m > 0.05 m
- possession-retained__str-both-after-individual__rapier3d-compat__seed41028: p95 penetration 0.08729577288031556 m > 0.05 m; weighted mean penetration 0.05054885211090244 m > 0.025 m
- possession-retained__str-both-after-individual__jolt-physics-js__seed41028: p95 penetration 0.055103314667940134 m > 0.05 m
- possession-retained__madden-pair-combined__rapier3d-compat__seed41027: p95 penetration 0.0978817492723465 m > 0.05 m; weighted mean penetration 0.04854082310986198 m > 0.025 m
- possession-retained__madden-pair-combined__jolt-physics-js__seed41027: p95 penetration 0.05529150739312171 m > 0.05 m
- possession-retained__madden-pair-combined__rapier3d-compat__seed41028: p95 penetration 0.0978817492723465 m > 0.05 m; weighted mean penetration 0.04854082310986198 m > 0.025 m
- possession-retained__madden-pair-combined__jolt-physics-js__seed41028: p95 penetration 0.05529150739312171 m > 0.05 m
- possession-retained__str-continuity-henderson-79.00__rapier3d-compat__seed41027: p95 penetration 0.10197910666465759 m > 0.05 m; weighted mean penetration 0.03340773951883101 m > 0.025 m; registered retained-possession outcome requires physical contact and maintained controlled cradle
- possession-retained__str-continuity-henderson-79.00__jolt-physics-js__seed41027: p95 penetration 0.05521597526967525 m > 0.05 m
- possession-retained__str-continuity-henderson-79.00__rapier3d-compat__seed41028: p95 penetration 0.10197910666465759 m > 0.05 m; weighted mean penetration 0.03340773951883101 m > 0.025 m; registered retained-possession outcome requires physical contact and maintained controlled cradle
- possession-retained__str-continuity-henderson-79.00__jolt-physics-js__seed41028: p95 penetration 0.05521597526967525 m > 0.05 m
- possession-retained__str-continuity-henderson-79.50__rapier3d-compat__seed41027: p95 penetration 0.08484360575675964 m > 0.05 m; weighted mean penetration 0.05089626564747757 m > 0.025 m
- possession-retained__str-continuity-henderson-79.50__jolt-physics-js__seed41027: p95 penetration 0.05521053150296211 m > 0.05 m
- possession-retained__str-continuity-henderson-79.50__rapier3d-compat__seed41028: p95 penetration 0.08484360575675964 m > 0.05 m; weighted mean penetration 0.05089626564747757 m > 0.025 m
- possession-retained__str-continuity-henderson-79.50__jolt-physics-js__seed41028: p95 penetration 0.05521053150296211 m > 0.05 m
- possession-retained__str-continuity-henderson-79.75__rapier3d-compat__seed41027: p95 penetration 0.100368931889534 m > 0.05 m; weighted mean penetration 0.04886662240864501 m > 0.025 m
- possession-retained__str-continuity-henderson-79.75__jolt-physics-js__seed41027: p95 penetration 0.055208996310830115 m > 0.05 m
- possession-retained__str-continuity-henderson-79.75__rapier3d-compat__seed41028: p95 penetration 0.100368931889534 m > 0.05 m; weighted mean penetration 0.04886662240864501 m > 0.025 m
- possession-retained__str-continuity-henderson-79.75__jolt-physics-js__seed41028: p95 penetration 0.055208996310830115 m > 0.05 m
- possession-retained__str-continuity-henderson-80.00__rapier3d-compat__seed41027: p95 penetration 0.09765000641345978 m > 0.05 m; weighted mean penetration 0.03565921272254651 m > 0.025 m; registered retained-possession outcome requires physical contact and maintained controlled cradle
- possession-retained__str-continuity-henderson-80.00__jolt-physics-js__seed41027: p95 penetration 0.055206782743334765 m > 0.05 m
- possession-retained__str-continuity-henderson-80.00__rapier3d-compat__seed41028: p95 penetration 0.09765000641345978 m > 0.05 m; weighted mean penetration 0.03565921272254651 m > 0.025 m; registered retained-possession outcome requires physical contact and maintained controlled cradle
- possession-retained__str-continuity-henderson-80.00__jolt-physics-js__seed41028: p95 penetration 0.055206782743334765 m > 0.05 m
- possession-retained__str-continuity-henderson-80.10__rapier3d-compat__seed41027: p95 penetration 0.10461489856243134 m > 0.05 m; weighted mean penetration 0.05175194371905594 m > 0.025 m
- possession-retained__str-continuity-henderson-80.10__jolt-physics-js__seed41027: p95 penetration 0.055205546319484704 m > 0.05 m
- possession-retained__str-continuity-henderson-80.10__rapier3d-compat__seed41028: p95 penetration 0.10461489856243134 m > 0.05 m; weighted mean penetration 0.05175194371905594 m > 0.025 m
- possession-retained__str-continuity-henderson-80.10__jolt-physics-js__seed41028: p95 penetration 0.055205546319484704 m > 0.05 m
- possession-retained__str-continuity-henderson-80.20__rapier3d-compat__seed41027: p95 penetration 0.1003919392824173 m > 0.05 m; weighted mean penetration 0.03677916790669133 m > 0.025 m; registered retained-possession outcome requires physical contact and maintained controlled cradle
- possession-retained__str-continuity-henderson-80.20__jolt-physics-js__seed41027: p95 penetration 0.055204309150576586 m > 0.05 m
- possession-retained__str-continuity-henderson-80.20__rapier3d-compat__seed41028: p95 penetration 0.1003919392824173 m > 0.05 m; weighted mean penetration 0.03677916790669133 m > 0.025 m; registered retained-possession outcome requires physical contact and maintained controlled cradle
- possession-retained__str-continuity-henderson-80.20__jolt-physics-js__seed41028: p95 penetration 0.055204309150576586 m > 0.05 m
- possession-retained__str-continuity-henderson-80.30__rapier3d-compat__seed41027: p95 penetration 0.10070723295211792 m > 0.05 m; weighted mean penetration 0.03572309984722088 m > 0.025 m; registered retained-possession outcome requires physical contact and maintained controlled cradle
- possession-retained__str-continuity-henderson-80.30__jolt-physics-js__seed41027: p95 penetration 0.055203615874052044 m > 0.05 m
- possession-retained__str-continuity-henderson-80.30__rapier3d-compat__seed41028: p95 penetration 0.10070723295211792 m > 0.05 m; weighted mean penetration 0.03572309984722088 m > 0.025 m; registered retained-possession outcome requires physical contact and maintained controlled cradle
- possession-retained__str-continuity-henderson-80.30__jolt-physics-js__seed41028: p95 penetration 0.055203615874052044 m > 0.05 m
- possession-retained__str-continuity-henderson-80.40__rapier3d-compat__seed41027: p95 penetration 0.09555764496326447 m > 0.05 m; weighted mean penetration 0.037109955058743406 m > 0.025 m; registered retained-possession outcome requires physical contact and maintained controlled cradle
- possession-retained__str-continuity-henderson-80.40__jolt-physics-js__seed41027: p95 penetration 0.05520248897373676 m > 0.05 m
- possession-retained__str-continuity-henderson-80.40__rapier3d-compat__seed41028: p95 penetration 0.09555764496326447 m > 0.05 m; weighted mean penetration 0.037109955058743406 m > 0.025 m; registered retained-possession outcome requires physical contact and maintained controlled cradle
- possession-retained__str-continuity-henderson-80.40__jolt-physics-js__seed41028: p95 penetration 0.05520248897373676 m > 0.05 m
- possession-retained__str-continuity-henderson-80.50__rapier3d-compat__seed41027: p95 penetration 0.1011592447757721 m > 0.05 m; weighted mean penetration 0.05349057690343908 m > 0.025 m
- possession-retained__str-continuity-henderson-80.50__jolt-physics-js__seed41027: p95 penetration 0.055201487988233565 m > 0.05 m
- possession-retained__str-continuity-henderson-80.50__rapier3d-compat__seed41028: p95 penetration 0.1011592447757721 m > 0.05 m; weighted mean penetration 0.05349057690343908 m > 0.025 m
- possession-retained__str-continuity-henderson-80.50__jolt-physics-js__seed41028: p95 penetration 0.055201487988233565 m > 0.05 m
- possession-retained__str-continuity-henderson-80.60__rapier3d-compat__seed41027: p95 penetration 0.11610566452145533 m > 0.05 m; weighted mean penetration 0.03467381973282765 m > 0.025 m; registered retained-possession outcome requires physical contact and maintained controlled cradle
- possession-retained__str-continuity-henderson-80.60__jolt-physics-js__seed41027: p95 penetration 0.05520082302391529 m > 0.05 m
- possession-retained__str-continuity-henderson-80.60__rapier3d-compat__seed41028: p95 penetration 0.11610566452145533 m > 0.05 m; weighted mean penetration 0.03467381973282765 m > 0.025 m; registered retained-possession outcome requires physical contact and maintained controlled cradle
- possession-retained__str-continuity-henderson-80.60__jolt-physics-js__seed41028: p95 penetration 0.05520082302391529 m > 0.05 m
- possession-retained__str-continuity-henderson-80.70__rapier3d-compat__seed41027: p95 penetration 0.10271915793418884 m > 0.05 m; weighted mean penetration 0.03908897196460084 m > 0.025 m; registered retained-possession outcome requires physical contact and maintained controlled cradle
- possession-retained__str-continuity-henderson-80.70__jolt-physics-js__seed41027: p95 penetration 0.055199203640222544 m > 0.05 m
- possession-retained__str-continuity-henderson-80.70__rapier3d-compat__seed41028: p95 penetration 0.10271915793418884 m > 0.05 m; weighted mean penetration 0.03908897196460084 m > 0.025 m; registered retained-possession outcome requires physical contact and maintained controlled cradle
- possession-retained__str-continuity-henderson-80.70__jolt-physics-js__seed41028: p95 penetration 0.055199203640222544 m > 0.05 m
- possession-retained__str-continuity-henderson-80.80__rapier3d-compat__seed41027: p95 penetration 0.09763228893280029 m > 0.05 m; weighted mean penetration 0.034654740606330926 m > 0.025 m; registered retained-possession outcome requires physical contact and maintained controlled cradle
- possession-retained__str-continuity-henderson-80.80__jolt-physics-js__seed41027: p95 penetration 0.055198850482702254 m > 0.05 m
- possession-retained__str-continuity-henderson-80.80__rapier3d-compat__seed41028: p95 penetration 0.09763228893280029 m > 0.05 m; weighted mean penetration 0.034654740606330926 m > 0.025 m; registered retained-possession outcome requires physical contact and maintained controlled cradle
- possession-retained__str-continuity-henderson-80.80__jolt-physics-js__seed41028: p95 penetration 0.055198850482702254 m > 0.05 m
- possession-retained__str-continuity-henderson-80.90__rapier3d-compat__seed41027: p95 penetration 0.1085263192653656 m > 0.05 m; weighted mean penetration 0.03918344884489993 m > 0.025 m; registered retained-possession outcome requires physical contact and maintained controlled cradle
- possession-retained__str-continuity-henderson-80.90__jolt-physics-js__seed41027: p95 penetration 0.05519817993044853 m > 0.05 m
- possession-retained__str-continuity-henderson-80.90__rapier3d-compat__seed41028: p95 penetration 0.1085263192653656 m > 0.05 m; weighted mean penetration 0.03918344884489993 m > 0.025 m; registered retained-possession outcome requires physical contact and maintained controlled cradle
- possession-retained__str-continuity-henderson-80.90__jolt-physics-js__seed41028: p95 penetration 0.05519817993044853 m > 0.05 m
- possession-retained__str-continuity-henderson-81.00__rapier3d-compat__seed41027: p95 penetration 0.08416719734668732 m > 0.05 m; weighted mean penetration 0.04911212654163433 m > 0.025 m
- possession-retained__str-continuity-henderson-81.00__jolt-physics-js__seed41027: p95 penetration 0.05519628636538982 m > 0.05 m
- possession-retained__str-continuity-henderson-81.00__rapier3d-compat__seed41028: p95 penetration 0.08416719734668732 m > 0.05 m; weighted mean penetration 0.04911212654163433 m > 0.025 m
- possession-retained__str-continuity-henderson-81.00__jolt-physics-js__seed41028: p95 penetration 0.05519628636538982 m > 0.05 m
- possession-retained__str-continuity-henderson-81.25__rapier3d-compat__seed41027: p95 penetration 0.11319781839847565 m > 0.05 m; weighted mean penetration 0.056639143731444984 m > 0.025 m
- possession-retained__str-continuity-henderson-81.25__jolt-physics-js__seed41027: p95 penetration 0.0551938958466053 m > 0.05 m
- possession-retained__str-continuity-henderson-81.25__rapier3d-compat__seed41028: p95 penetration 0.11319781839847565 m > 0.05 m; weighted mean penetration 0.056639143731444984 m > 0.025 m
- possession-retained__str-continuity-henderson-81.25__jolt-physics-js__seed41028: p95 penetration 0.0551938958466053 m > 0.05 m
- possession-retained__str-continuity-henderson-81.50__rapier3d-compat__seed41027: p95 penetration 0.0864521712064743 m > 0.05 m; weighted mean penetration 0.04869112522444802 m > 0.025 m
- possession-retained__str-continuity-henderson-81.50__jolt-physics-js__seed41027: p95 penetration 0.05519224181771278 m > 0.05 m
- possession-retained__str-continuity-henderson-81.50__rapier3d-compat__seed41028: p95 penetration 0.0864521712064743 m > 0.05 m; weighted mean penetration 0.04869112522444802 m > 0.025 m
- possession-retained__str-continuity-henderson-81.50__jolt-physics-js__seed41028: p95 penetration 0.05519224181771278 m > 0.05 m
- possession-retained__str-continuity-henderson-82.00__rapier3d-compat__seed41027: p95 penetration 0.08600620925426483 m > 0.05 m; weighted mean penetration 0.04825296547884757 m > 0.025 m
- possession-retained__str-continuity-henderson-82.00__jolt-physics-js__seed41027: p95 penetration 0.05518695153295993 m > 0.05 m
- possession-retained__str-continuity-henderson-82.00__rapier3d-compat__seed41028: p95 penetration 0.08600620925426483 m > 0.05 m; weighted mean penetration 0.04825296547884757 m > 0.025 m
- possession-retained__str-continuity-henderson-82.00__jolt-physics-js__seed41028: p95 penetration 0.05518695153295993 m > 0.05 m
- possession-retained__str-continuity-bush-79.00__rapier3d-compat__seed41027: p95 penetration 0.11106991767883301 m > 0.05 m; weighted mean penetration 0.05967374642690039 m > 0.025 m
- possession-retained__str-continuity-bush-79.00__jolt-physics-js__seed41027: p95 penetration 0.05528379343450069 m > 0.05 m
- possession-retained__str-continuity-bush-79.00__rapier3d-compat__seed41028: p95 penetration 0.11106991767883301 m > 0.05 m; weighted mean penetration 0.05967374642690039 m > 0.025 m
- possession-retained__str-continuity-bush-79.00__jolt-physics-js__seed41028: p95 penetration 0.05528379343450069 m > 0.05 m
- possession-retained__str-continuity-bush-79.50__rapier3d-compat__seed41027: p95 penetration 0.11185571551322937 m > 0.05 m; weighted mean penetration 0.05412278815896974 m > 0.025 m
- possession-retained__str-continuity-bush-79.50__jolt-physics-js__seed41027: p95 penetration 0.05528211258351803 m > 0.05 m
- possession-retained__str-continuity-bush-79.50__rapier3d-compat__seed41028: p95 penetration 0.11185571551322937 m > 0.05 m; weighted mean penetration 0.05412278815896974 m > 0.025 m
- possession-retained__str-continuity-bush-79.50__jolt-physics-js__seed41028: p95 penetration 0.05528211258351803 m > 0.05 m
- possession-retained__str-continuity-bush-79.75__rapier3d-compat__seed41027: p95 penetration 0.08354122936725616 m > 0.05 m; weighted mean penetration 0.04906658760996322 m > 0.025 m
- possession-retained__str-continuity-bush-79.75__jolt-physics-js__seed41027: p95 penetration 0.05528279356658458 m > 0.05 m
- possession-retained__str-continuity-bush-79.75__rapier3d-compat__seed41028: p95 penetration 0.08354122936725616 m > 0.05 m; weighted mean penetration 0.04906658760996322 m > 0.025 m
- possession-retained__str-continuity-bush-79.75__jolt-physics-js__seed41028: p95 penetration 0.05528279356658458 m > 0.05 m
- possession-retained__str-continuity-bush-80.00__rapier3d-compat__seed41027: p95 penetration 0.11175374686717987 m > 0.05 m; weighted mean penetration 0.061060561850253076 m > 0.025 m
- possession-retained__str-continuity-bush-80.00__jolt-physics-js__seed41027: p95 penetration 0.05528124682605266 m > 0.05 m
- possession-retained__str-continuity-bush-80.00__rapier3d-compat__seed41028: p95 penetration 0.11175374686717987 m > 0.05 m; weighted mean penetration 0.061060561850253076 m > 0.025 m
- possession-retained__str-continuity-bush-80.00__jolt-physics-js__seed41028: p95 penetration 0.05528124682605266 m > 0.05 m
- possession-retained__str-continuity-bush-80.10__rapier3d-compat__seed41027: p95 penetration 0.10251873731613159 m > 0.05 m; weighted mean penetration 0.049796282572464955 m > 0.025 m
- possession-retained__str-continuity-bush-80.10__jolt-physics-js__seed41027: p95 penetration 0.05528182983398437 m > 0.05 m
- possession-retained__str-continuity-bush-80.10__rapier3d-compat__seed41028: p95 penetration 0.10251873731613159 m > 0.05 m; weighted mean penetration 0.049796282572464955 m > 0.025 m
- possession-retained__str-continuity-bush-80.10__jolt-physics-js__seed41028: p95 penetration 0.05528182983398437 m > 0.05 m
- possession-retained__str-continuity-bush-80.20__rapier3d-compat__seed41027: p95 penetration 0.08131676912307739 m > 0.05 m; weighted mean penetration 0.03485775961437148 m > 0.025 m; registered retained-possession outcome requires physical contact and maintained controlled cradle
- possession-retained__str-continuity-bush-80.20__jolt-physics-js__seed41027: p95 penetration 0.05528194420039653 m > 0.05 m
- possession-retained__str-continuity-bush-80.20__rapier3d-compat__seed41028: p95 penetration 0.08131676912307739 m > 0.05 m; weighted mean penetration 0.03485775961437148 m > 0.025 m; registered retained-possession outcome requires physical contact and maintained controlled cradle
- possession-retained__str-continuity-bush-80.20__jolt-physics-js__seed41028: p95 penetration 0.05528194420039653 m > 0.05 m
- possession-retained__str-continuity-bush-80.30__rapier3d-compat__seed41027: p95 penetration 0.08144082129001617 m > 0.05 m; weighted mean penetration 0.032808684536980603 m > 0.025 m; registered retained-possession outcome requires physical contact and maintained controlled cradle
- possession-retained__str-continuity-bush-80.30__jolt-physics-js__seed41027: p95 penetration 0.05528112277388572 m > 0.05 m
- possession-retained__str-continuity-bush-80.30__rapier3d-compat__seed41028: p95 penetration 0.08144082129001617 m > 0.05 m; weighted mean penetration 0.032808684536980603 m > 0.025 m; registered retained-possession outcome requires physical contact and maintained controlled cradle
- possession-retained__str-continuity-bush-80.30__jolt-physics-js__seed41028: p95 penetration 0.05528112277388572 m > 0.05 m
- possession-retained__str-continuity-bush-80.40__rapier3d-compat__seed41027: p95 penetration 0.11791089177131653 m > 0.05 m; weighted mean penetration 0.039030563189751434 m > 0.025 m; registered retained-possession outcome requires physical contact and maintained controlled cradle
- possession-retained__str-continuity-bush-80.40__jolt-physics-js__seed41027: p95 penetration 0.05528141818940639 m > 0.05 m
- possession-retained__str-continuity-bush-80.40__rapier3d-compat__seed41028: p95 penetration 0.11791089177131653 m > 0.05 m; weighted mean penetration 0.039030563189751434 m > 0.025 m; registered retained-possession outcome requires physical contact and maintained controlled cradle
- possession-retained__str-continuity-bush-80.40__jolt-physics-js__seed41028: p95 penetration 0.05528141818940639 m > 0.05 m
- possession-retained__str-continuity-bush-80.50__rapier3d-compat__seed41027: p95 penetration 0.09907621145248413 m > 0.05 m; weighted mean penetration 0.03511182855193814 m > 0.025 m; registered retained-possession outcome requires physical contact and maintained controlled cradle
- possession-retained__str-continuity-bush-80.50__jolt-physics-js__seed41027: p95 penetration 0.0552817303687334 m > 0.05 m
- possession-retained__str-continuity-bush-80.50__rapier3d-compat__seed41028: p95 penetration 0.09907621145248413 m > 0.05 m; weighted mean penetration 0.03511182855193814 m > 0.025 m; registered retained-possession outcome requires physical contact and maintained controlled cradle
- possession-retained__str-continuity-bush-80.50__jolt-physics-js__seed41028: p95 penetration 0.0552817303687334 m > 0.05 m
- possession-retained__str-continuity-bush-80.60__rapier3d-compat__seed41027: p95 penetration 0.10487135648727401 m > 0.05 m; weighted mean penetration 0.047669976458160394 m > 0.025 m
- possession-retained__str-continuity-bush-80.60__jolt-physics-js__seed41027: p95 penetration 0.055281037464737885 m > 0.05 m
- possession-retained__str-continuity-bush-80.60__rapier3d-compat__seed41028: p95 penetration 0.10487135648727401 m > 0.05 m; weighted mean penetration 0.047669976458160394 m > 0.025 m
- possession-retained__str-continuity-bush-80.60__jolt-physics-js__seed41028: p95 penetration 0.055281037464737885 m > 0.05 m
- possession-retained__str-continuity-bush-80.70__rapier3d-compat__seed41027: p95 penetration 0.08776822686195374 m > 0.05 m; weighted mean penetration 0.048787309529466805 m > 0.025 m
- possession-retained__str-continuity-bush-80.70__jolt-physics-js__seed41027: p95 penetration 0.055280832946300505 m > 0.05 m
- possession-retained__str-continuity-bush-80.70__rapier3d-compat__seed41028: p95 penetration 0.08776822686195374 m > 0.05 m; weighted mean penetration 0.048787309529466805 m > 0.025 m
- possession-retained__str-continuity-bush-80.70__jolt-physics-js__seed41028: p95 penetration 0.055280832946300505 m > 0.05 m
- possession-retained__str-continuity-bush-80.80__rapier3d-compat__seed41027: p95 penetration 0.11046906560659388 m > 0.05 m; weighted mean penetration 0.05109252873808147 m > 0.025 m
- possession-retained__str-continuity-bush-80.80__jolt-physics-js__seed41027: p95 penetration 0.05528083704411983 m > 0.05 m
- possession-retained__str-continuity-bush-80.80__rapier3d-compat__seed41028: p95 penetration 0.11046906560659388 m > 0.05 m; weighted mean penetration 0.05109252873808147 m > 0.025 m
- possession-retained__str-continuity-bush-80.80__jolt-physics-js__seed41028: p95 penetration 0.05528083704411983 m > 0.05 m
- possession-retained__str-continuity-bush-80.90__rapier3d-compat__seed41027: p95 penetration 0.10121808201074588 m > 0.05 m; weighted mean penetration 0.051577707545624935 m > 0.025 m
- possession-retained__str-continuity-bush-80.90__jolt-physics-js__seed41027: p95 penetration 0.05528045259416103 m > 0.05 m
- possession-retained__str-continuity-bush-80.90__rapier3d-compat__seed41028: p95 penetration 0.10121808201074588 m > 0.05 m; weighted mean penetration 0.051577707545624935 m > 0.025 m
- possession-retained__str-continuity-bush-80.90__jolt-physics-js__seed41028: p95 penetration 0.05528045259416103 m > 0.05 m
- possession-retained__str-continuity-bush-81.00__rapier3d-compat__seed41027: p95 penetration 0.07808521389961243 m > 0.05 m; weighted mean penetration 0.03481908747926353 m > 0.025 m; registered retained-possession outcome requires physical contact and maintained controlled cradle
- possession-retained__str-continuity-bush-81.00__jolt-physics-js__seed41027: p95 penetration 0.0552802562713623 m > 0.05 m
- possession-retained__str-continuity-bush-81.00__rapier3d-compat__seed41028: p95 penetration 0.07808521389961243 m > 0.05 m; weighted mean penetration 0.03481908747926353 m > 0.025 m; registered retained-possession outcome requires physical contact and maintained controlled cradle
- possession-retained__str-continuity-bush-81.00__jolt-physics-js__seed41028: p95 penetration 0.0552802562713623 m > 0.05 m
- possession-retained__str-continuity-bush-81.25__rapier3d-compat__seed41027: p95 penetration 0.09795980155467987 m > 0.05 m; weighted mean penetration 0.034847606335662945 m > 0.025 m; registered retained-possession outcome requires physical contact and maintained controlled cradle
- possession-retained__str-continuity-bush-81.25__jolt-physics-js__seed41027: p95 penetration 0.055279547721147536 m > 0.05 m
- possession-retained__str-continuity-bush-81.25__rapier3d-compat__seed41028: p95 penetration 0.09795980155467987 m > 0.05 m; weighted mean penetration 0.034847606335662945 m > 0.025 m; registered retained-possession outcome requires physical contact and maintained controlled cradle
- possession-retained__str-continuity-bush-81.25__jolt-physics-js__seed41028: p95 penetration 0.055279547721147536 m > 0.05 m
- possession-retained__str-continuity-bush-81.50__rapier3d-compat__seed41027: p95 penetration 0.11093677580356598 m > 0.05 m; weighted mean penetration 0.03843934492518529 m > 0.025 m; registered retained-possession outcome requires physical contact and maintained controlled cradle
- possession-retained__str-continuity-bush-81.50__jolt-physics-js__seed41027: p95 penetration 0.05527909621596336 m > 0.05 m
- possession-retained__str-continuity-bush-81.50__rapier3d-compat__seed41028: p95 penetration 0.11093677580356598 m > 0.05 m; weighted mean penetration 0.03843934492518529 m > 0.025 m; registered retained-possession outcome requires physical contact and maintained controlled cradle
- possession-retained__str-continuity-bush-81.50__jolt-physics-js__seed41028: p95 penetration 0.05527909621596336 m > 0.05 m
- possession-retained__str-continuity-bush-82.00__rapier3d-compat__seed41027: p95 penetration 0.08693738281726837 m > 0.05 m; weighted mean penetration 0.049431454493767714 m > 0.025 m
- possession-retained__str-continuity-bush-82.00__jolt-physics-js__seed41027: p95 penetration 0.05527839846909046 m > 0.05 m
- possession-retained__str-continuity-bush-82.00__rapier3d-compat__seed41028: p95 penetration 0.08693738281726837 m > 0.05 m; weighted mean penetration 0.049431454493767714 m > 0.025 m
- possession-retained__str-continuity-bush-82.00__jolt-physics-js__seed41028: p95 penetration 0.05527839846909046 m > 0.05 m
- possession-retained__wrap-capacity-0.50x__rapier3d-compat__seed41027: p95 penetration 0.0978817492723465 m > 0.05 m; weighted mean penetration 0.04854082310986198 m > 0.025 m
- possession-retained__wrap-capacity-0.50x__jolt-physics-js__seed41027: p95 penetration 0.05529150739312171 m > 0.05 m
- possession-retained__wrap-capacity-0.50x__rapier3d-compat__seed41028: p95 penetration 0.0978817492723465 m > 0.05 m; weighted mean penetration 0.04854082310986198 m > 0.025 m
- possession-retained__wrap-capacity-0.50x__jolt-physics-js__seed41028: p95 penetration 0.05529150739312171 m > 0.05 m
- possession-retained__wrap-capacity-0.75x__rapier3d-compat__seed41027: p95 penetration 0.0978817492723465 m > 0.05 m; weighted mean penetration 0.04854082310986198 m > 0.025 m
- possession-retained__wrap-capacity-0.75x__jolt-physics-js__seed41027: p95 penetration 0.05529150739312171 m > 0.05 m
- possession-retained__wrap-capacity-0.75x__rapier3d-compat__seed41028: p95 penetration 0.0978817492723465 m > 0.05 m; weighted mean penetration 0.04854082310986198 m > 0.025 m
- possession-retained__wrap-capacity-0.75x__jolt-physics-js__seed41028: p95 penetration 0.05529150739312171 m > 0.05 m
- possession-retained__wrap-capacity-1.00x__rapier3d-compat__seed41027: p95 penetration 0.0978817492723465 m > 0.05 m; weighted mean penetration 0.04854082310986198 m > 0.025 m
- possession-retained__wrap-capacity-1.00x__jolt-physics-js__seed41027: p95 penetration 0.05529150739312171 m > 0.05 m
- possession-retained__wrap-capacity-1.00x__rapier3d-compat__seed41028: p95 penetration 0.0978817492723465 m > 0.05 m; weighted mean penetration 0.04854082310986198 m > 0.025 m
- possession-retained__wrap-capacity-1.00x__jolt-physics-js__seed41028: p95 penetration 0.05529150739312171 m > 0.05 m
- possession-retained__wrap-capacity-1.25x__rapier3d-compat__seed41027: p95 penetration 0.0978817492723465 m > 0.05 m; weighted mean penetration 0.04854082310986198 m > 0.025 m
- possession-retained__wrap-capacity-1.25x__jolt-physics-js__seed41027: p95 penetration 0.05529150739312171 m > 0.05 m
- possession-retained__wrap-capacity-1.25x__rapier3d-compat__seed41028: p95 penetration 0.0978817492723465 m > 0.05 m; weighted mean penetration 0.04854082310986198 m > 0.025 m
- possession-retained__wrap-capacity-1.25x__jolt-physics-js__seed41028: p95 penetration 0.05529150739312171 m > 0.05 m
- possession-retained__wrap-capacity-1.50x__rapier3d-compat__seed41027: p95 penetration 0.0978817492723465 m > 0.05 m; weighted mean penetration 0.04854082310986198 m > 0.025 m
- possession-retained__wrap-capacity-1.50x__jolt-physics-js__seed41027: p95 penetration 0.05529150739312171 m > 0.05 m
- possession-retained__wrap-capacity-1.50x__rapier3d-compat__seed41028: p95 penetration 0.0978817492723465 m > 0.05 m; weighted mean penetration 0.04854082310986198 m > 0.025 m
- possession-retained__wrap-capacity-1.50x__jolt-physics-js__seed41028: p95 penetration 0.05529150739312171 m > 0.05 m
- possession-retained__tkl-capacity-rating-50-control__rapier3d-compat__seed41027: p95 penetration 0.0978817492723465 m > 0.05 m; weighted mean penetration 0.04854082310986198 m > 0.025 m
- possession-retained__tkl-capacity-rating-50-control__jolt-physics-js__seed41027: p95 penetration 0.05529150739312171 m > 0.05 m
- possession-retained__tkl-capacity-rating-50-control__rapier3d-compat__seed41028: p95 penetration 0.0978817492723465 m > 0.05 m; weighted mean penetration 0.04854082310986198 m > 0.025 m
- possession-retained__tkl-capacity-rating-50-control__jolt-physics-js__seed41028: p95 penetration 0.05529150739312171 m > 0.05 m
- possession-retained__tkl-capacity-hypothesis__rapier3d-compat__seed41027: p95 penetration 0.0978817492723465 m > 0.05 m; weighted mean penetration 0.04854082310986198 m > 0.025 m
- possession-retained__tkl-capacity-hypothesis__jolt-physics-js__seed41027: p95 penetration 0.05529150739312171 m > 0.05 m
- possession-retained__tkl-capacity-hypothesis__rapier3d-compat__seed41028: p95 penetration 0.0978817492723465 m > 0.05 m; weighted mean penetration 0.04854082310986198 m > 0.025 m
- possession-retained__tkl-capacity-hypothesis__jolt-physics-js__seed41028: p95 penetration 0.05529150739312171 m > 0.05 m
- possession-retained__balance-scale-0.00__rapier3d-compat__seed41027: p95 penetration 0.09055478870868683 m > 0.05 m; weighted mean penetration 0.052365465296639324 m > 0.025 m
- possession-retained__balance-scale-0.00__jolt-physics-js__seed41027: p95 penetration 0.05387386679649352 m > 0.05 m
- possession-retained__balance-scale-0.00__rapier3d-compat__seed41028: p95 penetration 0.09055478870868683 m > 0.05 m; weighted mean penetration 0.052365465296639324 m > 0.025 m
- possession-retained__balance-scale-0.00__jolt-physics-js__seed41028: p95 penetration 0.05387386679649352 m > 0.05 m
- possession-retained__balance-scale-0.20__rapier3d-compat__seed41027: p95 penetration 0.10505612194538116 m > 0.05 m; weighted mean penetration 0.050311573418892086 m > 0.025 m
- possession-retained__balance-scale-0.20__jolt-physics-js__seed41027: p95 penetration 0.05373081639409065 m > 0.05 m
- possession-retained__balance-scale-0.20__rapier3d-compat__seed41028: p95 penetration 0.10505612194538116 m > 0.05 m; weighted mean penetration 0.050311573418892086 m > 0.025 m
- possession-retained__balance-scale-0.20__jolt-physics-js__seed41028: p95 penetration 0.05373081639409065 m > 0.05 m
- possession-retained__balance-scale-0.40__rapier3d-compat__seed41027: p95 penetration 0.10579672455787659 m > 0.05 m; weighted mean penetration 0.048727294126163355 m > 0.025 m
- possession-retained__balance-scale-0.40__jolt-physics-js__seed41027: p95 penetration 0.0557813074439764 m > 0.05 m
- possession-retained__balance-scale-0.40__rapier3d-compat__seed41028: p95 penetration 0.10579672455787659 m > 0.05 m; weighted mean penetration 0.048727294126163355 m > 0.025 m
- possession-retained__balance-scale-0.40__jolt-physics-js__seed41028: p95 penetration 0.0557813074439764 m > 0.05 m
- possession-retained__balance-scale-0.80__rapier3d-compat__seed41027: p95 penetration 0.0978817492723465 m > 0.05 m; weighted mean penetration 0.04854082310986198 m > 0.025 m
- possession-retained__balance-scale-0.80__jolt-physics-js__seed41027: p95 penetration 0.05529150739312171 m > 0.05 m
- possession-retained__balance-scale-0.80__rapier3d-compat__seed41028: p95 penetration 0.0978817492723465 m > 0.05 m; weighted mean penetration 0.04854082310986198 m > 0.025 m
- possession-retained__balance-scale-0.80__jolt-physics-js__seed41028: p95 penetration 0.05529150739312171 m > 0.05 m
- possession-retained__balance-scale-1.20__rapier3d-compat__seed41027: p95 penetration 0.0980679988861084 m > 0.05 m; weighted mean penetration 0.03759009918818882 m > 0.025 m; registered retained-possession outcome requires physical contact and maintained controlled cradle
- possession-retained__balance-scale-1.20__jolt-physics-js__seed41027: p95 penetration 0.05466173440217972 m > 0.05 m
- possession-retained__balance-scale-1.20__rapier3d-compat__seed41028: p95 penetration 0.0980679988861084 m > 0.05 m; weighted mean penetration 0.03759009918818882 m > 0.025 m; registered retained-possession outcome requires physical contact and maintained controlled cradle
- possession-retained__balance-scale-1.20__jolt-physics-js__seed41028: p95 penetration 0.05466173440217972 m > 0.05 m
- possession-retained__btk-drive-rating-50__rapier3d-compat__seed41027: p95 penetration 0.08977544456720338 m > 0.05 m; weighted mean penetration 0.03647440025169014 m > 0.025 m; registered retained-possession outcome requires physical contact and maintained controlled cradle
- possession-retained__btk-drive-rating-50__jolt-physics-js__seed41027: p95 penetration 0.053693782538175576 m > 0.05 m
- possession-retained__btk-drive-rating-50__rapier3d-compat__seed41028: p95 penetration 0.08977544456720338 m > 0.05 m; weighted mean penetration 0.03647440025169014 m > 0.025 m; registered retained-possession outcome requires physical contact and maintained controlled cradle
- possession-retained__btk-drive-rating-50__jolt-physics-js__seed41028: p95 penetration 0.053693782538175576 m > 0.05 m
- possession-retained__btk-drive-rating-60__rapier3d-compat__seed41027: p95 penetration 0.08977854251861558 m > 0.05 m; weighted mean penetration 0.033970748439918985 m > 0.025 m; registered retained-possession outcome requires physical contact and maintained controlled cradle
- possession-retained__btk-drive-rating-60__jolt-physics-js__seed41027: p95 penetration 0.054044425114989275 m > 0.05 m
- possession-retained__btk-drive-rating-60__rapier3d-compat__seed41028: p95 penetration 0.08977854251861558 m > 0.05 m; weighted mean penetration 0.033970748439918985 m > 0.025 m; registered retained-possession outcome requires physical contact and maintained controlled cradle
- possession-retained__btk-drive-rating-60__jolt-physics-js__seed41028: p95 penetration 0.054044425114989275 m > 0.05 m
- possession-retained__btk-drive-rating-70__rapier3d-compat__seed41027: p95 penetration 0.08978147357702242 m > 0.05 m; weighted mean penetration 0.038656880509936334 m > 0.025 m; registered retained-possession outcome requires physical contact and maintained controlled cradle
- possession-retained__btk-drive-rating-70__jolt-physics-js__seed41027: p95 penetration 0.05439347103238105 m > 0.05 m
- possession-retained__btk-drive-rating-70__rapier3d-compat__seed41028: p95 penetration 0.08978147357702242 m > 0.05 m; weighted mean penetration 0.038656880509936334 m > 0.025 m; registered retained-possession outcome requires physical contact and maintained controlled cradle
- possession-retained__btk-drive-rating-70__jolt-physics-js__seed41028: p95 penetration 0.05439347103238105 m > 0.05 m
- possession-retained__btk-drive-rating-79__rapier3d-compat__seed41027: p95 penetration 0.08978411778807627 m > 0.05 m; weighted mean penetration 0.0399985914635993 m > 0.025 m; registered retained-possession outcome requires physical contact and maintained controlled cradle
- possession-retained__btk-drive-rating-79__jolt-physics-js__seed41027: p95 penetration 0.05468552894890308 m > 0.05 m
- possession-retained__btk-drive-rating-79__rapier3d-compat__seed41028: p95 penetration 0.08978411778807627 m > 0.05 m; weighted mean penetration 0.0399985914635993 m > 0.025 m; registered retained-possession outcome requires physical contact and maintained controlled cradle
- possession-retained__btk-drive-rating-79__jolt-physics-js__seed41028: p95 penetration 0.05468552894890308 m > 0.05 m
- possession-retained__btk-drive-rating-80__rapier3d-compat__seed41027: p95 penetration 0.08978437334299073 m > 0.05 m; weighted mean penetration 0.0385878270802399 m > 0.025 m; registered retained-possession outcome requires physical contact and maintained controlled cradle
- possession-retained__btk-drive-rating-80__jolt-physics-js__seed41027: p95 penetration 0.054715263843536366 m > 0.05 m
- possession-retained__btk-drive-rating-80__rapier3d-compat__seed41028: p95 penetration 0.08978437334299073 m > 0.05 m; weighted mean penetration 0.0385878270802399 m > 0.025 m; registered retained-possession outcome requires physical contact and maintained controlled cradle
- possession-retained__btk-drive-rating-80__jolt-physics-js__seed41028: p95 penetration 0.054715263843536366 m > 0.05 m
- possession-retained__btk-drive-rating-81__rapier3d-compat__seed41027: p95 penetration 0.08978870734572397 m > 0.05 m; weighted mean penetration 0.03805218047151938 m > 0.025 m; registered retained-possession outcome requires physical contact and maintained controlled cradle
- possession-retained__btk-drive-rating-81__jolt-physics-js__seed41027: p95 penetration 0.05474596545100211 m > 0.05 m
- possession-retained__btk-drive-rating-81__rapier3d-compat__seed41028: p95 penetration 0.08978870734572397 m > 0.05 m; weighted mean penetration 0.03805218047151938 m > 0.025 m; registered retained-possession outcome requires physical contact and maintained controlled cradle
- possession-retained__btk-drive-rating-81__jolt-physics-js__seed41028: p95 penetration 0.05474596545100211 m > 0.05 m
- possession-retained__btk-drive-rating-82__rapier3d-compat__seed41027: p95 penetration 0.08978505134582505 m > 0.05 m; weighted mean penetration 0.035279732249680104 m > 0.025 m; registered retained-possession outcome requires physical contact and maintained controlled cradle
- possession-retained__btk-drive-rating-82__jolt-physics-js__seed41027: p95 penetration 0.05477666854858398 m > 0.05 m
- possession-retained__btk-drive-rating-82__rapier3d-compat__seed41028: p95 penetration 0.08978505134582505 m > 0.05 m; weighted mean penetration 0.035279732249680104 m > 0.025 m; registered retained-possession outcome requires physical contact and maintained controlled cradle
- possession-retained__btk-drive-rating-82__jolt-physics-js__seed41028: p95 penetration 0.05477666854858398 m > 0.05 m
- possession-retained__btk-drive-rating-90__rapier3d-compat__seed41027: p95 penetration 0.09014369398355472 m > 0.05 m; weighted mean penetration 0.03401203422467659 m > 0.025 m; registered retained-possession outcome requires physical contact and maintained controlled cradle
- possession-retained__btk-drive-rating-90__jolt-physics-js__seed41027: p95 penetration 0.05496117435395717 m > 0.05 m
- possession-retained__btk-drive-rating-90__rapier3d-compat__seed41028: p95 penetration 0.09014369398355472 m > 0.05 m; weighted mean penetration 0.03401203422467659 m > 0.025 m; registered retained-possession outcome requires physical contact and maintained controlled cradle
- possession-retained__btk-drive-rating-90__jolt-physics-js__seed41028: p95 penetration 0.05496117435395717 m > 0.05 m
- possession-retained__btk-drive-rating-99__rapier3d-compat__seed41027: p95 penetration 0.09037668704986562 m > 0.05 m; weighted mean penetration 0.033261031222814895 m > 0.025 m; registered retained-possession outcome requires physical contact and maintained controlled cradle
- possession-retained__btk-drive-rating-99__jolt-physics-js__seed41027: p95 penetration 0.055053656548261644 m > 0.05 m
- possession-retained__btk-drive-rating-99__rapier3d-compat__seed41028: p95 penetration 0.09037668704986562 m > 0.05 m; weighted mean penetration 0.033261031222814895 m > 0.025 m; registered retained-possession outcome requires physical contact and maintained controlled cradle
- possession-retained__btk-drive-rating-99__jolt-physics-js__seed41028: p95 penetration 0.055053656548261644 m > 0.05 m
- possession-retained__old-barkley-baun-lost-contact__rapier3d-compat__seed41027: p95 penetration 0.10616615414619446 m > 0.05 m; weighted mean penetration 0.030399411454393704 m > 0.025 m; registered retained-possession outcome requires physical contact and maintained controlled cradle
- possession-retained__old-barkley-baun-lost-contact__jolt-physics-js__seed41027: p95 penetration 0.05452853143215179 m > 0.05 m
- possession-retained__old-barkley-baun-lost-contact__rapier3d-compat__seed41028: p95 penetration 0.10616615414619446 m > 0.05 m; weighted mean penetration 0.030399411454393704 m > 0.025 m; registered retained-possession outcome requires physical contact and maintained controlled cradle
- possession-retained__old-barkley-baun-lost-contact__jolt-physics-js__seed41028: p95 penetration 0.05452853143215179 m > 0.05 m
256 of 376 runs failed at least one preserved numerical or fixture-outcome gate. All 256 failures are from `possession-retained`; every one misses at least one unchanged numerical gate, and 54 also fail the retained-possession outcome gate after losing physical contact or secure control. The `grip-escape-one-held` and completed `gang-staggered-three` fixtures pass all 120 runs between them. The full run-by-run reasons and per-run gate values are in shared-summary.json.
## Cross-track comparison boundary

The legacy hold report measures post-wrap drag in a different engine family and separately reports tackle-selection odds. Its travel distances, event rates, and force values are not pooled with M4c. The M4c experiments measure physical contact, grip capacity, balance torque, and fall outcomes after scripted geometry and force inputs; they do not model legacy tackle selection.
Neither report validates a Madden rating-to-force mapping. The TKL/BTK relationships here are bounded sensitivity hypotheses only; actual grip and breakaway capacities require independent physical measurements. No external NFL trajectory/tackle calibration is included.

No merge or adoption recommendation is made here; the protocol assigns the next decision to one consolidated integration review.

## Reproduction and artifacts

From repository root: `node research/physics-3d-evaluation/m4b/m4d/henderson-bush-physical-ablations/run.mjs --branch=research/m4d-str-contact-diagnosis --code-commit=124e64fe0879653b9c84fa98408a64fa6bc179ce`. For report regeneration from existing gzip traces, append `--reuse-traces`.
- `shared-summary.json`: per-run shared schema, inputs, gates, and failure ledger.
- `shared-summary.csv`: compact row export using the common field names.
- `run-manifest.json`: source, code, protocol, and legacy report hashes.
- `replay-index.json` and `viewer.html`: synchronized Rapier/Jolt replays for representative pairs.
- `traces/`: full-rate gzip diagnostics for every run.
Implementation sources and hashes are recorded in the JSON manifest; the exact implementation commit is 124e64fe0879653b9c84fa98408a64fa6bc179ce. No production engine or LP pipeline files were changed.
