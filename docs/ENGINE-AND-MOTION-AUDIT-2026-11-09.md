# Engine and player-motion audit (2026-11-09)

Scope: the 3D engine, player movement and the rigged-player animation, judged for NFL realism and common sense. Everything here was measured on the current branch (`feat/rigged-animation-controller`) unless marked "read only". Fixed items are in commits on that branch; nothing is pushed.

## 0. Two tracks: read this first

Gridiron Physics has two separate tracks, visible separately in git history.

| | Replay track | Simulation track |
| --- | --- | --- |
| Started | 2026-10-16, "Mile High Film Room: physics reconstruction of SEA @ DEN" | 2026-10-25, "Adopt Codex autonomous inside-zone POC as Stage One base" |
| What it is | Replays plays that already happened, or LP-sampled outcomes, as 3D physics | The engine runs its own simulations; outcomes are independently determined |
| Code | `engine/play.js`, `web/week7.js`, `web/app.js` | `engine/autonomous/*`, `engine/autonomous-run.js`, `web/autonomous.js` |
| Outcome | **Anchored**: the sampled gain, end spot and tacklers steer the play | Not anchored; gated by realism assertions (commit `42f0c3b`, `docs/FOOTBALL-REALISM-ASSERTIONS-TODO-2026-10-30.md`) |

Consequence for this audit: most oddities I found in `engine/play.js` are anchoring side effects, not bugs in a simulation. The autonomous engine has not been audited here beyond running its existing tests (they pass).

## 1. Measured findings

### Straight-line speed and acceleration: fine
40-yard times implied by the engine's force-velocity model (replay track), against combine times:

| Position | Engine 40 yd (s) | NFL combine (s) |
| --- | --- | --- |
| WR | 4.39 to 4.74 | 4.40 to 4.60 |
| CB | 4.50 to 4.67 | 4.40 to 4.55 |
| RB | 4.55 to 4.78 | 4.45 to 4.65 |
| TE | 4.72 to 4.98 | 4.6 to 4.8 |
| LB | 4.55 to 5.28 | 4.55 to 4.8 |
| DT | 4.79 to 5.31 | 4.85 to 5.2 |
| OL (OT, G, C) | 4.97 to 5.66 | 5.0 to 5.4 |

Top speeds by position are plausible for skill players (WR 9.3 to 10.2 m/s) and about 0.5 m/s high for linemen (OT 7.7 to 8.7 against roughly 6.5 to 7.8 real). Minor; not changed.

### Replay track: behavior problems found

| # | Finding | Status |
| --- | --- | --- |
| 1 | Ball carriers capped at exactly 5.0 m/s in 10 of 12 runs. `carryBrain` steered to every waypoint with `seek(..., decel 2.5)`, which limits speed to sqrt(2 x 2.5 x d), so he braked toward each waypoint. Defenders run 9+ m/s. | Fixed: intermediate waypoints no longer brake. Carrier peak is now 7.3 m/s on a 15-yd gain and 9.2 m/s on a 30-yd gain. |
| 2 | After reaching the sampled end spot the carrier milled around it for about 3 s at 0.3 to 3 m/s while defenders bounced off him. The tackle test used an absolute distance, so a touch never counted once he was a few yards past the spot. | Fixed: signed distance, so a runner who has reached or passed the spot goes down on the first touch; converging tacklers start after 0.3 s. |
| 3 | Braking into the anchored end spot: a 9 m/s runner stopped dead in the open field with the nearest defender yards behind. | Mitigated: he now eases down over the last 12 yd to about 60% speed. **Still open by design**: the sampled outcome says where he is tackled, so he must end near there. A real fix is to plan the pursuit so a defender intercepts at the sampled spot at speed (choreographed intercept), not to slow the runner. |
| 4 | Every play began with a free 0.9 s running start: players ran their assignments before the snap (linemen at 4+ m/s in a stance pose, blocks landing pre-snap). | Fixed earlier (`holdPreSnap`, default on). Run plays shift about 0.1 yd, passes about 1.6 yd. |
| 5 | Field goal: the kicker lined up directly behind the holder, on the same side, and ran through him. | Fixed: holder beside the kick line, kicker approaches from the other side, no contact between them. |
| 6 | Kickoff: the kicker hit the ball at a full sprint (6 m/s) and kept sprinting through his kick. | Fixed: he eases to about 3.5 m/s into the ball and finishes the kick (0.8 s) before sprinting. |
| 7 | A missed tackler goes to the ground (`broken_tackle`). This is why the kickoff kicker dives at the returner and falls. | By design; not changed. If you want him to wrap up and make the tackle, that is an engine change. |
| 8 | Downed players do not collide with anyone, so bodies overlap in piles. | Display-only fix in the renderer (separation pass). The simulation is unchanged. |
| 9 | The engine is planar for players: discs with position, velocity and heading only. No vertical motion, no body orientation, no ragdoll. Tackles and falls are drawn from pose codes. | Open. Limits how real contact can look. |
| 10 | Replay frames carried 6 floats per player; renderers had to guess. | Added an optional `aux` channel (velocity, contact role, partner) and `kindGroup`. |

