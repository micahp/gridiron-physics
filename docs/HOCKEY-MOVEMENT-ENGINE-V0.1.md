# Hockey Movement Research Engine v0.1

This is an isolated sport-neutral movement interface with a hockey research adapter. It is not
connected to the NFL play/world solver and makes no claim that hockey and football share movement,
traction, contact, or collision mechanics.

## Contract

The generic API lives in `engine/movement/index.js`:

- `initializeMovementScene(state, sportConfig)` validates and clones a scene.
- `proposeMovement(state, policy, observationStep)` requests one `{playerId, dx, dy}` intent per player.
- `stepMovement(state, intents, constraints)` advances a simultaneous state by one ordinal step and
  applies an optional whole-scene projector.
- `recordMovementFrame(state, provenance)` emits a serializable transform frame.
- `replayMovement(recording)` returns independent copies of recorded frames.

The hockey adapter lives in `engine/movement/sports/hockey.js`. Coordinates use the source rink XY
plane in feet, but the controller unit is `image_id_increment`. The source has no validated frame
cadence, so `dtSeconds`, feet per second, acceleration per second squared, and real reaction times
are intentionally absent. The puck helper is a constant ordinal-displacement extrapolation only.

`createHockeyMovementPolicy` loads a fold-specific ridge model serialized by the Legendary Picks
research script. It uses six position observations, puck-relative geometry, and distance-weighted
teammate/opponent summaries. `createHockeyConstraints` applies learned displacement, displacement
change, turn, and rink-boundary limits, then makes two pair-spacing projection passes in 2D. This
empirical center-distance floor can leave residual violations; it is not player geometry, contact,
or a validated collision mechanic. Call
`stepHockeyMovement` for hockey scenes so the documented ordinal puck helper is applied alongside
player movement.

## Scene and policy data

Players have unique game-period-scoped IDs, `team`, finite `x/y`, and a chronological `history` of
up to six `{x,y}` points ending at their current position. A visible puck is `{x,y}` with a separate
`puckHistory`. A policy reads the cloned joint state and returns an intended displacement for its
player. Intents are computed against the same current state; stepping updates all players together.
Constraints receive the full proposed scene and may project all players jointly.

The serialized model keeps its training feature means, scales, coefficient matrix, and feature
version. Models trained on recorded future positions must only be evaluated from an observed cutoff;
after the cutoff, the caller feeds only generated states back to the policy. Recorded observed frames
and generated frames have separate provenance and visual styles.

## Future play-generator boundary

The following fields describe the handoff a future predictive play generator would need. They are
not a claim that this ten-game adapter has verified or implemented every field.

| Interface area | Future input/output contract | v0.1 evidence and limit |
|---|---|---|
| Initial state | Sport, game/period, observation index, coordinate frame, timebase and quality flags; player and puck state at the cutoff; source provenance | Game-period track IDs, XY, six past XY observations, puck XY/history when visible, and missing/conflict flags are available. No validated subsecond timebase or full lineup is known. |
| Player attributes | Stable verified identity, team/role, optional handedness, body geometry, and calibrated movement profile, each with provenance and eligibility | Current IDs are game-period scoped; cross-game athlete identity and reliable player-specific movement estimates are unavailable. No player ability or body-size ratings are invented. |
| Policy/action inputs | A policy receives the same cutoff state for all agents and emits one intent per player; future action policies may consume verified role, possession, play call, or tactical intent | v0.1 emits deterministic displacements from past XY plus current puck/player geometry. Possession, event joins, play calls, and goalie roles are excluded. |
| Constraints | Sport configuration owns geometry, coordinate transforms, locomotion, body geometry, contact, and ball/puck rules; a controller may apply only supported projectors | Hockey currently applies observed 2D rink bounds and training-fold ordinal limits. There are no validated timed locomotion, body-contact, reachability, or puck-flight mechanics. |
| Outputs | Simultaneous movement intents, stepped joint state, and a provenance-bearing transform frame; a future stochastic generator must also record its seed and sampled scenario | v0.1 is deterministic for a fixed state/model. It records player and puck XY plus input/model/source metadata; the puck is only an ordinal helper. |
| Uncertainty | A predictive distribution or calibrated per-agent/scene uncertainty attached to generated frames, with calibration population and horizon | The controller does not emit stochastic positions or uncertainty. The evaluator reports a cross-fitted +15 ordinal-step radial error calibration; it does not establish uncertainty for long free-running rollouts. |

All emitted states should retain observation cutoff, model and sport-config versions, random seed when
used, source hashes, missingness/identity flags, and whether the frame is observed or generated. A
future action policy must not be given target-game future coordinates or labels. The generic stepping
API is the execution boundary; sport-specific policies and constraints remain separate.

## Extension boundary

Sport configuration owns rink/field geometry, coordinate transforms, locomotion limits, body
geometry, contact policy, and puck/ball rules. The generic interface owns policy invocation,
simultaneous stepping, recording, and replay. A future 3D solver may be an optional projector behind
this interface. This research implementation does not import Rapier, Jolt, the NFL planar-disc
contact model, or the active tackling work.

Run the isolated API check with `node test/movement.mjs`. Run the existing NFL regression separately
with `node test/validate.mjs --strict`.
