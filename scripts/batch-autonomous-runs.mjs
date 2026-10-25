#!/usr/bin/env node
// Frozen batch audit over ordinary, supported snap inputs for both play
// families. Every play is executed by the autonomous executor; nothing here
// supplies a gain, a spot or a tackler.
import { simulateInsideZone } from '../engine/autonomous-run.js';
import { simulatePassPlay } from '../engine/autonomous/passing.js';

const RUN_FRONTS = ['even', 'over', 'under', 'nickel', 'odd', 'bear'];
const PASS_FRONTS = ['nickel_over', 'nickel_under'];
const PASS_COVERAGES = ['cover_1', 'cover_3'];
const RUN_TOTAL = 160;
const PASS_TOTAL = 80;

const stats = {
  attempted: RUN_TOTAL + PASS_TOTAL,
  completed: 0,
  technical_failures: 0,
  exceptions: 0,
  byFamily: {
    run: { attempted: RUN_TOTAL, completed: 0, endings: {}, yards: [], durations: [] },
    pass: { attempted: PASS_TOTAL, completed: 0, endings: {}, yards: [], durations: [], throws: 0, catches: 0, interceptions: 0, sacks: 0 },
  },
  blocks: { engagements: 0, sheds: 0, won: 0, total: 0 },
  contact: { broken_tackles: 0, tackles: 0 },
  handoff_seconds: [],
  first_contact_seconds: [],
  warnings: 0,
  wall_ms: 0,
};
const failures = [];

function summarize(family, run) {
  const bucket = stats.byFamily[family];
  if (!run.resolved || !run.terminal) {
    stats.technical_failures++;
    failures.push({ family, seed: run.seed, failure: run.failure });
    return;
  }
  stats.completed++;
  bucket.completed++;
  bucket.endings[run.terminal.reason] = (bucket.endings[run.terminal.reason] ?? 0) + 1;
  bucket.yards.push(run.terminal.yards_gained);
  bucket.durations.push(run.terminal.time);

  const events = run.events;
  stats.blocks.engagements += events.filter((e) => e.type === 'block_engage').length;
  stats.blocks.sheds += events.filter((e) => e.type === 'shed').length;
  stats.blocks.won += (run.blockers ?? []).filter((b) => b.won).length;
  stats.blocks.total += (run.blockers ?? []).length;
  stats.contact.broken_tackles += events.filter((e) => e.type === 'broken_tackle').length;
  stats.contact.tackles += events.filter((e) => e.type === 'tackle' || e.type === 'sack').length;
  const handoff = events.find((e) => e.type === 'handoff');
  if (handoff) stats.handoff_seconds.push(handoff.t);
  const firstContact = events.find((e) => e.type === 'contact');
  if (firstContact) stats.first_contact_seconds.push(firstContact.t);
  if (family === 'pass') {
    if (events.some((e) => e.type === 'throw')) bucket.throws++;
    if (events.some((e) => e.type === 'catch')) bucket.catches++;
    if (events.some((e) => e.type === 'interception')) bucket.interceptions++;
    if (events.some((e) => e.type === 'sack')) bucket.sacks++;
  }
  // Physical warnings: non-finite state, or a player jumping further than a
  // body can travel between recorded frames.
  for (const player of run.roster) {
    const path = run.trajectories[player.id];
    for (let i = 1; i < path.length; i++) {
      const jump = Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
      if (!Number.isFinite(jump) || jump > 1.2) stats.warnings++;
    }
  }
}

const started = Date.now();
for (let i = 0; i < RUN_TOTAL; i++) {
  const config = {
    seed: `autonomous-batch-${String(i + 1).padStart(3, '0')}`,
    front: RUN_FRONTS[i % RUN_FRONTS.length],
    runSide: i % 2 ? 'right' : 'left',
    dir: i % 4 < 2 ? 1 : -1,
    los: 20 + (i * 17 % 61),
    ballY: [23.583, 26.667, 29.75][i % 3],
  };
  try { summarize('run', simulateInsideZone(config)); }
  catch (error) { stats.exceptions++; failures.push({ family: 'run', seed: config.seed, error: String(error) }); }
}
for (let i = 0; i < PASS_TOTAL; i++) {
  const config = {
    seed: `autonomous-pass-batch-${String(i + 1).padStart(3, '0')}`,
    front: PASS_FRONTS[i % PASS_FRONTS.length],
    coverage: PASS_COVERAGES[i % PASS_COVERAGES.length],
    direction: i % 2 ? 'right' : 'left',
    dir: i % 4 < 2 ? 1 : -1,
    los: 20 + (i * 11 % 61),
    ballY: [23.583, 26.667, 29.75][i % 3],
  };
  try { summarize('pass', simulatePassPlay(config)); }
  catch (error) { stats.exceptions++; failures.push({ family: 'pass', seed: config.seed, error: String(error) }); }
}
stats.wall_ms = Date.now() - started;

const pct = (n, d) => (d ? Math.round((1000 * n) / d) / 10 : 0);
const mean = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);
const spread = (xs) => (xs.length ? {
  min: Math.min(...xs), p25: quantile(xs, 0.25), median: quantile(xs, 0.5), p75: quantile(xs, 0.75), max: Math.max(...xs),
} : null);
function quantile(xs, q) {
  const sorted = [...xs].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return Math.round((sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)) * 100) / 100;
}

const report = {
  attempted: stats.attempted,
  completed: stats.completed,
  completion_rate_pct: pct(stats.completed, stats.attempted),
  technical_failures: stats.technical_failures,
  exceptions: stats.exceptions,
  legality_gate_pct: 99,
  legality_gate_passed: pct(stats.completed, stats.attempted) >= 99,
  endings: stats.byFamily.run.endings,
  pass_endings: stats.byFamily.pass.endings,
  pass: {
    throws: stats.byFamily.pass.throws,
    catches: stats.byFamily.pass.catches,
    interceptions: stats.byFamily.pass.interceptions,
    sacks: stats.byFamily.pass.sacks,
  },
  yards: { run: spread(stats.byFamily.run.yards), pass: spread(stats.byFamily.pass.yards) },
  duration_seconds: { run: spread(stats.byFamily.run.durations), pass: spread(stats.byFamily.pass.durations) },
  handoff_seconds: spread(stats.handoff_seconds),
  first_contact_seconds: spread(stats.first_contact_seconds),
  blocks: {
    engagements: stats.blocks.engagements,
    sheds: stats.blocks.sheds,
    blocker_win_rate_pct: pct(stats.blocks.won, stats.blocks.total),
  },
  contact: stats.contact,
  movement_warnings: stats.warnings,
  execution_ms: stats.wall_ms,
  failures,
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

if (stats.exceptions > 0) process.exitCode = 1;
if (stats.completed + stats.technical_failures + stats.exceptions !== stats.attempted) process.exitCode = 1;
if (!report.legality_gate_passed) process.exitCode = 1;
if (stats.warnings > 0) process.exitCode = 1;
