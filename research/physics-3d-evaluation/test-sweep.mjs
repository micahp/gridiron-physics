import assert from 'node:assert/strict';
import { CONTACT_SWEEP_ANGLES_DEG, CONTACT_SWEEP_SPEEDS_MPS } from './scenarios.js';
import { runContactSweep, runContactSweepCell } from './sweep.mjs';

const artifact = await runContactSweep();
const expectedPerEngine = CONTACT_SWEEP_ANGLES_DEG.length * CONTACT_SWEEP_SPEEDS_MPS.length;
assert.equal(artifact.cells.length, expectedPerEngine * 2, 'sweep grid cell count changed');
for (const engine of ['rapier3d-compat', 'jolt-physics-js']) {
  const engineCells = artifact.cells.filter((cell) => cell.engine === engine);
  assert.equal(engineCells.length, expectedPerEngine, `${engine} sweep cell count changed`);
  assert.equal(engineCells.every((cell) => cell.finite), true, `${engine} sweep contains a non-finite result`);
  const repeatA = await runContactSweepCell(engine, 30, 6, artifact.runtime.engineVersions);
  const repeatB = await runContactSweepCell(engine, 30, 6, artifact.runtime.engineVersions);
  assert.deepEqual(repeatB, repeatA, `${engine} repeated sweep cell changed with identical controlled inputs and seed`);
}

console.log(JSON.stringify({
  passed: true,
  cellsPerEngine: expectedPerEngine,
  totalCells: artifact.cells.length,
  deterministicRepeatedCellPerEngine: true,
  finite: artifact.cells.every((cell) => cell.finite),
}, null, 2));
