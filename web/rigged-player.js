// Rigged free football player integration.
//
// Loads web/assets/football-player-rigged.glb (CC BY 3.0, "American Football
// Player" by Hikky via BlendSwap) and drives its 56-bone skeleton with the same
// 12 procedural pose states the primitive fallback uses. The primitive build
// in render.js remains the fallback: if the GLB fails to load or a bone is
// missing, players keep rendering and only the rigged path degrades.
import * as THREE from './vendor/three.module.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { clone as cloneSkeleton } from './vendor/SkeletonUtils.js';

export const POSE = { STANCE: 0, RUN: 1, BLOCK: 2, DOWN: 3, THROW: 4, CATCH: 5, KICK: 6, HOLD: 7, CELEBRATE: 8, BACKPEDAL: 9, WRAP: 10, KNEEL: 11 };

const YD = 0.9144;
const ASSET_URL = 'web/assets/football-player-rigged.glb';

let loaderPromise = null;
export function loadRiggedPlayer() {
  if (!loaderPromise) {
    loaderPromise = new GLTFLoader().loadAsync(ASSET_URL).catch((err) => {
      loaderPromise = null;
      throw err;
    });
  }
  return loaderPromise;
}

// glTF bone names from the rig's spine/limb hierarchy.
const BONE = {
  hip: 'spine', chest: 'spine.001', chest2: 'spine.002', neck: 'spine.003', head: 'Bone',
  upL: 'upper_arm.L', foreL: 'forearm.L', handL: 'hand.L',
  upR: 'upper_arm.R', foreR: 'forearm.R', handR: 'hand.R',
  thighL: 'thigh.L', shinL: 'shin.L', footL: 'foot.L',
  thighR: 'thigh.R', shinR: 'shin.R', footR: 'foot.R',
};

// Local axis we rotate around for forward/back limb flexion. Blender-authored
// bones point +Y along the bone and glTF keeps +Y up, so a standing leg flexes
// around the local X axis; the sign is tuned against the field's +X forward.
const FLEX = 'x';

function tintKit(clone, kit) {
  // Clone materials per player so one team's colour never leaks into another,
  // then tint the helmet and body meshes toward the kit colours. Textures are
  // preserved; the colour simply multiplies them.
  clone.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    o.material = mats.map((m) => {
      const c = m.clone();
      if (o.name === 'OBHELMET') c.color.set(kit.helmet);
      else if (o.name === 'OBPERSONAGEM') c.color.set(kit.jersey);
      return c;
    });
    if (o.material.length === 1) o.material = o.material[0];
  });
}

