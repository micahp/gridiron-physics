// Validate one paired tackle across many starting conditions with the same
// runtime the game uses (web/mesh/tackle-sim.js + tackles.js), measured against
// the real body shapes (web/stack/body.js) on the skinned mesh.
//
//   node tools/validate-tackles.mjs [--style wrap|dive] [--ik 0|1] [--json out.json] [--quick]
//
// Per scenario: palm-to-body gap during the hold (contact), deepest
// penetration of either body into the other, planted-foot slide, alignment
// correction, per-frame root speed. Limits come from web/mesh/interactions.js.
import * as THREE from '../web/vendor/three.module.js';
import { fk, D, ORDER } from '../web/stack/skeleton.js';
import { PARTS } from '../web/stack/body.js';
import { ACTIONS } from '../web/stack/actions.js';
import { buildBody, MeshPlayer } from '../web/mesh/body-mesh.js';
import { tacklePose, TACKLE_GAP } from '../web/mesh/tackles.js';
import { makeTackle, stepStruggle, stepFall } from '../web/mesh/tackle-sim.js';
import { SPECS } from '../web/mesh/interactions.js';
import { lerpPose } from '../web/mesh/pose-blend.js';
import { solveTackler } from '../web/mesh/pair.js';
import fs from 'node:fs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const STYLE = opt('style', 'wrap'), USE_IK = opt('ik', '1') === '1', COLLIDE = opt('collide', '1') === '1', QUICK = args.includes('--quick');
const SPEC = SPECS[STYLE];
if (opt('gap', null)) TACKLE_GAP[STYLE] = +opt('gap');
const YD = 0.9144, DT = 1 / 60;
const KIT = { jersey: '#000', trim: '#fff', number: '#fff', pants: '#000', helmet: '#000', mask: '#fff', sock: '#000' };

const body = buildBody(0.02);
const solid = PARTS.filter((p) => !p.thin || p.hand);
const toLocal = (R, p, w) => { const x = w[0] - p[0], y = w[1] - p[1], z = w[2] - p[2]; return [R[0] * x + R[3] * y + R[6] * z, R[1] * x + R[4] * y + R[7] * z, R[2] * x + R[5] * y + R[8] * z]; };
const toWorld = (R, p, l) => [p[0] + R[0] * l[0] + R[1] * l[1] + R[2] * l[2], p[1] + R[3] * l[0] + R[4] * l[1] + R[5] * l[2], p[2] + R[6] * l[0] + R[7] * l[1] + R[8] * l[2]];

// ---------------------------------------------------------------- one actor
class Actor {
  constructor(scale) {
    this.mp = new MeshPlayer(body, { kit: KIT, scale, ownBall: false });
    this.inv = new THREE.Matrix4(); this.v = new THREE.Vector3();
    this.skinM = body.boneInverses.map(() => new THREE.Matrix4());
  }
  pose(pose, s) {
    this.mp.setPose(pose, s.x, s.z, s.yaw);
    this.mp.root.updateMatrixWorld(true);
    this.W = this.mp.inner.matrixWorld;
    this.inv.copy(this.W).invert();
    this.J = this.mp.J;
    this.scale = this.mp.root.scale.x;
    for (let b = 0; b < this.skinM.length; b++) this.skinM[b].multiplyMatrices(this.W, this.mp.bones[b].matrix).multiply(body.boneInverses[b]);
  }
  /** body-space point (fk frame) -> world */
  world(p) { return this.v.set(p[0], p[1], p[2]).applyMatrix4(this.W).toArray(); }
  /** signed distance from a world point to this body (metres) */
  sdf(w) {
    const l = this.v.set(w[0], w[1], w[2]).applyMatrix4(this.inv).toArray();
    let d = 1;
    for (const pt of solid) { const j = this.J[pt.joint]; const q = toLocal(j.R, j.p, l); if (Math.abs(q[0]) > 0.6 || Math.abs(q[1]) > 0.7 || Math.abs(q[2]) > 0.6) continue; const e = pt.sdf(q); if (e < d) { d = e; this.near = pt.joint; } }
    return d * this.scale;
  }
  /** skinned world positions of a sparse vertex set */
  samples(every = 6) {
    const out = [], P = body.pos, I = body.skinI, Wt = body.skinW;
    for (let k = 0; k < body.samples.length; k += every) {
      const v = body.samples[k]; let x = 0, y = 0, z = 0;
      for (let q = 0; q < 4; q++) {
        const w = Wt[v * 4 + q]; if (!w) continue;
        const e = this.skinM[I[v * 4 + q]].elements, px = P[v * 3], py = P[v * 3 + 1], pz = P[v * 3 + 2];
        x += w * (e[0] * px + e[4] * py + e[8] * pz + e[12]); y += w * (e[1] * px + e[5] * py + e[9] * pz + e[13]); z += w * (e[2] * px + e[6] * py + e[10] * pz + e[14]);
      }
      out.push([x, y, z]);
    }
    return out;
  }
  palm(side) { const j = this.J['wr' + side]; const s = side === 'R' ? 1 : -1; return this.world(toWorld(j.R, j.p, [0.002, -0.06, -s * 0.024])); }
  sole(side) { const j = this.J['an' + side]; return this.world(toWorld(j.R, j.p, [0.05, -0.075, 0])); }
}

