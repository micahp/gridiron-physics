# Gridiron Physics: 3D Physics Engine Replacement Evaluation

**Branch:** `research/3d-physics-engine-evaluation`
**Base:** `feat/free-run-pass-physics` at `7385acba06a2459f5a12d8bf4fc6644c619b2ee0`
**Scope:** isolated research harness and report. Existing game solver, historical reconstruction, data, and renderer code are unchanged.

## Recommendation

Use a mature 3D rigid-body engine for contact, ball collision, and rotational response, while retaining Gridiron Physics' play selection, locomotion intent, ratings, game state, and reconstruction policies. The engine should receive dynamic rigid bodies and forces/torques; avoid making tackleable players kinematic because kinematic bodies can ignore physical contact.

Rapier 3D is the first integration candidate. Its official JS/WASM package worked in both Node and Chromium; its JS documentation explicitly specifies fixed-step cross-platform determinism; and the binding exposes contact points and solver impulses used by this harness. Jolt is a strong second candidate and ran faster in the measured 22-player proxy scene. Its optional cross-platform deterministic build and richer ragdoll/skeleton features make it worth retaining for an integration bake-off. Neither result justifies replacing the production solver yet.

The practical architecture is **engine-resolved rigid-body contact plus custom movement and behavior policies**. A later controller can supply desired velocity, drive, balance torque, wrap/grab attempts, and catch attempts. The engine resolves resulting pose, momentum, contact, and falls. A discrete football outcome rule should only fire from appropriate physical events and game state, not from future play anchors.

## 1. Current architecture audit

