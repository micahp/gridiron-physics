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

### Actual role interactions from the first paired audit

| Run | Baseline yards | Candidate yards | Local target checks | Front fit checks | Delayed pursuit checks | RB steering checks |
|---|---:|---:|---:|---:|---:|---:|
| Right | -0.518 | 2.060 | 258 | 976 | 639 | 226 |
| Backside C | 1.420 | 2.454 | 219 | 666 | 272 | 214 |
| Left | -0.546 | 15.023 | 246 | 842 | 277 | 376 |
| Reversed field | -0.518 | 2.060 | 258 | 976 | 639 | 226 |
| Under | -0.538 | 3.610 | 161 | 836 | 340 | 201 |

Baseline under at 1.141667s: RG (play-side B) and RT (play-side C) both target WILL, C engages RDT, TE engages RDE, MIKE pursues exact live carrier with no recognition memory. RB selects B. At 1.341667s, RG is engaged with MIKE and RT with WILL; RB selects A again. Candidate under selects A at handoff and B at 0.941667s, with no immediate reversal. Baseline right RT selects RDT, RDE, LDE, WILL, MIKE; candidate RDT, WILL, RDE. Right MIKE recognition at 0.808333s follows its first visible cue at 0.608333s (rating delay 0.196s); baseline pursues at handoff 0.441667s. Candidate WILL recognizes as late as 2.30s: this may be too slow and is not evidence that visibility proxy is accurate. Left run 15 yards is another warning against treating yardage improvement as validation. The joint candidate changes multiple mechanisms, so no individual causal attribution is established. No separate tuning or broad batch; keep unadopted until role behavior is reviewed, particularly defensive cue availability/occlusion and blocking coordination.

