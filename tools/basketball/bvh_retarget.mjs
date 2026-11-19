// Retarget a CMU mocap BVH clip onto the basketball skeleton (web/basketball/skeleton.js).
//
// Input:  a CMU BVH file (subject 124 trial 5 by default: a basketball jump shot).
// Output: web/basketball/refs/<name>.json, per-frame joint angles for our skeleton,
//         the root lift (feet off the floor), and an error report against the reference.
//
// Method: each reference joint is converted to body-local coordinates (x forward,
// y up, z the player's right, the same convention as skeleton.js). Each limb's joint
// angles are solved from its reference bone directions (upper arm, forearm, thigh,
// shin, trunk). The feet are held flat by skeleton.js's own solver, and the root is
// lifted by the reference feet's clearance above the floor.
//
// Usage: node tools/basketball/bvh_retarget.mjs <file.bvh> <out.json> [startSec endSec]
import fs from 'node:fs';
import { fk, fill, D } from '../../web/basketball/skeleton.js';

const [, , bvhPath, outPath, sStart = '1.8', sEnd = '4.4'] = process.argv;
const UNIT = 1.8 / 31.2;   // metres per BVH unit, from the head height range of a 1.8 m standing subject

// ---------- BVH parser (hierarchy + motion)
const lines = fs.readFileSync(bvhPath, 'utf8').split(/\r?\n/);
const joints = [];
const stack = [];
let li = 0;
for (; li < lines.length && lines[li].trim() !== 'MOTION'; li++) {
  const parts = lines[li].trim().split(/\s+/);
  if (parts[0] === 'ROOT' || parts[0] === 'JOINT') {
    joints.push({ name: parts[1], parent: stack.length ? stack[stack.length - 1] : -1, offset: [0, 0, 0], ch: [] });
    stack.push(joints.length - 1);
  } else if (parts[0] === 'End') {
    joints.push({ name: 'End', parent: stack[stack.length - 1], offset: [0, 0, 0], ch: [] });
    stack.push(joints.length - 1);
  } else if (parts[0] === 'OFFSET') {
    joints[stack[stack.length - 1]].offset = parts.slice(1).map(Number);
  } else if (parts[0] === 'CHANNELS') {
    joints[stack[stack.length - 1]].ch = parts.slice(2);
  } else if (parts[0] === '}') {
    stack.pop();
  }
}
const nFrames = parseInt(lines[li + 1].split(/\s+/)[1], 10);
const dt = parseFloat(lines[li + 2].split(/\s+/)[2]);
const rows = [];
for (let k = 0; k < nFrames; k++) rows.push(lines[li + 3 + k].trim().split(/\s+/).map(Number));

const rotAxis = (a, v) => {
  const c = Math.cos(v), s = Math.sin(v);
  if (a === 'X') return [1, 0, 0, 0, c, -s, 0, s, c];
  if (a === 'Y') return [c, 0, s, 0, 1, 0, -s, 0, c];
  return [c, -s, 0, s, c, 0, 0, 0, 1];
};
const mm = (a, b) => {
  const r = new Array(9).fill(0);
  for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) for (let z = 0; z < 3; z++) r[x * 3 + y] += a[x * 3 + z] * b[z * 3 + y];
  return r;
};
const mv = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];

// world position of every joint in one frame
function worldPositions(row) {
  const pos = [], rot = [];
  let c = 0;
  for (let j = 0; j < joints.length; j++) {
    const jt = joints[j];
    let R = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const T = [0, 0, 0];
    for (const ch of jt.ch) {
      const v = row[c++];
      if (ch.endsWith('position')) T[ch[0].toLowerCase().charCodeAt(0) - 120] = v;
      else R = mm(R, rotAxis(ch[0], v * D));
    }
    if (jt.parent < 0) {
      pos.push([T[0] + jt.offset[0], T[1] + jt.offset[1], T[2] + jt.offset[2]]);
      rot.push(R);
    } else {
      const o = mv(rot[jt.parent], jt.offset);
      const p = pos[jt.parent];
      pos.push([p[0] + o[0], p[1] + o[1], p[2] + o[2]]);
      rot.push(mm(rot[jt.parent], R));
    }
  }
  return pos;
}
const J = (n) => {
  const k = joints.findIndex((j) => j.name === n);
  if (k < 0) throw new Error(`joint ${n} not in ${bvhPath}`);
  return k;
};
const IDX = {
  hips: J('Hips'), rUp: J('RightUpLeg'), rLeg: J('RightLeg'), rFoot: J('RightFoot'), rToe: J('RightToeBase'),
  lUp: J('LeftUpLeg'), lLeg: J('LeftLeg'), lFoot: J('LeftFoot'), lToe: J('LeftToeBase'),
  rArm: J('RightArm'), rFore: J('RightForeArm'), rHand: J('RightHand'),
  lArm: J('LeftArm'), lFore: J('LeftForeArm'), lHand: J('LeftHand'), neck: J('Neck'),
};

