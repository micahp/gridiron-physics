import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const result = JSON.parse(await readFile(new URL('./results/contact-mechanism.json', import.meta.url), 'utf8'));
assert.equal(result.schemaVersion, 1);
assert.equal(result.cells.length, 8, 'four requested geometry cells must be recorded for both engines');
assert.equal(result.method.timestepSeconds, 1 / 120);

function assertFiniteTree(value, path = 'root') {
  if (typeof value === 'number') assert.ok(Number.isFinite(value), `${path} must be finite`);
  else if (Array.isArray(value)) value.forEach((child, index) => assertFiniteTree(child, `${path}[${index}]`));
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) assertFiniteTree(child, `${path}.${key}`);
  }
}

assertFiniteTree(result);
for (const cell of result.cells) {
  for (const modeName of ['dynamic', 'kinematic']) {
    const mode = cell.modes[modeName];
    assert.equal(mode.frames.length, 180, `${cell.engine} ${cell.approachAngleDeg}/${cell.closingSpeedMps} ${modeName} needs 180 steps`);
    for (const frame of mode.frames) {
      assert.equal(frame.tick >= 1 && frame.tick <= 180, true);
      assert.ok(Math.abs(frame.timeSeconds - frame.tick / 120) < 1e-12);
      for (const group of ['carrierDefender', 'carrierGround', 'defenderGround']) {
        const contact = frame.contacts[group];
        assert.equal(contact.contactActive, contact.pairCount > 0);
        assert.equal(contact.separated, !contact.contactActive);
        assert.equal(contact.pairCount, contact.pairs.length);
        if (contact.contactActive) {
          assert.ok(contact.manifoldCount >= 1, `${group} must have a manifold at contact time`);
          assert.ok(contact.contactPointCount >= 1, `${group} must have contact points at contact time`);
          assert.ok(contact.pairs.every((pair) => pair.manifolds.length >= 1));
          assert.equal(contact.manifoldCount, contact.pairs.reduce((sum, pair) => sum + pair.manifolds.length, 0));
        }
        for (const pair of contact.pairs) {
          assert.ok(Number.isFinite(pair.normalImpulseNs), `${group} normal impulse record must be finite`);
          const contactPoints = pair.manifolds.flatMap((manifold) => manifold.contactPoints);
          assert.ok(contactPoints.length >= 1);
          assert.ok(contactPoints.every((point) => point.pointWorldM.length === 3
            && point.pointWorldM.every(Number.isFinite)));
          assert.ok(pair.manifolds.every((manifold) => Number.isFinite(manifold.normalImpulseNs)
            && Number.isFinite(manifold.penetrationDepthM)));
        }
      }
    }
    assert.ok(mode.frames.some((frame) => frame.contacts.carrierDefender.pairCount >= 1),
      `${cell.engine} ${cell.approachAngleDeg}/${cell.closingSpeedMps} ${modeName} must register tackle contact`);
  }

  const dynamic = cell.modes.dynamic.carrierPeakTiltDeg;
  const kinematic = cell.modes.kinematic.carrierPeakTiltDeg;
  assert.equal(cell.comparison.dynamicCarrierPeakTiltDeg, dynamic);
  assert.equal(cell.comparison.kinematicCarrierPeakTiltDeg, kinematic);
  assert.equal(cell.comparison.dynamicMinusKinematicPeakTiltDeg, dynamic - kinematic,
    'dynamic-vs-kinematic comparison must be computed from the serialized mode results');
  assert.ok(['during_carrier_defender_contact', 'after_separation_with_ground_contacts_only', 'after_separation_without_ground_contact']
    .includes(cell.modes.dynamic.peakPhase.label));
  assert.ok(cell.modes.dynamic.tiltTraceReference.replayPeakMatchesTracePeak,
    'dynamic probe peak tick should match its existing tilt trace');
  assert.ok(Math.abs(cell.modes.dynamic.tiltTraceReference.peakTiltDeltaDeg) < 1e-6,
    'dynamic probe peak should reproduce the existing tilt trace peak');
}

function reversalAt60(modeName) {
  const values = new Map(result.cells.filter((cell) => cell.engine === 'jolt-physics-js' && cell.approachAngleDeg === 60)
    .map((cell) => [cell.closingSpeedMps, cell.modes[modeName].carrierPeakTiltDeg]));
  return values.get(4) > values.get(6) && values.get(8) > values.get(6);
}

assert.equal(result.verdict.joltDynamicReversalReproduced, reversalAt60('dynamic'),
  'dynamic verdict must be derived from serialized dynamic peaks');
assert.equal(result.verdict.joltKinematicDefenderReversalReproduced, reversalAt60('kinematic'),
  'kinematic verdict must be derived from serialized kinematic peaks');
assert.match(result.verdict.kinematicVerdict, /PASS|FAIL/);

console.log(JSON.stringify({
  passed: true,
  cells: result.cells.length,
  modes: result.cells.length * 2,
  framesPerMode: result.cells[0].modes.dynamic.frames.length,
  joltDynamicReversalReproduced: result.verdict.joltDynamicReversalReproduced,
  joltKinematicDefenderReversalReproduced: result.verdict.joltKinematicDefenderReversalReproduced,
}, null, 2));
