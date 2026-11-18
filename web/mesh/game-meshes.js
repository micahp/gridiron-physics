// Drives the smooth skinned players from the playable game's state. Same
// action choices as the sprite stack (phase, pose codes, controller cues, juke
// and stiff-arm windows, omni-directional locomotion), plus what a live mesh can
// do that baked frames can't:
//   - every pose is evaluated at the exact time, and action changes crossfade
//   - tackles are paired: tackler and carrier play matching halves (tackles.js)
//   - the ball sits where the pose's hands put it; the game reads it from here
// Game positions are yards; bodies are metres inside a group scaled by 1/YD.
import * as THREE from '../vendor/three.module.js';
import { ACTIONS } from '../stack/actions.js';
import { fill, D } from '../stack/skeleton.js';
import { POSE } from '../pose-codes.js';
import { FB } from '../rigged-animation-controller.js';
import { KITS } from '../stack/game-sprites.js';
import { buildBody, MeshPlayer } from './body-mesh.js';
import { tacklePose } from './tackles.js';
import { lerpPose } from './pose-blend.js';
import { solveTackler, solveCarrierArm } from './pair.js';
import { strideOf } from './stride.js';

const YD = 0.9144;
const ROLE_ENGAGED = 1;
// gaits whose cycle is driven by distance travelled (stride measured in stride.js)
const GAITS = new Set(['walk', 'jog', 'sprint', 'carry', 'carryL', 'stiffL', 'stiffR', 'backpedal', 'shuffleR', 'shuffleL']);
const LINE = /^(LT|LG|C|RG|RT|TE|LEDGE|LDT|RDT|REDGE)$/;
const SCALE = { LT: 1.04, LG: 1.04, C: 1.03, RG: 1.04, RT: 1.04, TE: 1.02, QB: 1.0, RB: 0.97, WR1: 0.99, WR2: 0.99, SLOT: 0.96, LEDGE: 1.02, LDT: 1.03, RDT: 1.03, REDGE: 1.02, LB1: 1.0, LB2: 1.0, CB1: 0.97, CB2: 0.97, NB: 0.96, FS: 0.98, SS: 0.99 };
// where the hands hold the ball when an action doesn't say
const HOLD_DEFAULT = { catch: 'hands', catchHigh: 'hands', handoffTake: 'chest', throw: 'handR', handoffGive: 'handR', shotgun: 'chest' };
const deg = (a) => a.map((x) => x * D);
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

function stanceFor(slot) {
  if (LINE.test(slot)) return 'stance3';
  if (slot === 'QB') return 'shotgun';
  if (/^(WR|SLOT|CB|NB)/.test(slot)) return 'stance2';
  return 'ready';
}
function cueAction(c) {
  switch (c.kind) {
    case 'handoff_give': return 'handoffGive';
    case 'handoff_take': return 'handoffTake';
    case 'throw': return 'throw';
    case 'catch': return c.clip === FB.CATCH_HIGH ? 'catchHigh' : 'catch';
    case 'fall_variant': return c.clip === FB.FALL_BACK ? 'fallBack' : 'fallFwd';
    case 'oneshot':
      if (c.clip === FB.TACKLE_DIVE) return 'dive';
      if (c.clip === FB.TACKLE_FORM) return 'wrap';
      if (c.clip === FB.SWIM) return 'swim';
      if (c.clip === FB.RIP) return 'rip';
      return null;
  }
  return null;
}

export { lerpPose };

const CARRY_ARM = { shR: deg([16, 12, 14]), elR: 118 * D, wrR: deg([-25, 0]), gripR: 0.85, ball: 'R' };
const QB_HOLD = { shR: deg([40, 10, 34]), elR: 110 * D, shL: deg([40, 10, 34]), elL: 110 * D, gripR: 0.6, gripL: 0.6, ball: 'chest' };

export class GameMeshes {
  constructor(scene, { grid = 0.016, blobGeo, blobMat }) {
    this.body = buildBody(grid);
    this.group = new THREE.Group();
    this.group.scale.setScalar(1 / YD);
    scene.add(this.group);
    this.blobs = new THREE.InstancedMesh(blobGeo, blobMat, 22);
    this.blobs.renderOrder = 1;
    this.blobs.frustumCulled = false;
    scene.add(this.blobs);
    this.m = new THREE.Matrix4();
    this.mp = [];
  }

  attach(game) {
    game.players.forEach((p, i) => {
      const mp = new MeshPlayer(this.body, { kit: KITS[p.off ? 0 : 1], skin: ((i * 0.618) % 1) * 0.9, number: p.number ?? 0, scale: SCALE[p.slot] ?? 1, ownBall: false });
      this.group.add(mp.root);
      this.mp[i] = mp;
    });
  }

