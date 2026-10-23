# M4d follow-up — Patriots–Bears Madden 27 player-input pilot

- **Branch:** `research/m4d-ne-chi-madden27-probe`
- **Base:** M4d pilot commit `c96f9eedbc894fdbf9f4d8c7f323e63ecc2cc0d4`

This follow-up replaces the prior same-team example with the player pairing already used in the Patriots–Bears research: New England HB TreVeyon Henderson and Chicago MIKE Devin Bush. EA's official [Henderson](https://www.ea.com/games/madden-nfl/ratings/player-ratings/tre-veyon-henderson/14810) and [Bush](https://www.ea.com/games/madden-nfl/ratings/player-ratings/devin-bush/20583) pages list Week 6 ratings. The frozen source values are in [madden27-ne-chi-profiles.json](madden27-ne-chi-profiles.json).

| Player | EA weight | STR | BTK | TKL | HTP |
| --- | ---: | ---: | ---: | ---: | ---: |
| TreVeyon Henderson | 92 kg (202 lb) | 71 | 81 | 33 | 31 |
| Devin Bush | 106 kg (234 lb) | 74 | 19 | 89 | 88 |

The same one-runner/one-defender M4c possession fixture was repeated on Rapier and Jolt. Configurations were the unchanged generic control, EA-listed weights only, and EA-listed weights plus STR passed to the existing balance-controller field. Each configuration ran twice per engine, with exact within-process repeatability asserted. BTK and TKL are recorded but not mapped in M4c.

All six configurations made physical player contact and retained the football; none produced a fall. EA weights moved the carrier mass from 98 kg to 92 kg and kept the tackler at 106 kg. Adding STR changed Rapier's first-contact time from 0.117 s to 0.125 s; Jolt remained at 0.092 s. This is input sensitivity in a synthetic fixture, not a completed tackle or a calibrated rating model.

The maximum penetration remained below M4c's 0.15 m limit in all runs. Every run exceeded the per-run p95 limit of 0.05 m; all six Rapier runs also exceeded the weighted-mean limit of 0.025 m. The pilot therefore does not pass the existing M4c penetration criteria.

Reproduce with:

```sh
node research/physics-3d-evaluation/m4b/m4d/madden27-ne-chi-input-pilot.mjs
```

The runner is [madden27-ne-chi-input-pilot.mjs](madden27-ne-chi-input-pilot.mjs), and all 12 runs are in [madden27-ne-chi-input-pilot-results.json](madden27-ne-chi-input-pilot-results.json).
