import assert from 'node:assert/strict';
import { PASS_DEFLECTION_SCENARIO, TACKLE_SCENARIOS } from './scenarios.js';
import { runRapierTackle, runRapierPass, runRapier22PlayerBenchmark } from './rapier-sim.js';
import { runJoltTackle, runJoltPass, runJolt22PlayerBenchmark } from './jolt-sim.js';

const engines = [
  { name: 'rapier3d-compat', tackle: runRapierTackle, pass: runRapierPass, bench: runRapier22PlayerBenchmark },
  { name: 'jolt-physics-js', tackle: runJoltTackle, pass: runJoltPass, bench: runJolt22PlayerBenchmark },
];
const all = [];
for (const engine of engines) {
  const results = [];
  for (const scenario of TACKLE_SCENARIOS) {
    const result = await engine.tackle(scenario, 4242);
    assert.equal(result.contact.occurred, true, `${engine.name} missed ${scenario.id}`);
    assert.equal(result.finite, true, `${engine.name} unstable in ${scenario.id}`);
    assert.equal(result.engineMassKg.carrier > 70 && result.engineMassKg.carrier < 130, true, 'carrier mass not applied');
    assert.equal(result.engineMassKg.defender > 70 && result.engineMassKg.defender < 130, true, 'defender mass not applied');
    results.push(result);
  }
  assert.equal(results.find((r) => r.scenario === 'side-tackle').falling.carrier, true, `${engine.name} side-impact should produce a physical fall in this geometry`);
  const fast = results.find((r) => r.scenario === 'high-speed');
  const slow = results.find((r) => r.scenario === 'low-speed');
  const impulse = (r) => r.contact.contactImpulseEstimateNs ?? r.contact.impulseEstimateNs;
  assert.ok(impulse(fast) > impulse(slow), `${engine.name} speed should affect impact impulse`);
  const escape = results.find((r) => r.scenario === 'escape-attempt-strength-drive');
  assert.match(escape.policy, /strength ×/);
  const pass = await engine.pass(4242);
  assert.equal(pass.catchFeasible, true, `${engine.name} should physically contact the receiver`);
  assert.equal(pass.finite, true);
  assert.equal(pass.claim.includes('No catch'), true);
  const contestedPass = await engine.pass(4242, PASS_DEFLECTION_SCENARIO);
  assert.equal(contestedPass.finite, true);
  assert.equal(contestedPass.physicalContacts.includes('receiver'), true);
  if (engine.name === 'jolt-physics-js') assert.equal(contestedPass.deflectionFeasible, true, 'Jolt defender should physically contact the pass in the in-lane scenario');
  const repeatA = await engine.tackle(TACKLE_SCENARIOS[0], 99);
  const repeatB = await engine.tackle(TACKLE_SCENARIOS[0], 99);
  assert.deepEqual(repeatB, repeatA, `${engine.name} replay changed for identical conditions and seed`);
  all.push({ engine: engine.name, tackles: results, pass, contestedPass, repeatable: true });
}

const benches = [];
for (const engine of engines) {
  const result = await engine.bench({ simulations: 6, stepsPerSimulation: 30 });
  assert.equal(result.playerBodies, 22);
  assert.equal(result.finite, true);
  assert.ok(result.elapsedMs > 0);
  assert.ok(result.startedColliderContactsFirstEpisode ?? result.bodyContactsFirstEpisode);
  benches.push(result);
}
  console.log(JSON.stringify({ passed: true, tackleCasesPerEngine: TACKLE_SCENARIOS.length, passCases: 4, replayChecks: 2, benches, results: all.map((r) => ({ engine: r.engine, tackleContacts: r.tackles.map((x) => [x.scenario, x.contact.timeSeconds, x.falling]), passContacts: [r.pass.physicalContacts, r.contestedPass.physicalContacts] })) }, null, 2));
