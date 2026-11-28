// Narrow read-only audit: no new random draws or policy changes.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { World } from '../engine/world.js';
import { simulatePassPlay } from '../engine/autonomous/passing.js';
import { simulateAutonomousPlay } from '../engine/autonomous/simulator.js';
import { exampleAssignments } from '../engine/autonomous/example-assignments.js';
import { buildSampleCall } from '../test/autonomous-fixtures.mjs';
import { scenarios, tracePlay } from './audit-liquid-ai-play.mjs';

const out = process.argv[2] ?? 'audit-output';
mkdirSync(out, { recursive: true });
const defense = Object.fromEntries(['LDE','LDT','RDT','RDE','WILL','MIKE','LCB','RCB','NB','SS','FS']
  .map(role => ['D.' + role, { TAK: 99, STR: 99, PRC: 99 }]));
const rawCall = car => ({ seed: 6, front: 'nickel', coverage: 'cover_1',
  direction: 'right', dir: 1, los: 40, ballY: 26.67, resultOnly: true,
  ratingOverrides: { ...Object.fromEntries(['QB','RB','TE','WR1','WR2','WR3']
    .map(role => ['O.' + role, { CAR: car }])), ...defense } });
function auditLegacy(car) {
  const control = simulatePassPlay(rawCall(car));
  const reasons = [];
  const prior = World.prototype.auditDecision;
  World.prototype.auditDecision = function(type, data) {
    if (type === 'forced_fumble_draw') reasons.push({ t_s: this.t, ...data });
  };
  let result;
  try { result = simulatePassPlay(rawCall(car)); }
  finally {
    if (prior === undefined) delete World.prototype.auditDecision;
    else World.prototype.auditDecision = prior;
  }
  assert.deepEqual(result.terminal, control.terminal);
  assert.deepEqual(result.fumble, control.fumble);
  assert.deepEqual(result.events, control.events);
  assert.ok(reasons.length, 'legacy tackle fixture must reach an actual fumble opportunity');
  for (const row of reasons) assert.equal(row.success, row.draw < row.chance);
  return { car, terminal: result.terminal, fumble: result.fumble, draws: reasons,
    events: result.events.filter(e => ['catch','tackle_attempt','broken_tackle','fumble','fumble_recovery','whistle'].includes(e.type)) };
}
const legacy = [auditLegacy(1), auditLegacy(99)];
const [low, high] = legacy.map(r => r.draws[0]);
assert.equal(low.player_id, high.player_id);
assert.equal(low.carrier_id, high.carrier_id);
assert.equal(low.t_s, high.t_s);
assert.equal(low.force, high.force);
assert.equal(low.draw, high.draw, 'same pre-contact RNG state');
assert.equal(low.security, 1);
assert.equal(high.security, 99);
assert.ok(low.chance > high.chance, 'lower carrying skill must increase chance at identical contact');
console.log('LEGACY_FUMBLE_DRAW ' + JSON.stringify(legacy));

const calls = scenarios().filter(c => c.play_id?.endsWith('four-verticals'));
const catchCall = buildSampleCall({ family:'pass', concept:'assigned', snap_type:'shotgun', coverage:'cover_3' });
catchCall.play_id = 'liquid-audit:possession-support-catch';
catchCall.seed = '0';
catchCall.assignments = exampleAssignments('slant_flat','zone');
catchCall.player_evaluation_mode = 'shared_snapshot';
calls.push(catchCall);
const intCall = buildSampleCall({ family:'pass', concept:'assigned', snap_type:'shotgun', coverage:'cover_1' });
intCall.play_id = 'liquid-audit:possession-support-interception';
intCall.seed = '15';
intCall.assignments = exampleAssignments('four_verticals','man');
intCall.player_evaluation_mode = 'shared_snapshot';
for (const [id, profile] of Object.entries(intCall.player_profiles)) {
  if (id.startsWith('chi-')) Object.assign(profile.ratings, { CTH:99, PRC:99, SPD:99 });
  else profile.ratings.CTH = 1;
}
calls.push(intCall);
const possession = [];
for (const call of calls) {
  const control = simulateAutonomousPlay(call);
  const trace = tracePlay(call);
  assert.deepEqual(trace.record.result, control.result);
  assert.deepEqual(trace.record.events, control.events);
  assert.deepEqual(trace.record.diagnostics.reconciliation, control.diagnostics.reconciliation);
  const acquisition = trace.record.events.find(e => ['catch','interception'].includes(e.type));
  const reasons = [...trace.ticks.flatMap(t => t.reasons), ...trace.outside_tick_reasons]
    .filter(r => r.type === 'possession_pursuit');
  const firstByPlayer = new Map();
  for (const row of reasons) {
    assert.ok(row.t_s + 1e-8 >= row.carrier_since_s);
    if (!firstByPlayer.has(row.player_id)) firstByPlayer.set(row.player_id, row);
  }
  // No requirement that old authored interception still occurs: expose loss of
  // coverage explicitly instead of silently choosing a convenient new seed.
  const rows = [...firstByPlayer.values()].map(row => {
    const sighting = trace.ticks.flatMap(t => t.memory).filter(m =>
      m.observer === row.player_id && m.target === row.carrier_id && m.op === 'estimate' &&
      m.result && m.at_s <= row.t_s + 1e-8 && m.result.observedAt >= row.carrier_since_s - 1e-8).at(-1);
    return { ...row, reaction_s: row.t_s-row.carrier_since_s,
      delivered_carrier_estimate: sighting?.result ?? null };
  });
  const summary = { id:call.play_id, seed:call.seed, result:trace.record.result, acquisition:acquisition??null,
    pursuit_decisions:reasons.length, first_pursuit_by_player:rows,
    direct_truth_without_delivered_estimate:rows.filter(r=>r.target_source==='live_carrier_truth' && !r.delivered_carrier_estimate).length };
  possession.push(summary);
  console.log('POST_POSSESSION_AUDIT '+JSON.stringify(summary));
}
assert.ok(possession.some(r => r.acquisition?.type === 'catch' && r.pursuit_decisions > 0),
  'at least one pinned case must exercise actual post-catch pursuit');
writeFileSync(join(out,'possession-role-audit.json'),JSON.stringify({legacy,possession},null,2));