### Animation: problems found

| # | Finding | Status |
| --- | --- | --- |
| 1 | `FB_Kick` bent the elbow backward in 37% of frames (down to -125 degrees) and `FB_Punt` in 17% (down to -42). My two-bone IK chose the elbow direction from a hint and ignored the elbow's real hinge, so the forearm folded the wrong way and the arm twisted. | Fixed: hinge-aware IK. The elbow axis is read from the model's rest pose; the upper-arm roll is solved so the bend is always flexion about that axis. Both clips now bottom out at +4 degrees. No authored clip bends backward. |
| 2 | Kick and punt held the arms straight out at the sides (crucifix pose). | Fixed: a normal counter-swing, kicking-side arm back across the body, opposite arm out and bent. |
| 3 | The kicker's KICK pose stays latched; the controller held a finished clip's last frame (standing straight) while he ran 30 yd. | Fixed: kick clips are timed to the engine's `kick` event; a latched KICK code is just running. |
| 4 | The stock idle clasped the hands at the belt, read as hands behind the back. | Fixed: authored `FB_Idle`. |
| 5 | Stock `Fist Pump` and `Kneel` had both hands behind the hips. | Fixed: arms baked off the body. |
| 6 | Jersey number was a floating plane behind the back. | Fixed: painted into the jersey texture, front and back. |

## 2. Not yet audited
- The autonomous (simulation) engine code beyond its passing tests: route running, QB perception, coverage and pursuit logic.
- Punts and punt returns in play (the punt clip is authored but I did not watch a punt play), pass rush, QB scrambles, goal-line and out-of-bounds behavior.
- The ball: flight, drag and bounce were read and look physically sound (drag, shooting-method launch, seeded bounce); not compared to tracking data.

## 3. What it takes to reach the Furnace reference level for player movement

What I could judge from the reference video (stills, plus a 6-second replay at 5 fps) is in `REFERENCE-VIDEO-FURNACE-VS-GRIDIRON-2026-11-09.md`. I cannot see its engine, only what it draws, so this list is what the drawn result implies.

Shared by both tracks (animation and rendering):
1. **Football-specific clip library** on a consistent rig: stiff-arm, juke and cut, swim and rip pass-rush moves, get-up, QB drop-back with the ball, throw and catch variants (over-shoulder, one-hand, diving), several tackle types. We have 16 authored clips; the reference clearly has many more.
2. **Paired animation for contact.** Tackles, blocks and piles need two bodies animated together (matched start, contact point and fall), not two solo clips. The replay `aux` channel already carries role and partner; it needs contact point and impulse direction.
3. **Locomotion blending:** speed and direction blend, turn and cut lean, acceleration lean, and foot IK so planted feet do not slide. Today clips are chosen by speed tier and stride-matched, which still slides at slow speed.
4. **Player model and kit:** pants stripes, socks, team-colored cleats and gloves, wristbands, helmet decals, better proportions. The model is a free asset with a custom-painted uniform atlas.
5. **Rendering polish:** soft contact shadows, depth of field on replay cameras, a low sideline replay camera.

Specific to the replay track (anchored outcomes):
6. **Choreographed intercepts.** Players have to look fast and decisive while still ending the play at the sampled spot. That means planning the tackler's approach so contact happens at speed at the spot, instead of braking the runner.

Specific to the simulation track:
7. **The behavior itself:** formation and coverage logic (the reference names Cover 3, Cover 2 and so on), route running with real breaks, pursuit angles, blocking schemes. Calibrate to the NFL tracking data this repo already researches (speed, acceleration and cut distributions), and extend the existing realism assertions to cover movement.
8. **Record richer state** (velocity, orientation, contact, ball hand) so animation does not have to guess. The autonomous engine builds its own frames and does not yet write the `aux` channel.

Suggested order: 1 and 2 (they unlock the most visible gap), then 3 and 4, then 6 or 7 depending on which track is the priority.
