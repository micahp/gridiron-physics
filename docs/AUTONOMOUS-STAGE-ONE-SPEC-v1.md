# Gridiron Physics: Stage One Autonomous Football AI

Technical implementation specification v1.0

Status: Ready for engineering implementation
Primary repository: micahp/gridiron-physics
Initial scope: Autonomous 11-on-11 rushing and quick passing
Primary deliverable: Browser-playable football simulation with independently determined play outcomes

## 1. Product objective

Build an autonomous football simulation engine in which 22 players respond to their assignments, opponents, teammates, the ball and the evolving situation.

The engine must determine what happens during the play rather than reconstruct an outcome selected beforehand.

### Required player behavior

Each player must be capable of:

1. Understanding an assigned football responsibility.
2. Observing relevant changes in the simulation.
3. Selecting an action based on those observations.
4. Executing that action within physical limits.
5. Changing actions when the situation changes.
6. Interacting with other players.
7. Contributing to an outcome that is not predetermined.

The offense and defense must execute separate play calls. Neither team receives the other's private assignments.

### Inputs that are allowed

- Offensive play call and formation.
- Defensive play call, front and coverage.
- Actual lineup and player identities.
- Player abilities, movement limits and physical profiles.
- Game situation, score, down, distance and field position.
- Current and previously perceived positions, velocities and ball state.
- Random seed for reproducible decision-making and interaction resolution.

### Inputs that are prohibited

The autonomous executor must not receive:

- Predetermined yards gained.
- Target final ball spot.
- Predetermined tackler or sack credited to a player.
- Guaranteed touchdown.
- Guaranteed reception, interception or incompletion.
- Guaranteed blocking winner.
- Historical future trajectory.
- Predetermined timing or identity of the player who ends the play.

A called play may specify a route, blocking responsibility, handoff design or intended read. Those are football instructions, not guaranteed outcomes.

Invariant: Altering an unrelated historical outcome record must not affect an autonomous execution with the same pre-snap inputs and seed.

## 2. Scope of Stage One

Stage One has four implementation milestones. They must be delivered in order, each leaving a working and testable product.

| Milestone | Functionality | Deliverable |
| --- | --- | --- |
| 1A | Autonomous runtime and player decision framework | 22 players with individual behavior state and observability |
| 1B | Autonomous rushing | Inside zone left/right with blocking, cutbacks, pursuit and emergent tackles |
| 1C | Autonomous passing | Slant/flat quick pass with QB reads, pass protection, coverage and contested catches |
| 1D | Playable product and integration | 3D browser sandbox, replay/debug tools, tests and physical outcome record |

### Explicitly included

- 11 players per team.
- Pre-snap alignments.
- Offensive and defensive play selection.
- Individual assignments and reactive decision-making.
- Physical acceleration, turning and braking.
- Legal snap and ball possession transitions.
- Run blocking and block shedding.
- Defensive run fits and pursuit.
- Ball-carrier vision, lane selection and cutting.
- Contact-driven tackling and forward progress.
- QB pocket decisions and passing.
- Receiver routes and coverage.
- Catch, incompletion, interception and sack outcomes.
- Out-of-bounds and touchdown detection.
- Deterministic replay and diagnostic data.

### Explicitly outside Stage One

- Full autonomous playcalling across an entire game.
- Punts, kickoffs, field goals and safety kicks.
- Comprehensive penalty and officiating systems.
- Full fatigue, injury and substitution simulation.
- Online multiplayer.
- Reinforcement learning or self-play training.
- A learned neural movement policy.
- Claims of calibrated NFL prediction accuracy.
- Replacing the production Legendary Picks prediction models.

The Stage One engine must nevertheless expose a clean result interface so these features can be added without replacing its internal architecture.

## 3. Existing code and migration strategy

### Preserve

engine/world.js

- Existing World and Player classes.
- Existing physical profiles, force-limited locomotion and acceleration.
- Existing collision handling, block engagements and wrap forces.
- Existing 120 Hz simulation step.

engine/ball.js

- Existing ball movement and aerodynamic integration where applicable.

engine/rng.js

- Seeded deterministic random generation.

web/render.js

- Current Three.js renderer and player visuals.

engine/play.js

- Keep the historical and outcome-constrained reconstruction mode working unchanged.

web/week7-core.js

- Preserve the existing sampled-game generator and its legality/refusal behavior.

### Add a new executor

Suggested modules:

```
engine/
  autonomous/
    schema.js
    simulator.js
    setup.js
    observations.js
    agent.js
    offense.js
    defense.js
    assignments.js
    movement.js
    blocking.js
    ball-carrier.js
    quarterback.js
    passing.js
    contact.js
    possession.js
    officials.js
    recorder.js
web/
  autonomous-sandbox.js
autonomous.html
test/
  autonomous-schema.mjs
  autonomous-determinism.mjs
  autonomous-formation.mjs
  autonomous-run.mjs
  autonomous-pass.mjs
  autonomous-contact.mjs
  autonomous-rules.mjs
  autonomous-browser.mjs
```

These are logical module boundaries, not permission to create unnecessary abstractions. Consolidation is acceptable if it keeps the implementation simpler.

The existing physics classes should be reused. Add narrowly scoped hooks to World where necessary rather than developing another physics engine.

