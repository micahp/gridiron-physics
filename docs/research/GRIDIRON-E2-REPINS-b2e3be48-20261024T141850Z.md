# E2 repin verification — LP b2e3be48

Date: 2026-10-24

## Immutable inputs and pins

- LP evidence commit: `b2e3be4876d644d2ad8a5f94b7d25365ba7ba724`.
- LP artifact path: `docs/fixtures/e2/e2-game-seed1.json`.
- Raw artifact SHA-256: `0a3ed1cb216fa3f23784b427d2bf6e68ac877ab1995fb86cd5998d35d5b47821`.
- Shared full-game v1 contract SHA-256: `ae7b8a304dda480c3708b2543172f3fdc5064b156bf1b25816855acf31bc21b7` (pinned value; no drift).
- Gridiron source head before this run: `601f8a16104aded7e1aaea6135e59122d7fc33ce`.
- Candidate envelope SHA-256: `30354e16f8fd1c4c64a0f1ab6ebb456ce3738b832a90b54a30a395834458de8f`.
- Existing LP manifest pin before run: `1ca7560924fe7da3eb452b142176bf09d7aeb1f0`.
- Pin disposition: verification only; existing manifest and immutable fixtures unchanged.
- The adapter, viewer, and field projection operate on parsed copies; raw LP artifact bytes and outcomes remain unchanged.
- Field-end mapping uses the local `team-period-field-end-v1` test fixture explicitly labelled `authored_demo_orientation_test_only`; it validates coordinate conversion and does not claim observed historical field orientation.

## Results

- Seed 1 integration status: viewer PASS; per-seed LP survey row is pinned below.
- Contract drift: none. The enforced full SHA-256 is `ae7b8a304dda480c3708b2543172f3fdc5064b156bf1b25816855acf31bc21b7`.
- `b915b767…` is the earlier proof document SHA prefix, not the shared contract SHA.

## Exact command output

