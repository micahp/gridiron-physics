// Rigged free football player integration.
//
// Loads web/assets/football-player-rigged-animated.glb (CC BY 3.0, "American Football
// Player" by Hikky via BlendSwap, exported with Blender 4.2's official glTF 2.0
// and retargeted FBX clips to its existing 56-bone skeleton. The renderer
// maps the same 12 gameplay states to clips, with procedural posing as fallback.
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

const POSE_ANIMATIONS = Object.freeze({
  [POSE.STANCE]: Object.freeze({ clipName: 'Idle', loop: true }),
  [POSE.RUN]: Object.freeze({ clipName: 'Running in place', loop: true }),
  [POSE.BLOCK]: Object.freeze({ clipName: 'Standing Block Idle Leaning Back', loop: true }),
  [POSE.DOWN]: Object.freeze({ clipName: 'Stunned (Knocked Down)', loop: false }),
  [POSE.THROW]: Object.freeze({ clipName: 'Quarterback Pass', loop: false }),
  [POSE.KICK]: Object.freeze({ clipName: 'Goalkeeper Drop Kick', loop: false }),
  [POSE.HOLD]: Object.freeze({ clipName: 'Football Hike', loop: false }),
  [POSE.CELEBRATE]: Object.freeze({ clipName: 'Fist Pump', loop: false }),
  [POSE.BACKPEDAL]: Object.freeze({ clipName: 'Running Backward in place', loop: true }),
  [POSE.WRAP]: Object.freeze({ clipName: 'Running To Tackle', loop: false }),
  [POSE.KNEEL]: Object.freeze({ clipName: 'Idle', loop: true }),
});
const CARRY_RUN_CLIP = Object.freeze({ clipName: 'Running While Holding Something', loop: true });
// The asset has no true three-point stance; its snap crouch is the only pose
// that puts a lineman low with his hands on the ground, so the line sets in it.
// The only real set in the asset: a three-point crouch, front hand on the
// ground, reached about two seconds into this clip, which then walks the player
// back upright. Linemen hold that frame instead of looping the walk-in.
const LINE_STANCE_CLIP = 'Football Stance';
const LINE_STANCE_TIME = 2.0;
const LINE_UNITS = new Set(['OL', 'DL', 'OT', 'OG', 'C', 'G', 'T', 'DT', 'NT', 'DE']);
function isLineman(root) {
  const u = root.userData;
  return LINE_UNITS.has(u.position) || LINE_UNITS.has(u.pos);
}
// Below this speed (m/s) a locomotion clip reads as jogging in place, so the
// player waits in a stance instead.
const STATIONARY_SPEED = 0.35;

export function getRiggedAnimationSelection(pose, carrying = false, speed = null) {
  // No catch clip: a receiver goes through the ball mid-stride. The asset's
  // catches are a forward lunge that snaps him out of the run, so catching
  // keeps the run cycle (and drops to the stance when he is standing still).
  if (pose === POSE.CATCH) pose = POSE.RUN;
  if ((pose === POSE.RUN || pose === POSE.BACKPEDAL) && speed != null && speed < STATIONARY_SPEED) {
    return { ...POSE_ANIMATIONS[POSE.STANCE] };
  }
  if (pose === POSE.RUN && carrying) return { ...CARRY_RUN_CLIP };
  const selection = POSE_ANIMATIONS[pose];
  return selection ? { ...selection } : null;
}

const YD = 0.9144;
const ASSET_URL = 'web/assets/football-player-rigged-animated.glb';

// Field axes (world units are yards): +X downfield, +Y up, +Z across the field.
const AX_FWD = new THREE.Vector3(1, 0, 0);
const AX_SIDE = new THREE.Vector3(0, 0, 1);

export function stablePhase(playerId, seed = '') {
  const input = `${seed}:${playerId}`;
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) / 0x100000000) * Math.PI * 2;
}

