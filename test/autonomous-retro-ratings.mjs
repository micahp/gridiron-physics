// Matched-seed interaction fixtures. Authored ratings, no NFL calibration.
import assert from 'node:assert/strict';
import { simulateAutonomousPlay } from '../engine/autonomous/simulator.js';
import { tackleFinishChance } from '../engine/autonomous/passing.js';
import { exampleAssignments } from '../engine/autonomous/example-assignments.js';
import { buildSampleCall } from './autonomous-fixtures.mjs';
function run(attribute, value, seed) {
  const call = buildSampleCall({family:'pass',concept:'assigned',snap_type:'shotgun',coverage:'cover_3'});
  call.seed = String(seed);
  call.assignments = exampleAssignments('slant_flat','zone');
  const offensive = ['PBK','RBK','BTK','ELU','CAR','CTH'].includes(attribute);
  for (const [id, profile] of Object.entries(call.player_profiles)) {
    if ((id.startsWith('ne-')) !== offensive) continue;
    if (attribute === 'RBK') delete profile.ratings.PBK; // fallback path
    if (attribute === 'CAR') delete profile.ratings.CTH; // fallback path
    if (attribute === 'ELU') profile.ratings.BTK = 1;
    if (attribute === 'BTK') profile.ratings.ELU = 1;
    if (['BSH','PMV','FMV'].includes(attribute)) for (const n of ['BSH','PMV','FMV']) profile.ratings[n] = 1;
    profile.ratings[attribute] = value;
  }
  return simulateAutonomousPlay(call);
}
const events = (r, type) => r.events.filter((e) => e.type === type);
for (const name of ['PBK','RBK','BSH','PMV','FMV']) {
  const low = run(name, 5, 1), high = run(name, 95, 1);
  assert.notDeepEqual(events(low,'block_release'), events(high,'block_release'), `${name} changes actual block releases`);
}
for (const name of ['TAK','BTK','ELU']) {
  // Hold the physical contact and every other rating fixed. Successful tackle
  // events are selection-biased and may describe different later contacts.
  const low = tackleFinishChance({
    tak: name === 'TAK' ? 5 : 70,
    btk: name === 'BTK' ? 5 : name === 'ELU' ? 5 : 70,
    strength: 0, closing: 1.5,
  });
  const high = tackleFinishChance({
    tak: name === 'TAK' ? 95 : 70,
    btk: name === 'BTK' ? 95 : name === 'ELU' ? 95 : 70,
    strength: 0, closing: 1.5,
  });
  assert.ok(name === 'TAK' ? high > low : high < low, `${name} changes the same-contact tackle chance`);
}
for (const name of ['CTH','CAR']) {
  const low = events(run(name,5,8),'catch_contest')[0];
  const high = events(run(name,95,8),'catch_contest')[0];
  assert.ok(low && high && high.chance > low.chance, `${name} changes catch odds`);
}
const firstPursuit = (r) => r.events.find((e) => e.type === 'decision' && e.assignment === 'pursue the carrier');
const lowPursuit = firstPursuit(run('PUR',5,8)), highPursuit = firstPursuit(run('PUR',95,8));
assert.ok(lowPursuit && highPursuit && highPursuit.t < lowPursuit.t, 'PUR changes pursuit timing');
console.log('matched-seed blocking, shedding, tackling, catch and pursuit rating effects passed');
