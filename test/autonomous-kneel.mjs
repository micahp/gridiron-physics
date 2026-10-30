import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { simulatePlay } from '../engine/play.js';
import { assertFootballInvariant } from './football-assertion.mjs';

const playSource = readFileSync(new URL('../engine/play.js', import.meta.url));
const sourceSha256 = createHash('sha256').update(playSource).digest('hex');
const sourceHashes = { 'play.js': sourceSha256 };

const ratings = Object.fromEntries(
  ['SPD', 'ACC', 'AGI', 'STR', 'AWR', 'PBK', 'RBK', 'PMV', 'FMV', 'BSH'].map((key) => [key, 60]),
);
const qb = {
  id: 'QB1',
  name: 'Test QB',
  ratings,
  physics: { mass: 100, radius: 0.4, vmax: 7, f0: 600, drive: 500, alat: 5, reach: 1 },
};

function kneel({ los, gain, td = false, scoring = false, dir = 1 }) {
  return simulatePlay({ players: { QB1: qb } }, {
    kind: 'kneel', id: `kneel-${dir}-${los}-${gain}`, off: 'O', def: 'D', dir, los,
    lineup: { O: { QB: 'QB1' }, D: {} }, gain, td, scoring,
  });
}

function check(passes, input, violated_assertion, outcome, state_after = 'play_result_observed') {
  assertFootballInvariant(passes, {
    failure_class: 'ILLEGAL_STATE', game_id: 'synthetic-kneel',
    seed: `kneel-${input.dir ?? 1}-${input.los}-${input.gain ?? 'default'}`, play_index: 1,
    state_before: { yardline_100: input.los, offense_direction: input.dir ?? 1 },
    decision: { kind: 'kneel', gain: input.gain, touchdown_flag: !!input.td,
      scoring_flag: !!input.scoring },
    outcome, state_after, violated_assertion, source_artifact_hashes: sourceHashes,
  });
}

function expectRejected(input, expectedMessage, assertion) {
  let result = null;
  let error = null;
  try { result = kneel(input); } catch (caught) { error = caught; }
  const outcome = error ? { status: 'rejected', name: error.name, message: error.message }
    : { status: 'accepted', reason: result?.end?.reason ?? null, spot: result?.end ?? null };
  check(error instanceof RangeError && expectedMessage.test(error.message), input, assertion, outcome,
    error ? 'play_not_created' : result?.end ?? 'play_created');
}

expectRejected({ los: 50, gain: 3 }, /nonpositive/, 'a kneel with positive gain is rejected');
expectRejected({ los: 50, gain: -1, td: true }, /cannot be marked/, 'a kneel cannot be marked as a touchdown');
expectRejected({ los: 50, gain: -1, scoring: true }, /cannot be marked/, 'a kneel cannot be marked as a scoring play');

const ordinary = kneel({ los: 50, gain: -1 });
check(ordinary.end.reason === 'kneel' && ordinary.end.x <= 50
  && ordinary.events.at(-1).type === 'whistle'
  && !ordinary.events.some((event) => ['touchdown', 'catch', 'throw', 'tackle', 'scramble'].includes(event.type)),
{ los: 50, gain: -1 }, 'a normal kneel is a nonpositive dead-ball rush with no later action',
{ reason: ordinary.end.reason, spot: ordinary.end, events: ordinary.events }, ordinary.end);

// A negative gain that enters the offense's own end zone is a legal safety.
const safetyKneel = kneel({ los: 1, gain: -1 });
check(safetyKneel.end.reason === 'kneel' && safetyKneel.expectEndX === 0,
  { los: 1, gain: -1 }, 'reaching the goal line is not by itself a safety', safetyKneel.end,
  safetyKneel.end);
const safetyPastGoalLine = kneel({ los: 1, gain: -2 });
check(safetyPastGoalLine.end.reason === 'safety' && safetyPastGoalLine.expectEndX === 0,
  { los: 1, gain: -2 }, 'a kneel through the own goal line is a safety spotted on the goal line',
  safetyPastGoalLine.end, safetyPastGoalLine.end);
const safetyAttackingLeft = kneel({ los: 99, gain: -2, dir: -1 });
check(safetyAttackingLeft.end.reason === 'safety' && safetyAttackingLeft.expectEndX === 100,
  { los: 99, gain: -2, dir: -1 }, 'the safety rule also applies while attacking left',
  safetyAttackingLeft.end, safetyAttackingLeft.end);
console.log('kneel rules ok: illegal scoring/gain rejected, dead ball, and safety both directions');
