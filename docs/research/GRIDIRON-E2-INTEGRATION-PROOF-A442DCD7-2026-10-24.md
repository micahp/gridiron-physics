# Gridiron E2 integration proof — LP a442dcd7

Date: 2026-10-24  
Gridiron branch: `research/gridiron-e2-game-viewer-2026-10-24`  
LP accepted evidence commit: `a442dcd72559cfaf2d04737fc2454cea486faf09`

## Gate result and immutable pins

The coordinator verdict is **PASS / ACCEPTED for the scoped completed-regulation research milestone** at LP `a442dcd7`. The full legal-game and shared-v1 pregame gates remain **BLOCKED / OPEN**. This proof records the scoped viewer transport result and its remaining failures; it does not claim legal-game or pregame conformance.

- LP artifact: `docs/fixtures/e2/e2-game-seed1.json`
- LP raw artifact SHA-256: `0a3ed1cb216fa3f23784b427d2bf6e68ac877ab1995fb86cd5998d35d5b47821`
- Gridiron accepted-baseline envelope: `docs/fixtures/e2/game-seed1-a442dcd7.json`
- Gridiron envelope SHA-256: `bbccd70a224035cb09d328194de66368e517524fe1d07df8aabbb7e037134788`
- Gridiron shared contract v1 SHA-256: `ae7b8a304dda480c3708b2543172f3fdc5064b156bf1b25816855acf31bc21b7` (unchanged)
- Seed 1: 24 drives, 143 plays, score A 14–B 10, `valid_full_game: false`.

The adapter test pins the accepted LP commit and raw bytes in `docs/fixtures/e2/MANIFEST.json`, then verifies the immutable envelope record equals those raw bytes. The old LP v1 projection remains a separately named, hash-pinned failing regression fixture. The older 5fc drive-index payload remains another hard-reject regression.

## Real-browser coverage

Chromium opened the accepted envelope through the actual E2 viewer and selected every play across all 24 drives. For every selection, the test checked the displayed source play ID, drive/game sequence, event label, and the unchanged outcome, participant, decision, sampling, and field JSON. It covered all eight event types present in the accepted seed-1 payload:

| Event type | Plays rendered |
| --- | ---: |
| `field_goal_attempt` | 1 |
| `fumble_lost` | 1 |
| `interception` | 1 |
| `pass_complete` | 36 |
| `pass_incomplete` | 23 |
| `punt` | 14 |
| `run` | 63 |
| `sack` | 4 |

This is browser verification of the viewer's generic selected-play detail rendering. It does not assert event-specific physical animation or legal play resolution. The browser also confirms the shared-v1 notice is visible and hard-rejects the archived 5fc record with 23 drive-index mismatches.

Command:

```sh
PLAYWRIGHT_MODULE=/root/.npm/_npx/fd3bca3c548369c0/node_modules/playwright/index.mjs \
CHROME_BIN=/root/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome \
node test/e2-game-viewer.browser.mjs
```

Output:

```text
Real Chromium play render: LP a442dcd72559cfaf2d04737fc2454cea486faf09 rendered 143/143 plays across 8/8 supported event types
Rendered event counts: field_goal_attempt=1, fumble_lost=1, interception=1, pass_complete=36, pass_incomplete=23, punt=14, run=63, sack=4
OPEN shared-v1/pregame gate: viewer displays NOT CONFORMING for the retrospective E2 payload
Regression: archived 5fc payload hard-rejected; v1 regression fixture sha256=c4a7c66418172b9101fbae2a6f1ac40d28c6461761db9c6a23116e7cd77a8b5c
Browser runtime errors: 0
```

## What remains open

The independent raw-record audit reports eight open fields: `mode` is retrospective, stable `game_id` is missing, producer `model_version` and `rules_version` are absent, top-level `as_of_utc` and scheduled kickoff are unavailable, real home/away identities are absent, an eligible roster snapshot is missing, and `valid_full_game` is false. The LP-projected v1 regression separately records seven source gaps, including missing snapshot hash and missing duration on **143/143 plays**.

The pregame fixture still needs:

- A real scheduled game ID and scheduled kickoff timestamp.
- Real home/away team identities and rosters, tied to an eligible roster snapshot.
- An as-of timestamp and hashes for the input snapshots.
- Producer-supplied `model_version` and `rules_version`.
- Explicit duration for every play; all 143 current play durations are missing.
- A producer-supported `valid_full_game: true` after the unsupported game rules are resolved.

The source currently labels `timeouts`, `two_minute_warning`, `penalties`, `onside_kicks`, `overtime`, `exception_coin_toss`, and `lineups` unsupported. Gridiron leaves those outcomes and missing inputs unchanged.

## Focused test results

```text
$ node test/lp-game-record-adapter.mjs
LP E2 game adapter: assertions passed
fixture=game-seed1-a442dcd7.json sha256=bbccd70a224035cb09d328194de66368e517524fe1d07df8aabbb7e037134788
upstream=lp-e2-game-seed1-a442dcd7.json sha256=0a3ed1cb216fa3f23784b427d2bf6e68ac877ab1995fb86cd5998d35d5b47821
drives=24 plays=143 score=A 14, B 10
football-state findings=0; raw-record v1 gaps=8; projected-v1 source gaps=7
OPEN shared-v1/pregame gate: 8 raw-record gaps; v1 regression retains 143 plays without explicit duration
Pinned failing v1 regression: sha256=c4a7c66418172b9101fbae2a6f1ac40d28c6461761db9c6a23116e7cd77a8b5c; source gaps=7; record findings=6

$ python3 test/repin_e2_contract.py
Ran 2 tests ... OK

$ node test/field-end-assignment.mjs
Field-end assignment: 8/8 checks passed

$ PLAYWRIGHT_MODULE=... CHROME_BIN=... node test/e2-game-viewer.browser.mjs
143/143 plays rendered; 8/8 event types rendered; 0 browser runtime errors
```

The a442 repin harness independently found zero football-state findings and zero drive-index mismatches. Its v1/pregame gate remains open as listed above. No shared contract, LP record, or production file was changed.