// ---------------------------------------------------------------- one scenario
const STRIDE = { carry: 4.1, sprint: 4.3 };
function runScenario(sc) {
  const C = new Actor(sc.scaleC), T = new Actor(sc.scaleD);
  const tc = 1.0, reach = 1.0 * YD;
  const a = sc.from * D;
  const vdx = sc.lead ? sc.vc : -Math.cos(a) * sc.vd, vdz = -Math.sin(a) * sc.vd;
  const vdl = Math.hypot(vdx, vdz) || 1;
  // contact point, shifted sideways by the aim offset (defender arrives off-centre)
  const cx = sc.vc * tc, cz = sc.offset;
  const c = { x: 0, z: 0, vx: sc.vc, vz: 0, yaw: 0, phase: 0 };
  const d = { x: cx + Math.cos(a) * reach - vdx * tc, z: cz + Math.sin(a) * reach - vdz * tc, vx: vdx, vz: vdz, yaw: Math.atan2(vdz, vdx), phase: 0.5 };
  let w = null, t = 0;
  const st = { c: { key: '', last: null, from: null }, d: { key: '', last: null, from: null } };
  const blend = (s, key, pose) => {
    if (key !== s.key) { if (s.last) { s.from = s.last; s.fromT = t; } s.key = key; }
    if (s.from) { const u = Math.min(1, (t - s.fromT) / 0.12), k = u * u * (3 - 2 * u); if (u >= 1) s.from = null; else pose = lerpPose(s.from, pose, k); }
    s.last = pose; return pose;
  };
  const loco = (p, name) => { p.phase += (Math.hypot(p.vx, p.vz) / STRIDE[name]) * DT; return ACTIONS[name].fn(((p.phase % 1) + 1) % 1); };
  const m = { contactMax: 0, contactSum: 0, contactN: 0, pen: 0, penAt: null, slide: 0, slideAt: null, alignShift: 0, alignTurn: 0, totalShift: 0, pop: 0, triggered: false, fall: null };
  const plants = { cR: null, cL: null, dR: null, dL: null };
  const prev = { c: null, d: null };
  let frame = 0;
  while (t < 4.0) {
    t += DT; frame++;
    if (!w && Math.hypot(c.x - d.x, c.z - d.z) < reach) {
      w = makeTackle({ c, d, mc: sc.mc, md: sc.md, t, u: YD, style: STYLE, rng: () => 0.9 });
      m.triggered = true; m.fall = w.fall; m.hit = +w.hit.toFixed(2);
    }
    if (w) {
      if (w.tFall == null) {
        const k = stepStruggle(w, c, d, DT, YD);
        m.totalShift += k.shift;
        if (t - w.t0 <= SPEC.phases.align.duration_s + 1e-9) { m.alignShift += k.shift; m.alignTurn += k.turn; }
        if (t >= w.until) w.tFall = t;
      } else stepFall(c, d, DT);
    }
    c.x += c.vx * DT; c.z += c.vz * DT; d.x += d.vx * DT; d.z += d.vz * DT;
    if (w && w.tFall != null && t - w.tFall > 1.1) break;
    let pc, pd;
    if (w) {
      const ph = w.tFall != null ? 'fall' : 'hold';
      pc = blend(st.c, 'c' + ph, tacklePose(w, 'carrier', t));
      pd = blend(st.d, 'd' + ph, tacklePose(w, 'tackler', t));
    } else {
      pc = blend(st.c, 'carry', loco(c, 'carry'));
      pd = blend(st.d, 'sprint', loco(d, 'sprint'));
    }
    C.pose(pc, c);
    let dd = d;
    if (w) {
      const recv = { J: C.J, place: { x: c.x, z: c.z, yaw: c.yaw, scale: C.mp.root.scale.x, ground: C.mp.inner.position.y } };
      const att = { pose: pd, place: { x: d.x, z: d.z, yaw: d.yaw, scale: T.mp.root.scale.x, ground: T.mp.inner.position.y } };
      const r = solveTackler(w, t, DT, recv, att, { ik: USE_IK, collide: COLLIDE });
      pd = r.pose; dd = { ...d, x: r.x, z: r.z };
    }
    T.pose(pd, dd);
    // per-frame root speed (pops)
    for (const [k, s] of [['c', c], ['d', dd]]) {
      if (prev[k]) m.pop = Math.max(m.pop, Math.hypot(s.x - prev[k].x, s.z - prev[k].z) / DT);
      prev[k] = { x: s.x, z: s.z };
    }
    if (!w) {
      // reference: how much the plain running gait slides before contact
      for (const [k, A] of [['c', C], ['d', T]]) for (const s of ['R', 'L']) {
        const f = A.sole(s), key = 'run' + k + s;
        if (f[1] < 0.035) { if (!plants[key]) plants[key] = f; m.runSlide = Math.max(m.runSlide || 0, Math.hypot(f[0] - plants[key][0], f[2] - plants[key][2])); }
        else plants[key] = null;
      }
      continue;
    }
    const hold = w.tFall == null && t - w.t0 > SPEC.phases.align.duration_s;
    // contact: both palms on the receiver's body
    if (hold) {
      const g = Math.max(C.sdf(T.palm('R')), C.sdf(T.palm('L')));
      m.contactMax = Math.max(m.contactMax, g); m.contactSum += g; m.contactN++;
    }
    // penetration (every other frame)
    if (frame % 2 === 0) {
      let pen = 0, who = '';
      const near = (A, v) => { let b = 0, bj = 0; for (let q = 0; q < 4; q++) if (body.skinW[v * 4 + q] > b) { b = body.skinW[v * 4 + q]; bj = body.skinI[v * 4 + q]; } return ORDER[bj]; };
      T.samples().forEach((v, k) => { const e = -C.sdf(v); if (e > pen) { pen = e; who = 'tackler.' + near(T, body.samples[k * 6]) + ' in carrier.' + C.near; } });
      C.samples().forEach((v, k) => { const e = -T.sdf(v); if (e > pen) { pen = e; who = 'carrier.' + near(C, body.samples[k * 6]) + ' in tackler.' + T.near; } });
      if (pen > m.pen) { m.pen = pen; m.penAt = (w.tFall != null ? 'fall+' + (t - w.tFall).toFixed(2) : 'hold+' + (t - w.t0).toFixed(2)) + ' ' + who; }
    }
    // planted-foot slide during the hold (falls slide on purpose)
    if (w.tFall == null) {
      for (const [k, A] of [['c', C], ['d', T]]) for (const s of ['R', 'L']) {
        const f = A.sole(s), key = k + s;
        if (f[1] < 0.035) {
          if (!plants[key]) plants[key] = f;
          const slide = Math.hypot(f[0] - plants[key][0], f[2] - plants[key][2]);
          if (slide > m.slide) { m.slide = slide; m.slideAt = key; }
        } else plants[key] = null;
      }
    }
  }
  const L = SPEC.limits, A = SPEC.phases.align;
  const r = {
    ...sc, fall: m.fall, hit: m.hit, triggered: m.triggered,
    contact_max_m: +m.contactMax.toFixed(3), contact_mean_m: m.contactN ? +(m.contactSum / m.contactN).toFixed(3) : null,
    penetration_m: +m.pen.toFixed(3), penetration_at: m.penAt,
    foot_slide_m: +m.slide.toFixed(3), foot_slide_at: m.slideAt,
    align_shift_m: +m.alignShift.toFixed(3), align_turn_deg: +(m.alignTurn / D).toFixed(1), total_shift_m: +m.totalShift.toFixed(3),
    max_root_speed_mps: +m.pop.toFixed(2), run_slide_m: +(m.runSlide || 0).toFixed(3),
  };
  r.fail = [];
  if (!r.triggered) r.fail.push('no_contact');
  if (r.contact_max_m > SPEC.contact.tolerance_m) r.fail.push('hands_off_body');
  if (r.penetration_m > L.penetration_m) r.fail.push('penetration');
  if (r.foot_slide_m > L.foot_slide_m) r.fail.push('foot_slide');
  if (r.align_shift_m > A.max_root_shift_m) r.fail.push('align_shift');
  if (r.align_turn_deg > A.max_rotation_deg) r.fail.push('align_turn');
  if (r.max_root_speed_mps > L.root_speed_mps) r.fail.push('root_pop');
  return r;
}

