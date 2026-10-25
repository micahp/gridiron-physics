# NFL play-by-play, drive, and full-game validation

Project: Legendary Picks (authoritative NFL game-state and outcome engine), with Gridiron Physics as a read-only replay consumer
Status: Engineering specification, 2026-10-24
Purpose: Prove that the rules and state reducer can reconstruct real, already-completed football games before judging the realism of games sampled from the statistical model.

## 1. The essential distinction

There are two independent tests:

1. **Historical event-driven reconstruction (this document).** Feed the reducer an actual, ordered play and event sequence. The reducer computes the next legal state. Check it against the observed state in the next historical record, the play-by-play scoreboard, and the game's final box score. Do not sample the play, gain, turnover, score, or kick result. This measures rules and transition correctness, not forecasting skill.
2. **Prospective game generation (subsequent stage).** Generate plays and outcomes without future information. Compare distributions of plays, possessions, drive outcomes, scores, and clocks to a historical holdout, using an independent legal-state checker. A perfectly reconstructed historical game does not prove a realistic generated game.

A generator and validator agreeing with each other is insufficient: both may share the same mistaken rule or source interpretation.

## 2. Authoritative inputs and existing assets

| Asset | Location / interface | Job in the benchmark |
| --- | --- | --- |
| LP historical NFL PBP | LP dev DB `nfl_pbp` | Primary observed play, identity, clock, ball spot, down/distance, possession, score and drive/context fields where present. Inventory exact columns before coding. |
| LP 2026 game-state rules | `docs/rules/NFL-2026-GAME-STATE-RULES.md` | Versioned engineering requirements. Official rules override it. |
| Official NFL playing rules | 2026 NFL Rulebook | Authority for 2026 transitions, scoring, clocks, special teams and overtime. |
| LP E2 reducer | `scripts/nfl_sequence/game_state.py`, `e1_drive.py`, `reducer.py`, `game_stats.py` | Starting implementations. Audit whether replay can reuse a pure transition function instead of implementing a parallel rules engine. |
| LP E2 survey and evidence | `EVIDENCE-E2-SUCCESSOR-2026-10-24.md` | Prior synthetic-game-data audit and known rule gaps. Not historical reconstruction evidence. |
| Original Mile High Film Room game | `gridiron-physics/web/data/game.json` | First fixed end-to-end historical fixture, including non-scrimmage and administrative rows. |
| Cross-project data agreement | `gridiron-physics/docs/GRIDIRON-CONTRACT-v1.md` | LP owns football outcomes. Gridiron displays them and must not silently edit them. |

Do not assume every PBP source carries every field. Clock-start and stop signals, live-ball touchdown and return touch states, goal direction, accepted-penalty enforcement and substitutions may require dedicated source parsing or may be unobservable. Record source coverage explicitly before computing denominators.

### First historical fixture: the original Mile High Film Room game

- ESPN event ID: 401872995
- Game: Seattle Seahawks at Denver Broncos, played October 15, 2026 (local). Source UTC date 2026-10-16T00:15Z.
- Final: Denver 17, Seattle 14, overtime.
- The source JSON contains 203 ordered events and 25 ESPN-labeled drives (index 0 to 24). These ESPN groupings include kickoffs and administrative events. Distinguish them from any newly defined canonical offensive-possession grouping.
- Store and verify a content hash of the source. Never alter the original JSON to make a test pass.
- The source's score array is `[away, home]`, not `[home, away]`. Treat composite TD-plus-conversion text and the separately listed PAT row carefully to prevent double counting.

The fixture exercises: a DEN touchdown drive crossing Q1 and Q2; a Q3 half-opening kickoff; a SEA missed 47-yard field goal followed by a DEN start on its own 37; touchdown and PAT scoring; a SEA two-point conversion represented in a touchdown description; a Q4 tying field goal at 0:03; overtime kickoff and interception; DEN's 53-yard winner at OT 4:53; and game termination. It also exercises penalties, timeouts, official stoppages, kneels and non-offensive events. It does not cover every NFL rule.

## 3. Required replay modes and data contract

Implement an explicitly named `observed_historical_replay` diagnostic mode, separate from `pregame_full_game` and from the statistical E2 research sampler.