export function composeBindRelativeQuaternion(restQuat, restParentQuat, rotations) {
  const worldDelta = new THREE.Quaternion();
  const axisRotation = new THREE.Quaternion();
  for (const { axis, angle } of rotations) {
    axisRotation.setFromAxisAngle(axis, angle);
    worldDelta.premultiply(axisRotation);
  }
  return restParentQuat.clone().invert().multiply(worldDelta).multiply(restParentQuat).multiply(restQuat);
}

export function splitUniformGeometry(geometry, threshold = 0.9) {
  const position = geometry.getAttribute('position');
  if (!position || (!geometry.index && position.count % 3 !== 0)) throw new Error('Uniform geometry must contain triangle positions');
  const source = geometry.getIndex()?.array || Array.from({ length: position.count }, (_, i) => i);
  if (source.length % 3 !== 0) throw new Error('Uniform geometry index must contain complete triangles');
  const pants = [];
  const jersey = [];
  for (let i = 0; i < source.length; i += 3) {
    const triangle = [source[i], source[i + 1], source[i + 2]];
    const meanY = (position.getY(triangle[0]) + position.getY(triangle[1]) + position.getY(triangle[2])) / 3;
    (meanY < threshold ? pants : jersey).push(...triangle);
  }
  geometry.setIndex([...pants, ...jersey]);
  geometry.clearGroups();
  if (pants.length) geometry.addGroup(0, pants.length, 0);
  if (jersey.length) geometry.addGroup(pants.length, jersey.length, 1);
  return { geometry, pantsIndexCount: pants.length, jerseyIndexCount: jersey.length };
}

function fabricMaterial(source, color) {
  const material = source.clone();
  material.map = null; // discard the dark atlas with its baked #21 uniform
  material.color.set(color);
  material.roughness = 0.78;
  material.userData.riggedPlayerOwned = true;
  material.needsUpdate = true;
  return material;
}

function helmetMaterial(source, kit) {
  const material = source.clone();
  material.map = null;
  material.color.set(kit.helmet);
  material.roughness = 0.3;
  material.metalness = 0.18;
  material.userData.riggedPlayerOwned = true;
  material.needsUpdate = true;
  return material;
}

function applyRiggedKit(clone, kit) {
  if (!kit) return;
  clone.traverse((object) => {
    if (!object.isMesh || !object.material) return;
    const sources = Array.isArray(object.material) ? object.material : [object.material];
    const uniformIndex = sources.findIndex((material) => String(material.name || '').toUpperCase() === 'ROUPA_MAT');
    if (uniformIndex >= 0) {
      if (sources.length !== 1) throw new Error('Expected the apparel primitive to have its own material group');
      const split = splitUniformGeometry(object.geometry.clone());
      split.geometry.userData.riggedPlayerOwned = true;
      object.geometry = split.geometry;
      object.material = [fabricMaterial(sources[uniformIndex], kit.pants), fabricMaterial(sources[uniformIndex], kit.jersey)];
      return;
    }
    const apply = (source) => String(source.name || '').toUpperCase() === 'HELMET.001'
      ? helmetMaterial(source, kit)
      : source; // skin, face mask, straps, gloves, shoes and other gear stay intact
    object.material = Array.isArray(object.material) ? object.material.map(apply) : apply(object.material);
  });
}

function numberDecal(info, kit) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const context = canvas.getContext('2d');
  const number = String(info.jersey ?? '').trim();
  if (!number) return null;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.font = '900 188px Arial, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.lineJoin = 'round';
  context.lineWidth = 20;
  context.strokeStyle = kit.trim;
  context.strokeText(number, 128, 132, 236);
  context.fillStyle = kit.number;
  context.fillText(number, 128, 132, 236);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.userData.riggedPlayerOwned = true;
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, alphaTest: 0.04, side: THREE.DoubleSide, depthWrite: false, toneMapped: false });
  material.userData.riggedPlayerOwned = true;
  return material;
}

