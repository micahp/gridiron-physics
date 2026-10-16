// Rigid-body world: 22 players as massive discs on a frictional plane plus a
// 3D ball. Every player is driven by forces, never teleported.
//
// Locomotion follows the sprint force–velocity model (Samozino et al. 2016):
// the horizontal propulsive force a player can produce falls linearly with
// speed, F(v) = F0 (1 − v / v_max), which integrates to the mono-exponential
// velocity curve v(t) = v_max (1 − e^(−t/τ)) with τ = m v_max / F0. Turning
// and braking are traction-limited (|a| ≤ μ g) and agility-limited (lateral
// accel ≤ a_lat from the 3-cone/shuttle). Contacts are resolved with impulses
// that conserve momentum, so a 330-lb tackle really does move a 190-lb corner.
import { G, MU, BALL_R } from './constants.js';
import { flyStep, bounce } from './ball.js';

export const POSE = {
  STANCE: 0, RUN: 1, BLOCK: 2, DOWN: 3, THROW: 4, CATCH: 5, KICK: 6, HOLD: 7, CELEBRATE: 8, BACKPEDAL: 9,
  WRAP: 10, KNEEL: 11, SLIDE: 12,
};

export class Player {
  constructor(info, team, slot) {
    this.id = info.id;
    this.team = team;
    this.slot = slot;
    this.info = info;
    this.R = info.ratings;
    const ph = info.physics;
    this.m = ph.mass;
    this.r = ph.radius;
    this.vmax = ph.vmax;
    this.f0 = ph.f0;
    this.drive = ph.drive;
    this.alat = ph.alat;
    this.reach = ph.reach;
    this.p = { x: 0, y: 0 };
    this.v = { x: 0, y: 0 };
    this.h = 0; // body heading (rad)
    this.dv = { x: 0, y: 0 }; // desired velocity from the brain
    this.face = null; // optional facing override (rad)
    this.ext = { x: 0, y: 0 }; // external force accumulator (N)
    this.mode = 'stance';
    this.ai = {};
    this.engaged = null;
    this.shedCD = 0;
    this.down = false;
    this.downT = 0;
    this.pose = POSE.STANCE;
    this.poseT = 0;
    this.z = 0;
    this.stumble = 0;
    this.hasBall = false;
    this.speedCap = 1;
    this.topSpeed = 0;
    this.dist = 0;
    this.forceCap = 1; // director throttle on propulsive force (fatigue/effort)
    this.engageMul = 1; // block/shed skill multiplier on leg drive while engaged
  }

  get speed() {
    return Math.hypot(this.v.x, this.v.y);
  }

