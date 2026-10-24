# BDB2025 complete-play and carrier-only trajectory inventory

Date: 2026-10-24

Inventory schema: `gridiron.team-movement-trajectory-inventory.v1`

Scope: canonical snap cohort, development weeks 1–5 only

## Result

The inventory covers all **9,289** `eligible_input=true` rows from the LP canonical snap manifest. All 9,289 have 22 tracked players at snap and player positions at +0.5 s and +1.0 s. **9,248** have the complete all-player input history at frames −10, −5 and 0; the other 41 stay in the cohort inventory but cannot be used by a model requiring that history.

The full-play criterion is deliberately mechanical: for every one of the 22 distinct players present at snap, there must be one valid x/y observation at every integer 10 Hz tracking frame from snap through the earliest resolved tracking terminal marker, inclusive. Of the 9,289 eligible plays, **9,283** have a resolved terminal marker and all 22 complete paths; six have no resolved terminal marker and remain unclassified for full-play completeness. A tracking terminal marker is not an official whistle or adjudicated end of play.

The carrier inventory is a separate, retrospective label stratum. The physical-timing artifact supplies **7,576** carrier candidates; **7,571** have an identifiable snap-to-terminal path, and five have a carrier candidate but unresolved terminal timing. There are **zero carrier-only-complete plays**: every terminal-resolved play in this eligible cohort also has complete 22-player trajectories. Carrier candidates are selected using a later tracking event and must never become snap-time model inputs, cohort criteria, or assignment truth.

The tracked football has complete snap-to-terminal positions on **9,282 of 9,283** resolved intervals. One week-3 out-of-bounds play (`game_id=2022092508`, `play_id=3104`) is short two ball frames in a 39-frame interval. This is a coverage exception, not an interpolated path.

| Coverage class | Count | Meaning |
|---|---:|---|
| Complete 22-player paths, snap through resolved terminal marker | 9,283 | Full-player trajectories are available for all resolved plays. |
| Terminal unresolved | 6 | End frame is unknown; no full-play completeness claim. |
| Retrospective carrier candidates | 7,576 | Candidate label is derived from a later tracking event. |
| Carrier paths complete through resolved terminal | 7,571 | Descriptive carrier-only view can be extracted, but is a subset of full 22-player plays. |
| Carrier-only-complete plays | 0 | No resolved play has a complete carrier path while lacking a complete all-22 path. |
| Ball path complete through resolved terminal | 9,282 / 9,283 | One resolved out-of-bounds play has two missing ball samples. |

The inventory builder and per-play machine-readable rows are [here](../../../scripts/research/inventory_bdb2025_trajectories.py) and [here](../../../data/research/team-movement/trajectory-inventory-v1.json). The JSON preserves BDB `game_id`/`play_id`, the LP composite join key when present, snap and terminal frames, tracking-only terminal family, all-22/candidate/ball coverage, and explicit retrospective-label semantics. It contains no raw trajectories.

## Inputs and reproducibility

The builder streams only `tracking_week_1.csv` through `tracking_week_5.csv`, verifies every eligible manifest key, and refuses a week outside its hard-coded `(1,2,3,4,5)` list. It does not open weeks 6–9. No model was fit or tuned for this inventory.

| Input | SHA-256 |
|---|---|
| LP canonical snap cohort | `45325d55103da9a7eca5139f3fda9506cb38d8f0af76d7753868c8f40fbd548a` |
| Snap physical-timing inventory | `e885fd20be7fe54f429c31f98dff11425538d331e383c90527141dd78754a63b` |
| BDB tracking week 1 | `dc47c829ef917cb6533c6baedd01964823939a4e9cba807090d2784aa1fd149c` |
| BDB tracking week 2 | `d735b37f04bdf324132b9cb0f084a4ca583fadbbf02653e1873dad39c36924aa` |
| BDB tracking week 3 | `db2965ad61a5ad3895a8878a3754c3d3e4bf4b2dce75732c0b6b4d9d094887bb` |
| BDB tracking week 4 | `2e931bc9cd7f6126d6cd1e7eb71a3c711b748a0cece9d04dcace870e7298774f` |
| BDB tracking week 5 | `1c10136562b82f3e2d5405247540d890fc02f38804109bdaaba5e63bd816c3e9` |
| Inventory builder | `a866ea411222b3bcdf00bbdf162094781c10f30b052b024940c8368ed7a11db8` |
| Inventory JSON output | `87d8fbcf4422e9da37b553d8fd7d6bf3f18635d6cb376f5501ed7e7189311354` |

The builder reported raw rows scanned by week: 7,104,700; 6,704,339; 7,129,195; 6,747,556; and 7,103,067. These are five development files only.

## Limits

Tracking is sampled at 10 Hz. The terminal frame is an observed tracking event marker, not a whistle timestamp, and the data do not attribute clock stoppage. Carrier identity is an unadjudicated nearest-player inference at an event frame. These labels support inventory and retrospective scoring only; they do not establish possession, tackle probability, yards, score, or game prediction.
