// Calibration harness for the Stage One pass engine.
// Usage: node scripts/pass-calibration-harness.mjs <engine root> <tune|eval> [seedsPerCell]
//
// Fixed-seed dropbacks over field position (yards to opponent goal), both directions,
// fronts, coverages and protection levels. The same seed is used across protection
// levels so the comparison is paired. Every dropback is counted: unresolved plays
// appear as their own line instead of disappearing from the totals.
// Tuning and evaluation use separate seed prefixes; evaluate once per change.
import { pathToFileURL } from 'node:url';

const root = process.argv[2];
const set = process.argv[3] ?? 'tune';
const perCell = Number(process.argv[4] ?? 30);
const { simulatePassPlay } = await import(pathToFileURL(`${root}/engine/autonomous/passing.js`).href);

const YARDS_TO_GOAL = [20, 35, 50, 65, 80];
const DIRECTIONS = [1, -1];
const FRONTS = ['nickel_over', 'nickel_under'];
const COVERAGES = ['cover_1', 'cover_3'];
const PROTECTION = {
  default: undefined,
  weak: Object.fromEntries(['LT', 'LG', 'C', 'RG', 'RT'].map((s) => [`O.${s}`, { PBK: 40, RBK: 40, STR: 45 }])),
  strong: Object.fromEntries(['LT', 'LG', 'C', 'RG', 'RT'].map((s) => [`O.${s}`, { PBK: 85, RBK: 85, STR: 85 }])),
};

const blank = () => ({
  dropbacks: 0, unresolved: 0, throws: 0, throwaways: 0, completions: 0, interceptions: 0, sacks: 0,
  offenseTouchdowns: 0, pickSixes: 0, checkdowns: 0, throwTimes: [], yards: [], yac: [],
});
const total = blank();
const byProtection = Object.fromEntries(Object.keys(PROTECTION).map((k) => [k, blank()]));

let cell = 0;
for (const yl of YARDS_TO_GOAL) for (const dir of DIRECTIONS) for (const front of FRONTS) for (const coverage of COVERAGES) {
  for (let i = 0; i < perCell; i++) {
    const seed = `${set}-${cell}-${i}`;
    const los = dir === 1 ? 100 - yl : yl;
    for (const [pname, overrides] of Object.entries(PROTECTION)) {
      const cfg = {
        seed, front, coverage, los, dir, ballY: 26.667,
        direction: i % 2 ? 'left' : 'right',
        ...(overrides ? { ratingOverrides: overrides } : {}),
      };
      const bucket = byProtection[pname];
      let run;
      try { run = simulatePassPlay(cfg); } catch (error) { run = { resolved: false, error: String(error) }; }
      for (const b of [total, bucket]) {
        b.dropbacks++;
        if (!run.resolved || !run.terminal) { b.unresolved++; continue; }
        const throwEv = run.events.find((e) => e.type === 'throw');
        const snap = run.events.find((e) => e.type === 'snap');
        const throwAway = run.events.some((e) => e.type === 'throw_away');
        if (throwAway) b.throwaways++;
        if (throwEv) {
          b.throws++;
          b.throwTimes.push(throwEv.t - (snap?.t ?? 0));
          if (throwEv.target_id === 'O.RB') b.checkdowns++;
        }
        if (run.terminal.reason === 'sack') b.sacks++;
        if (run.interception_id) b.interceptions++;
        if (run.terminal.reason === 'touchdown') {
          if (run.possession_team === 'O') b.offenseTouchdowns++; else b.pickSixes++;
        }
        const caught = run.events.find((e) => e.type === 'catch' && String(e.player_id).startsWith('O.'));
        if (caught) {
          b.completions++;
          b.yards.push(run.terminal.yards_gained);
          b.yac.push(run.terminal.yards_gained - (caught.at.x - los) * dir);
        }
      }
    }
  }
  cell++;
}

const pct = (n, d) => (d ? Number((100 * n / d).toFixed(1)) : null);
const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return Number(s[Math.floor(s.length / 2)].toFixed(2)); };
const summarize = (b) => {
  const attempts = b.throws + b.throwaways;
  const resolved = b.dropbacks - b.unresolved;
  return {
    dropbacks: b.dropbacks,
    unresolved: b.unresolved,
    attempts,
    completion_pct: pct(b.completions, attempts),
    interception_pct: pct(b.interceptions, attempts),
    sack_pct_of_dropbacks: pct(b.sacks, b.dropbacks),
    offense_td_pct_of_attempts: pct(b.offenseTouchdowns, attempts),
    pick_six_count: b.pickSixes,
    throwaway_pct_of_dropbacks: pct(b.throwaways, b.dropbacks),
    checkdown_share_of_throws_pct: pct(b.checkdowns, b.throws),
    median_time_to_throw_s: med(b.throwTimes),
    yards_per_attempt: b.yards.length || attempts
      ? Number(((b.yards.reduce((x, y) => x + y, 0)) / Math.max(1, attempts)).toFixed(2)) : null,
    median_yac: med(b.yac),
    resolved,
  };
};
console.log(JSON.stringify({
  engine: root.split('/').slice(-2).join('/'), set, perCell, cells: cell,
  total: summarize(total),
  byProtection: Object.fromEntries(Object.entries(byProtection).map(([k, v]) => [k, summarize(v)])),
}, null, 1));
