# Gridiron NHL statistical event viewer v0.1

**Status:** Research-only read-only viewer.

**Branch base:** Gridiron `main` at `c57638471cd35d4f258572fcee538978a466a7e3`.

**LP producer:** `research/nhl-statistical-full-game-2026-10-25` at `5ac101ff42a4fbdc737f011f5cec3b1b52ee6a83`.

## Purpose

Display the LP-owned NHL statistical play-by-play record in Gridiron Physics. The viewer is a separate NHL page and schema; it does not modify the NFL E0/E1/E2 viewer, shared `GRIDIRON-CONTRACT-v1`, game engine, movement controller, or production code.

Open `nhl-statistical-game-viewer.html` from a static HTTP origin. The page loads only the pinned fixtures in `docs/fixtures/nhl-statistical/`; it makes no network requests to data providers and has no SBR/odds input. Its first fixture uses synthetic `HOME`/`AWAY` labels because LP v0.1 is team-independent. The second fixture exists only to display the regulation-tie, overtime, and shootout path.

## Display and validation

- The fixed banner labels every record **HYPOTHETICAL STATISTICAL SIMULATION**.
- The scorebug, SOG, periods, event list, event cursor, clock, score transitions, seed, model version, and source hashes come directly from the immutable LP record.
- Previous/next, event playback, the event scrubber, and period filtering move a read-only cursor through the stored events. Event playback is not real-time game clock.
- A pinned manifest SHA and per-fixture SHA-256 are checked before parse/display. The viewer also fails closed on incompatible repo/producer/model/schema pins, malformed event sequences, invalid clocks, arithmetic score/SOG inconsistencies, invalid overtime/shootout transitions, or identity/coordinate fields in emitted events.
- Event details are inserted as text. The LP record is never rewritten or uploaded.

The page shows statistical events, not reconstructed NHL plays. v0.1 contains no player identities, lineups, goalie decisions, rink coordinates, paths, or physical puck/player interactions. No Three.js animation is claimed here. The existing hockey movement replay is a separate ordinal tracking experiment, not a source of outcomes for this record.

## Frozen fixtures

Manifest: `docs/fixtures/nhl-statistical/MANIFEST.json`, SHA-256 `c9565dccdf5272eecb64fd2f2fe5cbe7bfdc31603afbd4e8887ad7b1b5979250`.

| Fixture | Purpose | LP SHA-256 |
|---|---|---|
| `nhl-statistical-game-v0.1-seed-31415.json` | 285-event regulation example; final 5–2 | `e8daf15ad69a2276bf3cb06d682d841aa88dd49cda076791fdd5589621d00fbb` |
| `nhl-statistical-game-v0.1-shootout-path-seed-8.json` | 356-event branch example; regulation/OT 2–2, official final 3–2 | `57db4fbc26caa4493a26b82b56965a9f9fc2dc100598b6e4703181308f490e18` |

The shootout seed was selected to exercise that code path. It is not a representative or independently sampled evaluation result. Fixture bodies are copied byte-for-byte from the committed LP producer branch; the manifest records their hashes and the exact producer commit.

## Next boundary

This viewer closes the LP-record-to-Gridiron-display seam only. It does not make v0.1 team-specific or improve its statistical calibration. A later LP model phase should condition generated events on eligible team, goalie, personnel, score-state, and penalty information, with forward-only features. A separate Gridiron phase may consume such records only after LP's schema and immutable outcome contract are pinned. Physical movement remains a distinct research output and must not be inferred from event-only records.
