// three.js broadcast renderer. World units are yards: X runs goal line to
// goal line (0..100, end zones to -10/110), Z runs across the field
// (0..53.33), Y is up. Player bodies are built in metres and scaled.
import * as THREE from './vendor/three.module.js';
import { OrbitControls } from './vendor/OrbitControls.js';
import { loadRiggedPlayer, buildRiggedPlayer, animateRigged, setNeutralMode, stablePhase } from './rigged-player.js';
import { kitsForGame } from './football-kits.js';

// ?neutral=1 keeps the imported rig in its bind pose (no procedural posing).
if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('neutral')) {
  setNeutralMode(true);
}

const YD = 0.9144;
const W = 160 / 3;
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

function animate(root, pose, speed, dt, carrying) {
  const u = root.userData;
  const { legs, arms, torso, body } = u;
  u.phase += dt * (2.2 + speed * 0.9);
  const swing = Math.min(0.95, speed * 0.11);
  let lean = Math.min(0.38, speed * 0.04);
  let crouch = 0;
  let armF = [Math.sin(u.phase) * swing * 0.8, -Math.sin(u.phase) * swing * 0.8];
  let armOut = 0.12;
  let legA = [Math.sin(u.phase) * swing, -Math.sin(u.phase) * swing];
  let kneeB = [Math.max(0, -Math.cos(u.phase)) * swing * 1.4, Math.max(0, Math.cos(u.phase)) * swing * 1.4];
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
  const k = 1 - Math.exp(-dt * 14);
  legs.forEach((l, i) => {
    l.hip.rotation.z += (legA[i] - l.hip.rotation.z) * k;
    l.knee.rotation.z += (-kneeB[i] - l.knee.rotation.z) * k;
  });
  arms.forEach((a, i) => {
    a.sh.rotation.z += (armF[i] - a.sh.rotation.z) * k;
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
    const r = (this.r3 = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }));
    r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    r.shadowMap.enabled = true;
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
    sun.castShadow = true;
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
      this.scene.add(tiers);
    }
    // light towers
    const tower = new THREE.MeshStandardMaterial({ color: '#2a333d' });
    const lamp = new THREE.MeshBasicMaterial({ color: '#fff7d6' });
    for (const [x, z] of [[-20, -32], [120, -32], [-20, W + 32], [120, W + 32]]) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(1.2, 40, 1.2), tower);
      t.position.set(x, 20, z);
      const l = new THREE.Mesh(new THREE.BoxGeometry(8, 3, 1), lamp);
      l.position.set(x, 41, z);
      this.scene.add(t, l);
    }
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
      this.players.set(r.id, o);
      this.scene.add(o);
    });
    this.paths.clear();
    this.trailN = 0;
  }

  /** Debug/testing hook: which authored clip (if any) each player is running. */
  debugAnimation() {
    return [...this.players].map(([id, o]) => ({
      id,
      name: this.game.players?.[id]?.name ?? '',
      rigged: !!o.userData.rigged,
      clip: o.userData.animation?.activeClipName ?? null,
    }));
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
    const fi = Math.max(0, Math.min(rec.frames.length - 1.001, (t - rec.t0) * rec.hz));
    const k0 = Math.floor(fi), a = fi - k0;
    const f0 = rec.frames[k0], f1 = rec.frames[Math.min(rec.frames.length - 1, k0 + 1)];
    const L = (i) => f0[i] + (f1[i] - f0[i]) * a;
    const n = rec.roster.length;
    const playerUpdateStart = performance.now();
    for (let i = 0; i < n; i++) {
      const o = this.players.get(rec.roster[i].id);
      if (!o) continue;
      const b = i * 6;
      o.position.set(L(b), 0, L(b + 1));
      let h0 = f0[b + 2], h1 = f1[b + 2];
      let dh = h1 - h0;
      while (dh > Math.PI) dh -= 2 * Math.PI;
      while (dh < -Math.PI) dh += 2 * Math.PI;
      o.rotation.y = -(h0 + dh * a);
      if (o.userData.rigged) animateRigged(o, f0[b + 4], L(b + 3), dt, f0[b + 5] > 0.5);
      else animate(o, f0[b + 4], L(b + 3), dt, f0[b + 5] > 0.5);
    }
    this.lastPlayerUpdateMs = performance.now() - playerUpdateStart;
    const B = n * 6;
    const bx = L(B), by = L(B + 1), bz = L(B + 2) / YD;
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
