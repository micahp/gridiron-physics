# Reusable matchup configuration

The prototype reads `data/teams/matchup-2026-10-22.json`. Team IDs are stable league abbreviations (`NE`, `CHI`); GSIS IDs identify players. Each team record points to its own playbook, carries the complete Week 7 roster snapshot and availability, and supplies the player ratings and physical-body fields consumed by `engine/play.js`. Venue, field direction, opponent, playbook, and offensive/defensive slot substitutions are configuration inputs. A future team can add a roster plus a `gridiron.playbook.v1` file without changing the force solver.

The new browser entry point is `prototype.html`. It swaps selected IDs, not just team labels. The team selector swaps the actual 11-player offense, the opponent's 11-player defense, and the offense's team-specific 2025 playbook profile. A Patriots active roster shortage requires one explicit synthetic tackle-to-guard flex for the current engine's five line slots; the assignment is shown in the UI and rejected if the replacement is not an offensive lineman. The 2026 official inactive list is excluded from selectable rosters.

## Existing single-game assumptions

The historical Seahawks–Broncos reconstruction remains a separate mode. Its current inputs contain intentional game-specific anchors that must not be imported into a prospective matchup:

| Area | Existing fixed assumption | New-path configuration |
|---|---|---|
| `pipeline/build_game.py` | ESPN event `401872995`, nflverse game `2026_06_SEA_DEN`, SEA/DEN text regexes and spot parsing | Separate matchup snapshot and playbook files; future ingestion should accept a game/team/venue config instead of editing constants. |
| `pipeline/fetch.py` | Default event ID `401872995`, historical event endpoint and output names | New data fetcher pins season assets and hashes; matchup-specific event fetching is not used for the prospective demo. |
| `pipeline/ratings.py` | `TEAMS=(DEN, SEA)`, historical game week 6, 2025 + prior 2026 weeks | New snapshot builder configures rating season/week at build time, joins 2026 weekly roster IDs, and applies game inactives. The legacy rating output remains unchanged. |
| `web/data/game.json` | Historical teams, rosters, lineups, real play outcomes and event IDs | New `data/teams/` snapshot plus per-team `data/playbooks/` profiles; these files contain no future outcome labels in their selector path. |
| `web/app.js` | Replays that one game, with selectors and controls over its historical plays | `web/prototype.js` builds engine-ready 22-player scenarios from the selected team and opponent. |
| `engine/play.js` | Generic team IDs but fixed 11-personnel offense/defense slot geometry; run and complete-play paths use supplied outcome constraints | Team IDs and rosters are interchangeable. Formation geometry and outcome resolution remain explicitly constrained as documented in [the play interface](PLAY-INTERFACE.md). |
| `test/validate.mjs` | Strictly compares historical play end spots with ESPN anchors | Historical acceptance test is preserved and runs alongside separate prototype roster, data, determinism, and constrained-action checks. |

No SEA/DEN event IDs, rosters, lineup IDs, stadium, or real play end spots are referenced by the new matchup builder, snapshot, team selector, or prototype tests. The legacy files above intentionally retain their original assumptions so the historical replay remains reproducible.

## Adding a third team

Provide its stable team ID, color/venue metadata, pregame roster and availability snapshot, 35-attribute ratings and physical values, and a `gridiron.playbook.v1` profile. The shared lineup validator enforces team membership, unique IDs, 11 players per side, and compatible positions. If a lineup cannot meet an engine slot from active players, report it as unsupported or add a visible, provenance-tagged flex rule. Do not substitute a historical player or outcome anchor to fill the gap.
