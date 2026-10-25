import assert from 'node:assert/strict';
import { validatePlayInput, PLAY_SCHEMA, PROHIBITED_FIELDS, assertNoOutcomeFields } from '../engine/autonomous/schema.js';
import { buildSampleCall } from './autonomous-fixtures.mjs';

const sample = buildSampleCall();
const call = validatePlayInput(sample);
assert.equal(call.seed, '1042');
assert.equal(call.offense.family, 'run');
assert.equal(call.defense.frontKey, 'nickel_over');
assert.equal(call.profiles.size, 22, 'every declared player needs a profile');

// 11 per side, unique ids, both teams present.
const ids = [...Object.values(call.offense.lineup), ...Object.values(call.defense.lineup)];
assert.equal(ids.length, 22);
assert.equal(new Set(ids).size, 22);

// Any realized outcome in the payload is refused, at any depth.
for (const field of ['gain', 'endX', 'endY', 'tacklers', 'sackers', 'complete', 'touchdown', 'interceptor', 'outcome_anchor']) {
  assert.throws(() => validatePlayInput({ ...sample, [field]: 1 }), /prohibited outcome field/);
}
assert.throws(() => validatePlayInput({ ...sample, situation: { ...sample.situation, future_tracking: [] } }), /prohibited outcome field/);
assert.throws(() => validatePlayInput({ ...sample, offense: { ...sample.offense, call: { ...sample.offense.call, expected_gain: 4 } } }), /prohibited outcome field/);
assert.throws(() => assertNoOutcomeFields({ a: [{ b: { outcome: 1 } }] }), /prohibited outcome field/);
assert.ok(PROHIBITED_FIELDS.includes('endX'));

// Structural rejections.
const mutate = (fn) => { const next = structuredClone(sample); fn(next); return next; };
assert.throws(() => validatePlayInput(mutate((s) => { s.schema_version = 'gridiron.autonomous-play.v0'; })), /schema_version/);
assert.throws(() => validatePlayInput(mutate((s) => { s.mode = 'historical'; })), /mode must be/);
assert.throws(() => validatePlayInput(mutate((s) => { delete s.offense.lineup.WR3; })), /exactly 11/);
assert.throws(() => validatePlayInput(mutate((s) => { s.defense.lineup.NB = s.offense.lineup.QB; })), /must be unique/);
assert.throws(() => validatePlayInput(mutate((s) => { s.offense.team = s.defense.team; })), /different teams/);
assert.throws(() => validatePlayInput(mutate((s) => { s.situation.offense_direction = 0; })), /offense_direction/);
assert.throws(() => validatePlayInput(mutate((s) => { s.situation.yardline_100 = 0; })), /yardline_100/);
assert.throws(() => validatePlayInput(mutate((s) => { s.offense.call.concept = 'four_verts'; })), /unsupported offensive concept/);
assert.throws(() => validatePlayInput(mutate((s) => { s.defense.call.front = 'dime_stack'; })), /unsupported defensive front/);
assert.throws(() => validatePlayInput(mutate((s) => { s.defense.call.coverage = 'cover_0'; })), /unsupported coverage/);
assert.throws(() => validatePlayInput(mutate((s) => { delete s.player_profiles[s.offense.lineup.TE]; })), /required for every declared player/);
assert.throws(() => validatePlayInput(mutate((s) => { s.player_profiles[s.offense.lineup.TE].physics.vmax = Number.NaN; })), /finite/);
assert.throws(() => validatePlayInput(mutate((s) => { s.player_profiles[s.offense.lineup.TE].physics.mass = 500; })), /50 to 200/);
assert.throws(() => validatePlayInput(mutate((s) => { s.player_profiles[s.offense.lineup.TE].ratings.SPD = 120; })), /1 to 99/);
assert.throws(() => validatePlayInput(mutate((s) => { s.player_profiles[s.offense.lineup.TE].ratings.FAKE = 50; })), /unsupported rating/);
assert.throws(() => validatePlayInput(mutate((s) => { s.offense.formation = 'trips'; })), /singleback_11/);
assert.throws(() => validatePlayInput(mutate((s) => { s.offense.call.snap_type = 'pistol'; })), /snap type/);

// The passing branch validates too, including its shotgun requirement.
const pass = buildSampleCall({ family: 'pass', concept: 'slant_flat', snap_type: 'shotgun', coverage: 'cover_3' });
const passCall = validatePlayInput(pass);
assert.equal(passCall.offense.family, 'pass');
assert.equal(passCall.defense.coverage, 'cover_3');
assert.throws(() => validatePlayInput({ ...pass, offense: { ...pass.offense, call: { ...pass.offense.call, snap_type: 'under_center' } } }), /shotgun/);
assert.throws(
  () => validatePlayInput({ ...sample, offense: { ...sample.offense, call: { ...sample.offense.call, family: 'pass', concept: 'inside_zone' } } }),
  /passing concept|running concept/,
);

console.log('autonomous schema ok: 22 unique profiles, outcome fields refused at any depth, unsupported calls rejected');
