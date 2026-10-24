# Gridiron E2 full-game viewer handoff — 2026-10-24

## Pinned revisions

- Gridiron branch: `research/gridiron-e2-game-viewer-2026-10-24`
- Gridiron implementation commit: `83e428b55436bfb2d4104264fd4a038d993cb95f` — adapter/viewer enforces game-wide IDs.
- LP branch: `feat/nfl-sequence-e2-kickoffs-2026-10-24`
- LP producer commit: `702f41db569de04a962b6f1336460d5273b66ce0` — game-wide `simulation_id` and contiguous play sequence.
- E1/shared-contract base: `2248f7e1`; `GRIDIRON-CONTRACT-v1.md` is unchanged and its SHA-256 matches in both repos:
  `ae7b8a304dda480c3708b2543172f3fdc5064b156bf1b25816855acf31bc21b7`.
- Fixture: `docs/fixtures/e2/game-seed1.json`, SHA-256
  `0a11cd89558a97cec5a8913cdc517d6efd8c23b15248954d54b77478d0f2d373`.

The source-file hashes and fixture pin are in `docs/fixtures/e2/MANIFEST.json`. The game record is emitted by LP's committed
`scripts/nfl_sequence/emit_game.py`; Gridiron wraps it with transport metadata while retaining `record` unchanged.

## Verification

- LP: `python3 -m unittest scripts/nfl_sequence.test_game_state scripts.nfl_sequence.test_e1_transitions` — **40 tests
  pass**, including contiguous game-wide play IDs and rejection of a drive-boundary sequence reset.
- LP: `python3 scripts/nfl_sequence/emit_game.py --scan 300 --out /tmp/lp-e2-emitted-game.json` — seed 1 emitted with 24
  drives, 144 plays, score A 11–B 17; rules matrix has 13 PASS, 5 UNSUPPORTED, 1 PARTIAL, 3 NOT_APPLICABLE, and no FAIL.
- Gridiron: `node test/lp-game-record-adapter.mjs` — assertions pass; 24 drives and 144 plays are readable, the exact LP
  record is retained, and the validator reports 23 drive-index findings plus 10 shared-v1 violations. The game-wide ID
  contract passes and no longer appears as a shared-v1 violation.
- Gridiron: `node --check` passes for both modules; JSON parsing and `git diff --check` pass. A localhost static smoke check
  returned HTTP 200 for the viewer, module, manifest, and fixture.

## Open LP findings

1. Drives 2–24 embed E1 states with `drive_index: 1`; the viewer reports these mismatches without repairing them.
2. **Resolved:** LP emits one game-level `simulation_id` and globally contiguous play IDs. The adapter verifies this across
   every drive and preserves all IDs and outcomes unchanged.
3. The coin-toss ledger always names team A as toss winner; A/B do not map to actual home/away teams.
4. Extra-point and two-point rates use nflverse `success`, which means `EPA > 0`, not kick conversion. Dedicated outcomes
   must be ingested before those rates or derived scores are trusted.
5. The 300-game survey remains pending. `valid_full_game` is false while unsupported rules remain; the fixture is a completed
   regulation statistical record, not a fully legal game or forecast.

No tracking cohort, weeks 6–9 tracking holdout, main branch, or production system was changed. The viewer is a read-only event
and field-state timeline; it does not fabricate a 3D roster or motion replay.
