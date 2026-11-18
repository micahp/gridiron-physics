// Sprite-stack renderer. All baked frames of all actions live in one packed
// atlas texture (2 bytes per voxel). Every player is drawn as a pile of flat
// quads, one per voxel layer (optionally several per layer to close the gaps at
// low camera angles), turned to any facing in the vertex shader. One draw call
// covers every player.
import * as THREE from '../vendor/three.module.js';
import { voxelize, PAL } from './body.js';
import { ACTIONS } from './actions.js';

export function bakeAll(voxel, only = null) {
  const t0 = performance.now();
  const frames = [];                       // flat list of baked frames
  const index = {};                        // action -> { start, count }
  for (const [name, a] of Object.entries(ACTIONS)) {
    if (only && !only.includes(name)) continue;
    index[name] = { start: frames.length, count: a.frames };
    for (let i = 0; i < a.frames; i++) {
      const t = a.loop ? i / a.frames : (a.frames === 1 ? 0 : i / (a.frames - 1));
      frames.push(voxelize(a.fn(t), voxel));
    }
  }
  // shelf-pack frame blocks into one atlas
  let voxels = 0;
  for (const f of frames) {
    f.cols = Math.max(1, Math.round(Math.sqrt((f.nl * f.gz) / f.gx)));
    f.rows = Math.ceil(f.nl / f.cols);
    f.bw = f.cols * f.gx; f.bh = f.rows * f.gz;
    voxels += f.gx * f.gz * f.nl;
  }
  const AW = 4096;
  const order = frames.map((f, i) => i).sort((a, b) => frames[b].bh - frames[a].bh);
  let x = 0, y = 0, shelf = 0;
  for (const i of order) {
    const f = frames[i];
    if (x + f.bw > AW) { x = 0; y += shelf; shelf = 0; }
    f.ax = x; f.ay = y; x += f.bw; shelf = Math.max(shelf, f.bh);
  }
  const AH = Math.max(1, y + shelf);
  const atlas = new Uint8Array(AW * AH * 2);
  for (const f of frames) {
    for (let k = 0; k < f.nl; k++) {
      const col = k % f.cols, row = Math.floor(k / f.cols);
      for (let j = 0; j < f.gz; j++) {
        const src = ((k * f.gz + j) * f.gx) * 2;
        const dst = ((f.ay + row * f.gz + j) * AW + f.ax + col * f.gx) * 2;
        atlas.set(f.data.subarray(src, src + f.gx * 2), dst);
      }
    }
    f.data = null;
  }
  const meta = new Float32Array(frames.length * 2 * 4);
  frames.forEach((f, i) => {
    meta.set([f.ax, f.ay, f.gx, f.gz], i * 4);
    meta.set([f.cols, f.i0, f.j0, f.nl], (frames.length + i) * 4);
  });
  return {
    voxel, G: frames[0]?.G ?? 1, frames, index, atlas, AW, AH, meta,
    maxLayers: Math.max(...frames.map((f) => f.nl)),
    ms: performance.now() - t0, voxels,
  };
}

const VERT = /* glsl */ `
uniform sampler2D uMeta;
uniform float uV, uG, uFrames;
attribute vec4 iA;   // world x, world z, yaw, frame (-1 hides)
attribute vec4 iB;   // layer height (in voxels), team, skin, number
varying vec2 vPx;
flat varying ivec4 vTile;
flat varying vec4 vInfo;  // team, skin, number, yaw
void main() {
  float f = iA.w;
  float k = floor(iB.x - 0.001);
  vec4 m0 = texelFetch(uMeta, ivec2(int(f), 0), 0);
  vec4 m1 = texelFetch(uMeta, ivec2(int(f), 1), 0);
  if (f < 0.0 || k >= m1.w) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec2 c = position.xy + 0.5;
  float gx = m0.z, gz = m0.w;
  float li = m1.y + c.x * gx, lj = m1.z + c.y * gz;
  float lx = (li - uG * 0.5) * uV, lz = (lj - uG * 0.5) * uV;
  float cy = cos(iA.z), sy = sin(iA.z);
  vec3 wp = vec3(iA.x + lx * cy - lz * sy, iB.x * uV, iA.y + lx * sy + lz * cy);
  float col = mod(k, m1.x), row = floor(k / m1.x);
  vTile = ivec4(int(m0.x + col * gx + 0.5), int(m0.y + row * gz + 0.5), int(gx + 0.5), int(gz + 0.5));
  vPx = c * vec2(gx, gz);
  vInfo = vec4(iB.y, iB.z, iB.w, iA.z);
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(wp, 1.0);
}`;

