# M4d observed-tackle candidate selection

**Date:** 2026-10-24
**Owner:** 3D M4d physical-interaction agent
**Status:** Selected for the first observed-tackle replay; no physics replay has been run yet.

## Selected play

| Field | Value |
| --- | --- |
| Cohort | 2022 NFL season, Big Data Bowl 2025 data, week 1 |
| Game / play | `2022090800` / `1009` (BUF at LA, 2022-09-08) |
| Play | Zack Moss, BUF, right guard for 3 yards; 2nd-and-5 from BUF 37 |
| Carrier | Zack Moss, `nflId=52494` |
| Solo-tackle label | A'Shawn Robinson, LA, `nflId=43335`; `soloTackle=1`, assist flags 0 |
| Play-by-play tackler | `As.Robinson` |
| Tracking event sequence | `ball_snap` frame 112; `handoff` 126; `first_contact` 139; `tackle` 161; `play_submit` 165 |
| Track span | Frames 1–165, 3,795 rows, 22 player IDs plus the football row |

This play is present in the week 1 exact-`tackle` event list and has a solo label. The play description, player label, and tracking geometry agree on Robinson as the likely tackler. The event timestamp itself is not actor-specific: at frame 161, `event=tackle` appears on all 23 entity rows. Treat the tackler identity as supported by the label, play description, and geometry, not as encoded by the event row.

## Geometry near the event

Coordinates are the source tracking x/y field coordinates. The centre-to-centre separation below is in yards; it is not a body-surface gap or a calibrated collision measurement.

| Frame | Moss position (x, y) | Robinson position (x, y) | Centre separation |
| ---: | --- | --- | ---: |
| 156 | (49.79, 22.93) | (49.41, 23.06) | 0.402 yd |
| 157 | (49.81, 23.14) | (49.46, 23.26) | 0.370 yd |
| 158 | (49.83, 23.38) | (49.51, 23.45) | 0.328 yd |
| 159 | (49.84, 23.59) | (49.55, 23.62) | 0.292 yd |
| 160 | (49.86, 23.85) | (49.61, 23.77) | 0.262 yd |
| 161, tackle event | (49.87, 23.99) | (49.65, 23.91) | 0.234 yd |
| 162 | (49.88, 24.17) | (49.69, 24.02) | 0.242 yd |
| 163 | (49.88, 24.23) | (49.71, 24.12) | 0.202 yd |

Robinson is the nearest LA defender at the event frame; the next closest defenders are at 1.395 yd or farther. Reported speeds at frame 161 are 1.95 yd/s for Moss and 1.36 yd/s for Robinson. The event is sampled at the dataset's 10 Hz cadence.

## Selection rule and limits

The selection starts from the supplied exact-event list and requires a solo or assist label. For this first replay candidate, I chose a play with one solo label and matching play-description attribution, then checked the labeled defender's proximity around the event. This is a targeted case selection, not a representative sample of NFL tackles.

The source is an unofficial GitHub copy (`b00nk3r/NFL-Big-Data-Bowl-2025`, source commit `e28d3b25725799ef2213680016db5325f6f90014`) of 2022-season data. Use rights are user-reported. No files were downloaded or copied during this selection. The label/event identity has not been independently reconciled across the full cohort.

No player ratings or rating-to-force mapping are used. The next M4d step is to build a synchronized replay input for Moss and Robinson around frames 112–165, preserve measured 10 Hz positions and velocities, and document the 2D-to-3D/body-geometry assumptions before running Rapier/Jolt. The replay should first test whether the observed approach/contact window is representable under the existing M4c proxy geometry; it must not claim calibrated tackling forces from this single play.

## Reproduction and source hashes

Data root: `/root/nfl-tracking-data/bdb2025/` (read-only for this analysis). The parent `SHA256SUMS.txt` is the staged-file manifest.

M4d code checkout before this report: `5790c8e992c0d01fc63e2068af2fa24a6e4b16b0` on `research/m4d-str-contact-diagnosis`.

| Input | SHA-256 |
| --- | --- |
| `code-data/tracking_week_1.csv` | `dc47c829ef917cb6533c6baedd01964823939a4e9cba807090d2784aa1fd149c` |
| `code-data/plays.csv` | `a103cbc3a1ddf7678cb6d77ea5f9919c4292b5d55c7876f7cad6cce3d62dca04` |
| `code-data/player_play.csv` | `4dfeba939d0b56e9fca6044c1df709879a22ed239389e155afba571915bd5852` |
| `week1_tackle_event_plays.json` | `95eed3332555702d496ae48d9710f866f30b391e58b014708c4191e0e135ad50` |
| `week_profiles.json` | `fa28fb12169c71c6e0ba6e9784c13849f6c5643ac44746e76b4e47c8c6b894de` |

The candidate's play and label rows can be queried by `gameId=2022090800`, `playId=1009` in `plays.csv` and `player_play.csv`. Its full tracking record can be selected by the same keys in `tracking_week_1.csv`; the tackle event is at frame 161.