export function buildRiggedPlayer(gltf, info, kit) {
  const root = new THREE.Group(); // positioned & yawed on the field (yards)
  const body = new THREE.Group(); // tipped over when down
  root.add(body);

  const clone = cloneSkeleton(gltf.scene);
  const bones = {};
  clone.traverse((o) => {
    if (o.isSkinnedMesh) {
      o.castShadow = true;
      o.frustumCulled = false;
      o.skeleton.bones.forEach((b) => { bones[b.name] = b; });
    }
  });
  tintKit(clone, kit);
  const rig = new THREE.Group(); // orientation + scale wrapper
  body.add(rig);
  rig.add(clone);

  // The custom-extracted rig lies flat in glTF space: long (height) axis along
  // +Z, thin chest-to-back along Y, arm span along X. Use a nested rig so the two
  // 90° rotations don't compound through a single Euler: stand it up, then spin
  // the stood-up body to face the field's +X.
  rig.rotation.x = Math.PI / 2;    // stand up: +Z -> +Y
  clone.rotation.y = -Math.PI / 2; // face +X (field forward)
  rig.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(rig);
  const heightU = Math.max(1e-3, bb.max.y - bb.min.y); // authored units (~1.87)
  const s = (info.physics?.height || 1.88) / 1.88;
  const fit = (1.88 * s) / heightU;
  const S = fit / YD; // metres -> yards (same convention as the primitive body)
  rig.scale.setScalar(S);
  rig.position.y = -bb.min.y * S; // ground the feet

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.85, 1.05, 32),
    new THREE.MeshBasicMaterial({ color: '#f5d33a', transparent: true, opacity: 0.9, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  ring.visible = false;
  root.add(ring);

  root.userData = { rigged: true, id: info.id, body, ring, bones, phase: Math.random() * 6, lie: 0 };
  return root;
}

export function animateRigged(root, pose, speed, dt, carrying) {
  const u = root.userData;
  const b = u.bones;
  if (!b.hip && !b.thighL) return;
  u.phase += dt * (2.2 + speed * 0.9);
  const swing = Math.min(0.95, speed * 0.11);
  let lean = Math.min(0.38, speed * 0.04);
  let crouch = 0;
  const armF = [Math.sin(u.phase) * swing * 0.8, -Math.sin(u.phase) * swing * 0.8];
  let armOut = 0.12;
  const legA = [Math.sin(u.phase) * swing, -Math.sin(u.phase) * swing];
  const kneeB = [Math.max(0, -Math.cos(u.phase)) * swing * 1.4, Math.max(0, Math.cos(u.phase)) * swing * 1.4];
  let lieT = 0, lift = 0;
  switch (pose) {
    case POSE.STANCE:
      crouch = 0.32; lean = 0.75; legA[0] = 0.9; legA[1] = 0.6; kneeB[0] = 1.4; kneeB[1] = 1.2; armF[0] = 0.9; armF[1] = 0.3; break;
    case POSE.BLOCK:
      lean = 0.5; crouch = 0.12; armF[0] = armF[1] = 1.3; armOut = 0.05;
      legA[0] = 0.5 + Math.sin(u.phase) * 0.25; legA[1] = -0.2 - Math.sin(u.phase) * 0.25; kneeB[0] = 0.7; kneeB[1] = 0.5; break;
    case POSE.WRAP:
      lean = 0.85; crouch = 0.15; armF[0] = armF[1] = 1.5; armOut = -0.15; break;
    case POSE.DOWN:
      lieT = Math.PI / 2; armF[0] = 2.6; armF[1] = 2.4; legA[0] = 0.1; legA[1] = -0.1; kneeB[0] = 0.2; kneeB[1] = 0.2; break;
    case POSE.THROW:
      armF[0] = -2.6; armF[1] = 0.6; lean = 0.1; break;
    case POSE.CATCH:
      armF[0] = armF[1] = 2.8; armOut = 0.25; lean = 0.05; break;
    case POSE.KICK:
      legA[0] = -1.3; legA[1] = 0.2; kneeB[0] = 0; kneeB[1] = 0.3; lean = -0.2; armF[0] = 0.6; armF[1] = -0.8; armOut = 0.7; break;
    case POSE.HOLD:
    case POSE.KNEEL:
      crouch = 0.42; legA[0] = 1.5; legA[1] = -0.2; kneeB[0] = 1.6; kneeB[1] = 2.2; lean = 0.2; armF[0] = armF[1] = 0.9; break;
    case POSE.CELEBRATE:
      armF[0] = armF[1] = 3.0; armOut = 0.5; lift = Math.abs(Math.sin(u.phase * 1.3)) * 0.18; break;
    case POSE.BACKPEDAL:
      lean = 0.25; crouch = 0.1; break;
  }
  if (carrying && pose !== POSE.DOWN) armF[1] = 1.4;
  const k = 1 - Math.exp(-dt * 14);

  const rot = (bone, val) => { if (bone) bone.rotation[FLEX] += (val - bone.rotation[FLEX]) * k; };
  // legs
  rot(b.thighL, legA[0]); rot(b.thighR, -legA[1]);
  rot(b.shinL, -kneeB[0]); rot(b.shinR, -kneeB[1]);
  // arms
  rot(b.upL, armF[0]); rot(b.upR, -armF[1]);
  rot(b.foreL, 0.5); rot(b.foreR, 0.5);
  if (b.upL) b.upL.rotation.z = armOut;
  if (b.upR) b.upR.rotation.z = -armOut;
  // torso lean and crouch
  rot(b.hip, -lean * 0.5);
  rot(b.chest, -lean * 0.5);

  u.lie += (lieT - u.lie) * (1 - Math.exp(-dt * 8));
  u.body.rotation.z = -u.lie;
  u.body.position.y = lift + (u.lie > 0.1 ? 0.12 : 0);
}
