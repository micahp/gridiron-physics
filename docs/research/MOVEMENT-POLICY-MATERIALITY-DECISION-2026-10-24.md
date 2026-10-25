# Movement policy materiality decision — 2026-10-24

**Status:** Coordinator decision and **new prospective holdout policy**, made after seeing the *development* results. **Do not overwrite the original preregistration.** The source results were reported as **local, uncommitted research worktrees at the time of this note**, so these numerical claims are **agent-reported and not yet independently validated from remotely fetched artifacts**. No production, solver, branch-merge or forecast change is authorized.

**Controlling project priority:** [End-to-end football simulator delivery plan](../END-TO-END-FOOTBALL-SIMULATOR-DELIVERY-PLAN-2026-10-24.md), E0 one generated play → E1 legal drive → E2 complete simulated game → E3 football-realism and prospective/held-out evaluation. This movement result supports choosing a baseline for E3. It **must not block** E0–E2.

## Decision: statistical gate passed, added policy complexity not justified

The original pre-registered rule judged *whether* the locomotion controller beat each of three kinematic baselines. It had **no minimum material improvement** and therefore reported `moreSophisticatedPolicyJustified = true`. That is a valid **literal rule result**, not an instruction to invest in a more complex policy.

The agent's subsequent review, using 2,000 resamples **clustered by game**, reported on a **9,289-scored-play, 80-game** development cohort:

| Reported comparison | 0.5 s position error difference | 1.0 s position error difference |
| --- | ---: | ---: |
| Constant acceleration minus constant velocity | −32.8 mm | −113.2 mm |
| Existing locomotion minus constant acceleration | −0.74 mm | **−3.72 mm** |

At 1 s, about **96.8%** of the improvement versus constant velocity was supplied by simply extrapolating the pre-snap acceleration; the extra legacy `Player.locomote()` advantage was **0.00372 m**, around **0.4%** of the ~0.92 m position MAE. Its 1 s game-clustered interval was [−5.10, −2.71] mm and the comparison was negative in all five development weeks. The constant-acceleration versus velocity interval was [−121.9, −104.6] mm. Position, pair-distance and velocity statistical decision checks reportedly passed under the clustered interval.

**Interpretation:** The controller's additional reduction is statistically distinguishable under the reported clustered resampling but has **negligible demonstrated practical value** given current accuracy, complexity and the product goal. Do not promote or tune a more sophisticated football movement policy solely because a rule with no practical floor returned true. Keep **constant acceleration** as the primary inexpensive movement benchmark; retain bounded acceleration and the existing controller as research comparators. Do not claim the controller is universally ineffective: results concern this cohort and horizons only.

Other reported audit facts:
- The generic 6.5 m/s² acceleration bound activated in only **2 of 90 actor-plays** in the earlier conditional 40-play experiment. Bounded/unbounded acceleration are nearly identical there, **not** necessarily across all full plays.
- The previous origin-included minimum-separation error of 0 m was an artifact of anchoring the starting position; its origin-included RMSE ratio can remain similar but **absolute reference numbers must be recomputed** on an origin-excluded basis. Earlier **0.170 vs 0.141 m** refers to that historical conditional analysis and should not be presented as its corrected absolute errors.
- The new snap-anchored, all-player test uses the **same five pre-snap velocity samples** for all compared acceleration-capable arms. The old 49-row conditional tackle manifest SHA remains unchanged.
- No tackle-success, hand grip, actual collision resolution, yards, drive, game, or forecasting skill was shown by this movement study.

## Materiality rule for future held-out evaluation (registered now, AFTER inspecting development)

For the **first approved, frozen evaluation** on 2022 tracking **weeks 6–9**, promote movement-policy complexity beyond the strongest equal-information kinematic baseline only if **all** are met:

1. **Primary endpoint:** Per-player, per-play **XY position mean absolute error at 1.0 seconds after the snap**, measured in meters on the preregistered eligible cohort. Aggregate by game (give each game an explicitly equal or documented weight), and preserve a paired game-level comparison. Do not change population/aggregation after viewing holdout scores. Report carrier, offense and defense separately as secondary diagnostics.
2. **Practical significance:** New policy's paired improvement is **at least 0.050 m absolute AND at least 5% relative** to the strongest kinematic baseline evaluated with exactly the same allowable pre-snap information. This is a **product engineering decision threshold**, not an NFL ground-truth physics constant, and did not exist in the initial development preregistration.
3. **Statistical evidence:** The predeclared game-clustered 95% interval for the paired 1 s error difference is wholly below **0**; publish 2,000 resamples with fixed seed, random unit = game, and the game-level paired distribution. Do **not** substitute treating individual plays as independent.
4. **Secondary guardrails:** Report 0.5 s MAE, separation and nearest-defender errors, pair/team coherence, speed/turn feasibility and runtime. No serious qualitative failure, label leakage, or meaningful worse spatial behavior; define numeric secondary tolerances **before** unlocking weeks 6–9. Any unavoidable ambiguity makes the result **research only**, not a promotion.
5. **Information parity and provenance:** Same previous five pre-snap frames / features for compared models; all future player locations, tackle events/credits and realized outcomes excluded from inputs; fixed snapshots, model SHA, source SHA, no tuning on held-out results.

**Decision today:** Development already **fails** the 5 cm / 5% practical rule by more than an order of magnitude. **Do not spend weeks 6–9 now to promote the current controller or to hunt millimeter gains.** Preserve the weeks for a single planned confirmation only if needed after E0–E2 delivery or if a genuinely different, preregistered high-value football-policy challenger exists. A later held-out report must label this floor as **new and specified after seeing development**, not falsely call it part of the original preregistration.

## Cohort reconciliation blocker (do before any further held-out scoring)

The incoming agent summaries cite three different denominators:
- LP local snap cohort **9,456 manifest rows** (may include exclusions).
- Gridiron report **9,388 snap-anchored plays**.
- Decision-check script **9,289 scored plays** across **80 games**.

They differ by **68** and **99** rows/plays respectively. No inference should be made about *why* from the summary alone. Before the next model comparison, publish a **play-ID-level reconciliation** listing inclusions/exclusions at each stage, unit and definition of a row versus unique play, temporal frame eligibility, IDs and missing tracks, games, split and exact dataset SHA. No silent drop. Verify that the 9,289 scored subset did not selectively exclude difficult plays or differ between model arms; publish missing/exclusion rates.

2022 weeks **6–9** have been profiled previously, and their `plays.csv` rows were reportedly read for column-level counts, but no tracking trajectories or outcome labels from those weeks were used for this movement model selection. Call them **reserved for model-level held-out evaluation**, not literally never opened.

## Agent actions (supporting; not the critical path)

**LP tracking/behavior agent:** Keep original prereg and 49-play manifest frozen. Resolve 9,456/9,388/9,289 reconciliation, archive new snap manifest / prereg / per-game status on an isolated research branch, and identify which fields went into each prediction cutoff. If authorized, commit/push as normal following repo push restrictions. Do **not** retrain a complex policy.

**Gridiron movement agent:** Preserve corrected origin-excluded movement report, source hashes, per-play paired CSV and 2,000-draw clustered decision test. Explicitly separate baseline statistical pass from practical non-adoption. Show same-input constant acceleration and bounded acceleration are adequate for next research mode; stop unbounded synthetic movements or new contact suites. Source artifacts are currently reported as **uncommitted**; do not claim remote verification.

**LP sequence/game-state and Gridiron viewer agents:** Work on **E0/E1/E2** complete generated play → drive → game now. Movement research is a supporting baseline and **cannot block integration**.

**Integrator:** When both local research reports have actual pushed commits, independently fetch/report their exact hashes and verify cohort arithmetic, metrics and decision rules. Do not misstate this coordinator documentation commit as proof that underlying experiments were pushed or rerun. Don't merge, deploy, edit production locks/grades, or replace a solver from this decision.

**Takeaway:** We learned that a simple kinematic predictor explains nearly all measured development movement improvement. Preserve that knowledge, set a meaningful adoption threshold, and **ship the full simulated game**.
