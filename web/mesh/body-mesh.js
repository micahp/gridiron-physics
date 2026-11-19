// Smooth skinned mesh of the football player, built from the same signed-distance
// body shapes and skeleton as the sprite stack (web/stack/body.js, skeleton.js).
//
//  1. Pose the skeleton in a bind pose (arms out so they don't fuse to the torso).
//  2. Sample the smooth union of every body shape on a grid and extract the
//     surface with surface nets, then snap each vertex onto the true surface.
//  3. Skin weights come from the distance to each shape: a vertex belongs to the
//     bones whose shapes are nearest, blended smoothly where shapes meet (elbows,
//     knees, shoulders, hips), so the joints bend without tearing.
//  4. Colour is a palette index per vertex (team kits swap in a uniform); jersey
//     numbers are drawn per pixel from a tiny font, so they stay crisp.
// The same pose code (actions.js) drives it live every frame: no baking.
import * as THREE from '../vendor/three.module.js';
import { mergeGeometries } from '../vendor/BufferGeometryUtils.js';
import { PARTS, MASK_BARS, ballPart, PAL } from '../stack/body.js';
import { fk, D, ORDER } from '../stack/skeleton.js';

const BIND = {
  shR: [0, 50 * D, 0], shL: [0, 50 * D, 0], elR: 8 * D, elL: 8 * D, wrR: [0, 0], wrL: [0, 0],
  hipR: [0, 7 * D, 0], hipL: [0, 7 * D, 0], knR: 3 * D, knL: 3 * D, gripR: 0.12, gripL: 0.12,
};

const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
const toLocal = (R, p, w) => {   // world point -> joint frame (R^T (w - p))
  const x = w[0] - p[0], y = w[1] - p[1], z = w[2] - p[2];
  return [R[0] * x + R[3] * y + R[6] * z, R[1] * x + R[4] * y + R[7] * z, R[2] * x + R[5] * y + R[8] * z];
};
const toWorld = (R, p, l) => [p[0] + R[0] * l[0] + R[1] * l[1] + R[2] * l[2], p[1] + R[3] * l[0] + R[4] * l[1] + R[5] * l[2], p[2] + R[6] * l[0] + R[7] * l[1] + R[8] * l[2]];

/**
 * Extract one smooth skinned surface from a set of shapes.
 *   h: grid spacing, K: smooth-union radius, sigma: skin-weight falloff (all metres)
 */