  /** Pick a pose for every player, crossfade action changes, pose the meshes. */
  update(game, dt) {
    const t = game.t, live = !['presnap', 'playcall', 'title', 'loading'].includes(game.phase);
    const pass = game.play?.kind === 'pass';
    const holder = game.ballState.flight ? null : game.ballState.holder;
    const poses = [];
    game.players.forEach((p, i) => {
      const sk = p.mk || (p.mk = { seen: new Set(), cuesRef: null, one: null, phase: Math.random(), downPose: 'prone', wasDown: false, jukeRef: 0, stiffUntil: 0, stiffSide: 'L', key: '', last: null, from: null, fromT: 0, fromDur: 0.15, where: null });
      if (sk.cuesRef !== p.cues) { sk.cuesRef = p.cues; sk.seen.clear(); sk.one = null; }
      let key, pose, blendDur = 0.15;
      if (!live) {
        sk.one = null; sk.wasDown = false;
        const a = stanceFor(p.slot);
        key = a; pose = this.at(a, t + i * 0.37);
      } else if (p.tackle) {
        const w = p.tackle.w;
        // the pair's leg cycles start where each player's running cycle was
        const pk = p.tackle.role === 'carrier' ? 'phC' : 'phD';
        if (!w[pk + 'Synced']) { w[pk] = sk.phase; w[pk + 'Synced'] = true; }
        key = `tackle:${p.tackle.role}:${w.tFall != null && t >= w.tFall ? 'fall' : 'hold'}`;
        pose = tacklePose(w, p.tackle.role, t);
        blendDur = key.endsWith('hold') ? 0.12 : 0.1;
        sk.wasDown = p.down > 0;
        sk.downPose = 'held';
      } else {
        for (const c of p.cues) {
          if (sk.seen.has(c) || c.at > t) continue;
          sk.seen.add(c);
          if (c.kind === 'oneshot' && (c.clip === FB.STIFF_L || c.clip === FB.STIFF_R)) {
            sk.stiffUntil = c.at + 0.7; sk.stiffSide = c.clip === FB.STIFF_L ? 'L' : 'R';
            continue;
          }
          const a = cueAction(c);
          if (a) { sk.one = { a, t0: c.at }; if (a === 'fallBack') sk.downPose = 'supine'; else if (a === 'fallFwd' || a === 'dive') sk.downPose = 'prone'; }
        }
        if (p.jukeUntil > t && sk.jukeRef !== p.jukeUntil) {
          sk.jukeRef = p.jukeUntil;
          sk.one = { a: (p.lastJuke || 1) > 0 ? 'jukeR' : 'jukeL', t0: t };
        }
        const one = sk.one && t - sk.one.t0 < ACTIONS[sk.one.a].dur ? sk.one : null;
        const down = p.down > 0 || p.pose === POSE.DOWN;
        if (down) {
          if (one && /fall|dive/.test(one.a)) { key = one.a + one.t0; pose = this.oneAt(one.a, t - one.t0); }
          else if (sk.downPose === 'held' && sk.last) { key = sk.key; pose = sk.last; }
          else { key = sk.downPose; pose = this.at(sk.downPose, 0); }
          sk.wasDown = true;
        } else {
          if (sk.wasDown) { sk.wasDown = false; sk.one = { a: 'getUp', t0: t }; sk.downPose = 'prone'; blendDur = 0.25; }
          const now = sk.one && t - sk.one.t0 < ACTIONS[sk.one.a].dur ? sk.one : null;
          if (now) { key = now.a + now.t0; pose = this.oneAt(now.a, t - now.t0); }
          else if (p.pose === POSE.WRAP) { key = 'wrapHold'; pose = this.oneAt('wrap', 9); }
          else if (p.pose === POSE.CELEBRATE) { key = 'celebrate'; pose = this.at('celebrate', t); }
          else if (p.pose === POSE.BLOCK || p.role === ROLE_ENGAGED) {
            key = pass && p.off ? 'passPro' : 'block';
            pose = this.at(key, t + i * 0.13);
          } else {
            const a = this.locomotion(p, sk, dt, t);
            key = a;
            pose = GAITS.has(a) ? fill(ACTIONS[a].fn(((sk.phase % 1) + 1) % 1)) : this.at(a, t + i * 0.37);
          }
          // the ball holder always has it somewhere: tuck it if the action doesn't say
          if (p === holder && !pose.ball && !now) {
            pose = { ...pose, ...(p === game.qb && !game.play?.carrier ? QB_HOLD : CARRY_ARM) };
            key += '+hold';
          }
          if (now) sk.oneName = now.a; else sk.oneName = key;
        }
      }
      // crossfade whenever the action changes
      if (key !== sk.key) {
        if (sk.last) { sk.from = sk.last; sk.fromT = t; sk.fromDur = blendDur; }
        sk.key = key;
      }
      if (sk.from) {
        const w = smooth((t - sk.fromT) / sk.fromDur);
        if (w >= 1) sk.from = null; else pose = lerpPose(sk.from, pose, w);
      }
      sk.last = pose;
      if (pose.ball) sk.where = pose.ball;
      poses[i] = pose;
    });
    // paired tackles: the carrier first, then the tackler's palms onto him and his body out of him
    const order = game.players.map((p, i) => i).sort((a, b) => (game.players[a].tackle?.role === 'tackler') - (game.players[b].tackle?.role === 'tackler'));
    for (const i of order) {
      const p = game.players[i], mp = this.mp[i];
      let pose = poses[i], x = p.x * YD, z = p.z * YD;
      if (p.tackle?.role === 'tackler') {
        const ci = game.players.findIndex((q) => q.tackle?.w === p.tackle.w && q.tackle.role === 'carrier');
        if (ci >= 0) {
          const q = game.players[ci], cm = this.mp[ci];
          const recv = { J: cm.J, place: { x: q.x * YD, z: q.z * YD, yaw: q.yaw, scale: cm.root.scale.x, ground: cm.inner.position.y } };
          const att = { pose, place: { x, z, yaw: p.yaw, scale: mp.root.scale.x, ground: mp.inner.position.y } };
          const r = solveTackler(p.tackle.w, t, dt, recv, att);
          pose = r.pose; x = r.x; z = r.z;
          // then the carrier's free arm, clear of the tackler where he now is
          mp.setPose(pose, x, z, p.yaw);
          const cp = solveCarrierArm(p.tackle.w, t, { pose: poses[ci], place: recv.place }, { J: mp.J, place: { x, z, yaw: p.yaw, scale: mp.root.scale.x, ground: mp.inner.position.y } });
          cm.setPose(cp, recv.place.x, recv.place.z, q.yaw);
        }
      }
      mp.setPose(pose, x, z, p.yaw);
      p.meshBall = mp.hasBall;
      this.m.makeTranslation(p.x, 0.02, p.z);
      this.blobs.setMatrixAt(i, this.m);
    }
    this.blobs.count = game.players.length;
    this.blobs.instanceMatrix.needsUpdate = true;
    this.group.updateMatrixWorld(true);
  }

