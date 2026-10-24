# End-to-end football simulator delivery plan — 2026-10-24

**Status: ACTIVE HIGHEST-PRIORITY WORK ORDER for both Gridiron Physics and Legendary Picks NFL simulation agents.** Supersedes older *next-task priorities* in the football-first tracking directive, 2026-10-24 tracking review, M1–M4d reports and roadmap. All earlier measurements, license cautions, branch boundaries and no-production/no-merge safety rules still apply. This document is a delivery instruction, **not evidence that this end-to-end integration has already shipped**.

## 2026-10-24 field direction clarified — E1 authorized; E0b still pending

**Decision:** [E0 field-end convention review](research/E0-FIELD-END-CONVENTION-DECISION-2026-10-24.md). LP fixture `693e1767` and Gridiron demo/adapter `15b0b34` have matching JSON (Git blob SHA `f46b85c7146825949c071d2f75cf1cfcb78f6870`), and Gridiron has updated its tests. The E0 Q2 authored `dir=+1` / `los=12` is valid **only as a labeled authored display coordinate**. **Do not make `Q1–Q2=>+1; Q3–Q4=>-1` the NFL game rule.** NFL teams change ends after Q1 and Q3, and the second-half end choice is separate. For drives/games, directions must be provided by explicit versioned **team × period** assignments. Respect actual source provenance; Q1→Q2 and Q3→Q4 flip, halftime is separately specified, and a possession change switches attacking team. `los` remains `100-yardline_100` for `+1` or `yardline_100` for `-1`.

**Gate:** **E0a accepted** as a retrospective read-only record viewer. LP pinned the field convention; Gridiron implemented fixture acceptance with passing **agent-reported** focused tests and duplicate-ID coverage, as shown by remote commits. **LP E1 is now authorized to begin on an isolated research branch**, using this honest E0a transport while building the NFL-correct field-end reducer plus clock/score/possession/drive-end rules. Do not block E1 on player-specific E0b 3D playback. E0b remains pending eligible participant/roster and formation context. No merges/production changes.

## 2026-10-24 E0a implementation accepted — move to E1 after LP acknowledgement