const FRAG = /* glsl */ `
precision highp float;
precision highp int;
uniform sampler2D uAtlas;
uniform vec3 uPal[64];
uniform vec3 uSun, uSunCol, uSky, uGround;
varying vec2 vPx;
flat varying ivec4 vTile;
flat varying vec4 vInfo;
out vec4 fragColor;
const int FONT[10] = int[10](31599, 11415, 29671, 29647, 23497, 31183, 31215, 29330, 31727, 31695);
bool digitOn(int d, int cx, int ry) {   // cx 0..2 from left, ry 0..4 from top
  int bit = 14 - (ry * 3 + cx);
  return ((FONT[d] >> bit) & 1) == 1;
}
void main() {
  ivec2 p = vTile.xy + clamp(ivec2(floor(vPx)), ivec2(0), vTile.zw - 1);
  vec2 t = texelFetch(uAtlas, p, 0).rg * 255.0;
  int r = int(t.x + 0.5), g = int(t.y + 0.5);
  int idx = r & 31;
  if (idx == 0) discard;
  float ao = float(r >> 5) / 7.0;
  int team = int(vInfo.x + 0.5);
  vec3 base = uPal[team * 32 + idx];
  vec3 n;
  if (idx == ${PAL.NUM_F} || idx == ${PAL.NUM_B}) {
    int u = g >> 4, v = g & 15;
    int num = int(vInfo.z + 0.5);
    int tens = num / 10, ones = num - tens * 10;
    bool on = false;
    int ry = int(floor((13.99 - float(v)) / 2.4));
    if (v >= 2 && v < 14) {
      if (tens > 0) {
        if (u >= 1 && u < 7) on = digitOn(tens, (u - 1) / 2, ry);
        if (u >= 9 && u < 15) on = digitOn(ones, (u - 9) / 2, ry);
      } else if (u >= 5 && u < 11) on = digitOn(ones, (u - 5) / 2, ry);
    }
    if (on) base = uPal[team * 32 + 31];
    else base = uPal[team * 32 + ${PAL.JERSEY}];
    n = vec3(idx == ${PAL.NUM_F} ? 1.0 : -1.0, 0.25, 0.0);
  } else {
    n = vec3(float(g >> 4) / 15.0 * 2.0 - 1.0, 0.0, float(g & 15) / 15.0 * 2.0 - 1.0);
    n.y = sqrt(max(0.0, 1.0 - n.x * n.x - n.z * n.z));
  }
  if (idx == ${PAL.SKIN} || idx == ${PAL.SKIN_DARK}) {
    vec3 skin = mix(vec3(0.94, 0.72, 0.55), vec3(0.28, 0.16, 0.1), vInfo.y);
    skin = skin * skin;                      // to linear
    base = idx == ${PAL.SKIN_DARK} ? skin * 0.55 : skin;
  }
  n = normalize(n);
  float cy = cos(vInfo.w), sy = sin(vInfo.w);
  vec3 nw = vec3(n.x * cy - n.z * sy, n.y, n.x * sy + n.z * cy);
  vec3 light = mix(uGround, uSky, nw.y * 0.5 + 0.5) + uSunCol * max(0.0, dot(nw, uSun));
  vec3 c = base * light * (0.5 + 0.5 * ao);
  c = c / (1.0 + c * 0.25);                  // gentle tone curve
  fragColor = vec4(pow(c, vec3(1.0 / 2.2)), 1.0);
}`;

const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();

export function teamPalette(k) {
  const pal = new Array(32).fill(null).map(() => lin('#ff00ff'));
  const set = (i, hex) => { pal[i] = lin(hex); };
  set(PAL.JERSEY, k.jersey); set(PAL.TRIM, k.trim); set(PAL.NUM_F, k.jersey); set(PAL.NUM_B, k.jersey);
  set(PAL.PANTS, k.pants); set(PAL.PANT_STRIPE, k.pantStripe || k.trim); set(PAL.HELMET, k.helmet); set(PAL.HELMET_STRIPE, k.helmetStripe || k.trim);
  set(PAL.MASK, k.mask); set(PAL.SKIN, '#c68863'); set(PAL.SKIN_DARK, '#7a4a32'); set(PAL.GLOVE, k.glove || k.trim);
  set(PAL.SOCK, k.sock); set(PAL.SOCK_STRIPE, k.sockStripe || k.trim); set(PAL.CLEAT, k.cleat || '#1c1c1c'); set(PAL.SOLE, '#0c0c0c');
  set(PAL.BALL, '#9c5426'); set(PAL.LACES, '#f2efe6'); set(PAL.TAPE, '#f4f4f0'); set(PAL.BELT, k.belt || '#141414');
  set(PAL.EYE, '#16110e'); set(PAL.PAD_DARK, '#' + new THREE.Color(k.jersey).multiplyScalar(0.6).getHexString());
  set(31, k.number);
  return pal;
}

