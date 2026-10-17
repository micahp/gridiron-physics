# SPEC: Gridiron Physics Pregame Simulation Viewer v1

Status: proposed; no new runtime implementation implied by this document. Owner: Gridiron Physics. Companion LP spec: [Legendary Picks NFL Pregame Play-Sequence Generator](https://github.com/micahp/legendarypicks/blob/dev/docs/SPEC-nfl-pregame-play-sequence-generator-v1.md). Shared protocol: [GRIDIRON-CONTRACT-v1.md](GRIDIRON-CONTRACT-v1.md).

## The product to ship

A fan opens Gridiron Physics **before an NFL game occurs**, chooses the **upcoming matchup**, clicks **Simulate Game**, and watches a complete *hypothetical* game play out in 3D: kickoffs, drives, plays, possession changes, scoring, and final result. They can pause, scrub, switch cameras, skip drives, inspect a play/player and rerun another seeded outcome.

This is an **entertainment simulation** backed by a data-trained LP play-sequence generator. It is not a historical ESPN replay, not merely a score prediction with highlights fabricated after the fact, and not a validated physics-causal forecast. LP samples the play outcomes in sequence; Gridiron's existing outcome-constrained physics renders those sampled outcomes.

**V1 is explicitly NOT:** picking a past game, changing a historical play, deciding live 3rd-and-3s, user play-calling, or proving an edge on Brier. The current Film Room and experimental Slant What If Lab can coexist, but neither is the launch feature.

## Verified baseline and why changes are needed

- `engine/play.js` already provides `simulatePlay(game, script)` with deterministic `rng(S.id)`. Reuse that player-motion/collision/ball engine; generated play IDs only need to be stable and unique.
- `engine/game.js` already has `simulateGame(game, {onProgress, only})` and a hash-mark-oriented `nextBallY`; **it iterates known scripts**, it does not decide down/distance, generate plays, manage game clock or sample results.
- `web/render.js` contains the Three.js 3D stadium, scoreboard lines, player bodies, cameras and timeline-compatible frame rendering.
- `web/app.js` currently loads a fixed `web/data/game.json` and precomputes recorded game plays, then presents a historical ESPN scorebug/drive UI.
- `pipeline/fetch.py`, `pipeline/ratings.py` and `pipeline/build_game.py` currently assume the Denver-Seattle source matchup in several places. They cannot be treated as a matchup-independent pregame pipeline without refactoring. `build_game.py` uses *actual observed results*, which a prospective game must not use.

The new simulation viewer should **load an LP-produced hypothetical game script** via the shared contract and adapt it to the existing renderer, not treat an ESPN event as the source of the simulated outcome.

## B0: Implement contract compatibility and adapter first

Create a separate adapter (proposed `web/simulation-adapter.js` or `pipeline/adapt_lp_simulation.py`) from an LP `pregame_full_game` script into existing `game` and `S` shapes.

Input: versioned LP JSON, ordered plays with `state_before`, `decision`, `outcome`, `state_after`, GSIS player refs, kickoff/as-of/source/model/seed metadata and complete game summary.

Adapter responsibilities:
- Validate the payload against `GRIDIRON-CONTRACT-v1.md`; reject unsupported schema versions, illegal score/clock progression, duplicate play IDs and unresolved required participants.
- Translate event families (pass_complete/incomplete/int/sack, run, scramble, punt, FG, XP, kickoff, turnover, admin) into `engine/play.js` `S.kind`, `qb`, `target`, `carrier`, `air`, `yac`, `gain`, `td`, `lineup`/`units` and other required play-specific fields.
- Convert LP offense-relative `yardline_100` to the renderer's absolute `los` using that play's end-zone direction: `dir=+1 -> los=100-yardline_100`; `dir=-1 -> los=yardline_100`. Do not confuse the two coordinate systems.
- Build `drives` and use LP before/after scores instead of an ESPN's already-known score. Remove dependence on historical `homeWp` and real-event winner statistics; any win probability displayed needs independent pregame-model provenance.
- Preserve LP's sampled outcome as the canonical hypothetical play result. Physics reconstructs movement and should report significant miss from target end spots, not modify LP's generated outcome.
- Non-physically supported rare events show a clearly labeled simplified animation/scorecard transition in v1, **never silently disappear or invalidate the downstream timeline**.

Every adapted play has a `provenance` label: outcome sampled from LP; formation, route, defense and lineup inferred/author-defined; physical movement from Gridiron.

## B1: Pregame roster and ratings snapshot

Generalize `pipeline/ratings.py` beyond `TEAMS=("DEN","SEA")`, hardcoded target `SEASON` and `GAME_WEEK`. The inputs are **teams, kickoff and as-of**, not a completed ESPN game's observed participants.

Gridiron owns 0–99 attributes and physics properties, plus a versioned ID crosswalk from LP's GSIS player IDs to its native ESPN IDs. Build only roster-eligible players for that scheduled game using an as-of roster, projected starters, depth chart and availability flags; do not use future game's box score or afterward known participation.

A fixed 11-on-11 formation template is acceptable for a v1 animation if transparently marked inferred. Fail/warn if a required QB/rusher/receiver cannot be resolved. Attribute imputation/confidence and source snapshot version must be recorded. Ratings should not be retuned to force the specific sampled play's outcome.

Also expose a versioned `ratings_snapshot` for an optional future reverse Gridiron->LP feature input. The first trained LP generator need not consume it.

## B2: Upcoming-matchup player UI

A separate pregame experience (proposed `pregame.html` and `web/pregame.js`) is preferred over silently replacing Film Room. The user sees:

1. Upcoming game selector: home vs away, kickoff time, roster snapshot availability, team colors/logos when approved.
2. **Simulate Game**: request a pregame full-game script from LP or load a previously generated, complete fixture.
3. A field/stadium presentation with real 3D player bodies and ball, full scoreboard, period/time, down/distance/line of scrimmage, current possession, drives and outcomes.
4. Scrubbable timeline: by drive/play, pause/resume, 0.25–4x speed and current play narration; support skipping ahead without having to watch the full duration.
5. Camera modes already implemented in `Renderer`: broadcast, All-22, sky, chalkboard and follow; players can be inspected with ratings/provenance.
6. **Simulate Again** with a new seed, producing a different full-game script and final score; show seed and model version for reproducibility.
7. Prominent, permanent **HYPOTHETICAL SIMULATION · NOT A REAL GAME RESULT** labeling. Do not impersonate an actual broadcast.

Start with a cached **complete** LP fixture to prove end-to-end physics playback. Swap the data source to an HTTP simulation endpoint after contract tests pass.

## B3: Full-game playback engineering

- Don't force 120 Hz physics for thousands of unviewed Monte Carlo trials. The statistical LP model produces the script; animate **one selected game**.
- Precompute/replay each play in bounded batches (the existing web loop does this already for one fixed game); consider lazy/drive-group preloading once matchups and scripts grow.
- Keep `simulatePlay()` and `nextBallY()` as reusable functions; don't modify core engine signatures unless a validated adapter test requires it.
- Ensure simultaneous game model state and physical replay are **separate timelines**: scrubbing visual frames never changes the fixed LP-generated official hypothetical result.
- Preserve browser performance and a clear progress bar; handle failed plays by showing the event summary with a labeled replay failure instead of silently dropping it.
- Drive/play navigation, score and player stat totals must use the LP-generated authoritative script; do not derive them from constrained visual end spots.
- New animation assets and sound are later improvements, not required to prove the model-to-viewer integration.

### Two physics modes, future-safe

Existing **reconstruction** profile: target-constrained motion and tackles, suitable for rendering scripted LP outcomes; don't sacrifice it to tighten locomotion before the product works.

Later **autonomous simulation** profile: speed-dependent turning, planted cuts, reaction lag and tackle contests without pre-chosen outcomes. That is a separate research task and must not be represented as available in v1. The first user-visible product is an entertainment experience that renders an independently generated statistical game.

## Acceptance criteria

**G1: Complete game visual playback.** Given one contract-valid LP full-game script, Gridiron can replay all supported events in order through a legal final score, with scorebug, possession, quarter, clock, down/distance and game stats matching the source script.

**G2: At least two matchups.** The same adapter/renderer works for two distinct upcoming games using different pregame roster snapshots, without hardcoded Denver–Seattle IDs or the original ESPN game.

**G3: Outcome integrity.** Scripted gains, touchdowns, sacks, interceptions and field spots stay intact after 3D translation; missing player IDs, unsupported event types and significant visual misses are explicit.

**G4: Reproducibility and variation.** Same script + physics version + seed reproduces the same physics frames; different LP simulation seeds produce visibly different hypothetical games. Physics randomness never alters LP's canonical outcome/stat line.

**G5: User experience.** Full-game controls, scorebug and camera modes work in a real browser. Clearly label probabilities/outcomes as modeled and align event narration with the actual currently viewed hypothetical play.

**G6: No regressions.** Original `index.html` Film Room and `test/validate.mjs` still work on their known replay. Keep existing `what-if.html` experiment separate if present on the working branch.

Entertainment release is gated on compelling, coherent, repeatable visualization and game completeness, **not** on exceeding the sportsbook's Brier score.

## Delivery order / coordination

- **Step 1:** Land this spec plus byte-identical shared contract on the working GridIron branch; link LP's companion.
- **Step 2 (LP dependency):** Obtain first complete pregame fixture with two-team roster IDs, play-by-play, final score and provenance.
- **Step 3:** Write adapter + fixture/identity/schema tests in Gridiron.
- **Step 4:** Build one-simulated-game viewer using existing Renderer and per-play physics.
- **Step 5:** Generalize physical ratings/roster loading for an upcoming fixture and prove two teams/matchups.
- **Step 6:** Connect upcoming fixture discovery and “Simulate Game / Simulate Again” to LP. Record exact model/seed and test browser playback/visuals.
- **Step 7:** Tune visuals and runtime *after* end-to-end scripted future-game playback works.

No historical-game switcher, user play-call override or What If From Here functionality is required. Those are separate later product ideas.
