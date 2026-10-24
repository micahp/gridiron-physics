# Observed tracking, collision, and boundary audit (2026-10-24)

## Scope and guardrails

This is a descriptive audit of the existing Gridiron engine against 2022 Big Data Bowl tracking. It does not change or calibrate the engine. The frozen 49-row tackle manifest remains intact; the separate LP snap-anchored cohort is used for the tracking checks. The canonical movement cohort is the 9,289 LP-eligible plays on `research/nfl-snap-anchored-benchmark-2026-10-24` at `273fb9dcc2d23443906a84812651f4589362cca7`. Weeks 6–9 remain reserved and were not used.

Tracking is 10 Hz and supplies player and football x/y coordinates. It does not supply player feet or football height. Consequently, this audit can compare horizontal geometry and event timing, but cannot establish foot placement, aerial ball height, or physical contact forces from observation.

## Findings

### Runner out of bounds

The engine whistles a live carrier when the player center is more than 0.3 yd beyond either sideline (`engine/play.js`, carrier boundary check around line 1795). The LP-cohort audit selected rushing plays with an explicit out-of-bounds phrase in the play description and a tracking `out_of_bounds` event. It found 260 matched plays in weeks 1–5. Thirteen description-matched plays without a tracking OOB event were not included. Each included track had the runner and football present for five frames before, the event frame, and two frames after.

At the tracking event frame, the runner center was already outside the sideline in 116/260 plays, and the football center was outside in 185/260. In 244 tracks with a crossing of the engine's center-plus-0.3-yd threshold, the tracking event was earlier than that crossing in 162, on the same frame in 43, and later in 39; the median event-to-threshold offset was one frame earlier. This indicates that the current center threshold tends to recognize the event late relative to the tracking label at 10 Hz.

As a sensitivity check, treating the engine's generic player disc radius (0.295–0.362 m, approximately 0.323–0.396 yd) as a rough body-edge proxy brought a boundary crossing closer to the label: within one frame in 170/257 tracks using the smaller radius and 155/257 using the larger radius. The proxy is not a foot model or a rules adjudicator. At event time, the body-radius envelope overlapped the sideline in 214/260–220/260 plays, depending on the radius. These results support testing an earlier boundary trigger, but do not identify a legally correct foot-based threshold.

A follow-up paired threshold evaluation compared first crossing after snap or handoff through the available play track. On the 244 plays with crossings under both the current threshold and small-radius proxy, absolute event-frame error improved in 119, tied in 28, and worsened in 97; the median paired change was zero frames. The proxy increased within-one-frame cases from 137 to 162 on those paired plays, while p90 absolute ball-spot delta rose from 1.69 yd to 1.96 yd across each method's available crossings. The large-radius proxy had a 0.015 yd worse paired median absolute spot delta. This does not establish a net improvement, so the current engine threshold remains unchanged. The evaluator and machine-readable results are under `research/physics-3d-evaluation/m4b/m4d/football-tracking-feasibility/oob-boundary-candidate-2026-10-24/`.

### Player contact and tackling geometry

The observed run-block audit joined offensive line positions C/G/T and `blockedPlayerNFLId1..3` from `player_play.csv` to the opposing players. All 1,271 resulting assignment pairs across weeks 1–5 had both players tracked at snap and +1.0 s, and all target-team checks passed. Their minimum observed separation during (0, 1.0] s had a per-week median between 1.136 m and 1.295 m; 1,181/1,271 (92.9%) minima occurred at the +1.0 s endpoint. Thirty-seven minima were at or below 0.59 m, and 106 were at or below 0.724 m, the minimum and maximum sums of the engine's player radii. Assignment labels and sparse x/y proximity do not establish when or how a physical block occurred; the endpoint-heavy minima make this a weak collision-response validation set.

A separate descriptive tackle-label join had 5,733 single-carrier credited-tackle plays and 7,648 credited defender pairs with distances. At the global tracking tackle-event frame, the nearest credited defender to the inferred carrier had median separation 0.671 m and p90 1.736 m. The nearest credited defender was within 0.59 m in 2,461/5,733 plays and within 0.724 m in 3,107/5,733. Tackle credit is a post-play label, and the event is global across the tracked players; these figures are descriptive geometry only, not model inputs or evidence that a specific pair collided.

