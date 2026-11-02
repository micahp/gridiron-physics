// Flags player movement that looks wrong, play by play, for one game record.
//
//   node scripts/audit-player-movement.mjs --record <envelope.json> [--authority statistical_replay|physics]
//     [--out <audit.json>] [--root <engine checkout>] [--roster <league ratings json>]
//
// Every play goes through the same model and executor the 3D replay uses, and each rule reads the frames it returns.
// A flag is a lead to look at, not a verdict. Two kinds:
//   brain    the player moved against what his assignment should make him do (a rule about intent)
//   physics  the body did something a body does not do (speed, a sharp reversal, leaving the field)
// Engine units are yards and yards per second. The output reports metres.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const YD_M = 0.9144;
const FIELD_W_YD = 53.33;
const PASSER_NEAR_M = 3.0; // a defender this close to the passer is in the pocket
const CLOSE_M = 2.0; // a defender this close to the carrier is on him
const AWAY_M = 3.0; // he moves this far directly away from the anchor within a second
const CONTACT_M = 1.5; // an offensive player this close is in contact with him
const WINDOW_S = 1.0; // how long a retreat is judged over
const BLOCK_CHECK_S = 1.0; // when an offensive lineman should be on the defender in front of him
const BLOCK_MISS_M = 2.5;
const LINE_YD = 3.0; // a defender this close to the lineman's depth at the snap is on the line
const SETTLE_M = 0.3; // any move before the snap farther than this
const OVER_SPEED_YDPS = 11.0; // about 22 mph
const REVERSAL_DEG = 120;
const REVERSAL_S = 0.3; // the window over which the movement direction must turn around
const REVERSAL_MIN_YDPS = 4.0; // every frame in the window must be moving at least this fast

const OL = ['LT', 'LG', 'C', 'RG', 'RT'];
// The defender each lineman is paired with at the snap. Same table as IN_FRONT in engine/play.js.
const IN_FRONT = { LT: 'LEDGE', LG: 'LDT', RG: 'RDT', RT: 'REDGE', C: 'NB' };

const RULES = {
  moved_before_snap: 'brain',
  turned_from_passer: 'brain',
  block_not_on_man: 'brain',
  moved_away_from_carrier: 'brain',
  over_top_speed: 'physics',
  sharp_reversal: 'physics',
  left_field: 'physics',
};

const round = (x, d = 2) => (x == null || !Number.isFinite(x) ? null : Number(x.toFixed(d)));
const flag = (args, name, fallback = null) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};

