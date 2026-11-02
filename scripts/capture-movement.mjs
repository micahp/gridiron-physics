// Captures ball-carrier movement for every play of one game, so engine versions can be compared.
//
//   node scripts/capture-movement.mjs --record <envelope.json> --out <capture.json> [--label name] [--root engine checkout]
//   node scripts/capture-movement.mjs --compare <a.json> <b.json>
//
// Each play goes through the same model and executor the 3D replay uses, so the numbers describe what the viewer shows.
// A capture holds a summary, one row per carrier play, and a 10 Hz speed trace per carrier.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const YD_M = 0.9144;
const SPOT_YD = 6; // a drop this close to the real end spot is the stop itself
const CONTACT_M = 1.5; // a player this close is in body contact
const FAST_MPS = 6.5; // about 14.5 mph

const round = (x, d = 2) => (x == null || !Number.isFinite(x) ? null : Number(x.toFixed(d)));
const sorted = (xs) => [...xs].sort((a, b) => a - b);
const median = (xs) => (xs.length ? round(sorted(xs)[Math.floor(xs.length / 2)]) : null);
const mean = (xs) => (xs.length ? round(xs.reduce((sum, x) => sum + x, 0) / xs.length) : null);
const quantile = (xs, p) => (xs.length ? round(sorted(xs)[Math.min(xs.length - 1, Math.floor(p * xs.length))]) : null);
const flag = (args, name, fallback = null) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};

