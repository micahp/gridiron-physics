// Playable college football: you run the offense, the computer plays defense.
//
// Bodies and animation reuse the Gridiron Physics viewer: one rigged player
// model whose clips (49 retargeted mocap clips plus 29 authored FB_* clips)
// all share its skeleton, driven by the same controller and runtime layers
// (foot lock, lean, arm reach) as the replay viewer. Positions are yards on
// the field (x downfield from the offense's goal line, z across 0..W), speeds
// are yards per second inside the game and m/s when handed to the animation.

import * as THREE from '../vendor/three.module.js';
import { loadRiggedPlayer, buildRiggedPlayer, animateRigged, travelYawOffset } from '../rigged-player.js';
import { FB } from '../rigged-animation-controller.js';
import { buildNflDome } from '../nfl-dome.js';
import { POSE } from '../pose-codes.js';
import { fieldMesh, goalPosts, strip, W, HASH_IN } from './field.js';
import { Input } from './input.js';

export const BUILD = 'play-2026-11-17a';
const YD = 0.9144;
const G = 9.81 / YD;                    // gravity, yd/s^2
const QUARTER = 4 * 60;                 // seconds per quarter (short game)
const ROLE = { NONE: 0, ENGAGED: 1, TACKLER: 2, WRAPPED: 3 };

export const TEAMS = {
  home: { key: 'home', name: 'Ridgeline', short: 'RSU', color: '#5b2a17', alt: '#f2b632' },
  away: { key: 'away', name: 'Coastal', short: 'CTU', color: '#13294b', alt: '#c7d3e3' },
};
const kit = (jersey, pants, helmet, number, trim, mask, sock = pants) => ({ jersey, pants, helmet, number, trim, mask, sock });
const KITS = {
  home: kit('#5b2a17', '#e9c46a', '#5b2a17', '#f2b632', '#f2b632', '#f2b632', '#5b2a17'),
  away: kit('#f4f5f2', '#13294b', '#13294b', '#13294b', '#8fb3e0', '#9aa4b1', '#f4f5f2'),
};

const OFF_SLOTS = ['LT', 'LG', 'C', 'RG', 'RT', 'TE', 'QB', 'RB', 'WR1', 'WR2', 'SLOT'];
const DEF_SLOTS = ['LEDGE', 'LDT', 'RDT', 'REDGE', 'LB1', 'LB2', 'CB1', 'CB2', 'NB', 'FS', 'SS'];
const NUMBERS = [72, 64, 55, 66, 77, 88, 7, 22, 1, 11, 4, 91, 97, 93, 99, 44, 52, 24, 21, 3, 31, 28];
const SPEED = {   // top speed yd/s
  LT: 5.6, LG: 5.4, C: 5.5, RG: 5.4, RT: 5.6, TE: 6.8, QB: 6.9, RB: 7.5, WR1: 8.0, WR2: 7.9, SLOT: 8.0,
  LEDGE: 7.0, LDT: 6.4, RDT: 6.4, REDGE: 7.0, LB1: 7.5, LB2: 7.4, CB1: 8.1, CB2: 8.0, NB: 8.0, FS: 7.9, SS: 7.8,
};
const SPRINT = 1.1;                    // carrier sprint multiplier
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const rand = (a, b) => a + Math.random() * (b - a);

export class Game {
  constructor(canvas, hud) {
    this.canvas = canvas;
    this.hud = hud;
    this.auto = new URLSearchParams(location.search).has('auto');
    this.input = new Input(hud.controls);
    this.t = 0;
    this.players = [];
    this.phase = 'loading';
    this.score = { home: 0, away: 0 };
    this.quarter = 1;
    this.clock = QUARTER;
    this.drive = { los: 25, down: 1, toGo: 10, ballZ: W / 2, plays: 0, startLos: 25 };
    this.play = null;
    this.setupRenderer();
  }

