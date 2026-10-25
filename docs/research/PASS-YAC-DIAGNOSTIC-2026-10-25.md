# Pass yards-after-catch and contest diagnostic, 2026-10-25

Scope: read-only diagnosis on the tuning seeds (`tune-*`, default protection unless noted) of the
experiment branch `exp/qb-pocket-2026-10-25`. No outcome tuning, no evaluation seeds, no changes to
Stage One, PR #25, or the primary checkout. Engine positions in frames are yards.

## Current numbers (branch at `318ee14`, with the return-progress fix from this report)

| Metric (all protection levels, 1,200 dropbacks) | Experiment | Baseline `e8ef2ca` |
|---|---|---|
| Completion | 53.2% | 82.8% |
| Interception | 0.1% | 2.6% |
| Offensive TD | 4.7% | 11.4% |
| Median yards after catch | 13.8 | 12.4 |
| Yards per attempt | 10.3 | 15.8 |

The 26.7 yards-after-catch and 16.4% touchdown figures in the earlier report were measured before the
pursuit fix (`318ee14`). They are not current.

## Yards after catch

Completions on the default-protection tuning seeds (220 completions): median yards after catch 13.6,
median air yards 3.1, 24.5% gain more than 20 yards after the catch.

Break mechanism:
- Each contact finishes the tackle about 60% of the time (`finishChance` near 0.43 plus small terms).
- Mean breaks per completion 0.58. A failed contact also gives the defender a 1.0 s recovery window
  (`missUntil = W.t + 1.0`), so each break buys the carrier roughly a second of free running.
- Median yards after catch by breaks: 0 breaks 12.7 (n=151); 1 break 14.1 (n=38); 2 breaks 21.1 (n=17);
  3 breaks 32.6 (n=5); 4 or more 32.9 (n=9).

Zero-break completions (n=130): the first tackle attempt comes a median 1.97 s after the catch, after the
carrier has gained a median 11.9 yards. The first attempt is made by the free safety in 78 of 130 cases.
After that first contact the carrier gains only 1.2 yards, so post-contact momentum is not the source.

Pursuit trace (`tune-9-9`): the nearest defender gets to about 1 yard, then its heading error swings
121, 163 and 104 degrees and its speed falls to about 1 yard per second. `seek()` caps speed at
`sqrt(2 * decel * distance)`, so a chaser slows as it closes on a moving intercept point and then
overshoots. This is the mechanism behind the trailing defenders.

## Contest opportunities (400 plays, instrumented scratch copy, events only)

| Category at first catch-plane descent | Plays | Catch | Deflected | Ground |
|---|---|---|---|---|
| Receiver only | 258 | 220 (85%) | 38 | 0 |
| Defender only | 10 | 0 | 10 | 0 |
| Both | 2 | 0 | 2 | 0 |
| Neither | 130 (32.5%) | 0 | 0 | 130 |

The intended target was among the candidates in only 22 of the 258 receiver-present plays.

Two findings follow:
- `resolveContest()` takes the first offensive candidate in distance order, not the intended target.
  Completions go to the nearest eligible receiver. Only 14 of 209 completions in the baseline comparison
  went to the intended target on the experiment, against 56% on the baseline (see below).
- 130 of 400 throws never put a receiver within reach. The aim in `launchPass` uses
  `0.75 * receiver velocity * flight estimate`, so the ball is placed about one receiver-stride behind a
  receiver who keeps running, plus a sigma term. The lead factor is not yet tested.

## Baseline comparison (same tuning seeds, default protection)

| | Baseline `e8ef2ca` | Experiment |
|---|---|---|
| Throws | 400 | 400 |
| Completions | 312 | 209 |
| Completions to intended target | 55.8% | 6.7% |
| Median yards after catch | 13.9 | 14.5 |
| First tackle-attempt defenders | RCB 70, NB 63, FS 29, MIKE 18, SS 14 | FS 82, RCB 49, MIKE 23, WILL 10, NB 8 |

The baseline's close defenders made the first tackle attempt far more often. The baseline defenders could
read the exact landing point (`W.ball.landing`), so they converged on the catch. The perception fix removed
that information, and the close defenders now chase without catching up. The baseline's shorter yards after
catch therefore depended partly on perfect landing information.

## Forward progress and returns (fixed in this branch)

`trackLive()` measured progress in the offense's direction, for any carrier. After an interception the
defender's return moved the wrong way, and the reported spot stayed at or past the interception point.
Fixture `pick-4` (LOS 6, `D.NB` placed at x=11): interception at 14.9 yards, reported spot 16.6 yards
(past the catch). After the fix the spot is 14.0 yards, behind the interception, and the offense's net yards
are measured from the LOS.

Still open: in fixture `int-7` the ball's final position is 59.4 yards while the holder is at 53.6 yards.
The held ball follows the holder while it is held, so the ball is lost before the carrier stops. The
reported spot then comes from the ball, not the carrier. This needs a separate fix.

## Units

Frames store positions in yards. Earlier diagnostics that divided frame positions by `YD` (0.9144)
overstated defender gaps by about 9%, and printed speeds as m/s when they were yards per second. The
conclusions above use yards.

## Status of the open items

| Item | Status |
|---|---|
| Baseline yards after catch lower | Explained in part: baseline defenders read the landing point and tackled earlier |
| Pick-six regression tests | Re-pinned: return direction (`pick-4`), deterministic interception (`int-7`). The touchdown-at-goal orientation test has no pinned seed on this branch yet |
| Completions at 53% | Explained: target-agnostic contest resolution, plus 32.5% of throws with no receiver in reach. Not yet fixed |
| Run path pursuit | Same defect at `autonomous-run.js` lines 651, 665 and 706 (lead 0.32 to 0.34, `seek()` arrival braking). Not changed |
| Sacks, checkdowns, throwaways | Not built. Time to throw is a median 1.0 s, before any rusher arrives. Pocket instrumentation and scenarios still to do |
| `trackLive()` forward progress | Fixed for returns. Ball and holder mismatch at the whistle remains open |

## Next steps

1. Target-priority contest resolution: the intended target first, other receivers only as a fallback.
2. Aim lead: use the full receiver velocity times the solved flight, and test against the current 0.75.
3. Pocket instrumentation and the deterministic sack, checkdown and throwaway scenarios.
4. Run path pursuit: intercept-point steering, as on the pass side.
5. Ball-holder consistency through the whistle.
