# NHL statistical full-game work: context handoff

**As of:** 2026-10-25

**Owner:** research implementation across Legendary Picks (LP) and Gridiron Physics.

**Current Gridiron branch:** `research/nhl-statistical-game-viewer-2026-10-25`, commit `a6bb91d9db9f5ec3993713164fb24392d98f8c8c` (pushed; not merged).

## Current objective and boundaries

The NHL full-game work is one track in the larger goal of building three distinct systems:

1. Historical NHL play-by-play replay.
2. Statistical full-game event generation, then read-only display of its generated record.
3. A future movement/physical simulation with sport-specific roles, policies, and validated player attributes.

The completed work below covers the first statistical event generator and its Gridiron event viewer. It does not deliver historical game replay or a player/puck physics simulation. The generated record is hypothetical and event-only; the viewer must not imply that player movement or physics produced its outcomes.

The user's Chiefs–Seahawks primetime example belongs to the separate NFL project. Do not use those teams or that fixture in the NHL viewer. The NHL model's `HOME` and `AWAY` labels are synthetic display labels; v0.1 gives every requested matchup the same underlying distribution.

## Legendary Picks: model and evidence

- LP research branch: [`research/nhl-statistical-full-game-2026-10-25`](https://github.com/micahp/legendarypicks/tree/research/nhl-statistical-full-game-2026-10-25), producer commit `5ac101ff42a4fbdc737f011f5cec3b1b52ee6a83`.
- Implementation: `research/nhl/statistical-full-game-v0.1/nhl_statistical_game.py`.
- Model: `empirical-period-bootstrap-v0.1`. It samples complete historical period templates, remaps event ownership to synthetic sides, strips player identities/coordinates, and derives scores from generated goal events. It has regulation, overtime, and shootout scoreboard handling.
- Training population: eligible 2019–2020 games (1,064 and 857); 2021 development: 1,292 eligible games. The exposed/partial 2022 slice is excluded.
- The historical data sources are local archived NHL GameCenter PBP and boxscores, not SBR. The pinned PBP and separate boxscore manifests cover 4,876 games. Across 4,533 games from start seasons 2018–2021, game/team identities and scoreboard score/SOG fields agreed; event-derived SOG disagreed with boxscore SOG in 60 games (2018: 12, 2019: 17, 2020: 11, 2021: 20), which were quarantined. Start season 2018 was also excluded for severe event-clock chronology failures.
- 2021 development metrics: regulation/OT goal CRPS `0.9922` (95% game-bootstrap interval `0.9644–1.0196`); final-score CRPS `0.9926` (`0.9673–1.0211`); final-score energy `1.5807` (`1.5418–1.6226`); winner Brier `0.2487` (`0.2466–0.2511`); SOG CRPS `3.9111` (`3.7946–4.0302`). The simulated count variances are lower than observed. No baseline comparison was run, so v0.1 remains a research prototype and has no adoption claim.
- LP plan and full results are in `docs/research/NHL-FULL-GAME-SIMULATION-PLAN-2026-10-25.md` and `docs/research/NHL-STATISTICAL-FULL-GAME-MODEL-V0.1-REPORT-2026-10-25.md` on the LP research branch.
- LP `main` received a **report-only** publication at `9416413a3bb257ae2375d7d3b522765627bbb2eb`. The model implementation remains on the LP research branch; do not assume the LP `main` branch contains it.

## Gridiron Physics: viewer implementation

- Branch: [`research/nhl-statistical-game-viewer-2026-10-25`](https://github.com/micahp/gridiron-physics/tree/research/nhl-statistical-game-viewer-2026-10-25), current commit `a6bb91d9db9f5ec3993713164fb24392d98f8c8c`.
- Page: `nhl-statistical-game-viewer.html`; client module and stylesheet are `web/nhl-statistical-game-viewer.js` and `web/nhl-statistical-game-viewer.css`.
- Fixture contract and hashes: `docs/fixtures/nhl-statistical/MANIFEST.json`. It pins LP producer commit `5ac101ff…`, model/schema version, two example records, and byte hashes. Both fixture bodies were checked byte-for-byte against the LP branch.
- The first example is regulation-only, seed 31415, 285 events, final `HOME 5–AWAY 2`. Seed 8 is a branch-coverage example with regulation/OT tied 2–2 and shootout final 3–2; it is not a representative sample.
- The viewer verifies the manifest and fixture hashes before rendering, checks record sequence/clock/score/SOG/period arithmetic, and fails closed on identity/coordinate fields. It offers previous/next, event-order playback, period filtering, and event scrubbing. Content is rendered as text; the LP record is not changed.
- The persistent label says **HYPOTHETICAL STATISTICAL SIMULATION**. There is no Three.js hockey playback, roster, player/goalie behavior, spatial event data, or causal physical claim in this page.
- No SBR odds were fetched or used. The user's reported closing-moneyline benchmark (`0.23554` over `5,131` games) is an external evaluation reference only; it is not a model input and is not directly comparable to the 2021 NHL model metric because the populations differ.

The older `research/hockey-movement-engine-v0.1-2026-10-23` branch contains a separate ordinal player-tracking viewer. It has no verified subsecond timebase or across-game identity basis and is not an event or outcome generator. Keep its visual evidence and policy outputs separate from the statistical event record.

## Repository state and verification

- The Gridiron viewer branch is pushed and tracks its remote branch; it has not been merged into `main`. The Gridiron `main` checkout's untracked `docs/research/STATISTICAL-FULL-GAME-IMPLEMENTATION-STATUS-2026-10-25.md` was left untouched.
- No NFL files, `GRIDIRON-CONTRACT-v1`, physics solvers, or production surfaces were changed by the NHL viewer work.
- Fixture byte identity and hashes were verified; `git diff --check` passed. No Gridiron automated or browser test suite was run, and the new page has not been visually accepted in a browser.
- The LP model generation examples, arithmetic accounting, fixed-seed byte reproducibility, source/body checks, and 2021 development evaluation were run on the LP research branch. See its report for exact commands and limitations.

## Next steps

1. Browser-review the static NHL page on an approved HTTP origin. Check both fixtures, period filtering, event cursor/playback, narrow layout, hash-rejection behavior, and final scoreboard. Keep this an event display, not a motion replay.
2. Improve LP generation with separately measured, pregame-eligible team scoring/prevention, goalie, score-state, and penalty effects. Use forward-only features and controlled changes; do not feed market odds into the engine.
3. Evaluate any predictive candidate on identical, eligible NHL games and use SBR only as an external benchmark on the same matchups/time window. Keep the exposed 2022 results historical diagnostics; obtain later unseen or prospective data for an adoption claim.
4. Connect events to movement/physics only after the model supplies a versioned handoff and player identities, timing, possession, and physical evidence support each claimed behavior. Preserve the boundary between statistical outcome and physical replay.
