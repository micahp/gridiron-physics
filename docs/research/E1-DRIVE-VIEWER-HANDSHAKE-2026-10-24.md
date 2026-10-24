# E1 drive viewer and schema handshake (2026-10-24)

**Status:** read-only **E1 drive viewer** and validator, built as a separate profile from E0a. It accepts the ten pinned LP E1
fixtures as **retrospective research drives**. It is not a legal game, not a pregame simulation, not a forecast, and not a
physical replay. Nothing was merged, deployed or changed in the shared contract. The E0a viewer and its tests are unchanged.

## Pinned sources

- LP repository `micahp/legendarypicks`, branch `feat/nfl-sequence-e1-2026-10-24`, commit
  **`641e1b2ea7882389778a14e6c52b58583f7e9917`** (the newer LP head). The ten fixtures and their SHA-256 values are in
  `docs/fixtures/e1/MANIFEST.json`. Each fixture was copied from that commit with `git show`.
- This supersedes the earlier pin at `945754080086a1f9ae6dac06740041826395b017`, which the handoff named. The newer records add
  two gap lines per fixture (the field-goal result boundary and the clock-runoff boundary) and a `clock_clamped_plays` count in
  each drive summary. The adapter recomputes that count when it is present.

## What was built

| File | Role |
| --- | --- |
| `web/lp-drive-record-adapter.js` | Validator and frozen display model for `mode = drive_statistical_demo`. Separate from the E0a adapter. |
| `web/e1-drive-viewer.js`, `web/e1-drive-viewer.css`, `e1-drive-record.html` | Read-only table and timeline page. Loads the pinned fixtures, verifies each hash in the browser, and accepts a local JSON file. `?fixture=<name>` selects a pinned fixture. |
| `test/lp-drive-record-adapter.mjs` | 25 tests (below). |
| `docs/fixtures/e1/*.json`, `MANIFEST.json` | Pinned copies of the ten fixtures at the newer LP head. |

The E0a page (`e0-record.html`), its adapter and its test are unchanged. The E0a test still passes.

## Verification run

- `node --test test/lp-drive-record-adapter.mjs`: **25 of 25 pass**. They cover:
  - fixture hashes against the manifest;
  - all ten fixtures accepted, with the recorded drive summary equal to the recomputed one;
  - the eight terminal variants each reached by a fixture;
  - the LP input not mutated, and the display model frozen;
  - state continuity across plays, and quarter changes keeping the drive going;
  - field-goal attempts showing no result, no points and no next possession;
  - halftime and regulation ends with no restart and no winner;
  - nulls preserved, with no defaults;
  - the recomputed clock-clamp count checked against the recorded count;
  - the E0 record and the E1 record each rejected by the other viewer;
  - rejection of single-play and full-game modes, `valid_full_game: true`, `end_of_period`, unknown events, broken state chains,
    duplicate or out-of-order IDs, wrong LOS, direction contradicting the authored start, drive-summary tampering, unverified
    as-of sources, non-retrospective pools, participant identities and scores, punt yards, missing terminals, and a terminal
    before the last play.
- `node test/lp-play-record-adapter.mjs` (E0a): passes.
- Syntax check of both browser modules as ES modules: passes.
- **Headless Chromium** (Playwright-cached `chromium_headless_shell` 1187, `--no-sandbox`, served by a temporary
  `python3 -m http.server` bound to `127.0.0.1`, stopped afterwards): all **ten** pinned fixtures render with the retrospective
  label, no rejection, the manifest hash match, the expected terminal text, and the right row count (plays plus header).
  **Limitation:** this was a DOM dump, not an interactive session. No screenshots were captured, and no pointer or keyboard
  behaviour was tested.

## Wire shape

The E1 document is a **drive** profile. It is not the E0a single-play envelope.

- Top level: `schema_version`, `mode`, `valid_full_game` (false), `simulation_id`, `seed`, `model_version`, `rules_version`,
  `start_state`, `plays[]`, `drive` (summary), `provenance`, `outcome_pool`, `gaps`.
- Per play: `sequence`, `id`, `event_type`, `state_before`, `state_after`, `sampling`, `decision`, `outcome`, `field`.
- `drive` replaces the E0a `summary`. It has no `valid_full_game` inside it.

## Schema incompatibilities

