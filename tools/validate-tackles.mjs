// Validate one paired tackle across many starting conditions with the same
// runtime the game uses (web/mesh/tackle-sim.js + tackles.js), measured against
// the real body shapes (web/stack/body.js) on the skinned mesh.
//
//   node tools/validate-tackles.mjs [--style wrap|dive] [--set full|frontal|quick] [--ik 0|1] [--collide 0|1] [--lock 0|1] [--json out.json]
//
// Each scenario first goes through selection (selectTackle): if the spec says
// the pair can't be lined up inside its limits it is REJECTED, not played.
// Executed scenarios are then checked against the spec's limits:
//   contact      during the wrap state both palms within tolerance of the
//                carrier's surface AND not sunk into it (gap and depth separately)
//   penetration  deepest point of one body inside the other, by phase and part
//   root_pop     per-frame root speed
// Planted-foot slide is reported but not part of acceptance: the locomotion has
// its own check (tools/validate-locomotion.mjs).
import * as THREE from '../web/vendor/three.module.js';
import { fk, D, ORDER } from '../web/stack/skeleton.js';
import { PARTS } from '../web/stack/body.js';
import { ACTIONS } from '../web/stack/actions.js';
import { buildBody, MeshPlayer } from '../web/mesh/body-mesh.js';
import { tacklePose, TACKLE_GAP } from '../web/mesh/tackles.js';
import { makeTackle, selectTackle, stepStruggle, stepFall } from '../web/mesh/tackle-sim.js';
import { SPECS } from '../web/mesh/interactions.js';
import { lerpPose } from '../web/mesh/pose-blend.js';
import { solveTackler, solveCarrierArm } from '../web/mesh/pair.js';
import { FootLock } from '../web/mesh/footlock.js';
import { strideOf } from '../web/mesh/stride.js';
import fs from 'node:fs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const STYLE = opt('style', 'wrap'), USE_IK = opt('ik', '1') === '1', COLLIDE = opt('collide', '1') === '1', LOCK = opt('lock', '0') === '1', SET = args.includes('--quick') ? 'quick' : opt('set', 'full');
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
const ARM = /^(sh|el|wr|fi|th)/;
function classify(att, attPart, recvPart) {
  const a = ARM.test(attPart), b = ARM.test(recvPart);
  if (att === 'tackler') return a ? 'tackler_arm_in_carrier' : b ? 'tackler_body_in_carrier_arm' : 'body_in_body';
  return a ? 'carrier_arm_in_tackler' : b ? 'carrier_body_in_tackler_arm' : 'body_in_body';
}

