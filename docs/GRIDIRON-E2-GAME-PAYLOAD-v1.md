# Gridiron E2 game payload v1

Status: research transport contract, version **1.0.0**. This contract carries an LP game record to a read-only Gridiron
viewer. It does not certify a legal NFL game, a forecast, or conformance with `GRIDIRON-CONTRACT-v1`.

## Purpose and identity

The payload is an envelope around one immutable LP record. The envelope pins the producer source; `record` is the LP game
record, retained without rewriting plays, events, results, score, player attribution, or missing values. Gridiron may derive
display-only indexes and labels, but every displayed play links back to the same source object.

The current E2 record uses team labels `A` and `B`, a coin-toss ledger, kickoffs, drive summaries, and nested play arrays.
Each game has one `simulation_id`; play `sequence` is contiguous across drive boundaries, and every ID is
`<simulation_id>:<sequence>`. The viewer validates and preserves this game-wide namespace.

## Envelope

```json
{
  "contract": {
    "name": "gridiron.lp-full-game-payload",
    "version": "1.0.0"
  },
  "source": {
    "repository": "micahp/legendarypicks",
    "branch": "feat/nfl-sequence-e2-kickoffs-2026-10-24",
    "base_commit": "<40-character Git SHA>",
    "producer_worktree_dirty": true,
    "producer_file_sha256": {
      "scripts/nfl_sequence/game_state.py": "<SHA-256>"
    },
    "data_source": {
      "table": "nfl_pbp",
      "seasons": [2022, 2025],
      "week_max": 18,
      "as_of": "unknown",
      "selection": "retrospective empirical sampling"
    }
  },
  "record": { "...": "unaltered LP game record" }
}
```

`source.producer_file_sha256` pins the relevant producer files as a content check, and the fixture manifest pins the entire
envelope bytes. When the producer worktree is dirty, its base commit alone is not a release pin; the file hashes make that
state explicit but do not replace an LP commit.

## Required game record fields

- `mode`, `seed`, `simulation_id`, `ledger`, `kickoffs`, `drives`, `points`, `stats`, `status`, `blocker`, `tied`,
  `complete_regulation`, `final_quarter`, `final_clock_seconds`, `valid_full_game`, `unsupported_rules`, and `gaps`.
- `drives` is chronological. Every drive has a one-based contiguous `index`, `offense_team`, start/end quarter and clock,
  `terminal`, and a non-empty `plays` array.
- Plays remain in drive order and carry `sequence`, source `id`, `event_type`, `state_before`, `state_after`, `outcome`,
  `decision`, `sampling`, `field`, and `participants`. Game `sequence` starts at 1 and increments across drive boundaries.
  IDs must equal `<record.simulation_id>:<sequence>` and be unique across the game. The adapter does not mint replacement IDs.
- `participants.attribution` and each `outcome.sampled_from` are displayed as supplied. Sampled historical participants are
  not presented as the simulated game's roster.
- A complete regulation record ends in Q4 at 0 seconds. It may still have `valid_full_game: false` because unsupported rules,
  ties, or other LP gates remain. The viewer reports both fields independently.
- `points` must equal the sum of the per-drive `points_scored_on_drive` entries, including tries. If team stat lines are
  present, their point totals must agree too.
- Coin-toss half-start kickoffs must match the ledger. `after_drive` links each kickoff to the number of drives already
  completed; it is not interpreted as a play or added to the LP outcome stream.

Null, absent, and unsupported values stay distinct. The viewer must not fill a missing team identity, score-at-play state,
timeout, roster, lineup, route, movement, or kick result. The game-wide source `sequence` and `id` remain unchanged.

## Shared v1 boundary

The research fixture is not `pregame_full_game` v1. The current E2 record has no scheduled `game_id`, pregame `as_of` snapshot,
real team identities, or eligible roster. Its participants and event outcomes are sampled
retrospectively. The source records explicitly mark `valid_full_game: false` where appropriate. The adapter reports these
as shared-v1 violations. Read-only inspection is only available after the independent drive-index hard gate passes.

The earlier E2 commit `60b7708b` stored drive play counts without nested play records. LP commit
`3daa0ed6dc99c3bdc666d5c0f226af02173e05cc` added the committed nested-play refactor and `emit_game.py`; LP commit
`702f41db569de04a962b6f1336460d5273b66ce0` added the game-wide play ID namespace. The original viewer source pin was LP E2 commit `5fcaa6bc3ab92ab54cb584511f5205a2e1b4be0f`; that 144-play envelope is retained as an archived regression beside the current fixture. The viewer now pins LP record commit `1ca7560924fe7da3eb452b142176bf09d7aeb1f0` and envelope commit `45381829488e43813a31793ee546df0b95dee856` in `docs/fixtures/e2/MANIFEST.json`. Gridiron never reconstructs missing plays from drive counts.

The archived 5fc game (seed 1) has 24 drives and 144 plays, score A 11–B 17, and rules-matrix counts of 13 PASS, 5
UNSUPPORTED, 1 PARTIAL, and 4 NOT_APPLICABLE. Its 23 grouped drive-index mismatches and missing score/timeout snapshots are retained as a hard-failing regression. See `docs/research/GRIDIRON-E2-INDEPENDENT-STATE-AUDIT-2026-10-24.md` for the path-level baseline.

LP's later committed producer `a78558554ec9f0643b4857c7c4bb46104852c1df` writes the correct drive index to both embedded
state boundaries. Its clean seed-1 output is preserved as an audit-only record at
`docs/fixtures/e2/audit-current-seed1-a785-record.json`; at that point it did not alter the 5fc viewer pin. The a785 record still
lacked per-play score and timeout snapshots and remains `valid_full_game: false`.

The f12 record is preserved as prior audit-only evidence; the final raw record has identical content. The current viewer uses
the final LP envelope and raw record pins listed below.

## Viewer behavior

When the record passes the hard drive-index gate, the viewer navigates game → drive → play, shows the LP score and event outcome, and offers the raw selected play for inspection. Rejected records retain the independent audit and E3 diagnostics while game navigation stays hidden.
It is an event/field-state viewer, not a 3D physical replay: the record does not contain this game's roster, lineups, routes,
or motion. It prominently labels the game as a retrospective statistical simulation and leaves the LP result untouched.

Validation entry point: `web/lp-game-record-adapter.js`. Focused tests: `node test/lp-game-record-adapter.mjs`.


## Final LP evidence pin — 2026-10-24

The viewer loads the exact LP envelope from commit `45381829488e43813a31793ee546df0b95dee856` (SHA-256
`b573713b10b2201c32a0827ab499a5b2b2a6d7de985ab05b7e4bfc51dce1f1a1`) and verifies its embedded record equals the raw LP
payload from commit `1ca7560924fe7da3eb452b142176bf09d7aeb1f0` (SHA-256
`0a3ed1cb216fa3f23784b427d2bf6e68ac877ab1995fb86cd5998d35d5b47821`). The record has 24 drives, 143 plays, score A
14–B 10, zero independent football-state findings, and `valid_full_game: false`. The 5fc envelope and raw source remain
separate named regression fixtures.

The raw-record v1 audit reports eight structural gaps, including missing model/rules metadata and the safe false validity
flag. LP's projected shared-v1 document reports seven unsourced source fields: mode, game ID, kickoff, as-of time, snapshot
hash, roster snapshot, and play duration. The document-specific Gridiron source-gap audit now reports those seven separately.
Its projection has 156 event rows because it includes 13 kickoff/try/period/game boundary events around 143 source plays.
See the independent audit report for the prior six-count reconciliation and its dated delta.
