import assert from 'node:assert/strict';
import { simulateAutonomousPlay } from '../engine/autonomous/simulator.js';
import { retroDecisionInterval } from '../engine/autonomous/retro-cadence.js';
import { createPassRoster } from '../engine/autonomous/passing.js';
import { exampleAssignments } from '../engine/autonomous/example-assignments.js';
import { buildSampleCall } from './autonomous-fixtures.mjs';

assert.ok(retroDecisionInterval(99) < retroDecisionInterval(50));
assert.ok(retroDecisionInterval(50) < retroDecisionInterval(1));
assert.throws(() => retroDecisionInterval(100), /awareness/);
for (const [rating, property] of [['SPD','vmax'], ['ACC','f0'], ['AGI','alat'], ['STR','drive']]) {
  const roster = (value) => createPassRoster({ratingOverrides: {'O.WR2': {[rating]: value}}}).find((p) => p.roleKey === 'O.WR2');
  assert.ok(roster(95).physics[property] > roster(10).physics[property], `${rating} must increase ${property}`);
}
function call() {
  const c = buildSampleCall({family:'pass',concept:'assigned',snap_type:'shotgun',coverage:'cover_3'});
  c.assignments = exampleAssignments('slant_flat','zone');
  return c;
}
for (const name of ['IBL', 'BCV', 'TRK', 'CIT']) {
  const c = call(); c.player_profiles[c.offense.lineup.WR1].ratings[name] = 70;
  assert.throws(() => simulateAutonomousPlay(c), /not used by assigned passing/);
}
for (const name of ['height', 'radius', 'vmax', 'f0', 'drive', 'alat', 'reach']) {
  const c = call(); c.player_profiles[c.offense.lineup.WR1].physics[name] = 5;
  assert.throws(() => simulateAutonomousPlay(c), /unsupported physical parameter/);
}
const low = call(), high = structuredClone(low);
const qb = low.offense.lineup.QB, db = low.defense.lineup.LCB;
low.player_profiles[qb].ratings.AWR = 10; high.player_profiles[qb].ratings.AWR = 95;
low.player_profiles[db].ratings.PRC = 10; high.player_profiles[db].ratings.PRC = 95;
const a = simulateAutonomousPlay(low), b = simulateAutonomousPlay(high);
assert.ok(a.diagnostics.cadence[qb].interval_seconds > b.diagnostics.cadence[qb].interval_seconds);
assert.ok(a.diagnostics.cadence[db].interval_seconds > b.diagnostics.cadence[db].interval_seconds);
assert.ok(a.diagnostics.cadence[qb].interrupts >= 2, 'snap and possession changes interrupt cadence');
assert.equal(a.events.at(-1).type, 'whistle');
assert.ok(a.events.at(-1).t <= a.result.elapsed_seconds + 0.001);

// Same seed, same acceleration. Explicit throw accuracy alone changes the
// released throw's error distribution. Search deterministic seeds until a throw.
let verified = false;
for (let seed = 1; seed <= 16 && !verified; seed++) {
  const inaccurate = call(), accurate = call();
  inaccurate.seed = accurate.seed = String(seed);
  inaccurate.player_profiles[qb].ratings.THA = 10;
  accurate.player_profiles[qb].ratings.THA = 95;
  const left = simulateAutonomousPlay(inaccurate), right = simulateAutonomousPlay(accurate);
  const l = left.events.find((e) => e.type === 'throw'), r = right.events.find((e) => e.type === 'throw');
  if (l && r) {
    assert.equal(l.target_id, r.target_id);
    assert.ok(l.accuracy_sigma_yards > r.accuracy_sigma_yards);
    assert.equal(l.accuracy_rating, 10); assert.equal(r.accuracy_rating, 95);
    verified = true;
  }
}
assert.ok(verified, 'at least one controlled throw');
for (const acceleration of [10, 95]) {
  const c = call(); c.seed = '1'; c.player_profiles[qb].ratings.ACC = acceleration;
  const event = simulateAutonomousPlay(c).events.find((e) => e.type === 'throw');
  if (event) assert.equal(event.accuracy_rating, 70, 'ACC does not set throw accuracy');
}
for (const variant of [buildSampleCall(), call()]) {
  const full = simulateAutonomousPlay(variant);
  const lean = simulateAutonomousPlay({...variant, output_mode:'result_only'});
  assert.deepEqual(lean.result, full.result);
  assert.deepEqual(lean.events, full.events);
  assert.deepEqual(lean.participants, full.participants);
  assert.equal(lean.trajectory.frames, null);
  assert.equal(lean.diagnostics.physical_warnings, null);
  assert.equal(lean.diagnostics.reconciliation.ok, true);
  assert.equal(lean.diagnostics.reconciliation.scope, 'events_only_no_frame_checks');
}
console.log('retro cadence, interrupt, independent throw accuracy and result-only parity passed');
