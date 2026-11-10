import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPlayProjectionMatchesRecord, projectPlay } from '../web/e2-real-record-model.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const pin = JSON.parse(await readFile(resolve(root, 'docs/fixtures/e2/real-record-pin.json'), 'utf8'));
const lpRepo = process.env.LP_SEQUENCE_REPO;
assert.ok(lpRepo, 'Set LP_SEQUENCE_REPO to the read-only Legendary Picks checkout');
const sourceBytes = execFileSync('git', ['-C', lpRepo, 'show', `${pin.lp_commit}:${pin.lp_artifact_path}`]);
const sourceHash = createHash('sha256').update(sourceBytes).digest('hex');
assert.equal(sourceHash, pin.lp_artifact_sha256, 'direct LP Git artifact SHA must equal the repin manifest');
assert.equal(sourceHash, createHash('sha256')
  .update(await readFile(resolve(root, pin.local_snapshot_path))).digest('hex'), 'checked-in static snapshot must be byte-identical');
const payload = JSON.parse(sourceBytes.toString('utf8'));
const { record } = payload;
assert.equal(record.valid_full_game, false);
assert.equal(payload.valid_full_game, false);

function expectedFromRaw(drive, play, gameRecord) {
  const state = (source) => Object.fromEntries([
    'quarter', 'clock_seconds', 'down', 'yards_to_go', 'yardline_100',
    'offense_team', 'defense_team', 'home_score', 'away_score', 'drive_index',
  ].map((key) => [key, source[key] ?? null]));
  return {
    game_mode: gameRecord.mode,
    final_points: { A: gameRecord.points.A, B: gameRecord.points.B },
    drive_index: drive.index,
    play_sequence: play.sequence,
    play_id: play.id,
    event_type: play.event_type,
    outcome_yards_gained: play.outcome.yards_gained ?? null,
    before: state(play.state_before),
    after: state(play.state_after),
    three_d_replay_available: false,
  };
}

let playCount = 0;
let clockChecks = 0;
let quarterChecks = 0;
let scoreChecks = 0;
let driveIndexChecks = 0;
let possessionChecks = 0;
let downDistanceChecks = 0;
let spotChecks = 0;
for (const drive of record.drives) {
  assert.equal(drive.index, record.drives.indexOf(drive) + 1);
  for (const play of drive.plays) {
    const projected = projectPlay(record, drive, play);
    assert.deepEqual(projected, expectedFromRaw(drive, play, record), `LP play ${play.id}`);
    assert.equal(assertPlayProjectionMatchesRecord(record, drive, play, projected), true);
    assert.equal(projected.drive_index, drive.index, `container drive index for ${play.id}`);
    assert.equal(projected.before.drive_index, drive.index, `state_before drive index for ${play.id}`);
    assert.equal(projected.after.drive_index, drive.index, `state_after drive index for ${play.id}`);
    playCount += 1;
    clockChecks += 2;
    quarterChecks += 2;
    scoreChecks += 4;
    driveIndexChecks += 3;
    possessionChecks += 4;
    downDistanceChecks += 4;
    spotChecks += 2;
  }
}
assert.equal(record.drives.length, pin.drive_count);
assert.equal(playCount, pin.play_count);
assert.deepEqual(record.points, pin.points);

const negative = JSON.parse(await readFile(resolve(root, 'docs/fixtures/e2/real-record-reconciliation-negative.json'), 'utf8'));
const firstDrive = record.drives[0];
const firstPlay = firstDrive.plays[0];
for (const fixture of negative.fixtures) {
  if (fixture.target.startsWith('projection.')) {
    const projection = structuredClone(projectPlay(record, firstDrive, firstPlay));
    const [, phase, field] = fixture.target.split('.');
    projection[phase][field] += fixture.delta;
    assert.throws(
      () => assertPlayProjectionMatchesRecord(record, firstDrive, firstPlay, projection),
      /differs from the LP record/,
      fixture.name,
    );
  } else if (fixture.target === 'record.state_before.drive_index') {
    const tamperedPlay = structuredClone(firstPlay);
    tamperedPlay.state_before.drive_index += fixture.delta;
    const tamperedProjection = projectPlay(record, firstDrive, tamperedPlay);
    assert.throws(
      () => assertPlayProjectionMatchesRecord(record, firstDrive, tamperedPlay, tamperedProjection),
      /drive index mismatch/,
      fixture.name,
    );
  } else {
    assert.fail(`unknown negative fixture target: ${fixture.target}`);
  }
}

console.log(`PASS direct LP artifact ${pin.lp_commit}:${pin.lp_artifact_path} sha256=${sourceHash}`);
console.log(`PASS rendered projection reconciled: drives=${record.drives.length}/${pin.drive_count}, plays=${playCount}/${pin.play_count}`);
console.log(`PASS exact field checks: clock=${clockChecks} quarter=${quarterChecks} score=${scoreChecks} drive_index=${driveIndexChecks} possession=${possessionChecks} down_distance=${downDistanceChecks} ball_spot=${spotChecks}`);
console.log(`PASS negative fixtures rejected: ${negative.fixtures.map((fixture) => fixture.name).join(', ')}`);
