# Gridiron E2 full-game viewer handoff — 2026-10-24

## Pinned revisions

- Gridiron branch: `research/gridiron-e2-game-viewer-2026-10-24`
- Gridiron implementation commit: `0e4db756f7a1f9b19a68e5df373666e45efe44e3` — read-only game → drive → play adapter and viewer.
- LP branch: `feat/nfl-sequence-e2-kickoffs-2026-10-24`
- LP producer commit: `3daa0ed6dc99c3bdc666d5c0f226af02173e05cc`.
- E1/shared-contract base: `2248f7e1`; `GRIDIRON-CONTRACT-v1.md` is unchanged and its SHA-256 matches in both repos:
  `ae7b8a304dda480c3708b2543172f3fdc5064b156bf1b25816855acf31bc21b7`.
- Fixture: `docs/fixtures/e2/game-seed1.json`, SHA-256
  `c26d41fecda9477c6f5c5dd45c8c0f4fefd009ab99f69bb193a2494b74a42396`.

The source-file hashes and fixture pin are in `docs/fixtures/e2/MANIFEST.json`. The game record is emitted by LP's committed
`scripts/nfl_sequence/emit_game.py`; Gridiron wraps it with transport metadata while retaining `record` unchanged.

## Verification

- LP: `python3 -m unittest scripts/nfl_sequence/test_game_state.py scripts/nfl_sequence/test_e1_transitions.py` — **40 tests
  pass**.
- LP: `python3 scripts/nfl_sequence/emit_game.py --scan 300 --out /tmp/lp-e2-emitted-game.json` — seed 1 emitted with 24
  drives, 144 plays, score A 11–B 17; rules matrix has 13 PASS, 5 UNSUPPORTED, 1 PARTIAL, 3 NOT_APPLICABLE, and no FAIL.
- Gridiron: `node test/lp-game-record-adapter.mjs` — assertions pass; 24 drives and 144 plays are readable, the exact LP
  record is retained, and the validator reports 23 drive-index findings plus 12 shared-v1 violations.
- Gridiron: `node --check` passes for both modules; JSON parsing and `git diff --check` pass. A localhost static smoke check
  returned HTTP 200 for the viewer, module, manifest, and fixture.

## Open LP findings

1. Drives 2–24 embed E1 states with `drive_index: 1`; the viewer reports these mismatches without repairing them.
2. Play IDs use a drive-specific simulation prefix and reset local sequence, rather than one game-wide v1 ID namespace.
3. The coin-toss ledger always names team A as toss winner; A/B do not map to actual home/away teams.
4. Extra-point and two-point rates use nflverse `success`, which means `EPA > 0`, not kick conversion. Dedicated outcomes
   must be ingested before those rates or derived scores are trusted.
5. The 300-game survey remains pending. `valid_full_game` is false while unsupported rules remain; the fixture is a completed
   regulation statistical record, not a fully legal game or forecast.

No tracking cohort, weeks 6–9 tracking holdout, main branch, or production system was changed. The viewer is a read-only event
and field-state timeline; it does not fabricate a 3D roster or motion replay.
