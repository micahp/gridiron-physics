# M4d — Madden 27 player-input pilot

- **Base:** M4c at `8ead484e08de6acdc934f33fe279347713dc289e`
- **Branch:** `research/m4d-madden27-tackle-pilot`
- **Scope:** Test whether published Madden player data can be passed into existing M4c inputs without inventing a conversion for ratings the simulator does not yet model.

## Source snapshot

EA's official [Madden NFL 27 ratings database](https://www.ea.com/games/madden-nfl/ratings) lists all players and identifies the current snapshot as Week 6. The pilot uses two Philadelphia Eagles player pages from that snapshot, accessed October 23, 2026:

| Player | Position | Weight shown by EA | STR | BTK | TRK | TKL | HTP |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Saquon Barkley | HB | 103 kg (227 lb) | 81 | 84 | 84 | 28 | 17 |
| Zack Baun | WILL | 102 kg (225 lb) | 80 | 46 | 34 | 93 | 87 |

Sources: [Barkley](https://www.ea.com/games/madden-nfl/ratings/player-ratings/saquon-barkley/13085), [Baun](https://www.ea.com/games/madden-nfl/ratings/player-ratings/zack-baun/21142). The captured inputs are preserved in [madden27-week6-profiles.json](madden27-week6-profiles.json).

## Method

The pilot clones M4c's `possession-retained` fixture and runs it with both Rapier and Jolt. It compares the generic fixture inputs (98 kg runner, 106 kg defender, both controller strengths at 80) with EA-listed weights, then with EA-listed weights plus each player's STR value passed unchanged into the simulator's existing `strength` field. The latter field affects the balance controller; this direct numeric use is an exploratory assumption, not a published EA conversion.

BTK, TRK, CAR, TKL, and HTP are recorded but left unmapped. The current 3D fixture has no validated conversion from those game ratings to balance, grip capacity, or contact force. Two exact repeats were run for each configuration and engine, for 12 runs total. The runner kept the ball in the contact cases, but did not fall in any run; this fixture does not demonstrate a completed tackle.

The script is [madden27-input-pilot.mjs](madden27-input-pilot.mjs), and the machine-readable runs are in [madden27-input-pilot-results.json](madden27-input-pilot-results.json).

## Results

Values below show the first of two identical repeats for each cell. “Wrap load” is the maximum requested load in the explicit spring-damper grip model, not a solver-measured human force.

| Inputs | Engine | Contact | First contact | Maximum requested wrap load | Max penetration | Per-step p95 | Weighted mean |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| Generic fixture | Rapier | Yes | 0.117 s | 435 N | 0.112 m | 0.0945 m | 0.0481 m |
| Generic fixture | Jolt | Yes | 0.092 s | 1,574 N | 0.073 m | 0.0550 m | 0.0093 m |
| EA weights | Rapier | Yes | 0.117 s | 419 N | 0.122 m | 0.0977 m | 0.0504 m |
| EA weights | Jolt | Yes | 0.092 s | 1,571 N | 0.073 m | 0.0545 m | 0.0077 m |
| EA weights + STR | Rapier | **No** | — | — | 0.129 m | 0.1062 m | 0.0304 m |
| EA weights + STR | Jolt | Yes | 0.092 s | 1,573 N | 0.073 m | 0.0545 m | 0.0069 m |

Adding the listed weights preserved contact and ball control in both engines. Passing Barkley's STR as 81 instead of the fixture default 80 removed Rapier's physical contact and wrap in this single setup; Jolt still made contact. The two exact repeats confirm this is repeatable within each engine, but the solver disagreement and single-point sensitivity make it unsuitable as evidence that the rating predicts a football outcome.

Compared with the existing M4c numerical limits (maximum ≤0.15 m, per-run p95 ≤0.05 m, duration-weighted mean ≤0.025 m), all 12 runs stayed below the maximum. All 12 exceeded the p95 limit, and all six Rapier runs exceeded the weighted-mean limit. This pilot therefore does not pass the M4c penetration criteria.

## Conclusion

EA provides an official, current Madden 27 rating source. Listed body mass can enter M4c directly, and STR can be wired into an existing controller input, but the STR experiment is solver-sensitive and uncalibrated. The remaining tackle ratings cannot be assigned physical meanings from this experiment alone. No predictive-validity claim or full Madden-to-physics mapping is supported by these results.

Reproduce with:

```sh
node research/physics-3d-evaluation/m4b/m4d/madden27-input-pilot.mjs
```
