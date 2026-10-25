import assert from 'node:assert/strict';
import { simulateInsideZone } from '../engine/autonomous-run.js';
import { simulatePassPlay } from '../engine/autonomous/passing.js';

const RUN_FRONTS = ['even', 'over', 'under', 'nickel', 'odd', 'bear'];
const PASS_FRONTS = ['nickel_over', 'nickel_under'];
const FIELD_W = 53.33;

function frameAt(run, t) {
  const picks = [];
  for (const p of run.roster) {
    const path = run.trajectories[p.id];
    const sample = path.find((s) => s.t >= t - 1e-9) ?? path.at(-1);
    picks.push({ ...p, ...sample });
  }
  return picks;
}

function checkFormation(run, label, shotgun = false) {
  assert.equal(run.roster.length, 22, `${label}: 22 players`);
  assert.equal(run.roster.filter((p) => p.team === 'O').length, 11, `${label}: 11 on offense`);
  assert.equal(run.roster.filter((p) => p.team === 'D').length, 11, `${label}: 11 on defense`);
  assert.equal(new Set(run.roster.map((p) => p.id)).size, 22, `${label}: unique player ids`);
  assert.equal(new Set(run.roster.map((p) => p.slot)).size <= 22, true, `${label}: slot names are not necessarily unique across teams`);

  const at = frameAt(run, run.t0);
  for (const p of at) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `${label}: ${p.id} starts at a finite spot`);
    assert.ok(p.y >= -1e-6 && p.y <= FIELD_W + 1e-6, `${label}: ${p.id} starts inside the sideline`);
  }
  // Nobody is stacked on a teammate at the snap.
  for (let i = 0; i < at.length; i++) {
    for (let j = i + 1; j < at.length; j++) {
      if (at[i].team !== at[j].team) continue;
      const gap = Math.hypot(at[i].x - at[j].x, at[i].y - at[j].y);
      assert.ok(gap > 0.35, `${label}: ${at[i].id} and ${at[j].id} do not overlap at the snap (${gap.toFixed(2)} yd)`);
    }
  }
  // The five offensive linemen straddle the line of scrimmage.
  const los = run.line_of_scrimmage;
  for (const slot of ['LT', 'LG', 'C', 'RG', 'RT']) {
    const p = at.find((q) => q.team === 'O' && q.slot === slot);
    assert.ok(p, `${label}: ${slot} is aligned`);
    assert.ok(Math.abs(p.x - los) <= 1.5, `${label}: ${slot} is on the line (${(p.x - los).toFixed(2)} yd from LOS)`);
  }
  const qb = at.find((q) => q.team === 'O' && q.slot === 'QB');
  const depth = Math.abs(qb.x - los);
  if (shotgun) assert.ok(depth >= 3 && depth <= 8, `${label}: quarterback is in the gun (${depth.toFixed(2)} yd)`);
  else assert.ok(depth <= 2.5, `${label}: quarterback is under center (${depth.toFixed(2)} yd)`);
  const back = at.find((q) => q.team === 'O' && ['RB', 'FB'].includes(q.slot));
  assert.ok(back && Math.abs(back.x - los) > depth, `${label}: the running back is deeper than the quarterback`);
  return at;
}

for (const front of RUN_FRONTS) {
  const run = simulateInsideZone({ seed: `formation-${front}`, front, runSide: 'right' });
  assert.ok(run.resolved, `formation-${front} resolves`);
  const at = checkFormation(run, `run ${front}`);
  const defenders = at.filter((p) => p.team === 'D');
  const onLine = defenders.filter((p) => p.slot === 'NT' || /^(L|R)(DE|DT|E|T)$/.test(p.slot ?? ''));
  assert.ok(onLine.length >= 3 && onLine.length <= 6, `run ${front}: a legal number of defenders are on the line (${onLine.length})`);
}

for (const front of PASS_FRONTS) {
  for (const coverage of ['cover_1', 'cover_3']) {
    const run = simulatePassPlay({ seed: `formation-${front}-${coverage}`, front, coverage, direction: 'left' });
    assert.ok(run.resolved, `formation-${front}-${coverage} resolves`);
    const at = checkFormation(run, `pass ${front} ${coverage}`, true);
    const defenders = at.filter((p) => p.team === 'D');
    assert.equal(defenders.filter((p) => ['LEDGE', 'REDGE', 'LDT', 'RDT'].includes(p.slot)).length, 4, `${front}: four down linemen`);
    assert.ok(defenders.some((p) => p.slot === 'MLB' || p.slot === 'MIKE'), `${front}: a middle linebacker is aligned`);
    const rushers = new Set(defenders.filter((p) => ['LEDGE', 'REDGE', 'LDT', 'RDT'].includes(p.slot)).map((p) => p.id));
    assert.equal(rushers.size, 4, `${front}: distinct pass rushers`);
    const receivers = at.filter((p) => p.team === 'O' && ['WR1', 'WR2', 'WR3', 'TE'].includes(p.slot));
    assert.equal(receivers.length, 4, `${front}: four eligible receivers`);
    assert.ok(receivers.every((p) => Math.abs(p.x - run.line_of_scrimmage) <= 2.5), `${front}: receivers align near the line`);
  }
}

// The two offensive formations are shared: only the defense changes with front.
const base = frameAt(simulatePassPlay({ seed: 'formation-shared', front: 'nickel_over', coverage: 'cover_1', direction: 'right' }), 0);
const other = frameAt(simulatePassPlay({ seed: 'formation-shared', front: 'nickel_under', coverage: 'cover_3', direction: 'right' }), 0);
for (const p of base.filter((q) => q.team === 'O')) {
  const twin = other.find((q) => q.id === p.id);
  assert.ok(Math.abs(twin.x - p.x) < 1e-6 && Math.abs(twin.y - p.y) < 1e-6, `offensive alignment for ${p.id} does not depend on the defensive front`);
}

console.log('autonomous formation ok: 11v11 alignment, legal fronts, linemen on the ball, receivers eligible');
