# Stage One Autonomous Football AI: implementation report

Date: 2026-10-25
Branch: `feat/autonomous-stage-one` (isolated worktree, research only)
Spec: [`AUTONOMOUS-STAGE-ONE-SPEC-v1.md`](AUTONOMOUS-STAGE-ONE-SPEC-v1.md)
Base: `95f18db` plus Codex's inside-zone POC adopted at `80cd627`

## Outcome

All four Stage One milestones are implemented and covered by executable checks.

| Milestone | State | Where |
| --- | --- | --- |
| 1A Runtime | done | `engine/world.js`, `engine/autonomous/simulator.js`, `engine/autonomous/schema.js` |
| 1B Autonomous rushing | done | `engine/autonomous-run.js` (Codex POC, extended) |
| 1C Autonomous passing | done | `engine/autonomous/passing.js` |
| 1D Playable product | done | `autonomous.html`, `web/autonomous.js`, `web/render.js` |

No realized outcome enters the pipeline. Every gain, dead-ball spot, tackler,
sack, completion and turnover in this build comes from agent movement, ball
flight and contact inside the simulation. The historical director
(`engine/play.js`) is never imported on this path.

## Entry points

- Browser: `autonomous.html` served from the repository root.
- Library: `simulateAutonomousPlay(input)` in `engine/autonomous/simulator.js`.
- Frozen audit: `node scripts/batch-autonomous-runs.mjs`.

## Contracts

- Input: `gridiron.autonomous-play.v1`. Validated by
  `validatePlayInput`. Unknown keys, unknown slots, wrong lineups, wrong
  concept family and any prohibited outcome field are refused before a
  single step runs. `assertNoOutcomeFields` walks the whole payload, so a
  nested `gain`, `endX`, `outcome_anchor`, `future_tracking` or similar key
  is rejected at any depth.
- Output: `gridiron.autonomous-result.v1`. Built by `toResultRecord` and
  checked by `reconcileResult`: exactly one whistle, the event log ends at
  that whistle, the whistle reason matches the terminal reason, the spot is
  inside the field, 22 players are present, frame stride matches, duration
  agrees with the frame count, the tackle names the live carrier, and no
  recorded frame has two ball holders.
- The record states `result_provenance:
  generated_from_agent_actions_and_physics`, `outcome_inputs: []` and
  `valid_full_game: false`. Stage One never claims a game-level result.
- `GRIDIRON-CONTRACT-v1.md` is untouched.

## Supported and unsupported variants

Supported: inside zone to the left or right against even, over, under,
nickel, odd and bear fronts; slant-flat against nickel over and nickel under
with Cover 1 man or Cover 3 zone; offense direction left or right; any legal
line of scrimmage and ball lateral; authored 1 to 99 ratings and masses.

Not supported by design: any other concept, fronts other than the six rushing
and two nickel passing fronts, motion, audibles, multiple plays, clock,
score, quarters, kickoffs, penalties, fumbles, laterals and replay of
historical plays.

## Tests

`npm test` (exit 0) runs the existing repository suite plus:

- `test/autonomous-schema.mjs`: 22 unique profiles, outcome fields refused at
  any depth, unsupported calls rejected.
- `test/autonomous-run.mjs`: inside zone over six fronts, rating perturbation,
  tracking scorer.
- `test/autonomous-pass.mjs`: 60-play sweep, determinism, every ending
  reachable, no NaN in events or frames.
- `test/autonomous-formation.mjs`: 11v11 alignment, no overlapping teammates
  at the snap, linemen on the ball, shotgun for passing, under-center for
  rushing, offense independent of the defensive front.
- `test/autonomous-contact.mjs`: 48 plays. Engagements, sheds, releases,
  tackles and broken tackles only occur between opponents; a shed requires a
  live engagement; no frame has two ball holders; nobody moves more than 1.2
  yd between recorded frames.
