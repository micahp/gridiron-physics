import assert from 'node:assert/strict';
import { ENGINE_IDS } from './simulation.mjs';
import { RESEARCH_FIXTURES, runResearchFixture } from './interface.mjs';

assert.deepEqual(RESEARCH_FIXTURES.m1b, ['successful-tackle', 'broken-tackle', 'missed-tackle']);
const expected = new Map([
  ['successful-tackle', 'successful_tackle'],
  ['broken-tackle', 'broken_tackle'],
  ['missed-tackle', 'missed_tackle'],
]);
const results = [];

for (const engine of ENGINE_IDS) for (const fixtureId of RESEARCH_FIXTURES.m1b) {
  const result = await runResearchFixture({ milestone: 'm1b', engine, fixtureId, options: { recordFrames: false } });
  assert.equal(result.outcome, expected.get(fixtureId), `${engine} reproduces M1b ${fixtureId}`);
  assert.equal(result.finite, true, `${engine} ${fixtureId} remains finite`);
  results.push({ engine, fixtureId, outcome: result.outcome, contact: result.contact.occurred,
    gripEstablished: result.grip.established, gripBroken: result.grip.broken,
    carrierFell: result.balance.carrierFellAtEnd });
}

console.log(JSON.stringify({ passed: true, adapter: 'M4b shared Rapier/Jolt interface', results }, null, 2));
