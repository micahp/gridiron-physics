// Stadium bowl for the rigged-player viewer.
//
// Source: "Soccer and American football stadium" by ericchip1983 (blendswap 74526),
// CC BY 3.0. The .blend ships both pitches plus goals as separate objects; they were
// deleted in Blender so this viewer draws its own field and posts inside the bowl.
// `web/assets/STADIUM_ATTRIBUTION.md` carries the credit required by the licence.
//
// Two baked GLBs, both in metres with the source .blend's pitch plane at y = 0:
//   stadium-stand.glb - roof, tiers, railings and walkways swept into a closed oval
//   stadium-trim.glb  - advertising boards, dugouts and corner flag cloth
// The bowl's opening is ~260 x 200 model units; scaling by 0.62 keeps its near stand
// outside the broadcast camera while leaving a realistic apron around a 120 x 53.33 yd field,
// apron around a 120 x 53.33 yd field whose centre is (50, W / 2) in render units.
import * as THREE from './vendor/three.module.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';

export const STADIUM_ASSETS = Object.freeze({
  stand: 'web/assets/stadium-stand.glb',
  trim: 'web/assets/stadium-trim.glb',
});
export const STADIUM_SCALE = 0.62;

let loadPromise = null;

/** Load both stadium parts once; they are authored in the same space, so they go in one group. */
export function loadStadium() {
  if (loadPromise) return loadPromise;
  const loader = new GLTFLoader();
  loadPromise = Promise.all([
    loader.loadAsync(STADIUM_ASSETS.stand),
    loader.loadAsync(STADIUM_ASSETS.trim),
  ]).then(([stand, trim]) => {
    const group = new THREE.Group();
    group.name = 'stadium';
    group.add(stand.scene);
    group.add(trim.scene);
    let meshes = 0;
    group.traverse((o) => {
      if (!o.isMesh) return;
      meshes++;
      o.castShadow = false;   // 188k triangles in the shadow pass buys nothing
      o.receiveShadow = true;
      if (o.material) {
        o.material.side = THREE.FrontSide;
        o.material.roughness = Math.max(0.55, o.material.roughness ?? 0.85);
      }
    });
    group.userData.meshes = meshes;
    return group;
  }).catch((err) => {
    loadPromise = null;
    throw err;
  });
  return loadPromise;
}

/** Place a loaded stadium so its pitch plane is the field plane and its bowl is centred on the field. */
export function placeStadium(group, { centerX = 50, centerZ = 0, scale = STADIUM_SCALE } = {}) {
  group.scale.setScalar(scale);
  group.position.set(centerX, 0, centerZ);
  return group;
}