export function surface(J, list, h, K, sigma, ctx = { order: ORDER, numberJoint: 'chest' }) {
  const solid = list.map((p) => {
    const j = J[p.joint];
    const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (let c = 0; c < 8; c++) {
      const w = toWorld(j.R, j.p, [p.bounds[c & 1][0], p.bounds[(c >> 1) & 1][1], p.bounds[(c >> 2) & 1][2]]);
      for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], w[a]); mx[a] = Math.max(mx[a], w[a]); }
    }
    return { ...p, R: j.R, P: j.p, mn, mx, bone: ctx.order.indexOf(p.joint) };
  });
  const chestPart = solid.find((p) => p.joint === ctx.numberJoint && p.prio === 1);
  const inBox = (s, w, pad) => w[0] > s.mn[0] - pad && w[0] < s.mx[0] + pad && w[1] > s.mn[1] - pad && w[1] < s.mx[1] + pad && w[2] > s.mn[2] - pad && w[2] < s.mx[2] + pad;
  const field = (w) => {
    let d = 0.1;
    for (const s of solid) if (inBox(s, w, 0.02)) d = smin(d, s.sdf(toLocal(s.R, s.P, w)), K);
    return d;
  };

  // ---- sample the field on a grid
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
  for (const s of solid) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], s.mn[a]); hi[a] = Math.max(hi[a], s.mx[a]); }
  for (let a = 0; a < 3; a++) { lo[a] -= 2 * h; hi[a] += 2 * h; }
  const nx = Math.ceil((hi[0] - lo[0]) / h) + 1, ny = Math.ceil((hi[1] - lo[1]) / h) + 1, nz = Math.ceil((hi[2] - lo[2]) / h) + 1;
  const id = (i, j, k) => i + nx * (j + ny * k);
  const F = new Float32Array(nx * ny * nz).fill(0.1);
  for (const s of solid) {
    const i0 = Math.max(0, Math.floor((s.mn[0] - lo[0]) / h) - 1), i1 = Math.min(nx - 1, Math.ceil((s.mx[0] - lo[0]) / h) + 1);
    const j0 = Math.max(0, Math.floor((s.mn[1] - lo[1]) / h) - 1), j1 = Math.min(ny - 1, Math.ceil((s.mx[1] - lo[1]) / h) + 1);
    const k0 = Math.max(0, Math.floor((s.mn[2] - lo[2]) / h) - 1), k1 = Math.min(nz - 1, Math.ceil((s.mx[2] - lo[2]) / h) + 1);
    const w = [0, 0, 0];
    for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      w[0] = lo[0] + i * h; w[1] = lo[1] + j * h; w[2] = lo[2] + k * h;
      const n = id(i, j, k);
      F[n] = smin(F[n], s.sdf(toLocal(s.R, s.P, w)), K);
    }
  }

  // ---- surface nets
  const EDGES = [];
  for (let c = 0; c < 8; c++) for (const b of [1, 2, 4]) if (!(c & b)) EDGES.push([c, c | b]);
  const vid = new Int32Array(nx * ny * nz).fill(-1);
  const pos = [];
  const vals = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let mask = 0;
    for (let c = 0; c < 8; c++) { const v = F[id(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1))]; vals[c] = v; if (v < 0) mask |= 1 << c; }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, cnt = 0;
    for (const [a, b] of EDGES) {
      if (((mask >> a) & 1) === ((mask >> b) & 1)) continue;
      const t = vals[a] / (vals[a] - vals[b]);
      sx += (a & 1) + t * ((b & 1) - (a & 1));
      sy += ((a >> 1) & 1) + t * (((b >> 1) & 1) - ((a >> 1) & 1));
      sz += ((a >> 2) & 1) + t * (((b >> 2) & 1) - ((a >> 2) & 1));
      cnt++;
    }
    vid[id(i, j, k)] = pos.length / 3;
    pos.push(lo[0] + (i + sx / cnt) * h, lo[1] + (j + sy / cnt) * h, lo[2] + (k + sz / cnt) * h);
  }
  const tri = [];
  const quad = (a, b, c, d) => { if (a < 0 || b < 0 || c < 0 || d < 0) return; tri.push(a, b, c, a, c, d); };
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const s0 = F[id(i, j, k)] < 0;
    if (j > 0 && k > 0 && s0 !== (F[id(i + 1, j, k)] < 0))
      quad(vid[id(i, j - 1, k - 1)], vid[id(i, j, k - 1)], vid[id(i, j, k)], vid[id(i, j - 1, k)]);
    if (i > 0 && k > 0 && s0 !== (F[id(i, j + 1, k)] < 0))
      quad(vid[id(i - 1, j, k - 1)], vid[id(i, j, k - 1)], vid[id(i, j, k)], vid[id(i - 1, j, k)]);
    if (i > 0 && j > 0 && s0 !== (F[id(i, j, k + 1)] < 0))
      quad(vid[id(i - 1, j - 1, k)], vid[id(i, j - 1, k)], vid[id(i, j, k)], vid[id(i - 1, j, k)]);
  }

  // ---- snap to the true surface, normals from the gradient
  const nv = pos.length / 3;
  const nrm = new Float32Array(nv * 3);
  const e = Math.min(0.0025, h * 0.25);
  const grad = (w) => [
    (field([w[0] + e, w[1], w[2]]) - field([w[0] - e, w[1], w[2]])) / (2 * e),
    (field([w[0], w[1] + e, w[2]]) - field([w[0], w[1] - e, w[2]])) / (2 * e),
    (field([w[0], w[1], w[2] + e]) - field([w[0], w[1], w[2] - e])) / (2 * e),
  ];
  for (let v = 0; v < nv; v++) {
    const w = [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
    for (let it = 0; it < 2; it++) {
      const f = field(w), g = grad(w), gg = g[0] * g[0] + g[1] * g[1] + g[2] * g[2];
      if (gg < 1e-8) break;
      let sc = f / gg; const stepLen = Math.abs(sc) * Math.sqrt(gg);
      if (stepLen > h * 0.7) sc *= (h * 0.7) / stepLen;
      w[0] -= g[0] * sc; w[1] -= g[1] * sc; w[2] -= g[2] * sc;
    }
    pos[v * 3] = w[0]; pos[v * 3 + 1] = w[1]; pos[v * 3 + 2] = w[2];
    const g = grad(w), l = Math.hypot(...g) || 1;
    nrm[v * 3] = g[0] / l; nrm[v * 3 + 1] = g[1] / l; nrm[v * 3 + 2] = g[2] / l;
  }
  for (let t = 0; t < tri.length; t += 3) {
    const a = tri[t], b = tri[t + 1], c = tri[t + 2];
    const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
    const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    const dot = fx * (nrm[a * 3] + nrm[b * 3] + nrm[c * 3]) + fy * (nrm[a * 3 + 1] + nrm[b * 3 + 1] + nrm[c * 3 + 1]) + fz * (nrm[a * 3 + 2] + nrm[b * 3 + 2] + nrm[c * 3 + 2]);
    if (dot < 0) { tri[t + 1] = c; tri[t + 2] = b; }
  }

  // ---- skin weights, palette index and number-plate coordinates per vertex
  const skinI = new Uint16Array(nv * 4), skinW = new Float32Array(nv * 4);
  const pal = new Float32Array(nv), num = new Float32Array(nv * 3);
  const acc = new Float32Array(ctx.order.length);
  for (let v = 0; v < nv; v++) {
    const w = [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
    acc.fill(0);
    let best = null, bestD = 1e9, dmin = 1e9;
    const ds = [];
    for (const s of solid) {
      if (!inBox(s, w, sigma * 5)) continue;
      const l = toLocal(s.R, s.P, w);
      const d = s.sdf(l);
      ds.push([s, d]);
      if (d < dmin) dmin = d;
      const key = d - s.prio * 0.002;
      if (key < bestD) { bestD = key; best = [s, l]; }
    }
    for (const [s, d] of ds) acc[s.bone] += Math.exp(-(d - dmin) / sigma);
    const top = [...acc.keys()].sort((a, b) => acc[b] - acc[a]).slice(0, 4).filter((b) => acc[b] > 0);
    let sum = 0; for (const b of top) sum += acc[b];
    top.forEach((b, q) => { skinI[v * 4 + q] = b; skinW[v * 4 + q] = acc[b] / sum; });
    for (let q = 0; q < 4; q++) if (skinW[v * 4 + q] < 0.03) skinW[v * 4 + q] = 0;
    let s2 = 0; for (let q = 0; q < 4; q++) s2 += skinW[v * 4 + q];
    for (let q = 0; q < 4; q++) skinW[v * 4 + q] /= s2 || 1;
    const [s, l] = best;
    let m = s.mat(l);
    if (Array.isArray(m)) m = m[0];
    pal[v] = m;
    if (s === chestPart && Math.abs(l[0]) > 0.05) {
      const front = l[0] > 0;
      num[v * 3] = front ? (0.135 - l[2]) / 0.27 : (l[2] + 0.135) / 0.27;
      num[v * 3 + 1] = (l[1] + 0.02) / 0.26;
      num[v * 3 + 2] = 1;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinI, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(skinW, 4));
  g.setAttribute('pal', new THREE.BufferAttribute(pal, 1));
  g.setAttribute('numUV', new THREE.BufferAttribute(num, 3));
  g.setIndex(tri);
  return g;
}

/** Build the shared body geometry once. h: grid spacing for the body (m). */
export function buildBody(h = 0.016) {
  const t0 = performance.now();
  const J = fk(BIND);
  const body = surface(J, PARTS.filter((p) => !p.hand && !p.thin), h, 0.012, 0.022);
  // hands get their own, much finer pass so the fingers and thumb read
  const hh = Math.max(0.0028, Math.min(0.0045, h * 0.24));
  const hands = ['R', 'L'].map((s) => surface(J, PARTS.filter((p) => p.hand && p.joint.endsWith(s)), hh, 0.0025, 0.0055));

  // ---- face-mask bars as real tubes, rigid to the head
  const head = J.head, hb = ORDER.indexOf('head');
  const tubes = MASK_BARS.map(([a, b, r]) => {
    const A = new THREE.Vector3(...toWorld(head.R, head.p, a)), B = new THREE.Vector3(...toWorld(head.R, head.p, b));
    const len = A.distanceTo(B);
    const g = new THREE.CylinderGeometry(r * 1.1, r * 1.1, len + r * 1.6, 7, 1);
    g.deleteAttribute('uv');
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
    g.applyMatrix4(new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
    const n = g.attributes.position.count;
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let v = 0; v < n; v++) { si[v * 4] = hb; sw[v * 4] = 1; }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    g.setAttribute('pal', new THREE.BufferAttribute(new Float32Array(n).fill(PAL.MASK), 1));
    g.setAttribute('numUV', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    return g;
  });
  const geo = mergeGeometries([body, ...hands, ...tubes]);
  geo.computeBoundingSphere();

  const boneInverses = ORDER.map((n) => jointMatrix(J[n]).invert());
  // a sparse set of body vertices used to keep the posed player on the ground
  const nvBody = body.attributes.position.count;
  const samples = [];
  for (let v = 0; v < nvBody; v += 14) samples.push(v);
  return {
    geo, boneInverses, samples,
    pos: geo.attributes.position.array, skinI: geo.attributes.skinIndex.array, skinW: geo.attributes.skinWeight.array,
    tris: geo.index.count / 3, verts: geo.attributes.position.count, handTris: hands.reduce((s, g) => s + g.index.count / 3, 0),
    ms: performance.now() - t0, h,
  };
}

export function jointMatrix(j, m = new THREE.Matrix4()) {
  const R = j.R, p = j.p;
  return m.set(R[0], R[1], R[2], p[0], R[3], R[4], R[5], p[1], R[6], R[7], R[8], p[2], 0, 0, 0, 1);
}

// ---------------------------------------------------------------- material
const SKIN_A = [0.94, 0.72, 0.55], SKIN_B = [0.28, 0.16, 0.1];
function kitPalette(k) {
  const pal = new Array(32).fill(null).map(() => new THREE.Color('#ff00ff'));
  const set = (i, hex) => { pal[i] = new THREE.Color(hex); };
  set(PAL.JERSEY, k.jersey); set(PAL.TRIM, k.trim); set(PAL.NUM_F, k.jersey); set(PAL.NUM_B, k.jersey);
  set(PAL.PANTS, k.pants); set(PAL.PANT_STRIPE, k.pantStripe || k.trim); set(PAL.HELMET, k.helmet); set(PAL.HELMET_STRIPE, k.helmetStripe || k.trim);
  set(PAL.MASK, k.mask); set(PAL.GLOVE, k.glove || k.trim);
  set(PAL.SOCK, k.sock); set(PAL.SOCK_STRIPE, k.sockStripe || k.trim); set(PAL.CLEAT, k.cleat || '#1c1c1c'); set(PAL.SOLE, '#0c0c0c');
  set(PAL.BALL, '#8a4520'); set(PAL.LACES, '#f2efe6'); set(PAL.TAPE, '#f4f4f0'); set(PAL.BELT, k.belt || '#141414');
  set(PAL.EYE, '#16110e'); pal[PAL.PAD_DARK] = new THREE.Color(k.jersey).multiplyScalar(0.6);
  set(31, k.number);
  return pal;
}

const VERT_DECL = /* glsl */ `
attribute float pal;
attribute vec3 numUV;
uniform vec3 uPal[32];
uniform vec3 uSkin;
varying vec3 vPalCol;
varying vec3 vNum;
varying float vRough;`;
const VERT_BODY = /* glsl */ `
{
  int pi = int(pal + 0.5);
  vPalCol = uPal[pi];
  if (pi == ${PAL.SKIN}) vPalCol = uSkin;
  else if (pi == ${PAL.SKIN_DARK}) vPalCol = uSkin * 0.55;
  vNum = numUV;
  vRough = (pi == ${PAL.HELMET} || pi == ${PAL.HELMET_STRIPE}) ? 0.3 : pi == ${PAL.MASK} ? 0.35
    : (pi == ${PAL.SKIN} || pi == ${PAL.SKIN_DARK}) ? 0.55 : (pi == ${PAL.CLEAT} || pi == ${PAL.BELT}) ? 0.45 : 0.8;
}`;
const FRAG_DECL = /* glsl */ `
uniform float uNum;
uniform vec3 uNumCol;
varying vec3 vPalCol;
varying vec3 vNum;
varying float vRough;
const int FONT[10] = int[10](31599, 11415, 29671, 29647, 23497, 31183, 31215, 29330, 31727, 31695);
bool digitOn(int d, int cx, int ry) { return ((FONT[d] >> (14 - (ry * 3 + cx))) & 1) == 1; }
bool numberOn(vec2 uv, int num) {
  float U = uv.x * 15.0, V = uv.y * 15.0;
  if (V < 2.0 || V >= 14.0 || U < 0.0 || U > 16.0) return false;
  int ry = int(floor((13.99 - V) / 2.4));
  int tens = num / 10, ones = num - tens * 10;
  if (tens > 0) {
    if (U >= 1.0 && U < 7.0) return digitOn(tens, int(floor((U - 1.0) / 2.0)), ry);
    if (U >= 9.0 && U < 15.0) return digitOn(ones, int(floor((U - 9.0) / 2.0)), ry);
    return false;
  }
  if (U >= 5.0 && U < 11.0) return digitOn(ones, int(floor((U - 5.0) / 2.0)), ry);
  return false;
}`;
const FRAG_COLOR = /* glsl */ `
diffuseColor.rgb *= vPalCol;
if (vNum.z > 0.98 && numberOn(vNum.xy, int(uNum + 0.5))) diffuseColor.rgb = uNumCol;`;

export function playerMaterial(kit, skin = 0.4, number = 0) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0 });
  const pal = kitPalette(kit);
  const s = SKIN_A.map((a, i) => a + (SKIN_B[i] - a) * skin);
  const u = {
    uPal: { value: pal }, uSkin: { value: new THREE.Color(s[0] * s[0], s[1] * s[1], s[2] * s[2]) },
    uNum: { value: number }, uNumCol: { value: pal[31] },
  };
  mat.userData.u = u;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + VERT_DECL)
      .replace('#include <color_vertex>', '#include <color_vertex>\n' + VERT_BODY);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_DECL)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + FRAG_COLOR)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vRough;');
  };
  mat.customProgramCacheKey = () => 'gp-body-v1';
  return mat;
}

