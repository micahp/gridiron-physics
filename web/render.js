// three.js broadcast renderer. World units are yards: X runs goal line to
// goal line (0..100, end zones to -10/110), Z runs across the field
// (0..53.33), Y is up. Player bodies are built in metres and scaled.
import * as THREE from './vendor/three.module.js';
import { OrbitControls } from './vendor/OrbitControls.js';
import { loadRiggedPlayer, buildRiggedPlayer, animateRigged, setNeutralMode, stablePhase, travelYawOffset } from './rigged-player.js';
import { deriveCues } from './rigged-animation-controller.js';
import { kitsForGame } from './football-kits.js';
import { loadStadium, placeStadium, STADIUM_SCALE } from './stadium.js';
import { buildNflDome } from './nfl-dome.js';

// ?neutral=1 keeps the imported rig in its bind pose (no procedural posing).
if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('neutral')) {
  setNeutralMode(true);
}

const YD = 0.9144;
const BODY_SPACING = 0.52; // yards between body centres (shoulders are ~0.63 wide)
const W = 160 / 3;

// ?shadows= picks how players are grounded:
//   blob - a soft dark disc under each player, no shadow-map pass
//   full           - real shadow map; every player mesh is drawn a second time (~870k triangles)
//   none (default) - nothing; the blob read as fake
const SHADOW_MODE = (() => {
  const v = typeof location !== 'undefined' && new URLSearchParams(location.search).get('shadows');
  return v === 'full' || v === 'blob' ? v : 'none';
})();
let blobAssets = null;
function blobShadow() {
  if (!blobAssets) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 6, 64, 64, 62);
    grad.addColorStop(0, 'rgba(0,0,0,0.55)');
    grad.addColorStop(0.55, 'rgba(0,0,0,0.32)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const map = new THREE.CanvasTexture(c);
    map.colorSpace = THREE.SRGBColorSpace;
    blobAssets = {
      geo: new THREE.PlaneGeometry(1.7, 1.7).rotateX(-Math.PI / 2), // metres: bodies are built in metres
      mat: new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    };
  }
  const m = new THREE.Mesh(blobAssets.geo, blobAssets.mat);
  m.position.y = 0.03;
  m.renderOrder = 1;
  m.name = 'blob-shadow';
  m.userData.shared = true;
  return m;
}
/** Apply the shadow mode to a freshly built player. */
function applyPlayerShadows(root) {
  root.traverse((o) => { if (o.isMesh) o.castShadow = SHADOW_MODE === 'full'; });
  if (SHADOW_MODE === 'blob') root.add(blobShadow());
}
const POSE = { STANCE: 0, RUN: 1, BLOCK: 2, DOWN: 3, THROW: 4, CATCH: 5, KICK: 6, HOLD: 7, CELEBRATE: 8, BACKPEDAL: 9, WRAP: 10, KNEEL: 11 };

