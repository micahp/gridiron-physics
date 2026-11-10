# Football realism assertions TODO

Base: Gridiron Physics `origin/main` at `eefbff47ae7bf35c907053c13af302e7b20d1044`.
Scope: the first P0 assertion pass. The new tests intentionally expose current engine failures.

## P0 engine gaps exposed by the assertions

- [ ] Add a deterministic observation boundary for autonomous QB reads. Test field of view, player and height-dependent occlusion, gaze independent of body heading, and a fixed reaction delay.
- [ ] Keep temporarily unseen players at last-seen estimates and decay confidence with age. A change to an unseen player's live position must not change the QB's read.
- [ ] Limit pressure awareness to contact and pressure cues. Do not expose exact current coordinates for an unseen rusher.
- [ ] Make defenders estimate ball flight after release. Do not give defensive decisions the ball simulator's exact future landing coordinate.
- [ ] Reject or safely resolve a kneel input with positive gain. The knee-down event must be dead-ball terminal and cannot score, pass, tackle, or scramble afterward.
- [ ] Preserve the negative-yardage kneel and the legal own-goal-line safety case.
- [ ] Replace source-boundary perception checks with behavioral fixtures once the simulator exposes controlled position, gaze, occlusion, and observation-time inputs.

Current baseline evidence: `test/autonomous-perception.mjs` reports eight `NONCAUSAL_INFORMATION` findings. `test/autonomous-kneel.mjs` reports an ordinary kneel ending 3.26 yards beyond its line of scrimmage. The perception checks inspect source because the public simulator has no deterministic observation injection seam; they are not behavioral validation.

## Remaining assertion-suite scope

- [ ] Complete supported play semantics: spike, incompletion, sack, scramble, designed QB run, interception, fumble recovery, touchdown, and safety.
- [ ] Add field geometry and dead-ball tests for first downs, fourth-down failure, goal lines, forward progress, out of bounds, and terminal movement.
- [ ] Add causal-information tests for private route assignments and dead players.
- [ ] Add play, drive, and game result provenance and failure classifications to every supported fixture.
- [ ] Add pinned historical distribution warnings separately from hard rule failures.
- [ ] Add paired-seed ablations with independent random streams and frozen pregame inputs.

## Current execution state

- [x] Kneel and QB perception sentinels are registered in `npm run test:autonomous`.
- [ ] The new Gridiron assertions pass after the engine gaps above are repaired.
- [ ] Football Realism Assertion Suite v1 sections A through G are complete.

Keep these checks as hard gates. Do not remove a failing seed or soften an invariant to obtain a green run.
