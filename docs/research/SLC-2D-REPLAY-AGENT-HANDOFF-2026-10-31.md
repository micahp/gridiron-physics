# Agent handoff: SLC to Gridiron 2D replay (2026-10-31)

## Objective

Build a usable, low-fidelity **2D viewer for a selected real Legendary Picks SLC simulated NFL run**. Users should choose a game/run/seed and watch the saved sequence of score, quarter, clock, possession, spot, down, distance, drives, and play outcomes. Support stepping, scrubbing and autoplay. Later support per-player dots only when the underlying physics telemetry contains real simulated positions.

This is infrastructure and a working web viewer, not a mockup. Do not copy Kalshi, Polymarket or ESPN artwork. Do not invent football actions, players, paths, routes, touchdowns, probabilities or scores. Do not change SLC predictive models or Gridiron 3D physics to accomplish this task.

## Existing Gridiron implementation (start here)

- Viewer page: sequence-2d.html
- Browser logic: web/sequence-2d.js
- Pure source-preserving adapter: web/sequence-2d-model.js
- Responsive CSS: web/sequence-2d.css
- Unit test: test/sequence-2d.mjs
- Real historical research fixture: docs/fixtures/e2/lp-e2-game-seed1-1ca75609.json
- Prior adapters: web/lp-game-record-adapter.js, web/lp-drive-record-adapter.js, web/field-end-assignment.js
- Existing physics: engine/play.js, engine/game.js, web/render.js

Serve the root with npm run serve, then open http://localhost:8080/sequence-2d.html. Upload a selected single-seed JSON file from Legendary Picks. Default fixture is E2 retrospective research, **not** a prospective game. This page renders source-driven scoreboard/field-state and a geometric yardage transition, never fabricated player motion.

These are committed starter files, not an accepted end-to-end production integration. Run tests and browser QA before claiming acceptance.

## Legendary Picks input: read these before modifying anything

Repository: micahp/legendarypicks. Research branch: research/slc-player-workload-calibration-2026-10-30. Inspected head: 641a726861586b22497832ef8f5d87b039cf88b5.

Read:
1. scripts/nfl_sequence/run_slc_game.py
2. scripts/nfl_sequence/simulate_pregame_batch.py
3. scripts/nfl_sequence/game_state.py, especially _drive_body() and record()
4. scripts/nfl_sequence/slc_outputs.py
5. scripts/nfl_sequence/run_week8_smoke.py
6. docs/research/slc-week8-2026/runs/run-index.json
7. docs/research/SLC-CONTEXT-2026-10-31.md
8. docs/research/ari-dal-player-tail-audit-2026-10-31-c459226c/REVIEW.md

CRITICAL: SLC 10K batch outputs retain per-seed final outcomes and box scores, but discard the complete ordered game record after aggregating. The existing one-seed run_slc_game.py script writes a JSON payload with a full game under the 'result' key and decisions under 'event_trace'. The Gridiron adapter already accepts that envelope, the E2 'record' envelope, or a raw game record with drives.

**Never claim to reproduce an original batch seed exactly from its aggregate box score.** A rerun with a different source revision, snapshot, database, model profile, stream, or configuration is a new run. Source identity, model input and result hashes must match to warrant the word 'replay'.

## Phase P0: source audit

Use separate clean research worktrees. Read source files, inspect a real single-seed SLC output, build a field-by-field coverage table of source state (before/after), team identity, score, clock, possession, play IDs, outcomes, drive boundaries, kickoff, try, OT, blockers and participants. Do not assume the older E2 fixture and new SLC records are identical.

Output a real sample record and coverage report. No generated fictional fixture or observed ESPN play may stand in for a prospective simulated run.

## Phase P1: export and catalog a selected seed

Create a separate Legendary Picks research branch, based on the frozen workload work, without touching dev or immutable 10K files. Start by using run_slc_game.py with a frozen snapshot, exact model inputs, configuration and seed to emit a one-seed trace. If a new batch export flag is required, keep it opt-in and avoid the cost of serializing full game traces for all 10K seeds.

