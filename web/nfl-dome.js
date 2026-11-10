// Procedural NFL dome interior, dressed in the home team's colours.
//
// Replaces the soccer bowl (web/stadium.js) as the default backdrop: that model came with
// soccer ad boards, dugouts, a running track and an open truss roof. Everything here is built
// from canvas textures and swept strips, so there are no asset or licence dependencies.
//
// World units are yards, matching render.js: the field runs x -10..110 (end lines),
// z 0..W, y up. The bowl is a rounded rectangle around the field, described by a cross-section
// profile of (offset outward from the field-level wall, height) pairs swept around that loop.
import * as THREE from './vendor/three.module.js';

const W = 160 / 3;
const CX = 50;
const CZ = W / 2;
// field-level wall: 10 yd behind the end lines, 14 yd behind the sidelines
const HX = 70;
const HZ = W / 2 + 14;
const R0 = 8; // corner radius at the wall
let FONT = '"Arial Narrow", Impact, sans-serif'; // set per build from the app display font

// ------------------------------------------------------------ helpers
function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function tex(c, { repeat = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shade(hex, f) {
  const c = new THREE.Color(hex);
  if (f >= 1) c.lerp(new THREE.Color('#ffffff'), f - 1);
  else c.multiplyScalar(f);
  return '#' + c.getHexString();
}

/** Readable ink on a team colour: the alt colour when it contrasts, else white. */
function inkOn(bg, alt) {
  const l = (h) => { const c = new THREE.Color(h); return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; };
  return Math.abs(l(bg) - l(alt)) > 0.25 ? alt : '#ffffff';
}

// --------------------------------------------------------- the loop
// Base loop at the wall: a rounded rectangle sampled so that the same sample index can be
// pushed outward/inward along its normal for every profile ring. P(d) = B + d * N.
function baseLoop() {
  const pts = [];
  const arcN = 12;
  const straight = (ax, az, bx, bz, nx, nz, n) => {
    for (let i = 0; i < n; i++) {
      const t = i / n;
      pts.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t, nx, nz });
    }
  };
  const arc = (cx, cz, a0) => {
    for (let i = 0; i < arcN; i++) {
      const a = a0 + (i / arcN) * (Math.PI / 2);
      const nx = Math.cos(a), nz = Math.sin(a);
      pts.push({ x: cx + R0 * nx, z: cz + R0 * nz, nx, nz });
    }
  };
  const ix = HX - R0, iz = HZ - R0;
  // counter-clockwise seen from above (+y): +x side, +z side, -x side, -z side
  straight(CX + HX, CZ - iz, CX + HX, CZ + iz, 1, 0, 24);
  arc(CX + ix, CZ + iz, 0);
  straight(CX + ix, CZ + HZ, CX - ix, CZ + HZ, 0, 1, 48);
  arc(CX - ix, CZ + iz, Math.PI / 2);
  straight(CX - HX, CZ + iz, CX - HX, CZ - iz, -1, 0, 24);
  arc(CX - ix, CZ - iz, Math.PI);
  straight(CX - ix, CZ - HZ, CX + ix, CZ - HZ, 0, -1, 48);
  arc(CX + ix, CZ - iz, Math.PI * 1.5);
  return pts;
}
const LOOP = baseLoop();

/**
 * Sweep one profile segment from (d0, y0) to (d1, y1) around the loop.
 * u runs along the loop in units of `tile` yards (measured at the segment's mid offset);
 * v runs 0 at the first edge to `vRep` at the second.
 */
