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
change, turn, rink-boundary, and soft pair-spacing limits in 2D. The spacing limit is an empirical
center-distance proxy, not player geometry, contact, or a validated collision mechanic. Call
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

## Extension boundary

Sport configuration owns rink/field geometry, coordinate transforms, locomotion limits, body
geometry, contact policy, and puck/ball rules. The generic interface owns policy invocation,
simultaneous stepping, recording, and replay. A future 3D solver may be an optional projector behind
this interface. This research implementation does not import Rapier, Jolt, the NFL planar-disc
contact model, or the active tackling work.

Run the isolated API check with `node test/movement.mjs`. Run the existing NFL regression separately
with `node test/validate.mjs --strict`.