Original [workflow 46160674428](https://github.com/micahp/gridiron-physics/actions/runs/46160674428) passed paired checks and callback-order check but failed the old fixed-duration regression. Follow-up source 88098164 retains baseline assertion and independently checks candidate clock boundary. [Follow-up workflow 46160863730](https://github.com/micahp/gridiron-physics/actions/runs/46160863730) records validation; use its actual result rather than assuming success.

## Passing role audit

Retain the four exact incomplete calls and compare the existing retro and detailed modes (no new policy). Record actual QB candidate utility, readiness, launch target/error and flight time, receiver and coverage observations/recognition, every descending catch-candidate set, and actual contest draws. Catch resolution outside World.step is retained in `outside_tick_reasons`; this fixes the prior trace boundary blind spot. Require exact traced/untraced result and event parity. Compare information budgets explicitly: retro QB reads current receiver/defender positions; detailed QB reads delayed observations. Neither four authored calls nor this counterfactual establish NFL calibration. No scoring threshold changes.

### Confirmed coverage-contact defect and bounded repair

Baseline [workflow 46162054131](https://github.com/micahp/gridiron-physics/actions/runs/46162054131), 4 authored calls x 2 existing modes, all traced/untraced parity. Retro intended-receiver reach counts 0/4, no catch probability draws on three calls; fourth is strong safety contact before recognition. Detailed mode completes two of four, not proof of superiority. Four verticals retro: throw 1.041667s, SS intentional interception draw at 1.741667s (1.359 yd center distance), first SS break 2.05s, first delivered throw estimate 1.80s. Thus old catch resolver bypasses its actual role controller. Gate intentional assigned non-rush defender contest by actual recognized observation state. No contact radius, probability, trajectory or ratings changes. Keep geometric reach counts distinct from recognized contact. Accidental body tips are not modeled by this change, and rush-player tip eligibility remains unchanged. Baseline pinned to ca5850254; exact same eight calls replayed, require reproduction and removal of early draw, preserve recognized opportunities and result/event parity. Receiver steering, detailed vs retro information budget, pass-rush/line-tip behavior and post-catch pursuit remain separate unresolved audit areas; do not promote based on this small authored cohort.

Coverage gate at 0e9f48cb reproduced and rejected the exact SS attempt (18 rejected physical ticks; two recognized coverage draws remained across eight calls). Four verticals retro changed from incomplete to a WR3 catch/TD; other seven terminal categories unchanged. This is not statistical accuracy evidence. Coverage, receiving activation and simultaneous-contact order regressions passed. The broad passing regression failed at the old unassigned seed-6 forced-fumble fixture (null fumble). It is retained unchanged; exact original engine comparison is added before attributing causality. Follow-up b3874ab8 separates geometric contact identity from recognition eligibility so temporary recognition loss cannot re-arm a probability draw without physical separation. Require at most one draw per uninterrupted physical opportunity in the paired calls. No repin.


## Post-possession audit continuation

Workflow [46162410401](https://github.com/micahp/gridiron-physics/actions/runs/46162410401) passed the exact pinned unassigned seed-6 comparison, all eight paired coverage calls (18 premature ticks rejected, two recognized draws retained), and paired run checks. The full passing suite still failed at `test/autonomous-pass.mjs:185`: both frozen 1cb375c6 and b9c8cb29 return a 23.77754-yard tackle and null fumble for CAR=1 and CAR=99. This proves the failure predates the Liquid AI coverage changes, not that fumble behavior is correct.

Next bounded audit: expose the existing force/security calculation and the actual RNG draw at contact without consuming a new draw; require low/high CAR to share their first contact and draw, but do not require an arbitrary seed to fumble. Retain the original failing regression unchanged. Trace actual post-catch and post-interception pursuit on previously authored calls, measure first target and whether delivered carrier observations exist, and retain missing scenario coverage explicitly. Source currently uses exact live carrier coordinates after a timer or immediately on a turnover; timers alone do not establish perception. This is instrumentation only; no behavior, rating, RNG, fixture, or adoption change. Results pending execution.


## Executed contact evidence and assigned pursuit candidate

[Workflow 46162937229](https://github.com/micahp/gridiron-physics/actions/runs/46162937229) proved the original unassigned seed 6 has one identical contact (RCB vs WR3 at 4.758333 s, force 101.22643, RNG draw 0.7090613486). CAR 1 chance 0.14, CAR 99 chance 0.0151170019: neither should fumble. Keep the exact seed-6 no-fumble contract and the original positive recovery/return assertions, finding a positive synthetic witness in a bounded fixed 128-seed cohort; log the first qualifying seed and pin after execution. No fumble formula or RNG change. This is fixture reachability, not calibration.

The three post-possession calls produced 31 first opponent pursuit decisions with exact live coordinates and no delivered carrier estimate. The old interception scenario seed 15 actually caught the pass on offense. Preserve that call and independently find a positive interception/pursuit witness in the fixed 0–95 seed range; report missing coverage as failure, not success.

Candidate: assigned passing opponent pursuit after a catch, QB run or interception uses existing ObservationMemory, a rating-derived delay, geometric FOV/occlusion and bounded memory. A visible carrier body is a coarse cue, not true ball-in-hand recognition. Pursuit is computed solely from the delivered position and velocity; no observation means braking and scanning from own heading; engaged players respond to local physical contact. Unassigned legacy execution stays unchanged. The audit asserts actual memory consumption, delay, target reconstruction, exact trace parity and no-observation fallback on the real executor. The global possession phase/identity still dispatches roles; same-team escort, loose ball, fumble return, contact tackle eligibility, pre-catch coverage and actual gaze behavior are not repaired by this candidate. Existing support fixture assumptions about instant opponent pursuit need independent review; no full-game or NFL calibration claim. No promotion or LP repin. Candidate and witness results pending.


## Executed pursuit candidate and next audit

[CI 46163609227](https://github.com/micahp/gridiron-physics/actions/runs/46163609227) passed the possession audit: 894 pursuit decisions reconstructed from actual delivered estimates, 253 search decisions, no privileged target coordinates in the audited opponent-pursuit path. Four-verticals 55-yard TD became 53.223-yard OOB; slant-flat 52.868-yard OOB became 53.357-yard tackle; old seed-15 call still catches (37.751-yard OOB). Some defenders take several seconds to acquire a carrier; this is a warning, not realism validation. Turnover witness seed 83 (first qualifying of 84 development attempts) produced a WLB interception at 3.391667 s and four pursuit decisions. Pin the exact seed rather than repeatedly searching. Require capture provenance, search brake geometry and callback reversal parity. The old possession-support fixture seed 15 is preserved in the audit; its positive contract uses seed 83 and immediate search/local-contact rather than omniscient pursuit. The legacy passing suite failed on the newly added cross-rating full-event equality because unassigned CTH falls back to CAR and catch_contest probabilities legitimately differ (0.634 vs 0.97). Correct only that assertion to compare the exact terminal and contact events; the same-contact actual RNG audit remains mandatory. No probability or physics change.

Next: assigned man coverage uses exact live receiver position/velocity and exact facing, independent of sightlines. Instrument the actual steering branch, with read-only geometric visibility probe, trace parity and target/desired-velocity reconstruction. Four authored man calls (slant-flat, curls, four-verticals, reversed field) plus a zone negative control; require at least one invisible target without delivered observation before changing steering. Record occlusion, FOV and memory availability by role. This is the next bounded diagnosis, not a new policy or an NFL calibration experiment. No LP repin.
