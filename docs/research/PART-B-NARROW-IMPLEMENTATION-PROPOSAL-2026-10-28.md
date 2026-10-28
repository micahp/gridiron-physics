# Part B narrow implementation proposal

Status: proposal only, based on `gridiron-statistical-full-game` commit `ec73c46`. This is a supporting research track; it must not delay the event-based simulation work. No code, simulator defaults, or production behavior are changed by this proposal.

## Current code boundary

| Area | Existing behavior | Missing piece relevant to Part B |
|---|---|---|
| Trajectories | `engine/autonomous/passing.js` and `engine/autonomous-run.js` record player samples each simulation step. Samples include position, velocity, heading, speed, assignment/decision labels, and engagement references. | The trajectory record is an output of the simulated world, not an agent observation. |
| Movement | `engine/world.js:Player.locomote()` applies force, acceleration, traction, turning, braking, and speed limits. Per-player physical parameters enter through `info.physics`. | No observed-data fit or role-conditioned Part B profile is connected to those parameters. |
| Routes and blocking | `routeTarget()` encodes a few route landmarks and timing branches. Blockers choose nearby live defensive linemen and may retarget on a short timer. | Route progression and protection are local scripted heuristics; assignments are not a general play action contract. |
| QB decisions | `readOptions()` and `qbDecision()` rank receivers using current receiver, defender, lane, and rusher positions. `visible()` is defined in `passing.js` but unused. | The QB has no timestamped observation object or independent memory; decisions can read mutable `World` state directly. |
| Defensive reaction | `autonomous-run.js` has a run cue and `runReadDelay`; pass pursuit and coverage also read live player/carrier positions. | Cue delay is local to one path, not a general perception and memory boundary. |
| Physical outcomes | Contacts, engagement, tackles, catches, sacks, and other play events are resolved inside the simulator. | Those outcomes are simplified model mechanics. Aggregate historical outcomes are not a basis for adding scripted behaviors. |
| Tracking scorer | `engine/tracking-eval.js` is an offline scorer for completed inside-zone trajectories; it has a constant-velocity baseline and role summaries. | It does not accept pass simulations or score role-by-situation metrics, acceleration, turning, separation, pursuit, or reaction timing. |

## Proposed small slices

### 1. Establish an observation boundary

Add an immutable, time-stamped `PerceptionFrame`/observation value object for each decision-making actor. It should contain only the actor's current allowed cues, their observation times, and identifiers; it must not contain `World`, `Player`, or mutable vector references. A small actor memory stores the last received observations and their ages. Ground-truth world state remains available to the physics and event-resolution code only.

Route QB `readOptions()` through the QB observation and memory interface. Move the existing run cue and its delay in `autonomous-run.js` onto the same cue-timestamp contract. Do not add an unvalidated visual or occlusion model in this slice: the observation policy must be explicit, and synthetic fixtures should define what each actor can observe.

**Synthetic checks:** hold the QB observation fixed while moving hidden defenders in `World`; the same observation and random seed must produce the same QB decision. A cue arriving at time `t` must not affect a defender before `t + delay`. An unseen position update must not silently refresh memory. Verify no observation object contains a world/player reference.

**2022 Weeks 1–5 use:** evaluate player motion and observable cue timing proxies only. Tracking cannot reveal a QB's private read, intended target, or visual field, so it cannot independently score QB decision correctness.

### 2. Add a research-only movement profile and scorer

Represent candidate movement parameters as an injected profile for role groups, covering top speed, acceleration/force, braking, and lateral turning. Keep the current `info.physics` values and current defaults intact when the profile is absent. Estimate candidate parameters from observed player trajectories, not from team-level yards, scoring, or tackle rates. Use partial pooling across roles so sparse role/situation cells do not create extreme estimates.

Generalize the offline scorer around input/output trajectories rather than a completed inside-zone schema. For 2022 Weeks 1–5, compare equal-information baselines: constant velocity, constant acceleration, existing locomotion, and a bounded role-profile candidate. Report paired position error at 0.5 s and 1.0 s, ADE/FDE where frames permit, speed/acceleration and turn-rate error, and counts by player role and play situation. Keep game/play/player joins and source hashes in the external run manifest; do not add bulk tracking CSVs to this repository.

