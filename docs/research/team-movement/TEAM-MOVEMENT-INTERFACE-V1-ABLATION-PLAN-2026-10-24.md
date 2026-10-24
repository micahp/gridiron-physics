# Team Movement Model interface v1 and ablation plan

Date: 2026-10-24
Status: research interface and preregistered evaluation plan; no movement-policy tuning in this chunk

## Purpose and boundary

LP supplies the selected hypothetical play and football state. Gridiron consumes that immutable play context and generates 22-player movement. A Team Movement Model supplies conditional, flexible movement tendencies by offensive and defensive role, with optional continuity-weighted team tendencies and current-player execution limits. It does not change LP's play outcome, drive, score, or game result.

The request and response are versioned separately:

- [`team-movement-input-v1.schema.json`](team-movement-input-v1.schema.json) — `gridiron.team-movement-input.v1`.
- [`team-movement-output-v1.schema.json`](team-movement-output-v1.schema.json) — `gridiron.team-movement-output.v1`.

This is a research boundary, not a production API or a claim that the current pilot implements every field. Any change to time origin, coordinate meaning, units, history budget, player cardinality, or null semantics requires a new major schema version. A consumer may not silently backfill nulls.

## Input v1

Every arm receives the same information available at the snap:

1. **Decision point and coordinates:** `task_mode=prospective_from_snap`, origin frame 0, 10 Hz source rate, offense-forward x-axis, lateral y-axis, and an explicit versioned direction assignment. Direction cannot be inferred from quarter or a home/away default. Positions are in meters relative to the snap ball.
2. **Situation and selected call:** actual LP-selected call for generated play input, or a documented pre-snap-observable label for retrospective evaluation. Formation, play family, down, distance, quarter and clock are nullable. A post-play label such as `isDropback` cannot be passed as an observed prospective feature unless the benchmark proves it was available at snap.
3. **Both units:** exactly 22 distinct current players, each with current team ID, side, role/position group, availability-backed roster snapshot reference, and positions at frame offsets −10, −5 and 0. An implementation validator must require the offsets exactly once and unique player IDs.
4. **Execution profile:** current-player physics limits and ratings carry their source snapshot, as-of time and confidence. Missing values remain null. Madden-style ratings are not force or acceleration units; only a separately validated physics profile may impose physical bounds.
5. **Hierarchical priors:** a league role prior is available for each side. Team tendencies are optional and include their source season, explicit continuity status and shrinkage weight. Player-specific deviations are used only with a declared minimum evidence count; otherwise fall back to role. A 2022 franchise label is not a 2026 scheme label, and absent 2022–2026 continuity means its current-team weight is zero.

Input v1 excludes terminal event/time, credited tackler, future carrier identity, post-snap ball/player positions, eventual play outcome, and any field constructed from those labels. Future tracking positions may be supervised targets on the training split or score labels on evaluation splits, but are never model inputs. The inventory shows the complete all-22 trajectories are available for 9,283 resolved plays; the carrier-only candidate remains a separate retrospective subset, never an input.

## Output v1

The response preserves the same 22 player IDs and provides prospective trajectory samples with position, velocity, and an uncertainty radius at 0.5 and 1.0 seconds. It also emits offense/defense group centroids and pairwise-spacing summaries. Each response carries the input SHA, coordinate/assignment version and source layers that actually contributed.

The viewer must distinguish these claims in its provenance labels:

- **Observed historical movement** — measured tracking target or training evidence.
- **Learned movement tendency** — distribution/residual estimated from the declared cohort.
- **Reconstructed assignment** — inferred or authored role/path hypothesis.
- **Generated physical motion** — current player/controller execution of the movement request.

Output v1 contains no tackle, yards, score, outcome probability, drive result, or game forecast. A movement improvement is reported only on movement and spacing targets. The ball's future path and physical contact resolution are separate interfaces and remain null/unsupported here.

## Ablation plan

### Common evaluation contract

- Use the canonical snap-anchored cohort and its 22-player roster at snap. The snap manifest selects plays; future-frame availability only censors labels after selection.
- For an arm requiring the full v1 history, the common eligible input set is the **9,248** plays with all 22 players at frames −10, −5 and 0. Report the remaining 41 eligible snap plays as missing-history coverage; do not select a substitute player or play based on future performance.
- Every model receives the same call/context, relative snap geometry, three history points, player roles and physical-profile fields. Only the declared ablation factor changes.
- Training and all tuning use development weeks 1–5 only, grouped by game. Week 5 has already been viewed in the pilot and is not a pristine test. Weeks 6–9 remain unopened until the model, hyperparameters, metrics and code are frozen; evaluate that holdout once and do not tune against it.
- Pair errors by play and bootstrap by game. Keep outcome families as reporting strata only. Do not feed carrier candidates or terminal classes into model input.

### Motion baselines

| Arm | Specification | Shared input requirement |
|---|---|---|
| B0 Constant velocity | Extrapolate position and velocity from frames −5 and 0. | Same snap origin and roster; no future observations. |
| B1 Constant acceleration | Finite-difference velocity over −10→−5 and −5→0, then extrapolate. | Uses the complete v1 history. |
| B2 Bounded acceleration | Same initial position/velocity/acceleration as B1, with role-specific speed and acceleration bounds fit only inside each training fold. | Bounds are frozen before that fold's evaluation; no holdout-derived caps. |
| B3 Existing locomotion controller | Initialize the current `Player.locomote()` controller from the same snap state and current physics profile; give it no observed post-snap waypoints. | No extra history or outcome inputs. |

### Team Movement Model ablations

| Arm | Added component | Question isolated |
|---|---|---|
| M0 League role | Separate league-wide offense/defense positional-role movement residual distributions. | Does role conditioning improve over kinematic baselines? |
| M1 Relative context | Add only snap-relative ball, teammate and opponent geometry. | Does relational snap context improve spacing/pursuit? |
| M2 Team tendency | Add continuity-weighted team offense/defense tendency, shrunk toward league role. | Does team history add value beyond role and geometry? |
| M3 Current execution | Apply validated current-player physical limits to the same predicted role movement. | Do current player capabilities improve execution without copying old-player paths? |
| M4 Player deviation | Add player-specific residual only above a preregistered play-count threshold. | Is individual history informative beyond role/team? |

For each comparison, report per-play paired mean absolute/Euclidean position error at 0.5 and 1.0 seconds; within-offense, within-defense and cross-unit spacing error; nearest-defender distance error and nearest-player identity agreement; velocity-vector error and change-in-velocity error; and team centroid/dispersion movement error. Give denominators by week, side, role, play family and trajectory-coverage class. Keep all-player and carrier-only denominators separate; carrier-only is a retrospective descriptive stratum and cannot support prospective carrier-conditioned claims.

### Stop and interpretation rules

- Do not tune on weeks 6–9. If the schema, features, or hyperparameters change after a holdout read, those weeks are spent and a new future holdout is required.
- Do not claim that the 2022 team prior transfers to a 2026 franchise without measured continuity evidence.
- Do not map Madden ratings directly to force/acceleration. Separate rating features from physical constraints in ablations and report imputation/confidence.
- A result that improves player position error but worsens team spacing or nearest-defender structure is not an overall movement win.
- No result in this study establishes tackle probability, yards, scoring, game forecasting, physical causality, or collision accuracy.

## Current artifact status

The snap-anchored 22-player seed and week-5 development result predate this interface. This chunk adds a measured trajectory-coverage inventory and an interface/ablation specification only; it does not fit a new policy or read holdout weeks.