// ---------- vector helpers
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const nrm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const clamp1 = (x) => Math.max(-1, Math.min(1, x));

// body-local frame for one frame: x = forward (the toes point that way), y = up, z = the player's right
function bodyFrame(P) {
  const up = [0, 1, 0];
  let R = nrm([sub(P[IDX.lUp], P[IDX.rUp])[0], 0, sub(P[IDX.lUp], P[IDX.rUp])[2]]);
  let F = nrm(crs(up, R));
  const toe = sub(P[IDX.rToe], P[IDX.rFoot]);
  if (dot(F, toe) < 0) { F = [-F[0], 0, -F[2]]; R = [-R[0], 0, -R[2]]; }
  return { to: (v) => [dot(v, F), dot(v, up), dot(v, R)] };
}

// the reference's joint angles for one frame, in our skeleton's conventions
function solveFrame(row) {
  const P = worldPositions(row);
  const B = bodyFrame(P);
  const b = (k) => B.to(P[k]);
  const trunk = sub(b(IDX.neck), b(IDX.hips));
  // our arm angles are relative to the trunk (spine and chest bend forward by trunkFlex), so the
  // reference arm is turned into trunk coordinates first: the inverse of skeleton.js's trunk bend
  const tf = Math.atan2(trunk[0], trunk[1]);
  const untilt = (v) => [v[0] * Math.cos(tf) - v[1] * Math.sin(tf), v[0] * Math.sin(tf) + v[1] * Math.cos(tf), v[2]];
  const arm = (sh0, el0, wr0) => {
    const sh = untilt(sh0), el = untilt(el0), wr = untilt(wr0);
    const u = nrm(sub(el, sh)), f = nrm(sub(wr, el));
    return {
      flex: Math.atan2(u[0], -u[1]),           // from straight down; forward positive
      abd: Math.asin(clamp1(u[2])),            // out to the side; positive
      elbow: Math.acos(clamp1(dot(u, f))),     // 0 straight
    };
  };
  const leg = (hip, kn, an) => {
    const th = nrm(sub(kn, hip)), sh = nrm(sub(an, kn));
    return {
      flex: Math.atan2(th[0], -th[1]),
      abd: Math.asin(clamp1(th[2])),
      knee: Math.acos(clamp1(dot(th, sh))),    // 0 straight
    };
  };
  const low = Math.min(P[IDX.rFoot][1], P[IDX.lFoot][1], P[IDX.rToe][1], P[IDX.lToe][1]);
  return {
    P, B,
    trunkFlex: Math.atan2(trunk[0], trunk[1]),
    trunkLat: Math.atan2(trunk[2], trunk[1]),
    rA: arm(b(IDX.rArm), b(IDX.rFore), b(IDX.rHand)),
    lA: arm(b(IDX.lArm), b(IDX.lFore), b(IDX.lHand)),
    rL: leg(b(IDX.rUp), b(IDX.rLeg), b(IDX.rFoot)),
    lL: leg(b(IDX.lUp), b(IDX.lLeg), b(IDX.lFoot)),
    low,
  };
}

// ---------- build the clip
const s0 = Math.round(parseFloat(sStart) / dt);
const s1 = Math.round(parseFloat(sEnd) / dt);
// The floor is the median lowest foot point over the clip: the feet are on the floor for most of a
// jump shot, and the toes dip below standing level on landing, so the minimum would be too low.
const lows = [];
for (let k = s0; k <= s1; k++) lows.push(solveFrame(rows[k]).low);
lows.sort((x, y) => x - y);
const floorRef = lows[Math.floor(lows.length / 2)];