// ---------------------------------------------------------------- the ball
// Unit football, long axis local x, laces on +y: scale it by the real semi-axes
// (0.14 m x 0.085 m). Pointed ends, college stripes near the tips.
export const BALL_R = [0.14, 0.085, 0.085];
export function makeBall() {
  const g = new THREE.SphereGeometry(1, 28, 16);
  g.rotateZ(Math.PI / 2);            // poles on x
  const p = g.attributes.position, col = new Float32Array(p.count * 3);
  const brown = new THREE.Color('#7a3a17'), white = new THREE.Color('#efece2');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const rr = Math.hypot(y, z), want = Math.pow(Math.max(0, 1 - x * x), 0.72);
    if (rr > 1e-6) { p.setY(i, (y / rr) * want); p.setZ(i, (z / rr) * want); }
    const c = Math.abs(x) > 0.56 && Math.abs(x) < 0.66 ? white : brown;
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  const ball = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62 }));
  const laces = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.1, 0.34), new THREE.MeshStandardMaterial({ color: '#f2efe6', roughness: 0.7 }));
  laces.position.set(0, 0.97, 0);
  ball.add(laces);
  for (let k = -3; k <= 3; k++) {
    const cross = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.62), laces.material);
    cross.position.set(k * 0.085, 0.98, 0);
    ball.add(cross);
  }
  ball.castShadow = true;
  return ball;
}

