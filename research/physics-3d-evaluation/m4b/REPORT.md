# M4b multi-player contact evaluation

## Scope and method

This is a controlled engine stress study, not a model of observed NFL outcomes. The production solver was not changed. Rapier `@dimforge/rapier3d-compat` 0.21.0 and Jolt `jolt-physics` 1.1.0 ran the same seeded fixtures at a fixed 120 Hz timestep. The archive records source commit, solver version, seed, fixture inputs, timestep, and initial state.

The library contains 16 scenarios covering opposing and staggered gang tackles, blocker congestion, shared-sack contact, loose-ball scrums, an escaping ball, an eight-player tush push, and a 22-player line. Each run simulated 7.5 seconds (900 steps). Five representative scenarios retain transforms at all 120 steps per second; other full-duration replays are sampled at 20 Hz. The stress sweep varies 41 inputs per body profile across two solvers (164 runs total), simulating 2.5 seconds each. Every result is retained, including failed interactions and earlier implementation failures.

Two player proxies were compared: one freely rotating capsule, and a freely rotating rigid compound of five fixed capsules/spheres. Neither is an articulated player. The torso wrap is a compliant equal-and-opposite force model, and the carried-ball cradle is another explicit force model; neither uses hand or limb joints. Once released, the rounded-box football has actual 3D rigid-body collisions. No random outcome draws are used. Inputs and ratings are fixture values, not a player-rating dataset.

## Results

| Dimension | Findings |
| --- | --- |
| Physical validity | Both engines resolve genuine 3D multi-body contacts, rotations, off-center impacts, ground contacts, and loose-ball flight. The opposing two-defender tackle reaches both defenders in one physics timestep: 0.133 s for capsule proxies and 0.125 s for compound proxies. The congested tackle, eight-player scrum, and 22-player line also produce contacts. Limits are substantial: maximum reported penetration reaches 0.300 m (Rapier capsule), 0.307 m (Jolt capsule), and 0.250 m (both compound profiles). Several intended interactions never make body contact. Finite numbers alone do not mean a fixture succeeded. |
| Football-mechanism support | Contact events identify contributing players and first-contact times when contact occurs. Compound-player shared-rusher fixtures record both rushers contacting the quarterback in the same timestep (Rapier 0.317 s; Jolt 0.292 s), but neither records a completed takedown. No official half-sack credit is assigned. The compound eight-player fumble produces a loose live ball in both engines; the capsule version remains carried in this fixture. A separate escape fixture releases the ball and sends it beyond the pile in both engines. Recovery stays **unresolved** because articulated hands and secure possession are absent. Snap reception also stays unresolved. Forward progress is raw carrier and football trajectory data, with no automatic first down, touchdown, or official spot. |
| Repeatability | Repeated runs have exact within-process signatures for the opposing-tackle control and the 4 m/s sweep control for both engines and profiles. Outcomes are not randomized. Cross-machine or cross-version determinism has not been established. |
| Performance | On the recorded AMD EPYC x64 host, scenario wall-time medians / means were 1.71 / 0.67 s (Rapier capsule), 1.80 / 0.57 s (Jolt capsule), 2.14 / 0.85 s (Rapier compound), and 1.44 / 0.67 s (Jolt compound). Each scenario is a single local measurement; this harness is exploratory, not a warmed benchmark, so these values do not establish an engine ranking. |
| Visual quality | The Three.js archive replays stored transforms side by side at synchronized simulation time. The 60 screenshots use fixed All-22, sideline, and close-up cameras; ten VP9 WebM clips compare the two player proxies for five representative scenarios, separately for Rapier and Jolt. Each clip shows simulation timestamps 0–7.5 s (91 frames at 12 fps; about 7.58 s encoded). Visual appearance has no realism score and is not evidence of NFL predictive validity. |
| Unsupported behavior | Articulated limbs, anatomical foot traction, hand grasp, secure loose-ball recovery, validated throwing/catching control, and a rules/scoring layer are not implemented. Balance is a torque controller. Wraps and carries are force proxies. Rapier exposes solver normal impulses in this harness; Jolt's JS wrapper does not expose equivalent impulses, so its impulse estimates are explicitly approximate and can be confounded by simultaneous contacts and external forces. |

