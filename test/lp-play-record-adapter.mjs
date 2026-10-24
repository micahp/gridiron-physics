import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { adaptLpPlayRecord, collectNullPaths, convertYardlineToLos, displayRecordValue } from '../web/lp-play-record-adapter.js';

const fixtureBytes = readFileSync(new URL('../docs/fixtures/nfl-seq-e0-play-record-seed1042.json', import.meta.url));
assert.equal(createHash('sha256').update(fixtureBytes).digest('hex'), '37478127345c80d44664c30481ea9adbf372450223d1c89822b4b27b450808f6');
const fixture = JSON.parse(fixtureBytes);

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
assert.deepEqual(adapted.plays[0].field, fixture.plays[0].field);
assert.notEqual(adapted.plays[0].outcome, fixture.plays[0].outcome, 'adapter exposes a detached display copy');
assert.ok(Object.isFrozen(adapted.plays[0].outcome), 'display copy is read-only');
assert.ok(Object.isFrozen(adapted.plays[0].field), 'field assignment is read-only');
assert.equal(adapted.plays[0].field.assignment_version, 'e0-field-end-v1');
assert.equal(adapted.plays[0].field.source, 'authored_demo_convention');
assert.equal(adapted.plays[0].field.before.dir, 1);
assert.equal(adapted.plays[0].field.before.los, 12);
assert.ok(adapted.plays[0].nullPaths.includes('outcome.rusher_id'));
assert.ok(adapted.plays[0].nullPaths.includes('state_after.clock_seconds'));
assert.equal(adapted.replay.status, 'not_attempted');
assert.equal(displayRecordValue(null), 'Not modelled');
assert.equal(displayRecordValue(undefined), 'Not provided');
assert.equal(displayRecordValue(false), 'No');
assert.equal(convertYardlineToLos(1, 88), 12);
assert.equal(convertYardlineToLos(-1, 88), 88);
assert.equal(convertYardlineToLos(-1, 12), 12, 'opposite offense can retain the same absolute LOS at the same spot');
assert.throws(() => convertYardlineToLos(0, 88), /dir must be 1 or -1/);
assert.throws(() => convertYardlineToLos(1, 101), /yardline_100 must be between/);

const turnoverRecord = structuredClone(fixture);
const turnoverPlay = turnoverRecord.plays[0];
turnoverPlay.state_before.down = 4;
turnoverPlay.state_after.offense_team = 'LV';
turnoverPlay.state_after.defense_team = 'IND';
turnoverPlay.state_after.down = 1;
turnoverPlay.state_after.yardline_100 = 12;
turnoverPlay.outcome.turnover = true;
turnoverPlay.field.after = { dir: -1, los: 12 };
const turnoverDisplay = adaptLpPlayRecord(turnoverRecord);
assert.equal(turnoverDisplay.plays[0].field.after.dir, -1, 'possession change can flip direction during Q2');
assert.equal(turnoverDisplay.plays[0].field.after.los, turnoverDisplay.plays[0].field.before.los);
assert.deepEqual(collectNullPaths({ known: null, nested: { also: null } }), ['known', 'nested.also']);

const rejected = (mutate, message) => {
  const record = structuredClone(fixture);
  mutate(record);
  assert.throws(() => adaptLpPlayRecord(record), message);
};

rejected((record) => { record.schema_version = '2.0'; }, /unsupported schema_version/);
rejected((record) => { record.plays[0].event_type = 'unknown_event'; }, /event_type is unsupported/);
rejected((record) => { record.plays.push(structuredClone(record.plays[0])); }, /duplicate play id/);
rejected((record) => {
  const secondPlay = structuredClone(record.plays[0]);
  secondPlay.sequence = 2;
  secondPlay.id = `${record.simulation_id}:2`;
  record.plays.push(secondPlay);
}, /must contain exactly one play/);
rejected((record) => { record.plays[0].id = 'wrong-id'; }, /id must match simulation_id:sequence/);
rejected((record) => { record.mode = 'pregame_full_game'; }, /unsupported mode/);
rejected((record) => { record.summary.valid_full_game = true; }, /summary.valid_full_game must match/);
rejected((record) => { delete record.outcome_pool.temporal_eligibility.cell_rows_total; }, /row counts must be valid/);
rejected((record) => { record.plays[0].field.source = 'observed'; }, /field.source is unsupported/);
rejected((record) => { record.plays[0].field.before.los = 11; }, /does not match the stated dir/);

console.log('LP play record E0a adapter checks passed');
