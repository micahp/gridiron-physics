import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { simulatePlay } from '../engine/play.js';

const playSource = readFileSync(new URL('../engine/play.js', import.meta.url));
const sourceSha256 = createHash('sha256').update(playSource).digest('hex');

const ratings = Object.fromEntries(
  ['SPD', 'ACC', 'AGI', 'STR', 'AWR', 'PBK', 'RBK', 'PMV', 'FMV', 'BSH'].map((key) => [key, 60]),
);
const qb = {
  id: 'QB1',
  name: 'Test QB',
  ratings,
  physics: { mass: 100, radius: 0.4, vmax: 7, f0: 600, drive: 500, alat: 5, reach: 1 },
};

function kneel({ los, gain, td = false }) {
  return simulatePlay({ players: { QB1: qb } }, {
    kind: 'kneel', id: `kneel-${los}-${gain}`, off: 'O', def: 'D', dir: 1, los,
    lineup: { O: { QB: 'QB1' }, D: {} }, gain, td,
  });
}

const ordinary = kneel({ los: 50, gain: 3, td: true });
const failures = [];
const check = (passes, assertion, context) => {
  if (!passes) failures.push({
    failure_class: 'ILLEGAL_STATE', assertion,
    game_id: 'synthetic-kneel', seed: 'kneel-50-positive-3', play_index: 1,
    state_before: { yardline_100: 50, offense_direction: 1 },
    decision: { kind: 'kneel', gain: 3, touchdown_flag: true },
    outcome: { reason: ordinary.end.reason, spot: ordinary.end, expected_end_x: ordinary.expectEndX },
    state_after: context,
    source_artifact_hashes: { play_js_sha256: sourceSha256 },
  });
};
check(ordinary.end.reason === 'kneel', 'the play ends when the QB is down', ordinary.end);
check(ordinary.end.x <= 50, `ordinary kneel must not gain yards (ended at ${ordinary.end.x})`, ordinary.end);
check(ordinary.events.at(-1).type === 'whistle', 'the dead-ball whistle is terminal', ordinary.end);
check(!ordinary.events.some((event) => ['touchdown', 'catch', 'throw', 'tackle', 'scramble'].includes(event.type)),
  'a knee-down cannot score, pass, tackle or scramble afterward', ordinary.end);

// Keep the legal negative-yardage special case available at the offense's goal line.
const safetyKneel = kneel({ los: 1, gain: -1 });
assert.equal(safetyKneel.end.reason, 'kneel');
assert.equal(safetyKneel.expectEndX, 0);

assert.equal(failures.length, 0, `ILLEGAL_STATE assertion failures: ${JSON.stringify(failures)}`);
console.log('kneel rules ok: dead ball, nonpositive gain, and own-goal-line safety setup remains allowed');
