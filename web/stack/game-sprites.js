// Drives the sprite-stacked players from the playable game's state: phase,
// pose codes, controller cues (handoffs, throws, catches, tackles, sheds,
// falls), juke and stiff-arm windows, and each player's velocity and facing.
// Positions in the game are yards; the stack works in metres, so the mesh sits
// in a group scaled by 1/YD.
import * as THREE from '../vendor/three.module.js';
import { ACTIONS } from './actions.js';
import { bakeAll, StackRenderer } from './stack-renderer.js';
import { POSE } from '../pose-codes.js';
import { FB } from '../rigged-animation-controller.js';

const YD = 0.9144;
const ROLE_ENGAGED = 1;
const STRIDE = { walk: 1.6, jog: 2.7, sprint: 4.3, carry: 4.1, carryL: 4.1, stiffL: 4.1, stiffR: 4.1, backpedal: 1.45, shuffleR: 1.05, shuffleL: 1.05 };
const LINE = /^(LT|LG|C|RG|RT|TE|LEDGE|LDT|RDT|REDGE)$/;

export const KITS = [
  { jersey: '#5b2a17', trim: '#f2b632', number: '#f2b632', pants: '#e9c46a', pantStripe: '#5b2a17', helmet: '#5b2a17', helmetStripe: '#f2b632', mask: '#d9d4c4', sock: '#5b2a17', sockStripe: '#f2b632', glove: '#f2b632', cleat: '#161616' },
  { jersey: '#f4f5f2', trim: '#13294b', number: '#13294b', pants: '#13294b', pantStripe: '#c7d3e3', helmet: '#13294b', helmetStripe: '#c7d3e3', mask: '#9aa4b1', sock: '#13294b', sockStripe: '#f4f5f2', glove: '#13294b', cleat: '#f0f0f0' },
];

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

export class GameSprites {
  constructor(scene, { voxel, blobGeo, blobMat }) {
    this.bake = bakeAll(voxel);
    // which baked frames already show the ball in a hand
    this.ballFrames = new Uint8Array(this.bake.frames.length);
    for (const [name, a] of Object.entries(ACTIONS)) {
      const ix = this.bake.index[name];
      for (let i = 0; i < a.frames; i++) {
        const t = a.loop ? i / a.frames : (a.frames === 1 ? 0 : i / (a.frames - 1));
        if (a.fn(t).ball) this.ballFrames[ix.start + i] = 1;
      }
    }
    this.sr = new StackRenderer(this.bake, { maxPlayers: 22, sub: 3, kits: KITS });
    this.group = new THREE.Group();
    this.group.scale.setScalar(1 / YD);
    this.group.add(this.sr.mesh);
    scene.add(this.group);
    this.blobs = new THREE.InstancedMesh(blobGeo, blobMat, 22);
    this.blobs.renderOrder = 1;
    this.blobs.frustumCulled = false;
    scene.add(this.blobs);
    this.m = new THREE.Matrix4();
    this.list = [];
  }

  /** Pick an action + frame for every player and push them to the GPU. */
  update(game, dt) {
    const t = game.t, live = !['presnap', 'playcall', 'title', 'loading'].includes(game.phase);
    const pass = game.play?.kind === 'pass';
    const out = this.list; out.length = 0;
    game.players.forEach((p, i) => {
      const sk = p.sk || (p.sk = { seen: new Set(), cuesRef: null, one: null, phase: Math.random(), downPose: 'prone', wasDown: false, jukeRef: 0, stiffUntil: 0, stiffSide: 'L' });
      if (sk.cuesRef !== p.cues) { sk.cuesRef = p.cues; sk.seen.clear(); }
      let action, frame;
      if (!live) {
        sk.one = null; sk.wasDown = false;
        action = stanceFor(p.slot);
        frame = this.sr.frameOf(action, t + i * 0.37);
      } else {
        // controller cues start one-shots at their time
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
          if (one && /fall|dive/.test(one.a)) { action = one.a; frame = this.sr.frameOf(action, t - one.t0); }
          else { action = sk.downPose; frame = this.sr.frameOf(action, 0); }
          sk.wasDown = true;
        } else {
          if (sk.wasDown) { sk.wasDown = false; sk.one = { a: 'getUp', t0: t }; sk.downPose = 'prone'; }
          const now = sk.one && t - sk.one.t0 < ACTIONS[sk.one.a].dur ? sk.one : null;
          if (now) { action = now.a; frame = this.sr.frameOf(action, t - now.t0); }
          else if (p.pose === POSE.WRAP) { action = 'wrap'; frame = this.sr.frameOf('wrap', 9); }
          else if (p.pose === POSE.CELEBRATE) { action = 'celebrate'; frame = this.sr.frameOf(action, t); }
          else if (p.pose === POSE.BLOCK || p.role === ROLE_ENGAGED) {
            action = pass && p.off ? 'passPro' : 'block';
            frame = this.sr.frameOf(action, t + i * 0.13);
          } else {
            action = this.locomotion(p, sk, dt, t);
            frame = action in STRIDE ? this.sr.frameAtPhase(action, sk.phase) : this.sr.frameOf(action, t + i * 0.37);
          }
        }
      }
      p.spriteAction = action;
      p.spriteBall = this.ballFrames[frame] === 1;
      out.push({ x: p.x * YD, z: p.z * YD, yaw: p.yaw, frame, team: p.off ? 0 : 1, skin: ((i * 0.618) % 1) * 0.9, number: p.number ?? 0 });
      this.m.makeTranslation(p.x, 0.02, p.z);
      this.blobs.setMatrixAt(i, this.m);
    });
    this.sr.update(out);
    this.blobs.count = out.length;
    this.blobs.instanceMatrix.needsUpdate = true;
  }

  locomotion(p, sk, dt, t) {
    const vx = p.vx * YD, vz = p.vz * YD, sp = Math.hypot(vx, vz);
    if (sp < 0.35) return p.off && LINE.test(p.slot) ? 'ready' : 'ready';
    const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
    const lx = vx * c + vz * s, lz = -vx * s + vz * c;
    const ang = Math.abs(Math.atan2(lz, lx)) * 180 / Math.PI;
    let a;
    if (ang < 55) {
      if (p.carrying) a = sk.stiffUntil > t ? (sk.stiffSide === 'L' ? 'stiffL' : 'stiffR') : 'carry';
      else a = sp > 5.6 ? 'sprint' : sp > 2.2 ? 'jog' : 'walk';
    } else if (ang > 125) a = 'backpedal';
    else a = lz > 0 ? 'shuffleR' : 'shuffleL';
    sk.phase += (sp / STRIDE[a]) * dt;
    return a;
  }
}
