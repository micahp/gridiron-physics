# Gridiron E0 adapter and viewer inventory — 2026-10-24

**Status:** Gridiron accepts the LP handoff policy below. The implementation update at the end records E0a completion; it does not claim that E0b 3D replay works.

**Owner:** Gridiron execution/viewer agent.

**Work branch:** `research/gridiron-e0-adapter-viewer-2026-10-24`, based on Gridiron `origin/main` at `43c386e97a813258b28b81a142ecd6eb1839ef88`. The branch is local and has no upstream configured.

## Pinned sources

| Source | Branch / commit | Pinned artifact |
| --- | --- | --- |
| End-to-end delivery plan | Gridiron `origin/main`, plan last changed at `1d26bb79ecc7d0a1a1f990510d8df84b446f7441` | `docs/END-TO-END-FOOTBALL-SIMULATOR-DELIVERY-PLAN-2026-10-24.md` |
| Shared play contract | Gridiron `origin/main`, `0c0990f041b60afb9b03456d287fd5c3dc5e2c34` | `docs/GRIDIRON-CONTRACT-v1.md`, SHA-256 `ae7b8a304dda480c3708b2543172f3fdc5064b156bf1b25816855acf31bc21b7` |
| Pregame viewer spec | Gridiron `origin/main`, `c74d56532ceff8dded0e19bbb860f55b2fb107dc` | `docs/SPEC-pregame-physics-game-viewer-v1.md` |
| LP E0 producer and fixture | Legendary Picks `feat/nfl-sequence-e0-2026-10-24`, `853f46f4c78c0edab8138ee4c713b35ac96b7336` | `docs/SEQUENCE-E0-LP-INVENTORY-2026-10-24.md`, SHA-256 `098c2497c934a5e5fe1376073ffd3a4274df5931fa9933ff04034a6062eb73f9`; `docs/fixtures/nfl-seq-e0-play-record-seed1042.json`, SHA-256 `5c6b803b673f8182232f12b0b50498a67646e6b6081d59a4f16f8a3d33fc5d11` |
| LP canonical movement cohort | Legendary Picks `research/nfl-snap-anchored-benchmark-2026-10-24`, `23dfa70b563fd418ac216ab806a73f982362d0b1` | Canonical manifest SHA-256 `45325d55103da9a7eca5139f3fda9506cb38d8f0af76d7753868c8f40fbd548a`; reconciliation SHA-256 `6a42b93839412f14cd2e8e2a2f8e3b3058a5db8c135074e73e8c739b3261cd2e` |
| Staged BDB play metadata used only to classify the supplement | `/root/nfl-tracking-data/bdb2025/code-data/plays.csv` | SHA-256 `a103cbc3a1ddf7678cb6d77ea5f9919c4292b5d55c7876f7cad6cce3d62dca04` |
| Prior Gridiron event/snap movement results | `research/m4d-str-contact-diagnosis` at `1bfd7584f5a1908823ca13fcee9c45926261ca13`; `research/m4d-snap-anchored-movement-2026-10-24` at `200ee6a6430d4f66700ad22a5a7d167733ece2f7` | Movement is supporting evidence, not an E0 dependency. The 9,388-play result includes 99 blank-formation plays beyond LP's 9,289 canonical plays. Those 99 are 92 plays flagged `qbKneel` and 7 plays whose descriptions say the QB spiked the ball; none are kicks or special-teams plays. Keep them labeled as a blank-formation supplement and out of canonical movement aggregates. |

## Existing Gridiron implementation on the pinned base

| Component | Reusable behavior | Boundary for E0 |
| --- | --- | --- |
| `engine/play.js:simulatePlay(game, script, ctx)` | Runs one internal Gridiron play script and returns replay frames, roster, events, end spot, and per-player physical summaries. Randomness is keyed by the script ID. | Expects Gridiron's internal `game.players` and `S` fields (`off`, `def`, `kind`, `dir`, `los`, lineup and event-specific inputs). It is not an LP v1 record reader and does not own the LP outcome. |
| `engine/game.js:simulateGame` / `nextBallY` | Runs an ordered array of internal scripts and carries the lateral ball spot between plays. | Does not sample outcomes, reduce downs, run a game clock, or validate an LP sequence. |
| `web/render.js:Renderer` | Creates the Three.js field, bodies, ball, cameras and interpolated frame playback. `setRoster`, `setLines` and `draw` provide reusable rendering operations. | Initialization expects Gridiron's `game` shape, including teams, home/away and player records. It cannot create real participant identities from nulls. |
| `web/app.js` and root `index.html` | Load the fixed `web/data/game.json`, simulate its historical scripts, then show a scorebug, play text, drives and timeline. | This is historical reconstruction backed by observed game results. It must remain separate from the hypothetical LP mode. |
| `pipeline/build_game.py` | Builds that fixed historical script from ESPN and nflverse inputs. | Uses actual play outcomes and participants; it is not a prospective LP adapter. |
| `test/validate.mjs` | Checks the fixed historical replay's end spots and physical plausibility. | It does not validate the LP payload, immutability, IDs or null policy. No LP adapter test exists on the pinned base. |

