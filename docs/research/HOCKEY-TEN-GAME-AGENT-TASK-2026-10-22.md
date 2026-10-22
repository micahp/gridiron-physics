# Agent task: build the ten-game hockey movement research foundation

Priority: use the ten anonymized Stathletes Big Data Cup 2026 games first. Shot-event-only data is the fallback and matched baseline. Do not start an NFL engine rewrite.

## Read first

- https://github.com/micahp/legendarypicks/tree/research/nhl-shot-to-rebound-tracking-2026-10-22
- Commit already available: 25d1c746f714d89cbaf2561d4d25035c0fb4b33a.
- docs/research/NHL-SHOT-TO-REBOUND-TRACKING-EXPERIMENT-2026-10-22.md, including the nested regularization, row-preserving null and power/stopping appendices.
- research/nhl-shot-to-rebound-2026-10-22/analyze_tracking_rebounds.py and committed result JSONs.
- docs/research/SIMULATION-ARCHITECTURE-LEARNINGS-2026-10-22.md.
- Applicable AGENTS.md in your checkout.
- Organizer schema: https://github.com/bigdatacup/Big-Data-Cup-2026
- Data: https://github.com/bigdatacup/Big-Data-Cup-2026/releases/tag/Data

The organizer identifies high-calibre hockey, not a verified NHL league. Preserve anonymization. Do not invent an NHL identity mapping.

## What already exists

The committed report describes 54 assets, 19,200 events, 959,754 frames, 1,190 attempts and 847 matched tracking examples with 39 goals. It reports incomplete player coverage, integer-second event clocks, unvalidated event/tracking coordinate alignment, anomalous puck Z, and no explicit save/rebound labels.

A recovery-within-three-seconds proxy has already been tested. Nested regularization and null controls did not establish movement's predictive advantage. Those ten games have now been repeatedly examined. They are development data, not a fresh independent holdout. Do not repeat the same feature sweep or present another leave-one-game-out score as prospective validation.

The report records Micah's confirmation of separate written data permission. Preserve that authorization; document its applicable scope where available without publishing private permission text or requesting the same authorization again.

## Objective

Establish whether these recordings support a trustworthy movement/possession research environment, and identify one mechanism that is actually observable. The immediate deliverable is a validated state sequence and a measured model of its observation error. A broad recovery event is not a physical rebound, and a 2D path is not full puck flight.

## Work in order

1. Reuse the existing data cache and manifests. Recompute hashes if inexpensive; report missing or changed assets. Work in an isolated branch/worktree. Preserve prior reports and JSONs; all new outputs go in a new directory.

2. Validate the coordinate and time transformations. Use camera_orientations.csv and the organizer rink diagram to align event and tracking X/Y by period/team direction. Check repeated anchors across games, including faceoffs, identifiable shots and recoveries. Quantify alignment residuals rather than assuming a transform is correct. Audit image/frame ordering, duplicates, dropped segments, clock freezes and camera cuts. Do not claim uniform subsecond timestamps from integer-second game clocks unless ordering/cadence supports them.

3. Audit identity and visibility. Measure track-ID continuity, unidentified jerseys, on-ice counts versus shifts, off-screen gaps, goalie visibility and puck jumps. Report complete and incomplete windows separately. A puck row in every frame does not prove that the puck was accurately observed in every frame. Quarantine unusable Z and impossible jumps; never turn missing observations into silently invented player motion.

4. Build a small QA viewer or plots for sampled sequences, overlaying actual tracked players/puck, events, shifts, timestamps and visibility flags. Select sequences by prespecified coverage criteria across multiple games and include failures. Keep raw observations distinguishable from any interpolation. Store a quality table so examples can be audited.

5. Choose one observable mechanism after this audit. Preferred scope: short-horizon 2D skating/puck reachability or possession recovery after a clearly identified loose-puck state. If shot release/contact timing cannot be resolved, do not force a shot-to-rebound experiment. A skating acceleration/turning study is useful without inventing save/rebound labels. Document the prediction cutoff, inputs, target, eligible population and missing-data rules before fitting.

6. If timing/identity quality passes, run one bounded development comparison: constant-velocity baseline, a simple learned kinematic baseline, and only then a constrained movement candidate using identical allowed history. Use game-grouped folds; report spatial error, uncertainty coverage, missing-window rates and runtime. Fit smoothing, derivatives, scaling and movement parameters using training/past frames only. Use no future endpoint, future owner, scorer or whole-sequence smoother as input. Distinguish a physics contribution from the benefit of a better decision policy.

7. Specify an independent replication set before any adoption claim. None of these ten already-used games is fresh. Seek additional permitted games or a provider-held evaluation set; do not contact a provider on Micah's behalf. Existing sample-size estimates are rough and task-specific, not a universal requirement for a new movement target.

## Fallback

If tracking cannot support the selected mechanism, report the exact failure and required additional fields. Use the shot/event stream for a separately labeled statistical baseline. Preserve movement work; do not silently replace the task with more variance/noise tuning. The anonymized event stream is the matched baseline; the NHL archive is a separate population unless a verified mapping exists.

## Deliverables

- A reproducible coordinate/time/identity audit with coverage and error tables.
- A few clearly labeled sequence visualizations showing observed data and failures.
- A minimal normalized state schema, source hashes and quality flags.
- One preregistered mechanism specification and, only if data quality supports it, a bounded development comparison.
- A decision report: what this data can teach us, what it cannot, and the next acquisition needed for an independent test.
- Exact changed files, commit, commands, runtime and limitations.

No full-game physics rewrite, production DB changes, live-pick changes or claims of NHL predictive improvement. Honor repository workflow rules. Do not overwrite or reinterpret the earlier no-adoption result.