  // ------------------------------------------------------------------ scene
  setupRenderer() {
    const r = (this.r3 = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' }));
    const mobile = matchMedia('(pointer: coarse)').matches;
    r.setPixelRatio(Math.min(mobile ? 1.5 : 2, window.devicePixelRatio || 1));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.25;
    const scene = (this.scene = new THREE.Scene());
    scene.background = new THREE.Color('#0b1016');
    scene.fog = new THREE.Fog('#0b1016', 140, 300);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.5, 700);
    scene.add(new THREE.HemisphereLight('#eef2ff', '#33452c', 1.45));
    const sun = new THREE.DirectionalLight('#fff4e0', 1.9);
    sun.position.set(20, 80, 60);
    scene.add(sun);
    const surround = new THREE.Mesh(new THREE.PlaneGeometry(500, 300), new THREE.MeshStandardMaterial({ color: '#2b5a26', roughness: 1 }));
    surround.rotation.x = -Math.PI / 2;
    surround.position.set(50, -0.03, W / 2);
    scene.add(surround);
    scene.add(fieldMesh({ home: TEAMS.home, away: TEAMS.away }));
    scene.add(goalPosts());
    try {
      scene.add(buildNflDome({ teams: { home: TEAMS.home, away: TEAMS.away }, home: 'home', away: 'away', seed: 7 }));
    } catch (err) {
      console.warn('stadium unavailable', err);
    }
    this.losLine = strip('#3d8bff', 0.9);
    this.fdLine = strip('#f5d33a', 0.95);
    scene.add(this.losLine, this.fdLine);

    // the ball: a prolate spheroid with a white lace
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.15, 18, 12), new THREE.MeshStandardMaterial({ color: '#6b3a1e', roughness: 0.55 }));
    ball.scale.set(1.75, 1, 1);
    const lace = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.012, 0.012), new THREE.MeshBasicMaterial({ color: '#f2efe6' }));
    lace.position.set(0, 0.15, 0);
    ball.add(lace);
    this.ball = new THREE.Group();
    this.ball.add(ball);
    scene.add(this.ball);
    this.ballState = { x: 50, y: 0.15, z: W / 2, holder: null, flight: null, yaw: 0, spin: 0 };

    // shadow blobs and the target marker for passes
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 3, 32, 32, 31);
    grad.addColorStop(0, 'rgba(0,0,0,0.5)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    const blobTex = new THREE.CanvasTexture(c);
    this.blobGeo = new THREE.PlaneGeometry(1.5, 1.5).rotateX(-Math.PI / 2);
    this.blobMat = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false });
    this.target = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.75, 28).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#f5d33a', transparent: true, opacity: 0.85, depthWrite: false }));
    this.target.visible = false;
    scene.add(this.target);

    this.cam = { focus: new THREE.Vector3(30, 0, W / 2), dist: 20, height: 12, ahead: 6 };
    const resize = () => {
      const w = window.innerWidth, h = window.innerHeight;
      r.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.fov = w < h ? 64 : 48;
      this.camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', resize);
    resize();
  }

  async load() {
    const gltf = await loadRiggedPlayer();
    const makeInfo = (i) => ({ id: `p${i}`, jersey: NUMBERS[i], physics: { height: i < 5 || (i >= 11 && i < 15) ? 1.95 : 1.86 } });
    for (let i = 0; i < 22; i++) {
      const off = i < 11;
      const slot = off ? OFF_SLOTS[i] : DEF_SLOTS[i - 11];
      const o = buildRiggedPlayer(gltf, makeInfo(i), off ? KITS.home : KITS.away);
      const blob = new THREE.Mesh(this.blobGeo, this.blobMat);
      blob.position.y = 0.02;
      o.add(blob);
      this.scene.add(o);
      this.players.push({
        i, off, slot, obj: o, x: 0, z: 0, vx: 0, vz: 0, yaw: 0, pose: POSE.STANCE, cues: [],
        top: SPEED[slot], role: ROLE.NONE, partner: null,
      });
    }
    this.qb = this.players[6];
    this.rb = this.players[7];
    this.phase = 'title';
  }

  start() {
    this.score = { home: 0, away: 0 };
    this.quarter = 1;
    this.clock = QUARTER;
    this.newDrive(25);
    this.toPlaycall();
  }

  // ------------------------------------------------------------- game flow
  newDrive(los) {
    this.drive = { los, down: 1, toGo: Math.min(10, 100 - los), ballZ: W / 2, plays: 0, startLos: los };
  }

  toPlaycall() {
    this.phase = 'playcall';
    this.lineUp();
    this.hud.playcall(this.drive.down === 4, this.drive.los);
    if (this.auto) setTimeout(() => this.callPlay(this.autoCall()), 600);
  }

  autoCall() {
    this.autoN = (this.autoN || 0) + 1;
    return this.autoN % 2 ? 'run' : 'pass';
  }

  callPlay(kind) {
    if (this.phase !== 'playcall') return;
    this.hud.hidePlaycall();
    if (kind === 'punt' || kind === 'fg') { this.specialTeams(kind); return; }
    this.play = { kind, snapped: false, t0: 0, carrier: null, thrown: false, over: false, result: null, dead: 0 };
    this.lineUp();
    this.phase = 'presnap';
    this.presnapAt = this.t;
    this.hud.presnap(kind);
    this.input.clear();
  }

  lineUp() {
    const L = this.drive.los, bz = this.drive.ballZ;
    const P = this.players;
    const set = (p, x, z, yaw) => {
      p.x = x; p.z = z; p.vx = 0; p.vz = 0; p.yaw = yaw; p.pose = POSE.STANCE;
      p.role = ROLE.NONE; p.partner = null; p.down = 0; p.stun = 0; p.cd = 0; p.shedAt = 0; p.carrying = false;
      p.cues = []; p.assign = null; p.route = null; p.state = null; p.miss = 0;
      p.obj.userData.ring.visible = false;
    };
    const wide = (dz) => clamp(bz + dz, 3.5, W - 3.5);
    const off = [
      [L - 0.75, bz - 2.6], [L - 0.75, bz - 1.3], [L - 0.45, bz], [L - 0.75, bz + 1.3], [L - 0.75, bz + 2.6],
      [L - 0.9, bz + 4.0], [L - 1.25, bz], [L - 6.0, bz], [L - 0.6, wide(-17)], [L - 0.6, wide(16)], [L - 1.3, wide(-9)],
    ];
    off.forEach(([x, z], i) => set(P[i], x, z, 0));
    const d = 11;
    const def = [
      [L + 0.9, bz - 3.9], [L + 0.9, bz - 0.9], [L + 0.9, bz + 1.6], [L + 0.9, bz + 4.8],
      [L + 4.6, bz - 2.2], [L + 4.6, bz + 2.6],
      [L + 6.5, P[8].z + 0.6], [L + 6.5, P[9].z - 0.6], [L + 5.0, P[10].z + 0.8],
      [L + 12.5, bz - 6], [L + 10, bz + 7],
    ];
    def.forEach(([x, z], i) => set(P[d + i - 0], x, z, Math.PI));
    this.ballState.holder = null;
    this.ballState.flight = null;
    this.ballState.x = L; this.ballState.y = 0.15; this.ballState.z = bz; this.ballState.yaw = 0;
    this.losLine.position.x = L;
    this.fdLine.position.x = Math.min(100, L + this.drive.toGo);
    this.fdLine.visible = L + this.drive.toGo < 100;
    this.target.visible = false;
    this.controlled = null;
    this.hud.bubbles([]);
  }

  hike() {
    const pl = this.play;
    if (!pl || pl.snapped) return;
    pl.snapped = true;
    pl.t0 = this.t;
    this.phase = 'live';
    this.sfx('snap');
    this.input.clear();
    this.hud.live(pl.kind);
    const P = this.players, L = this.drive.los, bz = this.drive.ballZ;
    for (const p of P) { p.pose = POSE.RUN; }
    // snap: the ball goes from the centre to the quarterback
    this.launchBall({ x: L, y: 0.3, z: bz }, { x: this.qb.x + 0.3, y: 1.0, z: this.qb.z }, 0.22, this.qb);
    if (pl.kind === 'run') {
      // inside zone to the right: the back aims at the right B gap, the quarterback meets him on the way
      pl.mesh = { x: L - 3.1, z: bz + 0.9, at: this.t + 0.95 };
      this.qb.state = 'toMesh';
      this.rb.state = 'toMesh';
      const give = { kind: 'handoff_give', side: 'R', at: pl.mesh.at - 0.55, anchorAt: pl.mesh.at, source: 'event' };
      const take = { kind: 'handoff_take', side: 'L', at: pl.mesh.at - 0.6, anchorAt: pl.mesh.at, source: 'event' };
      this.qb.cues.push(give);
      this.rb.cues.push(take);
      const A = ['LEDGE', 'LDT', 'LB1', 'RDT', 'REDGE', 'LB2'];   // LT LG C RG RT TE
      for (let i = 0; i < 6; i++) P[i].assign = this.bySlot(A[i]);
      P[8].assign = this.bySlot('CB1');
      P[9].assign = this.bySlot('CB2');
      P[10].assign = this.bySlot('NB');
    } else {
      const A = ['LEDGE', 'LDT', 'RDT', 'RDT', 'REDGE'];
      for (let i = 0; i < 5; i++) P[i].assign = this.bySlot(A[i]);
      this.qb.state = 'drop';
      this.controlled = this.qb;
      const route = (p, pts, speed, settle = false) => {
        p.route = { pts: pts.map(([dx, dz]) => ({ x: p.x + dx, z: p.z + dz })), k: 0, speed, settle };
      };
      route(P[8], [[40, 0]], P[8].top * 0.97);                       // WR1: go
      route(P[9], [[12, 0], [10.6, -1.0]], P[9].top * 0.95, true);   // WR2: curl
      route(P[10], [[4, 0], [14, 9]], P[10].top * 0.95);             // slot: slant
      route(P[5], [[6, 0], [6.5, 9]], P[5].top * 0.95);              // TE: out
      route(P[7], [[-0.5, -3.5], [3, -11], [8, -14]], P[7].top * 0.9); // RB: flat
      P[7].routeDelay = this.t + 0.5;
      pl.targets = [8, 10, 5, 9, 7];
    }
    // defensive assignments
    for (const d of P.slice(11)) {
      d.state = 'react';
      if (pl.kind === 'pass') {
        if (d.slot === 'CB1') d.man = P[8];
        if (d.slot === 'CB2') d.man = P[9];
        if (d.slot === 'NB') d.man = P[10];
        if (d.slot === 'LB2') d.man = P[5];
        if (d.slot === 'LB1') d.man = P[7];
      }
      d.readAt = this.t + (/LB|S$|FS/.test(d.slot) ? 0.45 : 0.25);
    }
  }

  bySlot(slot) { return this.players.find((p) => p.slot === slot); }

  launchBall(from, to, T, catcher = null, arc = null) {
    const bs = this.ballState;
    bs.holder = null;
    const vy = arc ?? ((to.y - from.y + 0.5 * G * T * T) / T);
    bs.flight = { x0: from.x, y0: from.y, z0: from.z, vx: (to.x - from.x) / T, vz: (to.z - from.z) / T, vy, t0: this.t, T, to, catcher };
    bs.x = from.x; bs.y = from.y; bs.z = from.z;
  }

  giveBall(p) {
    const bs = this.ballState;
    for (const q of this.players) q.carrying = false;
    bs.holder = p;
    bs.flight = null;
    bs.loose = null;
    if (p) p.carrying = true;
  }

  setCarrier(p, userControl = true) {
    this.giveBall(p);
    this.play.carrier = p;
    if (userControl) this.control(p);
    // anyone still running a route turns into a blocker
    for (const q of this.players) if (q.off && q !== p && q.route) { q.route = null; q.state = 'block'; }
  }

  control(p) {
    if (this.controlled) this.controlled.obj.userData.ring.visible = false;
    this.controlled = p;
    if (p) {
      p.obj.userData.ring.visible = true;
      p.obj.userData.ring.material.color.set('#f5d33a');
    }
  }

  // --------------------------------------------------------------- frame
  frame(dt) {
    dt = Math.min(dt, 1 / 20);
    this.t += dt;
    this.input.update();
    if (this.phase === 'presnap') {
      if (this.input.take('hike') || (this.auto && this.t - this.presnapAt > 1.2)) this.hike();
    }
    if (this.phase === 'live' || this.phase === 'dead') this.simulate(dt);
    this.draw(dt);
    this.moveBall(dt);
    this.updateCamera(dt);
    this.r3.render(this.scene, this.camera);
    this.hud.scorebug(this);
    if (this.phase === 'live' && this.play?.kind === 'pass' && !this.play.thrown && this.ballState.holder === this.qb && this.qb.x < this.drive.los) {
      this.hud.bubbles(this.play.targets.map((i, k) => ({ k, p: this.players[i], scr: this.project(this.players[i].x, 2.9, this.players[i].z) })));
    } else this.hud.bubbles([]);
    this.input.pressed.delete('juke'); // stale presses do not carry into later frames
  }

  simulate(dt) {
    const pl = this.play, P = this.players, t = this.t;
    const L = this.drive.los;
    // ---- offense
    for (const p of P) {
      if (p.down > 0) { p.down -= dt; p.vx *= 0.8; p.vz *= 0.8; p.pose = POSE.DOWN; if (p.down <= 0 && !pl.over) p.pose = POSE.RUN; continue; }
      if (p.stun > 0) { p.stun -= dt; p.vx *= 0.85; p.vz *= 0.85; continue; }
    }
    if (!pl.over) {
      this.offense(dt);
      this.defense(dt);
      this.engagements(dt);
      this.tackling(dt);
      this.checkBounds();
    } else {
      for (const p of P) {
        if (p.down > 0 || p.role === ROLE.WRAPPED) continue;
        this.steer(p, 0, 0, 0, dt, 9);
        if (p.role !== ROLE.TACKLER) p.role = ROLE.NONE;
      }
      if (this.phase === 'dead' && t > pl.dead) this.afterPlay();
    }
    // integrate
    for (const p of P) {
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      p.z = clamp(p.z, -6, W + 6);
      const sp = Math.hypot(p.vx, p.vz);
      if (p.face !== undefined && p.face !== null) {
        p.yaw += wrap(p.face - p.yaw) * Math.min(1, dt * 10);
      } else if (sp > 0.6 && p.pose !== POSE.DOWN) {
        p.yaw += wrap(Math.atan2(p.vz, p.vx) - p.yaw) * Math.min(1, dt * (p.carrying ? 12 : 8));
      }
      p.face = null;
    }
    this.separate();
  }

  /** Accelerate toward a desired velocity (yd/s) with a limit (yd/s^2). */
  steer(p, dvx, dvz, _unused, dt, accel = 12) {
    const ax = dvx - p.vx, az = dvz - p.vz, a = Math.hypot(ax, az), lim = accel * dt;
    if (a > lim) { p.vx += (ax / a) * lim; p.vz += (az / a) * lim; } else { p.vx = dvx; p.vz = dvz; }
  }

  toward(p, x, z, speed, dt, accel = 12, stopAt = 0.15) {
    const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
    if (d < stopAt) { this.steer(p, 0, 0, 0, dt, accel); return d; }
    const s = Math.min(speed, d * 3.2);
    this.steer(p, (dx / d) * s, (dz / d) * s, 0, dt, accel);
    return d;
  }

  offense(dt) {
    const pl = this.play, P = this.players, t = this.t, L = this.drive.los;
    const carrier = pl.carrier;
    for (const p of P) {
      if (!p.off || p.down > 0 || p.stun > 0 || p.role === ROLE.ENGAGED || p.role === ROLE.WRAPPED) continue;
      if (p === this.qb && p.state === 'drop') { this.qbDrop(p, dt); continue; }
      if (p === this.controlled && (p === carrier || p === this.qb)) { this.userMove(p, dt); continue; }
      if (p.state === 'toBall' && p.ballAt) {
        // come back to the ball and get there when it does
        this.toward(p, p.ballAt.x, p.ballAt.z, p.top, dt, 14, 0.2);
        continue;
      }
      if (pl.kind === 'run' && (p === this.qb || p === this.rb) && p.state === 'toMesh') {
        // scripted mesh: both arrive at the meeting point when the handoff anchors
        const m = pl.mesh, left = Math.max(0.05, m.at - t);
        const tx = p === this.qb ? m.x + 0.55 : m.x, tz = p === this.qb ? m.z - 0.75 : m.z;
        const d = Math.hypot(tx - p.x, tz - p.z);
        const s = p === this.qb ? Math.min(6, d / Math.max(0.1, left - 0.15)) : Math.min(p.top, d / left);
        this.toward(p, tx, tz, s, dt, 20, 0.05);
        if (p === this.qb) p.face = Math.atan2(this.rb.z - p.z, this.rb.x - p.x);
        if (t >= m.at && p === this.rb) {
          this.setCarrier(this.rb);
          this.rb.state = 'carry';
          this.qb.state = 'fake';
          this.rb.vx = Math.max(this.rb.vx, 4);
        }
        continue;
      }
      if (p === this.qb && p.state === 'fake') { this.toward(p, L - 4, p.z - 8, 4, dt); continue; }
      if (p.route && !(p.routeDelay > t)) { this.runRoute(p, dt); continue; }
      if (p.route) { this.steer(p, 0, 0, 0, dt); continue; }
      if (pl.kind === 'pass' && p.i < 5 && !pl.carrier) { this.passPro(p, dt); continue; }
      this.block(p, dt);
    }
  }

  userMove(p, dt) {
    const s = this.input.stick, held = this.input.held;
    let dx = s.y, dz = s.x;                              // camera looks down +x: stick up = upfield, right = +z
    let mag = Math.hypot(dx, dz);
    const pl = this.play;
    const sprint = held.has('sprint') || (this.auto && p.carrying);
    const runner = p === pl.carrier;
    if (this.auto && runner) {
      // test driver: run upfield, slide away from the nearest defender ahead
      let best = null;
      for (const d of this.players) {
        if (d.off || d.down > 0) continue;
        const ax = d.x - p.x, az = d.z - p.z;
        if (ax < -1 || Math.hypot(ax, az) > 7) continue;
        if (!best || Math.hypot(ax, az) < Math.hypot(best.x - p.x, best.z - p.z)) best = d;
      }
      dx = 1; dz = best ? -Math.sign(best.z - p.z || 1) * 0.8 : 0;
      if (p.z < 4) dz = 0.5; if (p.z > W - 4) dz = -0.5;
      mag = Math.hypot(dx, dz); dx /= mag; dz /= mag; mag = 1;
      if (best && Math.hypot(best.x - p.x, best.z - p.z) < 2.4 && !(p.jukeCd > this.t)) this.input.press('juke');
    }
    if (mag < 0.12) {
      // no input: a ball carrier keeps running upfield, a quarterback stands in the pocket
      if (runner) { dx = 1; dz = 0; mag = 0.85; } else { dx = 0; dz = 0; mag = 0; }
    } else { dx /= mag; dz /= mag; mag = Math.min(1, mag); }
    const top = p.top * (sprint && runner ? SPRINT : runner ? 1 : 0.8);
    // juke: a hard sideways step that leaves a closing tackler lunging at air
    if (runner && this.input.take('juke') && !(p.jukeCd > this.t)) {
      const fwdA = Math.atan2(p.vz, p.vx);
      let side = Math.abs(dz) > 0.25 ? Math.sign(dz) : (p.lastJuke ? -p.lastJuke : 1);
      p.lastJuke = side;
      const lx = -Math.sin(fwdA) * side, lz = Math.cos(fwdA) * side;   // the runner's right is (-sin a, cos a)
      const sp = Math.hypot(p.vx, p.vz);
      p.vx = p.vx * 0.55 + lx * 6.2;
      p.vz = p.vz * 0.55 + lz * 6.2;
      p.jukeUntil = this.t + 0.42;
      p.jukeCd = this.t + 0.9;
      this.hud.flash('JUKE');
      void sp;
    }
    if (runner && this.input.take('stiff') && !(p.stiffCd > this.t)) {
      const d = this.nearestDefender(p, 3);
      const fwd = Math.atan2(p.vz, p.vx);
      const side = d ? (((d.x - p.x) * Math.sin(fwd) - (d.z - p.z) * Math.cos(fwd)) > 0 ? 'L' : 'R') : 'L';
      p.cues.push({ kind: 'oneshot', clip: side === 'L' ? FB.STIFF_L : FB.STIFF_R, at: this.t, anchorAt: this.t + 0.22, source: 'user' });
      p.stiffUntil = this.t + 0.7;
      p.stiffSide = side;
      p.stiffCd = this.t + 1.3;
      this.hud.flash('STIFF ARM');
    }
    const accel = p.jukeUntil > this.t ? 6 : sprint ? 9 : 12;
    this.steer(p, dx * top * mag, dz * top * mag, 0, dt, accel);
    if (p === this.qb && !pl.carrier) {
      p.face = 0;   // a quarterback in the pocket keeps his eyes downfield
      if (p.x > this.drive.los + 0.3) {
        // past the line: he is a runner now
        this.setCarrier(p);
        this.hud.flash('QB RUN');
      }
    }
  }

  qbDrop(p, dt) {
    const L = this.drive.los, pl = this.play;
    if (this.ballState.holder !== p && !this.ballState.flight) return;
    const user = Math.hypot(this.input.stick.x, this.input.stick.y) > 0.15;
    if (user && this.t - pl.t0 > 0.35) { p.state = 'pocket'; this.userMove(p, dt); return; }
    const tx = L - 6.5;
    this.toward(p, tx, this.drive.ballZ, 5.5, dt, 14, 0.2);
    p.face = 0;
    p.pose = POSE.BACKPEDAL;
    // auto mode: throw to the most open receiver once the drop is done
    if (this.auto && this.t - pl.t0 > 1.9 && !pl.thrown) {
      let best = 0, bestScore = -1e9;
      pl.targets.forEach((i, k) => {
        const r = this.players[i];
        const sep = Math.min(...this.players.filter((d) => !d.off).map((d) => Math.hypot(d.x - r.x, d.z - r.z)));
        const score = Math.min(sep, 5) * 2 + clamp(r.x - L, -3, 15) * 0.4;
        if (score > bestScore) { bestScore = score; best = k; }
      });
      this.input.press(`throw${best}`);
    }
  }

  runRoute(p, dt) {
    const r = p.route;
    if (r.k >= r.pts.length) {
      if (r.settle) { this.steer(p, 0, 0, 0, dt, 10); p.face = Math.PI; return; }
      const a = Math.atan2(p.vz, p.vx);
      this.steer(p, Math.cos(a) * r.speed, Math.sin(a) * r.speed, 0, dt, 10);
      return;
    }
    const q = r.pts[r.k];
    const d = this.toward(p, q.x, q.z, r.speed, dt, 14, 0);
    if (d < 0.7) r.k++;
  }

  passPro(p, dt) {
    const qb = this.qb;
    const d = p.assign;
    if (d && d.role !== ROLE.ENGAGED && d.down <= 0 && !d.shed) {
      // kick-slide to the spot on the rusher's path to the quarterback, a yard in front of him
      const ax = qb.x - d.x, az = qb.z - d.z, n = Math.hypot(ax, az) || 1;
      const lead = Math.min(1.6, n * 0.35);
      this.toward(p, d.x + (ax / n) * lead + d.vx * 0.15, d.z + (az / n) * lead + d.vz * 0.15, p.top * 1.15, dt, 22, 0.05);
      p.face = Math.atan2(d.z - p.z, d.x - p.x);
      if (Math.hypot(d.x - p.x, d.z - p.z) < 1.35) this.engage(p, d, 'pass');
      return;
    }
    // free: pick up the nearest unblocked rusher, otherwise sit in front of the quarterback
    const free = this.players.filter((q) => !q.off && q.down <= 0 && q.role !== ROLE.ENGAGED && Math.hypot(q.x - qb.x, q.z - qb.z) < 7);
    if (free.length) { p.assign = free.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0]; p.assign.shed = false; return; }
    this.toward(p, qb.x + 2.2, qb.z + (p.i - 2) * 1.2, 3, dt);
    p.face = 0;
  }

  block(p, dt) {
    const pl = this.play;
    const ref = pl.carrier || this.rb;
    let d = p.assign;
    if (!d || d.down > 0 || (d.role === ROLE.ENGAGED && d.partner !== p) || d.role === ROLE.TACKLER) {
      // new target: the nearest free defender between him and the play
      const cands = this.players.filter((q) => !q.off && q.down <= 0 && q.role === ROLE.NONE
        && Math.hypot(q.x - p.x, q.z - p.z) < 6 && q.x > ref.x - 2);
      d = p.assign = cands.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0] || null;
    }
    if (!d) {
      // nothing to hit: lead upfield ahead of the ball
      if (pl.carrier) this.toward(p, ref.x + 4, p.z + (ref.z - p.z) * 0.3, p.top * 0.8, dt);
      else this.steer(p, 2, 0, 0, dt);
      return;
    }
    if (d.role === ROLE.ENGAGED && d.partner === p) return;
    const ax = ref.x - d.x, az = ref.z - d.z, n = Math.hypot(ax, az) || 1;
    this.toward(p, d.x + (ax / n) * 0.7, d.z + (az / n) * 0.7, p.top, dt, 14, 0.05);
    if (Math.hypot(d.x - p.x, d.z - p.z) < 1.05 && d.role === ROLE.NONE && !(d.shedGrace > this.t)) this.engage(p, d, pl.kind);
  }

  engage(b, d, kind) {
    b.role = d.role = ROLE.ENGAGED;
    b.partner = d; d.partner = b;
    const dl = /EDGE|DT/.test(d.slot), lb = /LB/.test(d.slot);
    const base = kind === 'pass' ? (dl ? rand(2.8, 5.4) : rand(1.2, 2.4)) : (dl ? rand(1.2, 3.0) : lb ? rand(0.8, 2.0) : rand(0.9, 2.2));
    d.shedAt = this.t + base;
    b.engagedAt = this.t;
  }

  release(b, d, shed) {
    b.role = d.role = ROLE.NONE;
    b.partner = d.partner = null;
    if (shed) {
      d.shed = true;
      d.shedGrace = this.t + 0.8;
      b.stun = 0.45;
      b.assign = null;
      d.cues.push({ kind: 'oneshot', clip: Math.random() < 0.5 ? FB.SWIM : FB.RIP, at: this.t - 0.2, anchorAt: this.t + 0.25, source: 'shed' });
    }
  }

  engagements(dt) {
    const pl = this.play, t = this.t;
    const ref = pl.carrier || (pl.kind === 'pass' ? this.qb : this.rb);
    for (const d of this.players) {
      if (d.off || d.role !== ROLE.ENGAGED) continue;
      const b = d.partner;
      if (!b) { d.role = ROLE.NONE; continue; }
      if (t >= d.shedAt || b.down > 0) { this.release(b, d, true); continue; }
      // the pair drifts: the rusher works toward the ball, the blocker drives him the other way
      const ax = ref.x - d.x, az = ref.z - d.z, n = Math.hypot(ax, az) || 1;
      const early = pl.kind === 'run' && t - b.engagedAt < 1.0;
      let vx = (ax / n) * 0.8, vz = (az / n) * 0.8;
      if (early) { vx = 1.1; vz *= 0.3; }                         // run blockers win the first second
      if (pl.kind === 'pass') { vx = Math.min(vx, -0.4); }         // pass rush pushes the pocket back
      d.vx = vx; d.vz = vz;
      const ux = b.x - d.x, uz = b.z - d.z, m = Math.hypot(ux, uz) || 1;
      const kk = Math.min(1, dt * 10);                              // settle into contact, no pop
      b.x += (d.x + (ux / m) * 0.92 - b.x) * kk; b.z += (d.z + (uz / m) * 0.92 - b.z) * kk;
      b.vx = vx; b.vz = vz;
      d.face = Math.atan2(b.z - d.z, b.x - d.x);
      b.face = Math.atan2(d.z - b.z, d.x - b.x);
      d.pose = b.pose = POSE.BLOCK;
      // an engaged defender beside the ball carrier can still get an arm on him
      if (pl.carrier && Math.hypot(pl.carrier.x - d.x, pl.carrier.z - d.z) < 1.25 && Math.random() < dt * 1.5) {
        this.release(b, d, false);
        this.tryTackle(d, pl.carrier, 0.35);
      }
    }
    for (const p of this.players) if (p.role !== ROLE.ENGAGED && p.pose === POSE.BLOCK) p.pose = POSE.RUN;
  }

  defense(dt) {
    const pl = this.play, t = this.t, L = this.drive.los;
    const carrier = pl.carrier;
    const flight = this.ballState.flight;
    for (const d of this.players) {
      if (d.off || d.down > 0 || d.stun > 0 || d.role !== ROLE.NONE) continue;
      const spd = d.top * (d.miss > t ? 0.35 : 1);
      if (carrier) { this.pursue(d, carrier, spd, dt); continue; }
      if (pl.thrown && flight && t > pl.throwAt + 0.3) {
        // break on the ball
        const to = flight.to;
        if (Math.hypot(to.x - d.x, to.z - d.z) < 14) { this.toward(d, to.x, to.z, spd, dt, 14, 0.1); continue; }
      }
      if (t < d.readAt) { this.steer(d, /EDGE|DT/.test(d.slot) ? -1.5 : 0, 0, 0, dt); d.face = Math.PI; continue; }
      if (pl.kind === 'run') {
        // flow to the ball: the mesh, then whoever has it
        const tgt = this.rb;
        this.pursue(d, tgt, spd * (/CB|S$|FS|NB/.test(d.slot) ? 0.9 : 1), dt);
        continue;
      }
      // pass defense
      if (/EDGE|DT/.test(d.slot)) {
        // get-off, then bend toward the quarterback
        const early = t - pl.t0 < 0.7;
        this.pursue(d, this.qb, spd * (early ? 0.7 : 0.95), dt);
        continue;
      }
      if (d.man) { this.cover(d, d.man, spd, dt); continue; }
      // safeties: stay deeper than the deepest receiver on their side
      const side = d.slot === 'FS' ? -1 : 1;
      const mine = this.players.filter((r) => r.off && r.route && Math.sign(r.z - this.drive.ballZ || 1) === side);
      const deep = mine.sort((a, b) => b.x - a.x)[0];
      const tx = Math.max(L + 12, (deep ? deep.x : L) + 4);
      const tz = deep ? deep.z * 0.6 + this.drive.ballZ * 0.4 : d.z;
      this.toward(d, tx, tz, spd * 0.85, dt);
      d.face = Math.PI;
    }
  }

  cover(d, r, spd, dt) {
    // man coverage: a yard off his hip, on the inside, backpedalling until the receiver closes
    const inside = Math.sign(this.drive.ballZ - r.z) || 1;
    const tx = r.x + 1.2, tz = r.z + inside * 0.7;
    const gap = d.x - r.x;
    if (gap > 3.5 && r.vx > 2) {
      this.toward(d, tx, tz, Math.min(spd, 5.2), dt, 12, 0.1);
      d.face = Math.PI;     // backpedal while there is cushion
    } else {
      this.toward(d, tx + r.vx * 0.25, tz + r.vz * 0.25, spd * 0.98, dt, 13, 0.1);
    }
  }

  pursue(d, c, spd, dt) {
    const dist = Math.hypot(c.x - d.x, c.z - d.z);
    const lead = clamp(dist / Math.max(1, spd) * 0.9, 0, 1.4);
    this.toward(d, c.x + c.vx * lead, c.z + c.vz * lead, spd, dt, 13, 0);
  }

  nearestDefender(p, within = 99) {
    let best = null, bd = within;
    for (const d of this.players) {
      if (d.off || d.down > 0) continue;
      const dd = Math.hypot(d.x - p.x, d.z - p.z);
      if (dd < bd) { bd = dd; best = d; }
    }
    return best;
  }

  tackling(dt) {
    const pl = this.play, t = this.t;
    // a quarterback holding the ball behind the line can be sacked
    const c = pl.carrier || (this.ballState.holder === this.qb ? this.qb : null);
    if (!c || pl.over) return;
    if (pl.wrap) {
      const w = pl.wrap;
      // dragging the tackler: slow, but a press can still break it
      const a = Math.atan2(c.vz, c.vx);
      this.steer(c, Math.cos(a) * 1.8, Math.sin(a) * 1.8, 0, dt, 20);
      const tk = w.by;
      tk.x = c.x - Math.cos(w.ang) * 0.7; tk.z = c.z - Math.sin(w.ang) * 0.7;
      tk.vx = c.vx; tk.vz = c.vz;
      tk.face = Math.atan2(c.z - tk.z, c.x - tk.x);
      if (c === this.controlled && (this.input.take('juke') || this.input.take('stiff')) && w.tries < 2) {
        w.tries++;
        if (Math.random() < 0.28) {
          this.hud.flash('BROKE IT!');
          this.sfx('cheer');
          tk.role = ROLE.NONE; c.role = ROLE.NONE; tk.partner = c.partner = null;
          tk.down = 1.1; tk.cues.push({ kind: 'fall_variant', clip: FB.FALL, at: t, anchorAt: t });
          pl.wrap = null;
          c.vx += Math.cos(a) * 3; c.vz += Math.sin(a) * 3;
          return;
        }
      }
      if (t >= w.until) this.tackled(c, tk, w.front);
      return;
    }
    for (const d of this.players) {
      if (d.off || d.down > 0 || d.stun > 0 || d.role !== ROLE.NONE || d.cd > t) continue;
      const dx = c.x - d.x, dz = c.z - d.z, dist = Math.hypot(dx, dz);
      const reach = 1.0 + (Math.hypot(d.vx, d.vz) > 5.5 ? 0.35 : 0);
      if (dist > reach) continue;
      let p = c === this.qb && !pl.carrier ? 0.86 : 0.72;
      const cs = Math.hypot(c.vx, c.vz);
      const fromBehind = cs > 2 && (dx * c.vx + dz * c.vz) / (dist * cs) > 0.4;   // defender trails the runner
      if (fromBehind) p -= 0.25;
      if (cs > 8) p -= 0.08;
      const inFront = cs > 1 && (-dx * c.vx - dz * c.vz) / (dist * cs) > 0.2;
      if (c.jukeUntil > t && inFront) p = 0.12;
      if (c.stiffUntil > t) {
        const fwd = Math.atan2(c.vz, c.vx);
        const side = ((d.x - c.x) * Math.sin(fwd) - (d.z - c.z) * Math.cos(fwd)) > 0 ? 'L' : 'R';
        if (side === c.stiffSide) p = 0.22;
      }
      this.tryTackle(d, c, p);
      if (pl.wrap || pl.over) return;
    }
  }

  tryTackle(d, c, p) {
    const t = this.t, pl = this.play;
    d.cd = t + 0.9;
    if (Math.random() < p) {
      // wrap up: a short struggle, then he goes down
      const ang = Math.atan2(c.z - d.z, c.x - d.x);
      const front = Math.cos(ang - Math.atan2(c.vz, c.vx)) < -0.2 * (Math.hypot(c.vx, c.vz) > 1 ? 1 : 0);
      d.role = ROLE.TACKLER; c.role = ROLE.WRAPPED; d.partner = c; c.partner = d;
      d.pose = POSE.WRAP;
      const fast = Math.hypot(d.vx, d.vz) > 6;
      d.cues.push({ kind: 'oneshot', clip: fast ? FB.TACKLE_DIVE : FB.TACKLE_FORM, at: t - 0.15, anchorAt: t + 0.15, source: 'tackle' });
      pl.wrap = { by: d, until: t + (c === this.controlled ? 0.55 : 0.35), ang, tries: 0, front };
      this.sfx('pads');
    } else {
      // missed: he lunges at where the runner was and goes to the turf
      const dive = Math.hypot(d.vx, d.vz) > 5;
      if (dive) {
        d.cues.push({ kind: 'oneshot', clip: FB.TACKLE_DIVE, at: t - 0.1, anchorAt: t + 0.2, source: 'miss' });
        d.down = 1.2;
        d.cues.push({ kind: 'fall_variant', clip: FB.FALL, at: t + 0.4, anchorAt: t + 0.4 });
      } else {
        d.miss = t + 0.6;
      }
      if (c === this.controlled) this.hud.flash(c.jukeUntil > t ? 'JUKED HIM!' : c.stiffUntil > t ? 'STIFF ARM!' : 'MISSED TACKLE');
    }
  }

  tackled(c, tk, front) {
    const pl = this.play, t = this.t;
    c.cues.push({ kind: 'fall_variant', clip: front ? FB.FALL_BACK : FB.FALL, at: t, anchorAt: t });
    c.down = 9; tk.down = 9;
    c.pose = POSE.DOWN; tk.pose = POSE.DOWN;
    c.role = tk.role = ROLE.NONE;
    pl.wrap = null;
    // falling forward gains a little; going down backward gives a little up
    const a = Math.atan2(c.vz, c.vx);
    const spot = c.x + (front ? -0.3 : 0.6 * Math.max(0, Math.cos(a)));
    pl.by = tk.slot; pl.at = +(t - pl.t0).toFixed(2);
    if (c === this.qb && !pl.carrier) this.endPlay('sack', spot);
    else this.endPlay('tackle', spot);
  }

  checkBounds() {
    const pl = this.play;
    const c = pl.carrier;
    if (!c || pl.over) return;
    if (c.x >= 100) { this.endPlay('td', 100); return; }
    if (c.z < 0 || c.z > W) { this.endPlay('oob', c.x); return; }
    if (c.x < 0 && c.down > 0) this.endPlay('safety', 0);
  }

  // ------------------------------------------------------------------ ball
  moveBall(dt) {
    const bs = this.ballState, t = this.t;
    const pl = this.play;
    if (this.phase === 'live' && pl && !pl.thrown && bs.holder === this.qb && pl.kind === 'pass' && !pl.carrier) {
      for (let k = 0; k < pl.targets.length; k++) {
        if (this.input.take(`throw${k}`)) { this.throwTo(this.players[pl.targets[k]]); break; }
      }
    }
    if (pl?.pendingRelease && t >= pl.pendingRelease.at) {
      const r = pl.pendingRelease; pl.pendingRelease = null;
      if (this.ballState.holder === this.qb && this.qb.down <= 0) this.releasePass(r.to);
    }
    if (bs.flight) {
      const f = bs.flight, u = t - f.t0;
      bs.x = f.x0 + f.vx * u; bs.z = f.z0 + f.vz * u; bs.y = f.y0 + f.vy * u - 0.5 * G * u * u;
      bs.yaw = Math.atan2(f.vz, f.vx); bs.spin += dt * 30;
      if (u >= f.T) {
        bs.flight = null;
        if (f.pass) this.resolvePass(f);
        else if (f.catcher) this.giveBall(f.catcher);
        else { bs.y = 0.15; }
      }
    } else if (bs.holder) {
      const h = bs.holder.obj.userData.bones.handR;
      if (h) {
        const v = h.getWorldPosition(new THREE.Vector3());
        bs.x = v.x; bs.y = Math.max(0.2, v.y); bs.z = v.z;
      } else { bs.x = bs.holder.x; bs.y = 1.1; bs.z = bs.holder.z; }
      bs.yaw = bs.holder.yaw;
    } else if (bs.loose) {
      const f = bs.loose; const u = t - f.t0;
      if (u < 0.8) { bs.x += f.vx * dt; bs.z += f.vz * dt; f.vx *= 0.92; f.vz *= 0.92; bs.y = Math.max(0.15, 0.15 + Math.abs(Math.sin(u * 9)) * 0.5 * (1 - u)); }
    }
    this.ball.position.set(bs.x, bs.y, bs.z);
    this.ball.rotation.set(bs.flight ? bs.spin : 0, -bs.yaw, bs.flight ? -0.25 : 0.3);
  }

  throwTo(r) {
    const pl = this.play, t = this.t;
    if (pl.thrown) return;
    pl.thrown = true;
    pl.throwAt = t;
    this.qb.cues.push({ kind: 'throw', at: t, anchorAt: t + 0.32, source: 'user' });
    pl.pendingRelease = { at: t + 0.32, to: r };
    this.hud.bubbles([]);
  }

  releasePass(r) {
    const pl = this.play, t = this.t, qb = this.qb;
    const from = { x: qb.x + 0.3, y: 2.2, z: qb.z };
    // lead the receiver: where he will be when the ball gets there
    let T = 0.6, ax = r.x, az = r.z;
    for (let k = 0; k < 4; k++) {
      ax = r.x + r.vx * T; az = r.z + r.vz * T;
      T = Math.max(0.35, Math.hypot(ax - from.x, az - from.z) / 19);
    }
    const to = { x: ax + Math.cos(Math.atan2(r.vz, r.vx)) * 0.4 * (Math.hypot(r.vx, r.vz) > 2 ? 1 : 0), y: 1.35, z: az };
    this.giveBall(null);
    this.launchBall(from, to, T, null);
    this.ballState.flight.pass = true;
    this.ballState.flight.receiver = r;
    this.target.position.set(to.x, 0.04, to.z);
    this.target.visible = true;
    // the receiver comes back to the ball
    r.route = null;
    r.state = 'toBall';
    r.ballAt = to;
    const speed = Math.hypot(r.vx, r.vz) * YD;
    const clip = speed > 4 ? FB.CATCH_RUN : FB.CATCH_HIGH;
    r.cues.push({ kind: 'catch', at: t + T - 0.35, anchorAt: t + T, clip, source: 'pass' });
    this.control(r);
  }

  resolvePass(f) {
    const pl = this.play, t = this.t;
    const to = f.to, r = f.receiver;
    this.target.visible = false;
    const dr = Math.hypot(r.x - to.x, r.z - to.z);
    let nearD = null, dd = 99;
    for (const d of this.players) {
      if (d.off || d.down > 0) continue;
      const k = Math.hypot(d.x - to.x, d.z - to.z);
      if (k < dd) { dd = k; nearD = d; }
    }
    const sep = nearD ? Math.hypot(nearD.x - r.x, nearD.z - r.z) : 99;
    pl.passInfo = { to: r.slot, dr: +dr.toFixed(2), dd: +dd.toFixed(2), sep: +sep.toFixed(2), air: +f.T.toFixed(2) };
    if (nearD && dd < 1.3 && dd < dr && Math.random() < 0.35) {
      this.giveBall(nearD);
      this.endPlay('int', nearD.x);
      return;
    }
    if (dr < 1.7) {
      const pc = sep > 3 ? 0.93 : sep > 1.5 ? 0.76 : 0.5;
      if (Math.random() < pc) {
        this.setCarrier(r);
        r.state = 'carry';
        this.hud.flash('CATCH');
        this.sfx('cheer');
        return;
      }
    }
    // incomplete: the ball hits the turf and skips
    const bs = this.ballState;
    bs.loose = { vx: f.vx * 0.25, vz: f.vz * 0.25, t0: t };
    this.endPlay('inc', this.drive.los);
  }

  // --------------------------------------------------------------- results
  endPlay(kind, spot) {
    const pl = this.play;
    if (pl.over) return;
    pl.over = true;
    pl.result = { kind, spot };
    pl.dead = this.t + (kind === 'td' ? 2.6 : 1.6);
    this.phase = 'dead';
    this.sfx('whistle');
    this.hud.bubbles([]);
    this.target.visible = false;
    if (kind === 'td') {
      this.sfx('bigcheer');
      const c = pl.carrier;
      c.pose = POSE.CELEBRATE;
      c.down = 0;
      this.hud.banner('TOUCHDOWN!', TEAMS.home.alt);
    }
    if (kind === 'int') this.hud.banner('INTERCEPTED', '#ff6b5a');
    if (kind === 'inc') this.hud.banner('INCOMPLETE', '#ffffff');
    if (kind === 'oob') this.hud.flash('OUT OF BOUNDS');
    if (kind === 'sack') this.hud.banner('SACKED', '#ff6b5a');
  }

  afterPlay() {
    const pl = this.play, dr = this.drive;
    this.phase = 'between';                 // once per play
    const { kind, spot } = pl.result;
    const elapsed = this.t - pl.t0;
    const runoff = kind === 'inc' || kind === 'oob' || kind === 'td' || kind === 'int' ? elapsed : elapsed + 24;
    this.tick(runoff);
    dr.plays++;
    const carrier = pl.carrier;
    if (kind === 'td') {
      this.score.home += 7;
      this.hud.toast(`${TEAMS.home.short} touchdown · ${dr.plays} plays, ${Math.round(100 - dr.startLos)} yds · PAT good`);
      return this.opponentDrive();
    }
    if (kind === 'safety') {
      this.score.away += 2;
      this.hud.banner('SAFETY', '#ff6b5a');
      return this.opponentDrive();
    }
    if (kind === 'int') {
      return this.opponentDrive({ from: spot, note: 'after the interception' });
    }
    if ((kind === 'tackle' || kind === 'sack' || kind === 'oob') && spot <= 0) {
      this.score.away += 2;
      this.hud.banner('SAFETY', '#ff6b5a');
      return this.opponentDrive();
    }
    const newLos = kind === 'inc' ? dr.los : clamp(spot, 0.5, 99.5);
    const gained = newLos - dr.los;
    if (carrier) dr.ballZ = clamp(carrier.z, HASH_IN, W - HASH_IN);
    if (kind !== 'inc' && newLos >= dr.los + dr.toGo) {
      dr.los = newLos; dr.down = 1; dr.toGo = Math.min(10, 100 - newLos);
      this.hud.banner('FIRST DOWN', '#f5d33a');
    } else {
      dr.down++;
      dr.toGo = Math.max(0.5, dr.toGo - gained);
      dr.los = newLos;
      if (dr.down > 4) {
        this.hud.banner('TURNOVER ON DOWNS', '#ff6b5a');
        return this.opponentDrive({ from: newLos, note: 'after the stop' });
      }
      if (kind !== 'inc' && gained !== 0) this.hud.flash(`${gained > 0 ? '+' : ''}${Math.round(gained)} YDS`);
    }
    if (this.clock <= 0) return this.endQuarter();
    setTimeout(() => this.toPlaycall(), 900);
  }

  specialTeams(kind) {
    const dr = this.drive;
    const dist = 100 - dr.los + 17;
    this.tick(6);
    if (kind === 'fg') {
      const p = clamp(1.04 - (dist - 20) * 0.017, 0.12, 0.98);
      if (Math.random() < p) {
        this.score.home += 3;
        this.hud.banner(`${dist}-YD FIELD GOAL IS GOOD`, '#f5d33a');
        this.sfx('cheer');
        return this.opponentDrive();
      }
      this.hud.banner(`${dist}-YD FIELD GOAL MISSED`, '#ff6b5a');
      return this.opponentDrive({ from: dr.los - 7, note: 'after the miss' });
    }
    const punt = rand(36, 48);
    this.hud.banner(`PUNT · ${Math.round(punt)} YDS`, '#ffffff');
    this.opponentDrive({ from: Math.min(dr.los + punt, 80), note: 'after the punt' });
  }

  /** The other team's possession, played out off screen. */
  opponentDrive({ from = 75, note = 'after the kickoff' } = {}) {
    this.phase = 'between';
    // `from` is in our field coordinates: their start is 100 - from from their own goal
    const start = 100 - from;
    const r = Math.random();
    const toGoal = 100 - start;
    const pTD = toGoal < 40 ? 0.45 : 0.28;
    let res, pts = 0;
    if (r < pTD) { res = 'touchdown'; pts = 7; } else if (r < pTD + 0.2) { res = 'field goal'; pts = 3; } else res = 'punt';
    const used = Math.round(rand(80, 200));
    const plays = Math.round(used / 28) + 2;
    this.score.away += pts;
    const quarterBefore = this.quarter;
    this.tick(used);
    const yds = res === 'punt' ? Math.round(rand(5, 30)) : toGoal;
    setTimeout(() => {
      this.hud.toast(`${TEAMS.away.short} drive ${note}: ${plays} plays, ${yds} yds, ${res.toUpperCase()}`);
      if (this.over) return;
      let mine = 25;
      if (res === 'punt') mine = clamp(Math.round(rand(12, 34)), 5, 40);
      this.newDrive(mine);
      if (this.quarter !== quarterBefore) this.hud.banner(this.quarter > 4 ? 'FINAL' : `END OF Q${quarterBefore}`, '#ffffff');
      setTimeout(() => (this.over ? this.final() : this.toPlaycall()), 1400);
    }, 1500);
  }

  tick(seconds) {
    this.clock -= seconds;
    while (this.clock <= 0 && this.quarter <= 4) {
      if (this.quarter === 4) { this.clock = 0; this.over = true; break; }
      this.quarter++;
      this.clock += QUARTER;
    }
  }

  endQuarter() {
    if (this.over) return this.final();
    setTimeout(() => this.toPlaycall(), 900);
  }

  final() {
    this.phase = 'final';
    this.hud.final(this.score);
  }

  // ------------------------------------------------------------------ draw
  draw(dt) {
    const P = this.players;
    for (const p of P) {
      const o = p.obj;
      o.position.set(p.x, 0, p.z);
      const speed = Math.hypot(p.vx, p.vz) * YD;           // m/s for the animation
      const moving = speed > 0.1;
      const yaw = p.yaw;
      const dir = moving ? wrap(Math.atan2(p.vz, p.vx) - yaw) : null;
      let pose = p.pose;
      if (this.phase === 'presnap' || this.phase === 'playcall' || this.phase === 'between') pose = POSE.STANCE;
      if (p.down > 0 && this.phase !== 'presnap') pose = POSE.DOWN;
      const offset = travelYawOffset(o, { pose, speed, dir, dt });
      o.rotation.y = -(yaw + offset);
      const ctx = {
        role: p.role, partner: p.partner ? p.partner.i : -1, back: false,
        slot: p.slot, kind: this.play?.kind === 'pass' ? 'pass' : 'run',
        vx: p.vx * YD, vy: p.vz * YD, bodyYaw: yaw + offset,
      };
      if (p.partner) { ctx.px = p.partner.x; ctx.pz = p.partner.z; }
      const travel = dir === null ? null : Math.cos(dir - offset);
      animateRigged(o, pose, speed, dt, !!p.carrying, this.t, p.cues, travel, ctx);
    }
  }

  separate() {
    const P = this.players;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < P.length; i++) {
        for (let j = i + 1; j < P.length; j++) {
          const a = P[i], b = P[j];
          if (a.partner === b) continue;
          const min = a.down > 0 || b.down > 0 ? 0.75 : 0.62;
          let dx = b.x - a.x, dz = b.z - a.z;
          const d2 = dx * dx + dz * dz;
          if (d2 >= min * min) continue;
          const d = Math.sqrt(d2) || 1e-3;
          dx /= d; dz /= d;
          const push = (min - d) / 2;
          const wa = a === this.controlled ? 0.3 : 1, wb = b === this.controlled ? 0.3 : 1;
          a.x -= dx * push * wa; a.z -= dz * push * wa; b.x += dx * push * wb; b.z += dz * push * wb;
        }
      }
    }
  }

  updateCamera(dt) {
    const bs = this.ballState, cam = this.cam;
    const portrait = this.camera.aspect < 1;
    let fx = bs.x, fz = bs.z;
    let dist = 10.5, height = 6.2, ahead = 6;
    if (this.phase === 'presnap' || this.phase === 'playcall' || this.phase === 'between' || this.phase === 'title') {
      fx = this.drive.los; fz = this.drive.ballZ; dist = 13.5; height = 7.6; ahead = 8;
    } else if (this.play?.kind === 'pass' && !this.play.carrier) {
      dist = 14; height = 8.2; ahead = 9;
      if (bs.flight) { fx = bs.x; fz = bs.z; }
    }
    if (portrait) { dist *= 1.45; height *= 1.6; ahead *= 1.2; }
    const k = 1 - Math.exp(-dt * 4);
    cam.focus.x += (fx - cam.focus.x) * k;
    cam.focus.z += ((fz * 0.75 + (W / 2) * 0.25) - cam.focus.z) * k;
    cam.dist += (dist - cam.dist) * k;
    cam.height += (height - cam.height) * k;
    cam.ahead += (ahead - cam.ahead) * k;
    this.camera.position.set(cam.focus.x - cam.dist, cam.height, cam.focus.z);
    this.camera.lookAt(cam.focus.x + cam.ahead, 0, cam.focus.z);
  }

  project(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight, on: v.z < 1 };
  }

  // ----------------------------------------------------------------- sound
  sfx(name) { this.hud.sound?.(name); }
}
