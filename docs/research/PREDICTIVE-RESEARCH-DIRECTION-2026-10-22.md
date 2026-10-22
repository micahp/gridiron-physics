# Predictive research direction: hockey first, data before engine changes

Date: 2026-10-22  
Status: research recommendation; no production or engine implementation  
Companion task: [ten-game hockey agent handoff](HOCKEY-TEN-GAME-AGENT-TASK-2026-10-22.md)

This document supersedes the experiment priority in [the original Gridiron proposal](PREDICTIVE-PHYSICS-PROPOSAL-2026-10-22.md). Retain its separation of reconstruction from forecasting, but start with the ten anonymized hockey games. Shot-only analysis is the fallback. NFL Big Data Bowl is a supplementary movement-validation source, not the default data backbone.

## Decision

Use the hockey recordings to establish a trustworthy movement research environment. At the same time, reconcile the NFL data Legendary Picks already has before adding another feed. Audit the historical NBA SportVU movement archive next. It is a closer match to this research objective than shot summaries or provider model outputs.

There is no single strongest sport across all objectives:

| Objective | Best current direction | Reason and qualification |
|---|---|---|
| Immediate movement research using data already obtained | Ten anonymized hockey games | Actual player/puck tracks are described in the existing experiment; quality and identity need work. |
| Prospective football play generation | NFL PBP + participation + FTN + NGS summaries | Existing LP investment and rich action/context data; not continuous motion. |
| Next NBA movement research | Historical SportVU archive | 636 archived game files; validate actual coverage and alignment before reserving independent games. |
| Public ball-mechanics research | MLB Statcast | Directly documented pitch-motion parameters and contact measurements; existing LP importer aggregates much of this detail. |
| Independent validation of a hockey improvement | Additional untouched games | The ten games have already been used repeatedly and cannot become fresh merely by changing the split. |

## What this review actually established

The shared ChatGPT URL could not be retrieved directly. The ten-game reference was resolved through prior context, then checked against the committed LP experiment and organizer materials. Repository code, committed research reports, source schemas and release metadata were inspected. No fresh production database query was run. Code presence, a report of ingestion, published asset metadata and successful current retrieval are different evidence levels.

### Gridiron did not ingest the continuous NFL tracking implied by its animation

The inspected Gridiron pipeline uses ESPN summaries, participants, rosters and depth charts, together with nflverse play-by-play, identifiers, combine and player statistics. In `pipeline/build_game.py`, formations depend on depth/role assignments and credited participants. In `engine/play.js`, movement is constructed around the known play result and endpoints. Ball launch is solved to an intended endpoint.

Therefore the example contains real event context and synthetic movement. It does not establish that we already acquired full Next Gen Stats player and ball coordinates. A depth-chart formation is not an observed alignment. This corrects the assumption that the rendered paths can be reused as movement ground truth.

