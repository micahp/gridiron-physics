// Basketball sprite stack: the player is rasterised into horizontal layers, one
// RGBA image per height slice. The lab draws each layer as a flat plane at its
// height, so the stack reads as a solid body from any orbit angle.
//
// Body shape comes from the basketball skeleton (web/basketball/skeleton.js):
// every body part is a capsule (or sphere) between two joints, so the shape
// follows the joints exactly. Shading uses the surface normal of the nearest
// capsule axis, so limbs read as round.
import { fk } from './skeleton.js';
import { swipe, STRIKE_T } from './actions.js';

export const VOXEL = 0.025;           // layer height and horizontal pixel size, m
export const G = 64;                  // pixels per layer side
export const X0 = -0.6, Z0 = -0.8;    // world min corner of the grid
export const Y_TOP = 1.95;            // top of the stack, m
export const NL = Math.ceil(Y_TOP / VOXEL);
export const BALL_R = 0.12;
// The ball is held where the swipe's palm meets it: the palm at the strike time,
// pushed 14 cm forward so the palm touches the ball's surface.
export const BALL = (() => {
  const palm = fk(swipe(STRIKE_T)).palmR.p;
  return { c: [palm[0] + 0.14, palm[1], palm[2]], r: BALL_R };
})();

// Colour per part kind, 0-255 RGB.
export const COLOURS = {
  jersey: [232, 178, 48],
  shorts: [30, 58, 122],
  skin: [198, 134, 99],
  sock: [240, 240, 236],
  shoe: [28, 28, 30],
  ball: [222, 102, 32],
  hair: [30, 22, 18],
};

const SUN = norm([0.45, 0.8, 0.35]);

function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** Body parts for a skeleton pose. Each: { kind, a, b (segment) or c (sphere centre), r }. */
export function bodyParts(f) {
  const P = (n) => f[n].p;
  const head = P('head');
  return [
    { kind: 'hair', c: [head[0] + 0.005, head[1] + 0.12, head[2]], r: 0.105 },
    { kind: 'skin', a: P('neck'), b: head, r: 0.05 },
    { kind: 'jersey', a: P('chest'), b: P('pelvis'), r: 0.15 },
    { kind: 'jersey', a: P('shR'), b: P('shL'), r: 0.07 },
    { kind: 'shorts', a: P('hipR'), b: P('hipL'), r: 0.13 },
    { kind: 'jersey', a: P('shR'), b: P('elR'), r: 0.05 },
    { kind: 'skin', a: P('elR'), b: P('wrR'), r: 0.042 },
    { kind: 'skin', a: P('wrR'), b: P('palmR'), r: 0.045 },
    { kind: 'jersey', a: P('shL'), b: P('elL'), r: 0.05 },
    { kind: 'skin', a: P('elL'), b: P('wrL'), r: 0.042 },
    { kind: 'skin', a: P('wrL'), b: P('palmL'), r: 0.045 },
    { kind: 'shorts', a: P('hipR'), b: P('knR'), r: 0.075 },
    { kind: 'sock', a: P('knR'), b: P('anR'), r: 0.052 },
    { kind: 'shoe', a: P('anR'), b: P('toeR'), r: 0.042 },
    { kind: 'shorts', a: P('hipL'), b: P('knL'), r: 0.075 },
    { kind: 'sock', a: P('knL'), b: P('anL'), r: 0.052 },
    { kind: 'shoe', a: P('anL'), b: P('toeL'), r: 0.042 },
    { kind: 'ball', c: BALL.c, r: BALL.r },
  ];
}

// Signed distance to a part, and the outward normal at the nearest surface point.
function partHit(p, part, out) {
  let cx, cy, cz;
  if (part.c) {
    cx = part.c[0]; cy = part.c[1]; cz = part.c[2];
  } else {
    const [ax, ay, az] = part.a, [bx, by, bz] = part.b;
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const L2 = dx * dx + dy * dy + dz * dz || 1e-9;
    let t = ((p[0] - ax) * dx + (p[1] - ay) * dy + (p[2] - az) * dz) / L2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    cx = ax + t * dx; cy = ay + t * dy; cz = az + t * dz;
  }
  const ex = p[0] - cx, ey = p[1] - cy, ez = p[2] - cz;
  const d = Math.hypot(ex, ey, ez);
  out.d = d - part.r;
  out.nx = d > 1e-9 ? ex / d : 0;
  out.ny = d > 1e-9 ? ey / d : 1;
  out.nz = d > 1e-9 ? ez / d : 0;
  return out.d;
}

/**
 * Rasterise a pose into layers. Returns { data: Uint8ClampedArray NL*G*G*4 (RGBA),
 * layer k, row r, col i at index ((k*G + r)*G + i)*4 }. Row r runs from the +z edge
 * (r = 0) to the -z edge, so a plane's texture reads the right way up from above.
 */
export function rasterise(pose) {
  const f = fk(pose);
  const parts = bodyParts(f).map(boxed);
  const data = new Uint8ClampedArray(NL * G * G * 4);
  const hit = { d: 0, nx: 0, ny: 0, nz: 0 };
  const p = [0, 0, 0];
  for (let k = 0; k < NL; k++) {
    const y = (k + 0.5) * VOXEL;
    p[1] = y;
    // only parts whose height range reaches this layer
    const live = parts.filter((q) => y >= q.lo[1] && y <= q.hi[1]);
    if (live.length === 0) continue;
    for (let r = 0; r < G; r++) {
      const z = Z0 + (G - r - 0.5) * VOXEL;
      p[2] = z;
      for (let i = 0; i < G; i++) {
        const x = X0 + (i + 0.5) * VOXEL;
        p[0] = x;
        let best = Infinity, bestPart = null, bnx = 0, bny = 0, bnz = 0;
        for (const part of live) {
          if (x < part.lo[0] || x > part.hi[0] || z < part.lo[2] || z > part.hi[2]) continue;
          const d = partHit(p, part, hit);
          if (d < best) { best = d; bestPart = part; bnx = hit.nx; bny = hit.ny; bnz = hit.nz; }
        }
        if (!bestPart || best > 0) continue;
        const o = ((k * G + r) * G + i) * 4;
        const col = COLOURS[bestPart.kind];
        const lam = Math.max(0, bnx * SUN[0] + bny * SUN[1] + bnz * SUN[2]);
        const shade = 0.4 + 0.6 * lam;
        data[o] = Math.min(255, col[0] * shade);
        data[o + 1] = Math.min(255, col[1] * shade);
        data[o + 2] = Math.min(255, col[2] * shade);
        data[o + 3] = 255;
      }
    }
  }
  return { data, pose: f };
}

// Bounding box of a part, expanded by its radius: used to skip it cheaply.
function boxed(part) {
  const pts = part.c ? [part.c] : [part.a, part.b];
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const q of pts) for (let j = 0; j < 3; j++) { lo[j] = Math.min(lo[j], q[j] - part.r); hi[j] = Math.max(hi[j], q[j] + part.r); }
  return { ...part, lo, hi };
}

/** Rasterise the swipe at time t (0..1). */
export function swipeFrame(t) {
  return rasterise(swipe(t));
}
