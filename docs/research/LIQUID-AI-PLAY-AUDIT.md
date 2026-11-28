# Liquid AI play audit format

A deterministic play debugger, not a new football model. Use the public autonomous call
schema and the actual World.step loop. The initial fixtures are authored inside zone
and slant-flat against matching man assignments, with shared-snapshot arbitration.
They are synthetic; do not treat their outcomes as NFL calibration or the old DEN–PIT replay.

Run in a dedicated Node process:

```sh
node scripts/audit-liquid-ai-play.mjs /tmp/liquid-audit
node scripts/audit-liquid-ai-play.mjs /tmp/liquid-audit exact-call.json
```

Each play JSON contains the original call (lineups, ratings, assignment diagram),
every native physics tick, all 22 actual controller callbacks before/after, their
memory and desired motion, world before, after arbitration, after physics, actual
observation-memory capture/delivery/estimate calls, emitted events and final result.
Positions and velocities are in SI units. Player object references are represented by
stable IDs, not copied live pointers. The summary gives transition timelines by
role, observed-memory counts, result and hashes. Baseline and instrumented result,
event rows and reconciliation must match exactly.

Audit one role/assignment at a time while running the whole 11-on-11 play.
For each scenario define expected transition, allowed cue, prohibited information,
timing/geometry and observable pass criterion before altering controller code.
Review first divergence, not just final result. Start with RB mesh/press/cut,
OL gap/target selection, DL gap control and LB read/fit; then QB read and throw,
check-release and receiver contest, man/zone reactions. Repeat with a mirrored
call and one controlled counterfactual when needed. Do not tune toward a desired
play result.

Limits: this is recorded deterministic step-through, not a resumable VM or full
heap/RNG checkpoint. Closure-private calculations (e.g. individual lane scores,
QB candidate utility arrays and arbitration request queues) are not all exposed;
add small read-only decision-reason records at those specific sites only when
necessary. Global world truth in the diagnostic is not what a player knows.
ObservationMemory calls show actual observed inputs; direct world reads need
source review. Executor work between World.step calls appears in the next
before snapshot and the final world/result; within-tick events are captured
separately. Special-teams and LP game-loop auditing are not wired by this tool.
No production engine modifications, no repin and no large batch.

## Expanded running-back audit

The harness records actual lane-score terms, selected lane, applied steering lane, hold/lock guards and exact canonical gap labels on every evaluated read. These diagnostic records do not drive the controller. The default set varies assigned gap, run direction, field direction, defensive front, pass concept and coverage; two saved special-teams failure fixtures are also included. Open `liquid-ai-audit.html` in the generated artifact and load any play JSON. Step a native tick, skip to a selected player's state change or event, inspect desired velocity, before/after memory and score breakdown. The viewer is a read-only replay, not a live simulation mutation interface. No NFL calibration implied.