| Area | What is physically integrated today | What is constrained or scripted |
|---|---|---|
| Player locomotion | Mass, force limits, 2D velocity, and position are integrated in the field plane. | Each player position and velocity has only `x/y`; body heading `h` is yaw in that same plane. `Player.z` is a scalar state, not a player altitude. No player roll, pitch, angular velocity, inertia tensor, or 3D body exists. See [`Player`](../../engine/world.js#L19-L56) and [`locomote`](../../engine/world.js#L62-L155). |
| Rotation and balance | No player rotational dynamics or physical balance are integrated. | Heading turns toward a facing or velocity target; `down`, stumble, and pose are state flags. The renderer tips/animates a visual body from those flags. |
| Ball flight | Ball position and velocity are integrated in three coordinates with gravity and quadratic drag. Launch speed is solved against an intended endpoint and flight time. See [`flyStep` / `solveLaunch`](../../engine/ball.js#L18-L66). | The ball is a point mass, with no rigid shape, angular inertia, or player collision collider. While held, it is attached to a hand position computed from the carrier's planar position and heading. Loose-ball bounce adds seeded stochasticity. See [`ballStep`](../../engine/world.js#L332-L360). |
| Player collisions | Horizontal circular overlap correction and an inelastic normal impulse change players' field-plane position and velocity. | Collision geometry is a circle per player. No height, limbs, torque, off-center impulse, or response to contact above/below the center of mass. See [`collide`](../../engine/world.js#L283-L327). |
| Blocking | Pair forces affect planar motion. | Engagement is a spring-damper with a tangential grip and scripted lateral shed burst, not contacting rigid shapes, arm joints, or a grip constraint. See [`engage` / `engagementForces`](../../engine/world.js#L176-L230). |
| Tackles | A wrap initially changes planar linear momentum. | Wrap adds a distance spring and hanging-weight drag; a timer then marks the carrier down. Broken tackle and defender stumble/down include rating-based random draws. See [`wrap` / `wrapForces`](../../engine/world.js#L234-L280) and [`tryTackle` / `updateTackle`](../../engine/play.js#L335-L430). |
| Passes and catches | The thrown ball follows the 3D point-mass aerodynamic model. | Ball/player feasibility is evaluated by height and center distance at a scheduled catch time, followed by outcome logic. There is no ball/body collision or hand-contact event; completed, dropped, intercepted, and deflected results can be selected by reconstruction context. See [`throwBall` / `resolvePass`](../../engine/play.js#L1180-L1260) and [`resolvePass` scheduling](../../engine/play.js#L1690-L1727). |
| Player animation | The browser renders full 3D geometry and animated limbs. | These meshes are visual: the legs, arms, torso, helmet, and pose animation do not feed back into the solver. See [`buildPlayer` / `animate`](../../web/render.js#L101-L175). |

`docs/PHYSICS.md` accurately describes the existing player colliders as discs and the ball as a 3D point mass, but some “tackle” and “catch” wording can sound more physical than the actual rules-and-animation path. This evaluation leaves it untouched; a future integration should clarify those terms in that document.

### Existing pieces to preserve

- Ratings and physical attributes, including mass, speed, force, agility, reach, and effort limits.
- The intent/brain layer that asks a player to run, cut, block, pursue, or throw.
- Playbooks, rosters, game-state logic, seeded reconstruction, play records, and historical outcome anchors.
- The current ball aerodynamics and [`solveLaunch`](../../engine/ball.js#L37-L66); this harness reuses both.
- Three.js field, player meshes, play diagrams, and timeline viewer.

## 2. Engine comparison

| Criterion | Rapier 3D JS/WASM | Jolt Physics.js | PhysX reference |
|---|---|---|---|
| 3D bodies/contact/geometry | Dynamic and kinematic rigid bodies, 3D colliders, forces, contacts, CCD, and contact data. Official JS package. | Full 3D rigid-body and collision engine through Emscripten. The WASM compatibility build works in browser and Node. | PhysX has the full 3D feature set. Independent JS/WASM bindings exist; they are not an NVIDIA-maintained official JS package. |
| Joints/ragdolls | Revolute, spherical, fixed, prismatic, and multibody/impulse constraints; ragdoll assembly is application work. | Broad constraint set plus skeleton/ragdoll APIs in the core and JS port, subject to the JS binding surface. | Articulations, joints, and character controllers are available through `physx-js-webidl`; no prototype was built. |
| Locomotion/balance | Generic kinematic character controller is move-and-slide and does not rotate. Use dynamic player bodies plus the game's custom force/torque policy for collision response and balance. | `CharacterVirtual` is query-driven rather than a dynamic body; use dynamic rigid bodies for players that must be pushed/fall, then add a custom balance/locomotion policy. | Character controllers are available in the independent binding; dynamic bodies still suit contact-driven players better than an outcome-immune kinematic proxy. |
| Deterministic replay | Rapier documents exact cross-platform determinism for its JS/WASM binding when version, initial state, creation order, and input generation match. Verified repeatably within this harness; no separate-machine comparison was performed. | This WASM build reproduced exactly under repeated same-process Node/Chromium runs. Cross-platform determinism is a build option (`CROSS_PLATFORM_DETERMINISTIC=ON`); the npm prebuild used here was not independently verified as that build. | Not evaluated here. Would need binding/build and cross-platform replay qualification. |
| Browser / Node / Three.js | Works in Chromium and Node. Three.js reads body transforms directly; no engine-specific Three integration is required. | Works in Chromium and Node. The Emscripten wrapper needs disciplined explicit object/reference cleanup; the comparison harness includes that adapter work. | Community bindings target browser/WASM; build and API compatibility are a separate dependency risk. |
| Mobile and package footprint | Mobile device performance not measured. NPM package is 15.0 MB unpacked; that includes distribution artifacts, not the measured transfer size of a chosen production bundle. | Mobile device performance not measured. NPM package is 46.4 MB unpacked across seven bundle variants; the tested WASM-compat entry file is about 3.1 MB before HTTP compression. | No package-size or mobile test in this evaluation. |
| Measured 22-body proxy | Five-run summary in §4; same-process repeats on one host, not a hardware-variance study. | Five-run summary in §4; same-process repeats on one host, not a hardware-variance study. | Not measured. |
| License / maintenance | Apache-2.0; official Dimforge JS package and documentation. | MIT JS port; Jolt core had active releases in 2026. JS wrapper is maintained separately from core. | PhysX core is BSD-3-Clause. The inspected WebIDL JS bindings are third-party and should be reviewed/version-pinned independently. |

Primary references: [Rapier capabilities and Apache license](https://rapier.rs/docs/), [Rapier JS determinism](https://rapier.rs/docs/user_guides/javascript/determinism/), [Rapier character controller limits](https://rapier.rs/docs/user_guides/javascript/character_controller/), and [Rapier joint constraints](https://rapier.rs/docs/user_guides/javascript/joint_constraints/). Jolt references: [JoltPhysics.js package, build variants, cleanup, and deterministic build flag](https://github.com/jrouwe/JoltPhysics.js/), [Jolt architecture and determinism](https://github.com/jrouwe/JoltPhysics/blob/master/Docs/Architecture.md), and [Jolt CharacterVirtual](https://jrouwe.github.io/JoltPhysics/class_character_virtual.html). PhysX references: [third-party PhysX 5.11 JS/WASM binding feature coverage](https://github.com/fabmax/physx-js-webidl) and [NVIDIA PhysX BSD-3-Clause license](https://github.com/NVIDIA-Omniverse/PhysX/blob/main/LICENSE.md). Rapier is actively maintained: its [JS changelog](https://github.com/dimforge/rapier.js/blob/master/CHANGELOG.md) and [core changelog](https://github.com/dimforge/rapier/blob/master/CHANGELOG.md) show 2026 changes. Jolt's [release list](https://github.com/jrouwe/JoltPhysics/releases) includes 2026 core releases.

## 3. Comparative prototype

The isolated harness is in this directory. Each player is one dynamic, freely translating and rotating rigid body with five attached 3D colliders (torso, pelvis, head, and two arm capsules). The model is intentionally a compact humanoid collision proxy, not an articulated skeleton. A fixed ground collider, gravity, mass, friction, damping, and CCD are enabled. Both engines receive the same positions, velocities, player masses, body shapes, fixed 1/120 s timestep, and test policies.

Approach velocities are explicit policy outputs. There is no random tackle-success draw. The `escape-attempt-strength-drive` case adds a deterministic forward motor after contact: 92 strength × 5.65 N/strength = 520 N for 0.55 seconds. This is an attempt to resist displacement; neither engine is told to mark a tackle broken or a player down. Both engines still exceeded the report's 55° tilt threshold for the carrier in this case. Also, this prototype has no limb grasp or wrap joint, so it tests collision and powered escape from contact, not a complete tackle latch or true broken tackle.

### Tackle results

Measured on an AMD EPYC x64 host, Node 22.22, four logical CPUs. Contact time is the first solver frame with body-body contact. Rapier reports its solver contact point and summed contact impulse. Jolt's JS path here detects body contact, estimates surface contact from the body centers and a proxy ellipsoid, and estimates carrier momentum change at first contact with gravity removed. This Jolt value is a momentum-change estimate, not a contact impulse; it can include simultaneous ground/support impulses and must not be compared in magnitude with Rapier's solver impulse. The recorded player momentum is diagnostic only; it is not a conservation audit because ground reactions, motor forces, and other external impulses are not included in a complete system balance.

| Scenario | Rapier contact time | Rapier contact impulse | Rapier fall (carrier/defender) | Jolt contact time | Jolt momentum-change estimate, includes ground/support | Jolt fall (carrier/defender) |
|---|---:|---:|---|---:|---:|---|
| Head-on | 0.217 s | 243 N·s | no / no | 0.200 s | 237 N·s | no / no |
| Side tackle | 0.208 s | 65 N·s | yes / yes | 0.200 s | 75 N·s | yes / yes |
| Rear pursuit | 0.375 s | 218 N·s | yes / yes | 0.358 s | 62 N·s | yes / yes |
| High speed | 0.100 s | 441 N·s | no / yes | 0.100 s | 423 N·s | yes / yes |
| Low speed | 0.575 s | 100 N·s | yes / no | 0.533 s | 6 N·s | yes / no |
| Glancing impact | 0.092 s | 69 N·s | yes / yes | 0.092 s | 43 N·s | yes / yes |
| Escape attempt with strength motor | 0.208 s | 196 N·s | yes / yes | 0.200 s | 244 N·s | yes / yes |

The complete contact points, impulse measures, momenta, player transforms, final angular velocities, tilt peaks, and finite-value flags are in [`results.json`](./results.json). Across the seven scenarios, one of 14 body-level fall classifications differs: in `high-speed`, the carrier does not fall in Rapier but does fall in Jolt. The other 13 classifications agree. The 12-cell contact-geometry sweep adds 24 body-level classifications and no further disagreement, making the combined record 1 of 38 classifications. This small controlled record is not evidence that either engine predicts NFL tackles.

### Contact-geometry sweep

**Controlled research inputs with a collision proxy; not a tackle model, not a prediction, and not validation against NFL data.** The sweep covers 4 approach headings × 3 closing speeds for each engine (12 cells per engine). The defender is stationary, faces downfield-opposite (-x), and has mass 108 kg. The 96 kg carrier starts 2 m away, travels into the defender, and is yaw-aligned with its velocity. Angle is the carrier travel heading relative to the defender's forward axis: 0° is head-on and 90° is side-on. Thus this varies body-relative approach orientation and arm-proxy orientation; it does not claim to sample every anatomical contact point. All cells use the same five-collider proxy, 1/120 s step, existing solver settings, 1.5 s duration, and 55° peak-tilt fall threshold. The carrier has only its initial velocity; no outcome draw, motor, or forced fall is used.

Each cell records contact occurrence/time, the engine-specific impulse measure, peak carrier and defender tilt, both fall flags, final body state, and a recursive finite-state flag in [`results-sweep.json`](./results-sweep.json). The artifact also stores paired fall-disagreement counts, shares, and cell lists. `R/J` means Rapier/Jolt. Rapier's impulse is its summed solver contact impulse. Jolt's column is a carrier momentum-change estimate that includes ground/support impulses, not a contact impulse. At 0°, 30°, and 90°, that estimate stays around 259–286 N·s across 4–8 m/s, so it must not be read as a contact impulse or compared in magnitude with Rapier's solver impulse. The 60°/8 m/s cell is lower (181.8 N·s), another reason not to interpret this estimate as an impact measurement.

| Approach | Closing speed (m/s) | Contact R/J | Time R/J (s) | Rapier solver impulse / Jolt momentum-change estimate, includes ground/support (N·s) | Peak tilt R carrier/defender; J carrier/defender (°) | Fall R carrier/defender | Fall J carrier/defender |
|---:|---:|---|---:|---:|---|---|---|
| 0° | 4 | yes / yes | 0.342 / 0.325 | 193.0 / 285.7 | 86.4/89.3; 86.4/89.3 | yes / yes | yes / yes |
| 0° | 6 | yes / yes | 0.233 / 0.225 | 231.3 / 258.8 | 90.0/89.2; 64.1/88.9 | yes / yes | yes / yes |
| 0° | 8 | yes / yes | 0.175 / 0.175 | 178.7 / 282.9 | 90.4/89.3; 90.2/89.3 | yes / yes | yes / yes |
| 30° | 4 | yes / yes | 0.342 / 0.325 | 188.5 / 285.7 | 86.4/88.9; 86.4/88.7 | yes / yes | yes / yes |
| 30° | 6 | yes / yes | 0.233 / 0.225 | 232.6 / 258.7 | 90.0/89.0; 71.7/89.3 | yes / yes | yes / yes |
| 30° | 8 | yes / yes | 0.175 / 0.175 | 185.0 / 282.7 | 91.9/89.3; 102.9/89.3 | yes / yes | yes / yes |
| 60° | 4 | yes / yes | 0.342 / 0.325 | 189.4 / 285.5 | 84.4/90.1; 86.4/90.0 | yes / yes | yes / yes |
| 60° | 6 | yes / yes | 0.233 / 0.225 | 220.0 / 258.6 | 90.0/90.0; 58.0/90.0 | yes / yes | yes / yes |
| 60° | 8 | yes / yes | 0.175 / 0.167 | 121.9 / 181.8 | 92.7/90.0; 67.7/86.4 | yes / yes | yes / yes |
| 90° | 4 | yes / yes | 0.342 / 0.325 | 203.7 / 285.4 | 89.7/85.5; 86.4/90.0 | yes / yes | yes / yes |
| 90° | 6 | yes / yes | 0.233 / 0.225 | 211.0 / 258.5 | 90.0/90.0; 65.1/91.0 | yes / yes | yes / yes |
| 90° | 8 | yes / yes | 0.183 / 0.175 | 309.3 / 282.7 | 96.3/90.0; 91.2/90.1 | yes / yes | yes / yes |

**Fall-classification disagreement across the 12 paired cells:** carrier 0/12 (0%; no cells); defender 0/12 (0%; no cells). Both engines classify both players as fallen in every cell.

**No-contact control:** The carrier was parked at x=60 m and the defender at the origin; both had zero velocity. The control used the same 1.5 s duration, five-collider proxy, 1/120 s step, masses, seed, and fall threshold. It recorded no contact and no fall for either engine. Carrier peak tilt was 0° in both; defender peak tilt was 8.373° in Rapier and 4.819° in Jolt. This confirms the sweep's falls are contact-induced rather than spontaneous toppling in the stationary control.

Each player here is a single freely rotating rigid body on the ground plane with no upright or balance controller. Once contact tips a body past the tipping point, it can roll flat; all contacting cells cross 55°. The binary fall threshold is therefore structurally non-discriminating within this proxy sweep: it cannot answer which contact conditions produce a fall. Peak tilt is the only usable continuous discriminator in these records, and it remains a proxy measurement.

Across the 12 paired cells, Jolt minus Rapier carrier peak tilt averages −10.15° (range −32.02° to +11.03°). Defender peak tilt is much closer: mean +0.14°, range −3.64° to +4.45° (maximum absolute difference 4.45°). The solvers agree closely on defender tilt and disagree substantially on carrier tilt. Jolt's carrier tilt is also non-monotonic with closing speed: at 6 m/s the 0°/30°/60°/90° values are 64.11°/71.68°/57.96°/65.10°, each below its corresponding 4 m/s value (about 86.4°). At 8 m/s they are 90.15°/102.93°/67.65°/91.18°; the 60° value is a further exception to a simple ordering. The diagnosis below rules out a material tilt-formula difference in the traced cells. These are engine-resolved coupled contact results; their physical correctness and precise solver/contact mechanism remain unvalidated. Do not smooth these results.

### Tilt diagnosis

The frozen sweep computes tilt from the rigid-body quaternion as `acos(1 − 2(x² + z²))`, the angle between world-up and the body's local +Y axis. The Jolt ellipsoid/body-center helper is **not** another tilt definition: it estimates a carrier contact point from the two body centers and an enclosing ellipsoid. Comparing it numerically with tilt would be comparing different quantities. I also computed the angle by independently normalizing the quaternion, rotating local +Y, and taking its angle to world-up. Across the traced Jolt carrier frames, the maximum absolute difference from the frozen formula is **0.00001103°**; for the defender it is **0.00001117°**. Both are negligible beside the roughly 20–30° speed reversals, so the non-monotonicity is not a tilt-measurement artifact. The traced maxima match the frozen sweep values.

The new [per-frame trace and probe artifact](./results/tilt-traces.json) records every 1/120 s frame for the requested cells, both engine versions, both quaternion calculations, per-collider peaks, angular velocity, and ground contact. Peak carrier summaries are:

| Approach / speed | Engine | Carrier peak tilt @ time | Angular velocity at peak (rad/s) | Ground contact at peak |
|---|---|---:|---|---|
| 60° / 4 m/s | Rapier | 84.404° @ 0.9917 s | [−0.448, −0.046, −0.500] | yes |
| 60° / 4 m/s | Jolt | 86.402° @ 1.4833 s | [−0.334, 0.000, −0.827] | yes |
| 60° / 6 m/s | Rapier | 89.981° @ 1.0583 s | [−3.525, −0.010, −3.781] | yes |
| 60° / 6 m/s | Jolt | 57.963° @ 1.5000 s | [−0.104, −0.683, −1.418] | yes |
| 60° / 8 m/s | Rapier | 92.732° @ 0.8917 s | [−0.487, −0.781, −3.045] | no |
| 60° / 8 m/s | Jolt | 67.653° @ 0.6917 s | [1.991, −5.401, −5.301] | no |
| 30° / 8 m/s | Rapier | 91.905° @ 0.8500 s | [−0.282, 0.511, −0.167] | no |
| 30° / 8 m/s | Jolt | 102.933° @ 1.5000 s | [5.615, −0.178, 3.191] | no |

Jolt's carrier passes flat only in the traced 30°/8 m/s cell: it first exceeds 90° at 1.2667 s (90.117°), and is not in ground contact then or at its 1.5000 s peak. The five colliders share one rigid-body orientation, so their per-collider rigid-body peak tilt is identical; the artifact additionally reports each capsule's long-axis inclination. The spherical head has no orientation-defined long axis.

To separate a measurement issue from a general contact-response pattern, I ran a single 96 kg five-collider body on the same plane and engine versions. Released upright from rest at center height 3.0 m for 2.0 s, peak tilt was 15.442° in Rapier and 8.742° in Jolt; both were in ground contact at the peak. After 24 settle steps, the body received a horizontal off-center impulse at world point [0, 1.445, 0] m. The magnitudes bracket the Rapier sweep's 121.9–309.3 N·s contact-impulse estimates; the Jolt sweep number is a different momentum-change estimate that includes support forces, so the scale comparison is approximate.

| Impulse (N·s) | Rapier peak tilt | Jolt peak tilt |
|---:|---:|---:|
| 120 | 86.390° | 86.408° |
| 180 | 86.384° | 93.341° |
| 240 | 107.165° | 121.479° |
| 300 | 174.091° | 176.964° |

The isolated Jolt response is monotone and does not reproduce the sweep reversal. Rapier's first step is effectively flat with a 0.007° decrease; its larger impulses increase tilt. This points to the two-player plus ground contact interaction as the location of the sweep behavior, but does not establish a solver defect or tell whether the response is physically accurate. The usable conclusion is that the quaternion metric is consistent and the coupled-solver outcome needs calibrated contact data before it can support football claims.

#### Contact mechanism

The [per-step contact probe](./results/contact-mechanism.json) records a Jolt 60° reversal within its 1.5-second window (86.402°, 57.963°, and 67.653° at 4, 6, and 8 m/s); its kinematic control does not show that pattern. The 57.963° value is the final tick of that window, however. The 7.5-second replay below rises to 89.935° at 900 ticks, with an observed interior maximum of 89.938° at tick 510. The 180-tick reversal is therefore a horizon effect and should not be treated as a sustained low-tilt response. Across the four original dynamic cells per engine, three peaks per engine occur during carrier-defender contact; the remaining peak is after separation with ground contact only (Rapier 60°/6 m/s; Jolt 60°/4 m/s). The largest cross-engine manifold difference is defender-ground contact-point multiplicity: averaged over active dynamic contact steps, Rapier reports 3.81 points versus Jolt's 1.63 (difference 2.17); carrier-ground is 2.54 versus 1.18, and carrier-defender is 1.81 versus 1.57. Rapier's normal impulse is its solver-reported value; Jolt's is a labeled estimate from relative point-velocity change because its JS contact listener does not expose solved normal lambda, so those impulse values are not directly comparable. This remains a contact-mechanism dependency, not a validated solver defect or football result.

The [900-tick contact-energy horizon](./results/contact-energy-horizon.json) replays both selected angle/speed cells in dynamic and kinematic modes, preserving the frozen geometry, masses, and solver settings. Each row gives tilt at ticks 180/360/600/900, observed maximum (tick), and whether the absolute change over ticks 800–900 is below 0.05°:

| Engine | Cell / defender | Tilt 180 / 360 / 600 / 900° | Observed max (tick) | Saturated |
|---|---|---:|---:|---|
| Rapier | 60°/6 m/s dynamic | 89.128 / 88.687 / 89.872 / 90.001 | 90.002° (762) | yes |
| Rapier | 60°/6 m/s kinematic | 87.686 / 88.261 / 89.958 / 90.001 | 90.002° (758) | yes |
| Jolt | 60°/6 m/s dynamic | 57.963 / 84.791 / 89.639 / 89.935 | 89.938° (510) | yes |
| Jolt | 60°/6 m/s kinematic | 83.922 / 88.744 / 89.318 / 89.998 | 90.000° (367) | yes |
| Rapier | 30°/8 m/s dynamic | 90.205 / 87.626 / 87.626 / 87.626 | 116.936° (234) | yes |
| Rapier | 30°/8 m/s kinematic | 90.062 / 89.992 / 90.001 / 90.001 | 90.106° (161) | yes |
| Jolt | 30°/8 m/s dynamic | 102.933 / 84.543 / 87.825 / 89.866 | 103.650° (182) | yes |
| Jolt | 30°/8 m/s kinematic | 86.772 / 88.840 / 89.998 / 89.998 | 90.000° (312) | yes |

The old 180-tick Jolt 30°/8 m/s value was also a boundary value: its extended maximum is 103.650° at tick 182, followed by a fall toward 90°. All listed maxima are interior to the 900-tick horizon. “Saturated” here is only the stated final-100-tick numerical criterion; it is not a claim of physical equilibrium.

The [180-tick energy ledger](./results/contact-energy.json) previously labeled the Jolt 60°/6 m/s result **energy diverted into defender motion**. That label is withdrawn: defender kinetic energy is 0.360645 J at the first logged tick and 0.356999 J at tick 180 (change −0.003646 J), while its 589.812 J descent term is gravitational potential energy release. Across the 66 active carrier-defender contact ticks (27–180), defender kinetic energy changes by only +0.355 J from the state before first contact to the last contact tick; an active-contact frame reaches +622.670 J relative to that pre-contact state at tick 71, but gravity and ground contact occur simultaneously, so this transient cannot be assigned to carrier-to-defender transfer from this ledger. Whole-system energy changes by −2,561.403 J; estimated normal-impulse work is −2,190.231 J and the remaining residual is −371.172 J. The corrected verdict is **not distinguishable by this ledger**. The Jolt normal impulse is inferred from relative point-velocity change and inverse mass; the residual also includes damping, tangential friction, and positional correction. A separate no-ground, zero-damping gravity-only control has no contacts over 900 ticks; maximum per-step energy drift is 0.185 J for Rapier and 0.707 J for Jolt, while cumulative drift is −118.808 J and −618.321 J. The test checks these runs against explicit bounds of 0.75 J per step and 625 J cumulative; this measures the engines' finite-step drift and does not claim exact conservation. The earlier 0.05 J limit was unexercised and is exceeded by both controls.

The reported 1.833 J gap is a baseline mismatch, not an omitted energy term: the per-step sum includes tick 0 to the first logged tick (−1.833409852 J), while “last minus first logged frame” starts at tick 1. From tick 0, the sum of all 180 deltas matches the endpoint energy change within 1.4×10⁻¹² J.

### Pass and ball contact

The harness passes the existing `solveLaunch()` output into a dynamic, collidable football-shaped capsule, integrates gravity and the existing spiral drag coefficient, and allows the ball to hit the receiver/defender geometry. Neither a catch nor a deflection is forced. In the primary trajectory, Rapier and Jolt both report receiver contact. In the second lane-placement test, Jolt contacts both defender and receiver; Rapier contacts the receiver only. Contact is reported as **catch/deflection feasibility only**: this does not prove a secure catch, possession, hand control, or an NFL-quality pass. Rapier records its solver contact point; Jolt records the ball center on the first step `WereBodiesInContact` reports.

## 4. 22-player runtime and stability

### Repeatability

The 22-player benchmark resets a fixed 11-offense / 11-defense formation, then advances 30 steps at 120 Hz (0.25 seconds simulated) per episode. Each of five repeats runs 20 warmup episodes before its timed loop; each timed loop contains 1,000 scenes (250 seconds of aggregate simulated time). Scene/WASM initialization is excluded. The finite-state check samples every 100th episode and the final episode to reduce measurement overhead. All five repeats, including the slowest, are retained in [`results.json`](./results.json). The five repeats ran in the same Node process on the same host, so their spread measures run-to-run variance, not hardware variance. IQR uses linearly interpolated Q1/Q3 (type-7 percentile convention).

| Engine | Bodies / colliders | Repeats × scenes × steps | Median ms/scene | Min ms/scene | Max ms/scene | IQR ms/scene | Sampled state checks |
|---|---:|---:|---:|---:|---:|---:|---|
| Rapier | 22 / 110 | 5 × 1,000 × 30 | 7.457 | 7.162 | 7.794 | 0.240 | all finite |
| Jolt | 22 / 110 | 5 × 1,000 × 30 | 3.859 | 3.692 | 4.705 | 0.115 | all finite |

World creation, a full play, and final game-event logic are excluded. These are not production throughput guarantees. Browser testing also ran 100 × 22-player episodes per engine in headless Chromium and checked finite transforms; those timings are included in the browser command output. No mobile device was benchmarked.

Same-engine repeated scenarios with identical initial conditions and the same recorded seed produced exact deep-equal Node results for both engines. The sweep test also repeats one grid cell per engine and requires exact deep equality. The seed is metadata only in this controlled harness because it uses no stochastic outcome policy; changing seed alone intentionally changes no physics. Cross-platform equality was not tested for Jolt. The browser test executed all 14 tackle cases, four pass cases, and both 22-player benchmarks without page/runtime errors.

## 5. Migration outline

1. Add a separate engine adapter under `engine/physics3d/` that owns engine initialization, fixed timestep, body/collider construction, contact collection, and snapshot/replay. Keep `World`, play selection, roster, historical data, and current renderer APIs stable behind an adapter boundary.
2. Add a 3D dynamic-player body model using player mass and measured height/weight inputs. Start from capsule/box/sphere proxies, then validate shape proportions, friction, CCD, solver iterations, floor support, and off-center contact using a labeled calibration set. The harness's five-shape one-body proxy is only a baseline.
3. Convert existing movement brains into force/torque policies. Add a bounded upright/balance controller, foot-ground/friction behavior, acceleration and turn-rate constraints, and deterministic drive inputs. Do not teleport dynamic bodies or set post-contact positions from desired outcomes.
4. Model blocking and tackling as collision plus explicit reach/grab policies. Test an arm/torso contact creating a constrained hold, then define measurable grip failure from constraint force/impulse and strength policy. This is required before claiming broken-tackle simulation.
5. Convert the football from a point mass to a rigid body while retaining the current aero force. Add hand/ball contact geometry and a catch-control policy that can capture only after an eligible physical hand contact, with relative-speed/orientation constraints. Misses, deflections, and catches then arise from trajectory/contact/policy state.
6. Keep two pathways: (a) prospective engine-driven plays with no future participant, catch-point, tackler, or end-spot anchors; (b) historical reconstruction that may still consume those anchors. Add contract tests proving the prospective adapter never receives them.
7. Before replacing anything, compare Rapier/Jolt on calibrated player shape sweeps, standing recovery, multi-player piles, explicit grasp/joint break, ball-hand interactions, snapshot replay, browser/mobile performance, and historical regression tests. Migrate only if distributions and failure modes improve without breaking reconstruction.

### Main risks and gates

- **Controller/solver coupling:** locomotion, traction, balance, contact, and body shape must be tuned together. A general-purpose engine does not supply a football movement model.
- **Joint stability:** articulated 22-player piles can cost more and be less stable than this one-body-per-player prototype. Limit iterations/constraint complexity and use deliberate joint break rules.
- **Pass interaction:** aerodynamic flight can be correct while hand collision/catch behavior remains wrong. Keep trajectory and catch success as separate validated components.
- **Replay:** pin engine/WASM versions, fixed step, entity insertion order, deterministic math/input construction, and snapshots. Do not assume a seed alone guarantees cross-platform determinism.
- **Runtime/footprint:** benchmark cold start, full play-length scenes, memory growth, and real mobile hardware before selecting the browser production bundle.
- **Historical path:** adapter boundaries must preserve the current seeded reconstruction and its real outcome anchors until a separate migration is accepted.

## 6. Reproduction

```sh
npm ci
npm run eval:physics3d:test
npm run eval:physics3d:sweep:test
npm run eval:physics3d:sweep
npm run eval:physics3d:browser
npm run eval:physics3d
```

`eval:physics3d` defaults to five repeats of 1,000 scenes per engine and writes [`results.json`](./results.json). Pass arguments to change scenes and steps per repeat, for example `node research/physics-3d-evaluation/benchmark.mjs 100 60`. `eval:physics3d:sweep` writes [`results-sweep.json`](./results-sweep.json); `eval:physics3d:sweep:test` checks its grid, finite records, repeated-cell determinism, and equality with the committed artifact. Generate and validate the tilt diagnosis with `node research/physics-3d-evaluation/tilt-diagnosis.mjs` and `node research/physics-3d-evaluation/test-tilt-diagnosis.mjs`. Generate and validate the contact-mechanism probe with `npm run eval:physics3d:contact` and `npm run eval:physics3d:contact:test`. Generate and validate contact-energy accounting with `npm run eval:physics3d:energy` and `npm run eval:physics3d:energy:test`; extend the contact-energy horizon with `npm run eval:physics3d:energy:horizon` and `npm run eval:physics3d:energy:horizon:test`.

The browser test expects a Playwright Chromium install (`npx playwright install chromium` where supported). It also accepts `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome`; the evaluation environment used its cached Chromium binary because Playwright's installer did not provide a matching image there.

## Limitations

- Five colliders rigidly attached to one body are not an articulated human or football uniform/helmet model.
- No simulated wrap/grasp, joint break, upright controller, independent limb motion, ball grip, completed catch, fumble rule, or tackle-state transition is included.
- The test policies and formations are controlled research inputs, not learned behaviors or representative playbook distributions.
- The pass test has one launch and two fixed defender alignments; it is not a passing evaluation set.
- Solver outputs are engine-specific. Impact impulses, fall thresholds, and outcome distributions need calibration against measured data before prospective use.
- A successful contact event or renderer pose is not a prediction and does not establish tackle/catch realism.