// our rig's root lift that puts the feet on the floor at rest (the grounding skeleton.js does)
const restRoot = (() => {
  const f0 = fk({ ...fill({}), root: { lift: 0 } });
  return -Math.min(f0.anR.p[1], f0.anL.p[1], f0.toeR.p[1], f0.toeL.p[1]);
})();

const frames = [];
for (let k = s0; k <= s1; k++) {
  const s = solveFrame(rows[k]);
  const clearance = Math.max(0, (s.low - floorRef) * UNIT);   // metres the reference's feet are above the floor
  // our own feet: lower the root until our lowest sole touches the floor, then add the reference clearance,
  // so the feet land on the floor when the reference's are on it, whatever our leg lengths are
  const ours0 = fk({ spine: [0, 0, 0], chest: [0, 0, 0], shR: [0, 0, 0], elR: 0, wrR: [0, 0], shL: [0, 0, 0], elL: 0, wrL: [0, 0],
    hipR: [0, 0, 0], knR: 0, hipL: [0, 0, 0], knL: 0, root: { lift: 0 } });
  void ours0;
  const probe = {
    spine: [0, 0, 0],
    chest: [0, 0, 0],
    hipR: [+s.rL.flex.toFixed(4), +s.rL.abd.toFixed(4), 0], knR: +s.rL.knee.toFixed(4),
    hipL: [+s.lL.flex.toFixed(4), +s.lL.abd.toFixed(4), 0], knL: +s.lL.knee.toFixed(4),
    root: { lift: 0 },
  };
  const pr = fk(probe);
  const ourLow = Math.min(pr.anR.p[1], pr.anL.p[1], pr.toeR.p[1], pr.toeL.p[1]);
  frames.push({
    _clear: clearance,   // kept until the root is grounded again after smoothing
    t: +((k - s0) * dt).toFixed(4),
    root: { lift: +(-ourLow + clearance).toFixed(4) },
    spine: [+(s.trunkFlex * 0.5).toFixed(4), +(s.trunkLat * 0.5).toFixed(4), 0],
    chest: [+(s.trunkFlex * 0.5).toFixed(4), 0, 0],
    shR: [+s.rA.flex.toFixed(4), +s.rA.abd.toFixed(4), 0], elR: +s.rA.elbow.toFixed(4), wrR: [0, 0],
    shL: [+s.lA.flex.toFixed(4), +s.lA.abd.toFixed(4), 0], elL: +s.lA.elbow.toFixed(4), wrL: [0, 0],
    hipR: [+s.rL.flex.toFixed(4), +s.rL.abd.toFixed(4), 0], knR: +s.rL.knee.toFixed(4),
    hipL: [+s.lL.flex.toFixed(4), +s.lL.abd.toFixed(4), 0], knL: +s.lL.knee.toFixed(4),
  });
}