function capturePlay(item, index, model, api) {
  let result;
  try {
    result = api.executeSelectedPlay(api.selectionForSlcPlay(model, item), { authority: api.authority });
  } catch (error) {
    return { index, id: item.play.id, event: item.play.event_type, error: error.message };
  }
  if (result.failure || !result.record) {
    return { index, id: item.play.id, event: item.play.event_type, error: result.failure?.message ?? 'no record' };
  }
  const r = result.record;
  const k = r.roster.findIndex((p) => p.id === r.carrierId);
  if (k < 0) return null;
  const team = r.roster[k].team;
  const rivals = r.roster.flatMap((p, j) => (p.team === team ? [] : [j]));
  const mates = r.roster.flatMap((p, j) => (p.team === team && j !== k ? [j] : []));
  const nearest = (f, cx, cy, set) => set.reduce((best, j) => Math.min(best, Math.hypot((f[j * 6] - cx) * YD_M, (f[j * 6 + 1] - cy) * YD_M)), Infinity);
  const frames = r.frames.map((f, i) => {
    const cx = f[k * 6], cy = f[k * 6 + 1];
    return {
      t: r.t0 + i / r.hz,
      speed: f[k * 6 + 3],
      x: cx,
      rem: Math.abs((r.expectEndX ?? NaN) - cx),
      opp: nearest(f, cx, cy, rivals),
      mate: nearest(f, cx, cy, mates),
    };
  });
  const peak = Math.max(...frames.map((q) => q.speed));
  // the tackle: where it happened against the real end spot, how fast the carrier was going, and how many defenders were on him
  const tackleEvent = r.events.find((e) => e.type === 'tackle');
  let tackle = null;
  if (tackleEvent) {
    const i = Math.min(frames.length - 1, Math.max(0, Math.round((tackleEvent.t - r.t0) * r.hz)));
    const f = r.frames[i];
    const cx = f[k * 6], cy = f[k * 6 + 1];
    const onCarrier = rivals.filter((j) => Math.hypot((f[j * 6] - cx) * YD_M, (f[j * 6 + 1] - cy) * YD_M) < 3).length;
    tackle = { t: round(tackleEvent.t), rem_yd: round(frames[i].rem, 1), speed_mps: round(frames[i].speed), defenders_within_3m: onCarrier };
  }
  // gain realism: the gain the physics produced (where the carrier stopped) against the gain the record says
  const stopIndex = tackleEvent ? Math.min(frames.length - 1, Math.max(0, Math.round((tackleEvent.t - r.t0) * r.hz))) : frames.length - 1;
  const physicsGain = Math.abs(frames[stopIndex].x - frames[0].x);
  const recordedGain = Math.abs((r.expectEndX ?? frames[0].x) - frames[0].x);
  // how close the nearest defender got while the carrier was running at 7 m/s or more and more than 3 yd from the spot
  const breakawayMin = Math.min(...frames.filter((q) => q.t > 0 && q.speed >= 7 && q.rem > 3).map((q) => q.opp));
  const start = frames.find((q) => q.speed > 0.3);
  const speedAfter = (dt) => {
    const fr = start && frames.find((q) => q.t >= start.t + dt);
    return fr ? round(fr.speed) : null;
  };
  // the first loss of 40% of the running top speed, once the carrier has been above 5 m/s
  let runMax = 0, drop = null;
  for (const q of frames) {
    runMax = Math.max(runMax, q.speed);
    if (runMax > 5 && q.speed < 0.6 * runMax) {
      drop = { ...q, runMax };
      break;
    }
  }
  const causeOf = (q) => (q.rem <= SPOT_YD ? 'spot' : q.opp <= CONTACT_M ? 'opponent_contact' : q.mate <= CONTACT_M ? 'teammate_contact' : 'open_field');
  const step = Math.max(1, Math.round(r.hz / 10));
  return {
    index,
    id: item.play.id,
    event: item.play.event_type,
    team,
    carrier: r.carrierId,
    gain_yd: round(Math.abs((r.expectEndX ?? frames[0].x) - frames[0].x), 1),
    peak_mps: round(peak),
    speed_after_start_mps: { '0.5s': speedAfter(0.5), '1s': speedAfter(1), '2s': speedAfter(2) },
    first_drop: drop && {
      t: round(drop.t),
      run_max_mps: round(drop.runMax),
      speed_mps: round(drop.speed),
      rem_yd: round(drop.rem, 1),
      nearest_opponent_m: round(drop.opp),
      nearest_teammate_m: round(drop.mate),
      cause: causeOf(drop),
    },
    // runs only: frames after the snap with a teammate touching the carrier (the mesh and the handoff)
    tackle,
    recorded_gain_yd: round(recordedGain, 1),
    physics_gain_yd: round(physicsGain, 1),
    gain_error_yd: round(physicsGain - recordedGain, 1),
    breakaway_nearest_defender_m: round(breakawayMin),
    mate_overlap_frames: item.play.event_type === 'run' ? frames.filter((q) => q.t > 0 && q.mate < 0.6).length : null,
    trace_t0: round(r.t0),
    speed_trace_10hz_mps: frames.filter((_, i) => i % step === 0).map((q) => round(q.speed)),
  };
}

