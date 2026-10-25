# American Football Player asset

- **Creator**: Hikky, via BlendSwap
- **Original asset**: [American Football Player, BlendSwap #93542](https://blendswap.com/blend/22654)
- **License**: [Creative Commons Attribution 3.0](https://creativecommons.org/licenses/by/3.0/) (CC BY 3.0)
- **Source**: `FOOTBALL_PLAYER.blend` (Blender 2.79) with textures, supplied in the original BlendSwap download
- **Derivative asset**: `football-player-rigged.glb`
- **Changes**: Geometry, per-material primitives, UV coordinates, 56-bone rig, four-influence-per-vertex linear-blend skinning, and available diffuse/color images extracted into glTF 2.0. Large textures downsampled to at most 1024 px. Blender-authored animation clips are **not** included; intended for Gridiron Physics procedural POSE animation driver.
- **Conversion**: Custom Blender 2.79 SDNA extraction, **not** the official Blender glTF exporter. Test rig retargeting and materials in the viewer before replacing the fallback.

Attribution: **"American Football Player" by Hikky, licensed CC BY 3.0, via BlendSwap.**

See `FOOTBALL_PLAYER_SOURCE_LICENSE.html` for the original download's license notice.

## Animation clips (FBX)

`football-player-rigged-animated.glb` is the animated build: 49 imported FBX
motion clips retargeted onto the 56-bone rig above, with horizontal root travel
removed so the game simulation keeps owning player position.

- Source clips live outside this repository in a local `fbx-clips` folder.
  `scripts/retarget_fbx_animations.py` rebuilds the GLB with Blender.
- `football-player-rigged-animated.manifest.json` records the clip names, frame
  ranges, and root-motion removal statistics for that build. It contains no
  animation curves.
- The renderer plays these clips through Three.js animation mixers and falls
  back to the procedural pose driver when the GLB is unavailable.
