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

## Animation clips (FBX) — not distributed in this repository

`football-player-rigged-animated.glb` is a local build artifact. It bakes 49
FBX clips clips onto the 56-bone rig above by retargeting FBX downloads.

- Adobe's FBX terms allow the animations to be used inside a game, including
  commercially, but do not allow the raw animation files (or a bundle of them)
  to be redistributed as standalone downloadable assets. The baked GLB is
  effectively a downloadable bundle of those clips, so it is gitignored and is
  never committed.
- Build it locally when needed: download each clip from FBX (FBX Binary,
  without skin, In Place for locomotion) into a local clip folder, then run
  `scripts/retarget_fbx_animations.py` with Blender. The runtime detects the
  GLB at `web/assets/football-player-rigged-animated.glb` and uses the
  procedural pose driver when it is absent, so the game works in a clean clone.
- The committed `football-player-rigged-animated.manifest.json` records clip
  names, frame ranges, and root-motion removal statistics only. It contains no
  animation curves.