function runScenario(sc) {
  const C = new Actor(sc.scaleC), T = new Actor(sc.scaleD);
  const fC = new FootLock(), fT = new FootLock();
  const tc = 1.0, reach = 1.0 * YD;
  const a = sc.from * D;
  const vdx = sc.lead ? sc.vc : -Math.cos(a) * sc.vd, vdz = -Math.sin(a) * sc.vd;
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
  const loco = (p, name) => { p.phase += (Math.hypot(p.vx, p.vz) / strideOf(name, ACTIONS[name].fn)) * DT; return ACTIONS[name].fn(((p.phase % 1) + 1) % 1); };
  const m = { gap: 0, sink: 0, gapSum: 0, gapN: 0, pen: { hold: 0, fall: 0 }, penWhere: { hold: null, fall: null }, slide: 0, runSlide: 0, pop: 0, armClear: 1e9 };
  const plants = {};
  const prev = {};
  let frame = 0, sel = null;
  while (t < 4.0) {
    t += DT; frame++;
    if (!w && Math.hypot(c.x - d.x, c.z - d.z) < reach) {
      sel = selectTackle({ c, d, u: YD, prefer: [STYLE] });
      if (!sel.action) break;                                        // rejected at selection: never played
      w = makeTackle({ c, d, mc: sc.mc, md: sc.md, t, u: YD, style: sel.action });
    }
    if (w) {
      if (w.tFall == null) { stepStruggle(w, c, d, DT, YD); if (t >= w.until) w.tFall = t; }
      else stepFall(c, d, DT);
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
    const placeOf = (A, s) => ({ x: s.x, z: s.z, yaw: s.yaw, scale: A.mp.root.scale.x, ground: A.mp.inner.position.y });
    const lockOn = LOCK && (!w || w.tFall == null);
    pc = fC.apply(pc, placeOf(C, c), DT, lockOn);
    C.pose(pc, c);
    let dd = d;
    if (w) {
      const r = solveTackler(w, t, DT, { J: C.J, place: placeOf(C, c) }, { pose: pd, place: placeOf(T, d) }, { ik: USE_IK, collide: COLLIDE });
      pd = r.pose; dd = { ...d, x: r.x, z: r.z };
    }
    pd = fT.apply(pd, placeOf(T, dd), DT, lockOn);
    T.pose(pd, dd);
    if (w && USE_IK) {
      // the carrier's free arm, now that the tackler is placed
      pc = solveCarrierArm(w, t, { pose: pc, place: placeOf(C, c) }, { J: T.J, place: placeOf(T, dd) });
      C.pose(pc, c);
    }
    for (const [k, s] of [['c', c], ['d', dd]]) {
      if (prev[k]) m.pop = Math.max(m.pop, Math.hypot(s.x - prev[k].x, s.z - prev[k].z) / DT);
      prev[k] = { x: s.x, z: s.z };
    }
    // planted-foot slide (reported; locomotion has its own acceptance)
    const phase = !w ? 'run' : w.tFall == null ? 'hold' : null;
    if (phase) for (const [k, A] of [['c', C], ['d', T]]) for (const side of ['R', 'L']) {
      const f = A.sole(side), key = phase + k + side;
      if (f[1] < 0.035) {
        if (!plants[key]) plants[key] = f;
        const sl = Math.hypot(f[0] - plants[key][0], f[2] - plants[key][2]);
        if (phase === 'run') m.runSlide = Math.max(m.runSlide, sl); else m.slide = Math.max(m.slide, sl);
      } else plants[key] = null;
    }
    if (!w) continue;
    // contact, in the wrap state only: gap off the surface and depth into it, separately
    if (w.contactState === 'wrap' || (!USE_IK && w.tFall == null && t - w.t0 > SPEC.phases.align.duration_s)) {
      for (const side of ['R', 'L']) {
        const sd = C.sdf(T.palm(side));
        m.gap = Math.max(m.gap, sd); m.sink = Math.max(m.sink, -sd); m.gapSum += Math.max(0, sd); m.gapN++;
      }
      if (w.armClear != null) m.armClear = Math.min(m.armClear, w.armClear);
    }
    // penetration (every other frame), by phase and by part
    if (frame % 2 === 0) {
      const ph = w.tFall != null ? 'fall' : 'hold';
      const main = (v) => { let b = 0, bj = 0; for (let q = 0; q < 4; q++) if (body.skinW[v * 4 + q] > b) { b = body.skinW[v * 4 + q]; bj = body.skinI[v * 4 + q]; } return ORDER[bj]; };
      if (DBG) {
        let worst = 0, wp = null;
        C.samples().forEach((v, k) => { const e = -T.sdf(v); if (e > worst) { worst = e; wp = body.samples[k * 6]; } });
        const elL = C.J.elL.p, wl = C.world(elL);
        console.log(`t+${(t - w.t0).toFixed(2)} ${w.contactState} carrier-in-tackler ${worst.toFixed(3)} elbowL sdf(tackler) ${T.sdf(wl).toFixed(3)} carrierArmClear ${w.carrierClear?.toFixed(3)} sep ${w.sep.map((x) => x.toFixed(2))}`);
      }
      T.samples().forEach((v, k) => { const e = -C.sdf(v); if (e > m.pen[ph]) { m.pen[ph] = e; const ap = main(body.samples[k * 6]); m.penWhere[ph] = { att: 'tackler', part: ap, into: C.near, cls: classify('tackler', ap, C.near), at: +(t - (ph === 'fall' ? w.tFall : w.t0)).toFixed(2) }; } });
      C.samples().forEach((v, k) => { const e = -T.sdf(v); if (e > m.pen[ph]) { m.pen[ph] = e; const ap = main(body.samples[k * 6]); m.penWhere[ph] = { att: 'carrier', part: ap, into: T.near, cls: classify('carrier', ap, T.near), at: +(t - (ph === 'fall' ? w.tFall : w.t0)).toFixed(2) }; } });
    }
  }
  const L = SPEC.limits, tol = SPEC.contact.tolerance_m;
  const r = { ...sc, selected: !!w, checks: sel?.checks?.[STYLE] || null, run_slide_m: +m.runSlide.toFixed(3) };
  if (!w) { r.rejected = sel ? sel.checks[STYLE].reasons : ['never_in_reach']; return r; }
  Object.assign(r, {
    fall: w.fall, hit: +w.hit.toFixed(2),
    palm_gap_max_m: +m.gap.toFixed(3), palm_sink_max_m: +m.sink.toFixed(3), palm_gap_mean_m: m.gapN ? +(m.gapSum / m.gapN).toFixed(3) : null,
    arm_clear_min_m: m.armClear < 1e8 ? +m.armClear.toFixed(3) : null,
    pen_hold_m: +m.pen.hold.toFixed(3), pen_fall_m: +m.pen.fall.toFixed(3), pen_hold_where: m.penWhere.hold, pen_fall_where: m.penWhere.fall,
    foot_slide_m: +m.slide.toFixed(3), max_root_speed_mps: +m.pop.toFixed(2),
    align_shift_m: +(w.shifted || 0).toFixed(3), align_turn_deg: +(((w.turned || 0) / D)).toFixed(1),
  });
  r.fail = [];
  if (r.palm_gap_max_m > tol) r.fail.push('contact:hands_off_body');
  if (r.palm_sink_max_m > 0.02) r.fail.push('contact:hands_inside_body');
  if (r.pen_hold_m > L.penetration_m) r.fail.push('penetration:hold:' + m.penWhere.hold.cls);
  if (r.pen_fall_m > L.penetration_m) r.fail.push('penetration:fall:' + m.penWhere.fall.cls);
  if (r.max_root_speed_mps > L.root_speed_mps) r.fail.push('root_pop');
  return r;
}

// ---------------------------------------------------------------- sweep
const SETS = {
  quick: { angles: [0, 90, 180, 270], speeds: [[5.5, 6]], leads: [false], sizes: [[1, 1]], offsets: [0] },
  frontal: { angles: [330, 345, 0, 15, 30], speeds: [[2, 3], [5.5, 6], [7.5, 8]], leads: [false], sizes: [[1, 1], [0.96, 1.04], [1.04, 0.96]], offsets: [0, 0.15] },
  full: { angles: [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330], speeds: [[2, 3], [5.5, 6], [7.5, 8]], leads: [false, true], sizes: [[1, 1], [0.96, 1.04], [1.04, 0.96]], offsets: [0, 0.3] },
};
const G = SETS[SET];
const DBG = opt('only', null);
const scenarios = [];
for (const from of G.angles) for (const [vc, vd] of G.speeds) for (const lead of G.leads) for (const [scaleC, scaleD] of G.sizes) for (const offset of G.offsets) {
  if (lead && (from === 0 || from === 180)) continue;   // a lead angle only means something from the side
  scenarios.push({ from, vc, vd, lead, scaleC, scaleD, offset, mc: 95 * scaleC ** 3, md: 100 * scaleD ** 3 });
}
const t0 = Date.now();
const results = (DBG ? scenarios.filter((x) => [x.from, x.vc, x.vd, x.scaleC, x.scaleD, x.offset].join(',') === DBG) : scenarios).map(runScenario);
const n = results.length, sel = results.filter((r) => r.selected), ok = sel.filter((r) => !r.fail.length);
const tally = (list, f) => { const o = {}; for (const r of list) for (const k of f(r)) o[k] = (o[k] || 0) + 1; return o; };
const q = (list, k, p) => { const v = list.map((r) => r[k]).filter((x) => x != null).sort((a, b) => a - b); return v.length ? v[Math.min(v.length - 1, Math.floor(p * v.length))] : '-'; };
console.log(`tackle.${STYLE}  set ${SET}  IK ${USE_IK ? 'on' : 'off'}  collide ${COLLIDE ? 'on' : 'off'}  footlock ${LOCK ? 'on' : 'off'}  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
console.log(`scenarios ${n} | selected ${sel.length} (${(100 * sel.length / n).toFixed(0)}% coverage) | rejected ${n - sel.length}`);
console.log(`valid execution: ${ok.length}/${sel.length} pass (${sel.length ? (100 * ok.length / sel.length).toFixed(0) : 0}%)`);
console.log('rejection reasons:', JSON.stringify(tally(results.filter((r) => !r.selected), (r) => r.rejected)));
console.log('failures (selected only):', JSON.stringify(tally(sel, (r) => r.fail)));
for (const k of ['palm_gap_max_m', 'palm_sink_max_m', 'arm_clear_min_m', 'pen_hold_m', 'pen_fall_m', 'max_root_speed_mps', 'align_turn_deg', 'foot_slide_m', 'run_slide_m'])
  console.log(`  ${k.padEnd(20)} median ${q(sel, k, 0.5)}  p90 ${q(sel, k, 0.9)}  max ${q(sel, k, 1)}`);
console.log('by fall (selected):', JSON.stringify(Object.fromEntries(Object.entries(tally(sel, (r) => [r.fall])).map(([k, v]) => [k, `${sel.filter((r) => r.fall === k && !r.fail.length).length}/${v}`]))));
const out = opt('json', null);
if (out) fs.writeFileSync(out, JSON.stringify({ style: STYLE, set: SET, ik: USE_IK, collide: COLLIDE, spec: SPEC, results }, null, 1));