  /** Integrate one step of self-propelled motion under F–v and traction limits. */
  locomote(dt) {
    const { v } = this;
    if (this.down) {
      // sliding on the turf: kinetic friction decelerates the body
      const s = Math.hypot(v.x, v.y);
      const dec = Math.min(s, MU * G * 0.8 * dt);
      if (s > 1e-6) {
        v.x -= (v.x / s) * dec;
        v.y -= (v.y / s) * dec;
      }
      v.x += (this.ext.x / this.m) * dt;
      v.y += (this.ext.y / this.m) * dt;
      this.p.x += v.x * dt;
      this.p.y += v.y * dt;
      this.ext.x = this.ext.y = 0;
      return;
    }
    const speed = Math.hypot(v.x, v.y);
    // backpedalling is slow; ball in arm costs a little top speed
    const hv = { x: Math.cos(this.h), y: Math.sin(this.h) };
    const moveDir = speed > 0.3 ? { x: v.x / speed, y: v.y / speed } : null;
    let vcap = this.vmax * this.speedCap * (this.hasBall ? 0.97 : 1);
    if (moveDir && moveDir.x * hv.x + moveDir.y * hv.y < -0.3) vcap = Math.min(vcap, this.vmax * 0.62);
    if (this.stumble > 0) vcap *= 0.55;
    let dv = this.dv;
    const dl = Math.hypot(dv.x, dv.y);
    if (dl > vcap) dv = { x: (dv.x * vcap) / dl, y: (dv.y * vcap) / dl };

    // desired acceleration with a ~0.12 s neuromuscular response time
    let ax = (dv.x - v.x) / 0.12;
    let ay = (dv.y - v.y) / 0.12;
    let fProp;
    if (this.engaged) {
      // in a block: no sprinting — available force is leg drive (strength, traction)
      fProp = this.drive * this.engageMul;
    } else {
      fProp = this.f0 * this.forceCap;
    }
    if (speed > 0.3 && !this.engaged) {
      const ux = v.x / speed, uy = v.y / speed;
      let apar = ax * ux + ay * uy;
      let px = ax - apar * ux, py = ay - apar * uy;
      // propulsive limit along the direction of travel: F0 (1 - v/vmax)
      const aMax = (fProp / this.m) * Math.max(0, 1 - speed / Math.max(0.5, this.vmax));
      if (apar > aMax) apar = aMax;
      const brake = this.alat * 1.2;
      if (apar < -brake) apar = -brake;
      // lateral (cutting) limit, tighter at speed
      const latMax = this.alat * (speed > 6 ? 0.8 : 1);
      const pl = Math.hypot(px, py);
      if (pl > latMax) {
        px *= latMax / pl;
        py *= latMax / pl;
      }
      ax = apar * ux + px;
      ay = apar * uy + py;
    } else {
      const aMax = fProp / this.m;
      const al = Math.hypot(ax, ay);
      if (al > aMax) {
        ax *= aMax / al;
        ay *= aMax / al;
      }
    }
    // traction circle: cleats can't transmit more than μ m g
    const al = Math.hypot(ax, ay);
    const tr = MU * G;
    if (al > tr) {
      ax *= tr / al;
      ay *= tr / al;
    }
    v.x += (ax + this.ext.x / this.m) * dt;
    v.y += (ay + this.ext.y / this.m) * dt;
    this.ext.x = this.ext.y = 0;
    this.p.x += v.x * dt;
    this.p.y += v.y * dt;

    // heading turns toward facing target at a finite rate
    const s2 = Math.hypot(v.x, v.y);
    const want = this.face != null ? this.face : s2 > 0.4 ? Math.atan2(v.y, v.x) : this.h;
    let d = want - this.h;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    const turn = 9 * dt;
    this.h += Math.max(-turn, Math.min(turn, d));
    if (s2 > this.topSpeed) this.topSpeed = s2;
    this.dist += s2 * dt;
    if (this.stumble > 0) this.stumble -= dt;
    if (this.shedCD > 0) this.shedCD -= dt;
  }
}

export class World {
  constructor(rand) {
    this.rand = rand;
    this.players = [];
    this.t = 0;
    this.ball = { x: 0, y: 0, z: 0.15, vx: 0, vy: 0, vz: 0, state: 'held', holder: null, k: 0, spin: 0, tumble: false, rot: 0 };
    this.engagements = [];
    this.wraps = [];
    this.events = [];
    this.biggestHit = null;
  }

  add(p) {
    this.players.push(p);
    return p;
  }

  event(type, data = {}) {
    this.events.push({ t: this.t, type, ...data });
  }

  // ------------------------------------------------------------ blocks
  engage(blocker, defender) {
    if (blocker.engaged || defender.engaged || blocker.down || defender.down) return;
    if (defender.shedCD > 0 || blocker.shedCD > 0) return;
    blocker.engaged = defender;
    defender.engaged = blocker;
    this.engagements.push({ a: blocker, b: defender, t0: this.t });
  }

  disengage(e, shedder) {
    e.a.engaged = null;
    e.b.engaged = null;
    e.a.shedCD = 0.7;
    e.b.shedCD = 0.35;
    this.engagements = this.engagements.filter((x) => x !== e);
    if (shedder) {
      // swim/rip: a lateral burst past the blocker's shoulder
      const other = shedder === e.a ? e.b : e.a;
      const nx = shedder.p.x - other.p.x, ny = shedder.p.y - other.p.y;
      const l = Math.hypot(nx, ny) || 1;
      const side = this.rand() < 0.5 ? 1 : -1;
      shedder.v.x += (-ny / l) * side * 1.6 + shedder.dv.x * 0.15;
      shedder.v.y += (nx / l) * side * 1.6 + shedder.dv.y * 0.15;
      this.event('shed', { by: shedder.id, from: other.id });
    }
  }