1. **Normalize observed event (source to typed input).** Preserve the source game ID, source play ID, event ordinal, source season, source rule version, play family, live or dead status if known, event-specific input facts, and a provenance pointer. Do not inject the observed next PBP row or final score as a reducer input.
2. **Initialize independently.** Set pregame state, verified field-end decisions and rules version. Use the opening observed coin toss and kickoff to update state. Where historical choice data are absent, mark an explicit unknown and limit the assertion. Do not substitute the normal simulated-choice policy as a historical fact.
3. **Apply the transition.** From `state_before` and observed event facts, derive `state_after` via the authoritative LP reducer. Side effects must include points, possession, down and distance, ball spot, drive boundary or continuation, clock, and timeout balances where observable.
4. **Compare against an external oracle.** Use the next applicable historical snap or event, and independent scoring, drive and game summaries, as test targets only. Do not feed oracle fields back into the reducer, and do not let the adapter reconcile discrepancies silently.
5. **Emit an immutable trace**: `{game_id, source_play_id, ordinal, state_before, normalized_event, derived_state_after, observed_next_state, comparable_fields, differences, source_provenance, rule_citation}`. Each mismatch must name the first point of divergence and whether the target itself is ambiguous.

For `state_before` and `state_after`, represent: period, `clock_seconds`, explicit running, stopped or restart state if supported, `offense_team`, `defense_team`, scores, `down`, `yards_to_go`, `yardline_100` (offense-relative), home and away timeouts, and `drive_index`. For a kick or conversion, ordinary scrimmage fields may correctly be null. Keep team and goal orientation distinct from offense-relative yardline coordinates.

Do not implement a second competing game-state engine for the historical test. Factor transition functions out of the existing LP engine if necessary, so the historical fixture and the prospective generator are checked against the same reducer.

## 4. Transition families to test

| Family | What must match | Common failure modes |
| --- | --- | --- |
| Ordinary runs and completions | Ball gain, down, distance, first-down and goal-to-go state | Wrong offense-relative coordinate, off-by-one line to gain |
| Incompletion, sack, spike, kneel | Down, spot, running or stopped clock where observable | Wrong clock lifecycle, non-scrimmage events mistaken for snaps |
| Interceptions and fumbles | Possession, dead-ball recovery spot, new series, score | Assuming a turnover from incomplete metadata, wrong returned spot |
| Accepted, declined and offsetting penalties | Enforcement spot, replay or no-play, automatic first down or loss of down, clock effects | Double-counting no-play rows, applying declined penalties |
| Touchdowns, PATs and two-point tries | 6, 1 or 2 point attribution and sequence; subsequent kick | Touchdown text embeds the conversion and the feed also has a separate conversion event |
| Punt, field goal, kickoff, blocked kicks and safety kick | Kick origin, touch and recovery, dead-ball spot, points, legal restart | Conflating kick spot with line of scrimmage, missing return or safety free kick |
| Q1 to Q2 and Q3 to Q4 | Team possession and drive survive; ends switch | Ending a drive at any quarter boundary |
| Halftime and Q3 kickoff | Q2 closes; Q3 kickoff rights follow the actual ledger | Linking an expiring Q2 kickoff directly to the first Q3 drive |
| Regulation and overtime | Tie rules, period length, OT possession, clock and game-end state | Assuming a Q4 tie is final, or applying modern OT rules to earlier seasons |
| Official timeouts and two-minute warnings | Their ordering and measurable clock effects | Treating administrative events as offensive plays, or inventing start and stop observations |

Special cases must be explicitly classified as unsupported when the historical event facts cannot be resolved. Never award an assumed first down, invent a return, or overwrite an observed outcome.

## 5. Independent checks and metrics

### Per transition

For each comparable field `f`, report:

- `comparable_count(f)` and `exact_match_count(f)`; `exact_match_rate(f)` = matches / comparable.
- `unobservable_count(f)`, `unsupported_count(f)` and `ambiguous_source_count(f)` separately. Do not count these as exact matches, and do not silently drop them.
- `first_divergent_event` with source play ID and current and expected states.
- Numeric clock and spot error (absolute seconds and yards) in addition to exact match where precise comparison is meaningful.

