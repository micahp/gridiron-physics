import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTACT_SWEEP_ANGLES_DEG, CONTACT_SWEEP_SPEEDS_MPS } from './scenarios.js';
import { runContactSweep, runContactSweepCell } from './sweep.mjs';

const comparableArtifact = ({ generatedAt, runtime, ...artifact }) => artifact;

export async function runSweepTests() {
  const freshSweep = await runContactSweep();
  const committedArtifact = JSON.parse(await readFile(new URL('./results-sweep.json', import.meta.url), 'utf8'));
  assert.deepEqual(
    comparableArtifact(freshSweep),
    comparableArtifact(committedArtifact),
    'fresh sweep and no-contact control must match the committed results-sweep.json (except generatedAt/runtime)',
  );

  const expectedPerEngine = CONTACT_SWEEP_ANGLES_DEG.length * CONTACT_SWEEP_SPEEDS_MPS.length;
  assert.equal(freshSweep.cells.length, expectedPerEngine * 2, 'sweep grid cell count changed');
  for (const engine of ['rapier3d-compat', 'jolt-physics-js']) {
    const engineCells = freshSweep.cells.filter((cell) => cell.engine === engine);
    assert.equal(engineCells.length, expectedPerEngine, `${engine} sweep cell count changed`);
    assert.equal(engineCells.every((cell) => cell.finite), true, `${engine} sweep contains a non-finite result`);
    const repeatedA = await runContactSweepCell(engine, 30, 6, freshSweep.runtime.engineVersions);
    const repeatedB = await runContactSweepCell(engine, 30, 6, freshSweep.runtime.engineVersions);
    assert.deepEqual(repeatedB, repeatedA, `${engine} repeated sweep cell changed with identical controlled inputs and seed`);
  }
  assert.equal(freshSweep.control.results.every((result) => result.finite), true, 'no-contact control contains non-finite results');
  assert.equal(freshSweep.control.results.every((result) => result.contactOccurred === false), true, 'no-contact control unexpectedly contacted');
  assert.equal(freshSweep.control.results.every((result) => !result.carrierFellAt55Deg && !result.defenderFellAt55Deg), true, 'no-contact control unexpectedly fell');

  console.log(JSON.stringify({
    passed: true,
    cellsPerEngine: expectedPerEngine,
    totalCells: freshSweep.cells.length,
    committedArtifactMatchesFreshRun: true,
    control: freshSweep.control.results.map(({ engine, contactOccurred, carrierPeakTiltDeg, defenderPeakTiltDeg, carrierFellAt55Deg, defenderFellAt55Deg }) => ({ engine, contactOccurred, carrierPeakTiltDeg, defenderPeakTiltDeg, carrierFellAt55Deg, defenderFellAt55Deg })),
    deterministicRepeatedCellPerEngine: true,
    finite: freshSweep.cells.every((cell) => cell.finite),
  }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await runSweepTests();