The final benchmark completed 64 scenario runs with zero runtime failures and no non-finite state. However, the latest fixtures include no-contact cases: `gang-three-upright` (both profiles and engines), `sack-initiate-finish` and `sack-throw-window` (both profiles and engines), plus `gang-staggered-three` for the capsule/Rapier run. Those remain failed interactions in the archive, not successful outcomes. An early Jolt run that called an unavailable angular-velocity API is also preserved as a failed result; the API use was corrected in later commits. The stress sweeps completed 164 runs with no non-finite state, and exact repeat results for their 4 m/s controls.

Energy, system linear/angular momentum, body transforms, angular and linear velocities, configured forces/torques, ground contacts, player contacts, and event/contact timestamps are recorded. Gravity, ground reactions, scenario impulses, and controller forces are external inputs; the data do not claim closed-system energy or momentum conservation. Rapier's manifold impulse reporting and Jolt's approximate estimates are labeled separately.

## Human review clips

Each clip shows the same solver on the left and right, comparing the capsule and compound profiles at the same simulation time. Use the interactive archive to compare Rapier directly against Jolt or to select historical commits and seeds.

| Scenario | Rapier comparison | Jolt comparison |
| --- | --- | --- |
| Opposing two-defender tackle | [WebM](videos/gang-two-opposite-open/rapier3d-compat-f43346ecb9-vs-f43346ecb9-seed-41027-sideline.webm) | [WebM](videos/gang-two-opposite-open/jolt-physics-js-f43346ecb9-vs-f43346ecb9-seed-41027-sideline.webm) |
| Simultaneous quarterback contact | [WebM](videos/sack-simultaneous-two/rapier3d-compat-f43346ecb9-vs-f43346ecb9-seed-41027-sideline.webm) | [WebM](videos/sack-simultaneous-two/jolt-physics-js-f43346ecb9-vs-f43346ecb9-seed-41027-sideline.webm) |
| Eight-player loose-ball pile | [WebM](videos/fumble-eight-pile-live-ball/rapier3d-compat-f43346ecb9-vs-f43346ecb9-seed-41027-sideline.webm) | [WebM](videos/fumble-eight-pile-live-ball/jolt-physics-js-f43346ecb9-vs-f43346ecb9-seed-41027-sideline.webm) |
| Ball escapes the pile | [WebM](videos/fumble-eight-pile-ball-escapes/rapier3d-compat-f43346ecb9-vs-f43346ecb9-seed-41027-sideline.webm) | [WebM](videos/fumble-eight-pile-ball-escapes/jolt-physics-js-f43346ecb9-vs-f43346ecb9-seed-41027-sideline.webm) |
| Eight-player short-yardage scrum | [WebM](videos/tush-push-eight/rapier3d-compat-f43346ecb9-vs-f43346ecb9-seed-41027-sideline.webm) | [WebM](videos/tush-push-eight/jolt-physics-js-f43346ecb9-vs-f43346ecb9-seed-41027-sideline.webm) |

## Reproduction and archive access

From the repository root:

```sh
npm run eval:m4b:test
npm run eval:m4b -- proxy-v1-single-capsule 41027
npm run eval:m4b -- proxy-v2-compound 41027
npm run eval:m4b:sweep -- proxy-v1-single-capsule 41027
npm run eval:m4b:sweep -- proxy-v2-compound 41027
npm run eval:m4b:capture -- 41027
```

Each benchmark command writes an immutable path keyed by profile, source commit, and seed. Choose a new commit or seed to create another record. Serve the viewer with `npm run serve`, then open `http://localhost:8080/research/physics-3d-evaluation/m4b/archive/`. The archive index is `research/physics-3d-evaluation/m4b/results/archive-index.json`; compressed full replays are under `results/<profile>/<commit-prefix>/seed-<seed>/<engine>/`, and sweeps are under `results/sweeps/<profile>/<commit-prefix>/seed-<seed>/`.

These experiments identify implementation limits under synthetic football-like conditions. Neither engine is shown to predict real NFL events; that would require comparison against suitable observed data.