// ---------- arm inverse kinematics. The closed-form shoulder angles are ill-conditioned when the
// arm swings out to the side, so each arm is instead fitted: flex, abduction and elbow are solved by
// Gauss-Newton on our own forward kinematics, so the elbow and wrist land where the reference puts
// them (relative to the shoulder, in the hips frame), starting from the previous frame.
function ikArm(side, n, seed) {
  const sref = solveFrame(rows[s0 + n]);
  const P = sref.P, B = sref.B;
  const sh = B.to(P[side === 'R' ? IDX.rArm : IDX.lArm]);
  const elT = sub(B.to(P[side === 'R' ? IDX.rFore : IDX.lFore]), sh).map((v) => v * UNIT);
  const wrT = sub(B.to(P[side === 'R' ? IDX.rHand : IDX.lHand]), sh).map((v) => v * UNIT);
  const K = side;
  const resid = (x, base) => {
    const fr = { ...base, [`sh${K}`]: [x[0], x[1], 0], [`el${K}`]: x[2], [`wr${K}`]: [0, 0] };
    const o = fk(fr);
    const s0v = o[`sh${K}`].p;
    const e = sub(o[`el${K}`].p, s0v), w = sub(o[`wr${K}`].p, s0v);
    return [e[0] - elT[0], e[1] - elT[1], e[2] - elT[2], w[0] - wrT[0], w[1] - wrT[1], w[2] - wrT[2]];
  };
  let x = seed.slice();
  for (let it = 0; it < 12; it++) {
    const r = resid(x, frames[n]);
    const J = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let c = 0; c < 3; c++) {
      const h = 1e-5, xp = x.slice(); xp[c] += h;
      const rp = resid(xp, frames[n]);
      for (let k = 0; k < 6; k++) J[k][c] = (rp[k] - r[k]) / h;
    }
    // normal equations (JtJ + lambda I) dx = -Jt r
    const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], g = [0, 0, 0];
    for (let a = 0; a < 3; a++) {
      for (let b = 0; b < 3; b++) for (let k = 0; k < 6; k++) A[a][b] += J[k][a] * J[k][b];
      for (let k = 0; k < 6; k++) g[a] -= J[k][a] * r[k];
      A[a][a] += 1e-6;
    }
    const det = A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
    if (Math.abs(det) < 1e-12) break;
    const inv = (m) => [
      [(m[1][1] * m[2][2] - m[1][2] * m[2][1]) / det, -(m[0][1] * m[2][2] - m[0][2] * m[2][1]) / det, (m[0][1] * m[1][2] - m[0][2] * m[1][1]) / det],
      [-(m[1][0] * m[2][2] - m[1][2] * m[2][0]) / det, (m[0][0] * m[2][2] - m[0][2] * m[2][0]) / det, -(m[0][0] * m[1][2] - m[0][2] * m[1][0]) / det],
      [(m[1][0] * m[2][1] - m[1][1] * m[2][0]) / det, -(m[0][0] * m[2][1] - m[0][1] * m[2][0]) / det, (m[0][0] * m[1][1] - m[0][1] * m[1][0]) / det],
    ];
    const Ai = inv(A);
    const dx = [0, 1, 2].map((a) => Ai[a][0] * g[0] + Ai[a][1] * g[1] + Ai[a][2] * g[2]);
    for (let a = 0; a < 3; a++) x[a] += dx[a];
    if (Math.hypot(...dx) < 1e-7) break;
  }
  return x;
}
{
  let seedR = [frames[0].shR[0], frames[0].shR[1], frames[0].elR];
  let seedL = [frames[0].shL[0], frames[0].shL[1], frames[0].elL];
  for (let n = 0; n < frames.length; n++) {
    seedR = ikArm('R', n, seedR);
    seedL = ikArm('L', n, seedL);
    frames[n].shR = [+seedR[0].toFixed(4), +seedR[1].toFixed(4), 0]; frames[n].elR = +seedR[2].toFixed(4);
    frames[n].shL = [+seedL[0].toFixed(4), +seedL[1].toFixed(4), 0]; frames[n].elL = +seedL[2].toFixed(4);
  }
}

// ---------- smooth the angles: the shoulder's flex/abduction split is ill-conditioned when the arm
// swings out to the side, which makes single frames spike. A 5-frame centred average (about 40 ms
// at 120 fps) removes the spikes; the error report below measures what that costs.
const SMOOTH = 5;
const smoothed = frames.map((fr, n) => {
  const out = { ...fr };
  const keys = ['spine', 'chest', 'shR', 'shL', 'hipR', 'hipL'];
  const lo = Math.max(0, n - Math.floor(SMOOTH / 2)), hi = Math.min(frames.length - 1, n + Math.floor(SMOOTH / 2));
  const avg = (get) => { let sum = 0; let c = 0; for (let m = lo; m <= hi; m++) { sum += get(frames[m]); c++; } return sum / c; };
  for (const k of keys) out[k] = frames[n][k].map((_, i) => +avg((f) => f[k][i]).toFixed(4));
  for (const k of ['elR', 'elL', 'knR', 'knL']) out[k] = +avg((f) => f[k]).toFixed(4);
  return out;
});
// ground each frame again on its smoothed legs, so the feet still land on the floor
for (const fr of smoothed) {
  const pr = fk({ spine: [0, 0, 0], chest: [0, 0, 0], hipR: fr.hipR, knR: fr.knR, hipL: fr.hipL, knL: fr.knL, root: { lift: 0 } });
  const low = Math.min(pr.anR.p[1], pr.anL.p[1], pr.toeR.p[1], pr.toeL.p[1]);
  fr.root = { lift: +(-low + fr._clear).toFixed(4) };
  delete fr._clear;
}
frames.splice(0, frames.length, ...smoothed);

