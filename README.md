# Mile High Film Room

A physics reconstruction of a real NFL game, **Seahawks @ Broncos, Oct 15 2026 (DEN 17–14)**, built from ESPN's play-by-play. All 22 players on every snap are simulated as force-limited bodies, and their limits come from a Madden-style rating engine grounded in public research.

Inspired by ThePropDealer's [drive-by-drive sim viewer](https://propdealerbets.com/projections/nfl/2026-10-15-SEA-DEN), which animates one simulated outcome. This project replays the real game instead, with every player's movement simulated:

- **22 rigid bodies per snap**, 120 Hz. Sprinting follows each player's own force–velocity curve derived from his 40-yard dash. Cuts are traction- and agility-limited, and contacts are momentum-conserving impulses. Blocks are spring–damper engagements decided by leg drive and skill. Tackles are inelastic wraps.
- **3D ball flight** with aerodynamic drag at Denver's air density. Every pass, punt, kickoff and field goal is solved to land where the real one did.
- **Outcome-faithful:** catch points use real air yards, end spots and tacklers come from the box score, and runs use the charted gaps. 122 of 124 checkable plays end on ESPN's spot (±1 yd; ±1.5 yd at the sideline).
- **Rating engine:** 35 Madden-style attributes plus a physical body for all 161 rostered players, calibrated against all 1,686 active NFL players.

## Run it

```bash
npm run serve        # http://localhost:8080
npm test             # headless replay of the full game + validation
npm run data         # re-download ESPN + nflverse inputs, rebuild ratings and plays
```

No build step: `index.html` loads ES modules directly, and three.js is vendored in `web/vendor/`.

In the viewer: ← → step plays, space plays/pauses. Use the cameras (Broadcast, All-22, Skycam, Chalkboard with player paths, Follow, Free orbit). Click any player for his rating card and physics body. The Physics tab shows live speeds, collision closing speeds and impulses, and game leaders.

## Layout

```
pipeline/fetch.py        download ESPN (summary, plays + participants, rosters, depth charts) and nflverse
pipeline/ratings.py      rating engine -> data/ratings.json            (docs/RATINGS.md)
pipeline/build_game.py   ESPN + nflverse charting -> web/data/game.json play scripts
engine/                  physics + director, shared by browser and Node    (docs/PHYSICS.md)
web/                     three.js renderer and UI
test/validate.mjs        end-spot and plausibility checks
scripts/audit-player-movement.mjs   run every play of a game and flag movement that looks wrong
```

## Player movement and brains

Every play is 22 bodies. Each one runs a brain (a mode in `engine/play.js`) that picks where he wants to be and how hard to push. The physics moves the body; the brain decides the assignment.

- **Anchors.** Each team's formation is the starting point. Every scrimmage player holds his set point until the snap, so nobody moves before the ball is live.
- **Pass protection.** Each lineman is paired with the defender in front of him (LT with LEDGE, LG with LDT, RG with RDT, RT with REDGE, and C with NB when a nose is on the line) and drives toward where that defender is going. A blocker with no one in front of him takes the nearest free rusher. Run blocks use the same pairing.
- **`rush`.** Pass rushers go at the passer. Edge rushers arc around the tackle, and a rusher held by a blocker works around him.
- **`fit`.** Run defenders key the back after a reaction delay of 0.25 to 0.5 s (set by awareness), go to their landmark, and take an angle on the carrier only when he is within 7 yd or past the line. Linemen hold their gap, linebackers flow to the hole, corners set the edge or fill the cutback, safeties fill the alley.
- **`zone`.** Safeties, and any defender with no man to cover, sit in their zone and pick up a receiver who enters it. They break on the ball only when it lands in the zone or they are the ball hawk.
- **`cover_man`.** A defender trails his man with cushion and inside leverage. The map is MLB on the RB, WLB on the TE, the corners on WR1 and WR2, and NB on WR3. Known gap: the cushion shrinks by 2.2 m/s and stops at 1.2 m, so a trailing linebacker is about 1 s from his man's hip whatever the route. When the man is a back who released into the flat, the cushion sits in the passer's pocket, which is how an MLB ends up there.
- **`pursue` and `tackle_to`.** After a catch or a handoff, defenders go to the carrier's path. This is still a beeline with no reaction delay, and it is a known gap.

How real players move is in [docs/NFL-ROLE-MOVEMENT-REFERENCE-2026-11-01.md](docs/NFL-ROLE-MOVEMENT-REFERENCE-2026-11-01.md): BDB 2022 tracking, weeks 1 to 5 only (weeks 6 to 9 are the reserved holdout), joined to formations and FTN charting. The median peak speed is about 6.4 yd/s for WRs, 5.6 for RBs, 5.5 for safeties, 5.3 for corners, 5.0 for linebackers, 3.9 for DL, 3.6 for QBs, and 3.1 for OL.

