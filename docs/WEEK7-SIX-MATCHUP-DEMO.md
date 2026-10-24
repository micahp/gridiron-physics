# Week 7 six-matchup research simulator

Branch: feat/week7-six-matchup-sim-ui-2026-10-24

## Launch

Check out the feature branch, run `npm run serve` and open `http://localhost:8080/week7.html`.

Select Bengals at Ravens, Dolphins at Jets, 49ers at Falcons, Buccaneers at Panthers, Packers at Lions, or Cowboys at Eagles. Change the seed to resample a hypothetical game. Select a play in the drive timeline to view the generated state, historical playbook source and an outcome-constrained 22-player 3D replay. Click a player for the estimated 35 attributes. Physics is generated for a selected snap, not all trials in advance.

## Implementation

- `week7.html` and `web/week7.js`: six-matchup picker, generated timeline, scorebug, playbook/source panel, ratings inspector and selected-play physics viewer.
- `web/week7-core.js`: deterministic experimental sequence generator. Uses the offense's 2025 charted run/pass/formation mix and samples 2025 offensive and defensive historical outcomes for comparable situations. Offensive and defensive observed yards are blended 75/25.
- `pipeline/build_week7_six.py`: builds twelve rosters with the existing 35-attribute rating pipeline and twelve 2025 historical playbook profiles. 2026 statistics and descriptive tendencies are restricted to weeks 1-6. Generated JSON files and actual source SHA-256 hashes are committed by the feature-branch CI workflow.
- `web/prototype-model.js` and `web/prototype-execution.js`: reuse Gridiron's existing role/lineup validation and 120 Hz outcome-constrained physical replay.
- `test/week7-core.mjs` and `test/week7.browser.mjs`: six-matchup deterministic assertions and real Chromium 3D playback checks.

## Limits

This is a research simulation and not a validated NFL game forecast or legally complete full-game model. Special teams, clocks, timeouts, penalties, half transitions and overtime have simplified or unsupported behavior. No completed-game results for these upcoming games are used as inputs.

The 2026 Week 7 team data is a **projected roster membership snapshot**, not verified gameday active/inactive lists. No unavailable or ambiguous player is silently replaced. The ratings are Gridiron's estimated public-research attributes and not official EA Madden ratings.

2025 playbook frequencies are charted play attributes, not literal coach calls or verified routes. Current 2026 Weeks 1-6 PBP is a descriptive supplement. The **learned 2022 team movement prior is not implemented** in this initial UI; the existing Gridiron controller produces outcome-constrained physical motion and team-specific play selection. The 2022 matched-game reference is a research pointer, not a claim that the current play reuses tracked coordinates.

This feature branch leaves the historical Film Room, E2 frozen fixtures, main and production unchanged.