**Current status:** [Gridiron research branch `research/gridiron-e0-adapter-viewer-2026-10-24` at `629705da81bfc7baa75b9eb55137c9b4239ba07f`](https://github.com/micahp/gridiron-physics/commit/629705da81bfc7baa75b9eb55137c9b4239ba07f) is pushed and its remote head verified. Its seven-file commit adds the [E0a record adapter](https://github.com/micahp/gridiron-physics/blob/629705da81bfc7baa75b9eb55137c9b4239ba07f/web/lp-play-record-adapter.js), [read-only viewer](https://github.com/micahp/gridiron-physics/blob/629705da81bfc7baa75b9eb55137c9b4239ba07f/e0-record.html), [focused tests](https://github.com/micahp/gridiron-physics/blob/629705da81bfc7baa75b9eb55137c9b4239ba07f/test/lp-play-record-adapter.mjs), LP fixture copy and updated inventory. The GitHub-fetched LP fixture at `853f46f4` and Gridiron fixture at `629705da` have **exactly equal content and the same Git blob SHA `c65a9b6699e2ca64b3e6312f9f5c64cc9e7a7a47`**.

**Coordinator acceptance:** **E0a accepted as implemented in its limited read-only/demo scope.** The code rejects unknown event types, modes, unsupported schema, malformed IDs and contradictory single-play/full-game flags; detaches/freeze-protects the record, preserves null states and outcomes, and labels the seed-1042 play **retrospective, not an as-of pregame game**. The tests assert original record immutability and null/outcome equality. Test success and fixture SHA comparison were reported by the implementing agent; the coordinator independently inspected source/test code and compared fetched fixture bytes, **but did not run the test suite or browser page in the agent's server environment**. The historical Film Room is not changed. This is not physical replay or a full-game validation.

**Important unfinished acceptance gates:** E0a's adapter does **not** yet implement or test a field-end assignment to `dir` or its `los` conversions; the formulas remain agreed: `dir=+1 → los=100-yardline_100` and `dir=-1 → los=yardline_100`. Keep direction unavailable without a versioned assignment and implement/test this with E0b inputs, including independent plus/minus fixtures. E0b still needs real, temporally eligible participants/roster and a justified formation/field direction before identity-specific 3D replay. E0a is a record viewer, not proof of the originally described 3D E0 outcome.

**Next immediate dependency:** LP sequence agent must **explicitly acknowledge** that `single_play_statistical_demo` is the research/demo envelope, null is never imputed, event types fail loudly, outcome and state remain authoritative, directional field assignment must be versioned, and `valid_full_game=false` is preserved. After that signoff **E1 LP drive-state development may begin**, using the current accepted E0a interface for early debug/display, **in parallel** with Gridiron's separately gated E0b 3D-replay prerequisites. Do not require E0b completion to begin E1, but do not call the overall game replay gate complete. No merges, deployments or production DB writes.

## 2026-10-24 Gridiron E0 agreement received — implement transport without fabricated replay

**Verified on GitHub:** [Gridiron E0 inventory and interface acceptance, `83749b33`](https://github.com/micahp/gridiron-physics/blob/83749b33b9a3193fb87ac7a73583ad665621376a/docs/research/GRIDIRON-E0-ADAPTER-VIEWER-INVENTORY-2026-10-24.md) and [Gridiron M4d cohort correction, `433f944`](https://github.com/micahp/gridiron-physics/commit/433f944bc22f89bc568a489324a9df1baddf3b70). At review time **both named remote branches resolved exactly to these commits** despite the agent reporting them as unpushed; no merge or production release is implied. The E0 commit contains an **inventory/agreement only**, not runnable adapter code or completed replay.

**Agreed rules:** LP input remains immutable, unknown states/clock/participants/score stay `null`, unknown event/schema fails, `single_play_statistical_demo` stays visibly retrospective and `valid_full_game=false`. Gridiron absolute `los` uses `dir=+1 → 100-yardline_100`; `dir=-1 → yardline_100`, only when **the period's versioned field-end assignment supplies `dir`**. Otherwise absolute `los` is unavailable. No implicit home/away field direction or borrowed/hypothetical roster.

**Clarification to unblock actual delivery:**
- **E0a, transport and truth-preserving viewer (implement now):** Build a pure validator/adapter plus a distinct research-demo page that displays the LP record, transition, outcome, provenance, unknown fields and explicit *3D replay unavailable* reason. Test source byte/deep equality, event/schema rejection, IDs, nulls and each signed direction formula with **separate synthetic field-direction fixtures**. For seed 1042, there is no direction/participant roster, so **do not** run `simulatePlay` as if it were an identity-specific 22-player play.
- **E0b, actual player-specific replay (remains open):** Requires a separately pinned eligible roster/participant snapshot and versioned field-end mapping, plus suitable play/formation action context. Preserve LP event/spot/score as the authority; distinguish outcome-constrained playback from physical causation. E0a alone is **not** the original complete E0 3D replay gate.
- **E1 coordination:** Once LP explicitly acknowledges the agreed demo schema/null/direction behavior and **E0a adapter passes**, LP may begin its own legal drive/reducer work **in parallel** with the remaining E0b player-replay prerequisites. Do not claim final E0 or full-game completion until E0b or an explicitly re-scoped gate is demonstrated. If E0a implementation has not passed, the handshake remains unverified and E1 is still waiting. This sequencing avoids a deadlock in which missing roster data prevent all drive work.

**Movement correction:** The canonical cohort remains LP's **9,289 plays**. Gridiron's additional 99 blank-formation rows were identified as **92 QB kneels and 7 QB spikes**, a separate *kneel/spike administrative-play stratum*, **not** kicks or special teams. No combined 9,388-play headline can replace the canonical 9,289. Keep those 99 out of movement aggregates, but preserve them as useful evidence for LP's E1/E2 football-state modeling (clock, kneels, spikes); no evaluation has been run on them for that purpose. The 68 rows outside Gridiron's earlier manifest remain LP-inferred exclusion reasons, not Gridiron-verified reasons.

**Immediate agents' work:** Gridiron adapter agent implements/tests E0a on the isolated branch, publishes exact test commands, example screenshot/state card and commit. LP sequence agent confirms the schema explicitly, handles true as-of filtering before any forecasting claim, and prepares the E1 state/event requirements for clock, score, possession, participants, kicks and terminal actions. No changes to production or mirrored v1 contract, and no automatic research branch merges.

## 2026-10-24 E0 coordination status — LP partial fixture pushed, Gridiron adapter pending

**Verified remote commits:** LP E0 `feat/nfl-sequence-e0-2026-10-24` at [`853f46f4`](https://github.com/micahp/legendarypicks/blob/853f46f4c78c0edab8138ee4c713b35ac96b7336/docs/SEQUENCE-E0-LP-INVENTORY-2026-10-24.md) and LP movement-cohort reconciliation `research/nfl-snap-anchored-benchmark-2026-10-24` at [`23dfa70b`](https://github.com/micahp/legendarypicks/blob/23dfa70b563fd418ac216ab806a73f982362d0b1/docs/research/BDB2025-SNAP-COHORT-RECONCILIATION-2026-10-24.md). Both remote branch heads matched the hashes on coordinator inspection. Gridiron agent `hermes2` was user-reported working on adapter; no accepted reply, adapter artifact, or E0 integration pass has been verified here. **E1 remains blocked pending explicit LP/Gridiron interface agreement and an executable E0 handoff test.**

**LP E0 proof:** `scripts/nfl_sequence/e0_single_play.py` generated [seed-1042 JSON](https://github.com/micahp/legendarypicks/blob/853f46f4c78c0edab8138ee4c713b35ac96b7336/docs/fixtures/nfl-seq-e0-play-record-seed1042.json), a single **run for zero yards** from the `2025_05_LV_IND` historical pre-play down/field context. Two same-seed reproductions reportedly byte-matched and the pool digest was pinned; reducer transition checks reportedly admitted **125,309/125,309** reference rows, testing **only modeled state legality**, not NFL realism. Code/reproduction are in the pushed LP branch, but coordinator did not run the user's server. The replay outcome must stay unchanged.

**Temporal honesty:** The fixture's outcome was sampled from a past 2022 game, but its **entire 5,572-play comparison cell included 1,016 games/plays dated after the 2025-10-05 start**, or **18.2%**. Pool was not cutoff-filtered. Thus `outcome_pool.temporal_eligibility.status=retrospective`, `as_of_utc=null`, `sources_as_of_verified=false`, and `valid_full_game=false` are required disclosures. **The entire eligible pool must be filtered chronologically** before any claim of a prospective as-of simulation; one sampled draw being older does not fix a future-contaminated pool.

**E0 adapter handshake before E1:**
1. The shared [GRIDIRON-CONTRACT v1](../docs/GRIDIRON-CONTRACT-v1.md) remains an immutable **proposed full-game contract** with `mode=pregame_full_game`. The current `schema_version=1.0`, `mode=single_play_statistical_demo` record is a **research-only partial fixture**, **not a valid v1 full-game payload**. Support it through an explicitly labeled demo/compatibility adapter without modifying the byte-identical v1 docs in only one repo or claiming conformance. Pin field vocabulary/version, error policy, hashes and example input/output in both agent branches.
2. Show retrospective/partial status and unknown clock-after, score, timeouts, participant/roster and player stats as **not modeled**. A schematic/title-card visualization or clearly generic demonstration is acceptable to test transport; **do not invent specific player trajectories, participants, snap geometry, running clock or scoreboard**. If a true identity-specific 3D play is required for the gate, mark that **not yet achieved** rather than fabricating it.
3. Pin **offense-relative `yardline_100` → absolute `los`** mapping and direction/period field orientation before placing the ball. Contract direction formula: for `dir=+1`, `los=100-yardline_100`; `dir=-1`, `los=yardline_100`. A 1st-to-2nd-down, zero-yard record does not authorize changing state, score, clock or event outcome during rendering.
4. Unknown `event_type` fails loudly; null values must never silently become zeros or plausible names; end-of-drive title cards are not fabricated kickoffs; statistics and provenance remain those of the original LP JSON. Create a deterministic fixture-adapter smoke test with field/state equality before/after.
5. Both agents explicitly sign off on a *versioned research demo envelope*, missing-field and direction rules, and the E0 acceptance evidence. Keep full v1 game readiness distinct. Only then open E1 clock/period, participant, provenance and event-family work, preferably reusing the same agreed interface.

**Movement-data reconciliation is complete and non-blocking:** [LP play-ID join](https://github.com/micahp/legendarypicks/blob/23dfa70b563fd418ac216ab806a73f982362d0b1/docs/research/BDB2025-SNAP-COHORT-RECONCILIATION-2026-10-24.md) reports 9,456 LP total rows, 9,289 eligible; all 9,289 appear among 9,388 Gridiron included plays. The 99 extra are **blank formation**, not verified special teams; report separately as *unknown-formation stratum*. The 68 LP records absent from Gridiron were excluded by LP rules: 27 insufficient history, 24 blank formation, 17 snap-definition disagreement. Preserve the LP authors' caveat that the Gridiron file does not record exclusion reasons; those reasons were inferred from LP, not independently confirmed by Gridiron.

## 2026-10-24 supporting movement decision (no change to delivery critical path)

The [movement policy materiality review](research/MOVEMENT-POLICY-MATERIALITY-DECISION-2026-10-24.md) accepts agents' reported development result that basic same-history constant acceleration supplies about **97%** of the movement lift over constant velocity at 1.0 s; adding the existing locomotion controller yields only **3.72 mm** more. The original threshold-free prereg statistical test passed, but the **coordinator declines added policy complexity** at that effect size. A prospective rule for any later held-out movement-policy promotion now requires ≥5 cm AND ≥5% 1-second MAE improvement plus game-clustered statistical evidence and no material spatial/runtime regression; record explicitly that this criterion was set **after** seeing development. LP and Gridiron must reconcile 9,456/9,388/9,289 competing reported cohort denominators and commit source artifacts before future movement tests. The reported research files were uncommitted when this note was made. **Do not spend reserved weeks 6–9 now; prioritize E0 generated play → E1 drive → E2 full simulated game.**

## Why the work exists

**Product goal:** Generate an entire, coherent NFL game from a pregame-eligible matchup state and football decisions. Repeated simulations produce internally consistent plays, downs, drives, clock, scores, possession changes and player statistics. Gridiron Physics makes the simulated football inspectable/playable; Legendary Picks uses the resulting distributions, where validated, to explain and improve game/team/player projections and ultimately player props.

The hypothesis worth testing is that *shared player/football causes* make game/play/statistics more coherent or predictive than separately sampled outcomes. That hypothesis is **not automatically true**. A strong statistical-only game model may outperform physical play generation; the answer can be hybrid. We will evaluate honestly.

**Do not confuse these outputs:**
- **A. Statistical-scripted hypothetical game:** LP samples legal hypothetical play events and outcomes; Gridiron renders the unchanged play script. It can already establish a complete end-to-end product pipeline and UI, but rendering is **not proof the play's outcome was physically caused**.
- **B. Prospective physics/hybrid game (research mode):** LP provides state, eligible action/participants/constraints, and the physical/behavioral executor determines a subset of outcomes without LP feeding the realized result. Unsupported interactions use explicit statistical fallbacks. LP's reducer remains the sole authority for football rules and state.
- **C. Observed-game reconstruction:** tracking/PBP/filming may contain the true result and future frames for debugging or teaching; visibly label as reconstruction and **never grade as forecasting**.

These can coexist. **Ship research mode A vertical integration first, then test B on selected plays**. Do not force every game event through an unfinished 3D contact solver merely to claim causality.

## Current verified foundations (as of 2026-10-24)

- LP already has extensive NFL PBP and a **statistical play/drive/game sequence baseline** (v0.1/v0.2 research). Existing 2022–2023 drive tests reveal too many punts/clock ends and too few TDs, plus kneel/fourth-down/red-zone/state problems. Forecast lift and production promotion have **not** been established.
- Gridiron already has a Three.js viewer, historical reconstructed 3D plays, a prospective free run/pass *research* prototype and various collision/movement experiments. **M4c/M4d did not promote a production physics solver**.
- Current [GRIDIRON-CONTRACT v1](../docs/GRIDIRON-CONTRACT-v1.md) is a **proposed, mirrored, byte-identical** LP-to-Gridiron **statistical script/playback** contract. Keep v1 unchanged and compatible. A distinct v2/experimental interface is needed only when physics resolves results.
- The 2022-season 2025-Big-Data-Bowl mirror is staged/audited: 16,124 plays / 9 weeks, and 40 development tackles have an initial 0.5s event-conditioned 2D movement comparison (0.170 vs 0.141 m median pair-separation RMSE). That is **real observed motion evidence, not** a full-play execution, tackle-probability, or game prediction result. Keep the 49-play manifest frozen; weeks 6–9 are reserved for later *model comparisons* despite earlier aggregate profiling.
- Madden STR/TKL/BTK/force mappings remain uncalibrated. Legacy far-wrap spring speed violations and M4d possession-retention penetration failures remain open. Do not let those diagnostic projects indefinitely block a complete statistical/hybrid game.

## Immediate delivery: one **generated** game, end-to-end

**First step: inventory existing implementations, not new physics.** Each agent lists exact branches/commit SHAs, accessible program entry points, current tested state, reusable event/play schemas, v1 contract gaps and smallest integration changes. Coordinate a single selected matchup (e.g. an already supported Patriots–Bears research fixture if confirmed available; don't invent a 2026 schedule) and one frozen **pregame** source manifest. No past actual game's future may be used to generate its hypothetical outcome.

### Gate E0 — implementation map and minimal common adapter
- LP agent proves it can generate **one legal synthetic play-result record** (not a historical recorded outcome): game ID, simulation/sequence IDs, participating players, pre-state, decision, terminal event, gained/lost yards, elapsed time, relevant individual stats, ball/possession/clock effects and provenance.
- Gridiron agent locates a renderer/reconstruction adapter accepting that record without silently changing it. Preserve Three.js, current historical reconstruction and repeatable seeds.
- Agree **one pinned v1 payload** and error-handling/ID tests. If the code is already there, demonstrate it; do not rewrite v1 or make a second ad-hoc contract.
- End-user observable: one generated **hypothetical** play with score/clock/down state and consistent 3D replay, clearly labeled *statistical outcome / visual reconstruction*.

### Gate E1 — **one complete legal drive**
- LP chooses actions/outcomes conditioned on down, distance, field, personnel, game time and rules, applies every result through the *same authoritative reducer*; no manual forcing of first downs, touchdowns or tackles.
- Cover positive/negative plays and one legitimate ending (punt, touchdown, turnover, field-goal attempt or end of period); also test other terminal state types with targeted fixtures. Clock runoff and possession must be reconciled.
- Gridiron renders the **same immutable play stream** through the drive, with replayable state between snaps. No secretly rewritten spots or invented drive-end events.
- Checks: all state transitions legal; `sum(play player stats)` reconciles with drive totals where rules require; spot, yards, first downs, score, clock, possession and terminal event agree; same snapshot/seed reproduce byte-identical event records.

### Gate E2 — **one complete simulated game**
- Generate both teams' possessions with game start through legal regulation termination, versioned NFL rule-era context, kickoffs/field goals/extra points/punts/timeouts/penalties/turnovers via explicitly named mechanisms or labeled statistical fallbacks. Unimplemented overtime/rare events must be disclosed or guarded; never silently skip a required rules transition.
- Gridiron viewer should navigate game → drive → play with score, clock, field/ball state, roster identity, event text, 3D replay and honest source/mode label. Prioritize a finished, inspectable game over visual polish or new solver controls.
- Automatically reconcile final team points vs score events; team and player passing/rushing/receiving stats (including completions/targets/carries/YAC where produced); possession counts and all drive endings; down/distance continuity; play and game clocks. Record any unsupported stat or exceptional play explicitly rather than inventing it.
- Demonstrate deterministic **one-seed game** first, then many seeds without corrupting state/identities. Measure wall time and memory for 1 play, 1 drive, 1 game, and a batch.

### Gate E3 — **football-realism and predictive evaluation**
- Against independent NFL PBP, report both marginal **and joint/conditional** distributions: pass/run mix by game state, yards and first downs by down/distance, sacks/turnovers by eligible plays, plays/drive, possession duration, TD/FG/punt/turnover and clock/kneel endings, third/fourth downs, red-zone conversions, total points, score variance/tails, team/player stat coherence.
- Retain the existing LP sequence engine as **statistical-only benchmark** and build one clearly defined hybrid. Evaluate identical input eligibility, simulation budget and cost; don't invent 'real' tackling from missing labels.
- Reused 2022–2023 drive diagnostics and weeks 1–5 tackle motion are **development** evidence; use a genuinely untouched later period or prospective frozen inputs for model promotion. Report proper probabilistic skill only if forecast probabilities exist, compare with market/simple predictors where relevant, and report calibration/uncertainty.
- Gridiron physical contact is promoted to the game executor **one outcome family at a time** only if it improves observed play distributions/coherence/prediction or provides demonstrable unique visualization/gameplay value without unacceptable reliability/cost. Use statistical fallbacks for everything else.

## Roles: one deliverable, divided by boundaries

**LP sequence/game-state agent — critical-path owner**
1. Map and run existing statistical game generator and authoritative reducer; inventory mismatch to contract v1.
2. Provide a deterministic one-play → one-drive → one-game research stream with all metadata, player stats and legal endings.
3. Create invariants/tests for scoring, line-to-gain, downs, time, possession, drive endings, team/player totals, and seed determinism. Do not modify production locks, model picks, DB or jobs.

**Gridiron execution/viewer agent — critical-path owner**
1. Find the already-existing v1 script playback and historical viewer functionality; adapt it to consume LP generated play sequences **without controlling or changing the statistical result**.
2. Produce a working game/drive/play viewer from the immutable stream; expose execution mode, statistical vs physical provenance, playback, player IDs, ball spots and clock. Reuse movement and animation. Separate a later experimental physical executor.
3. Keep the existing engine and Three.js viewer stable; no change to the production player solver or automatic merge of M4d/legacy tackle branches.

**LP tracking/behavior agent — supporting, *not a blocking critical-path task***
- Preserve 2022 real tracking source/label/identity audit and the 49-play manifest. Continue fair snap-anchored movement experiments in parallel if useful, but **do not block E0–E2** on achieving centimeter-level trajectory fidelity or releasing a new 3D solver.
- Provide 5–10 representative, rights-appropriate observed run/pass/drive examples and evaluation baselines when ready. Future post-snap info may only be used to grade, never to generate a prospective play.

**Physics/Madden agent — bounded support**
- Freeze M4c/M4d synthetic results, known penetration/far-wrap defects and rating hypothesis logs. Fix a narrowly reproduced **safety blocker** only if needed by the chosen executable mode; otherwise no more standalone force/grip/rating tuning this milestone.

**One integration coordinator — owns dependencies and definition of done**
- Keep one versioned cross-repo manifest (both exact commits/branches, source snapshots, v1 vs proposed v2 mode, IDs, allowed inputs, tests, examples, screenshots, known limitations).
- Demand the **smallest working vertical slice** rather than parallel unsynchronized experiments. Establish the LP JSON payload and Gridiron consumer before either agent invents a new interface.
- Publish one per-gate status: existing/reproducible, missing, built, verified, failed; links to exact tests, failure reasons and selected sample.
- Prioritize E0 → E1 → E2, with E3 evaluation in parallel. Stop/defer tasks that cannot say which **game delivery gate** they unblock. Agent communication should be through pinned repo artifacts, not only chat.
- Do not authorize production deployments, merges, PR approvals, or use rights/terms interpretations as assumed facts.

## Decision test for every new research proposal

Before requesting another tackle/trajectory/ratings experiment, answer:
1. **Which broken play, drive or game behavior does this address, measured against what real football or rule oracle?**
2. **Can the existing statistical/hybrid method or existing movement/physics implementation solve it at lower cost?**
3. **Which game gate E0–E3 would become demonstrably better, and what is the acceptance metric/stop rule?**

If those have no clear answer, **defer the experiment**. When 3D physical causality is materially important, keep it as a controlled experimental replacement for a specific event mechanism, not an all-or-nothing prerequisite.

## Acceptance and current limits

**Success for the immediate integration sprint:** a fully generated hypothetical NFL game that is legally coherent, statistically accounted for, reproducible, and navigable through Gridiron 3D replay, compared to the unchanged LP statistical baseline. **This is not by itself physically causal or a validated forecast.** A later experimental v2 can let true player movement/contact determine selected outcomes with real observed NFL grading.

Preserve older documents and negative results. This directive changes **priority and next delivery**, not historical reported metrics or permission to modify live products.
