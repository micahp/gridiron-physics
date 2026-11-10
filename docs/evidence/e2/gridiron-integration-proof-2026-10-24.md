# Gridiron E2 game → drive → play integration proof — 2026-10-24

## Scope and source identity

This proof consumes LP's raw seed-1 JSON at `docs/fixtures/e2/e2-game-seed1.json`, pinned from LP commit `a442dcd72559cfaf2d04737fc2454cea486faf09`. It is the actual LP artifact, copied byte-for-byte for static serving. It is a **retrospective statistical game record** (`mode=legal_game_state_first_piece`) with abstract teams A/B, not an identified NFL matchup or a 2026 forecast. `valid_full_game=false` remains false at both the LP payload and record levels.

| Input | Exact pin |
| --- | --- |
| LP repository | `git@github.com:micahp/legendarypicks.git` |
| LP branch | `feat/nfl-sequence-e2-kickoffs-2026-10-24` |
| LP commit | `a442dcd72559cfaf2d04737fc2454cea486faf09` |
| LP artifact path | `docs/fixtures/e2/e2-game-seed1.json` |
| LP artifact SHA-256 | `0a3ed1cb216fa3f23784b427d2bf6e68ac877ab1995fb86cd5998d35d5b47821` |
| Byte-identical Gridiron snapshot | `docs/fixtures/e2/lp-current-seed1.json` |
| Snapshot SHA-256 | `0a3ed1cb216fa3f23784b427d2bf6e68ac877ab1995fb86cd5998d35d5b47821` |
| Dynamic pin manifest | `docs/fixtures/e2/real-record-pin.json` |
| Pin manifest SHA-256 for this repin | `7cf0b950ed6d7db0275626cd2aff722a74b407048f36a18b13b3c23d14cda166` |
| Gridiron branch base before this work | `fdcca41eed2356d6954ddb7fecd1586eb5a9849b` on `research/gridiron-e2-game-viewer-2026-10-24` |

The record has 24 drives, 143 plays, final LP score A 14–B 10, and `valid_full_game=false`. Its 143 participants are labelled sampled historical participants. The play objects contain no explicit 3D trajectory frames, so the viewer marks 3D replay **unavailable on each of the 143 plays**.

## Repin command

Run one command when LP publishes a new immutable evidence commit. Replace only the commit argument; the script resolves its full SHA, reads the requested path from that Git object, computes the raw artifact SHA-256, and writes both the byte snapshot and pin manifest. No artifact hash is embedded in the script.

```bash
python scripts/repin_e2_real_record.py \
  --lp-repo /root/lp-nfl-sequence-e2 \
  --lp-commit a442dcd7 \
  --artifact-path docs/fixtures/e2/e2-game-seed1.json
```

Output for this pin:

```text
PASS: pinned LP artifact a442dcd72559cfaf2d04737fc2454cea486faf09:docs/fixtures/e2/e2-game-seed1.json
Artifact SHA-256: 0a3ed1cb216fa3f23784b427d2bf6e68ac877ab1995fb86cd5998d35d5b47821
Snapshot: docs/fixtures/e2/lp-current-seed1.json (415555 bytes)
Record: seed=1 drives=24 plays=143 valid_full_game=false
```

## Viewer

- Matchup availability page: `e2-matchups.html`.
- Direct LP-record viewer: `e2-lp-real-record-viewer.html`.
- Serve from the repository root without a build step: `python3 -m http.server 8080 --directory .`, then open `http://localhost:8080/e2-matchups.html`.
- Both pages have a persistent `2022-pool retrospective demonstration · Not a 2026 forecast · valid_full_game=false` banner.
- The record viewer reads the dynamic pin manifest and verifies the raw snapshot hash before rendering. It displays LP mode, seed, source commit/path/hash, A/B score, all drives, play IDs and event text. Per-play state shows source quarter and clock, down and distance, `yardline_100`, possession, defense and home/away score before and after. Authored field-end `dir`/`los` is labelled with its source/version.
- The selected play's LP values are rendered from the unmodified record. `projectPlay` adds display values only; `assertPlayProjectionMatchesRecord` checks the display projection against its source fields and rejects a drive/state index disagreement.
- The matchup table lists the six requested pairings. Each row reports unavailable score, drive and play totals with a matchup-specific reason. LP currently provides only seed 1 with abstract A/B teams; the seed-1 artifact is linked separately and is not mapped to any requested matchup.

### LP file contract needed to populate matchup rows

LP should publish `docs/fixtures/e2/matchup-index.json` with schema `lp.nfl.e2-matchup-index.v1` and this shape:

```json
{
  "schema": "lp.nfl.e2-matchup-index.v1",
  "lp_commit": "<full LP commit SHA containing these immutable artifacts>",
  "games": [
    {
      "game_id": "<stable game identifier>",
      "away_team": {"team_id": "<LP team ID>", "abbr": "<abbr>", "name": "<display name>"},
      "home_team": {"team_id": "<LP team ID>", "abbr": "<abbr>", "name": "<display name>"},
      "team_sides": {"A": "<team_id>", "B": "<team_id>"},
      "record_path": "docs/fixtures/e2/<immutable-game-record>.json",
      "record_sha256": "<SHA-256 of the exact record file bytes>"
    }
  ]
}
```

Each `record_path` must resolve to the raw `lp-e2-game-1` JSON containing `record`, with its exact artifact hash. The stable `game_id` and explicit home/away identities plus `team_sides` map LP's A/B score fields to the matchup. Drive and play counts are derived from the referenced record. Until LP publishes those entries and records, each matchup stays unavailable. This consumer does not infer identities from sampled play sources or scores.

## Independent reconciliation

The reconciliation test reads the artifact directly from the LP Git object named in the pin manifest (`git show <commit>:<path>`), checks that byte hash against the manifest and local snapshot, and independently compares every rendered field with the raw record. The real-browser test traverses all 24 drives and all 143 plays, reads the visible state's source-value attributes and formatted text, and verifies the same values.

| Rendered value | Direct LP source fields | Checks | Result |
| --- | --- | ---: | --- |
| Game final A/B score | `record.points.A/B` | 2 | Pass |
| Game clock before/after | `state_before/after.clock_seconds` | 286 | Pass |
| Quarter before/after | `state_before/after.quarter` | 286 | Pass |
| Home/away score before/after | `state_before/after.home_score/away_score` | 572 | Pass |
| Drive index in drive header and both play states | `drive.index`, `state_before/after.drive_index` | 429 | Pass |
| Possession/defense before/after | `state_before/after.offense_team/defense_team` | 572 | Pass |
| Down and distance before/after | `state_before/after.down/yards_to_go` | 572 | Pass |
| Ball spot before/after | `state_before/after.yardline_100` | 286 | Pass |
| Event text | `event_type`, `outcome.yards_gained`, `outcome.touchdown` | 143 plays | Pass |
| Drive summary rows | `index`, `offense_team`, start/end quarter and clock, play count, `terminal` | 24 drives | Pass |
| 3D availability | Explicit LP 3D frame data per play | 143 plays | Unavailable, shown per play |

Negative fixtures in `docs/fixtures/e2/real-record-reconciliation-negative.json` are all rejected:

| Fixture | Expected rejection |
| --- | --- |
| `tampered-clock` | Rendered `before.clock_seconds` differs from LP `state_before` |
| `tampered-score` | Rendered `before.home_score` differs from LP `state_before` |
| `mismatched-drive-index` | LP `state_before.drive_index` differs from its containing drive index |

## Test commands and results

Direct-source reconciliation and negative fixtures:

```bash
LP_SEQUENCE_REPO=/root/lp-nfl-sequence-e2 node test/e2-real-record-reconciliation.mjs
```

```text
PASS direct LP artifact a442dcd72559cfaf2d04737fc2454cea486faf09:docs/fixtures/e2/e2-game-seed1.json sha256=0a3ed1cb216fa3f23784b427d2bf6e68ac877ab1995fb86cd5998d35d5b47821
PASS rendered projection reconciled: drives=24/24, plays=143/143
PASS exact field checks: clock=286 quarter=286 score=572 drive_index=429 possession=572 down_distance=572 ball_spot=286
PASS negative fixtures rejected: tampered-clock, tampered-score, mismatched-drive-index
```

Real Chromium navigation and rendered-value reconciliation:

```bash
LP_SEQUENCE_REPO=/root/lp-nfl-sequence-e2 \
PLAYWRIGHT_MODULE=/root/gridiron-physics-m4c/node_modules/playwright/index.mjs \
CHROME_BIN=/root/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome \
node test/e2-real-record-viewer.browser.mjs
```

```text
PASS Chromium rendered and reconciled every LP play: 143/143, drives=24
PASS browser exact-field checks: clocks=286, quarter=286, scores=572, drive index=429, possession=572, down/distance=572, ball spot=286
PASS navigation boundaries; 3D unavailable status shown per play; browser errors=0
```

The existing adapter regression also passes with 24 drives, 143 plays, 0 football-state findings, and keeps its shared-v1/pregame gaps open; this viewer does not claim legal-game or pregame conformance. No LP source code, shared v1 contract, engine behavior, or production artifact was modified.
