// College field for the playable game: mowing stripes, white border, dashed
// coaching-box line, college hash marks, yard numbers with direction arrows,
// a midfield logo and team end zones. One canvas texture on one plane.
//
// Field axes match the rest of the viewer: x is yards from the offense's goal
// line (end zones -10..0 and 100..110), z is across the field 0..W.

import * as THREE from '../vendor/three.module.js';

export const W = 160 / 3;
export const HASH_IN = 20;            // college hash marks: 60 ft in from each sideline
const PAD = { x: 16, z: 8 };          // grass drawn beyond the boundary
const S = 22;                         // pixels per yard

export function fieldMesh({ home, away, font = 'Arial Narrow, sans-serif' }) {
  const x0 = -10 - PAD.x, x1 = 110 + PAD.x, z0 = -PAD.z, z1 = W + PAD.z;
  const c = document.createElement('canvas');
  c.width = Math.round((x1 - x0) * S);
  c.height = Math.round((z1 - z0) * S);
  const g = c.getContext('2d');
  const X = (x) => (x - x0) * S;
  const Z = (z) => (z - z0) * S;

  // grass: 5-yard mowing stripes plus a little noise so it is not flat colour
  for (let x = x0; x < x1; x += 5) {
    g.fillStyle = Math.round((x + 100) / 5) % 2 ? '#3f7d33' : '#467f39';
    g.fillRect(X(x), 0, 5 * S + 1, c.height);
  }
  const noise = g.getImageData(0, 0, c.width, c.height);
  const d = noise.data;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * 16;
    d[i] += n; d[i + 1] += n * 1.2; d[i + 2] += n * 0.6;
  }
  g.putImageData(noise, 0, 0);

  // sideline border (6 ft) and the dashed coaching-box line beyond it
  g.fillStyle = '#f4f4ef';
  g.fillRect(X(-10) - 2 * S, Z(0) - 2 * S, 124 * S, 2 * S);
  g.fillRect(X(-10) - 2 * S, Z(W), 124 * S, 2 * S);
  g.fillRect(X(-10) - 2 * S, Z(0) - 2 * S, 2 * S, (W + 4) * S);
  g.fillRect(X(110), Z(0) - 2 * S, 2 * S, (W + 4) * S);
  g.strokeStyle = '#d6d34a';
  g.lineWidth = 0.18 * S;
  g.setLineDash([1.1 * S, 0.8 * S]);
  for (const z of [-5, W + 5]) {
    g.beginPath(); g.moveTo(X(20), Z(z)); g.lineTo(X(80), Z(z)); g.stroke();
  }
  g.setLineDash([]);

  // end zones
  const ez = (xa, team, flip) => {
    g.fillStyle = team.color;
    g.fillRect(X(xa), Z(0), 10 * S, W * S);
    g.save();
    g.translate(X(xa + 5), Z(W / 2));
    g.rotate(flip ? Math.PI / 2 : -Math.PI / 2);
    g.font = `800 ${6.4 * S}px ${font}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 0.35 * S;
    g.strokeStyle = '#ffffff';
    g.fillStyle = team.alt;
    g.strokeText(team.name.toUpperCase(), 0, 0);
    g.fillText(team.name.toUpperCase(), 0, 0);
    g.restore();
  };
  ez(-10, home, false);
  ez(100, away, true);

  // yard lines, goal lines, end lines
  g.fillStyle = '#f7f7f2';
  const line = (x, w) => g.fillRect(X(x) - (w * S) / 2, Z(0), w * S, W * S);
  for (let x = 0; x <= 100; x += 5) line(x, x === 0 || x === 100 ? 0.33 : 0.13);
  // ticks: sideline, hashes, and the 2-yard (3-yard college) conversion marks
  for (let x = 1; x < 100; x++) {
    if (x % 5 === 0) continue;
    for (const [a, b] of [[0.3, 1.0], [W - 1.0, W - 0.3], [HASH_IN - 0.7, HASH_IN], [W - HASH_IN, W - HASH_IN + 0.7]]) {
      g.fillRect(X(x) - 0.05 * S, Z(a), 0.1 * S, (b - a) * S);
    }
  }
  for (const x of [3, 97]) g.fillRect(X(x) - 0.05 * S, Z(W / 2 - 0.35), 0.1 * S, 0.7 * S);

  // yard numbers with arrows pointing to the nearer goal
  g.font = `700 ${1.9 * S}px ${font}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  for (let x = 10; x <= 90; x += 10) {
    const n = String(x <= 50 ? x : 100 - x);
    for (const [z, rot] of [[8.5, Math.PI], [W - 8.5, 0]]) {
      g.save();
      g.translate(X(x), Z(z));
      g.rotate(rot);
      g.fillText(n.split('').join(' '), 0, 0);
      if (x !== 50) {
        const toward = (x < 50) === (rot === 0) ? -1 : 1;   // arrow on the goal side of the number
        g.beginPath();
        const ax = toward * 1.95 * S, ay = -0.55 * S;
        g.moveTo(ax + toward * 0.45 * S, ay);
        g.lineTo(ax, ay - 0.25 * S);
        g.lineTo(ax, ay + 0.25 * S);
        g.fill();
      }
      g.restore();
    }
  }

  // midfield logo: the home team's mark
  g.save();
  g.translate(X(50), Z(W / 2));
  g.rotate(Math.PI / 2);          // reads upright from behind the offense
  g.beginPath(); g.arc(0, 0, 5.2 * S, 0, Math.PI * 2);
  g.fillStyle = home.alt; g.fill();
  g.beginPath(); g.arc(0, 0, 4.6 * S, 0, Math.PI * 2);
  g.fillStyle = home.color; g.fill();
  g.font = `800 ${3.8 * S}px ${font}`;
  g.fillStyle = home.alt;
  g.fillText(home.short.toUpperCase(), 0, 0.2 * S);
  g.restore();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(x1 - x0, z1 - z0),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.96, metalness: 0 })
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
  mesh.receiveShadow = true;
  mesh.name = 'field';
  return mesh;
}

/** Goal posts at the back of each end zone (college: same 18.5 ft width). */
export function goalPosts() {
  const group = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: '#f2d43a', roughness: 0.4, metalness: 0.3 });
  for (const x of [-10.3, 110.3]) {
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
    group.add(g);
  }
  return group;
}

/** Thin coloured strips on the turf: line of scrimmage and line to gain. */
export function strip(color, opacity) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(0.3, W),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.set(0, 0.03, W / 2);
  m.renderOrder = 2;
  return m;
}
