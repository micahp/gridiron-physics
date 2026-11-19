// Voxel body of the football player, modelled from scratch as signed-distance
// shapes on the skeleton in skeleton.js. A pose is voxelised at any voxel size
// (resolution is a free parameter), then encoded for the sprite stack:
//   byte 0: palette index (bits 0-4, 0 = empty) | ambient occlusion (bits 5-7)
//   byte 1: normal x,z as 4+4 bits, or jersey-number plate u,v for number voxels
import { fk, applyT } from './skeleton.js';

export const PAL = {
  JERSEY: 1, TRIM: 2, NUM_F: 3, NUM_B: 4, PANTS: 5, PANT_STRIPE: 6, HELMET: 7, HELMET_STRIPE: 8,
  MASK: 9, SKIN: 10, SKIN_DARK: 11, GLOVE: 12, SOCK: 13, SOCK_STRIPE: 14, CLEAT: 15, SOLE: 16,
  BALL: 17, LACES: 18, TAPE: 19, BELT: 20, EYE: 21, PAD_DARK: 22, NUM_SH: 23,
};
const P = PAL;

// ---------------------------------------------------------------- SDF shapes
const len3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);
function sdRoundBox(p, c, h, r) {
  const qx = Math.abs(p[0] - c[0]) - h[0] + r, qy = Math.abs(p[1] - c[1]) - h[1] + r, qz = Math.abs(p[2] - c[2]) - h[2] + r;
  return len3(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r;
}
function sdEllipsoid(p, c, r) {
  const x = (p[0] - c[0]) / r[0], y = (p[1] - c[1]) / r[1], z = (p[2] - c[2]) / r[2];
  const k0 = len3(x, y, z);
  const k1 = len3(x / r[0], y / r[1], z / r[2]);
  return k1 < 1e-9 ? -Math.min(...r) : (k0 * (k0 - 1)) / k1;
}
function sdCone(p, a, b, ra, rb) {   // capsule with linearly varying radius
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const pax = p[0] - a[0], pay = p[1] - a[1], paz = p[2] - a[2];
  const h = Math.min(1, Math.max(0, (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz)));
  return len3(pax - bax * h, pay - bay * h, paz - baz * h) - (ra + (rb - ra) * h);
}

// ---------------------------------------------------------------- parts
// Each part lives in one joint's frame. bounds: local [min, max] for the scan.
// mat(p, side) returns a palette index, or [index, u, v] for number plates.
const parts = [];
const part = (o) => parts.push({ prio: 1, thin: false, ...o });

// pelvis / pants seat
part({
  joint: 'pelvis', bounds: [[-0.2, -0.12, -0.22], [0.2, 0.2, 0.22]],
  sdf: (p) => sdRoundBox(p, [0, 0.04, 0], [0.125, 0.115, 0.168], 0.07),
  mat: (p) => (p[1] > 0.115 ? P.BELT : Math.abs(p[0]) < 0.022 && Math.abs(p[2]) > 0.12 ? P.PANT_STRIPE : P.PANTS),
});
// abdomen
part({
  joint: 'spine', bounds: [[-0.18, -0.05, -0.2], [0.18, 0.26, 0.2]],
  sdf: (p) => sdRoundBox(p, [0, 0.1, 0], [0.118, 0.12, 0.152], 0.065),
  mat: () => P.JERSEY,
});
// chest with number plates front and back
part({
  joint: 'chest', bounds: [[-0.2, -0.06, -0.24], [0.2, 0.34, 0.24]],
  sdf: (p) => sdRoundBox(p, [0, 0.13, 0], [0.138, 0.16, 0.178], 0.075),
  mat: (p) => {
    const u = (z) => Math.min(15, Math.max(0, Math.round(z * 15)));
    if (p[1] > -0.02 && p[1] < 0.24 && Math.abs(p[2]) < 0.135) {
      const v = u((p[1] + 0.02) / 0.26);
      if (p[0] > 0.085) return [P.NUM_F, u((0.135 - p[2]) / 0.27), v];
      if (p[0] < -0.085) return [P.NUM_B, u((p[2] + 0.135) / 0.27), v];
    }
    return P.JERSEY;
  },
});
// shoulder pads: wide ellipsoid over the chest + round caps over each shoulder
part({
  joint: 'chest', prio: 2, bounds: [[-0.24, 0.14, -0.38], [0.24, 0.36, 0.38]],
  sdf: (p) => sdEllipsoid(p, [-0.01, 0.255, 0], [0.19, 0.088, 0.33]),
  mat: (p) => (Math.abs(Math.abs(p[2]) - 0.23) < 0.022 ? P.TRIM : p[1] < 0.2 ? P.PAD_DARK : P.JERSEY),
});
for (const s of [1, -1]) {
  part({
    joint: 'chest', prio: 2, bounds: [[-0.15, 0.08, s > 0 ? 0.12 : -0.4], [0.15, 0.36, s > 0 ? 0.4 : -0.12]],
    sdf: (p) => sdEllipsoid(p, [-0.01, 0.215, s * 0.255], [0.115, 0.11, 0.1]),
    mat: (p) => (p[1] < 0.15 && Math.abs(p[1] - 0.13) < 0.02 ? P.TRIM : P.JERSEY),
  });
}
// neck
part({
  joint: 'neck', bounds: [[-0.09, -0.05, -0.09], [0.09, 0.15, 0.09]],
  sdf: (p) => sdCone(p, [0, -0.02, 0], [0, 0.1, 0], 0.068, 0.062),
  mat: () => P.SKIN,
});
// helmet with face opening, stripe and ear hole
part({
  joint: 'head', prio: 2, bounds: [[-0.2, -0.08, -0.17], [0.2, 0.28, 0.17]],
  sdf: (p) => {
    const shell = sdEllipsoid(p, [0.0, 0.1, 0], [0.16, 0.152, 0.138]);
    const hole = sdRoundBox(p, [0.17, 0.055, 0], [0.13, 0.075, 0.085], 0.03);
    return Math.max(shell, -hole);
  },
  mat: (p) => {
    if (Math.abs(p[2]) < 0.026 && p[1] > 0.15) return P.HELMET_STRIPE;
    if (Math.abs(p[2]) > 0.1 && Math.hypot(p[0] - 0.0, p[1] - 0.07) < 0.025) return P.MASK;   // ear hole
    return P.HELMET;
  },
});
// face inside the helmet
part({
  joint: 'head', prio: 1, bounds: [[-0.1, -0.06, -0.1], [0.16, 0.2, 0.1]],
  sdf: (p) => sdEllipsoid(p, [0.035, 0.065, 0], [0.1, 0.11, 0.088]),
  mat: (p) => (p[1] > 0.075 && p[1] < 0.105 && p[0] > 0.08 ? P.EYE : p[1] < 0.02 ? P.SKIN_DARK : P.SKIN),
});
// face mask bars (thin: always survive voxelisation)
const bars = [
  [[0.145, 0.04, -0.085], [0.145, 0.04, 0.085], 0.011],
  [[0.14, 0.0, -0.075], [0.14, 0.0, 0.075], 0.011],
  [[0.12, -0.035, -0.06], [0.12, -0.035, 0.06], 0.011],
  [[0.145, -0.03, 0], [0.145, 0.09, 0], 0.01],
  [[0.08, 0.05, 0.12], [0.145, 0.04, 0.085], 0.011],
  [[0.08, 0.05, -0.12], [0.145, 0.04, -0.085], 0.011],
  [[0.06, -0.01, 0.11], [0.12, -0.035, 0.06], 0.01],
  [[0.06, -0.01, -0.11], [0.12, -0.035, -0.06], 0.01],
];
part({
  joint: 'head', prio: 3, thin: true, bounds: [[0.04, -0.06, -0.14], [0.17, 0.11, 0.14]],
  sdf: (p) => Math.min(...bars.map(([a, b, r]) => sdCone(p, a, b, r, r))),
  mat: () => P.MASK,
});
// arms
for (const s of [1, -1]) {
  const sh = s > 0 ? 'shR' : 'shL', el = s > 0 ? 'elR' : 'elL', wr = s > 0 ? 'wrR' : 'wrL';
  part({
    joint: sh, bounds: [[-0.09, -0.33, -0.09], [0.09, 0.06, 0.09]],
    sdf: (p) => sdCone(p, [0, -0.02, 0], [0, -0.29, 0], 0.074, 0.056),
    mat: (p) => (p[1] > -0.085 ? P.JERSEY : p[1] > -0.115 ? P.TRIM : P.SKIN),
  });
  part({
    joint: el, bounds: [[-0.07, -0.28, -0.07], [0.07, 0.05, 0.07]],
    sdf: (p) => sdCone(p, [0, 0, 0], [0, -0.245, 0], 0.056, 0.043),
    mat: (p) => (p[1] < -0.18 ? P.TAPE : P.SKIN),
  });
  // gloved hand: palm with a cuff, four two-jointed fingers and a thumb
  const fi = s > 0 ? 'fiR' : 'fiL', fi2 = s > 0 ? 'fi2R' : 'fi2L', th = s > 0 ? 'thR' : 'thL';
  part({
    joint: wr, hand: true, bounds: [[-0.07, -0.12, -0.05], [0.07, 0.03, 0.05]],
    sdf: (p) => Math.min(
      sdRoundBox(p, [0.002, -0.055, 0], [0.044, 0.05, 0.021], 0.017),
      sdCone(p, [0, 0.012, 0], [0, -0.02, 0], 0.042, 0.04),             // cuff
    ),
    mat: (p) => (p[1] > -0.012 ? P.TAPE : P.GLOVE),
  });
  const FX = [0.03, 0.0105, -0.0095, -0.0285], L1 = [0.046, 0.048, 0.046, 0.038], L2 = [0.04, 0.044, 0.041, 0.031];
  part({
    joint: fi, hand: true, thin: true, bounds: [[-0.05, -0.06, -0.025], [0.05, 0.015, 0.025]],
    sdf: (p) => Math.min(...FX.map((x, k) => sdCone(p, [x, 0.004, 0], [x, -L1[k], 0], 0.0098, 0.0092))),
    mat: () => P.GLOVE,
  });
  part({
    joint: fi2, hand: true, thin: true, bounds: [[-0.05, -0.06, -0.025], [0.05, 0.015, 0.025]],
    sdf: (p) => Math.min(...FX.map((x, k) => { const y0 = 0.046 - L1[k] + 0.002; return sdCone(p, [x, y0, 0], [x, y0 - L2[k], 0], 0.009, 0.0082); })),
    mat: () => P.GLOVE,
  });
  part({
    joint: th, hand: true, thin: true, bounds: [[-0.03, -0.07, -0.04], [0.05, 0.02, 0.04]],
    sdf: (p) => sdCone(p, [0, 0, 0], [0.018, -0.05, -s * 0.012], 0.0125, 0.0098),
    mat: () => P.GLOVE,
  });
}
// legs
for (const s of [1, -1]) {
  const hip = s > 0 ? 'hipR' : 'hipL', kn = s > 0 ? 'knR' : 'knL', an = s > 0 ? 'anR' : 'anL';
  part({
    joint: hip, bounds: [[-0.12, -0.5, -0.12], [0.12, 0.06, 0.12]],
    sdf: (p) => sdCone(p, [0, -0.01, 0], [0, -0.44, 0], 0.102, 0.072),
    mat: (p) => (Math.abs(p[0]) < 0.02 && p[2] * s > 0.03 ? P.PANT_STRIPE : P.PANTS),
  });
  part({
    joint: kn, bounds: [[-0.09, -0.44, -0.09], [0.1, 0.06, 0.09]],
    sdf: (p) => Math.min(
      sdCone(p, [0, 0, 0], [0, -0.41, 0], 0.07, 0.046),
      sdEllipsoid(p, [0.035, -0.01, 0], [0.06, 0.07, 0.068]),  // knee pad bulge
    ),
    mat: (p) => (p[1] > -0.07 ? P.PANTS : (p[1] < -0.11 && p[1] > -0.15) || (p[1] < -0.18 && p[1] > -0.2) ? P.SOCK_STRIPE : P.SOCK),
  });
  part({
    joint: an, bounds: [[-0.1, -0.09, -0.07], [0.2, 0.04, 0.07]],
    sdf: (p) => Math.min(
      sdRoundBox(p, [0.05, -0.04, 0], [0.13, 0.036, 0.049], 0.028),
      sdCone(p, [0, 0.0, 0], [0, -0.04, 0], 0.05, 0.05),
    ),
    mat: (p) => (p[1] < -0.063 ? P.SOLE : P.CLEAT),
  });
}

// the ball, placed by pose.ball
function ballPart(J, where) {
  const R = (n) => J[n].R, Pp = (n) => J[n].p;
  const at = (n, c) => { const o = J[n].R; return [Pp(n)[0] + o[0] * c[0] + o[1] * c[1] + o[2] * c[2], Pp(n)[1] + o[3] * c[0] + o[4] * c[1] + o[5] * c[2], Pp(n)[2] + o[6] * c[0] + o[7] * c[1] + o[8] * c[2]]; };
  let joint, c, r;
  switch (where) {
    case 'R': joint = 'elR'; c = [0.075, -0.13, 0.02]; r = [0.085, 0.14, 0.085]; break;
    case 'L': joint = 'elL'; c = [0.075, -0.13, -0.02]; r = [0.085, 0.14, 0.085]; break;
    case 'handR': joint = 'wrR'; c = [0.07, -0.1, 0]; r = [0.14, 0.085, 0.085]; break;
    case 'chest': joint = 'chest'; c = [0.24, 0.1, 0.02]; r = [0.14, 0.085, 0.085]; break;
    case 'hands': {
      const a = at('wrR', [0.03, -0.08, 0]), b = at('wrL', [0.03, -0.08, 0]);
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
      return { world: true, center: mid, R: J.chest.R, r: [0.085, 0.085, 0.14] };
    }
    default: return null;
  }
  return { world: true, center: at(joint, c), R: R(joint), r };
}

// the smooth skinned mesh (web/mesh/) is built from the same shapes
export { parts as PARTS, bars as MASK_BARS, ballPart };
export { sdRoundBox, sdEllipsoid, sdCone };

// ---------------------------------------------------------------- voxeliser
/**
 * Voxelise a pose. size: voxel edge (m). Returns
 *   { v, G, i0, j0, gx, gz, nl, data: Uint8Array(gx*gz*nl*2) }  layer-major, then z rows, then x
 * The footprint is G x G cells centred on the pelvis; layer 0 sits on the ground
 * (lowest voxel touches y = 0 unless the pose lifts off with root.lift).
 */
export function voxelize(pose, size) {
  const J = fk(pose);
  const lift = J._pose.root.lift || 0;
  const v = size;
  const half = 1.15;
  const G = Math.ceil((2 * half) / v);
  const yLo = -0.7, HT = Math.ceil(3.4 / v);
  const N = G * G * HT;
  const idx = new Uint8Array(N), uv = new Uint8Array(N), pr = new Int8Array(N);
  const ox = -half, oz = -half;
  const cell = (i, j, k) => (k * G + j) * G + i;

  const scan = (R, pos, bounds, fn) => {
    // world AABB of the local bounds
    let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (let c = 0; c < 8; c++) {
      const l = [bounds[c & 1][0], bounds[(c >> 1) & 1][1], bounds[(c >> 2) & 1][2]];
      const w = [pos[0] + R[0] * l[0] + R[1] * l[1] + R[2] * l[2], pos[1] + R[3] * l[0] + R[4] * l[1] + R[5] * l[2], pos[2] + R[6] * l[0] + R[7] * l[1] + R[8] * l[2]];
      for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], w[a]); mx[a] = Math.max(mx[a], w[a]); }
    }
    const i0 = Math.max(0, Math.floor((mn[0] - ox) / v)), i1 = Math.min(G - 1, Math.floor((mx[0] - ox) / v));
    const j0 = Math.max(0, Math.floor((mn[2] - oz) / v)), j1 = Math.min(G - 1, Math.floor((mx[2] - oz) / v));
    const k0 = Math.max(0, Math.floor((mn[1] - yLo) / v)), k1 = Math.min(HT - 1, Math.floor((mx[1] - yLo) / v));
    const d = [0, 0, 0];
    for (let k = k0; k <= k1; k++) {
      const wy = yLo + (k + 0.5) * v;
      for (let j = j0; j <= j1; j++) {
        const wz = oz + (j + 0.5) * v;
        for (let i = i0; i <= i1; i++) {
          d[0] = ox + (i + 0.5) * v - pos[0]; d[1] = wy - pos[1]; d[2] = wz - pos[2];
          fn(cell(i, j, k), applyT(R, d));
        }
      }
    }
  };

  for (const pt of parts) {
    const jn = J[pt.joint];
    const thr = pt.thin ? v * 0.5 : v * 0.08;
    scan(jn.R, jn.p, pt.bounds, (c, l) => {
      if (pr[c] > pt.prio) return;
      if (pt.sdf(l) > thr) return;
      const m = pt.mat(l);
      if (pr[c] === pt.prio && idx[c] && idx[c] !== P.JERSEY && m === P.JERSEY) return;
      pr[c] = pt.prio;
      if (Array.isArray(m)) { idx[c] = m[0]; uv[c] = (m[1] << 4) | m[2]; } else { idx[c] = m; uv[c] = 0; }
    });
  }
  const bp = ballPart(J, J._pose.ball);
  if (bp) {
    const ext = Math.max(...bp.r);
    scan(bp.R, bp.center, [[-ext, -ext, -ext], [ext, ext, ext]], (c, l) => {
      const dd = sdEllipsoid(l, [0, 0, 0], bp.r);
      if (dd > v * 0.1) return;
      pr[c] = 5;
      // laces: a short white strip along the long axis on one face
      const long = bp.r[0] > bp.r[2] ? 0 : bp.r[1] > bp.r[2] ? 1 : 2;
      const across = long === 2 ? 0 : 2;
      const top = 3 - long - across;
      idx[c] = l[top] > bp.r[top] * 0.55 && Math.abs(l[long]) < bp.r[long] * 0.45 && Math.abs(l[across]) < 0.022 ? P.LACES : P.BALL;
    });
  }

  // ground the stack: lowest filled layer -> layer round(lift / v)
  let kmin = HT, kmax = -1, bi0 = G, bi1 = -1, bj0 = G, bj1 = -1;
  for (let k = 0; k < HT; k++) for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    if (!idx[cell(i, j, k)]) continue;
    if (k < kmin) kmin = k; if (k > kmax) kmax = k;
    if (i < bi0) bi0 = i; if (i > bi1) bi1 = i; if (j < bj0) bj0 = j; if (j > bj1) bj1 = j;
  }
  if (kmax < 0) return { v, G, i0: 0, j0: 0, gx: 1, gz: 1, nl: 1, data: new Uint8Array(2) };
  const base = Math.round(lift / v);
  const nl = kmax - kmin + 1 + base;
  const gx = bi1 - bi0 + 1, gz = bj1 - bj0 + 1;
  const occ = (i, j, k) => i >= 0 && j >= 0 && k >= 0 && i < G && j < G && k < HT && idx[cell(i, j, k)] ? 1 : 0;

  const data = new Uint8Array(gx * gz * nl * 2);
  for (let k = kmin; k <= kmax; k++) {
    const kk = k - kmin + base;
    for (let j = bj0; j <= bj1; j++) for (let i = bi0; i <= bi1; i++) {
      const c = cell(i, j, k);
      const m = idx[c];
      if (!m) continue;
      // normal from the occupancy gradient over a 5x5x5 neighbourhood; openness for AO
      let nx = 0, ny = 0, nz = 0, filled = 0;
      for (let dk = -2; dk <= 2; dk++) for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
        if (!occ(i + di, j + dj, k + dk)) continue;
        filled++;
        const w = 1 / (1 + di * di + dj * dj + dk * dk);
        nx -= di * w; ny -= dk * w; nz -= dj * w;
      }
      let sky = 0;
      for (let u = 1; u <= 10; u++) if (occ(i, j, k + u)) { sky = 1; break; }
      const nlen = Math.hypot(nx, ny, nz);
      if (nlen < 1e-6) { nx = 0; ny = 1; nz = 0; } else { nx /= nlen; ny /= nlen; nz /= nlen; }
      const open = 1 - filled / 125;
      let ao = Math.round(Math.min(1, Math.max(0, (open - 0.25) / 0.45)) * 7) - sky * 2;
      ao = Math.max(0, Math.min(7, ao));
      const o = ((kk * gz + (j - bj0)) * gx + (i - bi0)) * 2;
      data[o] = m | (ao << 5);
      if (m === P.NUM_F || m === P.NUM_B) data[o + 1] = uv[c];
      else {
        const q = (x) => Math.max(0, Math.min(15, Math.round((x * 0.5 + 0.5) * 15)));
        data[o + 1] = (q(nx) << 4) | q(nz);
      }
    }
  }
  return { v, G, i0: bi0, j0: bj0, gx, gz, nl, data };
}