The autonomous executor must never invoke the outcome-constrained simulatePlay() as a hidden fallback.

## 4. Autonomous play input contract

Introduce a separate, explicitly versioned input.

```json
{
  "schema_version": "gridiron.autonomous-play.v1",
  "mode": "autonomous_from_snap",
  "play_id": "sandbox:inside-zone:1042",
  "seed": "1042",
  "situation": {
    "quarter": 2,
    "clock_seconds": 430,
    "down": 2,
    "yards_to_go": 6,
    "yardline_100": 45,
    "offense_direction": 1,
    "ball_lateral_yards": 26.67
  },
  "offense": {
    "team": "NE",
    "formation": "singleback_11",
    "call": {
      "family": "run",
      "concept": "inside_zone",
      "direction": "right",
      "snap_type": "under_center"
    },
    "lineup": {
      "QB": "qb_id",
      "RB": "rb_id",
      "LT": "lt_id",
      "LG": "lg_id",
      "C": "c_id",
      "RG": "rg_id",
      "RT": "rt_id",
      "TE": "te_id",
      "WR1": "wr1_id",
      "WR2": "wr2_id",
      "WR3": "wr3_id"
    }
  },
  "defense": {
    "team": "CHI",
    "call": {
      "front": "nickel_over",
      "coverage": "cover_3",
      "run_fit": "spill_force"
    },
    "lineup": {
      "LEDGE": "le_id",
      "LDT": "ldt_id",
      "RDT": "rdt_id",
      "REDGE": "re_id",
      "MLB": "mlb_id",
      "WLB": "wlb_id",
      "NB": "nb_id",
      "LCB": "lcb_id",
      "RCB": "rcb_id",
      "SS": "ss_id",
      "FS": "fs_id"
    }
  },
  "player_profiles": {}
}
```

player_profiles must contain the 22 referenced identities and their existing supported ratings and physics objects. All player identifiers must be unique.

### Required validation

Reject requests if:

- The lineup does not contain exactly 11 players on each side.
- A player appears on both teams.
- An identity or necessary movement parameter is missing.
- A physical parameter is non-finite or outside the engine's supported range.
- The formation is illegal for the supported play.
- The field position or attacking direction is invalid.
- The play or defensive call is unsupported.
- Any prohibited future-outcome field appears in the execution payload.

Do not silently ignore prohibited fields such as gain, endX, tacklers, complete or outcome_anchor.

Use separate configurations for immutable play calls, physical ability profiles and mutable simulation state.

No change to shared GRIDIRON-CONTRACT-v1.md in Stage One. This is a new standalone execution interface. Future integration with LP must be explicitly versioned.

## 5. Execution architecture

### Simulation pipeline

```
Validate pre-snap input
        |
        v
Create formation and assignments
        |
        v
Initialize 22 players + football
        |
        v
SNAP
        |
        v
Observe world state
        |
        v
Each agent selects intent
        |
        v
Physics applies movement and contact
        |
        v
Ball / possession state updates
        |
        v
Check football termination conditions
        |
        +---- Play still live ----> next physics step
        |
        v
Record final ball spot and result
        |
        v
Generate replay, events and statistics
```

### Update frequencies

| System | Initial frequency |
| --- | --- |
| Physics and collision integration | 120 Hz |
| Player strategic decisions | 10 Hz |
| Immediate collision and possession reactions | On event |
| Browser recording | 30 Hz |
| Visual rendering | Browser frame rate |

The 10 Hz decision interval is an initial engineering setting, not a claim that NFL players consciously decide at precisely that frequency.

Player movement must continue at 120 Hz between decisions using the latest selected intent.

### Determinism

The same input, player snapshots, model version and random seed must generate the same result and replay frames.

Use stable ordering of player IDs and deterministic RNG streams. Prefer player-specific or event-specific streams so adding unrelated instrumentation does not change every subsequent football outcome.

## 6. Agent architecture

Every player must have an individual AgentState.

```
{
  playerId,
  team,
  position,
  assignment,
  phase,
  currentAction,
  targetId,
  targetRegion,
  observationHistory,
  reactionDelay,
  decisionCooldown,
  confidence,
  lastDecisionTime
}
```

### Agent phases

PRE_SNAP
SNAP_REACTION
ASSIGNMENT_EXECUTION
READ_AND_REACT
BALL_IN_PLAY
CONTACT
POST_PLAY

### Required behavior interface

```
function decideAction({
  self,
  assignment,
  observation,
  gameContext,
  previousState,
  rng
}) {
  return {
    action,
    desiredVelocity,
    desiredFacing,
    targetId,
    targetRegion,
    updatedState
  };
}
```

Agents must output intent, not directly change world coordinates.

Valid actions include:

- HOLD_ASSIGNMENT
- STEP_TO_GAP
- BLOCK
- COMBO_BLOCK
- CLIMB
- SHED
- CONTAIN
- READ_RUN_PASS
- PURSUIT
- ATTEMPT_TACKLE
- FOLLOW_RUN_TRACK
- CUTBACK
- BOUNCE
- HANDOFF
- QB_DROP
- QB_READ
- THROW
- SCRAMBLE
- RUN_ROUTE
- COVER_MAN
- COVER_ZONE
- PLAY_BALL
- RECOVER_BALL

Implement only actions needed by the initial supported play families. Unsupported action requests should produce explicit diagnostics.

