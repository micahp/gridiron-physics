import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { simulatePlay } from '../engine/play.js';
import { assertFootballInvariant } from './football-assertion.mjs';

const source = readFileSync(new URL('../engine/play.js', import.meta.url));
const sourceSha256 = createHash('sha256').update(source).digest('hex');
const sourceHashes = { 'play.js': sourceSha256 };
const ratings = Object.fromEntries(
  ['SPD', 'ACC', 'AGI', 'STR', 'AWR', 'PBK', 'RBK', 'PMV', 'FMV', 'BSH'].map((key) => [key, 60]),
);
const qb = {
  id: 'QB1', name: 'Test QB', ratings,
  physics: { mass: 100, radius: 0.4, vmax: 7, f0: 600, drive: 500, alat: 5, reach: 1 },
};

function spike(extra = {}) {
  return simulatePlay({ players: { QB1: qb } }, {
    kind: 'spike', id: 'synthetic-spike', off: 'O', def: 'D', dir: 1, los: 50,
    lineup: { O: { QB: 'QB1' }, D: {} }, ...extra,
  });
}

function check(passes, seed, decision, outcome, state_after, violated_assertion) {
  assertFootballInvariant(passes, {
    failure_class: 'ILLEGAL_STATE', game_id: 'synthetic-spike', seed, play_index: 1,
    state_before: { yardline_100: 50, offense_direction: 1 }, decision,
    outcome, state_after, violated_assertion, source_artifact_hashes: sourceHashes,
  });
}

function spikeIsLegal(run) {
  const event = run.events.find((item) => item.type === 'spike');
  return run.end.reason === 'spike'
    && event?.pass_attempt === true
    && event?.forward_pass === true
    && event?.incomplete === true
    && event?.yards_gained === 0
    && event?.passing_yards === 0
    && event?.receiver_id === null
    && event?.receiving_yards === 0
    && event?.first_down === false
    && run.end.x <= 50;
}

for (const extra of [{ td: true }, { scoring: true }]) {
  let outcome = null;
  let error = null;
  try { outcome = spike(extra); } catch (caught) { error = caught; }
  const observed = error ? { name: error.name, message: error.message } : outcome?.end;
  check(error instanceof RangeError
    && error.message === 'QB spike cannot be marked as a touchdown or scoring play',
  `spike-invalid-${JSON.stringify(extra)}`, { kind: 'spike', ...extra }, observed,
  error ? 'play_not_created' : outcome?.end, 'a spike cannot be scored');
}

const result = spike();
check(spikeIsLegal(result)
  && result.events.map((event) => event.type).join(',') === 'snap,spike,whistle'
  && result.events[1].by === 'QB1'
  && result.events.at(-1).type === 'whistle'
  && !result.events.some((event) => ['catch', 'touchdown', 'tackle', 'scramble'].includes(event.type)),
'spike-50', { kind: 'spike' }, result.events, result.end,
'a spike is an incomplete dead ball with one pass attempt, zero credited yards, no target or first down, and no later action');

// A deliberately mutated event must fail the same invariant with its evidence.
const mutated = {
  ...result,
  events: result.events.map((event) => event.type === 'spike'
    ? { ...event, pass_attempt: false, first_down: true, receiving_yards: 4 }
    : event),
};
let mutationError = null;
try {
  check(spikeIsLegal(mutated), 'spike-mutation-missing-attempt', { kind: 'spike', mutation: 'attempt_and_credit' },
    mutated.events, mutated.end,
    'a spike must retain its official attempt and zero-yard incomplete accounting');
} catch (error) {
  mutationError = error;
}
check(mutationError?.name === 'FootballInvariantError'
  && mutationError.failure?.failure_class === 'ILLEGAL_STATE'
  && mutationError.failure?.game_id === 'synthetic-spike'
  && mutationError.failure?.seed === 'spike-mutation-missing-attempt'
  && mutationError.failure?.play_index === 1
  && mutationError.failure?.state_before?.yardline_100 === 50
  && mutationError.failure?.decision?.mutation === 'attempt_and_credit'
  && mutationError.failure?.source_artifact_hashes?.['play.js'],
'spike-mutation-evidence', { kind: 'spike', mutation: 'attempt_and_credit' },
mutationError?.failure ?? { error_name: mutationError?.name ?? null }, mutated.end,
'the deliberate spike mutation must fail with the full football assertion envelope');

console.log('spike rules ok: dead-ball incomplete semantics and scoring flags rejected');
