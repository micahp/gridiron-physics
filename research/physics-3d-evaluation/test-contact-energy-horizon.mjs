import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const result = JSON.parse(await readFile(new URL('./results/contact-energy-horizon.json', import.meta.url), 'utf8'));
const priorEnergy = JSON.parse(await readFile(new URL('./results/contact-energy.json', import.meta.url), 'utf8'));
const close = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) <= tolerance,
  `${label}: ${actual} differs from ${expected} by more than ${tolerance}`);
const finiteTree = (value, path = 'root') => {
  if (typeof value === 'number') assert.ok(Number.isFinite(value), `${path} is not finite`);
  else if (Array.isArray(value)) value.forEach((item, index) => finiteTree(item, `${path}[${index}]`));
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) finiteTree(child, `${path}.${key}`);
  }
};

assert.equal(result.schemaVersion, 1);
finiteTree(result);
assert.equal(result.method.horizonTicks, 900);
assert.equal(result.method.timestepSeconds, 1 / 120);
assert.equal(result.cells.length, 4);
const cellIds = new Set();
let modesChecked = 0;
for (const cell of result.cells) {
  const cellId = `${cell.engine}:${cell.approachAngleDeg}:${cell.closingSpeedMps}`;
  assert.ok(!cellIds.has(cellId), `duplicate horizon cell ${cellId}`);
  cellIds.add(cellId);
  for (const modeName of ['dynamic', 'kinematic']) {
    const mode = cell.modes[modeName];
    const { carrierTiltDeg, defenderKineticEnergyJ, tackleContactActive } = mode.traces;
    assert.equal(mode.horizonTicks, 900);
    assert.equal(carrierTiltDeg.length, 900);
    assert.equal(defenderKineticEnergyJ.length, 900);
    assert.equal(tackleContactActive.length, 900);
    for (const tick of [180, 360, 600, 900]) {
      close(mode.tiltAtTicksDeg[tick], carrierTiltDeg[tick - 1], 1e-10, `${cellId} ${modeName} tilt at ${tick}`);
    }
    const recomputedWindows = [];
    for (let endTick = 100; endTick <= 900; endTick += 100) {
      const startTilt = endTick === 100 ? mode.tick0.carrierTiltDeg : carrierTiltDeg[endTick - 101];
      const delta = carrierTiltDeg[endTick - 1] - startTilt;
      recomputedWindows.push(delta);
      close(mode.each100TickTiltChange.find((entry) => entry.endTick === endTick).deltaTiltDeg,
        delta, 1e-9, `${cellId} ${modeName} ${endTick}-tick window`);
    }
    const finalDelta = carrierTiltDeg[899] - carrierTiltDeg[799];
    close(mode.terminalSaturation.finalWindowDeltaDeg, finalDelta, 1e-9, `${cellId} ${modeName} saturation delta`);
    assert.equal(mode.terminalSaturation.saturated,
      Math.abs(finalDelta) < result.acceptanceBounds.terminalSaturationDeltaDegPer100Ticks);

    const peak = carrierTiltDeg.reduce((best, tilt, index) => tilt > best.tilt ? { tilt, tick: index + 1 } : best,
      { tilt: mode.tick0.carrierTiltDeg, tick: 0 });
    close(mode.observedMaximum.tiltDeg, peak.tilt, 1e-9, `${cellId} ${modeName} observed maximum tilt`);
    assert.equal(mode.observedMaximum.tick, peak.tick);
    assert.equal(mode.observedMaximum.atHorizonBoundary, peak.tick === 900);
    assert.equal(mode.observedMaximum.interiorMaximumTick,
      peak.tick > 0 && peak.tick < 900 ? peak.tick : null);

    const activeTicks = tackleContactActive.flatMap((active, index) => active ? [index + 1] : []);
    if (activeTicks.length) {
      const contact = mode.tackleContactWindow;
      assert.equal(contact.firstActiveTick, activeTicks[0]);
      assert.equal(contact.lastActiveTick, activeTicks.at(-1));
      assert.equal(contact.activeTickCount, activeTicks.length);
      const beforeFirst = activeTicks[0] === 1 ? mode.tick0.defenderKineticEnergyJ
        : defenderKineticEnergyJ[activeTicks[0] - 2];
      close(contact.defenderKineticEnergyBeforeFirstContactJ, beforeFirst, 1e-8,
        `${cellId} ${modeName} pre-contact defender KE`);
    } else assert.equal(mode.tackleContactWindow, null);

    const legacyCell = priorEnergy.cells.find((entry) => entry.engine === cell.engine
      && entry.approachAngleDeg === cell.approachAngleDeg && entry.closingSpeedMps === cell.closingSpeedMps);
    const legacyMode = legacyCell.modes[modeName];
    const replayPeakFirst180 = Math.max(...carrierTiltDeg.slice(0, 180));
    close(replayPeakFirst180, legacyMode.peakTiltDeg, 1e-6,
      `${cellId} ${modeName} 180-tick replay matches frozen contact-energy artifact`);
    modesChecked++;
  }
}
assert.deepEqual([...cellIds].sort(), [
  'jolt-physics-js:30:8', 'jolt-physics-js:60:6',
  'rapier3d-compat:30:8', 'rapier3d-compat:60:6',
].sort());
assert.equal(modesChecked, 8);

