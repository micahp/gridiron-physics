# LP E2 adversarial review — 2026-10-24

Review target: `micahp/legendarypicks`, branch `feat/nfl-sequence-e2-kickoffs-2026-10-24`, current head
`3daa0ed6dc99c3bdc666d5c0f226af02173e05cc`.

## Revision integrity and tests

- Supplied `ca418fbd` is an ancestor of current LP head. E1 pin `2248f7e1` is also an ancestor.
- `git diff 2248f7e1..3daa0ed6` contains E2 additions/changes only. E1 generator/test paths and
  `docs/GRIDIRON-CONTRACT-v1.md` are unchanged. The shared v1 document SHA-256 is
  `ae7b8a304dda480c3708b2543172f3fdc5064b156bf1b25816855acf31bc21b7` in both repos.
- On current clean LP head, `python3 -m unittest scripts/nfl_sequence/test_game_state.py
  scripts/nfl_sequence/test_e1_transitions.py`: **40 tests pass**.
- `python3 scripts/nfl_sequence/emit_game.py --scan 300 --out /tmp/lp-e2-emitted-game.json` emitted seed 1: 24 drives,
  144 plays, score A 11–B 17. Recomputed rules matrix: 13 PASS, 5 UNSUPPORTED, 1 PARTIAL, 3 NOT_APPLICABLE; no FAIL.
- The 300-game survey remains pending and its aggregate counts were not reproduced. An earlier survey run on clean
  `60b7708b` exceeded the review window and was stopped; current head's survey entry point has since been updated.

## Kick outcomes

The read-only measurement script reproduced these field-goal source counts for 2022–2025, weeks 1–18:

| `series_result` | Count | Treatment in E2 |
| --- | ---: | --- |
| `Field goal` | 3,664 | made |
| `Missed field goal` | 634 | missed |
| Other labels | 27 | excluded |

These distinct field-goal result labels support the 85.25% aggregate rate. Bucket counts are 698/13, 1109/58, 980/200,
809/305, 67/55, and 1/3 (made/missed) for yardline-100 buckets 1–9 through 50+.

The extra-point and two-point outcome interpretation fails source-semantic review. The local ingested table lacks
`extra_point_result` and `two_point_conv_result`; E2 treats nflverse `success` as a made/missed result. nflfastR defines
`success` as `EPA > 0`, while its transformations construct dedicated kick-result columns for made/missed/blocked field
goals, good/failed/blocked extra points, and success/failure/safety/return two-point tries ([`success` definition](https://github.com/nflverse/nflfastR/blob/master/R/helper_additional_functions.R),
[dedicated result fields](https://github.com/nflverse/nflfastR/blob/master/R/helper_add_nflscrapr_mutations.R)).

Reproduced values are therefore EPA-positive/negative counts, not verified conversion labels:

- Extra points: 4,644 `success=1`, 226 `success=0`. Of 230 `Opp touchdown` rows, 213 are labelled `success=1`; this alone
  disproves the claim that the column means “kick made.”
- Two-point attempts: 240 `success=1`, 269 `success=0` (509 attempts). The resulting 47.15% is not a validated conversion
  rate.

E2's try sampling rates and any game points derived from these rates must remain provisional until dedicated result fields
are ingested and the tables are rebuilt. The current PBP input window is retrospective; it is not a pregame forecast source.

## Coin toss and game linkage

- `CoinTossLedger` correctly derives the receive/defer first- and second-half choices and Q1/Q3 reversals; focused tests cover
  both choice paths. `play_game` still constructs `CoinTossLedger('A', 'B', choice)`, so team A always wins the toss and only
  receive/defer is sampled. A/B are not mapped to actual home/away teams. Treat this as a restricted authored scenario.
- The E2 record now serializes nested plays and team/player lines. For the pinned seed-1 output, the Gridiron validator
  confirms drive order, drive start/end metadata, score sums, kickoff `after_drive` links, and receiving-team-to-next-drive
  linkage. It finds 23 state-index inconsistencies: drives 2–24 have distinct `drive.index` values but all embedded E1 play
  states retain `drive_index: 1`.
- Play IDs are unique and preserved, but use a separate simulation prefix per drive (`e2-1-drive<n>:<local-sequence>`).
  This does not meet the shared v1 game-wide `simulation_id:sequence` rule. The adapter reports it and does not rewrite IDs.
- `complete_regulation: true` means the generated record reaches 0:00 in Q4. `valid_full_game: false` is intentional while
  `unsupported_rules` is non-empty (timeouts, two-minute warning, penalties, onside kicks, overtime, exception coin-toss
  paths, and lineups). Do not promote the record as a fully legal rule-complete game.
- The record has no scheduled game ID, actual home/away identities, pregame as-of snapshot, or current-game roster. Player
  IDs are participants from sampled historical plays. A read-only timeline is supportable; a truthful 3D player replay is
  not.

The LP seed-1 emitter reads retrospective PBP for seasons 2022–2025, weeks 1–18. No tracking cohort or weeks 6–9 tracking
holdout was opened or evaluated. The kick-outcome audit uses the existing E2 PBP source window, not tracking data.