### Per drive

- Correct offensive possession team and consecutive event range.
- Correct start spot, start period and clock, and end spot and event, including quarter-spanning drives.
- Exact termination type and credited points, plays, scrimmage yards and elapsed time where source definitions allow comparison.
- Compare canonical LP drive segmentation and ESPN or nflverse drive labels through an explicit mapping. Do not equate the 25 ESPN event-group indices with 25 independently audited offensive drives without verifying the definitions.

### Per full game

- Game event order, each team's final points, period and half transitions, kickoff receivers, overtime progression, and terminal state.
- `fully_reconstructed_games / eligible_games`, counted only when every required applicable transition is represented or has a source-verifiable correct transition. Report partial and unobservable games separately.
- Independent summary-stat reconciliation and source coverage, not merely `validate_game()` passing.

### Failure categories

Distinguish: source or normalization defect; rules reducer defect; source field absent or unobservable; historical-rule mismatch; reference drive-grouping mismatch; and independent checker defect. Never repair the reducer based on a bad oracle without a fixture showing why.

## 6. Corpus and evaluation procedure

- **Gate H0: Source inventory.** List DB tables and columns and verified event coverage. Document absent fields and observed ID conventions. Pin database and query snapshot, source SHA and rules version.
- **Gate H1: Mile High fixture.** Reconstruct all 203 source events. Explicitly account for administrative and non-transition events. Prove the final DEN 17, SEA 14, the overtime game end, the scoring progression, and the observed drive sequence. Pin a positive and a deliberately corrupted negative fixture for each required family actually present.
- **Gate H2: Multi-game reference suite.** Select a fixed, diverse cohort spanning close scores, end-of-half scoring, safety, blocked kicks, missed field goals, punts, penalties, goal-to-go, turnovers, overtime and exceptions. Prefer 2026 games for direct 2026 rule verification. Run older games only with versioned historical rules where relevant.
- **Gate H3: Corpus-scale audit.** Stream eligible historical games chronologically. Publish eligible and excluded games, drives and event counts by season, source and rule version, transition-type match rates, full-game exact reconstruction, and mismatch roots. Exclusions must be field-specific and explainable, not performance-driven.
- **Gate H4: Synthetic-game revisit.** Only after the historical reducer and independent oracle show convincing agreement, rerun the exact previous 300 E2 seeds and compare legal-state findings without changing sampling to force a pass. Preserve old evidence, and report the 38-seed classification and any remaining unsupported transition guards.

**Acceptance criterion for a claimed fully reconstructed fixture:** all source-observable required state fields and events match exactly; no unexplained score, ball-spot, drive or restart differences; every unobservable or unsupported rule is disclosed, not treated as success. Broader corpus success must publish denominators, failures and limitations. Do not claim 100% on a filtered subset without the coverage denominator.

## 7. Deliverables and change rules

1. A read-only historical normalization adapter and replay entrypoint using the existing LP reducer.
2. A frozen Mile High fixture manifest and per-event comparison JSON or CSV.
3. A human-readable first-divergence report with event IDs, both state snapshots, rule basis and defect classification.
4. Deterministic positive and negative regression fixtures, including non-scrimmage events and quarter, half and overtime transitions.
5. A reproducible multi-game corpus report and per-family exact-match table.
6. Separate coverage flags for `historical_state_reconstruction`, `model_scoped_complete`, and pregame shared-v1 `valid_full_game`. This benchmark must not turn the last flag on.

**Ownership:** Legendary Picks owns the state reducer, recorded events and correctness claims. Gridiron can inspect and render the read-only traces and independently audit them. No production writes, no rewrites of historical source rows, no automatic merges, and no fabricated source facts.

## 8. Reference links

- Legendary Picks rules reference: `docs/rules/NFL-2026-GAME-STATE-RULES.md` (LP repository)
- LP E2 evidence: `EVIDENCE-E2-SUCCESSOR-2026-10-24.md` (LP repository)
- Mile High Film Room source: `web/data/game.json` (this repository)
- Shared LP and Gridiron v1 proposal: `docs/GRIDIRON-CONTRACT-v1.md` (this repository)
- Official NFL 2026 rules
