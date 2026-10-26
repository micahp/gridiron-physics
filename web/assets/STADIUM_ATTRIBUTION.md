# Stadium model attribution

`stadium-stand.glb` and `stadium-trim.glb` are derived from:

**"Soccer and American football stadium"** by **ericchip1983**
Blend Swap: http://www.blendswap.com/blends/view/74526
Licensed **Creative Commons Attribution 3.0** (CC BY 3.0)
https://creativecommons.org/licenses/by/3.0/

Required credit: *Soccer and American football stadium by ericchip1983, CC BY 3.0.*

## Modifications

- The source `.blend` holds two pitches (a soccer field and an American football
  field) plus their goals. All four were deleted so this viewer draws its own
  120 x 53.33 yd field, yard lines, hash marks and goal posts inside the bowl.
- The jumbotron (`Pantalla 01`), which sits 126 model units off-centre, was
  removed; it hangs outside the bowl at the scale used here.
- Textures were recovered from the file's packed TGAs (Blender 5.x cannot decode
  them in place), converted to PNG at 512 px and re-wired into node materials.
- Subdivision levels were lowered and the stand geometry decimated to 35% so the
  bowl loads in ~190k triangles instead of 1.2M.
- Array/curve modifiers were applied, splitting the result into two GLBs:
  `stadium-stand.glb` (roof, tiers, railings, walkways) and `stadium-trim.glb`
  (advertising boards, dugouts, corner flag cloth).

The game itself remains the original Gridiron Physics work; only the stadium
geometry and textures come from the source above.