function attachNumberDecals(clone, bones, info, kit) {
  const material = numberDecal(info, kit);
  const torso = bones.chest || bones.hip;
  if (!material || !torso) return;
  const front = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 0.22), material);
  front.position.set(0, 1.13, 0.198);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 0.22), material);
  front.geometry.userData.riggedPlayerOwned = true;
  back.geometry.userData.riggedPlayerOwned = true;
  front.userData.riggedNumberDecal = back.userData.riggedNumberDecal = true;
  back.position.set(0, 1.13, -0.176);
  back.rotation.y = Math.PI;
  front.renderOrder = back.renderOrder = 2;
  front.castShadow = back.castShadow = false;
  clone.add(front, back);
  clone.updateMatrixWorld(true);
  torso.attach(front);
  torso.attach(back);
}

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

function updateRiggedAnimation(root, pose, speed, dt, carrying) {
  const animation = root.userData.animation;
  if (!animation?.mixer) return false;
  let selection = getRiggedAnimationSelection(pose, carrying, speed);
  // Linemen set in a stance before the snap; the skill-position idle stands
  // straight up, which looks like everyone is waiting for a bus.
  if (selection?.clipName === POSE_ANIMATIONS[POSE.STANCE].clipName && isLineman(root)) {
    selection = { clipName: LINE_STANCE_CLIP, loop: false, hold: LINE_STANCE_TIME };
  }
  animation.lastRequest = { pose, carrying: !!carrying, speed, clipName: selection?.clipName ?? null };
  const clip = selection && animation.clips.get(selection.clipName);
  if (!clip) {
    if (animation.activeAction) {
      animation.activeAction.fadeOut(0.12);
      animation.activeAction = null;
      animation.activeClipName = null;
    }
    animation.mixer.update(dt);
    return false;
  }

  const locomotion = selection.loop && (pose === POSE.RUN || pose === POSE.BACKPEDAL);
  const timeScale = locomotion ? THREE.MathUtils.clamp(speed / 5, 0.55, 1.55) : 1;
  if (animation.activeClipName !== selection.clipName) {
    const next = animation.mixer.clipAction(clip);
    next.reset();
    next.enabled = true;
    next.setLoop(selection.loop ? THREE.LoopRepeat : THREE.LoopOnce, selection.loop ? Infinity : 1);
    next.clampWhenFinished = !selection.loop;
    next.setEffectiveTimeScale(timeScale);
    if (animation.activeAction) {
      // fadeIn ramps the action's interpolant from 0 to 1, but the effective
      // weight is this.weight * ramp. Setting the weight to 0 here (as this
      // used to) multiplies the ramp by zero, so the new clip never leaves the
      // bind pose and every player holds a T-pose. Keep the weight at 1 and let
      // the fade own the blend.
      next.setEffectiveWeight(1);
      next.play();
      next.fadeIn(0.12);
      animation.activeAction.fadeOut(0.12);
    } else {
      next.setEffectiveWeight(1);
      next.play();
    }
    animation.activeAction = next;
    animation.activeClipName = selection.clipName;
    root.userData.body.position.y = root.userData.groundOffsets?.[selection.clipName] ?? 0;
  } else {
    animation.activeAction.setEffectiveTimeScale(timeScale);
  }
  // Pin the stance clip to its crouch frame, with a slow breath so the set does
  // not look frozen, before the mixer samples it.
  if (selection.hold != null && animation.activeAction) {
    const u = root.userData;
    u.stancePhase = (u.stancePhase ?? 0) + dt * 1.2;
    animation.activeAction.time = selection.hold + Math.sin(u.stancePhase) * 0.08;
  }
  animation.mixer.update(dt);
  // The idle clips hold the hands behind the back; keep their body motion but
  // give the stance a natural arm hang. Linemen set in a three-point stance:
  // the clip walks them into the crouch (right hand already down), and we drive
  // the arms the rest of the way so both hands rest near the turf instead of
  // one arm hanging up in the air.
  const linemanSet = selection.clipName === LINE_STANCE_CLIP;
  if (linemanSet) applyLinemanArms(root, dt, true);
  else {
    if (isLineman(root)) applyLinemanArms(root, dt, false);
    applyStanceArms(root, dt, selection.clipName === POSE_ANIMATIONS[POSE.STANCE].clipName);
  }
  return true;
}