// --------------------------------------------------------------- field
function fieldTexture(teams, home, away, displayFont) {
  const S = 24; // px per yard
  const c = document.createElement('canvas');
  c.width = 120 * S;
  c.height = Math.round(W * S);
  const g = c.getContext('2d');
  const X = (x) => (x + 10) * S;
  for (let i = 0; i < 24; i++) {
    g.fillStyle = i % 2 ? '#3c8a43' : '#409048';
    g.fillRect(X(-10 + i * 5), 0, 5 * S, c.height);
  }
  // end zones: home team in the left end zone during odd quarters
  const ez = (x0, team) => {
    g.fillStyle = team.color;
    g.fillRect(X(x0), 0, 10 * S, c.height);
    g.save();
    g.translate(X(x0 + 5), c.height / 2);
    g.rotate(x0 < 0 ? -Math.PI / 2 : Math.PI / 2);
    g.fillStyle = team.alt;
    g.font = `700 ${6.2 * S}px ${displayFont}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(team.short.toUpperCase(), 0, 0);
    g.restore();
  };
  ez(-10, teams[home]);
  ez(100, teams[away]);
  g.strokeStyle = 'rgba(255,255,255,0.92)';
  g.lineWidth = 0.22 * S;
  g.strokeRect(X(-10) + 4, 4, 120 * S - 8, c.height - 8);
  for (let x = 0; x <= 100; x += 5) {
    g.lineWidth = (x === 0 || x === 100 ? 0.33 : 0.12) * S;
    g.beginPath();
    g.moveTo(X(x), 0);
    g.lineTo(X(x), c.height);
    g.stroke();
  }
  // hash marks and sideline ticks every yard
  g.lineWidth = 0.1 * S;
  for (let x = 1; x < 100; x++) {
    for (const [y0, y1] of [[0.4, 1.3], [W - 1.3, W - 0.4], [23.583 - 0.6, 23.583], [W - 23.583, W - 23.583 + 0.6]]) {
      g.beginPath();
      g.moveTo(X(x), y0 * S);
      g.lineTo(X(x), y1 * S);
      g.stroke();
    }
  }
  // yard numbers
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.font = `600 ${2 * S}px ${displayFont}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let x = 10; x <= 90; x += 10) {
    const n = String(x <= 50 ? x : 100 - x);
    for (const [y, rot] of [[12, Math.PI], [W - 12, 0]]) {
      g.save();
      g.translate(X(x), y * S);
      g.rotate(rot);
      g.fillText(n.split('').join(' '), 0, 0);
      g.restore();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function jerseyTexture(num, base, ink, trim) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = trim;
  g.fillRect(0, 0, 128, 10);
  g.font = '700 76px "Saira Condensed", "Arial Narrow", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 6;
  g.strokeStyle = trim;
  g.strokeText(num, 64, 70);
  g.fillStyle = ink;
  g.fillText(num, 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ------------------------------------------------------------- players
function buildPlayer(info, kit) {
  const root = new THREE.Group(); // positioned & yawed on the field
  const body = new THREE.Group(); // tipped over when down
  root.add(body);
  const s = (info.physics?.height || 1.88) / 1.88;
  const bulk = 0.82 + ((info.physics?.mass || 100) - 85) / 260;
  body.scale.set(s / YD, s / YD, s / YD);

  const mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.62, metalness: 0.05 });
  const pants = mat(kit.pants);
  const sock = mat(kit.sock);
  const skin = mat('#8a5a3c');
  const jersey = mat(kit.jersey);
  const helmet = new THREE.MeshStandardMaterial({ color: kit.helmet, roughness: 0.25, metalness: 0.35 });
  const num = jerseyTexture(info.jersey || '', kit.jersey, kit.number, kit.trim);
  const numMat = new THREE.MeshStandardMaterial({ map: num, roughness: 0.7 });

  const legs = [];
  for (const side of [1, -1]) {
    const hip = new THREE.Group();
    hip.position.set(0, 0.93, side * 0.11 * bulk);
    const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.085 * bulk, 0.07 * bulk, 0.46, 8), pants);
    thigh.position.y = -0.23;
    const knee = new THREE.Group();
    knee.position.y = -0.46;
    const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.06 * bulk, 0.045, 0.44, 8), sock);
    shin.position.y = -0.22;
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.1), mat('#111'));
    foot.position.set(0.05, -0.45, 0);
    knee.add(shin, foot);
    hip.add(thigh, knee);
    body.add(hip);
    legs.push({ hip, knee });
  }
  const torso = new THREE.Group();
  torso.position.y = 0.95;
  body.add(torso);
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.27 * bulk, 0.55, 0.42 * bulk), [jersey, jersey, jersey, jersey, numMat, numMat]);
  chest.rotation.y = Math.PI / 2; // number faces front (+x) and back
  chest.position.y = 0.3;
  const pads = new THREE.Mesh(new THREE.BoxGeometry(0.34 * bulk, 0.12, 0.62 * bulk), jersey);
  pads.position.y = 0.55;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.135, 14, 10), helmet);
  head.position.set(0.01, 0.77, 0);
  const mask = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.012, 4, 10, Math.PI), mat(kit.mask));
  mask.position.set(0.12, 0.73, 0);
  mask.rotation.set(0, Math.PI / 2, Math.PI / 2);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.02, 0.04), mat(kit.trim));
  stripe.position.set(0.0, 0.905, 0);
  torso.add(chest, pads, head, mask, stripe);
  const arms = [];
  for (const side of [1, -1]) {
    const sh = new THREE.Group();
    sh.position.set(0, 0.52, side * 0.3 * bulk);
    const up = new THREE.Mesh(new THREE.CylinderGeometry(0.06 * bulk, 0.05, 0.32, 7), jersey);
    up.position.y = -0.16;
    const el = new THREE.Group();
    el.position.y = -0.32;
    const fore = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.3, 7), skin);
    fore.position.y = -0.15;
    el.add(fore);
    sh.add(up, el);
    torso.add(sh);
    arms.push({ sh, el });
  }
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  // selection ring
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.05, 32), new THREE.MeshBasicMaterial({ color: '#f5d33a', transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  ring.visible = false;
  root.add(ring);
  root.userData = {
    legs, arms, torso, body, ring, phase: stablePhase(info.id, kit.seed ?? ''), lie: 0, id: info.id,
    dispose() {
      const geometries = new Set();
      const materials = new Set([ring.material]);
      const textures = new Set();
      root.traverse((object) => {
        if (object.geometry) geometries.add(object.geometry);
        for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
          if (!material) continue;
          materials.add(material);
          for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap']) {
            if (material[key]) textures.add(material[key]);
          }
        }
      });
      for (const texture of textures) texture.dispose();
      for (const material of materials) material.dispose();
      for (const geometry of geometries) geometry.dispose();
    },
  };
  return root;
}