function auditPlay(item, api, authority, names) {
  let result;
  try {
    result = api.executeSelectedPlay(api.selectionForSlcPlay(item.model, item.item), { authority });
  } catch (error) {
    return { ...item.key, event: item.item.play.event_type, error: error.message, flags: [] };
  }
  if (result.failure || !result.record) {
    return { ...item.key, event: item.item.play.event_type, error: result.failure?.message ?? 'no record', flags: [] };
  }
  const r = result.record;
  const qbI = r.roster.findIndex((p) => p.slot === 'QB');
  if (qbI < 0) return null; // kicks and other plays with no passer are not scrimmage plays
  const { frames, hz } = r;
  const off = r.roster[qbI].team;
  const players = r.roster.map((_, j) => j);
  const offense = players.filter((j) => r.roster[j].team === off);
  const defense = players.filter((j) => r.roster[j].team !== off);
  const frameAt = (t) => Math.min(frames.length - 1, Math.max(0, Math.round((t - r.t0) * hz)));
  const secAt = (i) => r.t0 + i / hz;
  const pos = (i, j) => ({ x: frames[i][j * 6], y: frames[i][j * 6 + 1] });
  const gap = (ia, a, ib, b) => Math.hypot(pos(ia, a).x - pos(ib, b).x, pos(ia, a).y - pos(ib, b).y) * YD_M;
  const speedYdps = (i, j) => frames[i][j * 6 + 3];
  const flags = [];
  const blockGaps = [];
  const add = (rule, j, t, detail) => flags.push({
    rule, kind: RULES[rule], slot: r.roster[j].slot, player: names(r.roster[j].id), t: round(t), detail,
  });

  // A defender who is near the anchor (the passer or the carrier) and then moves directly away from him over the next
  // second, with no offensive player in contact with him. A blocker holding him, or a carrier cutting past him, does not
  // count: the defender has to be the one moving away.
  const k1 = Math.round(WINDOW_S * hz);
  const retreat = (j, anchor, iFrom, iTo, near) => {
    for (let i = iFrom; i + k1 <= iTo; i++) {
      const d0 = gap(i, j, i, anchor);
      if (d0 > near) continue;
      const d1 = gap(i + k1, j, i + k1, anchor);
      // he has to be the one moving: the gap grows because he travels, not because the anchor does
      if (d1 - d0 < AWAY_M || gap(i + k1, j, i, j) < AWAY_M) continue;
      // a push explains an early retreat; contact that comes after he is already gone does not
      let contact = false;
      for (let q = i; q <= i + Math.round(k1 / 2) && !contact; q++) {
        for (const o of offense) if (o !== anchor && gap(q, j, q, o) < CONTACT_M) { contact = true; break; }
      }
      if (!contact) return { i, d0, d1 };
    }
    return null;
  };

  // before the snap every player should be on his set point
  const pre = frameAt(0);
  for (const j of players) {
    let far = { d: 0, i: 0 };
    for (let i = 1; i <= pre; i++) {
      const d = gap(i, j, 0, j);
      if (d > far.d) far = { d, i };
    }
    if (far.d > SETTLE_M) add('moved_before_snap', j, secAt(far.i), `${round(far.d)} m from his set point`);
  }

  // speed above what a sprinting body reaches
  for (const j of players) {
    let peak = { s: 0, i: 0 };
    for (let i = 0; i < frames.length; i++) {
      const s = speedYdps(i, j);
      if (s > peak.s) peak = { s, i };
    }
    if (peak.s > OVER_SPEED_YDPS) add('over_top_speed', j, secAt(peak.i), `${round(peak.s)} yd/s`);
  }

  // the direction of travel turns around inside a fraction of a second while he is moving fast throughout
  const k = Math.max(1, Math.round(REVERSAL_S * hz));
  for (const j of players) {
    let worst = null;
    for (let i = 0; i + 2 * k < frames.length; i++) {
      if ([i, i + k, i + 2 * k].some((q) => speedYdps(q, j) < REVERSAL_MIN_YDPS)) continue;
      const a = { x: pos(i + k, j).x - pos(i, j).x, y: pos(i + k, j).y - pos(i, j).y };
      const b = { x: pos(i + 2 * k, j).x - pos(i + k, j).x, y: pos(i + 2 * k, j).y - pos(i + k, j).y };
      const cos = (a.x * b.x + a.y * b.y) / (Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y) || 1);
      const deg = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
      if (deg >= REVERSAL_DEG && (!worst || deg > worst.deg)) worst = { deg, i };
    }
    if (worst) add('sharp_reversal', j, secAt(worst.i), `direction turns ${round(worst.deg, 0)} deg in ${REVERSAL_S * 2} s`);
  }

  // a body well outside the lines of the field (players do run out the back of the end zone, so the end bound is loose)
  for (const j of players) {
    for (let i = 0; i < frames.length; i++) {
      const { x, y } = pos(i, j);
      if (x < -14 || x > 114 || y < -6 || y > FIELD_W_YD + 6) {
        add('left_field', j, secAt(i), `at (${round(x, 1)}, ${round(y, 1)}) yd`);
        break;
      }
    }
  }

  // each lineman is on the defender in front of him when the ball is one second old. The man in front is the defender
  // the engine pairs with him (IN_FRONT) when that defender lines up at his depth, otherwise the nearest one who does.
  const iSnap = frameAt(0);
  const iBlock = frameAt(BLOCK_CHECK_S);
  const onLine = (o, d) => Math.abs(frames[iSnap][d * 6] - frames[iSnap][o * 6]) <= LINE_YD;
  for (const o of offense.filter((j) => OL.includes(r.roster[j].slot))) {
    const paired = defense.find((d) => r.roster[d].slot === IN_FRONT[r.roster[o].slot]);
    const front = defense.filter((d) => onLine(o, d));
    const man = paired !== undefined && onLine(o, paired) ? paired
      : front.length ? front.reduce((best, d) => (gap(iSnap, o, iSnap, d) < gap(iSnap, o, iSnap, best) ? d : best)) : null;
    if (man === null) continue;
    const g = gap(iBlock, o, iBlock, man);
    blockGaps.push(g);
    // a center between two tackles is blocking if either of them is on him
    if (g > BLOCK_MISS_M && front.every((d) => gap(iBlock, o, iBlock, d) > BLOCK_MISS_M)) add('block_not_on_man', o, BLOCK_CHECK_S, `${round(g)} m from ${r.roster[man].slot} ${names(r.roster[man].id)}, the man in front of him`);
  }

  // a defender who gets to the passer and then moves away from him, before the throw
  const throwEv = r.events.find((e) => e.type === 'throw');
  if (throwEv) {
    const iT = frameAt(throwEv.t);
    for (const j of defense) {
      const hit = retreat(j, qbI, 0, iT, PASSER_NEAR_M);
      if (hit) {
        add('turned_from_passer', j, secAt(hit.i), `${round(hit.d0)} m from the passer, ${round(hit.d1)} m a second later, `
          + `throw at ${round(throwEv.t, 2)} s`);
      }
    }
  }

  // a defender who was on the carrier and then moves away from him while the carrier is still live
  const ci = r.roster.findIndex((p) => p.id === r.carrierId);
  if (ci >= 0) {
    const startEv = r.events.find((e) => ['handoff', 'catch'].includes(e.type));
    const tackleEv = r.events.find((e) => e.type === 'tackle');
    const i0 = startEv ? frameAt(startEv.t) : 0;
    const i1 = tackleEv ? frameAt(tackleEv.t) : frames.length - 1;
    for (const j of defense) {
      const hit = retreat(j, ci, i0, i1, CLOSE_M);
      if (hit) {
        add('moved_away_from_carrier', j, secAt(hit.i), `on the carrier at ${round(hit.d0)} m, ${round(hit.d1)} m a second later`);
      }
    }
  }

  return {
    ...item.key,
    event: item.item.play.event_type,
    carrier: ci >= 0 ? names(r.carrierId) : null,
    flags,
    blockGaps,
  };
}

