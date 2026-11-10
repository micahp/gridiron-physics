import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveAssignedFieldSpot } from '../web/field-end-assignment.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const fixturePath = (name) => resolve(root, 'test/fixtures/field-end-assignment', name);
const readFixture = async (name) => JSON.parse(await readFile(fixturePath(name), 'utf8'));
let checks = 0;
const check = (fn) => {
  fn();
  checks += 1;
};

for (const name of ['plus.json', 'minus.json']) {
  const fixture = await readFixture(name);
  const { team_id: teamId, period, yardline_100: yardline100, expected_dir: dir, expected_los: los } = fixture.case;
  check(() => assert.deepEqual(
    resolveAssignedFieldSpot({ assignment: fixture, teamId, period, yardline100 }),
    { dir, los },
  ));
}

const plus = await readFixture('plus.json');
check(() => assert.deepEqual(
  resolveAssignedFieldSpot({ assignment: plus, teamId: 'CHI', period: 'Q2', yardline100: 28 }),
  { dir: -1, los: 28 },
));

const missingPeriod = await readFixture('missing-period.json');
check(() => assert.throws(
  () => resolveAssignedFieldSpot({ assignment: missingPeriod, teamId: 'NE', period: 'Q2', yardline100: 28 }),
  /No versioned field-end assignment exists for team NE in Q2/,
));

const implicitHomeAway = await readFixture('implicit-home-away.json');
check(() => assert.throws(
  () => resolveAssignedFieldSpot({ assignment: implicitHomeAway, teamId: 'NE', period: 'Q2', yardline100: 28 }),
  /Implicit home\/away field direction is not accepted/,
));

check(() => assert.throws(
  () => resolveAssignedFieldSpot({ assignment: { ...plus, assignment_version: undefined }, teamId: 'NE', period: 'Q2', yardline100: 28 }),
  /Unsupported or missing field-end assignment version/,
));
check(() => assert.throws(
  () => resolveAssignedFieldSpot({ assignment: plus, teamId: 'home', period: 'Q2', yardline100: 28 }),
  /An actual team ID is required/,
));
check(() => assert.throws(
  () => resolveAssignedFieldSpot({ assignment: plus, teamId: 'NE', period: 'Q2', yardline100: 101 }),
  /yardline_100 must be a finite value/,
));

console.log(`Field-end assignment: ${checks}/${checks} checks passed`);
console.log('Plus fixture: Q2 NE dir=+1, yardline_100=28 -> los=72');
console.log('Minus fixture: Q2 NYG dir=-1, yardline_100=28 -> los=28');
console.log('Rejections: missing team-period assignment, implicit home/away direction, missing version, home/away pseudo-team ID, out-of-range yardline_100');
