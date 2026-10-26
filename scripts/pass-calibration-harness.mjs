// Calibration harness for the Stage One pass engine. Fixed-seed dropbacks over field position, protection, front and coverage.
// Use separate seed prefixes for tuning (tune) and untouched evaluation (eval); evaluate once per change.
// Calibration harness for the Stage One QB work.
// Usage: node harness.mjs <engine root> <tune|eval> [seedsPerCell]
// Fixed-seed dropbacks over field position, protection, front and coverage.
// Tuning and evaluation seed sets never overlap; evaluation is run once per change.
import { pathToFileURL } from 'node:url';

const root = process.argv[2];
const set = process.argv[3] ?? 'tune';
const perCell = Number(process.argv[4] ?? 30);
const { simulatePassPlay } = await import(pathToFileURL(`${root}/engine/autonomous/passing.js`).href);

const LOS = [20, 35, 50, 65, 80];
const FRONTS = ['nickel_over', 'nickel_under'];
const COVERAGES = ['cover_1', 'cover_3'];
const PROTECTION = {
  default: undefined,
  weak: Object.fromEntries(['LT', 'LG', 'C', 'RG', 'RT'].map((s) => [`O.${s}`, { PBK: 40, RBK: 40, STR: 45 }])),
  strong: Object.fromEntries(['LT', 'LG', 'C', 'RG', 'RT'].map((s) => [`O.${s}`, { PBK: 85, RBK: 85, STR: 85 }])),
};

const blank = () => ({ dropbacks: 0, unresolved: 0, defensiveTouchdowns: 0, targets: {}, throws: 0, completions: 0, interceptions: 0, sacks: 0, touchdowns: 0,
  throwaways: 0, checkdowns: 0, throwTimes: [], yards: [], yac: [] });
const total = blank();
const byCoverage = { cover_1: blank(), cover_3: blank() };
const byProtection = Object.fromEntries(Object.keys(PROTECTION).map((k) => [k, blank()]));

let seedIndex = 0;
for (const los of LOS) for (const front of FRONTS) for (const coverage of COVERAGES) for (const [pname, overrides] of Object.entries(PROTECTION)) {
  for (let i = 0; i < perCell; i++) {
    const seed = `${set}-${seedIndex++}`;
    const cfg = {
      seed, front, coverage, los, dir: 1, ballY: 26.667,
      direction: i % 2 ? 'left' : 'right',
      qbPolicy: process.env.QB_POLICY ?? 'stage_one',
      priorMode: process.env.PRIOR_MODE ?? 'exact',
      qbParts: (process.env.QB_PARTS ?? '').split(',').filter(Boolean),
      visionModel: process.env.VISION_MODEL ?? 'chest',
      ...(overrides ? { ratingOverrides: overrides } : {}),
    };
    const run = simulatePassPlay(cfg);
    if (!run.resolved || !run.terminal) {
      for (const bucket of [total, byProtection[pname], byCoverage[coverage]]) bucket.unresolved++;
      continue;
    }
    for (const bucket of [total, byProtection[pname], byCoverage[coverage]]) {
      bucket.dropbacks++;
      const throwEv = run.events.find((e) => e.type === 'throw');
      const snap = run.events.find((e) => e.type === 'snap');
      if (throwEv) {
        bucket.throws++;
        bucket.throwTimes.push(throwEv.t - (snap?.t ?? 0));
        if (throwEv.target_id === 'O.RB') bucket.checkdowns++;
        bucket.targets[throwEv.target_id] = (bucket.targets[throwEv.target_id] ?? 0) + 1;
      }
      if (run.events.some((e) => e.type === 'throw_away')) bucket.throwaways++;
      if (run.terminal.reason === 'sack') bucket.sacks++;
      if (run.interception_id) bucket.interceptions++;
      // A defensive touchdown after an interception is not an offensive passing touchdown.
      if (run.terminal.reason === 'touchdown') {
        if (run.possession_team === 'D') bucket.defensiveTouchdowns++;
        else bucket.touchdowns++;
      }
      const caught = run.events.find((e) => e.type === 'catch' && String(e.player_id).startsWith('O.'));
      if (caught) {
        bucket.completions++;
        bucket.yards.push(run.terminal.yards_gained);
        const dir = cfg.dir;
        bucket.yac.push(run.terminal.yards_gained - (caught.at.x - los) * dir);
      }
    }
  }
}

const pct = (n, d) => (d ? Number((100 * n / d).toFixed(1)) : null);
const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return Number(s[Math.floor(s.length / 2)].toFixed(2)); };
const mean = (a) => (a.length ? Number((a.reduce((x, y) => x + y, 0) / a.length).toFixed(2)) : null);
const summarize = (b) => ({
  dropbacks: b.dropbacks,
  unresolved: b.unresolved,
  unresolved_pct_of_snaps: pct(b.unresolved, b.dropbacks + b.unresolved),
  defensive_touchdowns: b.defensiveTouchdowns,
  // Attempts follow the football convention: a throwaway is an incomplete attempt, and sacks are not attempts.
  attempts: b.throws + b.throwaways,
  targets: b.targets,
  completion_pct: pct(b.completions, b.throws + b.throwaways),
  interception_pct: pct(b.interceptions, b.throws + b.throwaways),
  sack_pct_of_dropbacks: pct(b.sacks, b.dropbacks),
  td_pct_of_attempts: pct(b.touchdowns, b.throws + b.throwaways),
  throwaway_pct_of_attempts: pct(b.throwaways, b.throws + b.throwaways),
  checkdown_share_pct: pct(b.checkdowns, b.throws + b.throwaways),
  median_time_to_throw_s: med(b.throwTimes),
  yards_per_attempt: mean(b.yards.concat(Array(Math.max(0, b.throws + b.throwaways - b.completions)).fill(0))),
  median_yac: med(b.yac),
});
console.log(JSON.stringify({ engine: root.split('/').slice(-2).join('/'), set, perCell, total: summarize(total),
  byCoverage: Object.fromEntries(Object.entries(byCoverage).map(([k, v]) => [k, summarize(v)])),
  byProtection: Object.fromEntries(Object.entries(byProtection).map(([k, v]) => [k, summarize(v)])) }, null, 1));
