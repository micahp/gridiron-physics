# M1b: Physical Tackling, Grip and Balance

## Result

The isolated harness demonstrates a retained-grip tackle, a grip that overloads and releases before the runner falls and recovers, and a missed attempt in both Rapier and Jolt. These outcomes are derived after simulation from contact, grip, tilt, fall, recovery, and forward-motion state. No random success draw or pose reset determines an outcome.

The harness also passes an airborne gravity-only energy control, shows active balance recovery and failure cases, and provides four recorded Three.js replays. This is a research prototype using rigid-body player proxies; it is not ready to replace the production solver.

## Method

Both engines run with gravity `[0, -9.81, 0]` and a 1/120 s football step. Player proxies use the same torso, pelvis, head, and two arm shapes, friction 0.72, restitution 0.04, linear damping 0.025, and angular damping 0.06. Rapier attaches five colliders to a player body; Jolt builds one compound shape from the equivalent parts. Rapier uses eight solver iterations. Jolt uses the JS package defaults because this adapter does not expose an equivalent iteration setting.

The balance controller reads the body quaternion, angular velocity, center-of-mass offset, and grounded state. It applies a bounded corrective torque, capped at 2,400 N·m before strength scaling. Disturbances and player drives are recorded as applied forces at their application points. The controller does not reset body poses or replace solver contacts.

The wrap proxy is a compliant point-to-point spring and damper between two torso-level anchors, applied as equal-and-opposite body forces and torques. It releases after two consecutive overload steps or 0.58 m of extension. The reported grip load is calculated from this controller force law; it is not a solver-reported constraint load. A real wrap uses articulated arms, hand placement, changing leverage, and distributed contact. This attachment does not model those effects.

## Energy controls

The airborne control contains one body and no collision surface, starts at 12 m, and runs for 2 s under gravity alone at 1/1200 s steps. Damping, other forces, and torques are zero. Linear kinetic, rotational kinetic, gravitational potential, and total mechanical energy are recorded on each of 2,400 steps. The acceptance tolerance is a 4% maximum relative frame drift.

| Engine | Initial energy | Final energy | Net drift | Maximum relative frame drift | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| Rapier | 301.673 J | 305.368 J | +3.695 J | 1.225% | Pass |
| Jolt | 301.673 J | 294.777 J | −6.896 J | 2.286% | Pass |

The separate ground case runs 210 steps at 1/120 s and first contacts the ground at 0.667 s. It uses friction 0.72, restitution 0.12, linear damping 0.025, and angular damping 0.06. Its total mechanical energy changes by −287.956 J in Rapier and −275.367 J in Jolt; this inelastic, damped case is not treated as energy-conserving.

Impulse sources remain separate. Rapier reports a summed solver normal impulse of 128.958 N·s in the ground case. Jolt has no solver impulse value in this adapter; its separately labeled 209.551 N·s momentum-change estimate removes the gravity increment but may include tangential contact and damping. These values are not equivalent measurements. For the successful tackle, Rapier reports 328.337 N·s from its contact manifold; Jolt's adapter does not expose a corresponding solver impulse.

## Balance and tackle outcomes

| Scenario | Rapier | Jolt |
| --- | --- | --- |
| Upright standing | Max tilt 0.95°; remained upright | Max tilt 0.49°; remained upright |
| Small lateral disturbance | Peak 22.86°; stabilized at 2.51° | Peak 20.98°; stabilized at 1.10° |
| Large disturbance | Fell; max tilt 178.67° | Fell; max tilt 177.96° |
| Glancing player contact | Both stayed upright; peak tilts 14.11° / 24.16° | Both stayed upright; peak tilts 15.30° / 19.19° |
| Asymmetric collision | Carrier fell; defender stayed upright (max 28.03°) | Carrier fell; defender stayed upright (max 29.36°) |
| Two-player push | Both stayed upright; peak tilts 16.74° / 15.44° | Both stayed upright; peak tilts 17.01° / 15.63° |
| Stumble replay | Peak 36.44°; stabilized at 23.07° | Peak 31.30°; stabilized at 17.32° |

The tackle event stream distinguishes all three requested outcomes:

