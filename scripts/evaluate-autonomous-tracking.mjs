#!/usr/bin/env node
// Run the snap-only executor first; only then open the sealed evaluation rows.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { simulateInsideZone } from '../engine/autonomous-run.js';
import { scoreAutonomousTracking } from '../engine/tracking-eval.js';

const [snapPath, observedPath, outputPath] = process.argv.slice(2);
if (!snapPath || !observedPath) {
  console.error('usage: node scripts/evaluate-autonomous-tracking.mjs <snap-input.json> <observed-eval-only.json> [output.json]');
  process.exit(2);
}

const snapDoc = JSON.parse(await readFile(snapPath, 'utf8'));
const snapInput = snapDoc.input ?? snapDoc;
const simulation = simulateInsideZone(snapInput);

// This file is not read until the forward simulation is complete. It must be a
// frozen weeks 1-5 development sample; weeks 6-9 remain reserved.
const evaluationDoc = JSON.parse(await readFile(observedPath, 'utf8'));
if (Object.keys(evaluationDoc).some((k) => !['source', 'rows'].includes(k))) {
  throw new TypeError('evaluation file may contain source metadata and coordinate rows only');
}
const source = evaluationDoc.source;
const sourceKeys = new Set([
  'dataset', 'week', 'game_id', 'play_id', 'snap_frame', 'last_input_frame',
  'eligible_input', 'play_call', 'play_call_known_at_snap', 'coordinate_frame', 'source_sha256', 'manifest_sha256',
]);
if (!source || typeof source !== 'object' || Object.keys(source).some((k) => !sourceKeys.has(k))) {
  throw new TypeError('evaluation source metadata contains unsupported or outcome-derived fields');
}
if (source.dataset !== 'NFL-BDB-2025-2022' || !Number.isInteger(source.week) || source.week < 1 || source.week > 5) {
  throw new TypeError('only the audited 2022 weeks 1-5 development cohort is accepted');
}
if (source.eligible_input !== true || source.play_call !== 'inside_zone' || source.play_call_known_at_snap !== true) {
  throw new TypeError('record must document eligible all-22 snap inputs and an inside-zone call known at snap');
}
if (source.coordinate_frame !== 'gridiron_goal_to_goal_yards_v1') {
  throw new TypeError('observed rows must be transformed into the simulation goal-to-goal x/y yard frame');
}
if (!Number.isInteger(source.snap_frame) || !Number.isInteger(source.last_input_frame) || source.last_input_frame > source.snap_frame) {
  throw new TypeError('tracking input cutoff must be at or before the declared snap frame');
}
for (const key of ['source_sha256', 'manifest_sha256']) {
  if (typeof source[key] !== 'string' || !/^[a-f0-9]{64}$/i.test(source[key])) throw new TypeError(`${key} must be a SHA-256 digest`);
}
if (!Array.isArray(evaluationDoc.rows)) throw new TypeError('evaluation rows must be an array');
const evaluation = scoreAutonomousTracking(simulation, evaluationDoc.rows);

const result = {
  schema_version: 'gridiron.autonomous-tracking-evaluation.v1',
  source: { ...source, evaluation_file_sha256: createHash('sha256').update(JSON.stringify(evaluationDoc)).digest('hex') },
  simulation: {
    schema_version: simulation.schema_version,
    seed: simulation.seed,
    result: simulation.terminal,
    roster: simulation.roster,
    trajectories: simulation.trajectories,
    events: simulation.events,
  },
  evaluation,
};
const json = JSON.stringify(result, null, 2) + '\n';
if (outputPath) await writeFile(outputPath, json);
else process.stdout.write(json);
