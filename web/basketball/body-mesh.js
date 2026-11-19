// Smooth skinned mesh of the basketball player. It reuses the football surface pipeline
// (web/mesh/body-mesh.js: surface nets over the signed-distance parts, skin weights from the nearest
// shapes, jersey numbers from the chest plates) and the football kit material. What is basketball:
// the parts (body-parts.js), the skeleton (skeleton.js) and its bone order, and the player class,
// which has no football ball logic.
import * as THREE from '../vendor/three.module.js';
import { surface, jointMatrix, playerMaterial } from '../mesh/body-mesh.js';
import { fk, D, ORDER } from './skeleton.js';
import { BASKET_PARTS } from './body-parts.js';

// bind pose: arms out so they don't fuse to the torso, legs slightly apart
const BIND = {
  shR: [0, 50 * D, 0], shL: [0, 50 * D, 0], elR: 8 * D, elL: 8 * D, wrR: [0, 0], wrL: [0, 0],
  hipR: [0, 7 * D, 0], hipL: [0, 7 * D, 0], knR: 3 * D, knL: 3 * D,
};
const CTX = { order: ORDER, numberJoint: 'chest' };

/** Build the shared basketball body geometry once. h: grid spacing (m). */
export function buildBasketballBody(h = 0.016) {
  const t0 = performance.now();
  const J = fk(BIND);
  const geo = surface(J, BASKET_PARTS, h, 0.012, 0.022, CTX);
  const boneInverses = ORDER.map((n) => jointMatrix(J[n]).invert());
  const nv = geo.attributes.position.count;
  const samples = [];
  for (let v = 0; v < nv; v += 14) samples.push(v);
  return {
    geo, boneInverses, samples,
    pos: geo.attributes.position.array, skinI: geo.attributes.skinIndex.array, skinW: geo.attributes.skinWeight.array,
    tris: geo.index.count / 3, verts: nv, ms: performance.now() - t0, h,
  };
}

/** A basketball player on the shared body: poses come from the basketball skeleton. */
export class BasketballMeshPlayer {
  constructor(base, { kit, skin = 0.4, number = 7, scale = 1 }) {
    this.base = base;
    this.root = new THREE.Group();          // world placement and facing
    this.root.scale.setScalar(scale);
    this.inner = new THREE.Group();         // grounding offset
    this.root.add(this.inner);
    this.bones = ORDER.map(() => { const b = new THREE.Bone(); b.matrixAutoUpdate = false; this.inner.add(b); return b; });
    this.material = playerMaterial(kit, skin, number);
    this.mesh = new THREE.SkinnedMesh(base.geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.inner.add(this.mesh);
    this.mesh.bind(new THREE.Skeleton(this.bones, base.boneInverses.map((m) => m.clone())), new THREE.Matrix4());
    this.tmp = new THREE.Matrix4();
    this.skin = new Float32Array(ORDER.length * 4);
  }

  setNumber(n) { this.material.userData.u.uNum.value = n; }

  /** Pose from the basketball skeleton (body space), then facing yaw and position. */
  setPose(pose, x = 0, z = 0, yaw = 0) {
    const J = fk(pose);
    const { boneInverses, samples, pos, skinI, skinW } = this.base;
    ORDER.forEach((n, b) => {
      const bone = this.bones[b];
      jointMatrix(J[n], bone.matrix);
      bone.matrixWorldNeedsUpdate = true;
      this.tmp.multiplyMatrices(bone.matrix, boneInverses[b]);
      const e = this.tmp.elements;   // column-major: y row = e[1], e[5], e[9], e[13]
      this.skin[b * 4] = e[1]; this.skin[b * 4 + 1] = e[5]; this.skin[b * 4 + 2] = e[9]; this.skin[b * 4 + 3] = e[13];
    });
    // ground the lowest skinned sample on root.lift, as the football player does
    let minY = 1e9;
    for (const v of samples) {
      let y = 0;
      for (let q = 0; q < 4; q++) {
        const w = skinW[v * 4 + q]; if (!w) continue;
        const o = skinI[v * 4 + q] * 4;
        y += w * (this.skin[o] * pos[v * 3] + this.skin[o + 1] * pos[v * 3 + 1] + this.skin[o + 2] * pos[v * 3 + 2] + this.skin[o + 3]);
      }
      if (y < minY) minY = y;
    }
    this.inner.position.y = (J._pose.root.lift || 0) - minY;
    this.root.position.set(x, 0, z);
    this.root.rotation.y = -yaw;
    this.J = J;
  }
}
