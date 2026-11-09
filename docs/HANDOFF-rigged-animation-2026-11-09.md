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