export class StackRenderer {
  constructor(bake, { maxPlayers = 24, sub = 2, kits }) {
    this.bake = bake;
    this.sub = sub;
    this.maxPlayers = maxPlayers;
    this.perPlayer = bake.maxLayers * sub;
    const count = maxPlayers * this.perPlayer;
    const atlasTex = new THREE.DataTexture(bake.atlas, bake.AW, bake.AH, THREE.RGFormat, THREE.UnsignedByteType);
    atlasTex.magFilter = atlasTex.minFilter = THREE.NearestFilter; atlasTex.generateMipmaps = false; atlasTex.needsUpdate = true;
    atlasTex.unpackAlignment = 1;
    const metaTex = new THREE.DataTexture(bake.meta, bake.frames.length, 2, THREE.RGBAFormat, THREE.FloatType);
    metaTex.magFilter = metaTex.minFilter = THREE.NearestFilter; metaTex.needsUpdate = true;
    const pal = [...teamPalette(kits[0]), ...teamPalette(kits[1])];
    this.material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: {
        uMeta: { value: metaTex }, uAtlas: { value: atlasTex },
        uV: { value: bake.voxel }, uG: { value: bake.G }, uFrames: { value: bake.frames.length },
        uPal: { value: pal },
        uSun: { value: new THREE.Vector3(0.45, 0.8, 0.35).normalize() },
        uSunCol: { value: new THREE.Color(1.15, 1.08, 0.98) },
        uSky: { value: new THREE.Color(0.62, 0.68, 0.78) },
        uGround: { value: new THREE.Color(0.26, 0.3, 0.22) },
      },
      side: THREE.DoubleSide,
    });
    const geo = new THREE.InstancedBufferGeometry();
    // in-plane quad coords live in position.xy; the shader lays it flat
    const pos = new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0]);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex([0, 2, 1, 1, 2, 3]);
    this.iA = new Float32Array(count * 4).fill(-1);
    this.iB = new Float32Array(count * 4);
    geo.setAttribute('iA', new THREE.InstancedBufferAttribute(this.iA, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('iB', new THREE.InstancedBufferAttribute(this.iB, 4).setUsage(THREE.DynamicDrawUsage));
    geo.instanceCount = count;
    this.geo = geo;
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    // static per-instance layer heights
    for (let p = 0; p < maxPlayers; p++) for (let k = 0; k < bake.maxLayers; k++) for (let s = 0; s < sub; s++) {
      const n = p * this.perPlayer + k * sub + s;
      this.iB[n * 4] = k + (s + 1) / sub;
    }
  }

  /** Frame index for an action at time t (seconds since the action started). */
  frameOf(action, t) {
    const a = ACTIONS[action], ix = this.bake.index[action];
    if (!a || !ix) return -1;
    let i;
    if (a.loop) i = Math.floor(((t / a.dur) % 1 + 1) % 1 * a.frames) % a.frames;
    else i = Math.min(a.frames - 1, Math.round(Math.min(1, t / a.dur) * (a.frames - 1)));
    return ix.start + i;
  }
  /** Same, from a loop phase 0..1. */
  frameAtPhase(action, ph) {
    const a = ACTIONS[action], ix = this.bake.index[action];
    return ix.start + (Math.floor((((ph % 1) + 1) % 1) * a.frames) % a.frames);
  }

  /** players: [{ x, z, yaw, frame, team, skin, number }] in metres / radians. */
  update(players) {
    const { iA, iB, perPlayer } = this;
    for (let p = 0; p < this.maxPlayers; p++) {
      const pl = players[p];
      for (let q = 0; q < perPlayer; q++) {
        const n = (p * perPlayer + q) * 4;
        if (!pl) { iA[n + 3] = -1; continue; }
        iA[n] = pl.x; iA[n + 1] = pl.z; iA[n + 2] = pl.yaw; iA[n + 3] = pl.frame;
        iB[n + 1] = pl.team; iB[n + 2] = pl.skin; iB[n + 3] = pl.number;
      }
    }
    this.geo.attributes.iA.needsUpdate = true;
    this.geo.attributes.iB.needsUpdate = true;
  }

  dispose() { this.geo.dispose(); this.material.dispose(); this.material.uniforms.uAtlas.value.dispose(); this.material.uniforms.uMeta.value.dispose(); }
}