### Decision priorities

Evaluate in this order:

1. Immediate safety, possession or contact event.
2. Current football assignment.
3. Observed threat or opportunity.
4. Ability to execute the action physically.
5. Stability relative to the previous decision.

A player must not change targets every frame because another target becomes marginally closer.

Introduce decision persistence and bounded reaction delay. For ordinary continuous decisions, use a starting minimum commitment window of approximately 0.2 seconds, with immediate overrides for critical events such as acquiring the ball or being engaged.

### Perception

An agent may observe:

- Its own position, velocity and orientation.
- Teammates and opponents it can reasonably perceive.
- Current ball location or possession if observable.
- Nearby blocking and contact.
- The down, distance and field boundaries.
- Its own team's call and responsibilities.

An agent may not observe:

- The opposing team's hidden assignments.
- A future carrier path.
- A future catch location.
- A future tackle result.
- Final yardage or score.
- Tracking frames after the current simulated time.

Use a bounded position/velocity history to model reaction delays. The defense should react to actual run/pass cues rather than learning the offensive call from the input structure.

For Stage One, a simple deterministic perception model with positional awareness, a reaction delay and team-specific assignments is acceptable. Full visual occlusion is not required yet.

## 7. Team-level coordination

Players cannot operate as 22 unrelated steering agents.

Each side needs a shared tactical plan.

### Offensive plan

An offensive call defines:

- Initial formation.
- Snap type.
- Ball-carrier or eligible receiver roles.
- Blocking scheme.
- Initial route or run landmarks.
- QB read progression.
- Optional motion or fake.
- Player-specific responsibilities.

### Defensive plan

A defensive call defines:

- Front alignment.
- Defensive gap responsibilities.
- Edge containment.
- Run/pass read rules.
- Coverage responsibilities.
- Pursuit leverage.
- Blitz assignments, when applicable.

### Coordination principles

Initial assignments may be selected before the snap. Targets can change afterward.

For example, a right guard assigned a playside zone step can initially engage the defensive tackle, then release to a linebacker if the center successfully takes control of the double team.

Similarly, a weakside linebacker assigned backside pursuit should not immediately sprint to the RB's future location. He must read the play, preserve leverage and react when the flow is established.

Assignments are constraints on behavior, not scripts specifying exact movement for the entire play.

## 8. Milestone 1B: Autonomous rushing

### Initial playbook

Implement:

- inside_zone_left
- inside_zone_right

Initial formation:

- Singleback, 11 personnel.
- QB under center.
- One RB.
- One TE.
- Three WRs.
- Five offensive linemen.

Initial defenses:

- Nickel 4-2-5 over front.
- Nickel 4-2-5 under front.

The two defensive fronts should have meaningfully different player alignment and gap responsibilities.

Support attacking in either absolute field direction.

### 8.1 Offensive line responsibilities

For each of the five linemen, determine whether the player is:

- Covered by a defender.
- Uncovered.
- Responsible for a playside gap.
- Responsible for a backside cutoff.
- Eligible to assist on a double team.
- Eligible to climb to the second level.

Covered lineman:

1. Take the first zone step in the play direction.
2. Identify the defender threatening the assigned playside area.
3. Establish leverage and make contact.
4. Attempt to drive or seal the defender based on body position.
5. Maintain the engagement while it matters.
6. React to a lost block or defender disengagement.

Uncovered lineman:

1. Step toward the playside gap.
2. Assist the adjacent lineman if the defender threatens the gap.
3. Maintain combination-block leverage.
4. Release toward a second-level defender when the first-level block is controlled.
5. Select another nearby threat if the original assignment disappears.

The decision to climb must depend on actual block state and defensive positioning, not a preset release timestamp alone.

### 8.2 Tight end and receivers

TE:

- Block the designated edge or adjacent gap threat.
- Adjust to an unexpected defender entering the assigned area.
- Assist with edge containment when appropriate.

WRs:

- Identify defensive backs responsible for contain or pursuit.
- Stalk block within their assigned region.
- Avoid unnecessary collisions with teammates.
- Transition to pursuit or post-play behavior if possession changes.

Do not have all receivers run toward the ball immediately at the snap.

### 8.3 Quarterback and handoff

QB phases:

TAKE_SNAP
OPEN_TO_BACK
APPROACH_MESH
PRESENT_BALL
TRANSFER_BALL
CARRY_OUT_FAKE
POST_PLAY

The RB must physically reach a valid mesh position. The QB must have the ball.

A handoff completes only when:

- QB possesses the football.
- RB and QB are within a permitted exchange radius.
- Their relative movement allows a plausible exchange.
- The exchange has remained valid for the required brief contact interval.

Use the existing ball ownership state. Transfer possession atomically from QB to RB.

Do not set possession based solely on a predetermined timer.

The initial implementation should support handoffs that fail or become loose if the exchange cannot physically complete. Never teleport the RB or football to force a successful handoff.

### Handoff timing

The current comparison found a 0.72-second generated handoff against approximately 1.4 seconds in the cited historical sample.

Use the observed tracking to guide realistic alignment, QB opening movement and RB arrival at the mesh. Do not simply set all handoffs to 1.4 seconds.

The actual handoff timestamp must be determined by the participants reaching a valid exchange state.