Sources: [Gridiron pipeline](https://github.com/micahp/gridiron-physics/tree/main/pipeline), [simulation](https://github.com/micahp/gridiron-physics/tree/main/engine). The original review records inspected commit IDs.

### The hockey experiment already exists

The [LP report](https://github.com/micahp/legendarypicks/blob/research/nhl-shot-to-rebound-tracking-2026-10-22/docs/research/NHL-SHOT-TO-REBOUND-TRACKING-EXPERIMENT-2026-10-22.md), commit `25d1c746f714d89cbaf2561d4d25035c0fb4b33a`, describes 54 release assets, 19,200 events, 959,754 tracking frames, 1,190 shot/goal attempts and 847 matched tracking examples with 39 goals.

The organizer calls these anonymized high-calibre hockey games; their NHL identity is not established. Tracking was derived from broadcast video. Coverage is incomplete, event clocks have integer-second precision, event/tracking coordinates require alignment, and puck Z contains unusable values. A puck row in every frame does not prove accurate observation.

The existing recovery proxy experiment and follow-up controls did not establish an adoptable predictive gain. Nested tuning substantially reduced the initial apparent harm, but did not establish a reliable improvement either. Do not rerun a feature sweep and label the result independent validation. Preserve the report's recorded confirmation of separate written permission; do not demand the same approval again or publish private permission text.

Sources: [organizer repository and schema](https://github.com/bigdatacup/Big-Data-Cup-2026), [release](https://github.com/bigdatacup/Big-Data-Cup-2026/releases/tag/Data), [organizer](https://stathletes.com/big-data-cup).

## NFL: recover the existing investment and fill specific gaps

| Data layer | What it supplies | LP evidence and next action |
|---|---|---|
| Play-by-play | State, plays, participants, outcomes, timing and some formation indicators | Already foundational. Preserve raw fields and separate pre-play inputs from outcome labels. |
| nflverse participation | Personnel, formation, player IDs, defensive box/rushers, coverage and selected throw/pressure/route fields | LP's October 12 index reports 2016–2025 ingestion. Reconcile its foundation branch and live table against dev; the inspected dev history loader does not include participation. |
| FTN charting | Motion, play action, RPO, QB location, box/rushers and annotated pass characteristics | Existing history loader and research reports. Many annotations are post-play labels, not information known before a future snap. |
| NGS summaries | Receiving separation/cushion/YAC above expectation and passing/rushing summaries | An inspected receiving importer already exists. Verify grain, joins, update times and actual populated seasons. |
| Continuous tracking | Time-indexed positions of all players and ball | Not found in the inspected Gridiron ingestion. Full current-season public bulk access has not been established. |
| Big Data Bowl | Task-specific released tracking samples | Useful for movement validation and model development after dataset-specific audit; not a replacement for regular production feeds. |

The [participation documentation](https://nflreadr.nflverse.com/reference/load_participation.html) identifies a provider transition: NGS before 2023 and FTN from 2023, with the latter released after the postseason. The [dictionary](https://nflreadr.nflverse.com/articles/dictionary_participation.html) includes primary-target route and formation/personnel fields, not all 22 complete trajectories. NGS air yards are missing from 2024 onward in this table; use the documented PBP field appropriately.

Release inspection found 2025 participation assets but no 2026 asset in [pbp_participation](https://github.com/nflverse/nflverse-data/releases/tag/pbp_participation). In contrast, [FTN 2026 assets](https://github.com/nflverse/nflverse-data/releases/tag/ftn_charting) were updated October 22. FTN's [documented cadence](https://nflreadr.nflverse.com/reference/load_ftn_charting.html) is within 48 hours after games. A historical formation table therefore does not automatically solve current-week formation availability.

[NGS summary documentation](https://nflreadr.nflverse.com/reference/load_nextgen_stats.html) describes weekly passing, receiving and rushing statistics, minimum qualification thresholds and week-zero season summaries. The [release](https://github.com/nflverse/nflverse-data/releases/tag/nextgen_stats) had current aggregate assets updated October 22; several year-specific files were stale. Prefer inspecting the current aggregate assets and filtering seasons over assuming a year-named file is complete.

Amazon supplies technology in the [NFL tracking partnership](https://operations.nfl.com/game-operations-logistics/technology/performance-tracking-data-next-gen-stats); that does not imply an open AWS bucket or public raw-coordinate API. Seek a sample schema, historical coverage, cadence and permitted use from a licensed source if raw tracking becomes necessary. Do not buy a feed merely branded “advanced stats” without confirming its grain.

LP references: [research index](https://github.com/micahp/legendarypicks/blob/dev/docs/INDEX-nfl-model-research-2026-10-12.md), [history loader](https://github.com/micahp/legendarypicks/blob/dev/backend/load_nfl_history.py), [NGS receiving importer](https://github.com/micahp/legendarypicks/blob/dev/backend/ingest_nfl_ngs_receiving.py). Earlier pressure/coverage tests not being retained for game-margin prediction does not prove those fields are useless for conditional play generation.

## NFL team playbooks built from observed plays

The intended first version is a playbook filled with plays each team actually ran in the previous season. Each entry references real game/play IDs and retains the observed personnel, formation and available action labels. This is an observed repertoire, not a claim to possess the team's internal coaching manual.

Keep three layers separate:

- **Observed play record:** source-backed facts about a historical snap, including explicit missing fields.
- **Executable play template:** assignments and starting geometry needed by the simulator. Mark each element as observed, inferred or unknown; a recorded formation and target route do not identify every route or blocking responsibility. Multiple real calls may share the same recorded features, so do not invent exact concept names.
- **Selection policy:** probabilities of choosing entries or observed play families given down, distance, field position, score, clock, available personnel and opponent context.

The initial team repertoire should contain only source-backed historical plays/families. Any proposed new concept or coaching-change extension belongs in a separately labeled inferred repertoire, not silently in the observed set. Group repeated examples without discarding their source IDs, counts or situational frequencies.

For the current example, Gridiron's README identifies Seattle at Denver on October 15, 2026, ESPN event 401872995. As checked October 22, the participation release stops at 2025; it cannot supply observed 2026 formations for that game. This does not block a prospective simulation: learn the repertoire from released 2025 records and select future calls without reading the real 2026 sequence. Separately verify whether FTN's current-season charting contains this game's rows before claiming enrichment. Its faster publication schedule does not imply availability of the full participation table.

Use current as-of roster availability to assign players to historical roles, preserving personnel constraints and flagging substitutions. Coaching changes and unavailable players reduce confidence in old selection frequencies. Do not assume a departing player's identity transfers to the replacement or that the same coach remains in charge.

The stored historical result is a training/evaluation label. Re-running the play must generate a new outcome; it must not inherit its actual gain, catch point, tackler, scorer or end spot. Preserve the existing reconstruction entry point separately.

**First NFL implementation task:** an agent with both repositories should audit LP's actual participation coverage and player-ID joins, export versioned historical play records, and add a prospective repertoire loader/selector to Gridiron. Start with a bounded personnel/formation/play-type prediction experiment against a league-wide situational baseline before expanding all-22 assignments or the engine. A legal formation and deterministic seeded sample are integration checks, not predictive validation.

For evaluation, freeze features, taxonomy, tuning and split before scoring. Score only observed labels, report missing-label coverage, use later untouched games and game-clustered uncertainty, and compare log loss/calibration with the baseline. Respect source publication dates: a season's participation records released after its postseason may be evaluation labels for that season, but cannot be inputs to forecasts supposedly issued during that season. A same-season rolling fit using those unreleased records is not deployment-faithful. Future models and ratings receive new versions; issued forecasts stay immutable.

### How Madden's approach relates

EA publicly describes a combination of observed football, football research and game design. Its [Madden 21 playbook notes](https://forums.ea.com/discussions/madden-nfl-franchise-discussion-en/madden-nfl-21-playbooks-and-ai-gameplay-updates/9058563) explain that new-coach/coordinator schemes are researched through film and interviews. Its [Madden 26 gameplay notes](https://www.ea.com/games/madden-nfl/madden-nfl-26/news/madden-26-gridiron-notes-gameplay-deep-dive) describe learning play-call tendencies from real NFL data and adding team-specific plays seen during the season. Its [beta feedback notes](https://www.ea.com/games/madden-nfl/madden-nfl-26/news/gridiron-notes-madden-26-closed-beta-feedback-updates) also acknowledge adding legacy formations for gameplay variety.

These sources do not establish that teams supply EA their complete confidential playbooks for the upcoming season. Nor do they establish that EA relies only on the same public tables available to LP. The useful analogy is learning a team's observed repertoire and tendencies, researching coaching transitions, then updating with new evidence. LP's additional requirement is independently measured predictive accuracy rather than game authenticity alone.

## NBA: raw movement first; derived metrics are secondary

The relevant movement source is the [2015–16 SportVU archive](https://github.com/linouk23/NBA-Player-Movements). Inspection counted 636 compressed game files and confirmed parser fields for player/team IDs, player X/Y, ball position, quarter, game clock and shot clock. The [dataset card](https://huggingface.co/datasets/dcayton/nba_tracking_data_15_16) describes 25 Hz tracking. Archive presence and parser inspection do not validate every game's completeness or alignment. Audit samples, timestamps, duplicate frames and game/event joins before modeling; reserve untouched games before tuning. Current-season equivalent bulk access has not been established.

This source is the NBA counterpart to the hockey movement recordings and NFL tracking samples. Prioritize it over the summary-metric acquisition proposed in the initial version. The following products are supplementary:



1. **Event-level shot records:** attempts, location, clock, player and result. These support independently trained shot-quality and shot-selection models.
2. **Tracking-derived summaries:** defender-distance, dribble and touch-time bins; passing/rebounding summaries. These describe observed play but do not reconstruct continuous motion.
3. **Provider model outputs:** expected field-goal percentage, Gravity and other Inside the Game metrics. These are useful benchmarks or explicitly identified external-model inputs, not proof that LP has the raw training observations.

The [NBA/AWS announcement](https://www.aboutamazon.com/news/aws/nba-aws-cloud-ai-partnership-basketball-innovation) describes tracking at 60 Hz with 29 body points, and metrics using shot setup, orientation and defensive context. This is a statement about the league's measurement system, not a promise of downloadable raw tracking.

The inspected [nba_api shot-chart documentation](https://github.com/swar/nba_api/blob/master/docs/nba_api/stats/endpoints/shotchartdetail.md) and [shot-context documentation](https://github.com/swar/nba_api/blob/master/docs/nba_api/stats/endpoints/playerdashptshots.md) establish implemented client schemas. The latter exposes grouped context tables, not necessarily a defender-distance label joinable to every individual shot.

The client also implements [Gravity leaders](https://github.com/swar/nba_api/blob/master/docs/nba_api/stats/endpoints/gravityleaders.md), including season-level scores and counts. Its documented parameters do not include a game/date cutoff. A current season aggregate cannot be used retroactively as though it existed before each game.

A live Gravity response was not obtained during this review. Bulk historical per-shot expected-FG access was not verified. The inspected LP NBA importer handles schedules/boxscores; this review did not establish an existing importer for these new metrics.

**Acquisition gate:** retrieve a permitted sample, verify game/shot IDs, dates, pagination, historical seasons, missingness and stable availability, and archive source versions. Only then scope an experiment. Do not make a production dependency on an endpoint solely because a Python wrapper exists.

For a future NBA experiment, compare a simple location/shot-type/player-prior model against one additional verified context source. Use chronological games and a later untouched period. Provider xFG can be a separate benchmark; comparing an imitation of provider xFG against that same xFG is not outcome validation. Pregame simulation must generate the future shot context; it cannot borrow the actual game's shot locations or defensive contests.

## MLB: a fourth foundation for ball and base-advancement research

MLB has usable public measurements for pitching, batted balls and game events. Outfield information also exists, but public averages and derived metrics must be distinguished from continuous trajectories.

| Component | Identified source/data | What remains to verify |
|---|---|---|
| Pitch movement | Statcast release/plate positions, velocity and acceleration parameters | Coverage, coordinate conventions and measurement changes by season. |
| Batted ball | Statcast exit velocity, launch angle, projected distance and hit-location coordinates | A chart coordinate is not automatically a measured landing/catch point; it does not encode a full flight path. |
| Base occupancy and advancement | Play-by-play and Retrosheet event files describing advances, outs and scoring | Event records do not supply continuous runner paths or exact travel times between every base. |
| Fielder starting positions | Baseball Savant situational positioning averages, including outfielders, with CSV export | These are averages, not verified per-play starting coordinates. |
| Continuous defensive and runner movement | Tracked movement used by MLB Gameday 3D; a separate Sportradar Statcast event-tracking product | No public downloadable full-trajectory archive comparable to the NBA SportVU archive was verified in this review. |

**Public ball/event foundation.** The [Statcast CSV dictionary](https://baseballsavant.mlb.com/csv-docs) documents the pitch and contact fields. [Retrosheet event documentation](https://www.retrosheet.org/eventfile.htm) and [CSV downloads](https://retrosheet.org/downloads/csvdownloads.html) provide a concrete source for historical play outcomes and runner advances. Treat those advances as evaluation labels for prospective simulation; do not force a simulated runner to reach the base recorded in the real play.

**Outfield data is not absent.** [Baseball Savant's situational fielder-positioning tool](https://baseballsavant.mlb.com/visuals/fielder-positioning) exposes average starting positions, with situation filters and CSV export. These can inform starting-position distributions. They cannot validate an individual fielder's exact starting point or route.

[MLB Gameday 3D](https://www.mlb.com/news/mlb-gameday-3d-guide) renders tracked ball, fielder and runner movement. Visualization access does not establish bulk research-data access.

[Sportradar's MLB Event Tracking documentation](https://developer.sportradar.com/baseball/reference/mlb-event-tracking) identifies an access-controlled Statcast product. Its published schema includes metrics for batting, pitching, baserunning and fielders. Obtain and inspect an authorized sample before claiming it supplies time-indexed coordinates: a product called tracking can expose derived measurements without full trajectories. No provider was contacted and no payload was acquired.

**ESPN is not the established tracking source.** A field diagram, hit marker or base-occupancy display demonstrates presentation of events. This review did not verify that ESPN exposes underlying continuous fielder/runner paths. Prefer the identified MLB/Statcast and historical event sources for acquisition.

**Next MLB step:** audit a small set of complete games by joining raw Statcast rows to event records using stable game/play identifiers. Report missing contact measurements, runner-transition consistency and field-coordinate definitions. The inspected LP importer already aggregates Statcast by player/date; verify whether raw pitch/event rows are retained before building another ingestion path.

Keep this an acquisition candidate alongside the hockey-first work. Public data supports a bounded pitch/contact or base-advancement study now, subject to sample validation. A complete defensive movement simulator still needs verified trajectories or explicitly inferred movement. Pitch parameters describing an already observed flight are useful for reconstruction and measurement checks; predicting before release requires generating those parameters without reading the future pitch.


## Other leagues: acquisition opportunities and limits

| League | Source to investigate or reuse | Research value and limit |
|---|---|---|
| MLB | [Statcast CSV documentation](https://baseballsavant.mlb.com/csv-docs); existing LP Statcast importer | Pitch velocity/acceleration parameters, release/plate positions, spin, exit speed and launch angle make it a strong physical-measurement candidate. Current LP code aggregates by player/date, so verify retention of raw rows. The documented plate-position reference changes in 2026; version coordinate conventions. |
| WNBA | [Inside the Game](https://www.wnba.com/stats/inside-the-game), [AWS partnership](https://www.wnba.com/news/wnba-aws-multiyear-partnership) | Shot Difficulty and Gravity extend the NBA-style opportunity. Independently verify WNBA endpoint coverage, history and sample sizes; do not assume NBA availability transfers. |
| MLS | [Hudl/StatsBomb open data](https://github.com/hudl/open-data), [Metrica samples](https://github.com/metrica-sports/sample-data) | The inspected MLS 2023 match file contains six Inter Miami matches, not a complete league season. Selected 360 event snapshots are not continuous tracking. Metrica has anonymized tracking samples, not verified MLS identity. |
| Liga MX | Provider-specific event/tracking acquisition | Not present in the inspected open-data competition list. No comparable open continuous feed was verified; retain existing event modeling until a concrete sample is obtained. |
| ATP / WTA | [ATP Insights](https://www.atptour.com/en/news/insights-introduction), [TennisViz](https://tennisviz.com/) | Shot-quality metrics derive from richer tracking. Public insights do not establish bulk raw access; ATP player/team products do not establish equivalent WTA availability. Point/rally data remains the practical statistical foundation. |
| NCAAF | [CollegeFootballData availability](https://api.collegefootballdata.com/data-availability) | Advanced play/event statistics are promising for context models. Verify authentication/tier and coverage; these are not continuous player/ball coordinates. |
| UFC | [Official statistical record book](https://statleaders.ufc.com/) | Strike/takedown performance supports statistical models. No reusable continuous movement feed was established; the UFCStats event endpoint was inaccessible during this review. |
| Esports | [GRID plans](https://grid.gg/plans/) and title-specific authorized feeds/replays | Potentially rich state telemetry, but title, patch, rights, format and price must be checked separately. The current plans page does not justify promising a universal free feed. |

This is a shortlist of verified source families and explicit gaps, not a claim that every available dataset has been downloaded. No provider was contacted.

## The one experiment to start now

Execute the companion hockey task. First validate coordinate transforms, clock alignment, identity continuity and visibility. Select one observable target, preferably player 2D position 0.5 seconds ahead from an identifiable continuous window using only the preceding observed history. If timestamp quality cannot resolve that horizon, stop and revise the target before fitting.

Compare a constant-velocity baseline, a simple learned kinematic baseline and a constrained acceleration/turning candidate on exactly the same eligible windows. Primary development metric: mean endpoint displacement error in rink units; report per-game differences, coverage, uncertainty and runtime. Include failures and incomplete windows in the coverage report. Estimate derivatives and fit preprocessing using past/training data only.

Proposed go/no-go rule for a later independent test: at least 5% lower mean error than the stronger baseline, with a game-clustered 95% interval excluding no improvement, and no material coverage loss. This is a proposed research threshold, not an observed result. Freeze the horizon, eligibility, threshold and sample-size plan before acquiring/opening the new evaluation set.

The ten current games may support grouped development comparisons, but **cannot deliver the required independent confirmation**. Reserve additional untouched games or an external evaluator's hidden set. If no such data can be obtained, finish with a development-only report and no production adoption claim. If current tracking fails basic quality checks, use its shot/event stream as the matched statistical fallback and report what measurements are missing.

## How this becomes useful in Legendary Picks

Keep three distinct inputs and outputs:

- Reconstruction accepts observed outcomes and later frames and produces a labeled replay.
- Prospective research accepts only an as-of state and sampled decisions, then produces distributions of future states/outcomes.
- LP production consumes a validated, inexpensive conditional model distilled from research, with an explicit supported population.

For football, sample personnel/formation and play call from roster availability, prior tendencies and situation; then sample assignments, targets and actions. A future play call is a latent decision unless explicitly supplied for a conditional scenario. Fit policies from historical actions, not final endpoints. NGS player summaries can inform priors but are not individual observed paths.

Physics is most defensible for flight and short-horizon reachability. Catching, blocking, tackling and yards after catch also require learned decisions, contact behavior and outcome calibration. Realistic animation alone does not establish any of those probabilities.

Retain the custom solver for bounded studies. The original solver comparison remains relevant, but engine choice is downstream of measurement quality and demonstrated error. A rigid-body engine cannot supply missing human behavior or missing ground truth.

High-fidelity experiments can yield cheap probability tables, regressions or small models conditioned on situation and ratings. Validate the final surrogate on real held-out outcomes, not only simulator outputs. Measure distribution calibration and correlations as well as speed. More simulated samples reduce Monte Carlo error; they do not remove simulator bias.

Ratings should update only after games are verified and their source data is available. Store event time, ingestion time, verification state, source/model versions and effective-from time. Use shrinkage and uncertainty for limited samples. Every forecast references immutable input/rating snapshots and a model/seed manifest. Corrections create new versions; historical forecasts remain unchanged. Walk-forward evaluation must use what was actually available at each cutoff, including publication delays.

## Order of work

1. Hand off the hockey task now; preserve existing results and authorization.
2. Reconcile NFL historical participation and build the observed team repertoire and bounded selection experiment. Honor publication lags; current-season participation is not required.
3. Audit NBA SportVU movement samples and reserve independent games. Treat xFG/Gravity as secondary.
4. Acquire an independent hockey evaluation set before claiming improvement.
5. Promote exactly one validated conditional component into LP only after it beats the statistical baseline on independent data.

Do not start a full engine rewrite or a multi-league simulator. The immediate missing pieces are trustworthy observation, source availability and independent evidence.