function summarize(rows, total) {
  const ok = rows.filter((row) => row.peak_mps != null);
  const peaks = ok.map((row) => row.peak_mps);
  const runs = ok.filter((row) => row.event === 'run');
  const fast = ok.filter((row) => row.peak_mps >= FAST_MPS);
  const causes = (list) => list.reduce((acc, row) => {
    if (row.first_drop) acc[row.first_drop.cause] = (acc[row.first_drop.cause] ?? 0) + 1;
    return acc;
  }, {});
  return {
    plays_total: total,
    carrier_plays: ok.length,
    failed_plays: rows.filter((row) => row.error).length,
    peak_speed_mps: { p10: quantile(peaks, 0.1), median: quantile(peaks, 0.5), p90: quantile(peaks, 0.9), max: round(Math.max(...peaks)) },
    run_peak_median_mps: median(runs.map((row) => row.peak_mps)),
    fast_carriers: fast.length,
    fast_carriers_first_drop_cause: causes(fast),
    first_drop_cause_all_carriers: causes(ok),
    run_plays_with_mate_overlap: runs.filter((row) => row.mate_overlap_frames > 0).length,
    run_recorded_gain_yd_mean: mean(runs.map((row) => row.recorded_gain_yd)),
    run_physics_gain_yd_mean: mean(runs.map((row) => row.physics_gain_yd)),
    run_gain_error_yd_median_abs: median(runs.map((row) => Math.abs(row.gain_error_yd))),
    run_gain_error_yd_p90_abs: quantile(runs.map((row) => Math.abs(row.gain_error_yd)), 0.9),
    runs_20plus_yd_recorded: runs.filter((row) => row.recorded_gain_yd >= 20).length,
    runs_20plus_yd_physics: runs.filter((row) => row.physics_gain_yd >= 20).length,
    tackles: ok.filter((row) => row.tackle).length,
    tackle_yd_from_spot_median: median(ok.filter((row) => row.tackle?.rem_yd != null).map((row) => Math.abs(row.tackle.rem_yd))),
    tackle_within_2yd_of_spot: ok.filter((row) => row.tackle?.rem_yd != null && Math.abs(row.tackle.rem_yd) <= 2).length,
    tackle_defenders_within_3m_median: median(ok.filter((row) => row.tackle).map((row) => row.tackle.defenders_within_3m)),
    breakaway_nearest_defender_m_median: median(ok.filter((row) => row.peak_mps >= 8 && row.breakaway_nearest_defender_m != null).map((row) => row.breakaway_nearest_defender_m)),
    run_mate_overlap_seconds: round(runs.reduce((sum, row) => sum + row.mate_overlap_frames, 0) / 30, 2),
  };
}

async function capture(args) {
  const root = path.resolve(flag(args, '--root', path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')));
  const recordPath = flag(args, '--record');
  const outPath = flag(args, '--out');
  if (!recordPath || !outPath) throw new Error('usage: --record <envelope.json> --out <capture.json> [--label name] [--root engine checkout]');
  const label = flag(args, '--label', path.basename(root));
  const api = {
    ...(await import(pathToFileURL(path.join(root, 'web/slc-seed-physics-replay.js')).href)),
    ...(await import(pathToFileURL(path.join(root, 'web/prototype-execution.js')).href)),
  };
  api.authority = flag(args, '--authority', 'statistical_replay');
  const envelope = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  const record = envelope.record ?? envelope;
  const rosterPath = flag(args, '--roster', path.join(root, 'data/teams/league-ratings-2026-week7.json'));
  const model = api.prepareSlcPhysicsReplay(record, JSON.parse(fs.readFileSync(rosterPath, 'utf8')));
  const items = record.drives.flatMap((drive) => drive.plays.map((play) => ({ play, drive })));
  const rows = items.map((item, index) => capturePlay(item, index, model, api)).filter(Boolean);
  const capture = {
    schema: 'gridiron.movement-capture.v1',
    authority: api.authority,
    label,
    engine_root: root,
    record: path.basename(recordPath),
    summary: summarize(rows, items.length),
    plays: rows,
  };
  fs.writeFileSync(outPath, JSON.stringify(capture));
  console.log(`${label}: ${rows.length} carrier plays of ${items.length}; wrote ${outPath}`);
  console.log(JSON.stringify(capture.summary, null, 1));
}

function compare(aPath, bPath) {
  const load = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
  const [a, b] = [load(aPath), load(bPath)];
  const flat = (obj, prefix = '') => Object.entries(obj).flatMap(([key, value]) => (
    value && typeof value === 'object' && !Array.isArray(value) ? flat(value, `${prefix}${key}.`) : [[`${prefix}${key}`, JSON.stringify(value)]]
  ));
  const fa = new Map(flat(a.summary)), fb = new Map(flat(b.summary));
  console.log(`${'metric'.padEnd(46)} ${a.label.padStart(20)} ${b.label.padStart(20)}`);
  for (const key of new Set([...fa.keys(), ...fb.keys()])) {
    console.log(`${key.padEnd(46)} ${(fa.get(key) ?? '-').padStart(20)} ${(fb.get(key) ?? '-').padStart(20)}`);
  }
}

const args = process.argv.slice(2);
if (args[0] === '--compare') compare(args[1], args[2]);
else await capture(args);