Use Weeks 1–3 to fit candidate profile parameters and Weeks 4–5 as a development check. Label both as development; this is not independent final acceptance. Keep Weeks 6–9 reserved. Use observed route-break timing, separation, and pursuit geometry only where snap/event and player-identity coverage supports the metric. Call turns inferred from tracks *trajectory-change proxies*, not labeled routes. Report the 10 Hz timing resolution and missing-frame/identity denominators.

**Synthetic checks:** limits are respected at rest, at top speed, under braking, and during direction changes; fixed seeds reproduce trajectories; the no-profile branch stays on existing values. **2022 Weeks 1–5 checks:** compare per-role and per-situation errors against the baselines above, with no future coordinates passed to a controller.

### 3. Make route and blocking actions explicit

Replace implicit receiver-specific branches with a small per-play action description: route landmarks/progression for eligible receivers and a protection/block assignment policy for each blocker. Keep the existing route shapes and dynamic block targeting as the initial candidate behavior, but make the assignment and progression state explicit and observable in the trajectory trace. Agents may act only from their current observations and assignment; a shared assignment is not permission to inspect hidden defenders.

**Synthetic checks:** route phases advance at specified event/timing boundaries, assignments remain stable until a documented reassignment cue, and a blocker cannot target an ineligible hidden player. Check route timing, separation, and contact geometry on small authored single-play fixtures.

**2022 Weeks 1–5 use:** compare track-derived route timing proxies, spacing/separation, and blocker/defender motion where roles and frames join. The tracking data do not provide reliable play-call assignments for every actor, so these comparisons cannot establish that the scripted route or protection call was the historical call.

### 4. Connect defensive recognition to observable cues

Use the observation/memory interface for defensive recognition and pursuit. Keep the existing reaction delay as a candidate parameter, but measure delay from a named observable cue to a change in movement, not from a future outcome. Pursuit targets should be derived from the latest permitted carrier/ball observation and its timestamp. Physical contact continues to use true simulation geometry after the agents choose their actions.

**Synthetic checks:** known cue-to-response delays, stale and missing observations, and identical-seed contact/outcome resolution. Assert that observed historical future frames are unavailable to the agent and that the outcome resolver receives the simulated world state only.

**2022 Weeks 1–5 use:** estimate reaction-delay proxies only for plays with an unambiguous cue/event anchor and adequate frames. Report the event definition, 0.1 s frame resolution, and role/situation denominators. Do not treat a measured trajectory change as proof of what the defender perceived.

## Test and evaluation boundary

Run future development as small deterministic unit/fixture checks in the existing autonomous test family (`test/autonomous-pass.mjs`, `test/autonomous-run.mjs`, `test/autonomous-contact.mjs`) plus an offline 2022 Weeks 1–5 scoring command. Synthetic fixtures cover exact observation leakage, timing, route assignment, movement bounds, and physical-resolution invariants. The historical scorer uses only permitted input frames at or before its declared origin; target frames are read after prediction and remain evaluator-only.

No full-game runs, 2023 evaluation, Weeks 6–9 access, 2026 data, default changes, or promotion are part of these slices. A focused single-play fixture can test the QB/defense/contact interfaces without asserting game-level realism. The result may inform the supporting movement track, but it is not a prerequisite for event-based simulation delivery.

## Suggested implementation order

1. Add synthetic observation/memory and leakage tests; route the QB read and run cue through the interface.
2. Add the generic offline scorer and baseline comparisons for the already inventoried 2022 Weeks 1–5 cohort.
3. Add a non-default role movement profile and fit/check it on the specified 2022 development split.
4. Make existing route and blocking assignment progression explicit, then add cue-based defensive pursuit and contact invariants.

Stop or narrow any slice when required event anchors, player joins, or role/situation denominators are unavailable. Historical motion can calibrate movement and test proxies; it cannot establish hidden decisions or justify hard-coded aggregate outcome matching.