### 8.4 Running back decision system

Before the handoff, the RB follows the called run track toward the mesh.

After possession, the RB evaluates:

- Intended playside gap.
- Adjacent gap.
- Backside cutback.
- Edge/bounce opportunity.
- Defender closing time.
- Offensive blockers occupying each lane.
- Actual open space.
- Forward progress.
- Path feasibility at current speed.

### Candidate lane representation

Represent a lane by a short-horizon reachable target region, not a fixed final ball spot.

Example candidates:

```
[
  "PLAY_SIDE_A",
  "PLAY_SIDE_B",
  "PLAY_SIDE_C",
  "BACKSIDE_A",
  "BOUNCE_OUTSIDE"
]
```

Each candidate is recalculated using current positions of actual linemen and defenders.

### Initial utility function

Use a simple, interpretable heuristic:

```
lane utility =
    forward_progress_value
  + open_space_value
  + blocker_leverage_value
  - defender_arrival_risk
  - path_obstruction
  - cut_difficulty
  - boundary_risk
```

All terms must be computed from present or past simulation state.

The exact weights are initial parameters, not validated NFL coefficients. Keep them configurable, seeded where randomness is necessary, and visible in debugging.

### RB action transitions

```
FOLLOW_DESIGNED_TRACK
        |
        v
READ_FRONT
        |
        +-- intended lane open --> PRESS_GAP
        |
        +-- backside open ------> CUTBACK
        |
        +-- edge open ----------> BOUNCE
        |
        +-- immediate contact --> BRACE / EVADE / DRIVE
        |
        v
RUN_DOWNFIELD
```

Prevent continuous lane oscillation with decision hysteresis. A cut is only allowed if physically feasible under the current turning and acceleration limits.

The RB must be capable of choosing a lane different from the initially designed hole without receiving an endpoint from the game script.

### 8.5 Defensive line

Each defensive lineman starts with:

- Gap assignment.
- Edge or interior responsibility.
- Initial target area.
- Block recognition state.
- Shed priority.

Required behaviors:

- Attack or maintain the assigned gap.
- Engage the responsible blocker.
- Resist displacement.
- Attempt to shed when leverage allows.
- Maintain edge contain when assigned.
- React to the RB entering the player's area.
- Pursue after disengagement.

Do not preassign a specific defender to be the successful tackler.

### 8.6 Linebackers

Linebackers must have a meaningful run-read sequence.

```
INITIAL_GAP_RESPONSIBILITY
        |
        v
READ_OFFENSIVE_LINE
        |
        v
DETERMINE_FLOW
        |
        +-- playside run --> FILL_GAP
        +-- cutback -------> SCRAPE_BACKSIDE
        +-- outside run ---> FORCE / CONTAIN
        +-- play breaks ---> PURSUE
```

Inputs include actual offensive line displacement, blocker engagement and visible ball movement.

Their acceleration and pursuit angle must reflect their current position, not a predetermined intercept point taken from historical tracking.

### 8.7 Defensive backs

For inside-zone runs:

- Maintain initial coverage or force assignment.
- Recognize the run after a plausible reaction delay.
- Preserve assigned outside/inside leverage.
- Transition into pursuit when appropriate.
- Attempt tackles when able.
- Avoid unnecessarily abandoning deep coverage before the run is established.

Safeties should typically react from deeper positions. Cornerbacks should respect their edge or coverage responsibility rather than uniformly charging the center.

## 9. Blocking and disengagement

Reuse World.engage() and World.disengage().

A block must be represented as an interaction state:

```
APPROACH
   |
   v
CONTACT
   |
   v
ENGAGED
   |
   +-- blocker advantage --> DRIVE / SEAL
   |
   +-- defender advantage -> SHED / PENETRATE
   |
   v
DISENGAGED
```

### Required inputs

- Actual relative position.
- Relative velocity.
- Mass.
- Leverage and facing.
- Existing strength/blocking attributes.
- Current movement and traction.
- Contact duration.
- Whether the relevant assignment is still active.

### Required outputs

- Engagement start.
- Engagement end.
- Displacement.
- Defender penetration or containment.
- Blocker losing or maintaining leverage.
- Defender becoming free to pursue.

A blocker must not automatically win because a scripted outcome needs an open hole.

A defensive player must not automatically shed because the script needs a tackle.

Player ratings may influence behavior and probabilistic contests, but existing 0-99 ratings must not be interpreted directly as measured physical forces.

Log the actual engagement and shed events.

## 10. Pursuit and tackling

### 10.1 Pursuit

Defenders should target an estimated interception region based on:

- Current carrier position.
- Carrier velocity.
- Defender position.
- Defender velocity and acceleration.
- Open pursuit angles.
- Other defenders' leverage.
- Current assignment.

They should not simply seek the RB's exact instantaneous position at every frame.

Use a short-horizon pursuit estimate and update it as the carrier moves.

### 10.2 Tackle eligibility

A tackle attempt is possible only when:

- Defender and carrier are opponents.
- The carrier has actual possession.
- They are within a valid physical contact or reach region.
- Defender is not down or otherwise unable to attempt a tackle.
- The player has not already committed to an incompatible contact state.

A collision does not automatically result in a successful tackle.

### 10.3 Tackle contest

Resolve the contest using:

- Relative approach speed.
- Contact angle.
- Mass and momentum.
- Defensive tackling ability.
- Ball-carrier balance, strength and evasion.
- Existing engagement or stumble state.
- Additional arriving defenders.

Possible outcomes:

MISSED_CONTACT
GLANCING_CONTACT
WRAP_ATTEMPT
BROKEN_TACKLE
SUCCESSFUL_TACKLE
ASSISTED_TACKLE

Use seeded stochastic behavior only where the simplified physical model cannot resolve the contest deterministically. Make those probabilities inspectable and versioned.

### 10.4 End-of-play condition

A successful tackle must produce an actual down state. It cannot just increment a tackle counter while the runner continues running.

A player is down when the simplified contact/body model reaches a supported termination condition, such as:

- Successful wrap and loss of upright balance.
- Stable grounded state following contact.
- Additional defender contact completing an assisted tackle.

The carrier's final spot must be based on observed ball position and applicable forward progress.

### 10.5 Forbidden behavior

Remove these mechanisms from autonomous mode:

- Using st.endX to choose when to allow a tackle.
- Moving the carrier to an expected yard line during the tackle.
- Waiting at the intended end spot for a designated defender.
- Forcing the nearest defender to finish a play because the scripted duration expired.
- Treating an intended touchdown as proof that the ball crossed the goal line.

The existing reconstruction mode can retain these behaviors with its constrained-replay labeling.

## 11. Ball possession and play termination

Implement one authoritative local ball/possession state machine for the autonomous executor.

### Ball states

READY_FOR_SNAP
SNAPPED
HELD
HANDOFF_IN_PROGRESS
IN_FLIGHT
LOOSE
DEAD

A ball must not have two holders simultaneously.

Every possession transition must create an event recording:

- Time.
- Previous holder.
- New holder.
- Ball state.
- Cause.
- Actual ball location.

### Supported termination events

| Event | Trigger | Result |
| --- | --- | --- |
| Tackle | Carrier brought down through supported contact | Spot using forward-progress rules |
| Out of bounds | Live carrier/ball crosses the legal boundary | Dead-ball spot |
| Touchdown | Possessed ball crosses opponent's goal plane | 6-point touchdown outcome |
| Fumbled exchange | Ball becomes loose during snap/handoff | Continue live-ball recovery if supported |
| Fumble recovery | Eligible player legally gains the loose ball | Continue or end under applicable rules |
| Incomplete pass | Forward pass contacts ground without catch | Return to previous line, down advances |
| Interception | Defender secures legal catch | Defensive possession, return may continue |
| Sack | QB with ball brought down behind/near LOS | Spot and loss of down |
| Technical failure | Numerical failure or unresolved unsupported condition | No fabricated football result |

### Forward progress

Track the possessed ball's longitudinal coordinate throughout contact.

When a defender controls or drives the runner backward, determine the legal forward-progress spot from the supported contact state, not merely the runner's final body-center location.

Stage One may use an explicitly labeled approximate forward-progress model, but it must be deterministic, physically connected to observed contact, and independent of any desired gain.

### Clock

Record the actual simulated live-play duration.

Do not infer the full game-clock runoff from the physical action alone. A future LP game-state reducer will handle the snap-to-snap interval, clock rules, administration, huddle and play clock.

## 12. Milestone 1C: Autonomous passing

Once autonomous rushing works, extend the same agents and execution loop to one quick-pass family.

### Initial passing concepts

Offense:

- slant_flat_right
- slant_flat_left

Defense:

- Cover 1 man.
- Cover 3 zone.

Preserve the nickel defensive personnel for the first version.

### 12.1 Receiver behavior

Receivers must:

1. Align correctly.
2. Release at the snap.
3. Follow their assigned route landmarks.
4. Accelerate and cut within physical limits.
5. React to defensive contact or obstruction.
6. Adjust toward a live thrown ball when appropriate.
7. Attempt a catch only when physically reachable.
8. Transition into ball-carrier or pursuit behavior after the result.

Routes may have prescribed stems and breaks. They must not have guaranteed catch locations.

### 12.2 Quarterback behavior

QB states:

RECEIVE_SNAP
DROPBACK
READ_FIRST_OPTION
READ_SECOND_OPTION
CHECK_PRESSURE
THROW / SCRAMBLE / TAKE_SACK / THROW_AWAY

The QB must select a target from observations, not from a preselected completed-pass label.

At each decision point, evaluate:

- Receiver separation.
- Coverage leverage.
- Estimated throwing window.
- Defender interception opportunity.
- Pocket pressure.
- Time remaining before a likely sack.
- Down, distance and relevant field position.
- Available checkdown.

A simple initial utility function is sufficient:

```
throw utility =
    open_window
  + completion_opportunity
  + expected_forward_value
  - interception_risk
  - throwing_difficulty
  - pressure_risk
```

The QB may choose a less valuable but safer checkdown when pressure is high.

If no throw is viable, the QB may continue holding the ball, move in the pocket, scramble or throw away when legal.

### 12.3 Pass protection

Offensive linemen should create a coherent pocket rather than chase independent defenders.

Required behaviors:

- Establish initial pass set.
- Preserve inside leverage.
- Pick up assigned rushers.
- React to a freed rusher.
- Hand off or assist against movement when supported.
- Avoid leaving an immediate inside threat to pursue a distant defender.

