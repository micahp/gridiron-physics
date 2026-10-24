// Rigged free football player integration.
//
// Loads web/assets/football-player-rigged.glb (CC BY 3.0, "American Football
// Player" by Hikky via BlendSwap, exported with Blender 4.2's official glTF 2.0
// exporter) and drives its 56-bone skeleton with the same 12 procedural pose
// states the primitive fallback uses.
//
// The rig's bind pose is already upright, Y-up, feet on the ground and facing
// +Z, so the module only spins it to the field's +X and scales it to the
// player's height. Posing happens in WORLD space (field axes) rather than in
// bone-local axes, because this rig's bone roll does not match the primitive
// player's joint frames: hip/knee swing and shoulder flexion rotate about the
// field's left-right axis (Z), abduction about the forward axis (X), and
// elbows/knees bend about the hinge axis captured from the bind pose.
import * as THREE from './vendor/three.module.js';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { clone as cloneSkeleton } from './vendor/SkeletonUtils.js';

export const POSE = { STANCE: 0, RUN: 1, BLOCK: 2, DOWN: 3, THROW: 4, CATCH: 5, KICK: 6, HOLD: 7, CELEBRATE: 8, BACKPEDAL: 9, WRAP: 10, KNEEL: 11 };

const YD = 0.9144;
const ASSET_URL = 'web/assets/football-player-rigged.glb';

// Field axes (world units are yards): +X downfield, +Y up, +Z across the field.
const AX_FWD = new THREE.Vector3(1, 0, 0);
const AX_SIDE = new THREE.Vector3(0, 0, 1);

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

// three.js sanitises glTF node names ('thigh.L' -> 'thighL'), so the map holds
// the sanitised names and the builder also aliases the dot-stripped variants.
const BONE = {
  hip: 'spine', chest: 'spine001', chest2: 'spine002', neck: 'spine003', head: 'Bone',
  upL: 'upper_armL', foreL: 'forearmL', handL: 'handL',
  upR: 'upper_armR', foreR: 'forearmR', handR: 'handR',
  thighL: 'thighL', shinL: 'shinL', footL: 'footL', toeL: 'toeL',
  thighR: 'thighR', shinR: 'shinR', footR: 'footR', toeR: 'toeR',
};

// Neutral mode: skip all procedural posing so the imported bind pose can be
// checked on its own (Test 1: does the model stand upright, feet on the ground).
let neutralMode = false;
export function setNeutralMode(on) { neutralMode = !!on; }
export function isNeutralMode() { return neutralMode; }