  engagementForces() {
    for (const e of [...this.engagements]) {
      const { a, b } = e;
      const dx = b.p.x - a.p.x, dy = b.p.y - a.p.y;
      const d = Math.hypot(dx, dy) || 1e-3;
      const nx = dx / d, ny = dy / d;
      const rest = a.r + b.r + 0.08;
      // arms' length exceeded: the grip is lost
      if (d > rest + 0.7) {
        this.disengage(e);
        continue;
      }
      // hands-on spring-damper keeps the two chest to chest; a grip can
      // only hold so hard (~ the stronger man's leg drive)
      const rv = (b.v.x - a.v.x) * nx + (b.v.y - a.v.y) * ny;
      const fMax = Math.max(a.drive, b.drive);
      const f = Math.max(-fMax, Math.min(fMax, 5200 * (d - rest) + 700 * rv));
      a.ext.x += f * nx;
      a.ext.y += f * ny;
      b.ext.x -= f * nx;
      b.ext.y -= f * ny;
      // tangential grip: the pair tends to move together sideways
      const tvx = (b.v.x - a.v.x) - rv * nx, tvy = (b.v.y - a.v.y) - rv * ny;
      a.ext.x += 260 * tvx;
      a.ext.y += 260 * tvy;
      b.ext.x -= 260 * tvx;
      b.ext.y -= 260 * tvy;
    }
  }

  // ----------------------------------------------------------- tackles
  wrap(tackler, carrier, opts = {}) {
    if (this.wraps.some((w) => w.tackler === tackler)) return;
    if (tackler.engaged) this.disengage(this.engagements.find((e) => e.a === tackler || e.b === tackler));
    const w = { tackler, carrier, t0: this.t, fall: opts.fall ?? 0.45, target: opts.target || null, done: false };
    // perfectly inelastic hit at the moment of the wrap: shared momentum
    const M = tackler.m + carrier.m;
    const vx = (tackler.m * tackler.v.x + carrier.m * carrier.v.x) / M;
    const vy = (tackler.m * tackler.v.y + carrier.m * carrier.v.y) / M;
    const closing = Math.hypot(tackler.v.x - carrier.v.x, tackler.v.y - carrier.v.y);
    const dE = 0.5 * tackler.m * (tackler.v.x ** 2 + tackler.v.y ** 2) + 0.5 * carrier.m * (carrier.v.x ** 2 + carrier.v.y ** 2) - 0.5 * M * (vx * vx + vy * vy);
    const keep = opts.keepCarrier ?? 0.35; // a carrier keeps some of his own legs
    carrier.v.x = vx * (1 - keep) + carrier.v.x * keep;
    carrier.v.y = vy * (1 - keep) + carrier.v.y * keep;
    tackler.v.x = vx;
    tackler.v.y = vy;
    tackler.pose = POSE.WRAP;
    this.wraps.push(w);
    this.event('tackle', { by: tackler.id, on: carrier.id, closing, energy: dE });
    this.noteHit(tackler, carrier, closing, dE);
    return w;
  }

  noteHit(a, b, closing, energy) {
    if (!this.biggestHit || closing > this.biggestHit.closing) {
      this.biggestHit = { t: this.t, a: a.id, b: b.id, closing, energy, impulse: (closing * a.m * b.m) / (a.m + b.m) };
    }
  }