Pass rushers should attempt to penetrate, bend around the edge or shed existing engagements according to their roles and physical capability.

Sacks must result from the QB being physically reached while possessing the ball.

### 12.4 Throw and catch

When the QB elects to throw:

1. Select an actual receiving target.
2. Calculate a reachable throwing aim based on observed receiver motion.
3. Apply release timing and physical throwing limits.
4. Launch the football using the existing ball-flight system.
5. Update receiver and defender reactions.
6. Resolve the first valid catch, deflection, interception or ground contact.

A receiver or defender must be within a supported catch/reach volume while the ball is at an appropriate height. Resolve contested catches using position, timing, ball security and relevant abilities.

The throw must not be re-aimed in flight to guarantee success.

Use an explicitly approximate reach and catch model because the current physics engine does not yet simulate full articulated hand and body contact.

### 12.5 After the catch

A successful receiver becomes the actual ball carrier and uses the same:

- Lane evaluation.
- Defensive avoidance.
- Blocking interactions.
- Pursuit.
- Contact.
- Forward-progress resolution.

An intercepted pass must switch possession and allow a defensive return, subject to supported live-play termination rules.

## 13. Movement and physical execution

Reuse existing Player.locomote() behavior.

Every agent provides desired velocity and facing. The physics world resolves whether the player can actually reach that target.

### Requirements

- Players cannot instantaneously change direction.
- Players cannot exceed their physical movement limits through ordinary locomotion.
- Initial acceleration must take time.
- High-speed cuts must require braking and lateral acceleration.
- Bodies cannot freely pass through one another.
- Engagements must affect movement.
- Contact impulses must not cause numerical instability.
- The ball must remain attached to its holder or follow a valid flight/loose-ball state.

### Collision handling

Retain the existing planar contact engine for Stage One unless an actual blocker prevents acceptable execution.

Do not replace it with Rapier or Jolt simply because those engines exist.

If existing contact resolution cannot reliably handle the required autonomous interactions, isolate the failing case and evaluate the smallest compatible solver improvement or established physics component.

No broad physics-engine rewrite is authorized by this specification.

## 14. Autonomous output contract

Return a complete, inspectable record.

```js
{
  schema_version: "gridiron.autonomous-result.v1",
  mode: "autonomous_from_snap",
  play_id,
  seed,
  status: "complete",
  result: {
    event: "tackle",
    possession_team: "NE",
    carrier_id: "rb_id",
    yards_gained: 4.2,
    is_touchdown: false,
    turnover: false,
    final_ball_spot: {
      x_yards: 59.2,
      y_yards: 27.1
    },
    elapsed_seconds: 5.4
  },
  participants: {
    tacklers: ["mlb_id"],
    blockers: [],
    carrier_id: "rb_id"
  },
  events: [],
  trajectory: {
    roster: [],
    frames: [],
    stride: 138,
    t0: 0,
    hz: 30
  },
  diagnostics: {
    agent_decisions: [],
    physical_warnings: [],
    result_provenance: "generated_from_agent_actions_and_physics"
  }
}
```

The example values are illustrative, not acceptance targets.

Use the existing rendering record layout where practical: 22 players with six recorded values each, plus six ball values, for a stride of 138.

### Output requirements

Every completed result must reconcile against:

- Actual ball ownership.
- Final ball position.
- Event chronology.
- Tackler and contact events.
- Frame timestamps.
- Actual play duration.

Do not emit valid_full_game=true. Stage One generates individual plays, not verified complete games.

status must distinguish a completed simulation from an unsupported or numerically failed execution.

A failed simulation must not fall back to a scripted result.

## 15. Browser product

Add a dedicated autonomous sandbox accessible from a standalone browser page.

### Controls

- Select offensive team and lineup.
- Select defensive team and lineup.
- Select run/pass concept.
- Select defensive front or coverage.
- Select starting field position.
- Enter a random seed.
- Snap/play.
- Pause/resume.
- Step through frames.
- Change camera.
- Restart the same seed.
- Generate a different seed.

### Required views

Main field: 3D rendering of all 22 players and ball.

Play information: offensive call, defensive call, down/distance, time and final outcome.

Player inspector: selected player's identity, assignment, current action, target and relevant abilities.

Debug overlays:

- Offensive blocking assignments.
- Defensive gaps and responsibilities.
- RB candidate lanes.
- Defensive pursuit targets.
- Current ball possession.
- Engagement and tackle states.

Debug overlays must be independently toggleable and off by default for ordinary viewing.

### Replay behavior

A simulation must generate its result independently of the visual renderer. The renderer reads recorded frames and events.

Replaying the same result must not rerun the model or produce a different outcome.

The user should be able to compare two seeds with the same formation and personnel to observe different football decisions and results.

### Failure presentation

If a simulation fails, show the actual cause.

Do not display a fictional final score, touchdown or yardage.

## 16. Tests and acceptance criteria

### 16.1 Determinism

Given identical input, seed and version:

- Same outcome.
- Same play-ending time.
- Same participant event sequence.
- Same trajectory frames.
- Same recorded decision trace.

Changing the seed may change contested actions and results.

### 16.2 No future-outcome leakage

Build automated tests that reject prohibited input fields.

Explicitly test:

- gain
- endX
- endY
- tacklers
- sackers
- complete
- touchdown
- interceptor
- outcome_anchor
- Future tracking frames.

No autonomous module may read the prior reconstruction director's expected final spot.

### 16.3 Formation and personnel

For every supported play:

- Exactly 22 unique players initialize.
- Exactly 11 are assigned to each team.
- Correct offense/defense orientation.
- No illegal duplicate player.
- Ball is at the valid line of scrimmage.
- Initial alignment does not contain destructive player overlap.

Test both attacking directions.

### 16.4 Handoff and possession

Test:

- Normal completed handoff.
- RB delayed reaching the mesh.
- QB/RB physically separated.
- QB initially missing possession.
- Unsupported failed exchange.
- Ball loose and subsequently recovered.

For a completed handoff, there must be exactly one actual transfer from QB to RB.

No possession may be assigned to a player merely because that player was the designated runner.

### 16.5 Blocking

Create deterministic geometry fixtures for:

- Covered lineman vs adjacent defender.
- Uncovered lineman assisting.
- Combination block and release.
- Defender penetrating a failed block.
- Defender successfully shedding.
- Backside cutoff.
- Run direction reversed.

In each fixture, verify the actual events and resulting player positions.

### 16.6 RB intelligence

Create controlled scenarios:

| Situation | Expected behavioral property |
| --- | --- |
| Playside B gap open | RB initially favors designed lane |
| B gap blocked, backside A gap open | RB can select cutback |
| Inside congested, outside edge open | RB can bounce if physically reachable |
| Unblocked defender directly ahead | RB does not blindly run through defender |
| Two nearly equal lanes | RB avoids rapid left/right oscillation |
| Defensive front changes | Decisions and/or resulting movement respond |
| Different RB physical abilities | Actual acceleration and cuts differ |

These tests verify behavior, not a guaranteed number of rushing yards.

### 16.7 Defensive intelligence

Test:

- Correct initial gap responsibility.
- Run recognition after plausible observation.
- Playside filling.
- Backside pursuit.
- Edge containment.
- Block shedding.
- Pursuit angle adjustment.
- Actual contact required for tackle attempts.

A designated defender who is moved away from the play must not still receive a tackle by script.

### 16.8 Tackle and spot accuracy

Test:

- Open-field tackle.
- Glancing contact without tackle.
- Broken tackle.
- Assisted tackle.
- Tackled behind the line.
- Carrier driven backward after contact.
- Runner stepping out of bounds.
- Ball crossing the goal line.

Assert that the final spot is computed from the observed physical events and supported football rules.

No end-of-play coordinate correction toward a desired result is permitted.

### 16.9 Passing

Test:

- Open first read.
- Covered first read, open checkdown.
- Immediate pass pressure.
- QB sack.
- Receiver separation.
- Defensive interception opportunity.
- Incomplete pass.
- Contested reception.
- Catch followed by an emergent tackle.

A historically labeled completion must not be an input to these tests.

### 16.10 Batch simulation

Run a frozen collection containing:

- Both run directions.
- Both supported fronts.
- Both attacking directions.
- Quick pass against Cover 1 and Cover 3.
- Different player ability combinations.
- At least 200 total deterministic play executions.

Report:

- Completed-play rate.
- Unsupported and technical-failure counts.
- Final outcome distribution.
- Yards gained distribution.
- Run duration.
- Handoff timing.
- First contact and tackle timing.
- Blocks and sheds.
- Contact-driven vs unsupported play endings.
- Movement warnings.
- Execution time.

Engineering acceptance: All supported fixture cases pass; no invented terminal results; no NaN or non-finite physics states; no duplicate players or simultaneous ball holders. Target at least 99% legal completion on the frozen supported-scenario suite, with every remaining failure named and inspected.

The 99% target is a Stage One product reliability gate, not a statistical claim about NFL realism. Do not weaken tests or silently resample failures to reach it.

### 16.11 Different inputs must have meaningful effects

Across matched-seed batches, compare:

- Stronger run blocking vs weaker run blocking.
- Faster RB vs slower RB.
- Better defensive gap discipline vs worse.
- Faster pursuit vs slower.
- Different defensive fronts.
- Different coverage and pass protection.

Require evidence that the resulting decisions and distribution respond in plausible directions.

Do not require every individual seed to produce a better result for the stronger player or team.

### 16.12 Regression suite

The following must remain passing:

```
npm test
npm run test:week7
npm run test:ui
```

Add:

```
npm run test:autonomous
```

test:autonomous must execute without requiring the browser for deterministic engine tests. Provide a separate browser acceptance test.

## 17. Real NFL movement comparison

Stage One is primarily a product implementation milestone. Real tracking evaluation is still required before claiming NFL-level realism.

Use the existing 2022 Big Data Bowl tracking joins and Gridiron trajectory inventory.

Track:

- Player displacement after 0.5 seconds.
- Player displacement after 1.0 second.
- Position and velocity differences by role.
- Spacing between offensive and defensive units.
- RB location relative to the line and intended run gap.
- Handoff timing.
- Line penetration.
- Defensive pursuit and nearest-defender separation.
- Physical feasibility of acceleration and cutting.

Where available, compare full-play trajectories and contacts, not merely the first second.

Keep historical outcomes and post-snap tracking strictly separate from autonomous policy inputs.