- `test/autonomous-rules.mjs`: 40 plays. Only supported endings, spots inside
  the field, touchdown on the goal line, out of bounds on the boundary,
  safety behind the carrier's own goal line, incomplete gains nothing and
  keeps possession, yards gained follow the dead-ball spot and the play
  direction, the log ends at the whistle, nothing is recorded after it.
- `test/autonomous-acceptance.mjs`: perturbation sweeps, including an
  explicit time-cap failure that must stay a technical stop.
- `test/autonomous-results.mjs`: frame-by-frame determinism, reconciliation,
  rejection of `historical_record`, six-seed variation.
- `test/autonomous.browser.mjs`: headless Chromium. Both play families snap,
  resolve, log events, expose 22 live decisions, compare two runs and replay
  a seed identically. Screenshots land in
  `docs/evidence/autonomous-acceptance/`.

### Defensive-back run-support check

The run-support change preserves corner leverage and safety depth until each
defender observes the handoff/line-flow cue, applies a role- and PRC-dependent
read delay, then fits force, alley or top-down pursuit angles. It was scored on
the same frozen 53-play BDB cohort as the perimeter-blocking change. Future
tracking is evaluation-only; each simulation receives only snap-time positions
and pre-snap motion history. Full output:
`docs/evidence/autonomous-acceptance/bdb53-db-run-support.json`.

At 1.0 seconds, the mean error improved from 2.189 m to 2.092 m (4.4%); the
constant-velocity baseline remains better at 0.992 m. DB error fell from 3.538
to 3.183 m, while LB and DL errors were effectively unchanged. At 0.5 seconds,
the new score was 0.822 m versus 0.815 m before this change, a small regression.

| Position group | Samples | Mean XY error | Constant-velocity baseline |
| --- | ---: | ---: | ---: |
| Offensive line | 260 | 1.248 m | 1.136 m |
| WR | 156 | 2.617 m | 1.246 m |
| RB | 52 | 1.934 m | 1.278 m |
| QB | 52 | 1.266 m | 0.466 m |
| TE | 52 | 2.049 m | 1.146 m |
| DL | 205 | 1.144 m | 1.095 m |
| LB | 113 | 3.054 m | 0.921 m |
| DB | 254 | 3.183 m | 0.654 m |

The largest remaining DB role errors are nickel 3.563 m (46 samples), left
corner 3.367 m, right corner 3.234 m, free safety 2.938 m and strong safety
2.856 m (52 samples each). Nickel and both safeties improved; corner errors
rose by about 0.25 m each. The five highest play-level errors at 1.0 seconds
are weeks/game/play `5/2022100911/364` (2.688 m; baseline 0.913),
`3/2022092509/3274` (2.676; 0.819), `1/2022091109/2941` (2.519; 1.386),
`5/2022100909/3574` (2.453; 0.940) and `4/2022100204/3428` (2.432; 1.064).

## Frozen batch audit

`scripts/batch-autonomous-runs.mjs`, 160 rushing plays and 80 passing plays
over ordinary supported inputs:

```
attempted                 240
completed                 240  (100%)
technical_failures          0
exceptions                  0
movement_warnings           0
execution_ms             ~4000

rush endings        tackle 160
pass endings        tackle 44, incomplete 14, out_of_bounds 12, touchdown 10
pass                80 throws, 64 catches, 2 interceptions, 0 sacks

rush yards          min -2.14  p25 -1.17  median -0.83  p75 1.27  max 41.08
pass yards          min  0.00  p25  2.97  median 12.63  p75 31.04  max 65.74
rush duration       median 2.59 s, max 9.74 s      pass median 4.07 s
blocks             2099 engagements, 601 sheds, 77.4% blocker win rate
contact             182 broken tackles, 212 tackles
```

Every play ends in a football result. No failure is hidden: the report names
each failure seed if one occurs, and the script exits non-zero on any
exception, arithmetic mismatch, movement warning or completion rate below
99 percent.

