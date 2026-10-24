# Ratings-to-physics integration review — 2026-10-23

> **2026-10-23 priority supersession:** The [football-first agent directive](../FOOTBALL-FIRST-AGENT-DIRECTIVE-2026-10-23.md) replaces the **next-task priorities** under “Owned next actions” below. Keep this integration report as frozen evidence and its **no-adoption/no-merge verdict**. Prioritize actual NFL tracking/play/drive evaluation and established tools. Do not start new M4d contact-boundary or Madden sweep experiments unless a measured football-play mismatch or a narrowly necessary numerical safety fix warrants them.

**Decision:** Retain all rating-to-contact behavior changes in research. **No production solver, live rating pipeline, or model adoption.** The 3D test harness, pinned movement/force traces, common schema, and replay tooling are candidates for **selective infrastructure integration**, subject to baseline/test and artifact-size review. The legacy role-centered post-wrap implementation is explicitly **not merge-ready** due to strict speed-validation failure and a pre-existing far-wrap force pathology.

**Authority:** [Shared coordination protocol](RATINGS-TO-PHYSICS-COORDINATION-2026-10-23.md); [Gridiron roadmap](../../ROADMAP.md). This is an integration synthesis of the published research artifacts, **not** a new execution of 376 physics runs or a new independent reproduction.

## Frozen evidence

