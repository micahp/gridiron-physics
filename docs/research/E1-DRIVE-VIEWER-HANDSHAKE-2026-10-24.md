# E1 drive viewer and schema handshake (2026-10-24)

**Status:** read-only **E1 drive viewer** and validator, built as a separate profile from E0a. It accepts the ten pinned LP E1
fixtures as **retrospective research drives**. It is not a legal game, not a pregame simulation, not a forecast, and not a
physical replay. Nothing was merged, deployed or changed in the shared contract. The E0a viewer and its tests are unchanged.

## Pinned sources

- LP repository `micahp/legendarypicks`, branch `feat/nfl-sequence-e1-2026-10-24`, LP head
  **`2248f7e1f9710daa3092104526ab6003a0fc3b18`**. The ten fixtures and their SHA-256 values are in
  `docs/fixtures/e1/MANIFEST.json`. Each fixture was copied from that commit.
- This supersedes the pin at `e621e83ef86b2255bd6622f32d691553ea2abaaf`, the pin at
  `641e1b2ea7882389778a14e6c52b58583f7e9917`, and the earlier pin at
  `945754080086a1f9ae6dac06740041826395b017`. The fixtures remain schema **1.1**: a halftime or
  end-of-regulation record has a null field endpoint, and its final play position is in
  `outcome.final_play_yardline_100`. They also use the shared v1 play ID form `<simulation_id>:<sequence>`.

## What was built

| File | Role |
| --- | --- |
| `web/lp-drive-record-adapter.js` | Validator and frozen display model for `mode = drive_statistical_demo`. Separate from the E0a adapter. |
| `web/e1-drive-viewer.js`, `web/e1-drive-viewer.css`, `e1-drive-record.html` | Read-only table and timeline page. Loads the pinned fixtures, verifies each hash in the browser, and accepts a local JSON file. `?fixture=<name>` selects a pinned fixture. |
| `test/lp-drive-record-adapter.mjs` | 27 tests (below). |
| `docs/fixtures/e1/*.json`, `MANIFEST.json` | Pinned copies of the ten fixtures at the newer LP head. |

The E0a page (`e0-record.html`), its adapter and its test are unchanged. The E0a test still passes.

## Verification run

- `node --test test/lp-drive-record-adapter.mjs`: **28 of 28 pass**. They cover:
  - fixture hashes against the manifest;
  - all ten fixtures accepted, with the recorded drive summary equal to the recomputed one;
  - the eight terminal variants each reached by a fixture;
  - the LP input not mutated, and the display model frozen;
  - state continuity across plays, and quarter changes keeping the drive going;
  - field-goal attempts showing no result, no points and no next possession;
  - halftime and regulation ends with no restart and no winner;
  - nulls preserved, with no defaults;
  - the recomputed clock-clamp count checked against the recorded count;
  - schema 1.0 and 1.1 accepted, any other version rejected; a field endpoint at any terminal without a scrimmage state rejected;
  - the E0 record and the E1 record each rejected by the other viewer;
  - rejection of single-play and full-game modes, `valid_full_game: true`, `end_of_period`, unknown events, broken state chains,
    noncanonical, duplicate or out-of-order IDs, wrong LOS, direction contradicting the authored start, drive-summary tampering, unverified
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

1. **Play ID.** Resolved. The LP producer and all ten pinned fixtures now set `id` to
   `<simulation_id>:<sequence>`, matching `GRIDIRON-CONTRACT-v1`. The viewer validates this relationship on every play.
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

## LP-side defects (status at `2248f7e1`)

- **A. Incorrect gap text: resolved.** No pinned fixture still says "penalties, quarter changes… not modelled". The
  not-modelled and modelled statements are now separate entries.
- **B. Outdated reducer constant: resolved.** `reducer.TERMINALS` lists the eight terminals the records use, and two LP tests
  pin it to the records.
- **C. Half-end endpoint: resolved for schema 1.1.** At halftime and end of regulation `field.after` is null, and the final
  play position is in `outcome.final_play_yardline_100`. The viewer requires a null endpoint wherever there is no scrimmage
  state. It accepts schema `1.0` and `1.1`, and it rejects any other version.
- **D. Play ID contract: resolved.** LP commit `2248f7e1` emits `<simulation_id>:<sequence>`; all ten pinned fixtures
  pass that check, and the Gridiron adapter rejects any play ID that does not match its record's `simulation_id` and sequence.

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

## Coordination status

1. LP fixture pin updated to `2248f7e1` after the ID correction; hashes are fixed in the manifest.
2. Defect D is resolved by using the existing shared ID rule. `GRIDIRON-CONTRACT-v1` remains unchanged.
3. Schema 1.1 remains pinned: halftime and regulation ends have null field endpoints.