// Kick motion, keyed on seconds relative to ball contact (tk = 0). The engine
// stamps POSE.KICK at contact and never clears it, so the renderer owns the
// timing: wind-up before contact, swing through, follow-through, then back to
// whatever the player was doing. Rows: [tk, kickHip, kickKnee, plantHip, plantKnee, lean, armA, armB].
const KICK_KEYS = [
  [-0.45, 0.30, 0.30, 0.30, 0.30, 0.10, 0.4, -0.4],
  [-0.16, -1.10, 1.90, 0.15, 0.35, -0.12, 0.9, -0.9],
  [0.00, 0.55, 0.50, 0.05, 0.40, 0.12, 0.6, -0.8],
  [0.14, 1.50, 0.05, -0.15, 0.55, -0.05, 0.5, -0.9],
  [0.45, 1.30, 0.10, -0.10, 0.50, -0.20, 0.4, -0.7],
  [0.95, 0.30, 0.40, 0.30, 0.40, 0.10, 0.3, -0.3],
];
const KICK_START = KICK_KEYS[0][0], KICK_END = KICK_KEYS[KICK_KEYS.length - 1][0];
function kickPose(tk) {
  let i = 0;
  while (i < KICK_KEYS.length - 2 && tk > KICK_KEYS[i + 1][0]) i++;
  const a = KICK_KEYS[i], b = KICK_KEYS[i + 1];
  let u = Math.max(0, Math.min(1, (tk - a[0]) / (b[0] - a[0])));
  u = u * u * (3 - 2 * u);
  return a.slice(1).map((v, j) => v + (b[j + 1] - v) * u);
}
// First frame at which each player's recorded pose becomes KICK (cached per replay).
function kickOnsets(rec) {
  if (rec._kickOnset) return rec._kickOnset;
  const n = rec.roster.length, out = new Array(n).fill(-1);
  for (let k = 0; k < rec.frames.length; k++) {
    const f = rec.frames[k];
    for (let i = 0; i < n; i++) if (out[i] < 0 && f[i * 6 + 4] === POSE.KICK) out[i] = k;
  }
  return (rec._kickOnset = out);
}

const LEG_LEN = 0.95; // hip to ground, metres
function animate(root, pose, speed, dt, carrying, tk = null, dist = 0, ctx = null) {
  const u = root.userData;
  const { legs, arms, torso, body } = u;
  if (pose === POSE.KICK && tk !== null && (tk < KICK_START || tk > KICK_END)) pose = POSE.RUN;
  // Gait locked to ground: a planted foot must travel back relative to the hip at
  // exactly the body's speed. With hip swing amplitude A (rad) and leg length LEG,
  // that is phase advance = distance / (LEG * A), so stride length follows speed
  // and the feet don't skate. Driven by distance moved, so it stops when paused.
  const vm = speed * YD;
  const swing = Math.max(0.18, Math.min(1.0, 0.2 + vm * 0.1)) * Math.min(1, vm / 1.0);
  // moving against the heading (a backpedal the pose code did not flag) runs the cycle in reverse
  const sgn = ctx && ctx.back ? -1 : 1;
  if (swing > 0.02) u.phase += sgn * Math.min(dist, 1.2) / (LEG_LEN * swing);
  let lean = Math.min(0.38, speed * 0.04);
  let crouch = 0;
  let armF = [Math.sin(u.phase) * swing * 0.8, -Math.sin(u.phase) * swing * 0.8];
  let armOut = 0.12;
  let legA = [Math.sin(u.phase) * swing, -Math.sin(u.phase) * swing];
  // knee folds on the forward (recovery) swing, i.e. while that hip angle is increasing
  let kneeB = [Math.max(0, Math.cos(u.phase)) * swing * 1.5, Math.max(0, -Math.cos(u.phase)) * swing * 1.5];
  let lieT = 0, lift = 0;
  switch (pose) {
    case POSE.STANCE:
      crouch = 0.32; lean = 0.75; legA = [0.9, 0.6]; kneeB = [1.4, 1.2]; armF = [0.9, 0.3]; break;
    case POSE.BLOCK:
      lean = 0.5; crouch = 0.12; armF = [1.3, 1.3]; armOut = 0.05;
      legA = [0.5 + Math.sin(u.phase) * 0.25, -0.2 - Math.sin(u.phase) * 0.25]; kneeB = [0.7, 0.5]; break;
    case POSE.WRAP:
      lean = 0.85; crouch = 0.15; armF = [1.5, 1.5]; armOut = -0.15; break;
    case POSE.DOWN:
      lieT = Math.PI / 2; armF = [2.6, 2.4]; legA = [0.1, -0.1]; kneeB = [0.2, 0.2]; break;
    case POSE.THROW:
      armF = [-2.6, 0.6]; lean = 0.1; break;
    case POSE.CATCH:
      armF = [2.8, 2.8]; armOut = 0.25; lean = 0.05; break;
    case POSE.KICK:
      legA = [-1.3, 0.2]; kneeB = [0, 0.3]; lean = -0.2; armF = [0.6, -0.8]; armOut = 0.7; break;
    case POSE.HOLD:
    case POSE.KNEEL:
      crouch = 0.42; legA = [1.5, -0.2]; kneeB = [1.6, 2.2]; lean = 0.2; armF = [0.9, 0.9]; break;
    case POSE.CELEBRATE:
      armF = [3.0, 3.0]; armOut = 0.5; lift = Math.abs(Math.sin(u.phase * 1.3)) * 0.18; break;
    case POSE.BACKPEDAL:
      lean = 0.25; crouch = 0.1; break;
  }
  if (carrying && pose !== POSE.DOWN) armF[1] = 1.4;
  // contact: a wrapped ball carrier is driven back; a man locked up drives forward
  if (ctx && ctx.role === 3 && pose !== POSE.DOWN) { lean = -0.25; crouch = 0.08; armF = [1.2, 1.2]; }
  if (ctx && ctx.role === 1 && pose === POSE.BLOCK) { lean = 0.62; crouch = 0.18; }
  const k = 1 - Math.exp(-dt * 14);
  const kicking = tk !== null && tk >= KICK_START && tk <= KICK_END;
  if (kicking) {
    const [kh, kk, ph, pk, ln, a0, a1] = kickPose(tk);
    legs[0].hip.rotation.z = kh; legs[0].knee.rotation.z = -kk;
    legs[1].hip.rotation.z = ph; legs[1].knee.rotation.z = -pk;
    arms[0].sh.rotation.z = a0; arms[1].sh.rotation.z = a1;
    torso.rotation.z = -ln; torso.position.y = 0.95 - 0.04;
    arms.forEach((a, i) => { a.sh.rotation.x = (i ? -1 : 1) * 0.35; a.el.rotation.z = 0.5; });
    body.rotation.z = 0; body.position.y = 0; u.lie = 0;
    return;
  }
  // The run cycle is tracked exactly (smoothing would low-pass it and shrink the
  // stride, making the feet skate); smoothing is kept for pose changes.
  const cyc = pose === POSE.RUN || pose === POSE.BACKPEDAL;
  u.direct = Math.max(0, Math.min(1, (u.direct ?? 0) + (cyc ? 1 : -1) * dt / 0.12));
  const kc = cyc ? Math.max(k, u.direct) : k;
  legs.forEach((l, i) => {
    l.hip.rotation.z += (legA[i] - l.hip.rotation.z) * kc;
    l.knee.rotation.z += (-kneeB[i] - l.knee.rotation.z) * kc;
  });
  arms.forEach((a, i) => {
    a.sh.rotation.z += (armF[i] - a.sh.rotation.z) * kc;
    a.sh.rotation.x = (i ? -1 : 1) * armOut;
    a.el.rotation.z = pose === POSE.CATCH ? 0.2 : 0.5;
  });
  torso.rotation.z += (-lean - torso.rotation.z) * k;
  torso.position.y += (0.95 - crouch - torso.position.y) * k;
  u.lie += (lieT - u.lie) * (1 - Math.exp(-dt * 8));
  body.rotation.z = -u.lie;
  body.position.y = lift + (u.lie > 0.1 ? 0.12 : 0);
}

