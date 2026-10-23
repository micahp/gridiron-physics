# Prototype coverage and next steps

## Implemented

- Pinned nflverse 2025 regular-season PBP and participation inputs, per-tendency denominators/missingness/source IDs, separately identified postseason exclusions, and two reproducible playbook JSON files.
- PBP-only observed_2026_pre_game comparison for NE (380 eligible offensive plays) and CHI (432), limited to Weeks 1–6.
- 2025-to-2026 coaching continuity records with head coach, coordinator, caller identity, and evidence confidence.
- 2026 Week 7 roster snapshot before kickoff, official inactive exclusions, cross-season roster membership diff, and the existing 35-attribute rating plus physics-body methodology.
- Team/playbook/venue configuration, roster-based 22-player swapping, eligible substitution API and browser controls, and deterministic run/pass scenarios for both offenses.
- Historical Seahawks–Broncos reconstruction and strict acceptance test remain present as a separate replay mode.

## Limits on claims

- Public PBP and participation do not show literal calls, complete routes, protection rules, audibles, coverage assignments, or all defensive geometry. The files describe observed/charted fields and explicitly marked inferred buckets.
- Play-action and motion do not exist in the pinned PBP schema. They remain unknown in the frequency profiles. A few official team articles report 2026 concept rates, but without complete row-level IDs/denominators those figures were not merged into the frequency table.
- The 2026 comparison has no verified participation join. It supports run/pass, shotgun, location, and depth summaries only; it does not update formation/personnel tendencies.
- Ratings are estimates from public combine, production, experience, and draft data. They are not official Madden ratings or player tracking. Depth-chart position is present, but the snapshot does not supply a validated full depth ordering. Status plus the official inactive report determines demo availability.
- NE's official inactive report leaves only one active guard and one active center in the roster feed. The fixed physics offense still requires two guard slots, so the demo uses a visible synthetic OL flex for the second guard slot. A rating-based proxy selects an active tackle and identifies the slot adaptation in the output. This is a supported line-group assignment, not a verified real-game depth-chart assignment.
- Free run/pass physics execution now removes gain, catch, tackler, and end-spot anchors from prospective play inputs. Runs end through simulated tackles, boundaries, or touchdowns; passes resolve from the simulated ball and player positions. The temporary mock play selector, route assignments, ratings-derived catch odds, and fixed slot geometry remain unvalidated scaffolding. A rendered trajectory or observed outcome is not counted as predictive success.
- Seeded run/pass outcomes and a controlled defender-sensitivity probe are recorded in [the free-physics outcome probe](research/FREE-PHYSICS-OUTCOME-PROBE-2026-10-22.md). It demonstrates supported mechanics, not realistic or calibrated outcome frequencies.
- Free-run blocking/contact changes and the committed 200-seed distribution have regression assertions; those smoke thresholds do not establish calibrated football outcomes or predictive accuracy.
- The director's geometry is a fixed 11-personnel offense and fixed 4-2-5 defensive slot map. Formation dropdown choices are observed references, not exact historical formations executed by this geometry.
- No historical-coach play library was added. `historical_coach` remains an independent disabled provenance/sampling category; this optional expansion did not delay the core implementation.

## Next steps

1. Coordinate with the parallel agent on the versioned `gridiron.play_selection.v1` contract and keep its fields stable.
2. Add explicit route/block/coverage assignment inputs and remove fixed run end spots from prospective execution before labeling run outputs as free outcomes.
3. Obtain a documented 2026 participation release and reconcile its game/play keys before revising formations or personnel from 2025.
4. Add verified official depth-chart ranks and a consistent injury/availability feed if prospective substitution quality requires more than game-day inactives.
5. Add historical coach variations only with separate provenance and sampling controls; compare them as hypotheses, never as verified NFL calls.