// A lineman's set: hands on the ground, elbows slightly bent. The same
// bind-relative convention as applyStanceArms, so it sits on top of whatever
// the stance clip does to the body. Two hands down reads as a four-point set,
// which is fine for the line; it beats the clip's one-arm-up walk-in frame.
const LINEMAN_ARM = Object.freeze({ flexL: 1.35, flexR: 1.35, out: 0.0, elbow: 0.18 });
function applyLinemanArms(root, dt, active) {
  const b = root.userData.bones;
  const hinge = root.userData.hinge;
  if (!b?.upL || !b?.upR || !b?.foreL || !b?.foreR) return;
  const u = root.userData;
  const target = active ? 1 : 0;
  const step = dt / 0.15;
  const blend = u.lineBlend ?? 0;
  u.lineBlend = target > blend ? Math.min(target, blend + step) : Math.max(target, blend - step);
  if (u.lineBlend <= 0.001) return;
  const k = u.lineBlend;
  rotWorldComposed(b.upL, [{ axis: AX_SIDE, angle: LINEMAN_ARM.flexL }, { axis: AX_FWD, angle: LINEMAN_ARM.out }], k);
  rotWorldComposed(b.upR, [{ axis: AX_SIDE, angle: LINEMAN_ARM.flexR }, { axis: AX_FWD, angle: -LINEMAN_ARM.out }], k);
  rotWorld(b.foreL, hinge?.foreL ?? AX_SIDE, LINEMAN_ARM.elbow, k);
  rotWorld(b.foreR, hinge?.foreR ?? AX_SIDE, LINEMAN_ARM.elbow, k);
}

// Every relaxed standing clip in this asset clasps the hands behind the back,
// a parade-rest pose. The stance keeps the clip's torso and legs but drives the
// arms itself: a rigid shoulder offset was worse than the pose it was fixing,
// because the elbow and forearm swung through the torso and the joint read as
// dislocated. These angles are the ready-stance arms the procedural poser uses.
const STANCE_ARM = Object.freeze({ flexL: 0.25, flexR: 0.25, out: -0.45, elbow: 0.5 });
function applyStanceArms(root, dt, active) {
  const b = root.userData.bones;
  const hinge = root.userData.hinge;
  if (!b?.upL || !b?.upR || !b?.foreL || !b?.foreR) return;
  const u = root.userData;
  // Fade the override in and out so the arms do not snap when a player leaves
  // the stance for a run or a block.
  const target = active ? 1 : 0;
  const step = dt / 0.15;
  const blend = u.stanceBlend ?? 0;
  u.stanceBlend = target > blend ? Math.min(target, blend + step) : Math.max(target, blend - step);
  if (u.stanceBlend <= 0.001) return;
  // A slow breath keeps the arms alive instead of locked to the ribs.
  u.stancePhase = (u.stancePhase ?? 0) + dt * 1.5;
  const breathe = Math.sin(u.stancePhase) * 0.03;
  const k = u.stanceBlend;
  rotWorldComposed(b.upL, [{ axis: AX_SIDE, angle: STANCE_ARM.flexL + breathe }, { axis: AX_FWD, angle: STANCE_ARM.out }], k);
  rotWorldComposed(b.upR, [{ axis: AX_SIDE, angle: STANCE_ARM.flexR + breathe }, { axis: AX_FWD, angle: -STANCE_ARM.out }], k);
  rotWorld(b.foreL, hinge?.foreL ?? AX_SIDE, STANCE_ARM.elbow + breathe, k);
  rotWorld(b.foreR, hinge?.foreR ?? AX_SIDE, STANCE_ARM.elbow + breathe, k);
}

