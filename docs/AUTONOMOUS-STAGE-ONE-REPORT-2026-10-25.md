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

rush yards          min -2.14  p25 -1.28  median -1.02  p75 -0.91  max 3.62
pass yards          min  0.00  p25  2.97  median 12.63  p75 31.04  max 65.74
rush duration       median 1.94 s      pass duration median 4.07 s
blocks             1696 engagements, 518 sheds, 60.2% blocker win rate
contact             270 broken tackles, 212 tackles
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

## Realism limitations

These are measured, not fixed, and should be read before quoting any number.

- Rush outcomes are compressed. Median gain is -1.02 yd and the maximum across
  160 plays is 3.62 yd. The blocking model wins 60 percent of blocks, but the
  defensive pursuit closes faster than a real front seven and the rushing
  results look like a goal-line period, not a full-field sample.
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
