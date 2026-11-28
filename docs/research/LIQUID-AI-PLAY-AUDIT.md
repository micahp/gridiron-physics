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

## Executed evidence — 2026-11-28

[Workflow 46159733586](https://github.com/micahp/gridiron-physics/actions/runs/46159733586), source commit 4d7518ee. Artifact liquid-ai-play-audit contains the eleven complete trace files, summaries and the local HTML viewer. Native dt 1/120 s; 4,831 ticks, 106,282 controller callbacks, 22 distinct players per tick, exact result/event/reconciliation parity for all eleven traced vs untraced calls. This is instrumentation parity, not realistic play acceptance. The viewer source was not browser-tested.

| Call | Ticks | Result |
|---|---:|---|
| Inside zone right, play-side A | 273 | tackle, -0.518 yd |
| Same call, backside C | 574 | tackle, +1.420 yd |
| Inside zone left | 361 | tackle, -0.546 yd |
| Right run, field direction reversed | 273 | tackle, -0.518 yd |
| Right run vs under front | 296 | tackle, -0.538 yd |
| Slant-flat/man | 307 | incomplete |
| Slant-flat/zone | 299 | incomplete |
| Curls/zone | 299 | incomplete |
| Four verticals/zone | 262 | incomplete |
| Saved blocked FG | 1218 | kicking-team recovery TD |
| Saved muffed kickoff | 669 | touchback |

RB findings: at 0.441667 s the handoff selects the declared A gap (-0.58 local yd); first scored read at 0.541667 s ranks A 0.1044, backside A 0.5517, play-side B 0.8774, play-side C 1.0716, backside B 1.7449, backside C 2.8379. At 0.741667 s C is preferred but the initial 0.34 s hold prevents switching. At 0.841667 s B is preferred (0.365668 vs A 0.448476), but 0.082808 advantage < 0.55 guard, so A remains selected. Against under, backside A scores 0.741094 vs assigned A 1.410487 at 0.541667 s, while initial hold is active. At 1.141667 s B replaces A (advantage 0.637340), then A replaces B at 1.341667 s (advantage 0.554162). Both transitions obey existing thresholds, but the short re-cut deserves review alongside actual blocking/leverage; do not tune from a single seed. The assigned-gap counterfactual alters path and gain; reversing field direction preserves gain and timing. No selected/applied mismatch was seen in these five runs. Source nevertheless computes desired velocity before the late near-defender alternate branch, so that branch can emit a new lane with stale intent for a tick; not reproduced here. Canonical trace gap labels expose the old inconsistent display-label thresholds. Scores are heuristic, use live local world coordinates/engagement, not actual inferred gap width or measured sightlines. Under uses the existing NB-to-SAM translation; a dedicated SAM fit is not established. No controller policy changed. Next audit: inspect the OL/DL/LB interactions during those exact read ticks, not retune RB threshold or expand to a large batch.

## Assigned run-controller candidate

Stop condition: replay the five existing run calls; compare exact original and candidate RB read times, assigned blockers' target changes and defensive recognition. Require no out-of-envelope selected zone-block target, no front pursuit without delayed visible cue, same selected/applied RB lane, and result reconciliation. Preserve old engine and prior results. Candidate uses the existing LB reaction-delay curve after a visible runner cue via ObservationMemory; it is a coarse body-visibility proxy for recognition, not measured eye tracking or possession perception. Assigned OL target selection stays in a one-and-a-half-lineman-spacing envelope around the declared track, prefers local DL then local LB, retains eligible targets, and otherwise holds the track. Explicit named blocks do not silently retarget. Block push follows the declared area instead of private RB lane state. Assigned front controls its gap until a delayed observed runner threatens it. Mapped SAM executes the declared force support instead of ignoring it. Fix RB late-cut steering order and canonical gap display without changing its score weights or switch thresholds. These are a simple research candidate, not learned blocking, tackling, or a promotion decision. Remaining direct world reads, DB recognition, physical double teams, actual dynamic gap width and passing controllers require separate work. No LP repin or large batch.

### First paired result and watchdog regression handling

The five paired calls passed local target, delayed front pursuit and selected/applied lane checks at 28ffd44a. Public callback-order regression passed. Workflow 46160674428 failed on the existing long-run fixture assertion (>12 s); candidate had a complete football result but different duration. Keep the original >12 s exact assertion against the pinned baseline 3ab7083b, record both results, and independently exercise the candidate loop at the old 12-second boundary with a test-only clock injection immediately after the real handoff. The latter is a narrow boundary test, not a claim of a naturally advancing 12-second candidate play. Do not change watchdog thresholds or fabricate terminal outcomes. Preserve legacy unassigned RB steering exactly. Artifact upload is unconditional to retain failures. Baseline source is explicitly pinned rather than HEAD^.
