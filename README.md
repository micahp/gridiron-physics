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
```

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