The pinned Gridiron base contains no `web/simulation-adapter.js` or equivalent LP play-result adapter. The viewer spec is proposed and describes the required adapter and product work; it is not evidence that either is implemented.

## Agreed E0 input and missing-field behavior

1. Consume the LP JSON as an immutable record. Any Gridiron `game`/`S` projection is a separate derived object; retain the original LP record and never rewrite `outcome`, `state_before`, `state_after`, provenance or IDs.
2. `null` means not modelled or not published. Display it as **not modelled**. Do not fill it with zero, a guessed value, another game's player, or an inferred state transition. LP's `state_after` and sampled outcome remain authoritative; a physical replay miss is reported separately and never changes them.
3. Accept `mode: single_play_statistical_demo` only as a single-play demonstration. Show `valid_full_game: false` and the retrospective temporal-eligibility label. Never call this fixture a pregame simulation, forecast, complete drive or complete game.
4. The pinned seed-1042 fixture has one `run` play, but `rusher_id`, `passer_id`, `receiver_id`, lineup provenance, post-play clock and clock runoff are null. It also has no participant roster or versioned field-end assignment. Therefore the current fixture can be ingested and shown as a state/outcome card with its missing fields explicit; it cannot be passed to `simulatePlay` as a specific 22-player replay without inventing inputs. The adapter must report replay unavailable for those missing requirements.
5. The E0 pool is retrospective: 1,016 of 5,572 outcome-cell rows are dated after the historical start game. Preserve that status in the UI. This seed fixture is not eligible to demonstrate an as-of pregame simulation.
6. Reject unsupported schema versions and event types explicitly. Do not coerce an unknown event to `run`; do not silently skip a play.

## Agreed field-direction and `los` conversion

Gridiron's absolute field x coordinate runs from 0 to 100 yards. `dir = +1` means the offense attacks toward x=100; `dir = -1` means it attacks toward x=0. Given the LP offense-relative `yardline_100`:

```text
dir = +1  =>  los = 100 - yardline_100
dir = -1  =>  los = yardline_100
```

Determine `dir` from an explicit, versioned field-end assignment for the simulated period. Do not infer a starting end from home/away or silently assume a direction. Preserve `yardline_100` unchanged in the input record. The current single-play fixture does not supply that assignment, so it has no supported absolute `los` for physical replay; the adapter must leave `los` unavailable rather than choose one.

## Smallest implementation after this agreement

The E0a work below implements the read-only record validation and viewer. Direction conversion tests and rendering remain E0b work because the pinned fixture has no versioned field-end assignment or player roster.

## E0a implementation and interface confirmation

**Gridiron status:** E0a implemented on `research/gridiron-e0-adapter-viewer-2026-10-24`. This commit confirms the LP interface and missing-field policy above.

- `web/lp-play-record-adapter.js` validates the supplied v1 single-play record, rejects unsupported modes/schema/events and malformed IDs, and returns a detached, deeply frozen display copy. The LP source record remains byte-for-byte unchanged.
- `e0-record.html` and `web/e0-record-viewer.js` provide a separate page. The historical Film Room remains untouched. The page shows the retrospective label, state, decision, sampled outcome, temporal-pool provenance, declared gaps and every null path in the play. `null` appears as **Not modelled**; absent fields appear as **Not provided**.
- `docs/fixtures/nfl-seq-e0-play-record-seed1042.json` is a byte-identical local copy of LP's pinned fixture (SHA-256 `5c6b803b673f8182232f12b0b50498a67646e6b6081d59a4f16f8a3d33fc5d11`). The adapter does not call `simulatePlay`, infer participants, fill nulls, alter the sampled result, or claim a full game.
- Run the page with `npm run serve` and open `/e0-record.html`. The focused adapter check is `node test/lp-play-record-adapter.mjs`.
- `replay.status` is `not_attempted`. E0b still needs real participant/roster inputs and explicit, versioned field-end assignment. The agreed conversion remains `dir=+1 => los=100-yardline_100`; `dir=-1 => los=yardline_100`. Do not derive `dir` from home/away or choose an end when the assignment is absent.
- E1 remains LP-owned and may begin after the E0a check passes and both agents confirm this interface. E0b can proceed in parallel when its inputs are available.

## Cohort boundary for movement evidence

The LP cohort is canonical for movement scoring: 9,289 plays under the LP preregistered eligibility rules. The earlier Gridiron 9,388-play superset is not a second benchmark. Its 99 additional blank-formation plays are retained only as a labeled supplement; staged metadata identifies 92 QB kneels and the other 7 descriptions explicitly say the QB spiked the ball. They are not kick/special-teams plays, so no such label will be applied. No weeks 6–9 data are used here.

This E0 inventory does not rerun or alter any movement model. It records the reconciled cohort boundary so later Gridiron reporting uses the LP canonical set and does not overstate the superset.