Weeks 6-9 of the existing 2022 cohort must not be reused for iterative tuning if they remain the designated final holdout.

Do not hold up the first playable browser implementation for a new machine-learning study. The purpose of the comparison is to reveal concrete behavior defects and prioritize code fixes.

## 18. Integration with Legendary Picks

Stage One is a separate, physically generated single-play execution mode.

Legendary Picks currently supplies sampled game outcomes to Gridiron through the existing shared full-game contract. That behavior must continue working.

Do not silently replace sampled LP outcomes with new physically generated results.

Future integration should follow this direction:

```
LP game state
    |
    v
Offensive and defensive calls
    |
    v
Gridiron autonomous 22-player simulation
    |
    v
Physically generated play outcome
    |
    v
LP rules/state reducer
    |
    v
Next down, drive and game state
```

That future interface requires explicit ownership of play outcome authority and versioned changes to the cross-repository contract.

Until then:

- Historical reconstruction remains reconstruction.
- Week 7 sampled playback remains sampled playback.
- Autonomous Stage One remains autonomous single-play generation.
- Results must never be mixed without provenance.

This preserves the existing product while creating the engine we need for future fully emergent games.

## 19. Implementation order

### Milestone 1A: Runtime

Deliver:

1. Input schema and validator.
2. Independent simulateAutonomousPlay() entry point.
3. 22-player formation initialization.
4. Agent state and observation pipeline.
5. Deterministic decision scheduler.
6. Physics stepping and recording.
7. Initial browser playback of a snap with coordinated movement.

Gate: 22 distinct agents execute assignments without reading a future result.

### Milestone 1B: Running

Deliver:

1. Offensive inside-zone assignments.
2. Dynamic run blocking.
3. Defensive fronts and run fits.
4. QB/RB mesh and ball transfer.
5. RB lane selection and cutbacks.
6. Pursuit and contact-driven tackling.
7. Forward progress, sidelines and goal-line resolution.
8. Browser-playable rushing play.
9. Regression and matched-seed batch results.

Gate: The system completes multiple rushing plays with different real outcomes and without any predetermined gain or tackler.

### Milestone 1C: Passing

Deliver:

1. Slant/flat receiver routes.
2. Cover 1 and Cover 3 assignments.
3. Pass protection and pass rush.
4. QB reads and target selection.
5. Physical ball flight.
6. Catch, incompletion and interception.
7. Sacks and post-catch ball carrying.
8. Regression and matched-seed batch results.

Gate: The system can generate successful and failed passes from live player interactions.

### Milestone 1D: Product completion

Deliver:

1. Standalone autonomous.html page.
2. UI controls for calls, matchups and seeds.
3. Replay, pause, slow motion and camera controls.
4. Player AI inspector and optional debug overlays.
5. Result and event reporting.
6. Frozen batch simulation report.
7. Final automated acceptance suite.
8. Documented integration boundary for the future LP game reducer.

Gate: A user can choose the two teams, call a supported play, press Snap, watch the 22 players execute football, and inspect the resulting yards and events without an outcome having been supplied beforehand.

## 20. Engineering constraints

- Work in an isolated branch/worktree.
- Inspect current branch ownership and uncommitted changes before editing.
- Read repository AGENTS.md and preserve active integration rules.
- Do not overwrite other agents' work.
- Do not alter shared contract-v1.
- Do not change LP production predictions, locks or grading.
- Do not introduce a new physics engine without a demonstrated need.
- Do not train an LLM for real-time player control.
- Do not write another architecture-only research report in place of working code.
- Do not merge or deploy automatically.
- Keep a compact implementation log containing changed files, test results, failures and exact commit SHA.

Use deterministic heuristic/utility AI first. Learned player policies belong in Stage Two, after Stage One supplies a functioning environment in which decisions can be evaluated.

## 21. Final Stage One acceptance test

The product owner must be able to do the following:

### Run example

1. Open the autonomous football sandbox.
2. Select NE offense versus CHI defense.
3. Choose inside zone right.
4. Choose a nickel over defensive front.
5. Set the ball near midfield and select seed 1042.
6. Press Snap.
7. Watch all 22 players move according to their assignments and observations.
8. Watch the RB receive the handoff and select a lane.
9. Watch blocks succeed or fail.
10. Watch defenders react and attempt tackles.
11. See the play end at the actual resulting spot.
12. View the generated yardage, tackler, event log and replay.

Then change only the defensive front or random seed and run the play again.

The simulation must be capable of producing a different path, different blocking interactions, different tackler and different gain.

Repeat for a quick-pass concept, with the QB selecting a target and the pass result determined by physical execution and player decisions.

Stage One is complete only when both rushing and passing satisfy these requirements without predetermined outcomes.

### Required final engineering report

Report:

- Implemented capabilities.
- Exact files and commits.
- Tests run and results.
- Supported and unsupported play variants.
- Frozen-batch completion rate.
- Distribution of autonomous rushing and passing outcomes.
- Known realism limitations.
- Evidence that final outcomes are not supplied to player AI.
- Browser entry point and instructions for running it.
- Remaining blockers to full-game autonomous integration.

Do not substitute a research proposal, animation demo or scripted-play replay for this deliverable.

Final directive: Build a working football simulation engine where the players' decisions and interactions cause the play result.