const jolt60 = result.cells.find((cell) => cell.engine === 'jolt-physics-js'
  && cell.approachAngleDeg === 60 && cell.closingSpeedMps === 6).modes.dynamic;
assert.ok(jolt60.tiltAtTicksDeg[180] < 60);
assert.ok(jolt60.tiltAtTicksDeg[900] > 89);
assert.ok(jolt60.observedMaximum.interiorMaximumTick !== null,
  'Jolt 60/6 peak must be observed inside the extended horizon if it turns before tick 900');
assert.ok(jolt60.tiltAtTicksDeg[360] > jolt60.tiltAtTicksDeg[180],
  'the 180-tick low-tilt result must be marked as a horizon effect when later tilt grows');

const jolt30 = result.cells.find((cell) => cell.engine === 'jolt-physics-js'
  && cell.approachAngleDeg === 30 && cell.closingSpeedMps === 8).modes.dynamic;
assert.ok(jolt30.observedMaximum.tiltDeg > 103);
assert.ok(jolt30.observedMaximum.interiorMaximumTick !== null);
assert.ok(jolt30.tiltAtTicksDeg[900] < 90);

const attribution = result.revisedEnergyAttribution;
assert.equal(attribution.revisedVerdict, 'not_distinguishable_by_this_ledger');
assert.ok(attribution.observedAtTick180.defenderKineticChangeTick1To180J <= 0);
assert.ok(attribution.observedAtTick180.defenderPotentialEnergyReleasedFromTick1To180J > 500);
assert.ok(attribution.activeTackleContactWindow.largestActiveContactFrameGainVsPreContactJ > 0,
  'transient contact-frame kinetic gain is recorded separately from descent');
assert.ok(Math.abs(attribution.deltaTelescopingAudit.telescopeErrorJ) < 1e-8);
close(attribution.deltaTelescopingAudit.reportedGapFromMismatchedBaselineJ,
  -1.8334098522377644, 1e-8, 'tick-0/tick-1 baseline mismatch diagnosis');

const controls = result.gravityOnlyControl.runs;
assert.equal(controls.length, 2);
for (const control of controls) {
  assert.equal(control.contactCount, 0, `${control.engine} gravity-only run has no body-body contact`);
  assert.equal(control.contactTrace.length, 900);
  assert.ok(control.contactTrace.every((contact) => contact === false));
  assert.equal(control.perStepMechanicalEnergyJ.length, 901);
  const deltas = control.perStepMechanicalEnergyJ.slice(1)
    .map((energy, index) => energy - control.perStepMechanicalEnergyJ[index]);
  close(control.maximumAbsolutePerStepDriftJ, Math.max(...deltas.map(Math.abs)), 1e-8,
    `${control.engine} max free-fall per-step drift`);
  const cumulative = Math.max(...control.perStepMechanicalEnergyJ
    .map((energy) => Math.abs(energy - control.perStepMechanicalEnergyJ[0])));
  close(control.maximumAbsoluteCumulativeDriftJ, cumulative, 1e-7,
    `${control.engine} max cumulative free-fall drift`);
  assert.ok(control.maximumAbsolutePerStepDriftJ
    <= result.acceptanceBounds.gravityOnlyMaximumAbsolutePerStepDriftJ,
  `${control.engine} per-step free-fall drift exceeds the empirical bound`);
  assert.ok(control.maximumAbsolutePerStepDriftJ
    > result.acceptanceBounds.priorUnexercisedBoundJPerStep,
  `${control.engine} gravity-only control should demonstrate why the old 0.05 J bound was invalid`);
  assert.ok(control.maximumAbsoluteCumulativeDriftJ
    <= result.acceptanceBounds.gravityOnlyMaximumAbsoluteCumulativeDriftJ,
  `${control.engine} cumulative free-fall drift exceeds the empirical bound`);
  assert.ok(control.maximumAngularSpeedRadPerSec < 1e-8,
    `${control.engine} gravity-only control unexpectedly acquired angular motion`);
}

console.log(JSON.stringify({
  passed: true,
  cells: result.cells.length,
  modes: modesChecked,
  horizonTicks: result.method.horizonTicks,
  jolt60x6TiltAt180And900Deg: [jolt60.tiltAtTicksDeg[180], jolt60.tiltAtTicksDeg[900]],
  jolt30x8Peak: jolt30.observedMaximum,
  terminallySaturatedModes: result.cells.flatMap((cell) => Object.values(cell.modes))
    .filter((mode) => mode.terminalSaturation.saturated).length,
  gravityOnlyPerStepDriftJ: Object.fromEntries(controls.map((control) => [control.engine, control.maximumAbsolutePerStepDriftJ])),
  revisedAttribution: attribution.revisedVerdict,
  telescopeErrorJ: attribution.deltaTelescopingAudit.telescopeErrorJ,
}, null, 2));