These are reported, and the shared contract is not changed.

1. **Play ID.** `GRIDIRON-CONTRACT-v1` says `play_id` is `<simulation_id>:<sequence>`. E1 uses `e1-seed<seed>:<sequence>`, because
   its `simulation_id` is `e1-<start>-seed<seed>`. The viewer accepts the E1 form. The shared contract, as written, does not.
2. **Missing identity fields.** E1 has no `game_id`, no `teams` and no `start_state_source`. The shared contract requires
   `game_id` and `teams`. E1 has `start_state` with `source` instead.
3. **Missing summary.** E1 has `drive` where the shared contract and E0a expect `summary`.
4. **Event names.** E1 uses `field_goal_attempt` and `fumble_lost`. E0a lists `field_goal` and `fumble`. The two are not
   equivalent. A `field_goal` name implies a kick result, which E1 does not have. **No mapping is applied.** Unknown names are
   rejected, and nothing falls back to `run`.
5. **Terminal vocabulary.** E1 terminals: `touchdown`, `turnover`, `turnover_on_downs`, `punt`, `field_goal_attempt`,
   `safety`, `halftime`, `end_of_regulation`. A Q1 or Q3 end is a `quarter_change` flag and never a terminal.
   `end_of_period` is rejected.
6. **Field assignment.** E1 uses `e1-field-end-v2` with source `authored_demo_orientation`. E0a requires `e0-field-end-v1`.
   The viewer accepts the E1 value only in the drive profile.
7. **Mode.** `drive_statistical_demo` is multi-play. E0a requires `single_play_statistical_demo` with exactly one play. The two
   are not interchangeable, and each viewer rejects the other.

## LP-side defects (for the LP owner)

Status at `641e1b2e`: A, B and C are all still present. The newer records do not fix them.


- **A. Incorrect gap text.** The pinned fixtures still say "penalties, quarter changes, timeouts, two-minute rules: not
  modelled", while quarter ends are modelled. The line appears at `641e1b2e` too.
- **B. Outdated reducer constant.** `scripts/nfl_sequence/reducer.py` at `641e1b2e` still lists `end_of_period`
  in `TERMINALS`, and the E1 generator emits `halftime` and `end_of_regulation`.
- **C. Half-end endpoint.** At halftime and end of regulation, `state_after.yardline_100` is null, but `field.after` holds a
  direction and LOS. Those values equal the play's `outcome.final_play_yardline_100`. The rules file says a half terminal
  must not leave a scrimmage spot. The viewer accepts the endpoint only when it equals that recorded final-play position, and
  labels it as such. LP should either null `field.after` at these terminals or document it in the fixtures.
- **D. Undocumented ID scheme.** See incompatibility 1.

## Not provided, and not invented

- Field-goal results (made or missed). The attempt shows **outcome unknown**, with no points and no next possession.
- Scores, timeouts, penalties, participant identities and player stats. All are null.
- Half-start kickoffs. Halftime displays **no half-start kickoff modelled**. Overtime is not modelled.
- Clock realism. Runoff is shown as the sampled interval, and quarter-end clamping is not hidden.
- Physical replay. The 3D replay is `not_attempted`. No players, kickoffs or ball paths are generated.

## Deterministic commands

```
cd /root/gridiron-e1-drive-viewer
node --test test/lp-drive-record-adapter.mjs
node test/lp-play-record-adapter.mjs
```

Browser check (after serving the worktree on `127.0.0.1` with `python3 -m http.server`):

```
headless_shell --no-sandbox --disable-gpu --virtual-time-budget=20000 --dump-dom \
  'http://127.0.0.1:<port>/e1-drive-record.html?fixture=own25_q2_120-seed1-halftime.json'
```

## Requests to the LP owner

1. Done: the viewer is pinned to `641e1b2e`. Confirm that this is the commit LP wants Gridiron to consume.
2. Fix defects A and B in the LP branch and regenerate fixtures if their output changes.
3. Decide defect C: null `field.after` at halftime and regulation, or document the final-play endpoint.
4. Decide whether `GRIDIRON-CONTRACT-v1` should add a drive profile (play-ID rule, `game_id`, `teams`, `summary`) or keep E1 as a
   separate profile. Gridiron will not change the shared contract without that decision.
