// The play director: turns one ESPN play script into a physics simulation.
//
// The director decides *intent* (assignments, routes, where the ball is
// thrown, who is meant to make the tackle) from the real play-by-play. The
// world decides *motion* — every player is a force-limited body, every
// contact an impulse. Outcome constraints from the box score (catch point,
// end spot, tackler, sack spot) are enforced the way a coach would: by
// giving the right player the right job, and by only allowing the play to
// be whistled dead where the real one was.
import { YD, FIELD_W, FIELD_W_YD, DT, REC_HZ, CROSSBAR, GOAL_W } from './constants.js';
import { rng } from './rng.js';
import { World, Player, POSE } from './world.js';
import { solveLaunch, AERO, dragK } from './ball.js';

const PRE = 0.9; // seconds of pre-snap stance recorded
const POST = 1.4; // seconds recorded after the whistle
const MAX_T = 16;

const sgn = (x) => (x < 0 ? -1 : 1);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const d2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const unit = (x, y) => {
  const l = Math.hypot(x, y);
  return l > 1e-9 ? { x: x / l, y: y / l } : { x: 0, y: 0 };
};
const skill = (r) => 0.75 + (0.5 * ((r ?? 60) - 50)) / 50; // 50 -> 0.75, 99 -> 1.24

export function simulatePlay(game, S, ctx = {}) {
  const rand = rng(S.id);
  const W = new World(rand);
  const dir = S.dir;
  const losYd = S.los;
  const byYd = clamp(ctx.ballY ?? FIELD_W_YD / 2, 1, FIELD_W_YD - 1);
  const off = S.off, def = S.def;
  const P = game.players;

  // field frame helpers: f = yards downfield (offense's view), l = yards to offense's left
  const at = (f, l) => ({ x: (losYd + dir * f) * YD, y: (byYd + dir * l) * YD });
  const absYd = (xYd, yYd) => ({ x: xYd * YD, y: yYd * YD });
  const lOfY = (yYd) => (yYd - byYd) * dir;
  const fwd = { x: dir, y: 0 };
  const fOf = (pt) => (pt.x / YD - losYd) * dir;

  const byId = new Map();
  function spawn(pid, team, slot, pos, mode = 'stance') {
    if (!pid || !P[pid] || byId.has(pid)) return null;
    const pl = W.add(new Player(P[pid], team, slot));
    pl.p = { ...pos };
    pl.h = team === off ? (dir > 0 ? 0 : Math.PI) : dir > 0 ? Math.PI : 0;
    pl.mode = mode;
    byId.set(pid, pl);
    return pl;
  }
  const pl = (pid) => (pid ? byId.get(pid) : null);
  const offense = () => W.players.filter((p) => p.team === off);
  const defense = () => W.players.filter((p) => p.team === def);

  // ------------------------------------------------------------ state
  const st = {
    phase: 'pre', dead: false, deadT: null, carrier: null, endX: null, endY: null,
    tacklers: new Set(), tTackle: null, waitT: 0, result: null, qb: null, target: null,
    catchPt: null, tCatch: null, tThrow: null, resolved: false, flagT: null,
    tdLine: dir > 0 ? 100 : 0, kickAt: null, fieldGoal: null, whistle: null,
  };
  const ev = (type, data) => W.event(type, data);

  // ------------------------------------------------------- formations
  function offenseAlign(L, shotgun, heavy) {
    const pos = {};
    const leftRoom = dir > 0 ? FIELD_W_YD - byYd : byYd; // yards to offense's left sideline
    const rightRoom = FIELD_W_YD - leftRoom;
    pos.C = [-0.5, 0];
    pos.LG = [-0.7, 1.45];
    pos.RG = [-0.7, -1.45];
    pos.LT = [-0.85, 2.9];
    pos.RT = [-0.85, -2.9];
    const strong = rightRoom >= leftRoom ? -1 : 1; // TE to the field side
    pos.TE = [-0.9, 4.35 * strong];
    // Keep the under-center QB clear of the center's collision radius so he
    // can take the snap and move into the handoff lane without getting pinned.
    pos.QB = shotgun ? [-5, 0] : [-1.6, 0];
    pos.RB = shotgun ? [-5.2, -1.5 * strong] : [-7, 0];
    pos.WR1 = [-0.8, leftRoom - clamp(leftRoom * 0.35, 5, 12)];
    pos.WR2 = [-0.8, -(rightRoom - clamp(rightRoom * 0.35, 5, 12))];
    if (heavy) pos.WR3 = [-0.9, -4.35 * strong];
    else {
      const wide = strong > 0 ? pos.WR1[1] : pos.WR2[1];
      pos.WR3 = [-1.2, (wide + 4.4 * strong) / 2];
    }
    const out = {};
    for (const [slot, pid] of Object.entries(L)) {
      const [f, l] = pos[slot] || [-3, 0];
      out[slot] = { pid, f, l };
    }
    return out;
  }

  function defenseAlign(L, OA, goalLine) {
    const ytg = dir > 0 ? 100 - losYd : losYd;
    const deep = (f) => Math.min(f, Math.max(1.5, ytg + 1));
    const oL = (slot, dflt) => (OA[slot] ? OA[slot].l : dflt);
    const pos = {
      LEDGE: [1.2, 4.7], LDT: [1.1, 1.5], RDT: [1.1, -1.5], REDGE: [1.2, -4.7],
      MLB: [deep(4.6), 1.8], WLB: [deep(4.6), -2.3],
      LCB: [deep(6), oL('WR1', 12)], RCB: [deep(6), oL('WR2', -12)],
      NB: goalLine ? [1.1, 0] : [deep(4.5), oL('WR3', -6)],
      SS: [deep(11), -6], FS: [deep(13.5), 4],
    };
    const out = {};
    for (const [slot, pid] of Object.entries(L)) {
      const [f, l] = pos[slot] || [5, 0];
      out[slot] = { pid, f, l };
    }
    return out;
  }

  // ----------------------------------------------------------- steering
  function seek(p, tgt, frac = 1, decel = 5) {
    const dx = tgt.x - p.p.x, dy = tgt.y - p.p.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.05) return { x: 0, y: 0 };
    const s = Math.min(p.vmax * frac, Math.sqrt(2 * decel * d));
    return { x: (dx / d) * s, y: (dy / d) * s };
  }
  function arrive(p, tgt, tArr) {
    const dx = tgt.x - p.p.x, dy = tgt.y - p.p.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.05) return { x: 0, y: 0 };
    const rem = tArr - W.t;
    const s = rem <= 0.05 ? p.vmax : Math.min(p.vmax, d / rem + 0.4);
    return { x: (dx / d) * s, y: (dy / d) * s };
  }
  function lead(p, q, k = 0.9) {
    let t = d2(p.p, q.p) / (p.vmax * k);
    let pt = q.p;
    for (let i = 0; i < 3; i++) {
      pt = { x: q.p.x + q.v.x * t, y: q.p.y + q.v.y * t };
      t = Math.min(2.5, d2(p.p, pt) / (p.vmax * k));
    }
    return pt;
  }
  function separate(p, dv, radius = 1.3) {
    let sx = 0, sy = 0;
    for (const q of W.players) {
      if (q === p || q.team !== p.team || q.down) continue;
      const dx = p.p.x - q.p.x, dy = p.p.y - q.p.y;
      const d = Math.hypot(dx, dy);
      if (d < radius && d > 1e-3) {
        sx += (dx / d) * (radius - d) * 2.2;
        sy += (dy / d) * (radius - d) * 2.2;
      }
    }
    return { x: dv.x + sx, y: dv.y + sy };
  }
  const faceDownfield = (p) => (p.team === off ? (dir > 0 ? 0 : Math.PI) : dir > 0 ? Math.PI : 0);
  const faceTo = (p, q) => Math.atan2(q.y - p.p.y, q.x - p.p.x);
  const ballPt = () => ({ x: W.ball.x, y: W.ball.y });

  // ------------------------------------------------------ route paths
  // A path is a list of absolute points; follow() walks it with an optional
  // arrival schedule so the target receiver is at the catch point on time.
  function pathLen(pts) {
    let s = 0;
    for (let i = 1; i < pts.length; i++) s += d2(pts[i - 1], pts[i]);
    return s;
  }
  function follow(p, frac = 1) {
    const a = p.ai;
    while (a.wp < a.path.length - 1 && d2(p.p, a.path[a.wp]) < 0.9) a.wp++;
    const tgt = a.path[a.wp];
    if (a.arriveT != null && !a.arrived) {
      // speed governor: remaining length / remaining time
      let rem = d2(p.p, tgt);
      for (let i = a.wp + 1; i <= a.path.length - 1 - (a.extra || 0); i++) rem += d2(a.path[i - 1], a.path[i]);
      const tl = a.arriveT - W.t;
      const s = tl <= 0.05 ? p.vmax : clamp(rem / tl, 0.5, p.vmax);
      const u = unit(tgt.x - p.p.x, tgt.y - p.p.y);
      if (d2(p.p, a.catchPt || tgt) < 0.6) a.arrived = true;
      return { x: u.x * s, y: u.y * s };
    }
    if (a.wp === a.path.length - 1 && d2(p.p, tgt) < 0.9) return { x: p.v.x * 0.9, y: p.v.y * 0.9 };
    return seek(p, tgt, frac, 7);
  }

  function routeFor(slot, f0, l0, kind) {
    const out = sgn(l0 || 1); // toward own sideline
    const R = {
      go: [[12, 0], [35, out * 1]],
      curl: [[11, 0], [9.5, -out * 1]],
      out: [[10, 0], [10.5, out * 7]],
      dig: [[12, 0], [12, -out * 12]],
      slant: [[2.5, 0], [8, -out * 6]],
      flat: [[1, out * 3], [2, out * 9]],
      post: [[11, 0], [26, -out * 10]],
      seam: [[10, 0], [28, -out * 1]],
      check: [[0.5, out * 2.5], [3, out * 5]],
    }[kind];
    return R.map(([df, dl]) => at(f0 + df, l0 + dl));
  }

  // -------------------------------------------------------- scenario
  const kind = S.kind;
  let OA = null, DA = null;
  const lineup = S.lineup || {};
  const heavy = /Run formation|Jumbo/.test(S.text) || (dir > 0 ? 100 - losYd : losYd) <= 3;

  function setupScrimmage() {
    OA = offenseAlign(lineup[off] || {}, S.shotgun || kind === 'scramble' && S.shotgun, heavy);
    DA = defenseAlign(lineup[def] || {}, OA, (dir > 0 ? 100 - losYd : losYd) <= 3);
    for (const [slot, a] of Object.entries(OA)) spawn(a.pid, off, slot, at(a.f, a.l));
    for (const [slot, a] of Object.entries(DA)) spawn(a.pid, def, slot, at(a.f, a.l));
    const C = pl(OA.C?.pid);
    W.ball = { ...W.ball, x: at(0, 0).x, y: at(0, 0).y, z: 0.15, state: 'held', holder: null, hand: 'chest' };
    st.center = C;
    st.qb = pl(OA.QB?.pid);
    for (const p of W.players) {
      p.ai.home = { ...p.p };
      const isOL = ['LT', 'LG', 'C', 'RG', 'RT'].includes(p.slot);
      p.pose = isOL || ['LEDGE', 'LDT', 'RDT', 'REDGE'].includes(p.slot) || (p.slot === 'NB' && heavy) ? POSE.STANCE : POSE.RUN;
    }
  }

  const slotOf = (side, slot) => pl(((side === off ? OA : DA) || {})[slot]?.pid);
  const OL = ['LT', 'LG', 'C', 'RG', 'RT'];
  const FRONT = ['LEDGE', 'LDT', 'RDT', 'REDGE'];

  function setBlockMuls() {
    for (const p of W.players) {
      if (p.team === off) p.engageMul = skill(S.kindGroup === 'pass' ? p.R.PBK : p.R.RBK) * (0.8 + 0.2 * p.R.STR / 80);
      else p.engageMul = skill(S.kindGroup === 'pass' ? Math.max(p.R.PMV, p.R.FMV) : p.R.BSH) * (0.8 + 0.2 * p.R.STR / 80);
    }
  }

  // Assign each blocker to a defender: nearest unclaimed front player in his
  // zone. Designated tacklers/sackers are left for the director to free.
  function assignBlocks(blockers, defenders, skip) {
    const claimed = new Set();
    for (const b of blockers) {
      if (!b) continue;
      let best = null, bd = 1e9;
      for (const d of defenders) {
        if (!d || claimed.has(d) || skip.has(d)) continue;
        const dd = d2(b.p, d.p) + Math.abs(fOf(d.p)) * 0.4;
        if (dd < bd) { bd = dd; best = d; }
      }
      b.ai.blockOn = best;
      if (best) claimed.add(best);
    }
  }

  // --------------------------------------------- carrier & tackling
  const TO_PURSUE = new Set(['stance', 'cover_man', 'zone', 'rush', 'runfit', 'read', 'kick_cover', 'hold_kick', 'gunner', 'jam', 'punt_rush', 'punt_protect', 'idle', 'route', 'route_target', 'pass_pro', 'run_block', 'escort']);
  const TO_ESCORT = new Set(['route', 'route_target', 'cover_man', 'zone', 'rush', 'read', 'runfit', 'pursue', 'pass_pro', 'tackle_to']);
  function makeCarrier(p, endX, endY, opts = {}) {
    for (const q of W.players) if (q !== p) q.hasBall = false;
    p.hasBall = true;
    W.ball.state = 'held';
    W.ball.holder = p;
    W.ball.hand = 'carry';
    st.carrier = p;
    st.endX = endX;
    st.endY = endY;
    p.mode = 'carry';
    p.ai.path = opts.path || [{ x: endX * YD, y: endY * YD }];
    if (opts.oob) {
      const keep = (opts.path || []).slice(0, -1).filter((q) => Math.abs(q.x / YD - endX) > 2);
      p.ai.path = [...keep, ...oobPath(p, endX, endY)];
    }
    p.ai.wp = 0;
    p.ai.oob = !!opts.oob;
    p.ai.td = !!opts.td;
    st.carrierSince = W.t;
    p.ai.startX = p.p.x / YD;
    st.tacklerTeam = p.team === off ? def : off;
    if (opts.keepModes) return;
    for (const q of W.players) {
      if (q === p) continue;
      if (q.team === st.tacklerTeam) {
        if (st.tacklers.has(q.id)) q.mode = 'tackle_to';
        else if (TO_PURSUE.has(q.mode)) q.mode = 'pursue';
      } else if (TO_ESCORT.has(q.mode)) q.mode = 'escort';
      else if (['pocket', 'qb_drop', 'handoff'].includes(q.mode)) q.mode = 'fake';
    }
    if (st.qb && st.qb !== p && st.qb.mode === 'fake' && !st.qb.ai.fakeTo) st.qb.ai.fakeTo = { x: st.qb.p.x + dir * 3 * YD, y: st.qb.p.y };
  }

  // out-of-bounds finish: get to the yard line inside the sideline, then step out
  function oobPath(c, endX, endY) {
    const inside = endY > FIELD_W_YD / 2 ? FIELD_W_YD - 0.6 : 0.6;
    const outside = endY > FIELD_W_YD / 2 ? FIELD_W_YD + 2 : -2;
    const gap = endX - c.p.x / YD;
    if (Math.abs(gap) < 2) return [absYd(endX + gap * 0.3, outside)];
    const mv = sgn(gap);
    return [absYd(endX - mv * 1.2, inside), absYd(endX + mv * 0.3, outside)];
  }

  function remainingYd(p) {
    return ((st.endX - p.p.x / YD) * dir * (p.team === off ? 1 : -1));
  }

  function tryTackle(a, b) {
    if (st.dead || st.tTackle != null) return;
    const c = st.carrier;
    if (!c || (a !== c && b !== c)) return;
    const d = a === c ? b : a;
    if (d.team === c.team || d.down || d.ai.missUntil > W.t) return;
    if (c.ai.oob || c.ai.td) {
      // the real play ended out of bounds / in the end zone: contacts are
      // shoves and grabs, not tackles
      if (!c.ai.shoved) {
        c.ai.shoved = true;
        ev('contact', { by: d.id, on: c.id });
      }
      return;
    }
    const along = Math.abs((st.endX - c.p.x / YD));
    const designated = st.tacklers.has(d.id);
    const lim = designated ? 2.6 : 1.1;
    const waited = st.waitT > 1.4;
    if (along <= lim || waited) {
      startTackle(d, c);
    } else {
      // broken tackle: both stumble; the defender loses his feet
      const tk = d.R.TAK ?? 50, bt = Math.max(c.R.BTK ?? 50, c.R.ELU ?? 50);
      c.stumble = 0.18 + 0.1 * rand();
      d.stumble = 0.6;
      d.ai.missUntil = W.t + 1.6;
      if (rand() < 0.55 + (bt - tk) / 200) {
        d.down = true;
        d.pose = POSE.DOWN;
        d.downT = W.t;
      }
      ev('broken_tackle', { by: c.id, on: d.id });
    }
  }

  function startTackle(d, c) {
    st.tTackle = W.t;
    const w = W.wrap(d, c, { fall: 0.5 });
    st.wrap = w;
    st.tackler = d;
    c.pose = POSE.WRAP;
    ev('wrapped', { by: d.id, on: c.id });
  }

  function updateTackle() {
    if (st.tTackle == null || st.dead) return;
    const c = st.carrier;
    const fall = 0.55;
    const el = W.t - st.tTackle;
    // forward progress: the pile falls toward where the real play was spotted
    const tx = st.endX * YD;
    const rem = fall - el;
    if (rem > 0) {
      const k = Math.min(1, DT / rem);
      const dx = (tx - c.p.x) * k;
      for (const q of [c, st.tackler]) q.p.x += dx;
    }
    if (el >= fall) {
      c.p.x = tx;
      for (const q of [c, st.tackler]) {
        q.down = true;
        q.pose = POSE.DOWN;
        q.downT = W.t;
        q.v.x *= 0.3;
        q.v.y *= 0.3;
      }
      // second tackler piles on
      for (const id of st.tacklers) {
        const q = pl(id);
        if (q && q !== st.tackler && d2(q.p, c.p) < 2.5 && !q.down) {
          q.down = true;
          q.pose = POSE.DOWN;
          q.downT = W.t;
        }
      }
      whistle('tackle', { by: st.tackler.id });
    }
  }

  function whistle(reason, data = {}) {
    if (st.dead) return;
    st.dead = true;
    st.deadT = W.t;
    st.whistle = reason;
    // the spot: where the ball was when the play died (for out of bounds,
    // the last point it was still in bounds)
    const b = W.ball;
    const src = reason.includes('out_of_bounds') && st.lastIn ? st.lastIn : { x: b.x, y: b.y };
    st.spot = { x: src.x / YD, y: Math.max(0, Math.min(FIELD_W_YD, src.y / YD)) };
    ev('whistle', { reason, spot: st.spot, ...data });
    W.wraps = [];
    for (const e of [...W.engagements]) W.disengage(e);
    for (const p of W.players) {
      p.ai.postMode = p.mode;
      p.mode = 'post';
    }
  }

  // carrier brain: path following with defender avoidance (ELU/AGI)
  function carryBrain(p) {
    const a = p.ai;
    if (st.tTackle != null) return { x: p.v.x, y: p.v.y };
    while (a.wp < a.path.length - 1 && (d2(p.p, a.path[a.wp]) < 1.2 || (a.path[a.wp].x - p.p.x) * dir * (p.team === off ? 1 : -1) < -0.5)) a.wp++;
    const tgt = a.path[a.wp];
    let dv = seek(p, tgt, 1, 2.5);
    const atEnd = a.wp === a.path.length - 1;
    const remYd = Math.abs(st.endX - p.p.x / YD);
    if (atEnd && !a.oob && !a.td) {
      // near the spot: the play is about to end — wait for the tackle
      if (remYd < 1.5) {
        st.waitT += DT;
        dv = { x: dv.x * 0.25, y: dv.y * 0.25 };
        // tacklers converge
        if (st.waitT > 1.4) {
          let best = null, bd = 1e9;
          for (const q of W.players) {
            if (q.team === p.team || q.down) continue;
            const dd = d2(q.p, p.p);
            if (dd < bd) { bd = dd; best = q; }
          }
          if (best) best.mode = 'tackle_to';
        }
      }
    }
    if (a.oob || a.td) dv = seek(p, tgt, 1, 50);
    // evade: lateral push away from defenders in front
    const fdir = unit(dv.x, dv.y);
    let ex = 0, ey = 0;
    const elu = skill(Math.max(p.R.ELU ?? 50, p.R.AGI ?? 50));
    for (const q of W.players) {
      if (q === p || q.down || st.tacklers.has(q.id)) continue;
      const mate = q.team === p.team;
      const rx = q.p.x - p.p.x, ry = q.p.y - p.p.y;
      const d = Math.hypot(rx, ry);
      if (d > (mate ? 2.2 : 4.5) || d < 0.1) continue;
      const ahead = (rx * fdir.x + ry * fdir.y) / d;
      if (ahead < 0.1) continue;
      const side = rx * -fdir.y + ry * fdir.x; // + => defender on left
      const push = mate ? ((2.2 - d) / 2.2) * ahead * 1.6 : ((4.5 - d) / 4.5) * ahead * 2.4 * elu;
      ex += fdir.y * push * sgn(side);
      ey += -fdir.x * push * sgn(side);
    }
    if (remYd > 2 && !a.oob) dv = { x: dv.x + ex, y: dv.y + ey };
    p.face = null;
    return dv;
  }

  // --------------------------------------------------- scrimmage brains
  function brain(p) {
    p.face = null;
    const t = W.t;
    switch (p.mode) {
      case 'stance':
        p.dv = { x: 0, y: 0 };
        p.face = faceDownfield(p);
        return;
      case 'post': {
        // after the whistle: decelerate, drift toward the ball, stand up
        if (p.down && t - p.downT > 1.1 && p !== st.carrier) {
          p.down = false;
          p.pose = POSE.RUN;
        }
        const bp = ballPt();
        const d = d2(p.p, bp);
        const tgt = d > 8 ? { x: p.p.x + (bp.x - p.p.x) * 0.2, y: p.p.y + (bp.y - p.p.y) * 0.2 } : p.p;
        const want = seek(p, tgt, 0.25);
        p.dv = { x: p.v.x * 0.9 + want.x * 0.1, y: p.v.y * 0.9 + want.y * 0.1 };
        if (p.ai.celebrate) p.pose = POSE.CELEBRATE;
        return;
      }
      case 'carry':
        p.dv = carryBrain(p);
        return;
      case 'qb_drop': {
        const a = p.ai;
        const tgt = a.dropPt;
        p.dv = seek(p, tgt, 0.75, 6);
        p.face = faceDownfield(p) + (a.look || 0);
        if (d2(p.p, tgt) < 0.4) p.mode = 'pocket';
        return;
      }
      case 'pocket': {
        const a = p.ai;
        let tgt = a.pocketPt || a.dropPt;
        // step up / slide away from the nearest free rusher
        let near = null, nd = 1e9;
        for (const q of defense()) {
          if (q.engaged || q.down) continue;
          const dd = d2(q.p, p.p);
          if (dd < nd) { nd = dd; near = q; }
        }
        if (near && nd < 3.5 && a.escape !== false) {
          const u = unit(p.p.x - near.p.x, p.p.y - near.p.y);
          tgt = { x: p.p.x + u.x * 2, y: p.p.y + u.y * 2 };
        }
        p.dv = seek(p, tgt, 0.5, 6);
        p.face = st.target ? faceTo(p, st.target.p) : faceDownfield(p);
        return;
      }
      case 'qb_scramble_to': {
        p.dv = seek(p, p.ai.to, 0.9);
        p.face = faceDownfield(p);
        return;
      }
      case 'handoff': {
        const a = p.ai;
        p.dv = seek(p, a.mesh, 0.7, 6);
        p.face = faceTo(p, a.mesh);
        return;
      }
      case 'fake': {
        p.dv = seek(p, p.ai.fakeTo, 0.55);
        return;
      }
      case 'to_mesh': {
        const a = p.ai;
        p.dv = seek(p, a.mesh, 0.85, 8);
        if (st.qb && d2(p.p, st.qb.p) < 1.1 && t > 0.25 && W.ball.holder === st.qb) {
          makeCarrier(p, st.endX, st.endY, { path: a.runPath, oob: S.oob, td: S.td });
          ev('handoff', { from: st.qb.id, to: p.id });
          st.qb.mode = 'fake';
          st.qb.ai.fakeTo = at(-6, -sgn(st.gapL || 1) * 4);
        }
        return;
      }
      case 'route': {
        p.dv = follow(p);
        if (W.ball.state === 'air' && st.catchPt && p !== st.target) p.face = faceTo(p, ballPt());
        return;
      }
      case 'route_target': {
        p.dv = follow(p);
        if (W.ball.state === 'air') {
          p.face = faceTo(p, ballPt());
          if (st.tCatch - t < 0.35) p.pose = POSE.CATCH;
        }
        return;
      }
      case 'pass_pro': {
        const a = p.ai;
        const qb = st.qb;
        const d = a.blockOn;
        if (!qb || !d || d.down) {
          p.dv = seek(p, a.setPt, 0.6);
          p.face = faceDownfield(p);
          // pick up anyone free nearby
          for (const q of defense()) {
            if (!q.engaged && !q.down && q.mode === 'rush' && d2(q.p, p.p) < 2.2) a.blockOn = q;
          }
          return;
        }
        if (p.engaged === d) {
          // mirror: stay between rusher and QB, drive back toward him
          const u = unit(d.p.x - qb.p.x, d.p.y - qb.p.y);
          const want = { x: d.p.x - u.x * (p.r + d.r + 0.1), y: d.p.y - u.y * (p.r + d.r + 0.1) };
          p.dv = { x: (want.x - p.p.x) * 3 + u.x * 1.5, y: (want.y - p.p.y) * 3 + u.y * 1.5 };
          p.face = faceTo(p, d.p);
          p.pose = POSE.BLOCK;
          return;
        }
        // kick-slide to a set point on the rusher's path
        const u = unit(d.p.x - qb.p.x, d.p.y - qb.p.y);
        const between = { x: qb.p.x + u.x * Math.min(d2(qb.p, d.p) * 0.55, 4.5), y: qb.p.y + u.y * Math.min(d2(qb.p, d.p) * 0.55, 4.5) };
        p.dv = seek(p, between, 0.7, 8);
        p.face = faceTo(p, d.p);
        if (d2(p.p, d.p) < p.r + d.r + 0.3 && !p.engaged && !d.engaged) W.engage(p, d);
        return;
      }
      case 'run_block': {
        const a = p.ai;
        const d = a.blockOn;
        if (!d || d.down || (d.engaged && d.engaged !== p)) {
          // climb to the second level and find work
          const nxt = W.players.filter((q) => q.team !== p.team).filter((q) => !q.engaged && !q.down && !st.tacklers.has(q.id) && fOf(q.p) > fOf(p.p) - 1)
            .sort((x, y) => d2(x.p, p.p) - d2(y.p, p.p))[0];
          if (nxt && d2(nxt.p, p.p) < 7 && t > 0.4) a.blockOn = nxt;
          p.dv = seek(p, at(fOf(p.p) + 3, lOfY(p.p.y / YD)), 0.55);
          return;
        }
        if (p.engaged === d) {
          // drive the defender away from the hole
          const away = sgn(lOfY(d.p.y / YD) - (st.gapL ?? 0)) || 1;
          const push = unit(dir, dir * away * 0.7);
          p.dv = { x: push.x * 2.2, y: push.y * 2.2 };
          p.face = faceTo(p, d.p);
          p.pose = POSE.BLOCK;
          return;
        }
        p.dv = seek(p, lead(p, d, 0.8), 0.85, 10);
        if (d2(p.p, d.p) < p.r + d.r + 0.3 && !p.engaged && !d.engaged) W.engage(p, d);
        return;
      }
      case 'lead_block': {
        const a = p.ai;
        if (!a.blockOn || a.blockOn.down) {
          p.dv = seek(p, a.leadPt, 0.8);
          if (t > 0.5) {
            const n = defense().filter((q) => !q.engaged && !q.down && !st.tacklers.has(q.id)).sort((x, y) => d2(x.p, p.p) - d2(y.p, p.p))[0];
            if (n && d2(n.p, p.p) < 5) a.blockOn = n;
          }
          return;
        }
        p.mode = 'run_block';
        return;
      }
      case 'rush': {
        const qb = st.qb;
        const tgt = st.carrier && st.carrier !== qb ? lead(p, st.carrier) : qb ? qb.p : at(-7, 0);
        if (p.engaged) {
          const u = unit(tgt.x - p.p.x, tgt.y - p.p.y);
          // rip/swim: finesse rushers work laterally around the blocker
          const fin = (p.R.FMV ?? 50) > (p.R.PMV ?? 50) ? 0.9 : 0.35;
          const side = p.ai.ripSide || (p.ai.ripSide = rand() < 0.5 ? 1 : -1);
          p.dv = { x: (u.x - u.y * side * fin) * 2.2, y: (u.y + u.x * side * fin) * 2.2 };
          p.face = Math.atan2(u.y, u.x);
          p.pose = POSE.BLOCK;
          maybeShed(p);
          return;
        }
        // edge rushers arc around the tackle; interior go straight
        let aim = tgt;
        if (['LEDGE', 'REDGE'].includes(p.slot) && fOf(p.p) > fOf(tgt) + 2.5) {
          const l = lOfY(p.p.y / YD);
          aim = at(Math.max(fOf(tgt), fOf(p.p) - 2.5), l + sgn(l) * 0.7);
        }
        p.dv = separate(p, seek(p, aim, 1, 20), 0.9);
        return;
      }
      case 'runfit': {
        if (p.engaged) {
          const c = st.carrier || st.qb;
          const u = c ? unit(c.p.x - p.p.x, c.p.y - p.p.y) : unit(-dir, 0);
          p.dv = { x: u.x * 2.0, y: u.y * 2.0 };
          p.face = Math.atan2(u.y, u.x);
          p.pose = POSE.BLOCK;
          maybeShed(p);
          return;
        }
        if (st.carrier && t > 0.35) {
          p.dv = separate(p, seek(p, lead(p, st.carrier), 0.95, 20), 0.8);
          return;
        }
        p.dv = seek(p, p.ai.gapPt, 0.7, 10);
        return;
      }
      case 'read': {
        // second level: read for ~0.4 s, then flow to the ball
        if (t < 0.45) {
          p.dv = seek(p, { x: p.p.x - dir * 0.6, y: p.p.y }, 0.3);
          p.face = faceDownfield(p);
          return;
        }
        if (p.engaged) {
          const c = st.carrier;
          const u = c ? unit(c.p.x - p.p.x, c.p.y - p.p.y) : unit(-dir, 0);
          p.dv = { x: u.x * 1.8, y: u.y * 1.8 };
          p.pose = POSE.BLOCK;
          maybeShed(p);
          return;
        }
        const c = st.carrier;
        p.dv = c ? separate(p, seek(p, lead(p, c), 0.95, 20), 0.9) : seek(p, at(2, st.gapL ?? 0), 0.7);
        return;
      }
      case 'pursue': {
        if (p.engaged) {
          maybeShed(p, 2);
          const c = st.carrier;
          if (c) {
            const u = unit(c.p.x - p.p.x, c.p.y - p.p.y);
            p.dv = { x: u.x * 1.8, y: u.y * 1.8 };
          }
          return;
        }
        const c = st.carrier;
        if (!c) {
          p.dv = st.catchPt ? seek(p, st.catchPt, 0.95) : { x: 0, y: 0 };
          return;
        }
        // Defenders track the carrier, not the preselected endpoint. The end
        // spot still gates the whistle and final pile when contact occurs.
        const tgt = c.p;
        p.dv = separate(p, seek(p, tgt, p.ai.missUntil > t ? 0.6 : 0.97, 25), 0.8);
        return;
      }
      case 'tackle_to': {
        const c = st.carrier;
        if (p.engaged) {
          const e = W.engagements.find((x) => x.a === p || x.b === p);
          if (e) W.disengage(e, p);
        }
        if (!c) return;
        // Keep pressure on the live carrier; tryTackle still gates the
        // whistle at the sampled spot to preserve the recorded gain.
        p.dv = seek(p, c.p, 1, 30);
        return;
      }
      case 'cover_man': {
        const a = p.ai;
        const r = a.man;
        if (!r) { p.mode = 'zone'; return; }
        if (W.ball.state === 'air' && st.catchPt && t > st.tThrow + 0.25) {
          // break on the throw
          const goal = a.ballHawk ? st.catchPt : { x: st.catchPt.x + (p.p.x - st.catchPt.x) * 0.3, y: st.catchPt.y + (p.p.y - st.catchPt.y) * 0.3 };
          p.dv = a.ballHawk ? arrive(p, goal, st.tCatch + (a.late ?? 0)) : seek(p, goal, 0.95);
          p.face = faceTo(p, ballPt());
          return;
        }
        // trail with cushion, inside leverage
        const cushion = Math.max(a.tight ? 0.6 : 1.2, (a.cushion ?? 6) * YD - t * 2.2);
        const inside = -sgn(lOfY(r.p.y / YD)) * (a.tight ? 0.5 : 0.9);
        const goal = { x: r.p.x + dir * cushion * 1.0 + r.v.x * 0.25, y: r.p.y + dir * inside + r.v.y * 0.25 };
        p.dv = seek(p, goal, 1, 12);
        p.face = t < 0.8 ? faceDownfield(p) : null;
        if (t < 0.9) p.pose = POSE.BACKPEDAL;
        else p.pose = POSE.RUN;
        return;
      }
      case 'zone': {
        const a = p.ai;
        if (W.ball.state === 'air' && st.catchPt && t > st.tThrow + 0.35) {
          p.dv = a.ballHawk ? arrive(p, st.catchPt, st.tCatch + (a.late ?? 0)) : seek(p, st.catchPt, 0.9);
          p.face = faceTo(p, ballPt());
          return;
        }
        p.dv = seek(p, a.zonePt || at(12, 0), 0.8, 6);
        p.face = st.qb ? faceTo(p, st.qb.p) : faceDownfield(p);
        return;
      }
      case 'idle':
        p.dv = seek(p, p.p, 0);
        return;
      case 'escort': {
        // convoy for the ball carrier: pick off the nearest threat
        const c = st.carrier;
        if (!c) { p.dv = { x: 0, y: 0 }; return; }
        if (p.engaged) {
          const d = p.engaged;
          const u = unit(d.p.x - c.p.x, d.p.y - c.p.y);
          p.dv = { x: u.x * 2, y: u.y * 2 };
          p.face = faceTo(p, d.p);
          p.pose = POSE.BLOCK;
          return;
        }
        const a = p.ai;
        if (!a.escortOn || a.escortOn.down || a.escortOn.engaged) {
          a.escortOn = W.players.filter((q) => q.team !== p.team && !q.engaged && !q.down && !st.tacklers.has(q.id) && d2(q.p, c.p) < 12)
            .sort((x, y) => d2(x.p, p.p) - d2(y.p, p.p))[0] || null;
        }
        const d = a.escortOn;
        if (d && d2(d.p, p.p) < 9) {
          p.dv = seek(p, lead(p, d, 0.85), 0.9, 12);
          if (d2(p.p, d.p) < p.r + d.r + 0.3) W.engage(p, d);
        } else {
          const ahead = { x: c.p.x + c.v.x * 0.8, y: c.p.y + c.v.y * 0.8 };
          p.dv = separate(p, seek(p, ahead, 0.75, 4), 1.6);
        }
        return;
      }
      default:
        p.dv = { x: 0, y: 0 };
    }
  }

  function maybeShed(p, boost = 1) {
    const e = W.engagements.find((x) => x.a === p || x.b === p);
    if (!e) return;
    const blk = e.a === p ? e.b : e.a;
    const passPlay = S.kindGroup === 'pass';
    const r = passPlay ? Math.max(p.R.PMV ?? 40, p.R.FMV ?? 40) : p.R.BSH ?? 50;
    const b = passPlay ? blk.R.PBK ?? 50 : blk.R.RBK ?? 50;
    let lam = (passPlay ? 0.1 : 0.22) * Math.exp((r - b) / 15) * boost;
    if (p.ai.shedAt != null && W.t >= p.ai.shedAt) lam = 60;
    if (st.carrier && passPlay && st.carrier !== st.qb) lam *= 3; // blocks melt once the ball is out
    if (rand() < lam * DT) W.disengage(e, p);
  }

  // ------------------------------------------------ scrimmage setups
  function setupRun() {
    S.kindGroup = 'run';
    setupScrimmage();
    setBlockMuls();
    const carrier = pl(S.carrier) || st.qb;
    const qb = st.qb;
    const gap = { end: 6.5, tackle: 3.4, guard: 1.6, middle: 0.4 }[S.gap] ?? 1.6;
    const side = S.loc === 'left' ? 1 : S.loc === 'right' ? -1 : (rand() < 0.5 ? 1 : -1) * 0.3;
    st.gapL = side * gap;
    const gain = S.gain ?? 0;
    const endXYd = losYd + dir * gain;
    let endL = st.gapL + (gain > 4 ? side * Math.min(gain * 0.22, 10) : 0) + (rand() - 0.5) * 1.5;
    let endYYd = clamp(byYd + dir * endL, 2, FIELD_W_YD - 2);
    if (S.oob) endYYd = (byYd + dir * st.gapL * 3) > FIELD_W_YD / 2 ? FIELD_W_YD + 1.2 : -1.2;
    const td = S.td;
    const goal = dir > 0 ? 100 : 0;
    st.endX = td ? goal + dir * 2.5 : endXYd;
    st.endY = endYYd;
    const tackleIds = (S.tacklers || []).filter((id) => byId.has(id) && byId.get(id).team === def);
    tackleIds.forEach((id) => st.tacklers.add(id));

    // carrier path: mesh -> hole -> end spot
    const hole = at(Math.max(0.6, Math.min(2, gain * 0.5)), st.gapL);
    const endPt = absYd(st.endX, st.endY);
    const path = gain < 0.5 ? [at(Math.min(gain, 0) + 0.2, st.gapL), endPt] : [hole, endPt];
    if (carrier === qb) {
      // QB keeper / sneak
      st.carrierIsQB = true;
    } else if (carrier) {
      carrier.ai.mesh = S.shotgun ? at(-4.6, sgn(st.gapL) * 0.5) : at(-3.5, st.gapL * 0.3);
      carrier.ai.runPath = path;
    }
    if (qb) qb.ai.mesh = carrier && carrier !== qb
      ? (S.shotgun ? carrier.ai.mesh : at(-4.2, st.gapL * 0.3))
      : at(-1, 0);

    // blocking: OL + TE + extra; skip designated tacklers
    const front = defense().filter((q) => fOf(q.p) < 6.5 && !['LCB', 'RCB'].includes(q.slot));
    const skipSet = new Set(tackleIds.map((id) => pl(id)));
    const blockers = [...OL.map((s) => slotOf(off, s)), slotOf(off, 'TE')].filter(Boolean);
    if (heavy && slotOf(off, 'WR3')) blockers.push(slotOf(off, 'WR3'));
    assignBlocks(blockers, front, skipSet);
    for (const b of blockers) b.mode = 'run_block';
    for (const s of ['WR1', 'WR2', 'WR3']) {
      const w = slotOf(off, s);
      if (w && w.mode === 'stance' && w !== carrier) {
        w.mode = 'run_block';
        const cb = defense().filter((q) => ['LCB', 'RCB', 'NB', 'SS', 'FS'].includes(q.slot) && !skipSet.has(q)).sort((a, b) => d2(a.p, w.p) - d2(b.p, w.p))[0];
        w.ai.blockOn = cb || null;
      }
    }
    for (const q of defense()) {
      if (st.tacklers.has(q.id)) q.mode = 'tackle_to';
      else if (FRONT.includes(q.slot) || (q.slot === 'NB' && heavy)) {
        q.mode = 'runfit';
        q.ai.gapPt = at(-0.5, lOfY(q.p.y / YD) * 0.8);
      } else if (['MLB', 'WLB'].includes(q.slot)) q.mode = 'read';
      else q.mode = 'pursue';
    }
    if (carrier && carrier !== qb) {
      const rb2 = slotOf(off, 'RB');
      if (rb2 && rb2 !== carrier) { rb2.mode = 'lead_block'; rb2.ai.leadPt = hole; }
    }
    st.onSnap = () => {
      snapTo(qb, S.shotgun ? 0.32 : 0.12);
      if (carrier && carrier !== qb) { qb.mode = 'handoff'; carrier.mode = 'to_mesh'; }
      if (carrier === qb && kind === 'scramble') {
        // dropback, pocket breaks down, QB takes off
        qb.mode = 'qb_drop';
        qb.ai.dropPt = at(S.shotgun ? -6.5 : -7, 0);
        st.tick = () => {
          if (!st.carrier && W.t > 1.9 + rand() * 0.02 && W.ball.holder === qb) {
            ev('scramble', { by: qb.id });
            makeCarrier(qb, st.endX, st.endY, { path: [at(Math.max(fOf(qb.p) + 2, -2), st.gapL * 1.5), endPt], oob: S.oob, td });
          }
        };
      } else if (carrier === qb) {
        st.afterSnap = () => makeCarrier(qb, st.endX, st.endY, { path, oob: S.oob, td });
      }
    };
  }

  function setupKneel() {
    const gain = S.gain ?? -1;
    if (!Number.isFinite(gain) || gain > 0) {
      throw new RangeError(`QB kneel gain must be finite and nonpositive (got ${S.gain})`);
    }
    if (S.td || S.scoring) {
      throw new RangeError('QB kneel cannot be marked as a touchdown or scoring play');
    }
    S.kindGroup = 'run';
    setupScrimmage();
    setBlockMuls();
    const qb = st.qb;
    const requestedEndX = losYd + dir * gain;
    const ownGoalLine = dir > 0 ? 0 : 100;
    st.kneelSafety = dir > 0 ? requestedEndX < ownGoalLine : requestedEndX > ownGoalLine;
    st.endX = st.kneelSafety ? ownGoalLine : requestedEndX;
    for (const p of offense()) if (p !== qb) p.mode = 'idle';
    for (const p of defense()) p.mode = 'idle';
    st.onSnap = () => snapTo(qb, 0.1);
    st.tick = () => {
      if (W.t > 0.35 && !st.kneeled && qb) {
        st.kneeled = true;
        qb.mode = 'idle';
        qb.pose = POSE.KNEEL;
        qb.down = true;
        qb.downT = W.t;
        qb.p.x = st.endX * YD;
      }
      if (W.t > 1.2) whistle(st.kneelSafety ? 'safety' : 'kneel');
    };
  }

  function setupSpike() {
    if (S.td || S.scoring) {
      throw new RangeError('QB spike cannot be marked as a touchdown or scoring play');
    }
    S.kindGroup = 'pass';
    setupScrimmage();
    const qb = st.qb;
    for (const p of W.players) if (p !== qb) p.mode = 'idle';
    st.onSnap = () => snapTo(qb, 0.1);
    st.tick = () => {
      if (W.t > 0.45 && !st.spiked && qb && W.ball.holder === qb) {
        st.spiked = true;
        qb.pose = POSE.THROW;
        Object.assign(W.ball, { state: 'air', holder: null, vx: dir * 1, vy: 0, vz: -9, k: dragK(AERO.spiral) });
        qb.hasBall = false;
        ev('spike', {
          by: qb.id, pass_attempt: true, forward_pass: true, incomplete: true,
          yards_gained: 0, passing_yards: 0, receiver_id: null, receiving_yards: 0,
          first_down: false,
        });
      }
      if (st.spiked && W.ball.state === 'loose') whistle('spike');
    };
  }

  function catchPoint(loc, air, tgt) {
    const l0 = tgt ? lOfY(tgt.p.y / YD) : 0;
    const base = loc === 'left' ? 1 : loc === 'right' ? -1 : 0;
    let l;
    if (base === 0) l = clamp(l0 * 0.25, -5, 5);
    else l = base * clamp(Math.abs(l0) * (air < 5 ? 0.85 : 0.75) + (air > 15 ? 2 : 0), 5, 22);
    if (base !== 0 && Math.sign(l0) !== base && tgt) l = base * clamp(4 + air * 0.25, 4, 12); // crossing route
    const y = clamp(byYd + dir * l, 2.2, FIELD_W_YD - 2.2);
    return { f: air, l: lOfY(y), y };
  }

  function setupPass() {
    S.kindGroup = 'pass';
    setupScrimmage();
    setBlockMuls();
    const qb = st.qb;
    const tgt = pl(S.target);
    st.target = tgt;
    const air = S.air ?? 6;
    const shot = S.shotgun;
    // -------- dropback & timing
    const deep = air >= 18;
    const dropF = shot ? (deep ? -7.5 : -6.2) : deep ? -8.5 : air < 5 ? -4.5 : -7;
    qb.ai.dropPt = at(dropF, 0);
    qb.ai.pocketPt = at(dropF + 0.8, 0);
    const cp = catchPoint(S.loc, air, tgt);
    const C = at(cp.f, cp.l);
    const catchZ = deep ? 1.5 : 1.25;
    st.catchPt = C;
    // throw flight time: ~0.25 s + distance / 22 m/s (≈ NFL 20-yd ball in 1.0 s);
    // stronger arms drive it on a flatter, quicker line
    const throwDist = d2(qb.ai.dropPt, C);
    const velo = 24 + (qb.R.THP - 75) * 0.2;
    const T = 0.15 + throwDist / velo + (deep ? 0.3 : 0);
    const dropT = shot ? (air < 3 ? 0.9 : deep ? 2.5 : 1.7) : air < 3 ? 1.0 : deep ? 2.8 : 2.0;

    // -------- receivers & routes
    const kinds = ['go', 'curl', 'out', 'dig', 'slant', 'post', 'seam'];
    for (const s of ['WR1', 'WR2', 'WR3', 'TE', 'RB']) {
      const r = slotOf(off, s);
      if (!r || r === qb) continue;
      const f0 = fOf(r.p), l0 = lOfY(r.p.y / YD);
      if (r === tgt) continue;
      if (s === 'RB') {
        r.mode = 'route';
        r.ai.path = routeFor(s, f0, l0 || 1, 'check');
        r.ai.wp = 0;
        r.ai.delay = 0.9; // chip/check-release
        continue;
      }
      if (s === 'TE' && heavy) continue;
      r.mode = 'route';
      r.ai.path = routeFor(s, f0, l0, S.concept === 'slant' ? (s === 'TE' ? 'seam' : s === 'WR2' ? 'go' : 'slant') : s === 'TE' ? rand.pick(['seam', 'curl', 'flat']) : rand.pick(kinds));
      r.ai.wp = 0;
    }
    let tCatch;
    if (tgt) {
      const S0 = { ...tgt.p };
      const f0 = fOf(S0);
      const stemF = S.concept === 'slant' ? Math.max(f0 + 2, Math.min(air * 0.55, 4)) : air <= 1.5 ? f0 : Math.max(f0 + 1.5, air * (Math.abs(cp.l - lOfY(S0.y / YD)) > 8 ? 0.55 : 0.8));
      const path = [];
      if (air > 1.5) path.push(at(stemF, lOfY(S0.y / YD)));
      path.push(C);
      // run through the catch
      const u = unit(C.x - (path.length > 1 ? path[0].x : S0.x), C.y - (path.length > 1 ? path[0].y : S0.y));
      path.push({ x: C.x + u.x * 6, y: C.y + u.y * 6 });
      const L = pathLen([S0, ...path.slice(0, -1)]);
      const tRun = L / (tgt.vmax * 0.92) + 0.9;
      tCatch = Math.max(dropT + T, tRun);
      tgt.mode = 'route_target';
      tgt.ai.path = path;
      tgt.ai.wp = 0;
      tgt.ai.arriveT = tCatch;
      tgt.ai.extra = 1;
      tgt.ai.catchPt = C;
    } else {
      tCatch = dropT + T;
    }
    st.tCatch = tCatch;
    st.tThrow = tCatch - T;
    st.T = T;
    st.catchZ = catchZ;

    // -------- protection
    const rushers = defense().filter((q) => FRONT.includes(q.slot) || (q.slot === 'NB' && heavy));
    const sackers = (S.sackers || []).map(pl).filter(Boolean);
    for (const s of sackers) if (!rushers.includes(s)) rushers.push(s);
    const blockers = OL.map((s) => slotOf(off, s)).filter(Boolean);
    const rb = slotOf(off, 'RB');
    if (heavy && slotOf(off, 'TE')) blockers.push(slotOf(off, 'TE'));
    assignBlocks(blockers, rushers.slice().sort((a, b) => lOfY(b.p.y / YD) - lOfY(a.p.y / YD)), new Set());
    for (const b of blockers) {
      b.mode = 'pass_pro';
      b.ai.setPt = at(-2, lOfY(b.p.y / YD) * 1.1);
    }
    const unblocked = rushers.filter((r) => !blockers.some((b) => b.ai.blockOn === r));
    if (rb && rb !== tgt && unblocked.length) {
      rb.mode = 'pass_pro';
      rb.ai.blockOn = unblocked[0];
      rb.ai.setPt = at(-3.5, 0);
    }
    for (const r of rushers) r.mode = 'rush';

    // -------- coverage
    const manMap = { LCB: 'WR1', RCB: 'WR2', NB: 'WR3', WLB: 'TE', MLB: 'RB' };
    for (const q of defense()) {
      if (q.mode === 'rush') continue;
      const m = manMap[q.slot];
      const r = m ? slotOf(off, m) : null;
      if (r && r !== qb) {
        q.mode = 'cover_man';
        q.ai.man = r;
        // What If Lab sets S.coverage; the Film Room leaves it undefined, so the
        // slot-based default must survive the fallback or every non-corner
        // defender gains two yards of cushion and the reconstruction drifts.
        q.ai.cushion = S.coverage === 'man' ? 2.0 : S.coverage === 'blitz' ? 4.0 : ['LCB', 'RCB'].includes(q.slot) ? 5.5 : 3.5;
      } else {
        q.mode = S.coverage === 'blitz' && q.slot === 'SS' ? 'rush' : 'zone';
        q.ai.zonePt = q.slot === 'FS' ? at(Math.max(14, air + 6), 7) : q.slot === 'SS' ? at(Math.max(13, air + 5), -7) : at(7, lOfY(q.p.y / YD));
      }
    }
    // the defender named in the play-by-play is the one in position
    const hawk = pl(S.interceptor || S.defender);
    if (hawk && tgt) {
      const prev = defense().find((q) => q.ai.man === tgt && q !== hawk);
      if (prev && hawk.ai.man) prev.ai.man = hawk.ai.man;
      else if (prev) { prev.mode = 'zone'; prev.ai.zonePt = at(8, lOfY(prev.p.y / YD)); }
      hawk.mode = 'cover_man';
      hawk.ai.man = tgt;
      hawk.ai.tight = true;
      hawk.ai.cushion = 2.5;
      hawk.ai.ballHawk = true;
      hawk.ai.late = kind === 'int' ? -0.05 : 0.02;
    }
    for (const id of S.tacklers || []) {
      const q = pl(id);
      if (q && q.team === def) st.tacklers.add(id);
    }

    // -------- outcome-specific
    if (kind === 'sack') {
      const sk = sackers[0] || rushers[0];
      const tSack = 2.4 + rand() * 1.0;
      st.tSack = tSack;
      st.endX = losYd + dir * (S.gain ?? -6);
      const sideL = lOfY(sk.p.y / YD);
      st.endY = clamp(byYd + dir * (S.oob ? sgn(sideL) * 40 : sideL * 0.25), -1.5, FIELD_W_YD + 1.5);
      for (const s of sackers) s.ai.shedAt = tSack - 1.0 - rand() * 0.4;
      st.tacklers = new Set(sackers.map((s) => s.id));
      st.noThrow = true;
    }
    if (kind === 'complete') {
      const endX = losYd + dir * (S.gain ?? air);
      st.yacEnd = { x: S.td ? (dir > 0 ? 102 : -2) : endX, y: null };
    }
    st.onSnap = () => {
      snapTo(qb, shot ? 0.32 : 0.12);
      qb.mode = 'qb_drop';
      for (const r of offense()) if (r.mode === 'route' && r.ai.delay) r.ai.startT = r.ai.delay;
    };
  }

  function snapTo(p, T) {
    if (!p) return;
    const b = W.ball;
    const from = { x: b.x, y: b.y, z: 0.35 };
    const to = { x: p.p.x, y: p.p.y, z: 1.0 };
    const L = solveLaunch(from, to, T, AERO.spiral);
    Object.assign(b, { state: 'snap', holder: null, vx: L.vx, vy: L.vy, vz: L.vz, k: L.k, x: from.x, y: from.y, z: from.z });
    st.snapTarget = p;
    st.snapArrive = W.t + T;
    ev('snap', { to: p.id });
  }

  function throwBall(qb, C, T, z) {
    const b = W.ball;
    const hx = Math.cos(qb.h), hy = Math.sin(qb.h);
    const from = { x: qb.p.x + hx * 0.3, y: qb.p.y + hy * 0.3, z: Math.min(2.1, qb.info.physics.height + 0.15) };
    // accuracy: small aiming error scaled by THA
    const err = (100 - (qb.R.THA ?? 70)) / 100;
    const to = { x: C.x + rand.normal() * 0.25 * err, y: C.y + rand.normal() * 0.25 * err, z };
    const L = solveLaunch(from, to, T, AERO.spiral);
    Object.assign(b, { state: 'air', holder: null, x: from.x, y: from.y, z: from.z, vx: L.vx, vy: L.vy, vz: L.vz, k: L.k, tumble: false });
    qb.hasBall = false;
    qb.pose = POSE.THROW;
    qb.poseT = W.t;
    const speed = Math.hypot(L.vx, L.vy, L.vz);
    ev('throw', { by: qb.id, to: st.target?.id, speed, T, dist: d2(from, C) });
    st.throwSpeed = speed;
  }

  function resolvePass() {
    const b = W.ball;
    const kindNow = kind;
    const tgt = st.target;
    const hawk = pl(S.interceptor || S.defender);
    if (kindNow === 'complete' && tgt) {
      ev('catch', { by: tgt.id, air: S.air });
      const yac = st.yacEnd;
      const oob = S.oob;
      let endY = yac.y;
      const cy = tgt.p.y / YD;
      if (endY == null) endY = clamp(cy + (S.yac > 3 ? (rand() - 0.5) * Math.min(S.yac, 12) : 0), 1.5, FIELD_W_YD - 1.5);
      if (oob) endY = cy > FIELD_W_YD / 2 ? FIELD_W_YD + 1.2 : -1.2;
      makeCarrier(tgt, yac.x, endY, { oob, td: S.td });
      tgt.pose = POSE.CATCH;
      tgt.poseT = W.t;
      return;
    }
    if (kindNow === 'int' && hawk) {
      ev('interception', { by: hawk.id });
      const endX = S.end ?? S.catchX ?? hawk.p.x / YD;
      st.tacklers = new Set((S.tacklers || []).filter((id) => byId.get(id)?.team === off));
      for (const q of offense()) q.mode = 'pursue';
      makeCarrier(hawk, endX, clamp(hawk.p.y / YD + (rand() - 0.5) * 4, -1.2, FIELD_W_YD + 1.2), { oob: S.retOob });
      if (S.retOob) st.endY = hawk.p.y / YD > FIELD_W_YD / 2 ? FIELD_W_YD + 1.2 : -1.2, st.carrier.ai.path = [absYd(st.endX, st.endY)], st.carrier.ai.oob = true;
      return;
    }
    // incomplete: broken up, dropped, or thrown away
    if (hawk && d2(hawk.p, { x: b.x, y: b.y }) < 2.2) {
      const u = unit(b.vx, b.vy);
      b.vx = -u.x * 2 + (rand() - 0.5) * 3;
      b.vy = -u.y * 2 + (rand() - 0.5) * 3;
      b.vz = 2.5 + rand() * 1.5;
      hawk.pose = POSE.CATCH;
      hawk.poseT = W.t;
      ev('pass_breakup', { by: hawk.id });
    } else if (tgt && d2(tgt.p, { x: b.x, y: b.y }) < 1.6) {
      b.vx *= 0.25;
      b.vy *= 0.25;
      b.vz = 1.5;
      ev('drop', { by: tgt.id });
    } else ev('incomplete', {});
    b.state = 'loose';
    b.k = dragK(AERO.wobble);
  }

  // ------------------------------------------------------- kicking game
  const kickTeam = off, retTeam = def;
  function setupKickoff() {
    S.kindGroup = 'kick';
    const units = S.units || {};
    const ku = (units[kickTeam] || []).filter((id) => P[id]);
    const ru = (units[retTeam] || []).filter((id) => P[id]);
    // 2024+ dynamic kickoff: coverage lines up at the receivers' 40,
    // receivers in the 35–30 set-up zone, nobody moves until the ball lands.
    const kicker = spawn(ku[0], kickTeam, 'K', at(-7, 0.5));
    const cov = ku.slice(1);
    cov.forEach((id, i) => {
      const l = -22 + (44 * i) / Math.max(1, cov.length - 1) + (i >= cov.length / 2 ? 1.5 : -1.5);
      spawn(id, kickTeam, 'KC' + i, at(25, clamp(l, -24, 24)));
    });
    const landYd = S.land ?? losYd + dir * 63;
    const landF = (landYd - losYd) * dir;
    const returner = pl(S.returner) ? pl(S.returner) : spawn(S.returner || ru[0], retTeam, 'KR', at(clamp(landF, 50, 75), 0));
    if (returner) returner.p = at(Math.min(landF, 75), clamp(lOfY(byYd) * 0, -5, 5));
    const rest = ru.filter((id) => id !== S.returner);
    rest.forEach((id, i) => {
      const n = rest.length;
      const deepRow = i >= n - 2;
      const l = deepRow ? (i === n - 1 ? 8 : -8) : -20 + (40 * i) / Math.max(1, n - 3);
      spawn(id, retTeam, 'KB' + i, at(deepRow ? 34 : 30.5, l));
    });
    for (const p of W.players) { p.ai.home = { ...p.p }; p.pose = POSE.RUN; }
    W.ball = { ...W.ball, x: at(0, 0).x, y: at(0, 0).y, z: 0.15, state: 'held', holder: null, hand: 'chest' };
    st.kicker = kicker;
    st.returner = returner;
    st.landYd = landYd;
    (S.tacklers || []).forEach((id) => byId.get(id)?.team === kickTeam && st.tacklers.add(id));
    const hang = 3.7 + ((kicker?.R.KPW ?? 80) - 80) * 0.01 + rand() * 0.25;
    const yLand = S.oob ? (rand() < 0.5 ? -1 : FIELD_W_YD + 1) : byYd + (rand() - 0.5) * 8;
    st.kickPlan = { to: absYd(landYd, yLand), hang, z: S.returner && !S.touchback ? 1.2 : 0.1 };
    if (returner) returner.p = { x: st.kickPlan.to.x + dir * 0.6, y: st.kickPlan.to.y };
    st.onSnap = () => {
      kicker.mode = 'kick_approach';
      for (const p of W.players) if (p !== kicker) p.mode = 'hold_kick';
    };
  }

  function setupPunt() {
    S.kindGroup = 'kick';
    const units = S.units || {};
    const ku = (units[kickTeam] || []).filter((id) => P[id]);
    const ru = (units[retTeam] || []).filter((id) => P[id]);
    const punter = spawn(S.punter || ku[0], kickTeam, 'P', at(-14.5, 0));
    const ls = spawn(S.longSnapper, kickTeam, 'LS', at(-0.5, 0));
    const others = ku.filter((id) => !byId.has(id));
    const leftRoom = dir > 0 ? FIELD_W_YD - byYd : byYd;
    const rightRoom = FIELD_W_YD - leftRoom;
    const spots = [[-0.8, leftRoom - 5], [-0.8, -(rightRoom - 5)], [-0.7, 1.4], [-0.7, -1.4], [-0.8, 2.8], [-0.8, -2.8], [-1.2, 4.0], [-6, 1.2], [-6, -1.2]];
    others.slice(0, 9).forEach((id, i) => spawn(id, kickTeam, i < 2 ? 'G' + i : 'PL' + i, at(...spots[i])));
    const landYd = S.land ?? losYd + dir * 45;
    const landF = (landYd - losYd) * dir;
    const returner = spawn(S.returner || ru[0], retTeam, 'PR', at(clamp(landF + 3, 25, 60), 0));
    const rr = ru.filter((id) => !byId.has(id));
    const rspots = [[1.2, leftRoom - 5.5], [1.2, leftRoom - 7.5], [1.2, -(rightRoom - 5.5)], [1.2, -(rightRoom - 7.5)], [1, 1.5], [1, -1.5], [1, 3.6], [1, -3.6], [6, 2], [6, -2]];
    rr.slice(0, 10).forEach((id, i) => spawn(id, retTeam, 'PB' + i, at(...rspots[i])));
    for (const p of W.players) { p.ai.home = { ...p.p }; p.pose = POSE.STANCE; }
    W.ball = { ...W.ball, x: at(0, 0).x, y: at(0, 0).y, z: 0.15, state: 'held', holder: null, hand: 'chest' };
    st.punter = punter;
    st.returner = returner;
    (S.tacklers || []).forEach((id) => byId.get(id)?.team === kickTeam && st.tacklers.add(id));
    const hang = 4.0 + ((punter?.R.KPW ?? 80) - 80) * 0.02 + rand() * 0.4;
    let yLand = clamp(byYd + (rand() - 0.5) * 14, 6, FIELD_W_YD - 6);
    if (S.oob) yLand = rand() < 0.5 ? -0.4 : FIELD_W_YD + 0.4;
    const caught = !!S.returner && !S.oob && !S.downed && !S.touchback;
    // out-of-bounds punts are spotted where they cross the sideline: aim to
    // land just past it so the crossing point is the real spot
    const toPt = S.oob ? absYd(landYd + dir * 1.6, yLand) : absYd(landYd, yLand);
    st.kickPlan = { to: toPt, hang, z: caught ? 1.3 : 0.1, caught };
    if (returner) returner.ai.catchSpot = { x: st.kickPlan.to.x + dir * 0.4, y: caught ? st.kickPlan.to.y : clamp(st.kickPlan.to.y, 5 * YD, FIELD_W - 5 * YD) };
    st.onSnap = () => {
      const b = W.ball;
      const L = solveLaunch({ x: b.x, y: b.y, z: 0.4 }, { x: punter.p.x, y: punter.p.y, z: 1.0 }, 0.78, AERO.spiral);
      Object.assign(b, { state: 'snap', vx: L.vx, vy: L.vy, vz: L.vz, k: L.k, z: 0.4 });
      st.snapTarget = punter;
      st.snapArrive = W.t + 0.78;
      ev('snap', { to: punter.id });
      for (const p of W.players) {
        if (p === punter) continue;
        if (p.team === kickTeam) {
          p.mode = p.slot.startsWith('G') ? 'gunner' : 'punt_protect';
        } else {
          p.mode = p === returner ? 'returner_wait' : p.slot.startsWith('PB') && ['PB0', 'PB1', 'PB2', 'PB3'].includes(p.slot) ? 'jam' : 'punt_rush';
        }
      }
    };
  }

  function setupFieldGoal() {
    S.kindGroup = 'kick';
    const units = S.units || {};
    const ku = (units[kickTeam] || []).filter((id) => P[id]);
    const du = (units[retTeam] || []).filter((id) => P[id]);
    const kickSpotF = -7;
    const holder = spawn(S.holder, kickTeam, 'H', at(kickSpotF - 0.3, 0.6));
    const kicker = spawn(S.kicker, kickTeam, 'K', at(kickSpotF - 2.6, 1.9));
    const snapper = spawn(S.snapper, kickTeam, 'LS', at(-0.5, 0));
    const line = ku.filter((id) => !byId.has(id));
    const ls = [1.4, -1.4, 2.8, -2.8, 4.2, -4.2, 5.4, -5.4];
    line.slice(0, 8).forEach((id, i) => spawn(id, kickTeam, 'FL' + i, at(-0.7, ls[i])));
    du.forEach((id, i) => {
      const n = du.length;
      const l = -7 + (14 * i) / Math.max(1, n - 1);
      spawn(id, retTeam, 'FR' + i, at(i % 4 === 3 ? 6 : 1.1, l));
    });
    for (const p of W.players) { p.ai.home = { ...p.p }; p.pose = POSE.STANCE; }
    if (holder) holder.pose = POSE.KNEEL;
    W.ball = { ...W.ball, x: at(0, 0).x, y: at(0, 0).y, z: 0.15, state: 'held', holder: null, hand: 'chest' };
    st.holder = holder;
    st.kicker = kicker;
    st.spotPt = at(kickSpotF, 0);
    st.onSnap = () => {
      const b = W.ball;
      const L = solveLaunch({ x: b.x, y: b.y, z: 0.35 }, { x: holder.p.x, y: holder.p.y, z: 0.5 }, 0.42, AERO.spiral);
      Object.assign(b, { state: 'snap', vx: L.vx, vy: L.vy, vz: L.vz, k: L.k, z: 0.35 });
      st.snapTarget = holder;
      st.snapArrive = W.t + 0.42;
      ev('snap', { to: holder.id });
      for (const p of W.players) {
        if (p === kicker || p === holder) continue;
        p.mode = p.team === kickTeam ? 'fg_block' : 'fg_rush';
      }
      kicker.mode = 'fg_approach';
    };
  }

  // kicking-game brains
  function kickBrain(p) {
    const t = W.t;
    switch (p.mode) {
      case 'kick_approach': {
        const ball = { x: W.ball.x, y: W.ball.y };
        p.dv = seek(p, ball, 0.8, 50);
        if (d2(p.p, ball) < 0.6 && !st.kicked) {
          st.kicked = true;
          p.pose = POSE.KICK;
          p.poseT = t;
          const plan = st.kickPlan;
          const L = solveLaunch({ x: W.ball.x, y: W.ball.y, z: 0.15 }, { ...plan.to, z: plan.z }, plan.hang, AERO.tumble);
          Object.assign(W.ball, { state: 'air', holder: null, vx: L.vx, vy: L.vy, vz: L.vz, k: L.k, z: 0.15, tumble: true });
          st.ballLandT = t + plan.hang;
          ev('kick', { by: p.id, hang: plan.hang, speed: Math.hypot(L.vx, L.vy, L.vz) });
          p.mode = 'kick_cover';
        }
        return true;
      }
      case 'hold_kick': {
        // nobody moves until the ball is caught or hits the ground
        p.dv = seek(p, p.ai.home, 0.3);
        p.face = faceTo(p, ballPt());
        const landed = st.ballLandT != null && W.t > st.ballLandT - 0.05;
        if (st.kicked && (landed || (W.ball.state === 'held' && W.ball.holder === st.returner))) {
          p.mode = p.team === kickTeam ? (st.tacklers.has(p.id) ? 'tackle_to' : 'kick_cover') : 'return_block';
        }
        if (p === st.returner && st.kicked) p.mode = 'returner_wait';
        return true;
      }
      case 'kick_cover': {
        if (p.engaged) { maybeShed(p, 1.5); const c = st.carrier; if (c) { const u = unit(c.p.x - p.p.x, c.p.y - p.p.y); p.dv = { x: u.x * 2, y: u.y * 2 }; } return true; }
        const c = st.carrier;
        if (c) { p.mode = 'pursue'; return false; }
        const tgt = st.kickPlan ? { x: st.kickPlan.to.x, y: p.ai.home.y * 0.6 + st.kickPlan.to.y * 0.4 } : ballPt();
        p.dv = separate(p, seek(p, tgt, 0.95), 2);
        return true;
      }
      case 'gunner': {
        if (p.engaged) { maybeShed(p, 2.5); p.dv = seek(p, at(fOf(p.p) + 5, lOfY(p.p.y / YD)), 1); return true; }
        const c = st.carrier;
        if (c) { p.mode = st.tacklers.has(p.id) ? 'tackle_to' : 'pursue'; return false; }
        const tgt = st.returner ? st.returner.ai.catchSpot || st.returner.p : ballPt();
        p.dv = seek(p, { x: tgt.x - dir * 1.5 * YD, y: tgt.y + (p.ai.home.y - tgt.y) * 0.15 }, 1, 20);
        if (W.ball.state === 'loose' && d2(p.p, ballPt()) < 1.2 && S.downed) {
          W.ball.vx = W.ball.vy = W.ball.vz = 0;
          ev('downed', { by: p.id });
          whistle('downed');
        }
        return true;
      }
      case 'jam': {
        const g = W.players.filter((q) => q.team === kickTeam && q.slot.startsWith('G')).sort((a, b) => d2(a.p, p.p) - d2(b.p, p.p))[0];
        if (!g) { p.mode = 'return_block'; return false; }
        if (!p.engaged && d2(p.p, g.p) < p.r + g.r + 0.3 && W.t < 2.5) W.engage(p, g);
        if (p.engaged) { p.dv = { x: -dir * 1.5, y: 0 }; p.pose = POSE.BLOCK; if (W.t > 2.2) { const e = W.engagements.find((x) => x.a === p || x.b === p); if (e) W.disengage(e); } return true; }
        p.dv = seek(p, lead(p, g, 0.8), 0.9);
        if (W.t > 2.5) p.mode = 'return_block';
        return true;
      }
      case 'punt_protect': {
        if (t < 1.9) {
          p.dv = seek(p, { x: p.ai.home.x - dir * 1.2, y: p.ai.home.y }, 0.5);
          p.face = faceDownfield(p);
          p.pose = POSE.BLOCK;
          const r = W.players.find((q) => q.team !== p.team && !q.engaged && d2(q.p, p.p) < p.r + q.r + 0.25);
          if (r && !p.engaged) W.engage(p, r);
          return true;
        }
        if (p.engaged) { const e = W.engagements.find((x) => x.a === p || x.b === p); if (e) W.disengage(e); }
        p.mode = st.tacklers.has(p.id) ? 'tackle_to' : 'kick_cover';
        return false;
      }
      case 'punt_rush': {
        if (t < 1.6) {
          if (p.engaged) { p.dv = { x: -dir * 1.8, y: 0 }; p.pose = POSE.BLOCK; return true; }
          p.dv = seek(p, st.punter ? st.punter.p : at(-12, 0), 0.8);
          return true;
        }
        if (p.engaged) { const e = W.engagements.find((x) => x.a === p || x.b === p); if (e) W.disengage(e); }
        p.mode = 'return_block';
        return false;
      }
      case 'return_block': {
        const c = st.carrier;
        if (p.engaged) {
          const d = p.engaged;
          const u = unit(d.p.x - (c ? c.p.x : p.p.x), d.p.y - (c ? c.p.y : p.p.y));
          p.dv = { x: u.x * 2, y: u.y * 2 };
          p.pose = POSE.BLOCK;
          if (t - (p.ai.engT ?? t) > 2.5 + rand() * 0.02) { const e = W.engagements.find((x) => x.a === p || x.b === p); if (e) W.disengage(e); }
          return true;
        }
        // form a wall in front of the returner, engage the nearest cover man
        const tgt = W.players.filter((q) => q.team === kickTeam && !q.engaged && !q.down && !st.tacklers.has(q.id) && q !== st.kicker && q !== st.punter)
          .sort((a, b) => d2(a.p, p.p) - d2(b.p, p.p))[0];
        if (tgt && (c || W.t > (st.ballLandT ?? 99) - 1.5)) {
          p.dv = seek(p, lead(p, tgt, 0.8), 0.85, 10);
          if (d2(p.p, tgt.p) < p.r + tgt.r + 0.3) { W.engage(p, tgt); p.ai.engT = t; }
        } else {
          const back = st.returner ? st.returner.p : ballPt();
          const want = { x: back.x * 0.35 + p.ai.home.x * 0.65, y: p.ai.home.y * 0.7 + back.y * 0.3 };
          p.dv = seek(p, want, 0.55);
        }
        return true;
      }
      case 'returner_wait': {
        const spot = p.ai.catchSpot || (st.kickPlan ? { x: st.kickPlan.to.x + dir * 0.6, y: st.kickPlan.to.y } : p.p);
        p.dv = seek(p, spot, 0.7, 8);
        p.face = faceTo(p, ballPt());
        if (W.ball.state === 'air' && st.ballLandT - t < 0.4 && (st.kickPlan?.z ?? 0) > 1) p.pose = POSE.CATCH;
        return true;
      }
      case 'fg_block': {
        p.dv = seek(p, { x: p.ai.home.x - dir * 0.8, y: p.ai.home.y }, 0.4);
        p.face = faceDownfield(p);
        p.pose = POSE.BLOCK;
        const r = W.players.find((q) => q.team !== p.team && !q.engaged && d2(q.p, p.p) < p.r + q.r + 0.25);
        if (r && !p.engaged) W.engage(p, r);
        return true;
      }
      case 'fg_rush': {
        if (p.engaged) { p.dv = { x: -dir * 2, y: 0 }; p.pose = POSE.BLOCK; return true; }
        p.dv = seek(p, st.spotPt || at(-7, 0), 0.9);
        if (t > 1.6) p.mode = 'post';
        return true;
      }
      case 'fg_approach': {
        if (t < 0.55) { p.dv = { x: 0, y: 0 }; p.face = faceDownfield(p); return true; }
        const ball = { x: W.ball.x, y: W.ball.y };
        p.dv = seek(p, ball, 0.45, 60);
        if ((d2(p.p, ball) < 0.65 || t > 1.5) && !st.kicked && st.placed) {
          st.kicked = true;
          p.pose = POSE.KICK;
          p.poseT = t;
          kickFG(p);
        }
        return true;
      }
      default:
        return false;
    }
  }

  function kickFG(k) {
    const postX = (dir > 0 ? 110 : -10) * YD;
    const cy = FIELD_W / 2;
    let yAim = cy + (rand() - 0.5) * 0.8;
    let zAt = CROSSBAR + 2.5 + rand() * 2;
    if (!S.good) {
      const m = S.miss || 'wide right';
      // kicker faces +dir; his left is +y when dir > 0
      if (m.includes('left')) yAim = cy + dir * (GOAL_W / 2 + 0.7 + rand() * 1.5);
      else if (m.includes('right')) yAim = cy - dir * (GOAL_W / 2 + 0.7 + rand() * 1.5);
      else zAt = CROSSBAR - 1.2;
    }
    const from = { x: W.ball.x, y: W.ball.y, z: 0.15 };
    const dist = Math.abs(postX - from.x);
    const T = 0.85 + dist / 24;
    const L = solveLaunch(from, { x: postX, y: yAim, z: zAt }, T, AERO.tumble);
    Object.assign(W.ball, { state: 'air', holder: null, vx: L.vx, vy: L.vy, vz: L.vz, k: L.k, z: 0.15, tumble: true });
    st.fgPostT = W.t + T;
    st.fgPostX = postX;
    ev('kick', { by: k.id, kind: S.kind, distance: S.distance, speed: Math.hypot(L.vx, L.vy, L.vz) });
  }

  // -------------------------------------------------- presnap penalties
  function setupPresnap() {
    S.kindGroup = 'pass';
    setupScrimmage();
    const offender = pl(S.penalty?.player);
    st.onSnap = () => {};
    st.noSnap = true;
    st.tick = () => {
      if (offender && W.t > -0.1 && W.t < 0.35) {
        offender.mode = 'idle';
        offender.dv = { x: (offender.team === off ? dir : -dir) * 2.2, y: 0 };
        offender.p.x += offender.dv.x * DT;
      }
      if (W.t > 0.25 && st.flagT == null) {
        st.flagT = W.t;
        ev('flag', { text: S.penalty?.text, at: offender ? { x: offender.p.x / YD, y: offender.p.y / YD } : { x: losYd, y: byYd } });
      }
      if (W.t > 1.4) whistle('penalty');
    };
  }

  // =============================================================== run
  switch (kind) {
    case 'run': case 'scramble': setupRun(); break;
    case 'kneel': setupKneel(); break;
    case 'spike': setupSpike(); break;
    case 'complete': case 'incomplete': case 'int': case 'sack': setupPass(); break;
    case 'kickoff': setupKickoff(); break;
    case 'punt': setupPunt(); break;
    case 'fg': case 'xp': setupFieldGoal(); break;
    case 'presnap': setupPresnap(); break;
    default: return null;
  }

  // recording
  const roster = W.players.map((p) => ({ id: p.id, team: p.team, slot: p.slot }));
  const NP = W.players.length;
  const STRIDE = NP * 6 + 6;
  const frames = [];
  let nextRec = -PRE;

  W.onTouch = (a, b) => tryTackle(a, b);

  function record() {
    const f = new Float32Array(STRIDE);
    let o = 0;
    for (const p of W.players) {
      f[o++] = p.p.x / YD;
      f[o++] = p.p.y / YD;
      f[o++] = p.h;
      f[o++] = Math.hypot(p.v.x, p.v.y);
      f[o++] = p.down ? POSE.DOWN : p.pose;
      f[o++] = p.hasBall ? 1 : 0;
    }
    const b = W.ball;
    f[o++] = b.x / YD;
    f[o++] = b.y / YD;
    f[o++] = b.z;
    f[o++] = b.spin;
    f[o++] = b.state === 'air' || b.state === 'snap' ? Math.atan2(b.vy, b.vx) : b.rot || 0;
    f[o++] = b.state === 'air' || b.state === 'snap' ? Math.atan2(b.vz, Math.hypot(b.vx, b.vy)) : 0;
    frames.push(f);
  }

  W.t = -PRE;
  // A kick has a four-second flight and a return behind it; give the kicking
  // game its own clock so a long return is not truncated as a technical stop.
  const maxT = S.kindGroup === 'kick' ? 20 : MAX_T;
  let snapped = false;
  while (W.t < maxT) {
    if (!snapped && W.t >= 0) {
      snapped = true;
      st.phase = 'live';
      for (const p of W.players) if (p.pose === POSE.STANCE && S.kindGroup !== 'kick') p.pose = POSE.RUN;
      st.onSnap && st.onSnap();
      st.afterSnap && st.afterSnap();
    }
    if (st.tick) st.tick();

    // snap arrival
    if (W.ball.state === 'snap' && W.t >= st.snapArrive) {
      const r = st.snapTarget;
      Object.assign(W.ball, { state: 'held', holder: r, hand: 'chest' });
      r.hasBall = true;
      if (r === st.holder) { st.placed = true; W.ball.holder = null; W.ball.state = 'held'; Object.assign(W.ball, { x: st.spotPt.x, y: st.spotPt.y, z: 0.15 }); r.hasBall = false; r.pose = POSE.HOLD; }
    }
    // pass: throw at the scheduled time
    if (S.kindGroup === 'pass' && ['complete', 'incomplete', 'int'].includes(kind) && !st.thrown && st.qb && W.ball.holder === st.qb && W.t >= st.tThrow) {
      st.thrown = true;
      let C = st.catchPt;
      let z = st.catchZ;
      if (!st.target) {
        // throwaway: out of bounds past the sideline
        const l = lOfY(st.qb.p.y / YD) >= 0 ? 1 : -1;
        const y = byYd + dir * l * 40 > FIELD_W_YD / 2 ? FIELD_W_YD + 3 : -3;
        C = absYd(losYd + dir * (S.air || 8), y);
        st.catchPt = C;
        z = 0.6;
        st.T = 0.15 + d2(st.qb.p, C) / 24;
      } else if (kind === 'incomplete' && !pl(S.defender)) {
        // misfire: a touch long and high
        const u = unit(C.x - st.qb.p.x, C.y - st.qb.p.y);
        C = { x: C.x + u.x * 1.6, y: C.y + u.y * 1.6 };
        z = 2.4;
      }
      throwBall(st.qb, C, st.T, z);
    }
    if (st.thrown && !st.resolved && W.ball.state === 'air' && W.t >= st.tCatch) {
      st.resolved = true;
      resolvePass();
    }
    // sack timing: QB keeps the ball and is hunted down at the spot
    if (kind === 'sack' && W.t > 0.3 && st.qb && !st.carrier && W.ball.holder === st.qb) {
      makeCarrier(st.qb, st.endX, st.endY, { oob: S.oob, keepModes: true });
      st.qb.mode = 'qb_drop';
      st.sackPhase = true;
    }
    if (st.sackPhase && st.carrier === st.qb && st.qb.mode !== 'carry' && d2(st.qb.p, st.qb.ai.dropPt) < 0.6) st.qb.mode = 'carry';
    if (st.sackPhase && st.qb.mode === 'carry' && W.t < (st.tSack ?? 3) - 0.6) {
      // hold in the pocket until the rush arrives
      st.qb.speedCap = 0.3;
    } else if (st.qb) st.qb.speedCap = 1;

    // kicks: catch / land
    if (S.kindGroup === 'kick' && st.kicked && W.ball.state === 'air' && st.ballLandT != null && W.t >= st.ballLandT - 0.02 && st.kickPlan && !st.kickResolved) {
      st.kickResolved = true;
      const R = st.returner;
      if (kind === 'kickoff') {
        if (S.touchback && !S.returner) {
          W.ball.state = 'loose';
        } else if (R && !S.oob && S.fairCatch) {
          ev('catch', { by: R.id, kick: true, fair: true });
          Object.assign(W.ball, { state: 'held', holder: R, hand: 'chest' });
          R.hasBall = true;
          R.pose = POSE.CATCH;
          whistle('fair_catch', { by: R.id });
        } else if (R && !S.oob) {
          ev('catch', { by: R.id, kick: true });
          const endY = S.retOob ? (R.p.y / YD > FIELD_W_YD / 2 ? FIELD_W_YD + 1.2 : -1.2) : clamp(R.p.y / YD + (rand() - 0.5) * 16, 4, FIELD_W_YD - 4);
          makeCarrier(R, S.end ?? R.p.x / YD, endY, { oob: S.retOob });
        } else W.ball.state = 'loose';
      } else if (kind === 'punt') {
        if (st.kickPlan.caught && R) {
          ev('catch', { by: R.id, kick: true, fair: S.fairCatch });
          if (S.fairCatch) {
            Object.assign(W.ball, { state: 'held', holder: R, hand: 'chest' });
            R.hasBall = true;
            R.pose = POSE.CATCH;
            whistle('fair_catch', { by: R.id });
          } else {
            const endY = S.retOob ? (R.p.y / YD > FIELD_W_YD / 2 ? FIELD_W_YD + 1.2 : -1.2) : clamp(R.p.y / YD + (rand() - 0.5) * 14, 4, FIELD_W_YD - 4);
            makeCarrier(R, S.end ?? R.p.x / YD, endY, { oob: S.retOob });
          }
        } else W.ball.state = 'loose';
      }
    }
    // punt: kick at ~2.0 s after the snap reaches the punter
    if (kind === 'punt' && !st.kicked && st.punter && W.ball.holder === st.punter && W.t > 1.9) {
      st.kicked = true;
      const p = st.punter;
      p.pose = POSE.KICK;
      p.poseT = W.t;
      const plan = st.kickPlan;
      const from = { x: p.p.x + dir * 0.6, y: p.p.y, z: 0.8 };
      const L = solveLaunch(from, { ...plan.to, z: plan.z }, plan.hang, AERO.wobble);
      Object.assign(W.ball, { state: 'air', holder: null, x: from.x, y: from.y, z: from.z, vx: L.vx, vy: L.vy, vz: L.vz, k: L.k, tumble: false });
      p.hasBall = false;
      st.ballLandT = W.t + plan.hang;
      ev('kick', { by: p.id, hang: plan.hang, speed: Math.hypot(L.vx, L.vy, L.vz) });
    }
    if (kind === 'punt' || kind === 'kickoff') {
      for (const p of W.players) if (p.mode === 'pursue' && st.tacklers.has(p.id)) p.mode = 'tackle_to';
    }
    // field goal: holder places, ball crosses the end line
    if ((kind === 'fg' || kind === 'xp') && st.fgPostT != null && W.t >= st.fgPostT && !st.fgDone) {
      st.fgDone = true;
      ev(S.good ? 'fg_good' : 'fg_miss', { distance: S.distance, miss: S.miss });
      st.endT = W.t + 0.8;
    }
    if (st.endT != null && W.t >= st.endT) whistle(S.good ? 'fg_good' : 'fg_miss');

    // carrier out of bounds / touchdown
    const c = st.carrier;
    if (c && !st.dead) {
      const yy = c.p.y / YD, xx = c.p.x / YD;
      if (yy < -0.3 || yy > FIELD_W_YD + 0.3) whistle('out_of_bounds', { by: c.id });
      else if ((dir > 0 && c.team === off) || (dir < 0 && c.team !== off) ? xx > 100 : xx < 0) {
        if (c.ai.td || S.td || S.scoring) {
          ev('touchdown', { by: c.id });
          c.ai.celebrate = true;
          whistle('touchdown', { by: c.id });
        }
      }
    }
    // loose ball dead (incomplete, kicks out / touchback)
    if (!st.dead && W.ball.state === 'loose' && snapped) {
      const b = W.ball;
      const out = b.y < 0 || b.y > FIELD_W || b.x < -10 * YD || b.x > 110 * YD;
      if (['incomplete', 'spike'].includes(kind) && b.z <= 0.12) whistle('incomplete');
      // A field-goal attempt that sails through or wide of the end zone is
      // already decided by the post-crossing event; the loose ball must not
      // overwrite that whistle with a generic out of bounds.
      else if (out && kind !== 'fg' && kind !== 'xp') whistle(kind === 'punt' || kind === 'kickoff' ? 'kick_out_of_bounds' : 'out_of_bounds');
      else if ((kind === 'punt' || kind === 'kickoff') && (S.touchback || S.oob || S.downed) && Math.hypot(b.vx, b.vy) < 0.4 && b.z < 0.15) whistle(S.touchback ? 'touchback' : 'downed');
      else if ((kind === 'punt' || kind === 'kickoff') && S.touchback && ((dir > 0 && b.x > 100 * YD) || (dir < 0 && b.x < 0)) && W.t > (st.ballLandT ?? 0) + 0.8) whistle('touchback');
    }

    if (S.penalty && kind !== 'presnap' && st.flagT == null && W.t > 1.2) {
      st.flagT = W.t;
      const o = pl(S.penalty.player);
      ev('flag', { text: S.penalty.text, at: o ? { x: o.p.x / YD, y: o.p.y / YD } : { x: losYd, y: byYd } });
    }
    if (W.ball.y >= 0 && W.ball.y <= FIELD_W) st.lastIn = { x: W.ball.x, y: W.ball.y };
    if (st.carrier && !st.dead && st.tTackle == null && !st.carrier.ai.oob && !st.carrier.ai.td) {
      const c = st.carrier;
      // A returner covers ground faster than a run from scrimmage; a generous
      // 0.55*vmax budget lets a long return run out the clock before contact.
      const pace = S.kindGroup === 'kick' ? 0.9 : 0.55;
      const budget = Math.abs(st.endX - c.ai.startX) * YD / (pace * c.vmax) + 2.5;
      if (W.t - st.carrierSince > budget) {
        const near = W.players.filter((q) => q.team !== c.team && !q.down).sort((a, b) => d2(a.p, c.p) - d2(b.p, c.p))[0];
        if (near && d2(near.p, c.p) < 3) startTackle(near, c);
        else if (near) near.mode = "tackle_to"; // nearest defender closes the play
      }
    }
    updateTackle();
    W.step(DT, (p) => {
      if (S.kindGroup === 'kick' && p.mode !== 'carry' && p.mode !== 'post' && p.mode !== 'pursue' && p.mode !== 'tackle_to') {
        if (kickBrain(p)) return;
      }
      if (p.mode === 'route' && p.ai.startT && W.t < p.ai.startT) { p.dv = { x: 0, y: 0 }; return; }
      brain(p);
    });
    if (W.t >= nextRec - 1e-9) {
      record();
      nextRec += 1 / REC_HZ;
    }
    if (st.dead && W.t - st.deadT > POST) break;
    // A wrap that is already in progress is real contact, not a truncated
    // play: let it finish rather than reporting a technical timeout.
    if (!st.dead && st.tTackle != null && W.t > maxT - 0.05) whistle('tackle', { by: st.tackler.id });
    else if (!st.dead && st.tTackle == null && W.t > maxT - POST - 0.05) whistle('timeout_sim');
  }

  // final ball spot (yards) for validation
  const b = W.ball;
  const top = W.players.reduce((m, p) => (p.topSpeed > m.v ? { v: p.topSpeed, id: p.id } : m), { v: 0, id: null });
  return {
    id: S.id, roster, stride: STRIDE, frames, t0: -PRE, hz: REC_HZ, events: W.events,
    end: { x: st.spot ? st.spot.x : b.x / YD, y: st.spot ? st.spot.y : b.y / YD, reason: st.whistle, t: st.deadT },
    expectEndX: st.endX ?? null,
    biggestHit: W.biggestHit, topSpeed: top, throwSpeed: st.throwSpeed ?? null,
    carrierId: st.carrier?.id ?? null,
    stats: W.players.map((p) => ({ id: p.id, top: p.topSpeed, dist: p.dist })),
  };
}
