# Reference video (Furnace NFL Sim) vs Gridiron Physics: players and motion

Written 2026-11-09. The two blocks below are deliberately separate: block 1 is only what the reference video shows, block 2 is only what Gridiron Physics shows today. The comparison is block 3.

---

## Block 1. What the reference video shows

**Source:** `Kpcbp3SFMVRWAv2N.mp4`, a 24.8-minute 1920x1080 capture of a "Furnace NFL Sim" Bills vs Vikings game (Monday Night Football, week 9 branding).

**What I actually viewed:** 0:00 to 3:00 as stills, one every 4 seconds, plus a 6-second sideline replay (about 1:42 to 1:48) at 5 frames per second. That is enough to judge poses, uniforms, lighting and staging. It is not enough to judge fine motion smoothness or the rest of the game.

### Player models (replay close-up)
- Pants carry team stripes. Bills: blue pants with a red side stripe. Vikings: gray pants with a stripe.
- Socks are striped (Vikings purple and gold). Cleats are team-colored: red for Buffalo, gold for Minnesota.
- Gloves and wristbands are colored. Jerseys have sleeve stripes and sleeve numbers.
- Helmets carry decals and facemasks. Bodies are stocky and athletic.

### Lighting and rendering
- Every player casts a soft contact shadow on the turf.
- The replay camera blurs the background (shallow depth of field).
- Lighting is warm. The field has mown stripes and a crowd bowl behind it.

### Motion (6-second replay)
- The ball carrier throws a stiff-arm at a defender, arm fully extended.
- Defenders hold an athletic crouch and turn their hips toward the runner. Each is in a slightly different pose.
- The runner plants a foot and leans into a cut. Strides look matched to speed.
- Linemen start in a tight, clean 3-point line. After contact, blockers and pursuers pile in as groups.

### Camera and staging
- Live play is a high, angled broadcast view that keeps the line of scrimmage and the ball in frame. Players are small on screen, which hides model flaws.
- Contact is shown on a low sideline replay tagged REPLAY.
- A kickoff, a punt and a flag ("Delay of game, BUF, 5 yards, replay 1st & 15") each get their own framing.

### Overlay
- Persistent HUD: scorebug, a win-probability panel by player, box score, game flow, key stats, momentum, and a sharp-line panel.
- A caption names each play, for example "C.Wentz pass left to J.Jefferson on a hitch for 0 vs Cover 3".

---

## Block 2. What Gridiron Physics shows today

**Build:** branch `feat/rigged-animation-controller`, viewer at `week7.html?game=2026_07_CIN_BAL`. Facts below are from the code and from screenshots taken in the live viewer.

### Player model
- Model: "American Football Player" by Hikky (BlendSwap, CC BY 3.0), 56-bone rig. Arms lengthened 30% so players can reach the ground and a handoff.
- Uniform: the model's texture atlas is repainted per team. Jersey and pants take the team colors, side panels take the trim color, the baked number is covered, and a per-player number decal sits on the chest and upper back.
- Not present: pants stripes, striped socks, team-colored cleats and gloves (cleats and gloves keep the model's default dark look), wristbands, helmet decals or logos. Helmets are one flat team color.

### Lighting and rendering
- Shadows are off by default (`&shadows=blob` or `&shadows=full` turns them on). ACES tone mapping, hemisphere plus sun light.
- Stadium: a procedural NFL dome themed to the home team (`&stadium=blockout` and `&stadium=bowl` are the alternatives).
- No depth of field.

### Motion
- Locomotion: run clips are chosen by real speed and stride-matched to it. Backward running is picked from the actual direction of travel. The arm position is fixed inside the clips (it used to be a runtime bone nudge).
- Twelve football clips authored in Blender: 3-point, 2-point and QB-ready stances, pass block, run block, tackle wrap, carrier struggle, tackled fall, and handoff give and take (left and right).
- Clips are chosen from position, play type and contact (replay `aux` channel). All 22 players hold a stance before the snap; blockers face and lean into their partner; handoff clips are timed to the engine's handoff event.
- Default pose: anyone standing around uses `FB_Idle`, authored so the arms hang at the sides with the hands visible beside the thighs (the stock idle clasped the hands at the belt, which read as hands behind the back). The stock `Fist Pump` and `Kneel` clips had both hands behind the hips and were fixed.
- Players are kept from drawing through each other, including downed players.
- Not present: stiff-arm, lean into cuts, get-up after a tackle, pass-rush moves, a QB drop-back with the ball at the chest. Hands do not rotate to grip.
- Engine: players no longer run assignments before the snap (`holdPreSnap`).

### Camera and staging
- Cameras: broadcast, all-22, skycam, chalkboard, follow, free. All are high or mid-height.
- No low sideline replay camera, no REPLAY segment, no dedicated kickoff, punt or flag framing.

### Overlay
- Scorebug, drive and play list, box score and ratings tabs, a play description under the field.
- No win-probability panel, no persistent HUD, no on-field play caption, no flag graphic.

---

## Block 3. Contrast

| Area | Reference | Gridiron today | Gap |
| --- | --- | --- | --- |
| Uniform detail | Pants stripes, striped socks, colored cleats, gloves, wristbands, sleeve numbers | Team-colored jersey, pants and sleeve panels, chest and back numbers | Pants stripes, socks, cleats, gloves, wristbands, helmet decals |
| Shadows | Soft contact shadow under every player | Off by default | Re-enable a cheap blob shadow |
| Depth of field | Background blur on replay cam | None | Replay-camera effect |
| Stances | Clean 3-point line, 2-point backs | 3-point, 2-point, QB ready | Close; polish only |
| Blocking and tackles | Pairs engage, pursuers pile in | Paired block clips, tackle wrap, carrier struggle, fall | No pile-on or get-up |
| Ball carrier | Stiff-arm, cut lean, plant | Run clips only | Stiff-arm and cut clips |
| Handoff | (not isolated in the 3 minutes viewed) | Authored give and take, timed to the event | Needs a close look |
| Camera | High live view plus low replay cam | High and mid cameras only | Sideline replay camera |
| Overlay | Full HUD and play captions | Scorebug and side panel | HUD, caption, flag graphic |

### Suggested order
1. Uniform detail (texture and material work in Blender).
2. Stiff-arm and cut-lean clips, plus get-up and pass rush.
3. Soft contact shadows.
4. Low sideline replay camera with depth of field.
5. On-field play caption and flag graphic.
