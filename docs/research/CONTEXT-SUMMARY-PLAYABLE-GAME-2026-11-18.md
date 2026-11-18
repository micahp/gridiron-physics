# Context summary: playable football game, 2026-11-18

Purpose: a reference for the playable college football prototype work done on 2026-11-18. It records what was built,
what was checked, what was decided and what is still open. The code lives on the branch; this file is the only thing
from that work on `main`.

## 1. Repository and state

| item | value |
|---|---|
| repository | `micahp/gridiron-physics` |
| branch | `feat/rigged-animation-controller` (pushed) |
| worktree | `gp-animctl` |
| commits | `a5ec642` playable prototype, `e475e34` sprite-stacked voxel players, `bd81bfc` smooth skinned players, hands, paired tackles, hand-held ball |
| main | not merged. Only this summary was committed to `main`. |
| untracked | `_closeup.mjs` (the user's file), left as found |

Run it: `python scripts/dev-server.py 8160 .` in the worktree, then open `play.html`. Test pages: `meshlab.html` (mesh
vs voxel side by side), `tacklelab.html` (every paired tackle), `stacklab.html` (voxel actions).

## 2. Status at a glance

| workstream | status |
|---|---|
| Playable game (run, pass, juke, stiff arm, sacks, scoring, clock) | working; desktop and touch input |
| Player model | smooth skinned mesh built from scratch is the default; voxel (`?stack`) and the old rigged model (`?rig`) remain |
| Hands | gloved palm, taped cuff, four two-jointed fingers and a thumb, grip set per action |
| Tackles | paired, Madden 2006 style; outcome is still a probability roll |
| Ball | held in the hands, released from the hand, spirals nose-first, homes into the catcher's hands, bounces |
| Performance | 60 fps, 22 players, sun shadows, headless desktop Chrome; **not measured on a phone** |

## 3. What changed during the day, in order

1. **Rigged model (start of day).** The playable game used the downloaded rigged model ("American Football Player",
   Hikky, CC BY 3.0) with retargeted mocap clips. The user found the animation unconvincing.
2. **Sprite stacking from scratch (`e475e34`).** A new skeleton (`web/stack/skeleton.js`), a body made of signed-distance
   shapes (`web/stack/body.js`), 33 actions authored by hand (`web/stack/actions.js`) and a voxel sprite-stack renderer.
   Omni-directional locomotion picks forward, backpedal or shuffle from velocity against facing. The stiff-arm hand was
   turned palm-up at the user's request.
3. **Why it animated better.** The improvement came from owning the skeleton, body and every action, not from voxels:
   no third-party skin weights, actions written for football, low resolution hiding small errors.
4. **Smooth mesh (`bd81bfc`).** The same body shapes are turned into one surface with surface nets
   (`web/mesh/body-mesh.js`). Skin weights come from distance to each shape. Poses are evaluated live every frame, so
   there are no baked frames and actions crossfade. Triangle count is set by the grid: 1.6 cm about 30k (desktop default),
   2.2 cm about 15k (phones). Hands get a separate fine pass (about 3 mm).
5. **Paired tackles and ball contact (`bd81bfc`).** See sections 4 and 5.

## 4. Tackles (`web/mesh/tackles.js`, `web/play/game.js`)

- **What Madden 2006 did.** It used no contact physics. It used paired tackle animations chosen by approach angle and
  speed, with both players aligned to the clip. Outcomes came from ratings. This build follows the same model.
- **Push direction.** From the relative velocity of tackler and carrier, so a side approach on a moving runner reads as a
  front-side hit. That is physically correct; pure side falls come from pursuit angles.
- **Fall by hit angle.** From behind the carrier falls forward, head-on he goes on his back, from the side onto his side.
  `wrap` (form tackle) or `dive` (at the legs, when the defender is farther away or chasing fast).
- **Big hit.** Head-on at high closing speed: the carrier is lifted and planted, with a shorter struggle.
- **Alignment.** The tackler slides into the clip's spot over about 0.1 s instead of the old teleport.
- **Momentum.** The pair moves with mass-weighted combined momentum (`MASS` per position). The pile slides on with
  `PILE_DECAY` 2.6/s. The spot is where the carrier's body lands.
- **Fixed today.** An engaged defender could start a second tackle on top of one in progress, overwriting it.
  `tryTackle` now returns early while a tackle is active.
- **Checked frame by frame in the lab.** From behind, the head-on big hit and the side hit. **Not checked:** head-on at
  normal speed, both dive variants, the hit from his right.

## 5. Ball (`moveBallMesh` in `web/play/game.js`)

- Held where the pose's hands put it. On a change of holder it slides across in 0.12 s instead of popping.
- A throw leaves from the throwing hand at the release frame. Handoff cues are timed so the QB lets go as the back clamps.
- In flight the nose follows the velocity and it spirals. Over the last 0.22 s it homes into the receiver's hands.
- A drop pops up off the hands. An incompletion keeps flying to the turf, then bounces and tumbles under gravity.
- Real size: 0.28 m long, pointed ends, college stripes, laces.
- **Checked:** the throw release at game-camera distance only. **Not checked up close:** catches and handoffs.

## 6. Decisions

- No paid assets and no Madden assets. The gridiron27 code has no license and was used for reference only.
- Built players from scratch rather than adapting the rigged model's clips.
- Kept the tackle outcome as a probability roll; the change is in how contact looks and where the pile ends.
- The voxel and rigged versions stay available behind `?stack` and `?rig`.

## 7. Open issues

- Not tested on a real phone.
- No paired contact for blocking; no gang tackles.
- Faces are basic. Small seams between the fingers show up close.
- Extreme poses are not checked for pinching at close range.
- The `?cam=close` test camera sits behind the line, so in-game tackles are partly hidden; the lab is the better check.
- Hand-written actions still read as hand-written up close. Free motion capture with football in it was not found.

## 8. Test hooks

- `play.html?auto` plays itself. `&step=0.0333` advances one fixed step per `window.__adv` (for frame-by-frame capture).
  `&cam=close` uses a close camera. `&grid=` sets the mesh grid in cm. `&noshadow` turns off sun shadows.
- `tacklelab.html?case=N&step=0.0333` and `meshlab.html?action=NAME&yaw=DEG&step=0.033` for deterministic captures.