The engine resolves unengaged player contact as overlapping 2D discs with mass-weighted positional correction and a low-restitution impulse. Engaged pairs skip that generic collision and use a spring-damper interaction (`engine/world.js`, around lines 203 and 284). A deterministic overlap smoke check confirmed that the generic discs separate and conserve linear momentum in the tested case. Neither smoke check nor the observed assignment distances validate player contact realism, line-of-scrimmage collision forces, or tackle outcomes.

### Football flight, ground contact, and scoring hardware

The engine advances a 3D ball with gravity and quadratic drag and solves a launch velocity for the requested endpoint (`engine/ball.js`). In tracking, football x/y paths were available for 4,015 pass trajectories with at least three samples. Their median duration was 0.8 s and median horizontal displacement was 16.4 yd. The median maximum cross-track deviation from the endpoint line was 0.211 yd (p90 0.627 yd). This supports a mostly straight horizontal projection for this sample; it cannot validate vertical arc, speed, spin, or landing because tracking has no ball z coordinate.

Ground contact in the engine clamps the ball to z=0.1 m, applies randomized vertical restitution for sufficiently fast impacts, and reduces/rotates horizontal velocity (`engine/ball.js`, `bounce`). A deterministic loose-ball smoke run produced two rebounds before settling. That verifies the code path runs, not that bounce count, rebound energy, or fumble-roll behavior matches observed football; observed height is unavailable.

Field-goal attempts do not collide with upright or crossbar geometry. The engine solves a path toward a scripted good/miss target and emits the result at the scheduled arrival time (`engine/play.js`, `kickFG` and the field-goal event check around lines 1567 and 1784). There is no post or crossbar impact/rebound behavior to validate.

### Catch boundary and incompletions

The free-outcome pass resolver uses ball height and horizontal distance to the receiver and defenders; it does not test receiver feet or sideline placement (`engine/play.js`, `resolvePass`, around line 1210). Scripted plays can also supply the outcome directly. Since the tracking source has no feet or ball height, this audit cannot determine whether an observed sideline catch should be complete or incomplete. The current free-outcome path is therefore not an observed foot-placement adjudicator.

### Fumbles

The normal play engine has no explicit carrier fumble and recovery transition. A separate research interaction harness contains an experimental force-triggered fumble transition, but it is not integrated with the normal engine and has not been calibrated against observed fumble/recovery sequences. The loose-ball bounce routine alone does not model fumble causation or possession recovery.

## Verification and decision

The existing research-branch `npm test` run passed: 176 plays and 35,478 frames, with 122/124 end-spot comparisons within test tolerance and no speed-limit violations; prototype checks and four Python tests passed. One play had a 3.65 yd sideline spot error. Those tests do not cover goalpost impacts, foot-based catches, observed ball bounce height, or fumble outcomes.

**Conclusion:** horizontal ball flight is plausible at the measured 10 Hz resolution; the current boundary threshold tends to trigger late against the event labels, but the disc-edge candidate did not improve paired median timing or spot error. Player collision realism, post impacts, foot-based incompletions, vertical bounce realism, and fumble behavior remain unvalidated or absent. The evidence does not justify changing the boundary rule or production physics, starting generic calibration, or claiming gains in tackle probabilities, yards, scoring, play outcomes, drives, or forecasts. The prior movement comparison remains a separate conditional movement baseline.

## Reproduction notes and limits

- Cohort reconciliation: LP repo `docs/research/BDB2025-SNAP-COHORT-RECONCILIATION-2026-10-24.md`; canonical manifest and eligibility rules are pinned by the LP cohort/preregistration. The 99 blank-formation extra plays remain a labelled separate stratum and are excluded here.
- The session's derived extracts were `/tmp/gridiron_oob_candidates_wk1-5.csv`, `/tmp/gridiron_oob_track_rows_wk1.csv` through `wk5.csv`, `/tmp/gridiron_collision_events_wk1-5.csv`, and `/tmp/gridiron_pass_ball_tracks_wk1-5.csv`. Raw and derived tracking tables are intentionally not copied into this repository.
- Boundary-threshold candidate scoring is rerunnable with the evaluator in `research/physics-3d-evaluation/m4b/m4d/football-tracking-feasibility/oob-boundary-candidate-2026-10-24/evaluate.py`; its output records input SHA-256 values.
- The 10 Hz event-frame comparisons have ±0.1 s quantization. Tracking labels, player-center radii, and inferred carrier identities are not substitutes for feet, pads, ball-height, or force measurements.
