# American Football Player asset

- **Creator**: Hikky, via BlendSwap
- **Original asset**: [American Football Player, BlendSwap #93542](https://blendswap.com/blend/22654)
- **License**: [Creative Commons Attribution 3.0](https://creativecommons.org/licenses/by/3.0/) (CC BY 3.0)
- **Source**: `FOOTBALL_PLAYER.blend` (Blender 2.79) with textures, supplied in the original BlendSwap download
- **Derivative asset**: `football-player-rigged.glb`
- **Changes**: Geometry, per-material primitives, UV coordinates, 56-bone rig, four-influence-per-vertex linear-blend skinning, and available diffuse/color images extracted into glTF 2.0. Large textures downsampled to at most 1024 px. Blender-authored animation clips are **not** included; intended for Gridiron Physics procedural POSE animation driver.
- **Conversion**: Custom Blender 2.79 SDNA extraction, **not** the official Blender glTF exporter. Test rig retargeting and materials in the viewer before replacing the fallback.

## Modifications (Gridiron Physics, 2026-11-09)

`football-player-rigged-animated.glb` is built from the asset above by `scripts/build_football_player.py` (Blender 5.2):

- **Arms lengthened 30%** (upper arm and forearm), baked into the mesh and rest pose, so a player can reach the ground in a three-point stance and reach a handoff.
- **Twelve football clips authored for this rig** (`FB_*`: three stance types, pass and run block, tackle wrap, carrier struggle, tackled fall, left/right handoff give and take). They are keyed by where each bone points, with two-bone IK for hands and automatic foot grounding, and are original work.
- **Arms held off the body** in the stock locomotion and idle clips (the retargeted mocap hung them against the hips).
- The uniform texture atlas is repainted per team at runtime in `web/rigged-player.js`; the file itself is unchanged.
- The 49 stock clips are the Mixamo mocap clips retargeted earlier; see `football-player-rigged-animated.manifest.json`. Clip list and build details: `football-player-build.manifest.json`.

Attribution: **"American Football Player" by Hikky, licensed CC BY 3.0, via BlendSwap.**

See `FOOTBALL_PLAYER_SOURCE_LICENSE.html` for the original download's license notice.