  at(a, t) { const A = ACTIONS[a]; return fill(A.fn((((t / A.dur) % 1) + 1) % 1)); }
  oneAt(a, t) { const A = ACTIONS[a]; return fill(A.fn(A.frames === 1 ? 0 : Math.min(1, Math.max(0, t / A.dur)))); }

  locomotion(p, sk, dt, t) {
    const vx = p.vx * YD, vz = p.vz * YD, sp = Math.hypot(vx, vz);
    if (sp < 0.35) return 'ready';
    const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
    const lx = vx * c + vz * s, lz = -vx * s + vz * c;
    const ang = Math.abs(Math.atan2(lz, lx)) * 180 / Math.PI;
    let a;
    if (ang < 55) {
      if (p.carrying) a = sk.stiffUntil > t ? (sk.stiffSide === 'L' ? 'stiffL' : 'stiffR') : 'carry';
      else a = sp > 5.6 ? 'sprint' : sp > 2.2 ? 'jog' : 'walk';
    } else if (ang > 125) a = 'backpedal';
    else a = lz > 0 ? 'shuffleR' : 'shuffleL';
    sk.phase += (sp / strideOf(a, ACTIONS[a].fn)) * dt;     // stride measured from the gait: the standing foot stays put
    return a;
  }

  /** World matrix (yards) of the ball in player p's hands. */
  ballWorld(p, out = new THREE.Matrix4()) {
    const mp = this.mp[p.i];
    if (mp.hasBall) return mp.toWorld(mp.ballM, out);
    const sk = p.mk || {};
    const where = sk.where && sk.one && ['throw', 'handoffGive', 'handoffTake', 'catch', 'catchHigh'].includes(sk.one.a) ? sk.where
      : HOLD_DEFAULT[sk.oneName] || (p.slot === 'QB' ? 'chest' : 'R');
    const m = mp.ballAt(where) || mp.ballAt('R');
    return mp.toWorld(m, out);
  }

  /** World point (yards) between the hands, where a pass is caught. */
  handsWorld(p, out = new THREE.Vector3()) {
    const mp = this.mp[p.i];
    const m = mp.ballAt('hands');
    return out.setFromMatrixPosition(mp.toWorld(m, this.m));
  }
}