| Outcome | Rapier | Jolt |
| --- | --- | --- |
| Successful tackle | Body contact at 0.092 s, grip retained, carrier fell and remained down; post-contact travel −7.10 m | Body contact and grip retained, carrier fell and remained down; post-contact travel −6.68 m |
| Broken tackle | Grip load 151.2 N exceeded 90 N capacity and released; carrier fell, recovered at 2.32 s, then escaped 5.50 m | Grip load 238.3 N exceeded 90 N capacity and released; carrier fell, recovered at 2.15 s, then escaped 7.85 m |
| Missed tackle | No body contact or grip; runner continued 1.64 m | No body contact or grip; runner continued 1.66 m |

Grip establishment follows the contact and wrap-height/closing-speed gates. Tackle labels are assigned from the resulting physical state: a retained grip with a fallen carrier is successful; a broken grip followed by a recovered or upright runner moving forward is broken; and no qualifying grip is missed. Other states remain `inconclusive`.

Nine input variations cover a 30° approach, lower and higher closing speeds, light and heavy carriers, strength disadvantage, low grip height, weak grip capacity, and stronger runner balance/drive. Both engines agree on the outcome of every variation. Only weak grip capacity consistently produces a broken tackle; relative-strength disadvantage, low contact height, and stronger runner balance/drive remain inconclusive. These first sweeps show sensitivity to several inputs but do not establish calibrated football thresholds.

## Engine comparison and benchmark

Three same-process repeats of each tackle replay produced identical event and summary signatures in both engines. This establishes repeatability for these harness scenarios on this runtime, not cross-platform determinism.

The 22-player benchmark runs 12,000 measured steps (100 simulated seconds) per repeat, with three repeats and a 120-step warm-up. It covers 300 simulated seconds per engine. The prior evaluation used 30-step (0.25-second) episodes repeated 1,000 times per measured loop, for 250 aggregate simulated seconds; the M1b run therefore adds both a longer continuous trajectory and more aggregate simulation time. Median wall time was 54.92 ms per simulated second for Rapier (samples 54.28, 55.41, 54.92) and 33.79 ms for Jolt (33.79, 34.37, 31.72). The contact counter reported 11,969 contact steps for Rapier and 11,763 for Jolt. The difference in collider representation, solver settings, contact reporting, and contact counts makes this a harness cost comparison, not a matched-equivalence speed verdict.

The process-level memory deltas were +2.89 MB RSS / −6.42 MB heap for Rapier and +117.10 MB RSS / +12.49 MB heap for Jolt. These are Node process deltas around repeated scene creation and destruction, not per-engine peak or live WASM allocations; they are too noisy to support a memory ranking.

Rapier reports 0 m maximum manifold penetration depth in the recorded tackle contacts. The tested Jolt adapter does not expose manifold depth, so Jolt penetration is unmeasured. All recorded result states are finite. The adapter differences and the synthetic, short-duration benchmark limit conclusions about stability and performance.

## Reproduce and inspect

From the repository root:

```sh
npm run eval:physics3d:m1b
npm run eval:physics3d:m1b:test
npm run eval:physics3d:m1b:browser
npm test
```

The browser test launches Chromium, serves the local page, and checks all four replays, Three.js rendering, physics-driven player poses, debug overlays, and both engine selections. For manual inspection, serve the repository root and open `research/physics-3d-evaluation/m1b/`.

The full per-step energy traces, replay frames, events, variations, repeatability signatures, and benchmark samples are in [`results/m1b-results.json`](./results/m1b-results.json). Open [`index.html`](./index.html) for the replay selector and optional debug view.

The existing research test suites and repository `npm test` passed during this work, as did the M1b simulation and browser checks.

## Limitations and next decision

The body model has no articulated skeleton, muscle activation, anatomical joint limits, hands, or validated strength/balance calibration. The grip is one torso-level attachment. The missed case is a clean miss without body contact; defender limb deflection is not represented. The scenario sweep is small and several input changes remain inconclusive. Jolt solver impulse, penetration depth, and iteration configuration are unavailable through the adapter used here. Secure ball catching is not implemented.

Keep Rapier and Jolt as competing research implementations; do not promote either into production on these results. The next integration experiment should add a ball and hand-contact/attachment model, then compare secure possession against deflection and drop outcomes using matched trajectories in both engines. Before using ratings or game outcomes, calibrate the balance and grip policies against measured movement or film-derived trajectories. Fully articulated arms and hands should be evaluated as a separate grip model.