export function buildRiggedPlayer(gltf, info, kit) {
  const root = new THREE.Group(); // positioned & yawed on the field (yards)
  const body = new THREE.Group(); // tipped over when down
  root.add(body);

  const clone = cloneSkeleton(gltf.scene);
  applyRiggedKit(clone, kit);
  const clips = new Map((gltf.animations || []).map((clip) => [clip.name, clip]));
  const mixer = clips.size ? new THREE.AnimationMixer(clone) : null;
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

  // Some retargeted clips drive the hips below the bind height, which buries
  // the cleats in the field. Measure each clip we actually use once per asset
  // and lift the body by the depth it would otherwise sink.
  const footBones = [...new Set(Object.values(bones))].filter((b) => b?.isBone && /foot|toe/i.test(b.name));
  if (!gltf.userData.groundOffsets && footBones.length && mixer) {
    const offsets = {};
    const probe = new THREE.Vector3();
    for (const selection of Object.values(POSE_ANIMATIONS).concat([CARRY_RUN_CLIP])) {
      const clip = clips.get(selection.clipName);
      if (!clip || offsets[clip.name] !== undefined) continue;
      const action = mixer.clipAction(clip);
      action.reset(); action.play(); action.setEffectiveWeight(1);
      let lowest = Infinity;
      const step = Math.min(0.1, clip.duration / 16);
      for (let t = 0; t <= clip.duration; t += step) {
        mixer.setTime(t);
        root.updateMatrixWorld(true);
        for (const bone of footBones) {
          bone.getWorldPosition(probe);
          if (probe.y < lowest) lowest = probe.y;
        }
      }
      action.stop(); mixer.uncacheAction(clip);
      offsets[clip.name] = lowest < 0 ? -lowest : 0;
    }
    mixer.stopAllAction(); mixer.setTime(0);
    gltf.userData.groundOffsets = offsets;
  }

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
    b.userData.restPosition = b.position.clone();
    const pq = new THREE.Quaternion();
    if (b.parent) b.parent.getWorldQuaternion(pq);
    b.userData.restParentQuat = pq;
  }
  // semantic aliases (upL, hip, chest, ...) so the poser can use stable names
  for (const [key, name] of Object.entries(BONE)) {
    const b = bones[name] || bones[name.replace(/\./g, '')];
    if (b) bones[key] = b;
  }
  attachNumberDecals(clone, bones, info, kit);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.85, 1.05, 32),
    new THREE.MeshBasicMaterial({ color: '#f5d33a', transparent: true, opacity: 0.9, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  ring.visible = false;
  root.add(ring);

  root.userData = {
    rigged: true, id: info.id, jerseyNumber: String(info.jersey ?? ''), body, ring, bones,
    position: info.position ?? null, pos: info.pos ?? null,
    animation: { mixer, clips, activeAction: null, activeClipName: null },
    groundOffsets: gltf.userData.groundOffsets || {},
    phase: stablePhase(info.id, info.animationSeed ?? info.seed ?? kit?.seed ?? ''), lie: 0,
    hinge: {
      shinL: hinge('thighL', 'shinL'), shinR: hinge('thighR', 'shinR'),
      foreL: hinge('upper_armL', 'forearmL'), foreR: hinge('upper_armR', 'forearmR'),
    },
    dispose() {
      if (mixer) {
        mixer.stopAllAction();
        mixer.uncacheRoot(clone);
      }
      const geometries = new Set([ring.geometry]);
      const materials = new Set([ring.material]);
      const textures = new Set();
      root.traverse((object) => {
        if (object.geometry?.userData?.riggedPlayerOwned) geometries.add(object.geometry);
        if (object.skeleton?.boneTexture) textures.add(object.skeleton.boneTexture);
        for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
          if (!material?.userData?.riggedPlayerOwned) continue;
          materials.add(material);
          if (material.map?.userData?.riggedPlayerOwned) textures.add(material.map);
        }
      });
      for (const texture of textures) texture.dispose();
      for (const material of materials) material.dispose();
      for (const geometry of geometries) geometry.dispose();
    },
  };
  return root;
}