// -------------------------------------------------------------- scene
export class Renderer {
  constructor(canvas, game, { displayFont }) {
    this.game = game;
    this.canvas = canvas;
    this.displayFont = displayFont;
    const r = (this.r3 = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }));
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.shadowMap.enabled = SHADOW_MODE === 'full';
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.3;
    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color('#0b1016');
    scene.fog = new THREE.Fog('#0b1016', 120, 260);
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.5, 600);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enabled = false;
    this.controls.maxPolarAngle = Math.PI * 0.48;

    scene.add(new THREE.HemisphereLight('#e8eeff', '#2a3a26', 1.5));
    const sun = new THREE.DirectionalLight('#fff6e6', 1.7);
    sun.position.set(30, 90, 90);
    sun.castShadow = SHADOW_MODE === 'full';
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -40; sun.shadow.camera.right = 40;
    sun.shadow.camera.top = 40; sun.shadow.camera.bottom = -40;
    sun.shadow.camera.far = 200;
    sun.shadow.bias = -0.0008;
    scene.add(sun, sun.target);
    this.sun = sun;

    const surround = new THREE.Mesh(new THREE.PlaneGeometry(400, 260), new THREE.MeshStandardMaterial({ color: '#24502a', roughness: 1 }));
    surround.rotation.x = -Math.PI / 2;
    surround.position.set(50, -0.02, W / 2);
    surround.receiveShadow = true;
    scene.add(surround);
    const field = new THREE.Mesh(new THREE.PlaneGeometry(120, W), new THREE.MeshStandardMaterial({ map: fieldTexture(game.teams, game.home, game.away, displayFont), roughness: 0.95 }));
    field.rotation.x = -Math.PI / 2;
    field.position.set(50, 0, W / 2);
    field.receiveShadow = true;
    scene.add(field);
    this.field = field;
    this.buildStadium();
    this.buildPosts();

    const strip = (color, op) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.28, W), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, depthWrite: false }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(0, 0.02, W / 2);
      scene.add(m);
      return m;
    };
    this.losLine = strip('#3d8bff', 0.85);
    this.fdLine = strip('#f5d33a', 0.9);

    // the ball: prolate spheroid
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 10), new THREE.MeshStandardMaterial({ color: '#6b3a1e', roughness: 0.55 }));
    ball.scale.set(1.6, 1, 1);
    const lace = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.012, 0.01), new THREE.MeshBasicMaterial({ color: '#f2efe6' }));
    lace.position.set(0, 0.15, 0);
    ball.add(lace);
    ball.castShadow = true;
    this.ball = new THREE.Group();
    this.ball.add(ball);
    this.ballMesh = ball;
    scene.add(this.ball);
    // ball flight trail
    this.trailGeo = new THREE.BufferGeometry();
    this.trailPos = new Float32Array(3 * 120);
    this.trailGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    this.trail = new THREE.Line(this.trailGeo, new THREE.LineBasicMaterial({ color: '#f5d33a', transparent: true, opacity: 0.55 }));
    scene.add(this.trail);
    // flag
    const flag = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 0.4), new THREE.MeshStandardMaterial({ color: '#f7d417', emissive: '#4a3d00' }));
    flag.visible = false;
    scene.add(flag);
    this.flag = flag;

    this.players = new Map();
    this.riggedGltf = null;
    this.rigLoadStarted = performance.now();
    this.rigLoadMs = null;
    loadRiggedPlayer().then((gltf) => {
      this.rigLoadMs = performance.now() - this.rigLoadStarted;
      this.riggedGltf = gltf;
      const names = new Set();
      gltf.scene.traverse((o) => { if (o.isSkinnedMesh) o.skeleton.bones.forEach((b) => names.add(b.name)); });
      console.log('rigged player loaded:', names.size, 'bones');
      if (this.roster) this.setRoster(this.roster); // rebuild with the rigged model
    }).catch((err) => {
      console.warn('rigged player unavailable, using primitive fallback', err);
      this.riggedGltf = null;
    });
    this.kits = this.makeKits();
    this.cam = { mode: 'broadcast', focus: new THREE.Vector3(50, 0, W / 2), pos: new THREE.Vector3(50, 30, -40) };
    this.raycaster = new THREE.Raycaster();
    this.selected = null;
    this.paths = new THREE.Group();
    scene.add(this.paths);
    // Debug annotations (assignment targets, pursuit lines, lanes). Off unless
    // the sandbox asks for them; never part of an ordinary broadcast view.
    this.debug = new THREE.Group();
    this.debug.visible = false;
    scene.add(this.debug);
  }

  /**
   * Draw coaching annotations.
   * @param {{segments: Array<{x0:number,y0:number,x1:number,y1:number,color?:string}>, marks: Array<{x:number,y:number,color?:string,radius?:number}>}} spec
   */
  setDebugOverlay(spec) {
    for (const child of [...this.debug.children]) {
      child.geometry?.dispose();
      child.material?.dispose();
      this.debug.remove(child);
    }
    if (!spec) { this.debug.visible = false; return; }
    for (const s of spec.segments ?? []) {
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(s.x0, 0.12, s.y0), new THREE.Vector3(s.x1, 0.12, s.y1),
      ]);
      this.debug.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: s.color ?? '#f5d33a', transparent: true, opacity: 0.85 })));
    }
    for (const m of spec.marks ?? []) {
      const geo = new THREE.RingGeometry((m.radius ?? 0.55) * 0.75, m.radius ?? 0.55, 20);
      const ring = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: m.color ?? '#4ad2ff', transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(m.x, 0.12, m.y);
      this.debug.add(ring);
    }
    this.debug.visible = this.debug.children.length > 0;
  }

  makeKits() {
    const g = this.game;
    return kitsForGame(g.home, g.away, g.teams, g.seed ?? '');
  }

  buildStadium() {
    // ?stadium= picks the backdrop:
    //   dome (default) - procedural NFL dome in the home team's colours (web/nfl-dome.js)
    //   blockout       - the original box stands and light towers only, cheapest to draw
    //   bowl           - the older baked soccer bowl GLB (web/stadium.js)
    const mode = (typeof location !== 'undefined' && new URLSearchParams(location.search).get('stadium')) || 'dome';
    this.stadiumMode = mode;
    if (mode !== 'bowl' && mode !== 'blockout') {
      const g = this.game;
      const dome = buildNflDome({ teams: g.teams, home: g.home, away: g.away, seed: 7, font: this.displayFont });
      this.scene.add(dome);
      this.stadiumModel = dome;
      this.stadiumLoadMs = 0;
      return;
    }
    // Cheap blockout while the baked stadium GLB loads (see web/stadium.js).
    const primitives = (this.stadiumPrimitives = new THREE.Group());
    this.scene.add(primitives);
    const seat = new THREE.MeshStandardMaterial({ color: '#141b24', roughness: 1 });
    const crowd = new THREE.MeshStandardMaterial({ color: '#202a36', roughness: 1 });
    for (const [x, z, w, d, ry] of [[50, -22, 150, 20, 0], [50, W + 22, 150, 20, 0], [-32, W / 2, 20, 95, 0], [132, W / 2, 20, 95, 0]]) {
      const tiers = new THREE.Group();
      for (let i = 0; i < 4; i++) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w - i * 2, 3 + i * 3, d - i * 4), i % 2 ? seat : crowd);
        const out = z < 0 ? -1 : z > W ? 1 : 0;
        const outx = x < 0 ? -1 : x > 100 ? 1 : 0;
        m.position.set(x + outx * i * 4, (3 + i * 3) / 2, z + out * i * 4);
        tiers.add(m);
      }
      tiers.rotation.y = ry;
      primitives.add(tiers);
    }
    // light towers
    const tower = new THREE.MeshStandardMaterial({ color: '#2a333d' });
    const lamp = new THREE.MeshBasicMaterial({ color: '#fff7d6' });
    for (const [x, z] of [[-20, -32], [120, -32], [-20, W + 32], [120, W + 32]]) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(1.2, 40, 1.2), tower);
      t.position.set(x, 20, z);
      const l = new THREE.Mesh(new THREE.BoxGeometry(8, 3, 1), lamp);
      l.position.set(x, 41, z);
      primitives.add(t, l);
    }
    if (mode === 'blockout') { this.stadiumModel = primitives; return; }
    this.loadStadiumModel();
  }

  /** Swap the blockout for the baked bowl. Failure keeps the primitives, never a blank scene. */
  loadStadiumModel() {
    this.stadiumStarted = performance.now();
    loadStadium().then((group) => {
      placeStadium(group, { centerX: 50, centerZ: W / 2, scale: STADIUM_SCALE });
      this.scene.add(group);
      this.stadiumModel = group;
      this.stadiumLoadMs = performance.now() - this.stadiumStarted;
      if (this.stadiumPrimitives) {
        this.scene.remove(this.stadiumPrimitives);
        this.stadiumPrimitives.traverse((o) => { o.geometry?.dispose?.(); });
        this.stadiumPrimitives = null;
      }
      console.log('stadium model loaded:', group.userData.meshes, 'meshes in', Math.round(this.stadiumLoadMs), 'ms');
    }).catch((err) => {
      console.warn('stadium model unavailable, keeping blockout', err);
    });
  }

  buildPosts() {
    const m = new THREE.MeshStandardMaterial({ color: '#f2d43a', roughness: 0.4, metalness: 0.3 });
    for (const x of [-10, 110]) {
      const g = new THREE.Group();
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 10 / 3, 8), m);
      base.position.y = 10 / 6;
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 18.5 / 3, 8), m);
      bar.rotation.x = Math.PI / 2;
      bar.position.y = 10 / 3;
      g.add(base, bar);
      for (const s of [1, -1]) {
        const up = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 35 / 3, 8), m);
        up.position.set(0, 10 / 3 + 35 / 6, (s * 18.5) / 6);
        g.add(up);
      }
      g.position.set(x, 0, W / 2);
      this.scene.add(g);
    }
  }

  /** Swap in the 22 bodies for a play. */
  setRoster(roster) {
    for (const [, o] of this.players) {
      this.scene.remove(o);
      o.userData.dispose?.();
    }
    this.players.clear();
    this.roster = roster;
    this.kits = this.makeKits();
    roster.forEach((r, i) => {
      const sourceInfo = this.game.players[r.id];
      const info = { ...sourceInfo, animationSeed: this.game.seed ?? '' };
      const o = this.riggedGltf
        ? buildRiggedPlayer(this.riggedGltf, info, this.kits[r.team])
        : buildPlayer(info, this.kits[r.team]);
      o.userData.index = i;
      applyPlayerShadows(o);
      this.players.set(r.id, o);
      this.scene.add(o);
    });
    this.paths.clear();
    this.trailN = 0;
  }

  setLines(losX, fdX) {
    this.losLine.visible = losX != null;
    this.fdLine.visible = fdX != null;
    if (losX != null) this.losLine.position.x = losX;
    if (fdX != null) this.fdLine.position.x = fdX;
  }

  setPaths(rec, upto) {
    // tactical mode: every player's path so far
    if (!rec || this.cam.mode !== 'top') {
      if (this.paths.children.length) this.paths.clear();
      return;
    }
    if (upto === this.pathsUpto && rec === this.pathsRec) return;
    this.pathsUpto = upto;
    this.pathsRec = rec;
    for (const c of this.paths.children) c.geometry.dispose();
    this.paths.clear();
    const n = rec.roster.length;
    for (let i = 0; i < n; i++) {
      const pts = [];
      for (let k = 0; k <= upto; k += 2) {
        const f = rec.frames[k];
        pts.push(new THREE.Vector3(f[i * 6], 0.05, f[i * 6 + 1]));
      }
      if (pts.length < 2) continue;
      const team = rec.roster[i].team;
      const col = team === this.game.home ? this.game.teams[team].alt : '#e8ecf1';
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.6 }));
      this.paths.add(line);
    }
  }

  /** Draw interpolated frame state. */
  draw(rec, t, dt) {
    if (!rec) return;
    if (rec !== this.cueRec) {
      this.cueRec = rec;
      this.cuesById = deriveCues(rec);
    }
    const fi = Math.max(0, Math.min(rec.frames.length - 1.001, (t - rec.t0) * rec.hz));
    const k0 = Math.floor(fi), a = fi - k0;
    const f0 = rec.frames[k0], f1 = rec.frames[Math.min(rec.frames.length - 1, k0 + 1)];
    const L = (i) => f0[i] + (f1[i] - f0[i]) * a;
    const n = rec.roster.length;
    const playerUpdateStart = performance.now();
    const aux = rec.aux ? rec.aux[k0] : null, aux1 = rec.aux ? rec.aux[Math.min(rec.frames.length - 1, k0 + 1)] : null;
    const AS = rec.auxStride || 5;
    // 1. interpolated positions
    const X = new Float64Array(n), Z = new Float64Array(n), X0 = new Float64Array(n), Z0 = new Float64Array(n);
    for (let i = 0; i < n; i++) { X[i] = X0[i] = L(i * 6); Z[i] = Z0[i] = L(i * 6 + 1); }
    // 2. keep bodies from drawing through each other. The physics lets padded discs
    // overlap and ignores downed players entirely, so push overlapping pairs apart
    // for display only (simulation output is untouched). A tackler and the man he
    // wrapped are allowed to be close.
    const down = (i) => f0[i * 6 + 4] === POSE.DOWN;
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          if (aux && aux[i * AS + 3] >= 2 && aux[i * AS + 4] === j) continue;
          const min = down(i) || down(j) ? 0.8 : 0.52;
          let dx = X[j] - X[i], dz = Z[j] - Z[i];
          const d2 = dx * dx + dz * dz;
          if (d2 >= min * min) continue;
          const d = Math.sqrt(d2);
          if (d < 1e-6) { dx = 1; dz = 0; } else { dx /= d; dz /= d; }
          const push = (min - d) / 2;
          X[i] -= dx * push; Z[i] -= dz * push; X[j] += dx * push; Z[j] += dz * push;
        }
      }
    }
    for (let i = 0; i < n; i++) {
      const o = this.players.get(rec.roster[i].id);
      if (!o) continue;
      const b = i * 6;
      const nx = X[i], nz = Z[i];
      const moved = o.userData.seen ? Math.hypot(nx - o.position.x, nz - o.position.z) * YD : 0;
      o.userData.seen = true;
      o.position.set(nx, 0, nz);
      let h0 = f0[b + 2], h1 = f1[b + 2];
      let dh = h1 - h0;
      while (dh > Math.PI) dh -= 2 * Math.PI;
      while (dh < -Math.PI) dh += 2 * Math.PI;
      let yaw = h0 + dh * a;
      const AL = (c) => aux[i * AS + c] + (aux1[i * AS + c] - aux[i * AS + c]) * a;
      let ctx = null;
      let vel = null;
      if (aux) {
        const role = aux[i * AS + 3], partner = aux[i * AS + 4];
        const vx = AL(0), vy = AL(1), sp = Math.hypot(vx, vy);
        vel = { vx, vy, sp };
        // blockers and tacklers square up to the man they are on
        if ((role === 1 || role === 2) && partner >= 0) yaw = Math.atan2(Z[partner] - Z[i], X[partner] - X[i]);
        ctx = { role, partner, back: sp > 0.6 && vx * Math.cos(yaw) + vy * Math.sin(yaw) < -0.35 * sp };
      }
      o.rotation.y = -yaw;
      if (o.userData.rigged) {
        // direction of travel relative to the heading; hips turn toward it. The recorded
        // velocity vector is exact; differencing positions was the fallback for old records.
        const vx = vel ? vel.vx : f1[b] - f0[b], vz = vel ? vel.vy : f1[b + 1] - f0[b + 1];
        const moving = vel ? vel.sp > 0.1 : Math.hypot(vx, vz) > 1e-4;
        const dir = moving ? Math.atan2(Math.sin(Math.atan2(vz, vx) - yaw), Math.cos(Math.atan2(vz, vx) - yaw)) : null;
        const speed = L(b + 3);
        const offset = travelYawOffset(o, { pose: f0[b + 4], speed, dir, dt });
        o.rotation.y = -(yaw + offset);
        // cosine between the hips and the travel: 1 straight ahead, -1 backwards
        const travel = dir === null ? null : Math.cos(dir - offset);
        animateRigged(o, f0[b + 4], speed, dt, f0[b + 5] > 0.5, t, this.cuesById?.get(rec.roster[i].id) || null, travel, ctx);
      } else {
        const onset = kickOnsets(rec)[i];
        const tk = onset >= 0 ? (t - rec.t0) - onset / rec.hz : null;
        animate(o, f0[b + 4], L(b + 3), dt, f0[b + 5] > 0.5, tk, moved, ctx);
      }
    }
    this.lastPlayerUpdateMs = performance.now() - playerUpdateStart;
    const B = n * 6;
    let bx = L(B), by = L(B + 1);
    const bz = L(B + 2) / YD;
    for (let i = 0; i < n; i++) if (f0[i * 6 + 5] > 0.5) { bx += X[i] - X0[i]; by += Z[i] - Z0[i]; break; }
    this.ball.position.set(bx, Math.max(0.12, bz), by);
    this.ball.rotation.set(0, -f0[B + 4], 0);
    this.ballMesh.rotation.set(f0[B + 3] * 0.3, 0, f0[B + 5]);
    // trail while airborne
    if (bz > 0.6) {
      const p = this.trailPos;
      if (this.trailN >= 120) { p.copyWithin(0, 3); this.trailN = 119; }
      p.set([bx, bz, by], this.trailN * 3);
      this.trailN++;
      this.trailGeo.setDrawRange(0, this.trailN);
      this.trailGeo.attributes.position.needsUpdate = true;
    }
    this.ballPos = { x: bx, y: by, z: bz };
  }

  /** The recorded physics lets bodies interpenetrate; push drawn bodies apart (view only, stateless). */
  separatePlayers(rec) {
    const objs = [];
    for (const r of rec.roster) { const o = this.players.get(r.id); if (o) objs.push(o); }
    const D = BODY_SPACING, D2 = D * D;
    for (let pass = 0; pass < 3; pass++) {
      let moved = false;
      for (let i = 0; i < objs.length; i++) {
        const a = objs[i].position;
        for (let j = i + 1; j < objs.length; j++) {
          const b = objs[j].position;
          const dx = b.x - a.x, dz = b.z - a.z, d2 = dx * dx + dz * dz;
          if (d2 >= D2) continue;
          const d = Math.sqrt(d2);
          // exactly stacked: separate along a fixed axis so paused frames stay stable
          const nx = d > 1e-4 ? dx / d : 1, nz = d > 1e-4 ? dz / d : 0;
          const push = (D - d) / 2;
          a.x -= nx * push; a.z -= nz * push; b.x += nx * push; b.z += nz * push;
          moved = true;
        }
      }
      if (!moved) break;
    }
  }

  clearTrail() {
    this.trailN = 0;
    this.trailGeo.setDrawRange(0, 0);
  }

  showFlag(at) {
    this.flag.visible = !!at;
    if (at) this.flag.position.set(at.x, 0.05, at.y);
  }

  select(id) {
    for (const [pid, o] of this.players) o.userData.ring.visible = pid === id;
    this.selected = id;
  }

  pick(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const v = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(v, this.camera);
    const hits = this.raycaster.intersectObjects([...this.players.values()], true);
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData.id) o = o.parent;
      if (o) return o.userData.id;
    }
    return null;
  }

  setCamera(mode) {
    this.cam.mode = mode;
    this.controls.enabled = mode === 'free';
    if (mode === 'free') this.controls.target.copy(this.cam.focus);
  }

  updateCamera(dt, ctx) {
    const c = this.cam;
    const bp = this.ballPos || { x: 50, y: W / 2, z: 0 };
    const sel = this.selected && this.players.get(this.selected);
    const tgt = sel && c.mode === 'follow' ? new THREE.Vector3(sel.position.x, 1, sel.position.z) : new THREE.Vector3(bp.x, Math.min(bp.z * 0.35, 6), bp.y);
    const k = 1 - Math.exp(-dt * (c.mode === 'top' ? 2 : 2.8));
    c.focus.lerp(tgt, k);
    if (c.mode === 'free') {
      this.controls.target.lerp(tgt, k * 0.5);
      this.controls.update();
      return;
    }
    const f = c.focus;
    const dir = ctx?.dir || 1;
    let pos, fov = 32;
    if (c.mode === 'broadcast') pos = new THREE.Vector3(f.x - dir * 3, 19 + bp.z * 0.25, W + 31), fov = 30;
    else if (c.mode === 'all22') pos = new THREE.Vector3(f.x - dir * 52, 44, W / 2 + (f.z - W / 2) * 0.3), fov = 38;
    else if (c.mode === 'sky') pos = new THREE.Vector3(f.x - dir * 15, 9, f.z), fov = 55;
    else if (c.mode === 'follow') pos = new THREE.Vector3(f.x - dir * 9, 5, f.z + 7), fov = 50;
    else pos = new THREE.Vector3(f.x, 95, f.z + 0.01), fov = 40;
    c.pos.lerp(pos, 1 - Math.exp(-dt * 3));
    this.camera.position.copy(c.pos);
    if (Math.abs(this.camera.fov - fov) > 0.1) {
      this.camera.fov += (fov - this.camera.fov) * (1 - Math.exp(-dt * 3));
      this.camera.updateProjectionMatrix();
    }
    this.camera.lookAt(f);
    this.sun.position.set(f.x + 30, 90, f.z + 40);
    this.sun.target.position.copy(f);
  }

  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.r3.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render() {
    const start = performance.now();
    this.r3.render(this.scene, this.camera);
    this.lastRenderMs = performance.now() - start;
  }

  getPerformanceMetrics() {
    const geometries = new Set();
    const textures = new Set();
    for (const root of this.players.values()) {
      root.traverse((object) => {
        if (object.geometry) geometries.add(object.geometry);
        if (object.skeleton?.boneTexture) textures.add(object.skeleton.boneTexture);
        for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
          if (!material) continue;
          for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap']) {
            if (material[key]) textures.add(material[key]);
          }
        }
      });
    }
    let geometryBytes = 0;
    for (const geometry of geometries) {
      for (const attribute of Object.values(geometry.attributes || {})) geometryBytes += attribute.array?.byteLength || 0;
      geometryBytes += geometry.index?.array?.byteLength || 0;
    }
    let textureBytes = 0;
    for (const texture of textures) {
      const image = texture.image || texture.source?.data;
      const width = image?.width || image?.videoWidth || 0;
      const height = image?.height || image?.videoHeight || 0;
      textureBytes += width * height * 4;
    }
    return {
      players: this.players.size,
      rigLoadMs: this.rigLoadMs,
      playerUpdateMs: this.lastPlayerUpdateMs ?? null,
      renderMs: this.lastRenderMs ?? null,
      triangles: this.r3.info.render.triangles,
      drawCalls: this.r3.info.render.calls,
      rendererGeometries: this.r3.info.memory.geometries,
      rendererTextures: this.r3.info.memory.textures,
      playerGeometryBytes: geometryBytes,
      playerTextureBytes: textureBytes,
      playerGpuBytesEstimate: geometryBytes + textureBytes,
      gpuEstimateNote: 'CPU-side buffer and decoded RGBA texture sizes; not driver VRAM telemetry',
    };
  }

  project(x, y, z) {
    const v = new THREE.Vector3(x, z, y).project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    return { x: ((v.x + 1) / 2) * r.width, y: ((1 - v.y) / 2) * r.height, behind: v.z > 1 };
  }
}
