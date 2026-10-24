# Play selection and physics interface

**Contract version `gridiron.play_selection.v1`.** Stable fields are the versioned JSON keys below. Add optional fields compatibly; changing the meaning or type of an existing field requires a new schema version. This interface belongs to team/roster/playbook integration. It does not define or claim a validated predictive play-selection model.

## Selector input

The minimum input object contains:

```json
{
  "schema_version": "gridiron.play_selection.v1",
  "game_state": {
    "game_id": "demo-patriots-bears",
    "offense_team_id": "NE",
    "defense_team_id": "CHI",
    "down": 1,
    "distance_yards": 10,
    "yard_line": 45,
    "score": {"NE": 0, "CHI": 0},
    "clock_seconds": 900,
    "timeouts": {"NE": 3, "CHI": 3},
    "field_direction": 1
  },
  "teams": {"NE": {"team_id": "NE", "roster": []}, "CHI": {"team_id": "CHI", "roster": []}},
  "active_rosters": {"NE": ["GSIS player IDs"], "CHI": ["GSIS player IDs"]},
  "personnel_availability": {"NE": {"inactive_ids": []}, "CHI": {"inactive_ids": []}},
  "playbooks": {"NE": {"schema_version": "gridiron.playbook.v1"}, "CHI": {"schema_version": "gridiron.playbook.v1"}},
  "player_ratings": "35 attributes and physics values embedded in each team roster record",
  "contextual_constraints": {"supported_personnel": "engine-compatible 11-player units"},
  "demo_controls": {"kind": "run", "formation": "SHOTGUN", "candidate_id": "observed-2025-run-…", "personnel_overrides": {}},
  "random_seed": "caller-supplied deterministic seed"
}
```

This object is accepted by `selectPlay(input)` in `web/prototype-model.js`. The `teams` value is the parsed `teams` object from the matchup snapshot; `playbooks` contains the parsed team-specific playbooks. `active_rosters` lists stable GSIS IDs. A supplied active ID that cannot be joined to the selected team's roster causes an explicit error. `demo_controls` is the integration-test/demo selector request; the autonomous weighted selection model is outside this feature.

`buildLineups` accepts optional `personnelOverrides: {offense: {slot: player_id}, defense: {slot: player_id}}`. Every selected player must belong to that side's active roster, occupy a role-compatible position group, and appear once. Unsupported or incompatible substitutions throw an explicit error. The browser prototype exposes this through its Personnel substitution controls.

## Selector output

`selectPlay` currently returns:

- `selection`: `play_id`, `provenance`, `provenance_basis`, `team_id`, `opponent_id`, `formation_reference`, `formation_observation`, `playbook_entry`, separate historical marginal rates, `personnel_concept`, `selected_draws`, `random_seed`, `selection_probability`, and `probability_note`.
- `play`: engine-ready `id`, `off`, `def`, `kind`, `los`, `dir`, `shotgun`, `lineup`, and action-specific input fields.
- `players`: a stable-ID lookup with team membership, 35 ratings, and physics-body values.
- `lineups`: 11 offense slots, 11 defense slots, and any explicit role adaptations.
- `action_policy_inputs`: run carrier/blocking/pursuit inputs or pass target/route/coverage inputs.
- `execution_contract`: mode, `predictive_success`, unsupported-action strings, and whether historical outcome constraints were used.

The demo selector is explicitly `synthetic_variation`, while `selection.playbook_entry` identifies the directly charted `observed_2025` attribute combination selected from that team's catalog. The entry retains count, action-specific denominator, rate, Wilson interval, and source IDs. Users can pick a specific entry; absent an ID the adapter samples entries by observed counts under the supplied seed. This is an integration control, not a learned selector. `selection_probability` remains `null` because the historical combination rate does not calibrate a prospective probability. The adapter never uses observed receiver, tackler, catch point, or end spot.

## Physics execution output

`executeSelectedPlay(selection)` in `web/prototype-execution.js` returns `gridiron.play_execution.v1`: `status`, `predictive_success`, `unsupported_action_flags`, `outcome_anchor`, `failure`, `trajectory`, `interactions`, `resulting_state`, `statistics`, and the original `record`. The trajectory object carries `roster`, `stride`, `frames`, `t0`, and `hz`; interactions are engine events; resulting state is the engine end state. `record` retains the existing director output including `expectEndX`, `biggestHit`, `topSpeed`, `throwSpeed`, `carrierId`, and per-player stats.

Every execution result carries:

- `status`: supported, constrained visualization, or unsupported.
- `unsupported_actions`: explicit action/assignment limitations.
- `outcome_anchor`: absent when free; otherwise marked `synthetic_variation` or another traceable provenance.
- `predictive_success`: false for the current demo regardless of whether frames rendered or the engine returned a whistle.
- `failure`: a machine-readable error when no valid 22-player lineup or physics result exists.

## Current engine boundary

The existing director accepts a 22-player input and simulates trajectories, contacts, events, and a resulting state. Its run path requires a fixed `gain`/end spot and steers pursuit toward that spot. The pass demo deliberately selects the `incomplete` branch, uses an assigned synthetic target, and does not predict completion. The director currently has a fixed 11-personnel offensive alignment, a fixed defensive alignment, and no general injection point for arbitrary route trees, blocking rules, or coverage responsibilities. The formation label shown in the demo is an observed reference; the physical layout is a simplified synthetic alignment.

Thus the prototype demonstrates roster/playbook swapping and physical execution inputs. It does not convert the reconstructed-play director into an autonomous prospective outcome model. The historical Seahawks–Broncos path continues to use its real-game anchors through `web/data/game.json` and `engine/game.js` unchanged.