To check every play of a game for movement that looks wrong, run:

```bash
node scripts/audit-player-movement.mjs --record <envelope.json>                 # statistical replay (what the viewer shows)
node scripts/audit-player-movement.mjs --record <envelope.json> --authority physics
```

Each flag is labelled `brain` (the player moved against his assignment) or `physics` (the body did something a body does not do, such as a sharp reversal or leaving the field). A flag is a lead to review, not a verdict.

## Data sources

- **ESPN** public JSON endpoints: game summary and drives, core-API plays with participants, rosters, depth charts.
- **nflverse** ([nflverse-data](https://github.com/nflverse/nflverse-data)): play-by-play charting (air yards, YAC, run gap, pass location, kick distance, win probability), the player ID crosswalk, NFL Combine results 2000–2026, and player stats (2025 + 2026 weeks 1–5).

ESPN play ids and nflverse play ids join exactly (`espn_id = event_id + play_id`).

## Research referenced

- Samozino P., Rabita G., Dorel S., et al. (2016). A simple method for measuring power, force, velocity properties, and mechanical effectiveness in sprint running. *Scand J Med Sci Sports* 26(6):648–658.
- Clark K.P., Rieger R.H., Bruno R.F., Stearne D.J. (2019). The National Football League Combine 40-yd dash: how important is maximum velocity? *J Strength Cond Res*.
- Kuzmits F.E., Adams A.J. (2008). The NFL Combine: does it predict performance in the National Football League? *J Strength Cond Res* 22(6):1721–1727.
- Robbins D.W. (2010). The National Football League (NFL) Combine: does normalized data better predict performance in the NFL draft? *J Strength Cond Res*.
- Pellman E.J., Viano D.C., et al. (2003). Concussion in professional football: reconstruction of game impacts and injuries. *Neurosurgery* 53:799–814.
- Viano D.C., Casson I.R., Pellman E.J. (2007). Concussion in professional football: biomechanics of the struck player, part 14. *Neurosurgery* 61(2):313–327.
- FiveThirtyEight: [Madden's player speed scores are surprisingly good](https://fivethirtyeight.com/features/maddens-player-speed-scores-are-surprisingly-good-but-whose-ratings-did-the-game-get-wrong) and [team speed](https://fivethirtyeight.com/features/another-way-to-measure-the-nfls-fastest-teams-and-more-evidence-it-doesnt-matter).
- Madden School community testing of [Combine results → Madden physical ratings](https://madden-school.com/madden-21-scouting-guide-how-combine-results-affect-physical-attributes).
- NFL Big Data Bowl / Next Gen Stats player tracking (10 Hz), used for real-world speed scale.

See [docs/RATINGS.md](docs/RATINGS.md) for what is and isn't publicly known about how Madden builds its ratings.

## Honest limits

This is a reconstruction, not tracking data. ESPN gives outcomes, not coordinates. Formations, routes, assignments and every player's path between the anchors are generated, then played out by the physics. Ball spots, catch points, tacklers, kick distances and results are real. A play the real game had and the sim abstracts: the two-point conversion is shown in text only.

Data © ESPN and nflverse contributors. three.js is MIT-licensed (`web/vendor/THREE_LICENSE`). NFL team names and logos belong to their owners; this is an unaffiliated research project.

## What If Lab (experimental)

Open [`what-if.html`](what-if.html) after running `npm run serve` and visit `http://localhost:8080/what-if.html`.

This fourth-quarter, 3rd-and-3, down-four scenario reuses the existing Gridiron Physics `simulatePlay()` and Three.js `Renderer`. Choose Cover 2, Man or Blitz; press **Run the Slant**; use a reproducible seed, cameras and replay controls. Outcomes can be completions, incompletions, sacks or interceptions. Motion runs through the same 120 Hz physics engine used by Film Room.

**Honesty:** All scenario outcomes and probability values are hand-authored illustrative fixtures, not trained Legendary Picks forecasts or a real historical play. The outcome is sampled *before* playback, and the existing physical director steers the players toward it. This is a visualization prototype, not a validated autonomous football model. The roster and physical parameter estimates are adapted from the original reconstructed game.

`node --test test/what-if.mjs` tests the model script, deterministic seeds and normalization. `npm test` still validates the existing reconstruction. No existing Film Room page was replaced.
