# Ratings-to-physics: coordinated research contract (2026-10-23)

**Status:** coordination and comparison protocol, not model/solver adoption. Production engine and existing historical archives remain unchanged.

## Source-of-truth branches

| Track | Role | Immutable evidence |
| --- | --- | --- |
| M4c mechanics | Reference three-dimensional physics, force-resolved contact/possession and numerical gates | [M4c report at `8ead484e`](https://github.com/micahp/gridiron-physics/blob/8ead484e08de6acdc934f33fe279347713dc289e/research/physics-3d-evaluation/m4b/M4C-REPORT.md); simulation source `82a484fe` |
| M4d NE–CHI | Research-only Rapier/Jolt player mass and strength input substitution | [M4d NE–CHI](https://github.com/micahp/gridiron-physics/blob/research/m4d-ne-chi-madden27-probe/research/physics-3d-evaluation/m4b/m4d/M4D-NE-CHI-INPUT-PILOT.md), `c423908`; branch is **2 ahead / 0 behind** M4c reference |
| Legacy tackle hold | Legacy `world.js`/`play.js` rating-weighted post-wrap drag and Madden-linked probe | [200-play Madden tackle probe](https://github.com/micahp/gridiron-physics/blob/research/madden27-tackle-physics-probe/research/madden27-tackle-hold-probe/REPORT.md), `a026eca`; legacy ancestor `0db20fe` |
| Madden archive | Attribute provenance, identity quality, era/version distinction and QA; separate from the 3D solver | [Madden report](https://github.com/micahp/legendarypicks/blob/research/madden-ratings-2026-10-23/docs/research/MADDEN-RESEARCH-REPORT-2026-10-23.md) |

The legacy branch and M4c/M4d are **different model families**. Their absolute distances, event rates, and impulse values are **not directly comparable** until definitions, geometry, timing, opportunity and measurement are aligned. A shared player pair or seed number does not make the test equivalent.

## Freeze one player-source snapshot

**Common NE–CHI research pair:** TreVeyon Henderson, Patriots HB; Devin Bush, Bears MIKE. EA Madden NFL 27 **Week 6** player pages accessed **2026-10-23**:
- [Henderson](https://www.ea.com/games/madden-nfl/ratings/player-ratings/tre-veyon-henderson/14810): published weight 92 kg, STR 71, BTK 81, TKL 33, HTP 31.
- [Bush](https://www.ea.com/games/madden-nfl/ratings/player-ratings/devin-bush/20583): published weight 106 kg, STR 74, BTK 19, TKL 89, HTP 88.

**Interpretation:** EA `TKL` is a *candidate label match* to legacy `TAK`; it is **not** a conversion to wrap force. `BTK` is also a rating, not measured grip-break load. Legacy `ELU` retains its original 76 estimate because there is no matching EA pilot field. M4d initially passes `STR` numerically into an existing balance-controller field, explicitly **uncalibrated**; don't quietly treat it as a measured force. Body mass from EA is a source-provided body estimate, and should be compared with independently measured mass, not assumed superior.

Every experiment must freeze each player's canonical identifier, team/position/as-of context, source URL, scraped-at timestamp, raw-vs-estimated attribute status, source hash, feature/mapping version, implementation commit, fixture, timestep, solver, and numerical acceptance criteria. Keep full licensed/source dumps out of the repo and label uncertain permissions honestly; research may proceed without claiming commercial redistribution rights.

## Role and file ownership

**A. M4c/M4d physics agent: physical-mechanism owner**

- Owns *new* files below `research/physics-3d-evaluation/m4b/m4d/` and optional instrumentation modules on its isolated research branch based on pinned M4c. Uses M4c `interface.mjs` and existing Rapier/Jolt research drivers.
- Must **not** modify `engine/play.js`, `engine/world.js`, live `pipeline/ratings.py`, or LP production paths.
- Run a one-factor-at-a-time mass / STR / physically defined balance-controller sweep, including a boundary/contact-opportunity diagnosis and replication on distinct M4c tackle/grip fixtures. Use the old Barkley–Baun lost-Rapier-contact case as an additional diagnostic, not a basis to tune the NE–CHI pair.
- May test provisional `TKL/BTK`-to-capacity *hypotheses* **only in new research configuration** with declared physical units, bounded sweeps and neutral inputs. Do not silently map these ratings directly to Newtons. Preserve M4c penetration thresholds and negative outcomes.

**B. Legacy tackle-hold agent: legacy-mechanics owner**

- Owns legacy modifications to `engine/play.js` and `engine/world.js` **on its isolated existing legacy research branch only**, plus test scripts and artifacts under `scripts/` / `research/madden27-tackle-hold-probe/`.
- Must **not** edit `research/physics-3d-evaluation/m4b/` or modify M4c/M4d. Do not merge legacy hold drag into a 3D solver.
- Freeze the existing 200-seed NE–CHI probe and compare baseline code vs hold-scaled code with matched masses, same underlying rating inputs and stable per-seed examples. Decompose **tackle-selection odds** from **post-wrap carrier motion**. Show per-seed paired changes, tackle counts, wrap opportunities and outcome conditioning. Report the known failure of the checked-in legacy prototype distribution artifact separately; do not hide it by updating historical results.
- Explain if the apparent direction in full plays conflicts with the simple monotone two-body sweep; avoid turning a small positive post-wrap travel difference into an NFL ability-validity claim.

**C. Research coordinator/integrator: comparison and decision owner**

- Owns the protocol and consolidated comparative report **only**, not either simulator's core files.
- Collects **exact** commit SHAs and reproducibility commands from A and B; rejects stale/ambiguous branch references.
- Checks the exported schema and unit labels below, checks negative controls and source hashes, and runs or verifies the two tracks' tests independently where possible.
- Makes a conditional decision per component: *retain only research*, *prepare infrastructure-only PR*, *needs further mechanism test*, or *reject specific mapping*. No production solver adoption or mainline merge without independent user approval.

The same person may act as coordinator, but never concurrently edit a file another agent owns. Exchange **repo-tracked pinned artifacts and reports**, not chat messages that cannot be delivered reliably between sessions.

## Shared comparison contract

Each agent exports a compact summary JSON/CSV and one report. Minimum schema:
- `schema_version`, `track`, `branch`, `code_commit`, `source_snapshot_hash`, `mapping_version`, `player_ids`
- `scenario_id`, `solver_or_engine`, `dt_seconds`, `run_id`, `seed_or_fixture_label`, `conditions`
- `contact_opportunity_count`, `actual_contact_count`, `first_contact_seconds` (if genuine timed simulation)
- `tackle_selected` (legacy decision) distinct from `physical_takedown` (3D); `grip_established`, `grip_released`, `ball_controlled`, `fumble`
- `post_contact_carrier_travel_m` with exact measurement window/censoring and whether contact occurred
- `balance_state`, `controller_forces_N`, `requested_grip_load_N`, `contact_impulse_Ns`, `impulse_measurement_source`
- `penetration_max_m`, `penetration_p95_m`, `penetration_duration_weighted_mean_m`, per-run numeric gates and failure reasons
- `result_status`: `passed` / `failed` / `not_applicable` / `not_observed`; **null rather than fabricated values** for unsupported quantities

Report distributions and paired differences **within each engine family**. Separate simulation geometry and algorithm changes from player rating/mass substitutions. Record samples and denominators. Repeated deterministic fixtures do **not** imply statistical confidence. Real football outcome calibration requires independently observed data, not merely matching Madden scores.

## Common preregistered comparison questions

1. With only documented player **mass** changed, which physical or post-wrap quantities change?
2. With only an existing **STR-to-balance** input changed (M4d), are contact opportunity, contact formation, and physical outcome continuous and explainable? Why did Barkley–Baun Rapier lose contact while Jolt retained it?
3. With only legacy `TAK/BTK/ELU` post-wrap scaling changed (legacy), do controlled within-play forces and travel respond in the specified direction **conditional on comparable established wraps**? Why did full-play means increase relative to original?
4. Which source attributes have *no mechanism*? Explicitly list `BTK` and `TKL` as **unused in the existing M4d 3D pilot** unless a new, labeled hypothetical mapping is being tested.
5. Can both studies reproduce their prior baseline outputs and preserve the M4c p95 / duration-weighted numerical failures? Do not relax limits to make a model pass.
6. Is any improvement supported by external NFL trajectory/tackle footage or tracking? If not, outcome is **sensitivity/feasibility only**, and adoption remains **not established**.

## Gate and integration sequence

1. **Freeze this contract and the source snapshot** before more parameter tuning.
2. **A and B each produce a self-contained, separately versioned ablation** with common schema, run manifest, failure ledger and representative before/after clips where supported.
3. **Coordinator writes one side-by-side report** with explicit non-comparability of legacy simulation absolute statistics versus Rapier/Jolt; publishes remaining unresolved questions.
4. **Only infrastructure** (research adapters, tests, schema, docs) may be proposed for a selective integration PR after branch reconciliation. No blanket merges: both branches diverge from `main` and legacy branch inherits older prototype/artifact changes.
5. **Do not enable** a direct Madden-rating-to-force conversion or production Gridiron/LP prediction changes from these results.

**Decision today:** both research tracks offer useful ablations; neither independently validates a 0–99 attribute-to-physical-capacity mapping or production model.
