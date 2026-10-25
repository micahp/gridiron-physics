// Read-only seed-level YAC diagnostic on the harness tuning seeds (default protection only).
// Usage: node yac-seed-report.mjs <engine root> [seedsPerCell] [topN]
import { pathToFileURL } from 'node:url';

const root = process.argv[2];
const perCell = Number(process.argv[3] ?? 10);
const topN = Number(process.argv[4] ?? 20);
const { simulatePassPlay } = await import(pathToFileURL(`${root}/engine/autonomous/passing.js`).href);

const YARDS_TO_GOAL = [20, 35, 50, 65, 80];
const rows = [];
let cell = 0;
for (const yl of YARDS_TO_GOAL) for (const dir of [1, -1]) for (const front of ['nickel_over', 'nickel_under']) for (const coverage of ['cover_1', 'cover_3']) {
  for (let i = 0; i < perCell; i++) {
    const seed = `tune-${cell}-${i}`;
    const los = dir === 1 ? 100 - yl : yl;
    const cfg = { seed, front, coverage, los, dir, ballY: 26.667, direction: i % 2 ? 'left' : 'right' };
    const run = simulatePassPlay(cfg);
    if (!run.resolved || !run.terminal) continue;
    const caught = run.events.find((e) => e.type === 'catch' && String(e.player_id).startsWith('O.'));
    if (!caught) continue;
    const roster = run.roster;
    const cIdx = roster.findIndex((p) => p.id === caught.player_id);
    const frameAt = (t) => run.frames[Math.max(0, Math.min(run.frames.length - 1, Math.round((t - run.t0) * run.hz)))];
    const gapAt = (t) => {
      const f = frameAt(t);
      let best = { d: Infinity, id: null };
      roster.forEach((p, i) => {
        if (p.team !== 'D') return;
        const dx = f[i * 6] - f[cIdx * 6], dy = f[i * 6 + 1] - f[cIdx * 6 + 1]; // frames store yards
        const d = Math.hypot(dx, dy);
        if (d < best.d) best = { d, id: p.id };
      });
      return best;
    };
    const catchT = caught.time;
    const whistle = run.events.find((e) => e.type === 'whistle');
    const afterCatch = run.events.filter((e) => e.time !== undefined && e.time > catchT);
    const contact = run.events.find((e) => (e.type === 'tackle_start' || e.type === 'tackle_attempt' || e.type === 'contact') && e.t > catchT);
    const catchGap = gapAt(catchT);
    const gapAt1 = gapAt(catchT + 1);
    const airYards = (caught.at.x - los) * dir;
    const yac = run.terminal.yards_gained - airYards;
    const defendersWithin3AtCatch = roster.filter((p, i) => p.team === 'D' && Math.hypot(
      (run.frames[Math.round((catchT - run.t0) * run.hz)][i * 6] - run.frames[Math.round((catchT - run.t0) * run.hz)][cIdx * 6]),
      (run.frames[Math.round((catchT - run.t0) * run.hz)][i * 6 + 1] - run.frames[Math.round((catchT - run.t0) * run.hz)][cIdx * 6 + 1])) <= 3).length;
    rows.push({
      seed, dir, los, catchDepth: Number(airYards.toFixed(2)), yac: Number(yac.toFixed(2)), total: Number(run.terminal.yards_gained.toFixed(2)),
      reason: run.terminal.reason, carrier: caught.player_id,
      nearestDefAtCatch: catchGap.id, gapAtCatch: Number(catchGap.d.toFixed(2)),
      gapOneSecondLater: Number(gapAt1.d.toFixed(2)), defendersWithin3AtCatch,
      secondsToFirstContact: contact ? Number((contact.t - catchT).toFixed(2)) : null,
      brokenTacklesAfterCatch: run.events.filter((e) => e.type === 'broken_tackle' && e.t > catchT).length,
      secondsCatchToWhistle: whistle ? Number((whistle.t - catchT).toFixed(2)) : null,
      targetWasCarrier: run.events.some((e) => e.type === 'throw' && e.target_id === caught.player_id),
    });
  }
  cell++;
}

const sorted = [...rows].sort((a, b) => b.yac - a.yac);
const top = sorted.slice(0, topN);
const med = (k) => { const a = rows.map((r) => r[k]).filter((v) => v != null).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : null; };
const summary = {
  engine: root.split('/').slice(-2).join('/'),
  completions: rows.length,
  medianYac: med('yac'), medianCatchDepth: med('catchDepth'), medianGapAtCatch: med('gapAtCatch'),
  medianGapOneSecondLater: med('gapOneSecondLater'), medianSecondsToContact: med('secondsToFirstContact'),
  medianSecondsCatchToWhistle: med('secondsCatchToWhistle'),
  shareYacOver20: Number((100 * rows.filter((r) => r.yac > 20).length / Math.max(1, rows.length)).toFixed(1)),
  shareNoContactAfterCatchPct: Number((100 * rows.filter((r) => r.secondsToFirstContact == null).length / Math.max(1, rows.length)).toFixed(1)),
  yacOverTwentyWithNoDefenderWithin3AtCatch: rows.filter((r) => r.yac > 20 && r.defendersWithin3AtCatch === 0).length,
  longYacWhereNearestDefenderNeverClosedBelow2yd: rows.filter((r) => r.yac > 20 && r.gapOneSecondLater > 2).length,
};
console.log(JSON.stringify({ summary, top20YacPlays: top }, null, 1));