async function audit(args) {
  const root = path.resolve(flag(args, '--root', path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')));
  const recordPath = flag(args, '--record');
  if (!recordPath) throw new Error('usage: --record <envelope.json> [--authority statistical_replay|physics] [--out audit.json]');
  const authority = flag(args, '--authority', 'statistical_replay');
  const api = {
    ...(await import(pathToFileURL(path.join(root, 'web/slc-seed-physics-replay.js')).href)),
    ...(await import(pathToFileURL(path.join(root, 'web/prototype-execution.js')).href)),
  };
  const envelope = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  const record = envelope.record ?? envelope;
  const league = JSON.parse(fs.readFileSync(flag(args, '--roster', path.join(root, 'data/teams/league-ratings-2026-week7.json')), 'utf8'));
  const byId = new Map(Object.values(league.teams).flatMap((t) => t.roster.map((p) => [String(p.id), `${p.name} #${p.jersey}`])));
  const names = (id) => byId.get(String(id)) ?? String(id);
  const model = api.prepareSlcPhysicsReplay(record, league);
  const items = record.drives.flatMap((drive, d) => drive.plays.map((play, p) => ({ model, key: { drive: d, play: p }, item: { play, drive } })));
  const rows = [];
  for (const item of items) {
    const row = auditPlay(item, api, authority, names);
    if (row) rows.push(row);
  }
  const scored = rows.filter((row) => !row.error);
  const failed = rows.filter((row) => row.error);
  const byRule = Object.fromEntries(Object.keys(RULES).map((rule) => [rule, { kind: RULES[rule], flags: 0, plays: 0 }]));
  for (const row of scored) {
    for (const rule of new Set(row.flags.map((f) => f.rule))) byRule[rule].plays += 1;
    for (const f of row.flags) byRule[f.rule].flags += 1;
  }
  const flagged = scored.filter((row) => row.flags.length);
  const gaps = scored.flatMap((row) => row.blockGaps).sort((a, b) => a - b);
  const q = (p) => round(gaps[Math.min(gaps.length - 1, Math.floor(p * gaps.length))]);
  const blockGap = { n: gaps.length, p25_m: q(0.25), median_m: q(0.5), p75_m: q(0.75), p90_m: q(0.9) };
  for (const row of scored) delete row.blockGaps;
  const report = {
    schema: 'gridiron.movement-audit.v1',
    authority,
    record: path.basename(recordPath),
    engine_root: root,
    plays_total: items.length,
    plays_scored: scored.length,
    plays_failed: failed.length,
    plays_flagged: flagged.length,
    rules: byRule,
    block_gap_at_1s: blockGap,
    plays: rows.filter((row) => row.error || row.flags.length),
  };
  console.log(`${authority}: scored ${scored.length} of ${items.length} plays, ${failed.length} failed, ${flagged.length} flagged`);
  for (const [rule, s] of Object.entries(byRule)) {
    console.log(`  ${rule.padEnd(24)} ${s.kind.padEnd(8)} ${String(s.plays).padStart(4)} plays  ${String(s.flags).padStart(4)} flags`);
  }
  console.log(`  lineman to his man at 1 s: n=${blockGap.n}, median ${blockGap.median_m} m, p75 ${blockGap.p75_m} m, p90 ${blockGap.p90_m} m`);
  for (const row of flagged) {
    console.log(`drive ${row.drive} play ${row.play} (${row.event})${row.carrier ? `, carrier ${row.carrier}` : ''}`);
    for (const f of row.flags) console.log(`    ${f.kind.padEnd(8)} ${f.rule.padEnd(24)} ${f.slot.padEnd(6)} ${f.player}  t=${f.t}s  ${f.detail}`);
  }
  const out = flag(args, '--out');
  if (out) {
    fs.writeFileSync(out, JSON.stringify(report, null, 1));
    console.log(`wrote ${out}`);
  }
}

await audit(process.argv.slice(2));