/** Ball pose (from ballPart) -> matrix with the long axis on local x, laces on +y. */
function ballMatrix(bp, m) {
  const R = bp.R, r = bp.r;
  const long = r[0] >= r[1] && r[0] >= r[2] ? 0 : r[1] >= r[2] ? 1 : 2;
  const across = long === 2 ? 0 : 2, top = 3 - long - across;
  const col = (k) => [R[k], R[3 + k], R[6 + k]];
  const a = col(long), b = col(top);
  const c = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const [lx, ly, lz] = BALL_R;
  return m.set(
    a[0] * lx, b[0] * ly, c[0] * lz, bp.center[0],
    a[1] * lx, b[1] * ly, c[1] * lz, bp.center[1],
    a[2] * lx, b[2] * ly, c[2] * lz, bp.center[2], 0, 0, 0, 1);
}

// ---------------------------------------------------------------- one player
export class MeshPlayer {
  constructor(base, { kit, skin = 0.4, number = 0, scale = 1, ownBall = true }) {
    this.base = base;
    this.root = new THREE.Group();          // world placement + facing
    this.root.scale.setScalar(scale);
    this.inner = new THREE.Group();         // grounding offset
    this.root.add(this.inner);
    this.bones = ORDER.map(() => { const b = new THREE.Bone(); b.matrixAutoUpdate = false; this.inner.add(b); return b; });
    this.material = playerMaterial(kit, skin, number);
    this.mesh = new THREE.SkinnedMesh(base.geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.inner.add(this.mesh);
    this.mesh.bind(new THREE.Skeleton(this.bones, base.boneInverses.map((m) => m.clone())), new THREE.Matrix4());
    // the ball as the pose holds it (inner space); drawn here only in the lab
    this.ballM = new THREE.Matrix4();
    this.hasBall = false;
    if (ownBall) {
      this.ball = makeBall();
      this.ball.matrixAutoUpdate = false;
      this.inner.add(this.ball);
    }
    this.skin = new Float32Array(ORDER.length * 4);   // y row of each bone's skinning matrix
    this.tmp = new THREE.Matrix4();
    this.J = null;
  }

  setNumber(n) { this.material.userData.u.uNum.value = n; }

  /** Pose from actions.js (body space), then facing yaw (game convention) and position. */
  setPose(pose, x = 0, z = 0, yaw = 0) {
    const J = (this.J = fk(pose));
    const { boneInverses, samples, pos, skinI, skinW } = this.base;
    ORDER.forEach((n, b) => {
      const bone = this.bones[b];
      jointMatrix(J[n], bone.matrix);
      bone.matrixWorldNeedsUpdate = true;
      this.tmp.multiplyMatrices(bone.matrix, boneInverses[b]);
      const e = this.tmp.elements;   // column-major; y row = e[1], e[5], e[9], e[13]
      this.skin[b * 4] = e[1]; this.skin[b * 4 + 1] = e[5]; this.skin[b * 4 + 2] = e[9]; this.skin[b * 4 + 3] = e[13];
    });
    // ground: the lowest skinned sample sits at root.lift
    let minY = 1e9;
    for (const v of samples) {
      let y = 0;
      for (let q = 0; q < 4; q++) {
        const w = skinW[v * 4 + q]; if (!w) continue;
        const o = skinI[v * 4 + q] * 4;
        y += w * (this.skin[o] * pos[v * 3] + this.skin[o + 1] * pos[v * 3 + 1] + this.skin[o + 2] * pos[v * 3 + 2] + this.skin[o + 3]);
      }
      if (y < minY) minY = y;
    }
    const bp = ballPart(J, J._pose.ball);
    this.hasBall = !!bp;
    if (bp) {
      ballMatrix(bp, this.ballM);
      minY = Math.min(minY, bp.center[1] - BALL_R[1]);
    }
    if (this.ball) {
      this.ball.visible = this.hasBall;
      this.ball.matrix.copy(this.ballM);
      this.ball.matrixWorldNeedsUpdate = true;
    }
    this.inner.position.y = (J._pose.root.lift || 0) - minY;
    this.root.position.set(x, 0, z);
    this.root.rotation.y = -yaw;
  }

  /** Where this player's hands would hold the ball ('R', 'L', 'hands', ...) as an inner-space matrix. */
  ballAt(where, m = new THREE.Matrix4()) {
    const bp = ballPart(this.J, where);
    return bp ? ballMatrix(bp, m) : null;
  }

  /** inner-space matrix -> world matrix (call after the scene graph is updated). */
  toWorld(mInner, out = new THREE.Matrix4()) {
    this.root.updateMatrixWorld(true);
    return out.multiplyMatrices(this.inner.matrixWorld, mInner);
  }
}
