import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { adaptLpDriveRecord, DRIVE_TERMINAL_TEXT } from '../web/lp-drive-record-adapter.js';

const FIXTURE_DIR = new URL('../docs/fixtures/e1/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('MANIFEST.json', FIXTURE_DIR), 'utf8'));

function loadBytes(name) {
  return readFileSync(new URL(name, FIXTURE_DIR));
}

function load(name) {
  return JSON.parse(loadBytes(name));
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

const EXPECTED = {
  'own25_q1_900-seed6-touchdown.json': { terminal: 'touchdown', plays: 11 },
  'own25_q1_900-seed12-turnover.json': { terminal: 'turnover', plays: 4 },
  'own25_q1_900-seed1-punt.json': { terminal: 'punt', plays: 7 },
  'own25_q1_900-seed2-field_goal_attempt.json': { terminal: 'field_goal_attempt', plays: 12 },
  'own25_q2_120-seed15-turnover_on_downs.json': { terminal: 'turnover_on_downs', plays: 4 },
  'own25_q2_120-seed1-halftime.json': { terminal: 'halftime', plays: 4 },
  'own25_q4_150-seed1-end_of_regulation.json': { terminal: 'end_of_regulation', plays: 5 },
  'own5_q1_900-seed14-safety.json': { terminal: 'safety', plays: 3 },
  'own25_q1_060-seed1-quarter_change_then_punt.json': { terminal: 'punt', plays: 7, quarterChanges: 1 },
  'own25_q3_060-seed1-quarter_change_then_punt.json': { terminal: 'punt', plays: 7, quarterChanges: 1 },
};

test('the ten fixtures match the pinned manifest hashes and LP commit', () => {
  assert.equal(manifest.lp_commit, 'e621e83ef86b2255bd6622f32d691553ea2abaaf');
  assert.equal(manifest.fixtures.length, 10);
  for (const entry of manifest.fixtures) {
    const hash = createHash('sha256').update(loadBytes(entry.file)).digest('hex');
    assert.equal(hash, entry.sha256, `hash mismatch for ${entry.file}`);
  }
});

test('all ten pinned fixtures are accepted, with the expected terminal and summary recomputed', () => {
  assert.equal(Object.keys(EXPECTED).length, 10);
  for (const [name, expected] of Object.entries(EXPECTED)) {
    const adapted = adaptLpDriveRecord(load(name));
    assert.equal(adapted.status, 'accepted_for_read_only_display', name);
    assert.equal(adapted.drive.terminal, expected.terminal, name);
    assert.equal(adapted.plays.length, expected.plays, name);
    assert.equal(adapted.drive.terminalText, DRIVE_TERMINAL_TEXT[expected.terminal], name);
    assert.deepEqual(adapted.drive.recomputed, adapted.drive.recorded, `${name}: recorded summary must equal recomputed`);
    if (expected.quarterChanges !== undefined) {
      assert.equal(adapted.plays.filter((play) => play.quarterChange).length, expected.quarterChanges, name);
    }
  }
});

test('the eight E1 terminal variants are each reached by a pinned fixture', () => {
  const seen = new Set(Object.values(EXPECTED).map((item) => item.terminal));
  for (const terminal of ['touchdown', 'turnover', 'turnover_on_downs', 'punt', 'field_goal_attempt', 'safety', 'halftime', 'end_of_regulation']) {
    assert.ok(seen.has(terminal), `no pinned fixture reaches ${terminal}`);
  }
});

test('clock_clamped_plays is recomputed when the record supplies it', () => {
  const record = mutated('own25_q4_150-seed1-end_of_regulation.json', (r) => { r.drive.clock_clamped_plays = r.drive.clock_clamped_plays + 1; });
  assert.throws(() => adaptLpDriveRecord(record), /clock_clamped_plays does not match/);
});

test('the adapter does not change the LP input and returns a frozen copy', () => {
  const input = load('own25_q1_900-seed6-touchdown.json');
  deepFreeze(input);
  const before = JSON.stringify(input);
  const adapted = adaptLpDriveRecord(input);
  assert.equal(JSON.stringify(input), before, 'LP input must not change');
  assert.ok(Object.isFrozen(adapted), 'display model is frozen');
  assert.ok(Object.isFrozen(adapted.plays[0].outcome), 'outcome copy is frozen');
  assert.notEqual(adapted.plays[0].outcome, input.plays[0].outcome, 'display copy is detached from LP input');
});

test('state continuity holds across plays, and quarter changes keep the drive going', () => {
  const adapted = adaptLpDriveRecord(load('own25_q1_060-seed1-quarter_change_then_punt.json'));
  const [, change, after] = adapted.plays;
  assert.equal(change.quarterChange, true);
  assert.equal(change.terminal, null, 'a quarter change is not a drive ending');
  assert.equal(change.stateBefore.quarter, 1);
  assert.equal(change.stateAfter.quarter, 2);
  assert.equal(change.stateAfter.clock_seconds, 900, 'the period clock resets at the change');
  assert.equal(after.stateBefore.offense_team, change.stateAfter.offense_team, 'possession is retained across the change');
  assert.equal(after.stateBefore.yardline_100, change.stateAfter.yardline_100);
  assert.equal(change.field.before.dir, -change.field.after.dir, 'field direction flips at a change of ends');
  assert.ok(adapted.plays.slice(2).every((play) => play.stateBefore.quarter === 2), 'the drive continues in Q2');
  assert.equal(adapted.plays.at(-1).terminal, 'punt');
});

test('field-goal attempts show no result, no points and no next possession', () => {
  const adapted = adaptLpDriveRecord(load('own25_q1_900-seed2-field_goal_attempt.json'));
  const last = adapted.plays.at(-1);
  assert.equal(last.terminal, 'field_goal_attempt');
  assert.match(last.terminalText, /Outcome unknown/);
  assert.equal(last.stateAfter.offense_team, last.stateBefore.offense_team, 'no possession change is shown');
  assert.equal(last.stateAfter.yardline_100, null);
  assert.equal(last.outcome.yards_gained, null);
  assert.equal(last.outcome.touchdown, false);
  assert.equal('points' in last.outcome, false);
  assert.equal(JSON.stringify(adapted).includes('FG good'), false);
  assert.equal(JSON.stringify(adapted).includes('FG missed'), false);
});

test('halftime and end of regulation carry no restart and no winner', () => {
  const endpoint = adaptLpDriveRecord(load('own25_q2_120-seed1-halftime.json')).plays.at(-1);
  assert.equal(endpoint.field.after.los, null, 'no field endpoint at a half end (schema 1.1)');
  assert.equal(endpoint.field.after.dir, null);
  assert.ok(Number.isInteger(endpoint.outcome.final_play_yardline_100), 'the final play position is kept in outcome');
  assert.equal(endpoint.stateAfter.yardline_100, null);
  const half = adaptLpDriveRecord(load('own25_q2_120-seed1-halftime.json'));
  assert.match(half.plays.at(-1).terminalText, /No half-start kickoff is modelled/);
  assert.equal(half.plays.at(-1).stateAfter.down, null);
  assert.equal(half.plays.at(-1).stateAfter.yardline_100, null);
  const reg = adaptLpDriveRecord(load('own25_q4_150-seed1-end_of_regulation.json'));
  assert.match(reg.plays.at(-1).terminalText, /No winner, overtime or game result/);
});

test('nulls are preserved and never replaced by defaults', () => {
  const adapted = adaptLpDriveRecord(load('own25_q1_900-seed6-touchdown.json'));
  const play = adapted.plays[0];
  assert.equal(play.stateBefore.home_score, null);
  assert.equal(play.stateBefore.home_timeouts, null);
  assert.equal(play.outcome.passer_id, null);
  assert.ok(play.nullPaths.includes('state_before.home_score'));
  assert.ok(play.nullPaths.includes('outcome.rusher_id'));
  assert.equal(adapted.temporalEligibility.status, 'retrospective');
  assert.match(adapted.displayLabel, /RETROSPECTIVE/);
  assert.match(adapted.displayLabel, /NO SECOND-HALF KICKOFF MODELLED/);
});

test('the E0 single-play record is rejected by the drive viewer', () => {
  const e0 = JSON.parse(readFileSync(new URL('../docs/fixtures/nfl-seq-e0-play-record-seed1042.json', import.meta.url), 'utf8'));
  assert.throws(() => adaptLpDriveRecord(e0), /unsupported mode/);
});

function mutated(name, change) {
  const record = load(name);
  change(record);
  return record;
}

test('rejects single-play and full-game modes and any valid_full_game claim', () => {
  assert.throws(() => adaptLpDriveRecord(mutated('own25_q1_900-seed6-touchdown.json', (r) => { r.mode = 'single_play_statistical_demo'; })), /unsupported mode/);
  assert.throws(() => adaptLpDriveRecord(mutated('own25_q1_900-seed6-touchdown.json', (r) => { r.valid_full_game = true; })), /cannot claim valid_full_game=true/);
});

test('rejects end_of_period as a terminal', () => {
  const record = mutated('own25_q1_900-seed6-touchdown.json', (r) => {
    r.plays.at(-1).state_after.end_of_drive = 'end_of_period';
  });
  assert.throws(() => adaptLpDriveRecord(record), /superseded/);
});

test('rejects an unknown event type and does not coerce it to run', () => {
  const record = mutated('own25_q1_900-seed1-punt.json', (r) => { r.plays[0].event_type = 'kickoff'; });
  assert.throws(() => adaptLpDriveRecord(record), /unsupported: kickoff/);
  const fumble = mutated('own25_q1_900-seed1-punt.json', (r) => { r.plays[0].event_type = 'fumble'; });
  assert.throws(() => adaptLpDriveRecord(fumble), /unsupported: fumble/);
});

test('rejects a broken state chain', () => {
  const record = mutated('own25_q1_900-seed6-touchdown.json', (r) => { r.plays[1].state_before.down = 3; });
  assert.throws(() => adaptLpDriveRecord(record), /does not match the prior state_after/);
});

test('rejects duplicate play ids and out-of-order sequences', () => {
  const dup = mutated('own25_q1_900-seed6-touchdown.json', (r) => { r.plays[1].id = r.plays[0].id; });
  assert.throws(() => adaptLpDriveRecord(dup), /must be e1-seed|duplicate play id/);
  const order = mutated('own25_q1_900-seed6-touchdown.json', (r) => { r.plays[1].sequence = 3; r.plays[1].id = `${r.simulation_id}:3`; });
  assert.throws(() => adaptLpDriveRecord(order), /consecutive from 1/);
});

test('rejects a los that does not match its dir and yardline', () => {
  const record = mutated('own25_q1_900-seed1-punt.json', (r) => { r.plays[0].field.before.los = 99; });
  assert.throws(() => adaptLpDriveRecord(record), /does not match the stated dir and yardline_100/);
});

test('rejects a direction that contradicts the authored start and quarter changes', () => {
  const record = mutated('own25_q1_060-seed1-quarter_change_then_punt.json', (r) => {
    const play = r.plays[1];
    play.field.before.dir = -play.field.before.dir;
    play.field.before.los = 100 - play.field.before.los;
  });
  assert.throws(() => adaptLpDriveRecord(record), /inconsistent with the authored start/);
});

test('rejects a drive summary that does not match the plays', () => {
  const record = mutated('own25_q1_900-seed6-touchdown.json', (r) => { r.drive.yards += 1; });
  assert.throws(() => adaptLpDriveRecord(record), /drive\.yards does not match/);
});

test('rejects claims that sources are as-of verified or that the pool is not retrospective', () => {
  assert.throws(() => adaptLpDriveRecord(mutated('own25_q1_900-seed1-punt.json', (r) => { r.provenance.sources_as_of_verified = true; })), /sources_as_of_verified must be false/);
  assert.throws(() => adaptLpDriveRecord(mutated('own25_q1_900-seed1-punt.json', (r) => { r.outcome_pool.temporal_eligibility.status = 'as_of'; })), /must be retrospective/);
});

test('rejects participant identities and scores, which the record must not supply', () => {
  assert.throws(() => adaptLpDriveRecord(mutated('own25_q1_900-seed6-touchdown.json', (r) => { r.plays[0].outcome.rusher_id = 'x'; })), /must be null/);
  assert.throws(() => adaptLpDriveRecord(mutated('own25_q1_900-seed6-touchdown.json', (r) => { r.plays[0].state_before.home_score = 7; })), /must be null/);
});

test('rejects a punt with recorded yards and a field-goal attempt that shows a next possession', () => {
  assert.throws(() => adaptLpDriveRecord(mutated('own25_q1_900-seed1-punt.json', (r) => { r.plays.at(-1).outcome.yards_gained = 3; })), /must be null for punt/);
  const fg = mutated('own25_q1_900-seed2-field_goal_attempt.json', (r) => {
    const after = r.plays.at(-1).state_after;
    after.offense_team = r.plays.at(-1).state_before.defense_team;
  });
  assert.throws(() => adaptLpDriveRecord(fg), /must not show a next possession|does not match the turnover or punt flag/);
});

test('rejects a last play with no terminal', () => {
  const record = mutated('own25_q1_900-seed6-touchdown.json', (r) => { delete r.plays.at(-1).state_after.end_of_drive; });
  assert.throws(() => adaptLpDriveRecord(record), /must end the drive|touchdown flag and terminal disagree/);
});

test('rejects a terminal that appears before the last play', () => {
  const record = mutated('own25_q1_900-seed6-touchdown.json', (r) => { r.plays[0].state_after.end_of_drive = 'touchdown'; });
  assert.throws(() => adaptLpDriveRecord(record), /only the last play may end the drive|touchdown flag and terminal disagree/);
});

test('a field endpoint at a half end is rejected (schema 1.1 requires null)', () => {
  const record = mutated('own25_q2_120-seed1-halftime.json', (r) => {
    r.plays.at(-1).field.after.dir = 1;
    r.plays.at(-1).field.after.los = 1;
  });
  assert.throws(() => adaptLpDriveRecord(record), /must be null when the state has no position/);
});

test('a field endpoint at any terminal with no scrimmage state is rejected', () => {
  const record = mutated('own5_q1_900-seed14-safety.json', (r) => {
    r.plays.at(-1).field.after.dir = 1;
    r.plays.at(-1).field.after.los = 1;
  });
  assert.throws(() => adaptLpDriveRecord(record), /must be null when the state has no position/);
});

test('accepts schema 1.0 and 1.1 and rejects any other version', () => {
  for (const version of ['1.0', '1.1']) {
    const record = mutated('own25_q1_900-seed1-punt.json', (r) => { r.schema_version = version; });
    assert.equal(adaptLpDriveRecord(record).status, 'accepted_for_read_only_display', version);
  }
  assert.throws(() => adaptLpDriveRecord(mutated('own25_q1_900-seed1-punt.json', (r) => { r.schema_version = '2.0'; })),
    /unsupported schema_version/);
});

test('the E1 record is rejected by the E0a single-play viewer', async () => {
  const { adaptLpPlayRecord } = await import('../web/lp-play-record-adapter.js');
  assert.throws(() => adaptLpPlayRecord(load('own25_q1_900-seed1-punt.json')), /unsupported (schema_version|mode)/);
});