function sweep(d0, y0, d1, y1, { tile = 30, vRep = 1 } = {}) {
  const n = LOOP.length;
  const pos = new Float32Array((n + 1) * 2 * 3);
  const uv = new Float32Array((n + 1) * 2 * 2);
  const dm = (d0 + d1) / 2;
  let len = 0;
  let prev = null;
  // keep a whole number of tiles around the loop so the seam doesn't show
  let total = 0;
  for (let i = 0; i <= n; i++) {
    const p = LOOP[i % n];
    const q = { x: p.x + dm * p.nx, z: p.z + dm * p.nz };
    if (prev) total += Math.hypot(q.x - prev.x, q.z - prev.z);
    prev = q;
  }
  const uScale = Math.max(1, Math.round(total / tile)) / total;
  prev = null;
  for (let i = 0; i <= n; i++) {
    const p = LOOP[i % n];
    const q = { x: p.x + dm * p.nx, z: p.z + dm * p.nz };
    if (prev) len += Math.hypot(q.x - prev.x, q.z - prev.z);
    prev = q;
    const u = len * uScale;
    for (const [k, d, y, v] of [[0, d0, y0, 0], [1, d1, y1, vRep]]) {
      const j = i * 2 + k;
      pos.set([p.x + d * p.nx, y, p.z + d * p.nz], j * 3);
      uv.set([u, v], j * 2);
    }
  }
  const idx = [];
  for (let i = 0; i < n; i++) {
    const a = i * 2, b = a + 1, c = a + 2, e = a + 3;
    idx.push(a, c, b, b, c, e);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------- textures
const ROWS = 16;      // seat rows per crowd tile (one row ~ 1 yd of rake)
const SEATS = 64;     // seats per crowd tile row (tile spans 32 yd)

function crowdTexture(home, away, seed) {
  const [c, g] = canvas(1024, 512);
  const rnd = mulberry(seed);
  const rowH = c.height / ROWS, seatW = c.width / SEATS;
  const seatCol = shade(home.color, 0.45);
  g.fillStyle = '#0d1016';
  g.fillRect(0, 0, c.width, c.height);
  const skin = ['#f1c7a5', '#d9a57e', '#b67a52', '#8a5a3b', '#5e3b26'];
  const shirt = () => {
    const r = rnd();
    if (r < 0.5) return home.color;
    if (r < 0.64) return home.alt;
    if (r < 0.72) return '#f2f2f2';
    if (r < 0.82) return '#15171c';
    if (r < 0.9) return away.color;
    return ['#8b8f96', '#3d5a80', '#7a2e2e', '#4b5d3a'][Math.floor(rnd() * 4)];
  };
  for (let r = 0; r < ROWS; r++) {
    const y0 = c.height - (r + 1) * rowH; // row 0 at the bottom of the canvas = front row (v = 0)
    // riser and seat backs
    g.fillStyle = '#1a1d24';
    g.fillRect(0, y0 + rowH * 0.78, c.width, rowH * 0.22);
    g.fillStyle = seatCol;
    for (let s = 0; s < SEATS; s++) g.fillRect(s * seatW + 2, y0 + rowH * 0.5, seatW - 4, rowH * 0.3);
    for (let s = 0; s < SEATS; s++) {
      if (rnd() < 0.07) continue; // empty seat
      const x = s * seatW + seatW / 2 + (rnd() - 0.5) * 3;
      const stand = rnd() < 0.35 ? -rowH * 0.12 : 0;
      const col = shade(shirt(), 0.75 + rnd() * 0.45);
      g.fillStyle = col;
      const tw = seatW * 0.72, th = rowH * 0.52;
      const ty = y0 + rowH * 0.36 + stand;
      g.beginPath();
      g.roundRect(x - tw / 2, ty, tw, th, 4);
      g.fill();
      g.fillStyle = skin[Math.floor(rnd() * skin.length)];
      g.beginPath();
      g.arc(x, ty - rowH * 0.1, seatW * 0.24, 0, Math.PI * 2);
      g.fill();
      if (rnd() < 0.18) { // raised arm
        g.fillStyle = col;
        g.fillRect(x + (rnd() < 0.5 ? -tw / 2 - 2 : tw / 2 - 1), ty - rowH * 0.32, 3, rowH * 0.36);
      }
    }
  }
  return tex(c);
}

function ribbonTexture(home, label, accent) {
  const [c, g] = canvas(2048, 128);
  const grad = g.createLinearGradient(0, 0, 0, c.height);
  grad.addColorStop(0, shade(home.color, 0.55));
  grad.addColorStop(1, shade(home.color, 0.25));
  g.fillStyle = grad;
  g.fillRect(0, 0, c.width, c.height);
  const panels = 4, pw = c.width / panels;
  for (let i = 0; i < panels; i++) {
    const x = i * pw;
    if (i % 2) {
      g.fillStyle = home.color;
      g.fillRect(x, 0, pw, c.height);
    }
    // chevrons
    g.fillStyle = accent;
    for (let k = 0; k < 3; k++) {
      const cx = x + 40 + k * 26;
      g.beginPath();
      g.moveTo(cx, 24); g.lineTo(cx + 18, 64); g.lineTo(cx, 104); g.lineTo(cx + 10, 104); g.lineTo(cx + 28, 64); g.lineTo(cx + 10, 24);
      g.fill();
    }
    g.fillStyle = i % 2 ? inkOn(home.color, home.alt) : '#ffffff';
    const text = i % 2 ? label : home.name.toUpperCase();
    let size = 78;
    g.font = `800 ${size}px ${FONT}`;
    const room = pw - 150;
    const wtext = g.measureText(text).width;
    if (wtext > room) { size = Math.floor(size * room / wtext); g.font = `800 ${size}px ${FONT}`; }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, x + pw / 2 + 50, c.height / 2 + 4);
  }
  // LED pixel grid
  g.fillStyle = 'rgba(0,0,0,0.22)';
  for (let x = 0; x < c.width; x += 4) g.fillRect(x, 0, 1, c.height);
  for (let y = 0; y < c.height; y += 4) g.fillRect(0, y, c.width, 1);
  g.fillStyle = 'rgba(255,255,255,0.18)';
  g.fillRect(0, 0, c.width, 3);
  return tex(c);
}

function wallTexture(home) {
  const [c, g] = canvas(1024, 128);
  g.fillStyle = home.color;
  g.fillRect(0, 0, c.width, c.height);
  // pad seams
  g.fillStyle = 'rgba(0,0,0,0.28)';
  for (let x = 0; x < c.width; x += 128) g.fillRect(x, 0, 3, c.height);
  g.fillStyle = 'rgba(255,255,255,0.12)';
  g.fillRect(0, 0, c.width, 6);
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(0, c.height - 10, c.width, 10);
  g.fillStyle = inkOn(home.color, home.alt);
  g.font = `800 72px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(home.name.toUpperCase(), c.width * 0.25, c.height / 2 + 2);
  g.fillText(home.name.toUpperCase(), c.width * 0.75, c.height / 2 + 2);
  return tex(c);
}

function suiteTexture(seed) {
  const [c, g] = canvas(512, 128);
  const rnd = mulberry(seed);
  g.fillStyle = '#10141b';
  g.fillRect(0, 0, c.width, c.height);
  const bays = 8, bw = c.width / bays;
  for (let i = 0; i < bays; i++) {
    const lit = rnd();
    const grad = g.createLinearGradient(0, 20, 0, 110);
    grad.addColorStop(0, lit < 0.75 ? '#e9d7ad' : '#4a5566');
    grad.addColorStop(1, lit < 0.75 ? '#8a6f45' : '#222a35');
    g.fillStyle = grad;
    g.fillRect(i * bw + 4, 18, bw - 8, 92);
    g.fillStyle = 'rgba(10,12,16,0.55)';
    for (let k = 1; k < 3; k++) g.fillRect(i * bw + 4 + (k * (bw - 8)) / 3, 18, 2, 92);
    // silhouettes
    g.fillStyle = 'rgba(20,18,16,0.7)';
    for (let k = 0; k < 3; k++) if (rnd() < 0.55) g.fillRect(i * bw + 10 + rnd() * (bw - 26), 60 + rnd() * 10, 8, 50);
  }
  g.fillStyle = '#2b313b';
  g.fillRect(0, 0, c.width, 14);
  g.fillRect(0, 112, c.width, 16);
  return tex(c);
}

function roofTexture() {
  const [c, g] = canvas(512, 512);
  g.fillStyle = '#23282f';
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = '#3a414c';
  g.lineWidth = 6;
  for (let i = 0; i <= 4; i++) {
    g.beginPath(); g.moveTo(i * 128, 0); g.lineTo(i * 128, 512); g.stroke();
    g.beginPath(); g.moveTo(0, i * 128); g.lineTo(512, i * 128); g.stroke();
  }
  g.strokeStyle = '#2e343d';
  g.lineWidth = 2;
  for (let i = 0; i < 16; i++) {
    g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32, 512); g.stroke();
  }
  return tex(c);
}

function boardTexture(home, away) {
  const [c, g] = canvas(1024, 256);
  g.fillStyle = '#05070b';
  g.fillRect(0, 0, c.width, c.height);
  const grad = g.createLinearGradient(0, 0, c.width, 0);
  grad.addColorStop(0, shade(away.color, 0.8));
  grad.addColorStop(0.5, '#0b0f17');
  grad.addColorStop(1, shade(home.color, 0.9));
  g.fillStyle = grad;
  g.fillRect(8, 8, c.width - 16, c.height - 16);
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const fit = (text, x, max) => {
    g.font = `800 120px ${FONT}`;
    const w = g.measureText(text).width;
    if (w > max) g.font = `800 ${Math.floor(120 * max / w)}px ${FONT}`;
    g.fillText(text, x, c.height / 2 + 6);
  };
  fit(away.short.toUpperCase(), c.width * 0.25, c.width * 0.4);
  fit(home.short.toUpperCase(), c.width * 0.75, c.width * 0.4);
  g.font = `700 54px ${FONT}`;
  g.fillStyle = '#c9d1dc';
  g.fillText('VS', c.width / 2, c.height / 2 + 4);
  const t = tex(c, { repeat: false });
  return t;
}

// ------------------------------------------------------------ build
/**
 * Build the dome for a game. `teams[home]` / `teams[away]` carry { color, alt, short, name }.
 * Returns a Group positioned in world space (no placement step needed).
 */
export function buildNflDome({ teams, home, away, seed = 1, font = null }) {
  if (font) FONT = font;
  const H = teams[home], A = teams[away];
  const group = new THREE.Group();
  group.name = 'nfl-dome';
  const parts = [];
  const add = (geo, mat, name) => {
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    m.castShadow = false;
    m.receiveShadow = false;
    group.add(m);
    parts.push(m);
    return m;
  };
  const std = (o) => new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.9, metalness: 0, ...o });
  const led = (map) => new THREE.MeshBasicMaterial({ map, side: THREE.DoubleSide, color: '#d8d8d8' });

  const crowd = crowdTexture(H, A, seed);
  const crowdMat = std({ map: crowd, emissive: '#ffffff', emissiveMap: crowd, emissiveIntensity: 0.22, roughness: 1 });
  const dark = std({ color: '#161a21' });
  const concrete = std({ color: '#3a3f47' });

  // field-level padded wall and its cap
  // tiles keep each canvas's aspect ratio: tile length = height x (canvas width / height)
  add(sweep(0, 0, 0, 1.6, { tile: 13 }), std({ map: wallTexture(H), roughness: 0.7 }), 'wall');
  add(sweep(0, 1.6, 0.9, 1.6), concrete, 'wall-cap');
  // lower bowl (rake ~28 deg), ~24 rows
  add(sweep(0.9, 1.6, 24, 14, { tile: 32, vRep: 26 / ROWS }), crowdMat, 'lower-bowl');
  // lower ribbon board
  add(sweep(24, 14, 24, 15.4, { tile: 22 }), led(ribbonTexture(H, H.short.toUpperCase(), H.alt)), 'ribbon-lower');
  // suites
  const suites = suiteTexture(seed + 7);
  add(sweep(24, 15.4, 24.6, 19, { tile: 15 }), std({ map: suites, emissive: '#ffffff', emissiveMap: suites, emissiveIntensity: 0.55, roughness: 0.35 }), 'suites');
  // upper deck soffit + front ribbon (overhangs the suites slightly)
  add(sweep(24.6, 19, 22.8, 19.4), dark, 'soffit');
  add(sweep(22.8, 19.4, 22.8, 20.6, { tile: 19 }), led(ribbonTexture(H, 'HOME OF THE ' + H.name.toUpperCase(), '#ffffff')), 'ribbon-upper');
  // upper bowl (steeper, ~36 deg), ~36 rows
  add(sweep(22.8, 20.6, 50, 41, { tile: 32, vRep: 34 / ROWS }), crowdMat, 'upper-bowl');
  // rim and back wall
  add(sweep(50, 41, 50, 42.2), dark, 'rim');
  add(sweep(50, 42.2, 53, 50), std({ color: '#1d222a' }), 'back-wall');
  // roof: dark panelled shell rising to a ridge over midfield
  const roofTex = roofTexture();
  // the hemisphere light barely reaches a downward-facing shell, so the panels carry a little glow
  const roofMat = std({ map: roofTex, roughness: 1, emissive: '#ffffff', emissiveMap: roofTex, emissiveIntensity: 0.55 });
  const roof = [[53, 50], [36, 60], [16, 67], [-6, 71], [-26, 73.5], [-HZ + 0.5, 74.5]];
  for (let i = 0; i < roof.length - 1; i++) {
    const [d0, y0] = roof[i], [d1, y1] = roof[i + 1];
    add(sweep(d0, y0, d1, y1, { tile: 20, vRep: Math.hypot(d1 - d0, y1 - y0) / 20 }), roofMat, 'roof');
  }
  // light rings hung under the roof: an emissive band and a catwalk
  const lightMat = new THREE.MeshBasicMaterial({ color: '#fff4d8', side: THREE.DoubleSide });
  add(sweep(30, 62, 28, 62.6), lightMat, 'light-ring');
  add(sweep(8, 68.4, 6.5, 68.8), lightMat, 'light-ring-inner');
  add(sweep(31, 61.4, 27, 61.6), dark, 'catwalk');
  // light banks along the catwalk, aimed at the field
  const banks = LOOP.filter((_, i) => i % 2 === 0);
  const bankMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(2.6, 0.5, 1.1), new THREE.MeshBasicMaterial({ color: '#fffbea' }), banks.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  banks.forEach((p, i) => {
    q.setFromAxisAngle(up, Math.atan2(-p.nz, p.nx) + Math.PI / 2);
    m4.compose(new THREE.Vector3(p.x + 29 * p.nx, 61.0, p.z + 29 * p.nz), q, new THREE.Vector3(1, 1, 1));
    bankMesh.setMatrixAt(i, m4);
  });
  bankMesh.name = 'light-banks';
  group.add(bankMesh);

  // centre-hung video board
  const board = new THREE.Group();
  board.name = 'videoboard';
  const bt = boardTexture(H, A);
  const screen = new THREE.MeshBasicMaterial({ map: bt, color: '#e6e6e6' });
  const frame = std({ color: '#0d1015', roughness: 0.6 });
  const bw = 34, bh = 9, bd = 14;
  board.add(new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), [frame, frame, frame, frame, screen, screen]));
  for (const sx of [-1, 1]) {
    const end = new THREE.Mesh(new THREE.PlaneGeometry(bd - 1, bh - 1), new THREE.MeshBasicMaterial({ map: bt, color: '#e6e6e6' }));
    end.position.x = sx * (bw / 2 + 0.05);
    end.rotation.y = sx * Math.PI / 2;
    board.add(end);
  }
  const ring = new THREE.Mesh(new THREE.BoxGeometry(bw + 1, 1, bd + 1), led(ribbonTexture(H, H.short.toUpperCase(), H.alt)));
  ring.position.y = -bh / 2 - 0.6;
  board.add(ring);
  const cableMat = new THREE.MeshBasicMaterial({ color: '#1a1e24' });
  for (const [x, z] of [[-14, -5], [14, -5], [-14, 5], [14, 5]]) {
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 14, 5), cableMat);
    cable.position.set(x, bh / 2 + 7, z);
    board.add(cable);
  }
  board.position.set(CX, 60, CZ);
  group.add(board);

  // apron: darker turf from the field edge to the wall, with team-area boxes on the sidelines
  const apron = apronTexture(H);
  const apronMesh = new THREE.Mesh(new THREE.PlaneGeometry(2 * HX + 2, 2 * HZ + 2), new THREE.MeshStandardMaterial({ map: apron, roughness: 1 }));
  apronMesh.rotation.x = -Math.PI / 2;
  apronMesh.position.set(CX, -0.01, CZ);
  apronMesh.receiveShadow = true;
  apronMesh.name = 'apron';
  group.add(apronMesh);

  group.userData.meshes = parts.length;
  return group;
}

function apronTexture(home) {
  const S = 8; // px per yard
  const w = 2 * HX + 2, h = 2 * HZ + 2;
  const [c, g] = canvas(Math.round(w * S), Math.round(h * S));
  const X = (x) => (x - (CX - w / 2)) * S;
  const Z = (z) => (z - (CZ - h / 2)) * S;
  g.fillStyle = '#2f7438';
  g.fillRect(0, 0, c.width, c.height);
  // 6-ft white border around the playing field
  g.fillStyle = '#e9ece8';
  g.fillRect(X(-12), Z(-2), 124 * S, (W + 4) * S);
  // team areas between the 32s, behind a 6-ft coaching strip
  for (const side of [-1, 1]) {
    const z0 = side < 0 ? -2 - 2 - 9 : W + 2 + 2;
    g.fillStyle = '#28622f';
    g.globalAlpha = 1;
    g.fillRect(X(18), Z(z0), 64 * S, 9 * S);
    g.globalAlpha = 1;
    g.strokeStyle = '#e9ece8';
    g.lineWidth = 0.2 * S;
    g.setLineDash([S * 0.8, S * 0.8]);
    g.strokeRect(X(18), Z(z0), 64 * S, 9 * S);
    g.setLineDash([]);
  }
  return tex(c, { repeat: false, aniso: 4 }); // canvas rows run +z, as in render.js fieldTexture
}