## Defects found and fixed during acceptance

1. Defensive backs were stacked. The pass formation only recognised `MIKE`
   and `WILL`, so the contract slots `MLB` and `WLB` fell through to the free
   safety spot and three defenders started on the same blade of grass. Fixed
   in `engine/autonomous/passing.js`; `test/autonomous-formation.mjs` now
   fails if any teammates overlap at the snap.
2. A tackle that began in the last half second of a play was abandoned at the
   time cap. The wrap window is 0.48 s, so a real tackle at 8.76 s reported a
   technical failure. A wrap in progress now resolves as a tackle at the cap.
3. Long catch-and-run plays were truncated. The cap is 12 s of simulated
   time, which is enough for a 60 yard gain to reach the end zone.
4. The final recorded frame could land one integration step after the
   whistle because the world advances its clock after the ball goes dead. The
   closing frame is now stamped with the terminal time.
5. The pass contest was inverted in both directions. First every contested
   catch was a coin flip and 45 percent of throws were intercepted, then the
   correction over-shot and produced no incompletions at all. The current
   model gives the receiver a skill and traffic weighted catch chance, allows
   an interception only from a defender at the catch point, and puts the
   remaining inaccuracy in the quarterback's launch point, which is where real
   incompletions come from.
6. The viewer passed contract slot names straight to the rushing executor,
   which only knows the alignment slots of the chosen front. The rush path now
   translates and filters profiles before the snap.
7. Defensive backs triggered direct carrier pursuit immediately and erased
   initial leverage. Corners now preserve their WR-side force landmark,
   safeties hold depth, and nickel/strong safety/free safety trigger on
   distinct observed-run delays. `test/autonomous-acceptance.mjs` checks the
   recognition timing and PRC sensitivity; the same-cohort comparison is
   recorded above.

## Realism limitations

These are measured, not fixed, and should be read before quoting any number.

- Rush outcomes remain poorly calibrated. The median across 160 plays is
  -0.83 yd and the 75th percentile is 1.27 yd, but one 41.08-yard outlier
  creates an implausibly wide tail. The block win estimate rose to 77.4% after
  the DB trigger change. The BDB 1-second score remains 2.092 m versus a 0.992
  m constant-velocity baseline; DB improved overall, but corners regressed and
  linebackers remain especially inaccurate.
- Passing gains are wide. Median 12.6 yd, p75 31 yd, maximum 65.7 yd. Ten of
  80 plays scored, which is high for a quick game.
- There are no sacks in the audit. The pocket holds: the closest rusher stays
  about 4.5 yd from the quarterback because five linemen block four rushers
  and the shed model rarely wins clean before the drop ends. The sack path
  exists and is exercised by acceptance perturbation, but it does not occur
  naturally in this sample.
- Two interceptions in 80 throws, and 64 catches, give a plausible completion
  rate for a quick game but a thin turnover sample.
- The handoff happens at a fixed 0.44 s. The spec warns against simply setting
  a historical 1.4 s, so it is left as the executor's real mesh timing and
  recorded as a known difference from observed NFL timing.
- `first_contact_seconds` reads 0 for every play because the first `contact`
  event fires when linemen engage at the snap. It measures engagement, not
  first contact with the ball carrier, and should not be quoted as a
  play-speed metric.
- The defense plays two coverages and two nickel fronts. It does not disguise,
  blitz, or adjust to motion, and there is no penalty, fumble or lateral
  model.

## Remaining blockers

- Rushing realism (median gain, maximum gain) is the largest open gap.
- Natural pressure and sacks need a pass-rush model that can beat protection
  rather than only shedding it.
- No drive or game layer exists. Stage One ends at the whistle of one play,
  by design.

## Commit log

See the branch history on `feat/autonomous-stage-one`. The POC base is
`80cd627`; Stage One implementation, tests, viewer and this report are
committed in separate slices after it.