```text
COMMAND python3 scripts/repin_e2.py --lp-evidence-sha b2e3be48 --artifact /root/lp-nfl-sequence-e2/docs/fixtures/e2/e2-game-seed1.json --verify-only
PASS isolated Gridiron branch=research/gridiron-e2-game-viewer-2026-10-24
PASS shared full-game v1 contract SHA-256=ae7b8a304dda480c3708b2543172f3fdc5064b156bf1b25816855acf31bc21b7
NOTE b915b767 is the prior proof-document SHA prefix; contract pin is ae7b8a30…31bc21b7
PASS immutable LP artifact: commit=b2e3be4876d644d2ad8a5f94b7d25365ba7ba724 path=docs/fixtures/e2/e2-game-seed1.json sha256=0a3ed1cb216fa3f23784b427d2bf6e68ac877ab1995fb86cd5998d35d5b47821
SURVEY per-seed: docs/fixtures/e2/survey-per-seed-300.csv sha256=ee99bcef65024339f09b07ced87290bd57f3d940d7d577ee89abaae63af3580a rows=300; seed=1,status=complete_regulation,blocker=,complete_game=True,valid_full_game=False,scope_out=,matrix_fail=0,v1_violations=V-duration-seconds;V-mode;V-unresolved-as_of_utc;V-unresolved-game_id;V-unresolved-roster_snapshot_id;V-unresolved-scheduled_kickoff_utc;V-unresolved-snapshot_hash
SURVEY aggregate: docs/fixtures/e2/survey-300-summary.txt sha256=d40bffbee49da0cb811825db6791bac57d8851c369ad763f747835560941ac6d; games=300 validated=300 complete_regulation=293 valid_full_game=0; status {'complete_regulation': 293, 'blocked': 7}; blocker {None: 293, 'thin_kick_cell:field_goal:50+': 2, 'overtime_not_modelled': 5}; matrix FAIL rows across all games: 0
LP BLOCKER 1: Extra-point and two-point rates from `extra_point_result` and `two_point_conv_result` — Verified — commit `606991c9` — The regenerated fixture is byte-identical to the committed CSV. A pyarrow recount over the raw files gives extra points 4,643 good, 178 failed, 38 blocked, 11 empty, and two-point tries 240 success, 269 failure. `test_kick_results.py` (4).
LP BLOCKER 2: Rule 11-4-2 missed-field-goal spot, with boundary tests — Done — commit `5f229944` — The unit tests cover the spot at 35, 25, 15, 5 and at the boundary 20 and 21. An engine test checks that a kick from the 20 leaves the receiver at 80 and from the 21 at 79. A matrix negative fixture fails the 80 for a kick from the 21. The rule text is cited from the review and is not in the repository, so it is still unverified.
LP BLOCKER 3: `drive_index` mismatch rejection covering the 23 findings — Done — commit `2e23235b` — The archived 5fcaa6bc record (`regression/`, sha256 `ff061723…`) has drive_index 1 on every play state of drives 2 to 24: **23 drives, 280 states**. The validator and the matrix both count every drive and state. A regression test pins 23 and 280.
LP BLOCKER 4: Both coin-toss winners sampled, not fixed to A — Verified; no code change — commit — — Over seeds 1–300 from `play_game` with no fixed winner: winner A 153, B 147; choice receive 155, defer 145. `TossSymmetry` (4).
LP BLOCKER 5: Clock, timeout, two-minute-warning and penalty transitions implemented or guarded — Done — commit `7f40f815` — Guards exist for timeouts, two-minute warning, penalties, onside kicks, overtime, lineups and the exception coin toss, and the validator requires each. The timeout guard now describes what `_apply_timeouts` does: an observed timeout flag charges the side it names, at most three per half, reset at halftime. A new test checks the counts stay in 0 to 3, reach 0 in the first half, and reset to 3 at halftime. The two-minute-warning guard now says the warning's effect on the runoff is unverified.
PASS browser runtime: Playwright=/root/.npm/_npx/fd3bca3c548369c0/node_modules/playwright/index.mjs Chrome=/root/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome
$ python3 test/repin_e2_contract.py
..
----------------------------------------------------------------------
Ran 2 tests in 0.001s

OK
$ node test/field-end-assignment.mjs
Field-end assignment: 8/8 checks passed
Plus fixture: Q2 NE dir=+1, yardline_100=28 -> los=72
Minus fixture: Q2 NYG dir=-1, yardline_100=28 -> los=28
Rejections: missing team-period assignment, implicit home/away direction, missing version, home/away pseudo-team ID, out-of-range yardline_100
$ node test/e2-game-viewer-repin.mjs
PASS adapter + independent state audit: 24 drives / 143 plays; 0 state findings; drive-index mismatches=0; 8 raw-record v1 gaps
PASS field-end projection: team-period-field-end-v1 (authored test-only); 137 state_after spots (+1=66, -1=71); 6 null terminal spots preserved; 0 mismatches
PASS browser viewer: loaded and navigated Drive 24 / Play 143; score A 14–B 10; runtime errors=0
FAIL shared full-game v1 conformance: 8 raw-record gaps remain
  OPEN LP FIELD: mode is not pregame_full_game
  OPEN LP FIELD: missing stable game_id
  OPEN LP FIELD: missing model_version
  OPEN LP FIELD: missing rules_version
  OPEN LP FIELD: missing or invalid top-level as_of_utc before scheduled_kickoff_utc
  OPEN LP FIELD: missing real home/away team identities
  OPEN LP FIELD: missing eligible roster snapshot
  OPEN LP FIELD: record.valid_full_game is not true
FAIL full-game signoff: LP valid_full_game=false
LP valid_full_game=false; unsupported_rules=["timeouts","two_minute_warning","penalties","onside_kicks","overtime","exception_coin_toss","lineups"]
PASS verification-only: existing manifest pin remains 1ca7560924fe7da3eb452b142176bf09d7aeb1f0; no fixture or manifest was changed
SURVEY integration: seed=1 viewer=PASS; per-seed CSV and aggregate status were read from LP commit b2e3be4876d644d2ad8a5f94b7d25365ba7ba724.
```

## Outstanding LP-side blockers

The seed-1 integration can pass while shared-v1/full-game signoff remains failed; Gridiron does not fill LP's missing fields.

