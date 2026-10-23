# Earlier 200-seed probe on the project snapshot (not the frozen Madden pair)

These are the two 200-seed NE–CHI runs from the first tackle-hold probe. They use the project snapshot ratings only: no
EA profile is pinned, and the tackle is not forced to Henderson or Bush. Baseline is `c9d4e6f`; modified is `0db20fe`.
Produced by `scripts/tackle_physics_probe.mjs` on the research branch `research/gridiron-tackle-physics-2026-10-23`.

They are preserved for reproducibility and are not the frozen Madden result. Their conditions are: baseline, defenders'
TAK +10, and offensive skill players' BTK +10. Mean carrier travel in the one second after the tackle, in yards:

- Run: baseline 1.611 (original) → 1.646 (modified); defenders' TAK +10 → 1.591; offensive BTK +10 → 1.671.
- Pass: baseline 2.325 → 2.307; defenders' TAK +10 → 2.210; offensive BTK +10 → 2.307.

Summary JSON only; no per-seed rows. The raw per-seed rows were not written by that run.