// Compose world-space deltas first, then express the result relative to the bind
// pose. A later shoulder axis must not replace an earlier flexion rotation.
const _q = new THREE.Quaternion();
const _pq = new THREE.Quaternion();
const _parentInverse = new THREE.Quaternion();
const _worldDelta = new THREE.Quaternion();
const _axisRotation = new THREE.Quaternion();
function rotWorld(bone, axis, angle, k) {
  return rotWorldComposed(bone, [{ axis, angle }], k);
}
function rotWorldComposed(bone, rotations, k) {
  if (!bone || !rotations?.length || !bone.userData.restQuat || !bone.userData.restParentQuat) return;
  _pq.copy(bone.userData.restParentQuat);
  _parentInverse.copy(_pq).invert();
  _worldDelta.identity();
  for (const { axis, angle } of rotations) {
    if (!axis || !Number.isFinite(angle)) continue;
    _axisRotation.setFromAxisAngle(axis, angle);
    _worldDelta.premultiply(_axisRotation);
  }
  _q.copy(_parentInverse).multiply(_worldDelta).multiply(_pq).multiply(bone.userData.restQuat);
  bone.quaternion.slerp(_q, k);
}

export function animateRigged(root, pose, speed, dt, carrying) {
  if (neutralMode) return; // Test 1: leave the imported bind pose untouched
  const u = root.userData;
  const b = u.bones;
  if (!b.hip && !b.thighL) return;
  if (updateRiggedAnimation(root, pose, speed, dt, carrying)) return;
  u.phase += dt * (2.2 + speed * 0.9);
  const swing = Math.min(0.95, speed * 0.11);
  let lean = Math.min(0.38, speed * 0.04);
  let crouch = 0;
  const armF = [-Math.sin(u.phase) * swing * 0.8, Math.sin(u.phase) * swing * 0.8];
  let armOut = 0.12;
  const legA = [Math.sin(u.phase) * swing, -Math.sin(u.phase) * swing];
  const kneeB = [Math.max(0, -Math.cos(u.phase)) * swing * 1.4, Math.max(0, Math.cos(u.phase)) * swing * 1.4];
  let lieT = 0, lift = 0, elbow = 0.55;
  switch (pose) {
    case POSE.STANCE:
      crouch = 0.3; lean = 0.42; legA[0] = 0.35; legA[1] = 0.2; kneeB[0] = 0.72; kneeB[1] = 0.62;
      armF[0] = 0.38; armF[1] = 0.16; armOut = 0.12; elbow = 0.78; break;
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
      crouch = 0.12; legA[0] = 0.12; legA[1] = -0.08; kneeB[0] = 0.42; kneeB[1] = 0.32; lean = 0.08;
      armF[0] = 0.45; armF[1] = 0.78; elbow = 1.0; break;
    case POSE.KNEEL:
      crouch = 0.48; legA[0] = 0.82; legA[1] = -0.28; kneeB[0] = 1.35; kneeB[1] = 1.8; lean = 0.12;
      armF[0] = armF[1] = 0.52; elbow = 1.1; break;
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
  // arms: flexion and abduction are one bind-relative transform per shoulder.
  rotWorldComposed(b.upL, [{ axis: AX_SIDE, angle: armF[0] }, { axis: AX_FWD, angle: armOut }], k);
  rotWorldComposed(b.upR, [{ axis: AX_SIDE, angle: armF[1] }, { axis: AX_FWD, angle: -armOut }], k);
  rotWorld(b.foreL, u.hinge.foreL, elbow, k);
  rotWorld(b.foreR, u.hinge.foreR, elbow, k);
  // torso lean and crouch. Lower the pelvis/spine, not the entire character root,
  // so stance transitions do not push the cleats through the field.
  rotWorld(b.hip, AX_SIDE, -lean * 0.5, k);
  rotWorld(b.chest, AX_SIDE, -lean * 0.5, k);
  for (const [bone, amount] of [[b.hip, 0.16], [b.chest, 0.12]]) {
    if (!bone?.userData.restPosition) continue;
    const targetY = bone.userData.restPosition.y - crouch * amount;
    bone.position.y += (targetY - bone.position.y) * k;
  }

  u.lie += (lieT - u.lie) * (1 - Math.exp(-dt * 8));
  u.body.rotation.z = -u.lie;
  u.body.position.y = lift + (u.lie > 0.1 ? 0.24 : 0);
}
