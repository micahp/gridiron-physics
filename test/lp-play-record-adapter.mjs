import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { adaptLpPlayRecord, collectNullPaths, displayRecordValue } from '../web/lp-play-record-adapter.js';

const fixture = JSON.parse(readFileSync(new URL('../docs/fixtures/nfl-seq-e0-play-record-seed1042.json', import.meta.url)));

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

const immutableRecord = deepFreeze(fixture);
const before = JSON.stringify(immutableRecord);
const adapted = adaptLpPlayRecord(immutableRecord);

assert.equal(JSON.stringify(immutableRecord), before, 'adapter must not change LP input');
assert.equal(adapted.status, 'accepted_for_read_only_display');
assert.equal(adapted.mode, 'single_play_statistical_demo');
assert.equal(adapted.validFullGame, false);
assert.match(adapted.displayLabel, /RETROSPECTIVE/);
assert.equal(adapted.temporalEligibility.cell_rows_dated_after_start, 1016);
assert.equal(adapted.plays.length, 1);
assert.equal(adapted.plays[0].eventType, 'run');
assert.equal(adapted.plays[0].outcome.rusher_id, null);
assert.equal(adapted.plays[0].stateAfter.clock_seconds, null);
assert.deepEqual(adapted.plays[0].stateBefore, fixture.plays[0].state_before);
assert.deepEqual(adapted.plays[0].stateAfter, fixture.plays[0].state_after);
assert.deepEqual(adapted.plays[0].outcome, fixture.plays[0].outcome);
assert.notEqual(adapted.plays[0].outcome, fixture.plays[0].outcome, 'adapter exposes a detached display copy');
assert.ok(Object.isFrozen(adapted.plays[0].outcome), 'display copy is read-only');
assert.ok(adapted.plays[0].nullPaths.includes('outcome.rusher_id'));
assert.ok(adapted.plays[0].nullPaths.includes('state_after.clock_seconds'));
assert.equal(adapted.replay.status, 'not_attempted');
assert.equal(displayRecordValue(null), 'Not modelled');
assert.equal(displayRecordValue(undefined), 'Not provided');
assert.equal(displayRecordValue(false), 'No');
assert.deepEqual(collectNullPaths({ known: null, nested: { also: null } }), ['known', 'nested.also']);

const rejected = (mutate, message) => {
  const record = structuredClone(fixture);
  mutate(record);
  assert.throws(() => adaptLpPlayRecord(record), message);
};

rejected((record) => { record.schema_version = '2.0'; }, /unsupported schema_version/);
rejected((record) => { record.plays[0].event_type = 'unknown_event'; }, /event_type is unsupported/);
rejected((record) => { record.plays.push(structuredClone(record.plays[0])); }, /must contain exactly one play/);
rejected((record) => { record.plays[0].id = 'wrong-id'; }, /id must match simulation_id:sequence/);
rejected((record) => { record.mode = 'pregame_full_game'; }, /unsupported mode/);
rejected((record) => { record.summary.valid_full_game = true; }, /summary.valid_full_game must match/);
rejected((record) => { delete record.outcome_pool.temporal_eligibility.cell_rows_total; }, /row counts must be valid/);

console.log('LP play record E0a adapter checks passed');
