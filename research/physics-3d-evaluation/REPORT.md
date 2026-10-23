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
| Measured 22-body proxy | 7.62 ms per 0.25 simulated seconds, for 22 bodies / 110 colliders / 30 fixed steps on the recorded host. | 3.53 ms per same episode and host. | Not measured. |
| License / maintenance | Apache-2.0; official Dimforge JS package and documentation. | MIT JS port; Jolt core had active releases in 2026. JS wrapper is maintained separately from core. | PhysX core is BSD-3-Clause. The inspected WebIDL JS bindings are third-party and should be reviewed/version-pinned independently. |

Primary references: [Rapier capabilities and Apache license](https://rapier.rs/docs/), [Rapier JS determinism](https://rapier.rs/docs/user_guides/javascript/determinism/), [Rapier character controller limits](https://rapier.rs/docs/user_guides/javascript/character_controller/), and [Rapier joint constraints](https://rapier.rs/docs/user_guides/javascript/joint_constraints/). Jolt references: [JoltPhysics.js package, build variants, cleanup, and deterministic build flag](https://github.com/jrouwe/JoltPhysics.js/), [Jolt architecture and determinism](https://github.com/jrouwe/JoltPhysics/blob/master/Docs/Architecture.md), and [Jolt CharacterVirtual](https://jrouwe.github.io/JoltPhysics/class_character_virtual.html). PhysX references: [third-party PhysX 5.11 JS/WASM binding feature coverage](https://github.com/fabmax/physx-js-webidl) and [NVIDIA PhysX BSD-3-Clause license](https://github.com/NVIDIA-Omniverse/PhysX/blob/main/LICENSE.md). Rapier is actively maintained: its [JS changelog](https://github.com/dimforge/rapier.js/blob/master/CHANGELOG.md) and [core changelog](https://github.com/dimforge/rapier/blob/master/CHANGELOG.md) show 2026 changes. Jolt's [release list](https://github.com/jrouwe/JoltPhysics/releases) includes 2026 core releases.

## 3. Comparative prototype

The isolated harness is in this directory. Each player is one dynamic, freely translating and rotating rigid body with five attached 3D colliders (torso, pelvis, head, and two arm capsules). The model is intentionally a compact humanoid collision proxy, not an articulated skeleton. A fixed ground collider, gravity, mass, friction, damping, and CCD are enabled. Both engines receive the same positions, velocities, player masses, body shapes, fixed 1/120 s timestep, and test policies.

Approach velocities are explicit policy outputs. There is no random tackle-success draw. The `escape-attempt-strength-drive` case adds a deterministic forward motor after contact: 92 strength × 5.65 N/strength = 520 N for 0.55 seconds. This is an attempt to resist displacement; neither engine is told to mark a tackle broken or a player down. Both engines still exceeded the report's 55° tilt threshold for the carrier in this case. Also, this prototype has no limb grasp or wrap joint, so it tests collision and powered escape from contact, not a complete tackle latch or true broken tackle.

### Tackle results

Measured on an AMD EPYC x64 host, Node 22.22, four logical CPUs. Contact time is the first solver frame with body-body contact. Rapier reports its solver contact point and summed contact impulse. Jolt's JS path here detects body contact, estimates surface contact from the body centers and a proxy ellipsoid, and estimates impulse from the carrier momentum change at first contact with gravity removed. Jolt's impulse estimate can include simultaneous ground/support impulses, so these impulse magnitudes are not a calibrated cross-engine comparison. The recorded player momentum is diagnostic only; it is not a conservation audit because ground reactions, motor forces, and other external impulses are not included in a complete system balance.

| Scenario | Rapier contact time | Rapier contact impulse | Rapier fall (carrier/defender) | Jolt contact time | Jolt impulse estimate | Jolt fall (carrier/defender) |
|---|---:|---:|---|---:|---:|---|
| Head-on | 0.217 s | 243 N·s | no / no | 0.200 s | 237 N·s | no / no |
| Side tackle | 0.208 s | 65 N·s | yes / yes | 0.200 s | 75 N·s | yes / yes |
| Rear pursuit | 0.375 s | 218 N·s | yes / yes | 0.358 s | 62 N·s | yes / yes |
| High speed | 0.100 s | 441 N·s | no / yes | 0.100 s | 423 N·s | yes / yes |
| Low speed | 0.575 s | 100 N·s | yes / no | 0.533 s | 6 N·s | yes / no |
| Glancing impact | 0.092 s | 69 N·s | yes / yes | 0.092 s | 43 N·s | yes / yes |
| Escape attempt with strength motor | 0.208 s | 196 N·s | yes / yes | 0.200 s | 244 N·s | yes / yes |

The complete contact points, impulses, momenta, player transforms, final angular velocities, tilt peaks, and finite-value flags are in [`results.json`](./results.json). Engine results diverge in whether the same contact geometry produces a fall. That is evidence of sensitivity to geometry, solver settings, and contact/friction calibration, not evidence that either one currently predicts NFL tackles.

### Pass and ball contact

The harness passes the existing `solveLaunch()` output into a dynamic, collidable football-shaped capsule, integrates gravity and the existing spiral drag coefficient, and allows the ball to hit the receiver/defender geometry. Neither a catch nor a deflection is forced. In the primary trajectory, Rapier and Jolt both report receiver contact. In the second lane-placement test, Jolt contacts both defender and receiver; Rapier contacts the receiver only. Contact is reported as **catch/deflection feasibility only**: this does not prove a secure catch, possession, hand control, or an NFL-quality pass. Rapier records its solver contact point; Jolt records the ball center on the first step `WereBodiesInContact` reports.

## 4. 22-player runtime and stability

The 22-player benchmark resets a fixed 11-offense / 11-defense formation, then advances 30 steps at 120 Hz (0.25 seconds simulated) per episode. Each engine receives 20 warmup episodes; scene/WASM initialization is outside the timed loop. The final command ran **1,000 scenes per engine**, which is 250 seconds of aggregate simulated time. The finite-state check samples every 100th episode and the final episode to reduce measurement overhead.

| Engine | Bodies / colliders | Episodes × steps | Wall time | Per episode | Projected 1,000 × 1-second scenes* | Sampled state checks |
|---|---:|---:|---:|---:|---:|---|
| Rapier | 22 / 110 | 1,000 × 30 | 7.62 s | 7.62 ms | 30.49 s | all finite |
| Jolt | 22 / 110 | 1,000 × 30 | 3.53 s | 3.53 ms | 14.13 s | all finite |

\*Linear 4× extrapolation of this 0.25-second proxy episode; world creation, a full play, and final game-event logic are excluded. It is not a production throughput guarantee. Browser testing also ran 100 × 22-player episodes per engine in headless Chromium and checked finite transforms; those timings are included in the browser command output. No mobile device was benchmarked.

Same-engine repeated scenarios with identical initial conditions and the same recorded seed produced exact deep-equal Node results for both engines. The seed is metadata only in this controlled harness because it uses no stochastic outcome policy; changing seed alone intentionally changes no physics. Cross-platform equality was not tested for Jolt. The browser test executed all 14 tackle cases, four pass cases, and both 22-player benchmarks without page/runtime errors.

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
npm run eval:physics3d:browser
npm run eval:physics3d
```

`eval:physics3d` defaults to 1,000 scenes per engine and writes [`results.json`](./results.json). Pass arguments to change workload, for example `node research/physics-3d-evaluation/benchmark.mjs 100 60`.

The browser test expects a Playwright Chromium install (`npx playwright install chromium` where supported). It also accepts `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome`; the evaluation environment used its cached Chromium binary because Playwright's installer did not provide a matching image there.

## Limitations

- Five colliders rigidly attached to one body are not an articulated human or football uniform/helmet model.
- No simulated wrap/grasp, joint break, upright controller, independent limb motion, ball grip, completed catch, fumble rule, or tackle-state transition is included.
- The test policies and formations are controlled research inputs, not learned behaviors or representative playbook distributions.
- The pass test has one launch and two fixed defender alignments; it is not a passing evaluation set.
- Solver outputs are engine-specific. Impact impulses, fall thresholds, and outcome distributions need calibration against measured data before prospective use.
- A successful contact event or renderer pose is not a prediction and does not establish tackle/catch realism.