// ---------- optional: dump the reference joints (metres, body-local, feet on the floor) for a visual check
const dumpPath = process.env.REF_DUMP;
if (dumpPath) {
  const names = ['hips', 'neck', 'rUp', 'rLeg', 'rFoot', 'rToe', 'lUp', 'lLeg', 'lFoot', 'lToe', 'rArm', 'rFore', 'rHand', 'lArm', 'lFore', 'lHand'];
  const seq = [];
  for (let k = s0; k <= s1; k++) {
    const P = worldPositions(rows[k]); const B = bodyFrame(P);
    const pt = {};
    const h = B.to(P[IDX.hips]).map((x) => x * UNIT);   // centre on the hips in x and z
    for (const n of names) { const v = B.to(P[IDX[n]]).map((x) => x * UNIT); pt[n] = [v[0] - h[0], v[1] - (floorRef * UNIT), v[2] - h[2]]; }
    seq.push(pt);
  }
  fs.writeFileSync(dumpPath, JSON.stringify({ dt, names, seq }));
  console.log('dumped', seq.length, 'frames to', dumpPath);
}

// ---------- error report: our wrist relative to our shoulder, against the reference's, in metres
const errs = [];
for (let n = 0; n < frames.length; n++) {
  const fr = frames[n];
  const sref = solveFrame(rows[s0 + n]);
  const refW = sref.B.to(sref.P[IDX.rHand]), refS = sref.B.to(sref.P[IDX.rArm]);
  const ours = fk({ ...fr });
  const dRef = sub(refW, refS).map((v) => v * UNIT);   // reference units -> metres
  const dOurs = sub(ours.wrR.p, ours.shR.p);
  errs.push(Math.hypot(...sub(dRef, dOurs)) * 100);
}
const mean = errs.reduce((a, b) => a + b, 0) / errs.length;
const max = Math.max(...errs);

const doc = {
  source: 'CMU Graphics Lab Motion Capture Database, subject 124, trial 5 (basketball jump shot). BVH from the cgspeed conversion by Bruce Hahne, mirrored at github.com/sfd158/cmu-mocap.',
  licence: 'Free for research and commercial projects (mocap.cs.cmu.edu). Acknowledgment: "The data used in this project was obtained from mocap.cs.cmu.edu. The database was created with funding from NSF EIA-0196217."',
  method: 'Joint angles solved from reference bone directions in body-local coordinates. Feet held flat by skeleton.js. Root lifted by the reference feet clearance above the floor.',
  units: { time: 's', angles: 'radians', length: 'metres' },
  clip: { file: bvhPath.split(/[\\/]/).pop(), fps: Math.round(1 / dt), startSec: +sStart, endSec: +sEnd, frames: frames.length },
  error: { wristRelativeToShoulderMeanCm: +mean.toFixed(2), wristRelativeToShoulderMaxCm: +max.toFixed(2) },
  frames,
};
// release: the frame where the right wrist is highest (the top of the shot)
let rel = 0;
for (let n = 1; n < frames.length; n++) {
  const w = (n) => { const q = solveFrame(rows[s0 + n]); return q.B.to(q.P[IDX.rHand])[1]; };
  if (w(n) > w(rel)) rel = n;
}
doc.release = { t: frames[rel].t, fraction: +(frames[rel].t / (frames.length * dt)).toFixed(4) };
fs.writeFileSync(outPath, JSON.stringify(doc));
// the same data as a JS module, so the library can import it in the browser and in node
const NL = String.fromCharCode(10);
const jsModule = '// Generated by tools/basketball/bvh_retarget.mjs. See the source and licence fields.' + NL
  + 'export const REF = ' + JSON.stringify(doc) + ';' + NL;
fs.writeFileSync(outPath.replace(/\.json$/, '.js'), jsModule);
console.log(`wrote ${outPath}: ${frames.length} frames, wrist vs reference: mean ${mean.toFixed(2)} cm, max ${max.toFixed(2)} cm`);