// ---------------------------------------------------------------- sweep
const angles = QUICK ? [0, 90, 180, 270] : [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];
const speeds = QUICK ? [[5.5, 6]] : [[2, 3], [5.5, 6], [7.5, 8]];
const leads = QUICK ? [false] : [false, true];
const sizes = QUICK ? [[1, 1]] : [[1, 1], [0.96, 1.04], [1.04, 0.96]];
const offsets = QUICK ? [0] : [0, 0.3];
const scenarios = [];
for (const from of angles) for (const [vc, vd] of speeds) for (const lead of leads) for (const [scaleC, scaleD] of sizes) for (const offset of offsets) {
  if (lead && (from === 0 || from === 180)) continue;   // a lead angle only means something from the side
  scenarios.push({ from, vc, vd, lead, scaleC, scaleD, offset, mc: 95 * scaleC ** 3, md: 100 * scaleD ** 3 });
}
const t0 = Date.now();
const results = scenarios.map(runScenario);
const n = results.length, pass = results.filter((r) => !r.fail.length).length;
const count = {}; for (const r of results) for (const f of r.fail) count[f] = (count[f] || 0) + 1;
const q = (k, p) => { const v = results.map((r) => r[k]).filter((x) => x != null).sort((a, b) => a - b); return v[Math.min(v.length - 1, Math.floor(p * v.length))]; };
console.log(`tackle.${STYLE}  IK ${USE_IK ? 'on' : 'off'}  collide ${COLLIDE ? 'on' : 'off'}  ${n} scenarios in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
console.log(`pass ${pass}/${n} (${(100 * pass / n).toFixed(0)}%)`);
console.log('failures by check:', JSON.stringify(count));
for (const k of ['contact_max_m', 'contact_mean_m', 'penetration_m', 'foot_slide_m', 'run_slide_m', 'align_shift_m', 'align_turn_deg', 'max_root_speed_mps'])
  console.log(`  ${k.padEnd(20)} median ${q(k, 0.5)}  p90 ${q(k, 0.9)}  max ${q(k, 1)}`);
const byFall = {}; for (const r of results) { const b = byFall[r.fall] || (byFall[r.fall] = { n: 0, pass: 0 }); b.n++; if (!r.fail.length) b.pass++; }
console.log('by fall:', JSON.stringify(byFall));
const worst = [...results].sort((a, b) => b.penetration_m - a.penetration_m).slice(0, 3);
console.log('deepest penetration:', worst.map((r) => `from ${r.from} v${r.vc}/${r.vd}${r.lead ? ' lead' : ''} off ${r.offset}: ${r.penetration_m} m at ${r.penetration_at}`).join(' | '));
const out = opt('json', null);
if (out) fs.writeFileSync(out, JSON.stringify({ style: STYLE, ik: USE_IK, spec: SPEC, results }, null, 1));