- Raw-record v1 gate: `FAIL shared full-game v1 conformance: 8 raw-record gaps remain`. Each open field is listed in the command output above.
- LP valid_full_game=false; unsupported_rules=["timeouts","two_minute_warning","penalties","onside_kicks","overtime","exception_coin_toss","lineups"]
- LP BLOCKER 1: Extra-point and two-point rates from `extra_point_result` and `two_point_conv_result` — Verified — commit `606991c9` — The regenerated fixture is byte-identical to the committed CSV. A pyarrow recount over the raw files gives extra points 4,643 good, 178 failed, 38 blocked, 11 empty, and two-point tries 240 success, 269 failure. `test_kick_results.py` (4).
- LP BLOCKER 2: Rule 11-4-2 missed-field-goal spot, with boundary tests — Done — commit `5f229944` — The unit tests cover the spot at 35, 25, 15, 5 and at the boundary 20 and 21. An engine test checks that a kick from the 20 leaves the receiver at 80 and from the 21 at 79. A matrix negative fixture fails the 80 for a kick from the 21. The rule text is cited from the review and is not in the repository, so it is still unverified.
- LP BLOCKER 3: `drive_index` mismatch rejection covering the 23 findings — Done — commit `2e23235b` — The archived 5fcaa6bc record (`regression/`, sha256 `ff061723…`) has drive_index 1 on every play state of drives 2 to 24: **23 drives, 280 states**. The validator and the matrix both count every drive and state. A regression test pins 23 and 280.
- LP BLOCKER 4: Both coin-toss winners sampled, not fixed to A — Verified; no code change — commit — — Over seeds 1–300 from `play_game` with no fixed winner: winner A 153, B 147; choice receive 155, defer 145. `TossSymmetry` (4).
- LP BLOCKER 5: Clock, timeout, two-minute-warning and penalty transitions implemented or guarded — Done — commit `7f40f815` — Guards exist for timeouts, two-minute warning, penalties, onside kicks, overtime, lineups and the exception coin toss, and the validator requires each. The timeout guard now describes what `_apply_timeouts` does: an observed timeout flag charges the side it names, at most three per half, reset at halftime. A new test checks the counts stay in 0 to 3, reach 0 in the first half, and reset to 3 at halftime. The two-minute-warning guard now says the warning's effect on the runoff is unverified.
- SURVEY per-seed: docs/fixtures/e2/survey-per-seed-300.csv sha256=ee99bcef65024339f09b07ced87290bd57f3d940d7d577ee89abaae63af3580a rows=300; seed=1,status=complete_regulation,blocker=,complete_game=True,valid_full_game=False,scope_out=,matrix_fail=0,v1_violations=V-duration-seconds;V-mode;V-unresolved-as_of_utc;V-unresolved-game_id;V-unresolved-roster_snapshot_id;V-unresolved-scheduled_kickoff_utc;V-unresolved-snapshot_hash
- SURVEY aggregate: docs/fixtures/e2/survey-300-summary.txt sha256=d40bffbee49da0cb811825db6791bac57d8851c369ad763f747835560941ac6d; games=300 validated=300 complete_regulation=293 valid_full_game=0; status {'complete_regulation': 293, 'blocked': 7}; blocker {None: 293, 'thin_kick_cell:field_goal:50+': 2, 'overtime_not_modelled': 5}; matrix FAIL rows across all games: 0

LP's blocker ledger records the scoped fixes and their evidence. The survey still marks timeouts, the two-minute warning, penalties, onside kicks, overtime and lineups as unsupported in all 300 games; its zero matrix-fail count does not promote any record to a legal `valid_full_game`. The seed-1 v1 gaps remain the explicit failures above.
These are LP-reported source statuses pinned at the evidence commit. Gridiron independently checks the immutable seed-1 payload and does not change LP event results.

## Apply-mode smoke test

The same command without `--verify-only` was run in a disposable worktree on `research/gridiron-e2-game-viewer-repin-test`, based on Gridiron commit `2dc21c80e019127ca40fd6a9c1eb6f2db5f2a1b2`. It wrote versioned b2e3 envelope/raw files and updated only that worktree's manifest. The generated envelope SHA-256 was `30354e16f8fd1c4c64a0f1ab6ebb456ce3738b832a90b54a30a395834458de8f`; the raw SHA-256 remained `0a3ed1cb216fa3f23784b427d2bf6e68ac877ab1995fb86cd5998d35d5b47821`.

Post-apply checks in that disposable worktree:

```text
LP E2 game adapter: assertions passed
fixture=game-seed1-b2e3be48.json sha256=30354e16f8fd1c4c64a0f1ab6ebb456ce3738b832a90b54a30a395834458de8f
upstream=lp-e2-game-seed1-b2e3be48.json sha256=0a3ed1cb216fa3f23784b427d2bf6e68ac877ab1995fb86cd5998d35d5b47821
drives=24 plays=143 score=A 14, B 10
football-state findings=0; raw-record v1 gaps=8; projected-v1 source gaps=7
E2 viewer DOM audit: LP b2e3be4876d644d2ad8a5f94b7d25365ba7ba724 loads 24 drives / 143 plays; E3 diagnostics and caveats rendered
Real Chromium navigation: LP b2e3be4876d644d2ad8a5f94b7d25365ba7ba724 navigated Drive 24 / Play 143; archived 5fc hard-rejected
Browser runtime errors: 0
```

The active E2 worktree's manifest remains pinned to LP `1ca75609`; this smoke test only exercised the future apply path.