  wrapForces(dt) {
    for (const w of this.wraps) {
      const { tackler: t, carrier: c } = w;
      const dx = c.p.x - t.p.x, dy = c.p.y - t.p.y;
      const d = Math.hypot(dx, dy) || 1e-3;
      const rest = (t.r + c.r) * 0.75;
      const f = 7000 * (d - rest);
      t.ext.x += (f * dx) / d;
      t.ext.y += (f * dy) / d;
      c.ext.x -= (f * dx) / d;
      c.ext.y -= (f * dy) / d;
      // the tackler's weight hanging on the carrier: strong drag
      const drag = 0.6 * t.m * G * 0.5;
      const cs = c.speed;
      if (cs > 0.05) {
        c.ext.x -= (drag * c.v.x) / cs;
        c.ext.y -= (drag * c.v.y) / cs;
      }
    }
  }

  // --------------------------------------------------------- collisions
  collide() {
    const P = this.players;
    for (let i = 0; i < P.length; i++) {
      const a = P[i];
      if (a.down) continue;
      for (let j = i + 1; j < P.length; j++) {
        const b = P[j];
        if (b.down || a.engaged === b) continue;
        const dx = b.p.x - a.p.x, dy = b.p.y - a.p.y;
        const R = a.r + b.r;
        const d2 = dx * dx + dy * dy;
        if (d2 >= R * R) continue;
        const d = Math.sqrt(d2) || 1e-4;
        const nx = dx / d, ny = dy / d;
        const over = R - d;
        const im = 1 / a.m + 1 / b.m;
        // positional correction weighted by inverse mass
        a.p.x -= (nx * over * (1 / a.m)) / im;
        a.p.y -= (ny * over * (1 / a.m)) / im;
        b.p.x += (nx * over * (1 / b.m)) / im;
        b.p.y += (ny * over * (1 / b.m)) / im;
        const vn = (b.v.x - a.v.x) * nx + (b.v.y - a.v.y) * ny;
        if (vn < 0) {
          const e = 0.12; // padded bodies: very inelastic
          const jimp = (-(1 + e) * vn) / im;
          a.v.x -= (jimp * nx) / a.m;
          a.v.y -= (jimp * ny) / a.m;
          b.v.x += (jimp * nx) / b.m;
          b.v.y += (jimp * ny) / b.m;
          if (-vn > 2.5 && a.team !== b.team) {
            this.event('hit', { a: a.id, b: b.id, closing: -vn, impulse: jimp });
            this.noteHit(a, b, -vn, 0.5 * (vn * vn) / im);
            if (this.onContact) this.onContact(a, b, -vn);
          }
        }
        if (a.team !== b.team && this.onTouch) this.onTouch(a, b);
      }
    }
  }

  // ---------------------------------------------------------------- ball
  ballStep(dt) {
    const b = this.ball;
    if (b.state === 'held' && b.holder) {
      const h = b.holder;
      const hx = Math.cos(h.h), hy = Math.sin(h.h);
      const side = b.hand === 'chest' ? 0 : 0.18;
      b.x = h.p.x + hx * (h.r * 0.6) - hy * side;
      b.y = h.p.y + hy * (h.r * 0.6) + hx * side;
      b.z = h.down ? 0.25 : b.hand === 'up' ? 1.9 : 1.05;
      b.vx = h.v.x;
      b.vy = h.v.y;
      b.vz = 0;
      b.rot = h.h;
    } else if (b.state === 'snap' || b.state === 'air') {
      flyStep(b, dt, b.k);
      b.spin += (b.tumble ? 9 : 60) * dt;
      if (b.z <= 0.1 && b.vz < 0) {
        if (this.onBallGround) this.onBallGround(b);
        if (b.state === 'air') b.state = 'loose';
      }
    } else if (b.state === 'loose') {
      flyStep(b, dt, b.k);
      b.spin += 12 * dt;
      bounce(b, this.rand);
      if (b.z <= 0.11 && Math.hypot(b.vx, b.vy) < 0.3 && Math.abs(b.vz) < 0.2) {
        b.vx = b.vy = b.vz = 0;
      }
    }
  }

  step(dt, brains) {
    for (const p of this.players) brains(p);
    this.engagementForces();
    this.wrapForces(dt);
    for (const p of this.players) p.locomote(dt);
    this.collide();
    this.ballStep(dt);
    this.t += dt;
  }
}

export { BALL_R };
