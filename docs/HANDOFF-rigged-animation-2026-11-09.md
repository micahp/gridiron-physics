# Handoff: rigged player animation (2026-11-09)

## Goal

Player models and movement that look like a broadcast sim: real rigged players with run, cut, catch, throw and tackle clips, driven by the physics positions.

## What is on this branch

- `web/assets/football-player-rigged-animated.glb`: rigged player, 56 bones, 49 retargeted clips. Built by `scripts/retarget_fbx_animations.py`.
- `web/assets/football-player-rigged-animated.manifest.json`: clip names, frame ranges, root-motion removal stats.
- `web/assets/football-player-rigged.glb`: the rig without clips (fallback target).
- `web/rigged-player.js`, `web/rigged-animation-controller.js`: runtime playback.
- `web/stadium.js`, `web/assets/stadium-stand.glb`, `web/assets/stadium-trim.glb`: stadium bowl (CC BY 3.0, see `web/assets/STADIUM_ATTRIBUTION.md`).
- Tests: `test/rigged-animation-unit.mjs`, `test/rigged-animation-controller.test.mjs`, `test/rigged-player-unit.mjs`, `test/rigged-pose-transition.browser.mjs`, `test/rigged-live-game.browser.mjs`.
- Attribution: `web/assets/FOOTBALL_PLAYER_ATTRIBUTION.md`. The player is "American Football Player" by Hikky, CC BY 3.0, BlendSwap #93542.

Not run yet by the author of this note. Run the tests before relying on the branch.

## What is NOT in git

- The Blender source, `FOOTBALL_PLAYER.blend` (Blender 2.79, from the BlendSwap download).
- The 49 FBX clips. The manifest says they live in a local `fbx-clips` folder.

Without these, the GLB cannot be rebuilt from the repo, and the clips cannot be edited or added to.

## Desktop steps

1. Put the FBX clips in one folder, for example `fbx-clips/`.
2. Run the retarget script with Blender 4.2 or newer:

       blender.exe -b --python scripts/retarget_fbx_animations.py -- --input-dir <fbx-clips> --output web/assets/football-player-rigged-animated.glb

3. Check that the manifest clip count is still 49, or record the new count.
4. Send back the source files (see open decision below) and the rebuilt GLB and manifest.

## Known gaps

- The GLB was made by a custom converter, not the official Blender glTF exporter. Test materials and skinning in the viewer before it replaces the fallback.
- Root motion is removed from the clips, so the physics engine keeps control of player position. Keep that rule for any new clip.

## Open decision

Where should the source files live in git?

- Proposed: `assets-src/` with the `.blend` and the FBX clips. Use Git LFS if the files are large.
- Alternative: keep them outside git and record only their checksums in the manifest.

## Next steps

1. Run the branch tests on this machine.
2. Load the rigged player in the viewer and check pose and clip playback.
3. Add or edit clips on the desktop, then rebuild the GLB.

## Update: football model and clips (2026-11-09, later)

The GLB is now rebuilt from the existing animated GLB with Blender 5.2, no FBX folder needed:

    blender -b --python scripts/build_football_player.py -- --src web/assets/football-player-rigged-animated.glb --out <new.glb> --manifest web/assets/football-player-build.manifest.json

**Run it against the v1 GLB, not the current one.** The build lengthens the arms and bakes the arm fix into the locomotion clips; running it on its own output would do both twice. Keep a copy of the source GLB you build from.

- `scripts/football_rig.py`: pose solver. A pose is where each bone points, in character terms (`cs(forward, left, up)`), with two-bone IK for hands (`ik(pt(...))`) and automatic foot grounding. Do forward kinematics ourselves; reading `pose_bone.matrix` back in background mode returns stale values.
- `scripts/football_clips.py`: the 12 `FB_*` clips as data. Edit a pose, rerun the build.
- `scripts/preview_football_clips.py`: renders contact sheets to eyeball poses (`blender -b --python scripts/preview_football_clips.py -- <outdir> [clip ...]`).
- Runtime: `footballClip()` in `web/rigged-animation-controller.js` picks the clip from slot, play type and contact role (replay aux channel). Handoff clips are timed to the engine's `handoff` event.
- The runtime arm hack (`relaxArms`) is gone; the arms are fixed in the clips.
- Engine: `rec.aux` (velocity, contact role and partner), `rec.kindGroup`, and `holdPreSnap` (default on). Before the snap, non-kick players no longer run their assignments; run plays shift about 0.1 yd, passes about 1.6 yd.

Default pose: `FB_Idle` (13th authored clip) replaces the stock Standing Idle, whose clasped hands read as hands behind the back. To audit any clip for hands behind the hips, sample it per frame and test both hand bones' forward offset from the hips (see the scan used in this session: forward offset < 0.02 m for both hands). Remaining offenders are `Idle (1)` (unused), the throw wind-up and the hike, where reaching back is the actual motion.

Known gaps: no pass-rush or swim move, no get-up after the fall, no QB drop-back clip with the ball held to the chest, no helmet logos, no replacement model. Hands do not rotate to grip (palms are not oriented by the IK).

## Update: kicking game (2026-11-09, later)

- `FB_Kick`, `FB_Punt`, `FB_Holder` authored (16 authored clips total). The kick clips are timed to the engine's `kick` event (contact 0.42 s / 0.40 s into the clip); the engine stamps KICK at contact and never clears it, so a latched KICK code is treated as running once `FB_Kick` exists. Before this the kicker stayed on the finished clip's last frame, a straight standing pose, while sliding 30 yards.
- Engine: the field-goal holder now kneels beside the kick line and the kicker comes in from the other side (he used to start directly behind the holder and run through him); kicker and holder are no-contact "ghosts" (`Player.ghosts`). The kickoff kicker eases to about 3.5 m/s into the ball and finishes his kick (0.8 s) before sprinting into coverage.
- A missed tackle puts the tackler on the ground in the engine (`broken_tackle`); the kickoff kicker diving at the returner and falling is that, not a bug in the clips.
