import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const result = JSON.parse(await readFile(new URL('./results/m1b-results.json', import.meta.url), 'utf8'));
assert.equal(result.schemaVersion, 1);
assert.equal(result.engines.length, 2);
assert.equal(result.matchedSetup.fixedFootballTimestepSeconds, 1 / 120);
assert.equal(result.matchedSetup.balanceController.centerOfMassOffsetFeedback, true);
assert.match(result.matchedSetup.gripController.loadSource, /not reported as a solver constraint impulse/);

function finiteTree(value, path = 'root') {
  if (typeof value === 'number') assert.ok(Number.isFinite(value), `${path} is finite`);
  else if (Array.isArray(value)) value.forEach((x, i) => finiteTree(x, `${path}[${i}]`));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) finiteTree(v, `${path}.${k}`);
}

for (const engine of result.engines) {
  assert.equal(engine.energyControls.airborne.passed, true, `${engine.engine} contact-free gravity control stays within integration tolerance`);
  assert.equal(engine.energyControls.airborne.measuredFrames, 2400);
  assert.equal(engine.energyControls.airborne.gravityOnly, true);
  assert.equal(engine.energyControls.ground.material.friction, 0.72);
  assert.equal(engine.energyControls.ground.material.restitution, 0.12);
  assert.ok(engine.energyControls.ground.firstContactTimeSeconds > 0);
  assert.ok(Math.abs(engine.energyControls.ground.mechanicalEnergyChangeJ) > 1, 'inelastic ground case documents mechanical energy change');
  assert.ok(engine.demos.every((demo) => demo.finite));
  assert.ok(engine.balance.every((caseResult) => caseResult.finite));
  assert.ok(engine.tackleVariants.every((scenario) => scenario.finite));
  assert.ok(engine.repeatability.every((scenario) => scenario.exactWithinProcess), `${engine.engine} repeats exactly in process`);
  assert.equal(engine.benchmark22.finite, true);
  assert.equal(engine.benchmark22.players, 22);
  assert.equal(engine.benchmark22.stepsPerRepeat, 12000);
  assert.equal(engine.benchmark22.samples.length, 3);
  assert.equal(engine.benchmark22.controllersEnabled, true);

  const demos = new Map(engine.demos.map((d) => [d.scenario, d]));
  const successful = demos.get('successful-tackle');
  assert.equal(successful.outcome, 'successful_tackle');
  assert.equal(successful.contact.occurred, true);
  assert.equal(successful.grip.established, true);
  assert.equal(successful.grip.broken, false);
  assert.equal(successful.balance.carrierFellAtEnd, true);
  assert.ok(successful.events.some((e) => e.type === 'carrier_down'));

  const stumble = demos.get('stumble-recovery');
  assert.ok(stumble.events.some((e) => e.type === 'balance_disturbance_started'));
  assert.ok(stumble.events.some((e) => e.type === 'upright_stabilized_after_disturbance'));

  const broken = demos.get('broken-tackle');
  assert.equal(broken.outcome, 'broken_tackle');
  assert.equal(broken.grip.established, true);
  assert.equal(broken.grip.broken, true);
  assert.ok(broken.grip.breakEvents.length > 0);
  assert.ok(broken.grip.breakEvents[0].requestedLoadN > broken.grip.breakEvents[0].capacityN);
  assert.equal(broken.balance.carrierFellAtEnd, false);
  assert.ok(broken.balance.carrierRecovered || broken.balance.maxTiltDeg.carrier < 58);
  assert.ok(broken.distanceAfterContactM > 0.5);
  assert.ok(broken.events.some((e) => e.type === 'runner_escaped'));

  const missed = demos.get('missed-tackle');
  assert.equal(missed.outcome, 'missed_tackle');
  assert.equal(missed.contact.occurred, false);
  assert.equal(missed.grip.established, false);
  assert.ok(missed.events.some((e) => e.type === 'tackle_attempt'));
  assert.ok(missed.events.some((e) => e.type === 'missed_tackle'));
  assert.ok(missed.events.some((e) => e.type === 'runner_continued' && e.distanceFromStartM > 0.5));

  const balance = new Map(engine.balance.map((b) => [b.scenario, b]));
  const stand = balance.get('upright-standing').results[0];
  assert.ok(stand.maxTiltDeg < 5);
  assert.ok(Math.hypot(stand.final.positionM[0], stand.final.positionM[2]) < 0.2);
  const small = balance.get('small-disturbance-recovery');
  assert.ok(small.results[0].maxTiltDeg > 10);
  assert.ok(small.events.some((e) => e.type === 'upright_stabilized_after_disturbance'));
  const large = balance.get('large-disturbance-fall');
  assert.equal(large.results[0].fellAtEnd, true);
  assert.ok(large.events.some((e) => e.type === 'carrier_fall_started'));
  const glancing = balance.get('glancing-contact-recovery');
  assert.ok(glancing.firstContactTick > 0);
  assert.ok(glancing.events.some((e) => e.type === 'upright_stabilized_after_disturbance'));
  const asymmetric = balance.get('asymmetric-fall-and-stand');
  assert.equal(asymmetric.results.find((p) => p.label === 'carrier').fellAtEnd, true);
  assert.equal(asymmetric.results.find((p) => p.label === 'defender').fellAtEnd, false);
  const push = balance.get('two-player-push');
  assert.ok(push.firstContactTick > 0);
  assert.ok(push.events.some((e) => e.type === 'physical_contact'));
  finiteTree(result);
}

console.log(JSON.stringify({ passed: true, engines: result.engines.map((e) => e.engine),
  tackleOutcomes: ['successful_tackle', 'broken_tackle', 'missed_tackle'],
  balanceCases: result.engines[0].balance.map((b) => b.scenario),
  contactFreeEnergyFramesPerEngine: 2400, benchmarkPlayers: 22 }, null, 2));