| Track | Immutable code/report reference | Evidence |
| --- | --- | --- |
| M4c 3D physical baseline | [M4c report, final `8ead484e`](https://github.com/micahp/gridiron-physics/blob/8ead484e08de6acdc934f33fe279347713dc289e/research/physics-3d-evaluation/m4b/M4C-REPORT.md), source code `82a484fe1d89b5bec9f93ae01a8b932776d82280` | Retained possession, physical falls, grip/ball-overload failures; numerical per-run penetration gates partially failed. |
| 3D M4d final | [Henderson–Bush ablation report at `df882f8`](https://github.com/micahp/gridiron-physics/blob/df882f88aaba1df906cd0e4e527e72434ab9a4d5/research/physics-3d-evaluation/m4b/m4d/henderson-bush-physical-ablations/results/report.md); **implementation** `04894ad8781edc06f1320a5e3a898a7eaa0cbfdf` | 376 Rapier/Jolt full-rate traces, frozen EA Madden NFL 27 Week 6 Henderson/Bush source hash `8b92f09be84ae95600d99881887ccf450f205da13e0b60b43b00776360c27d04`, archived viewer, result manifest, shared summary. |
| Legacy Madden-linked hold | [200-seed freeze, decomposition and play-18 diagnosis at `51b9d0f`](https://github.com/micahp/gridiron-physics/blob/51b9d0f85a147dfc3fcc866fb1c18b5186d3a106/research/madden27-tackle-hold-probe/diagnosis-play18/DIAGNOSIS.md); role-centered candidate `ec18dee259572f4beabda68a70d0d7f58601900f`, older original `c9d4e6f`, hold candidate `0db20fe` | Separate legacy `engine/world.js` + `engine/play.js` model, not a matched implementation of M4c. Role-centered branch fails strict top-speed validation in play 18. |
| Earlier M4d cases | [NE–CHI pilot](https://github.com/micahp/gridiron-physics/blob/research/m4d-ne-chi-madden27-probe/research/physics-3d-evaluation/m4b/m4d/M4D-NE-CHI-INPUT-PILOT.md) `c423908`; [Barkley–Baun pilot](https://github.com/micahp/gridiron-physics/blob/research/m4d-madden27-tackle-pilot/research/physics-3d-evaluation/m4b/m4d/M4D-MADDEN27-INPUT-PILOT.md) | Fixed source profiles show mass and STR input sensitivity, **not** calibrated contact/collision mechanics. |

## 3D M4d audited results

- **376** M4c-based Rapier/Jolt simulation rows, with two recorded fixture labels (41027, 41028) that do **not** draw randomness. The 376 traces/CSV summaries reportedly passed archive completeness/schema checks; implementation was separately pinned. The repeated deterministic seeds are not independently sampled football events.
- **120/376 passed all recorded per-run gates:** all `gang-staggered-three` completed-tackle and `grip-escape-one-held` fixtures. They continue to demonstrate controlled mechanics under the chosen conditions, **not** football event-rate validity.
- **256/376 failed at least one unchanged numerical or physical outcome criterion**, all in `possession-retained`. Each of those 256 fails at least one numerical penetration gate; **54** additionally fail the registered contact+retained-possession outcome gate. Count failing *runs*, not total violations: p95, mean and possession failures overlap.
- Original registered numerical gates remain: max penetration **≤ 0.15 m**, per-run p95 **≤ 0.05 m**, per-run duration-weighted mean **≤ 0.025 m**. Other fixture passes do **not** offset failed possession runs in pooled averages. Do not automatically relax thresholds or drop negative results.
- Across **188 matched Rapier/Jolt contact-state-split comparisons**, the report classifies **128** as trajectory-mediated (Jolt analytic proxy overlap while Rapier stays separated), **30** as Rapier analytic proxy overlap but no corresponding reported contact, and **30** as Jolt contact where both analytic proxies show positive gaps. These are **proxy/solver-boundary diagnostic categories**, not proof of 60 contact-engine bugs.
- STR from 80 to 81 changes early, precontact balance-controller torque smoothly and monotonically at the sampled steps. The **contact/no-contact output is discrete** near tangency: e.g. a tiny separation change may prevent touch. The earlier Barkley–Baun lost-Rapier-contact replay was specifically trajectory-mediated; avoid diagnosing a missed callback merely because solver outcomes diverge.
- The provisional `TKL→wrap capacity` and `BTK→extra forward drive` hypotheses are explicitly **not empirically calibrated**. Do not promote 0–99 game ratings to force, grip or strength units. Source EA body mass is likewise a publisher estimate, not a measured biomechanical truth.

## Legacy report reconciliation

- The older `world.js`/`play.js` track changes **post-wrap drag**, not the solver-driven contact, balance and grip mechanics used by M4c. Treat its 200 seeded plays and M4d's scripted rigid-body fixtures as **different populations and outcome definitions**. Never pool post-contact travel or compare absolute mean tackle/yards rates across tracks.
- The legacy candidate uses a hypothetical `gripFactor(TAK)/gripFactor(max(BTK,ELU))`. Controlled two-body sensitivity is monotonic, but the fixed NE–CHI whole-play test produced **+0.033 yd** carrier travel (frozen estimate condition) and **+0.055 yd** in the Madden BTK condition compared with older code. These results were decomposed into rating-factor ratio/calibration and tackle selection rather than evidence for NFL physical ability.
- In-sample role centering reduces those offsets to **+0.023 yd** and **+0.046 yd**. It is **not** independently validated, and the role-centered engine `ec18dee` **fails `test/validate.mjs --strict`**. The older hold-scaled branch changes expected distributions and does not reproduce the checked-in prototype artifact; preserve both failures rather than silently replacing reference output.
- **Root cause unmasked:** legacy forced-time-budget fallback initiates a wrap from up to **3 m** when body contact is approximately **0.6 m**; an unbounded **7000 N/m** spring with ~0.46 m rest distance demands ~**17.5 kN** at 2.96 m separation. Brandon Jones was observed at **18.45 m/s** against a modeled **9.53 m/s** top speed on play 18. The older engine has the same latent unsafe interaction but did not enter that trajectory on the frozen test. A scratch **3→1 m** gate clears the failing game only, not a multi-game validation.
- The general remedy should target **physical contact opportunity and bounded forces**, not an arbitrary role-centering tweak. Compare proximity gate, bounded spring, and their combination on multi-game/seed regressions before changing production code.

## Decision table

| Component or claim | Decision | Evidence required before upgrading status |
| --- | --- | --- |
| M4c/Rapier/Jolt scenario runner, common summary schema, replay comparison tools | **Infrastructure integration candidate (selective PR only)** | Clean branch from current `main`, isolate code/tests/docs, reproduce baseline tests, keep giant generated artifacts external/compact with pinned hashes. |
| M4c controlled completed tackle and grip escape mechanics | **Retain as research mechanisms** | Numerical robustness on more fixtures; independently observed football trajectories; prove nontrivial variation with physical player inputs. |
| `possession-retained` M4d fixture | **Numerical + sometimes outcome failed** | Find exact penetration contributors (player-player vs ground vs football vs hands), source of long p95/mean tails, and why physical contact or control disappears. Pass original registered per-run gates on matched fixtures without hiding no-contact cases. |
| Rapier/Jolt analytic proxy mismatch | **Instrumentation/geometry investigation** | Check exact transformed collider parts, materials/skin, collider margins, manifold normal/penetration and contact listener timing, and earliest diverging tick. Separate true no contact from proxy approximation and missed telemetry. |
| Legacy role-centered TAK/BTK/ELU hold implementation | **Do not merge** | Fix far-wrap/unbounded spring failure; pass strict speed and prototype/expected-distribution review across more than one game; then perform external observed tackle validation. |
| Madden `STR`, `TKL`, `BTK` → physical torque/grip/drive | **Sensitivity hypotheses only; do not adopt** | Obtain independent measured speed/acceleration/force/contact/possession outcomes, predefine bounded conversion and demonstrate predictive validity out of development cases. |
| Next-generation full player ratings model trained on Madden history | **Not a current blocker or priority** | First identify which observed player attributes have validated dynamics/behavior implications. |
| Any `main` or LP production solver/forecast changes | **Not authorized** | Explicit implementation proposal, passing independent gates, license/provenance approval where required, and user approval. |

## Owned next actions

**3D M4d agent:** Preserve `df882f8` artifacts as immutable. Implement a **diagnostic-only** reproduction of one neutral and one failing `possession-retained` case. Attribute p95 overlap to individual transformed collider pairs and time windows; compare exact Rapier manifolds with Jolt listener telemetry and the shared analytic proxy. Vary one geometry or timestep parameter at a time on a new branch; rerun the preregistered baseline and retain all failures. **No additional general 0–99 rating sweeps until this numerical gate is understood.**

**Legacy physics agent:** Freeze `51b9d0f` artifacts and `ec18dee` failure. In a separate scratch repair branch, test the fallback contact gate, a physically justified spring/impulse bound, and both, across multiple games/seeds and original test suites. Do not rebaseline reference outputs as if they were historical observations. **No more role-centering tuning until the contact/force defect is fixed.**

**Integrator:** Own this report, independently verify the two branches' test commands and manifest hashes, request missing sources where applicable, and review narrow research infrastructure pull requests only if the branches and artifact sizes are controlled. Require actual tracked NFL tackles or other independently recorded outcome data before adopting a mapping. **No code merges or solver replacement from this report.**

## Reproduction (from source reports)

M4d from repository root:
```sh
node research/physics-3d-evaluation/m4b/m4d/henderson-bush-physical-ablations/run.mjs --branch=research/m4d-str-contact-diagnosis --code-commit=04894ad8781edc06f1320a5e3a898a7eaa0cbfdf
```
To regenerate report from pinned traces, append `--reuse-traces`. Refer to published M4c/legacy branch reports for their own regression and 200-seed commands. These are *reported reproduction procedures*; this integrator review did not execute them.
