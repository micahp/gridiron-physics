# Part B tracking coverage: 2022 development and 2023 validation

Historical data only. This report uses 2022 BDB weeks 1–5 for calibration and the manifest-listed 2023 train weeks 1–7
for frozen validation. The 2022 reserved weeks 6–9 were excluded. The 2023 directory name includes `2026`, so its
manifest was read first; only the fourteen files explicitly named `input_2023_w01..w07.csv` and
`output_2023_w01..w07.csv` were opened. No 2026 season data, tracking, output, or split was used for this coverage
analysis.

## 2022 BDB: 2022 season, weeks 1–5

The local `bdb2025` source is an unofficial mirror of 2022 BDB tracking. Its tracking schema supplies player IDs,
frame IDs and types, timestamps, club, coordinates, speed, acceleration, direction, and tagged events. Player position
joins through `nflId` to `players.csv`; role side and situation come from play metadata (`possessionTeam`,
`defensiveTeam`, quarter, down, yards-to-go, and formation). The tracked files therefore support role/position joins,
snap timing, and pre-snap motion measurement.

The existing raw week profiles report this coverage for the five calibration weeks:

| Week | Games | Plays | Tracking rows | Before-snap rows | Snap rows | After-snap rows | Ball rows | Frames/play min / median / max |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 16 | 1,952 | 7,104,700 | 4,647,564 | 44,896 | 2,412,240 | 308,900 | 17 / 158.5 / 697 |
| 2 | 16 | 1,809 | 6,704,339 | 4,418,691 | 41,607 | 2,244,041 | 291,493 | 31 / 162 / 489 |
| 3 | 16 | 1,959 | 7,129,195 | 4,657,661 | 45,057 | 2,426,477 | 309,965 | 12 / 161 / 461 |
| 4 | 16 | 1,830 | 6,747,556 | 4,421,244 | 42,090 | 2,284,222 | 293,372 | 24 / 162 / 521 |
| 5 | 16 | 1,906 | 7,103,067 | 4,692,345 | 43,838 | 2,366,884 | 308,829 | 17 / 163 / 700 |
| **Total** | **80** | **9,456** | **34,788,857** | **22,837,505** | **217,488** | **11,733,864** | **1,512,559** | — |

For trajectory scoring, I used the existing snap-anchored all-player cohort, not a hindsight-selected tackle cohort. It
contains **9,388 complete plays** (1,938 / 1,798 / 1,946 / 1,817 / 1,889 by week), 80 games, and 206,536 player-play
tracks. Each play has 22 unique identities (11 offense, 11 defense), position populated for every player, six input
positions from snap−0.5 s through snap, and eleven label positions from snap through snap+1.0 s. The football has eleven
label frames. I rechecked the prepared observations' SHA-256 hashes and asserted those frame spans, identities, roles,
and positions. Of the 9,456 tracked plays, 68 lacked a unique snap event or a complete player/frame span; none of the
reserved weeks was included.

An additional existing snap-anchored cohort reports 9,289 plays eligible for its own scoring contract after formation,
history, and snap-definition exclusions. That is a different cohort and was not substituted for the 9,388-play
all-player movement cohort.

## 2023 BDB train: weeks 1–7

The manifest was checked before opening data. All fourteen listed CSV files matched their SHA-256 entries. Inputs contain
1,903,584 rows across **5,580 plays and 106 games**; outputs contain 218,419 target-position rows. The 18,262 distinct
`player_to_predict=True` tracks join exactly to the output IDs, and each output length equals its declared
`num_frames_output`. Position, side, role, and player ID are populated for the target rows. Input frame IDs are
contiguous per player track, with 8–106 observed frames (median 26); there are no missing input-frame steps. Output
frame IDs are contiguous from 1 and range from 5 to 94 frames per target track.

| Week | Games | Plays | Input rows | Target tracks | Tracks with 1.0 s output |
|---:|---:|---:|---:|---:|---:|
| 1 | 16 | 819 | 285,714 | 2,679 | 1,568 |
| 2 | 16 | 850 | 288,586 | 2,758 | 1,584 |
| 3 | 16 | 904 | 297,757 | 2,959 | 1,773 |
| 4 | 16 | 779 | 272,475 | 2,517 | 1,545 |
| 5 | 14 | 742 | 254,779 | 2,449 | 1,503 |
| 6 | 15 | 793 | 270,676 | 2,608 | 1,549 |
| 7 | 13 | 693 | 233,597 | 2,292 | 1,429 |
| **Total** | **106** | **5,580** | **1,903,584** | **18,262** | **10,951** |

All 18,262 targets support a 0.5 s score; **10,951** support 1.0 s. At both horizons the scored roles are
`Targeted Receiver` and `Defensive Coverage`:

| Horizon | Targeted receivers | Defensive coverage players | Plays with both roles labeled |
|---:|---:|---:|---:|
| 0.5 s | 5,580 | 12,682 | 5,150 |
| 1.0 s | 2,922 | 8,029 | 2,874 |

The input also labels passers and other route runners, but they do not have output trajectories in this train subset.
Input coverage varies from 6 to 17 player IDs per play/frame (median 13), so this is not an all-22 movement sample.
There are no route assignments or snap timestamps. The files support receiver/coverage trajectories and paired
separation/closure; they do not identify route-break timing, pre-snap movement, or a synchronized reaction delay to pass
release. The official [BDB field definitions](https://www.kaggle.com/competitions/nfl-big-data-bowl-2026-prediction/data)
document that these 2023 train inputs are before the pass, outputs are after it, coordinates use yards, and input/output
frame IDs restart by file type. That link was used for schema interpretation only; no 2026 data or split was accessed.

## Reproducible metric artifact

The frozen protocol is [PART-B-2023-VALIDATION-PROTOCOL-2026-10-28.md](PART-B-2023-VALIDATION-PROTOCOL-2026-10-28.md).
The complete per-role, per-position, down/role, and nearest-coverage-pair baseline summaries are in
[`movement_metrics.json`](../../data/playbooks/research-2026-10-28-partb-movement/movement_metrics.json). It records
all fourteen 2023 input/output file hashes and the five prepared 2022 observation hashes.
