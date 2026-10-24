# Gridiron E2 game payload v1

Status: research transport contract, version **1.0.0**. This contract carries an LP game record to a read-only Gridiron
viewer. It does not certify a legal NFL game, a forecast, or conformance with `GRIDIRON-CONTRACT-v1`.

## Purpose and identity

The payload is an envelope around one immutable LP record. The envelope pins the producer source; `record` is the LP game
record, retained without rewriting plays, events, results, score, player attribution, or missing values. Gridiron may derive
display-only indexes and labels, but every displayed play links back to the same source object.

The current E2 record uses team labels `A` and `B`, a coin-toss ledger, kickoffs, drive summaries, and nested play arrays.
Its generated plays have drive-local identifiers such as `e2-<seed>-drive1:1`. The viewer preserves those identifiers.
It does not pretend they form the single game-wide `simulation_id:sequence` namespace required by the shared v1 contract.

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

- `mode`, `seed`, `ledger`, `kickoffs`, `drives`, `points`, `stats`, `status`, `blocker`, `tied`, `complete_regulation`,
  `final_quarter`, `final_clock_seconds`, `valid_full_game`, `unsupported_rules`, and `gaps`.
- `drives` is chronological. Every drive has a one-based contiguous `index`, `offense_team`, start/end quarter and clock,
  `terminal`, and a non-empty `plays` array.
- Plays remain in drive order and carry `sequence`, source `id`, `event_type`, `state_before`, `state_after`, `outcome`,
  `decision`, `sampling`, `field`, and `participants`. A drive's local `sequence` starts at 1. Source IDs must end in
  `:<sequence>` and be unique across the game. Their original scope is preserved; the adapter does not mint replacement IDs.
- `participants.attribution` and each `outcome.sampled_from` are displayed as supplied. Sampled historical participants are
  not presented as the simulated game's roster.
- A complete regulation record ends in Q4 at 0 seconds. It may still have `valid_full_game: false` because unsupported rules,
  ties, or other LP gates remain. The viewer reports both fields independently.
- `points` must equal the sum of the per-drive `points_scored_on_drive` entries, including tries. If team stat lines are
  present, their point totals must agree too.
- Coin-toss half-start kickoffs must match the ledger. `after_drive` links each kickoff to the number of drives already
  completed; it is not interpreted as a play or added to the LP outcome stream.

Null, absent, and unsupported values stay distinct. The viewer must not fill a missing team identity, score-at-play state,
timeout, roster, lineup, route, movement, or kick result. A display-only game-play ordinal is permitted; it must never replace
the source drive-local `sequence` or `id`.

## Shared v1 boundary

The research fixture is not `pregame_full_game` v1. The current E2 record has no scheduled `game_id`, pregame `as_of` snapshot,
real team identities, eligible roster, or single game-wide simulation ID. Its participants and event outcomes are sampled
retrospectively. The source records explicitly mark `valid_full_game: false` where appropriate. The adapter reports these
as shared-v1 violations and still permits a read-only inspection when the record reaches the end of regulation.

The earlier E2 commit `60b7708b` stored drive play counts without nested play records. LP commit
`3daa0ed6dc99c3bdc666d5c0f226af02173e05cc` adds the committed nested-play refactor and `emit_game.py`. The pinned example
was emitted by that commit. Gridiron never reconstructs missing plays from drive counts.

The first emitted game (seed 1) has 24 drives and 144 plays, score A 11–B 17, and rules-matrix counts of 13 PASS, 5
UNSUPPORTED, 1 PARTIAL, and 3 NOT_APPLICABLE. It is complete through regulation, while `valid_full_game` correctly remains
false because rules are unsupported. Drives 2–24 have `drive.index` 2–24, while every embedded E1 play state still says
`drive_index: 1`. The validator reports these 23 findings and leaves the source values unchanged. Kickoff `after_drive`
links, receiver-to-next-drive linkage, drive order, and score reconciliation pass for this fixture.

## Viewer behavior

The viewer navigates game → drive → play, shows the LP score and event outcome, and offers the raw selected play for inspection.
It is an event/field-state viewer, not a 3D physical replay: the record does not contain this game's roster, lineups, routes,
or motion. It prominently labels the game as a retrospective statistical simulation and leaves the LP result untouched.

Validation entry point: `web/lp-game-record-adapter.js`. Focused tests: `node test/lp-game-record-adapter.mjs`.