Proposed new artifact layout:

    research-replays/<game_id>/<run_id>/manifest.json
    research-replays/<game_id>/<run_id>/selected/<seed>/record.json
    research-replays/<game_id>/<run_id>/selected/<seed>/provenance.json
    research-replays/<game_id>/<run_id>/selected/<seed>/motion.json (optional)

Manifest must pin game_id, seed, run_id, original batch run_id (if any), source commit, exact snapshot SHA, SQLite input SHA, model/config/rules hashes, RNG stream provenance, file SHA and status. Compare score, final status and team/player stats against the original seed outcome when available. If nonidentical, report an explicit mismatch. Preserve blocked, partial and tied results.

Do not expose the research server database or private artifact tree to public browser routes. Publish only explicitly selected read-only JSON.

## Phase P2: connect run selection to the 2D viewer

Add a manifest reader and game/run/seed picker. Load only the selected full game. Do not load 10,000 whole game records at once. Keep all original record fields unmodified and give users access to raw selected play JSON.

Group events by quarter and drive. Include administrative kickoffs and tries with exact source states rather than creating fake ordinary plays. Correctly handle change of ends, halftime, safety, missed/blocked kicks, possession transitions, tied overtime, unsupported rules and incomplete runs. On contradictions or missing data, show unavailable/unsupported and fail closed.

The current display field is **offense-relative**, with start coordinate x = 100 - yardline_100. Its line to gain comes from sourced yards_to_go. A dotted transition shows the before/after yardage difference ONLY when both states have the same offense and quarter. It is not a physical run path.

Do not display win probability, expected points, 'Live', player names/logos or play duration without authoritative corresponding data. Existing display speed controls only change viewer pacing, not model clock physics.

## Phase P3: optional real movement (not required for initial acceptance)

Add optional telemetry from the genuine Gridiron engine for a chosen sampled play. Keep it separate from the LP record. Proposed metadata: source_play_id, physics_version, source type (physics_generated vs tracking_observed), coordinate frame, time step, player ID and team/position mapping, frame coordinates, file SHA. If absent, remain in schematic source-state mode. Never transform a single ball start/end spot into invented 22-player trajectories. Do not touch Blender, rigged GLBs or 3D clips in this 2D task.

## Phase P4: TDD and closure

Mandatory tests and deliverables:

1. Node: node --test test/sequence-2d.mjs. Run npm test and npm run test:week7. No regressions in existing Film Room or autonomous code.
2. Add at least two **real SLC exported runs from different Week 8 matchups**, plus one blocked/incomplete run, as separate pinned, provenance-labeled tests. Never commit large private DBs.
3. Source object/bytes unchanged after load, seek and playback. Displayed scores, clock, location, outcomes and IDs must equal the original source on every supported event. Missing remains missing.
4. Reject aggregate 10K batch reports, duplicate IDs, nonmonotonic sequences, invalid coordinate types and unsupported contract versions. Do not silently relabel unknown events as runs.
5. Assert drive ordering, possession and field orientation, kickoff/try behavior, overtime, blocked states, and exact seeded run identity. Compare scores against independent LP output.
6. Browser QA (desktop and mobile): load fixture, upload selected SLC JSON, select first/middle/last plays, scrub, autoplay, step back, restart, view source, inspect failure conditions. Capture actual running UI screenshots as QA only.
7. Include exact repository/branch SHAs, sample run IDs/seeds, hashes, test commands and results, coverage/missingness report and a clearly stated outstanding-gaps list.
8. DO NOT modify the shared byte-identical GRIDIRON-CONTRACT-v1.md. DO NOT merge branches, push to LP dev, change production, alter models, rewrite frozen runs or declare a batch outcome 'valid full game' unless its source does.

## Decision rule

The goal is an inspectable, faithful picture of **what the simulation actually generated**. When the source lacks an element, display the limitation instead of embellishing it. Solve source coverage before adding higher visual fidelity.