export function buildRiggedPlayer(gltf, info, kit) {
  const root = new THREE.Group(); // positioned & yawed on the field (yards)
  const body = new THREE.Group(); // tipped over when down
  root.add(body);

  const clone = cloneSkeleton(gltf.scene);
  const bones = {};
  clone.traverse((o) => {
    if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; }
    if (o.isSkinnedMesh) {
      o.skeleton.bones.forEach((b) => {
        bones[b.name] = b;
        bones[b.name.replace(/\./g, '')] = b; // alias for dotted source names
      });
    }
  });
  const rig = new THREE.Group(); // orientation + scale wrapper
  body.add(rig);
  rig.add(clone);

  // Official Blender export: the model is already glTF Y-up and standing
  // (body spans y 0.09..1.83, helmet to 1.86 in metres) and faces +Z. Spin it
  // to the field's +X, then scale to the player height and ground the feet.
  clone.rotation.y = Math.PI / 2; // +Z forward -> +X forward
  rig.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(rig);
  const heightU = Math.max(1e-3, bb.max.y - bb.min.y); // authored units (~1.86)
  const s = (info.physics?.height || 1.88) / 1.88;
  const fit = (1.88 * s) / heightU;
  const S = fit / YD; // metres -> yards (same convention as the primitive body)
  rig.scale.setScalar(S);
  rig.position.y = -bb.min.y * S; // ground the feet

  // Capture the bind pose so posing can be expressed as an offset from rest.
  const dir = (from, to) => {
    const a = bones[from], b = bones[to];
    if (!a || !b) return null;
    const pa = new THREE.Vector3(), pb = new THREE.Vector3();
    a.getWorldPosition(pa); b.getWorldPosition(pb);
    return pb.sub(pa).normalize();
  };
  const hinge = (from, to) => {
    const d1 = dir(from, to);
    const child = bones[to];
    const grand = child && child.children.length ? dir(to, child.children[0].name) : null;
    if (!d1 || !grand) return null;
    return new THREE.Vector3().crossVectors(d1, grand).normalize();
  };
  for (const b of Object.values(bones)) {
    if (!b || !b.isBone) continue;
    b.userData.restQuat = b.quaternion.clone();
    const pq = new THREE.Quaternion();
    if (b.parent) b.parent.getWorldQuaternion(pq);
    b.userData.restParentQuat = pq;
  }
  // semantic aliases (upL, hip, chest, ...) so the poser can use stable names
  for (const [key, name] of Object.entries(BONE)) {
    const b = bones[name] || bones[name.replace(/\./g, '')];
    if (b) bones[key] = b;
  }

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.85, 1.05, 32),
    new THREE.MeshBasicMaterial({ color: '#f5d33a', transparent: true, opacity: 0.9, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  ring.visible = false;
  root.add(ring);

  root.userData = {
    rigged: true, id: info.id, body, ring, bones, phase: Math.random() * 6, lie: 0,
    hinge: {
      shinL: hinge('thighL', 'shinL'), shinR: hinge('thighR', 'shinR'),
      foreL: hinge('upper_armL', 'forearmL'), foreR: hinge('upper_armR', 'forearmR'),
    },
  };
  return root;
}

// Rotate a bone by `angle` about a world-space axis, on top of its bind pose.
// The bone's local quaternion is derived from the parent's bind-pose rotation so
// the rig's own bone roll never matters.
const _q = new THREE.Quaternion();
const _pq = new THREE.Quaternion();
function rotWorld(bone, axis, angle, k) {
  if (!bone || !axis || !bone.userData.restQuat || !bone.userData.restParentQuat) return;
  _pq.copy(bone.userData.restParentQuat);
  _q.setFromAxisAngle(axis, angle);
  const desired = _pq.clone().invert().multiply(_q).multiply(_pq).multiply(bone.userData.restQuat);
  bone.quaternion.slerp(desired, k);
}

export function animateRigged(root, pose, speed, dt, carrying) {
  if (neutralMode) return; // Test 1: leave the imported bind pose untouched
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
  let lieT = 0, lift = 0, elbow = 0.55;
  switch (pose) {
    case POSE.STANCE:
      crouch = 0.32; lean = 0.55; legA[0] = 0.55; legA[1] = 0.35; kneeB[0] = 0.9; kneeB[1] = 0.8;
      armF[0] = 0.5; armF[1] = 0.2; armOut = 0.18; elbow = 0.9; break;
    case POSE.BLOCK:
      lean = 0.4; crouch = 0.12; armF[0] = armF[1] = 0.6; armOut = 0.05; elbow = 1.1;
      legA[0] = 0.35 + Math.sin(u.phase) * 0.2; legA[1] = -0.15 - Math.sin(u.phase) * 0.2;
      kneeB[0] = 0.6; kneeB[1] = 0.45; break;
    case POSE.WRAP:
      lean = 0.5; crouch = 0.15; armF[0] = armF[1] = 0.7; armOut = -0.1; elbow = 1.3; break;
    case POSE.DOWN:
      lieT = Math.PI / 2; armF[0] = 1.4; armF[1] = 1.2; legA[0] = 0.1; legA[1] = -0.1;
      kneeB[0] = 0.3; kneeB[1] = 0.3; elbow = 0.3; break;
    case POSE.THROW:
      armF[0] = -1.2; armF[1] = 0.5; lean = 0.15; elbow = 1.4; break;
    case POSE.CATCH:
      armF[0] = armF[1] = 1.1; armOut = 0.2; lean = 0.05; elbow = 0.5; break;
    case POSE.KICK:
      legA[0] = -0.9; legA[1] = 0.2; kneeB[0] = 0.1; kneeB[1] = 0.3; lean = -0.15;
      armF[0] = 0.4; armF[1] = -0.5; armOut = 0.45; elbow = 0.6; break;
    case POSE.HOLD:
    case POSE.KNEEL:
      crouch = 0.42; legA[0] = 1.0; legA[1] = -0.2; kneeB[0] = 1.2; kneeB[1] = 1.6; lean = 0.15;
      armF[0] = armF[1] = 0.6; elbow = 1.2; break;
    case POSE.CELEBRATE:
      armF[0] = armF[1] = 2.2; armOut = 0.4; lift = Math.abs(Math.sin(u.phase * 1.3)) * 0.18; elbow = 0.3; break;
    case POSE.BACKPEDAL:
      lean = 0.25; crouch = 0.1; break;
  }
  if (carrying && pose !== POSE.DOWN) { armF[1] = 1.0; elbow = 1.3; }
  const k = 1 - Math.exp(-dt * 14);

  // legs: hip swing about the field's left-right axis, knee about its hinge
  rotWorld(b.thighL, AX_SIDE, legA[0], k);
  rotWorld(b.thighR, AX_SIDE, legA[1], k);
  rotWorld(b.shinL, u.hinge.shinL, kneeB[0], k);
  rotWorld(b.shinR, u.hinge.shinR, kneeB[1], k);
  // arms: shoulder flexion about the left-right axis, abduction about forward
  rotWorld(b.upL, AX_SIDE, armF[0], k);
  rotWorld(b.upR, AX_SIDE, armF[1], k);
  rotWorld(b.upL, AX_FWD, armOut, k);
  rotWorld(b.upR, AX_FWD, -armOut, k);
  rotWorld(b.foreL, u.hinge.foreL, elbow, k);
  rotWorld(b.foreR, u.hinge.foreR, elbow, k);
  // torso lean and crouch
  rotWorld(b.hip, AX_SIDE, -lean * 0.5, k);
  rotWorld(b.chest, AX_SIDE, -lean * 0.5, k);

  u.lie += (lieT - u.lie) * (1 - Math.exp(-dt * 8));
  u.body.rotation.z = -u.lie;
  u.body.position.y = lift + (u.lie > 0.1 ? 0.12 : 0) - crouch * 0.25;
}
