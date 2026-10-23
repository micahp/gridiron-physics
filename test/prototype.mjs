import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { simulatePlay } from '../engine/play.js';
import { buildLineups, createDemoScenario, selectPlay, validateDemoSnapshot, validateLineups } from '../web/prototype-model.js';
import { executeSelectedPlay } from '../web/prototype-execution.js';

const snapshot = JSON.parse(readFileSync(new URL('../data/teams/matchup-2026-10-22.json', import.meta.url)));
const coaching = JSON.parse(readFileSync(new URL('../data/teams/coaching-continuity-2026-10-22.json', import.meta.url)));
const playbooks = Object.fromEntries(['NE', 'CHI'].map((id) => [id,
  JSON.parse(readFileSync(new URL(`../data/playbooks/${id}-2025.json`, import.meta.url)))]));
assert.equal(validateDemoSnapshot(snapshot), true);
assert.equal(snapshot.snapshot.post_kickoff_information_included, false);
assert.equal(coaching.teams.NE.head_coach['2025'], coaching.teams.NE.head_coach['2026']);
assert.equal(coaching.teams.NE.defense.coordinator['2025'].startsWith('Terrell Williams'), true);
assert.equal(coaching.teams.NE.defense.play_caller['2025'], 'Zak Kuhr from Week 2 onward; Williams was the original DC');
assert.equal(coaching.teams.CHI.offense.coordinator['2025'], 'Declan Doyle');
assert.equal(coaching.teams.CHI.offense.coordinator['2026'], 'Press Taylor');
assert.equal(coaching.teams.CHI.offense.play_caller['2025'], coaching.teams.CHI.offense.play_caller['2026']);
assert.deepEqual(coaching.continuity_model['2026_adjustments_applied'], []);

for (const teamId of ['NE', 'CHI']) {
  const book = playbooks[teamId];
  assert.deepEqual(book.provenance_categories, ['observed_2025', 'observed_2026_pre_game', 'historical_coach', 'inferred_concept', 'synthetic_variation']);
  assert.equal(book.sampling_controls.historical_coach.enabled, false);
  assert.equal(book.sampling_controls.synthetic_variation.enabled, false);
  const offense = book.offense.profile;
  assert.equal(book.coverage.eligible_offense_scrimmage_plays, book.offense.observed_plays.length);
  assert.equal(offense.run_play_count + offense.pass_play_count_including_sacks, offense.eligible_scrimmage_plays);
  for (const distribution of [offense.run_pass, offense.formation, offense.personnel_code, offense.shotgun,
    offense.run_location, offense.run_gap, offense.pass_location, offense.pass_depth, offense.play_action, offense.motion]) {
    assert.equal(distribution.observed + distribution.missing, distribution.denominator);
    assert.ok(book.provenance_categories.includes(distribution.provenance));
    assert.equal(Object.values(distribution.categories).reduce((n, x) => n + x.count, 0), distribution.observed);
    for (const category of Object.values(distribution.categories)) assert.equal(category.source_ids.length, category.count);
  }
  assert.equal(offense.play_action.observed, 0, 'PBP schema does not expose play-action labels');
  assert.equal(offense.motion.observed, 0, 'PBP schema does not expose motion labels');
  for (const kind of ['run', 'pass']) {
    const catalog = book.offense.play_candidates[kind];
    assert.equal(catalog.eligible_action_plays, kind === 'run' ? offense.run_play_count : offense.pass_play_count_including_sacks);
    assert.equal(catalog.classified_plays + catalog.missing_or_unclassified, catalog.eligible_action_plays);
    assert.equal(catalog.candidates.reduce((n, item) => n + item.count, 0), catalog.classified_plays);
    assert.equal(new Set(catalog.candidates.map((item) => item.candidate_id)).size, catalog.candidates.length);
    for (const item of catalog.candidates) {
      assert.equal(item.provenance, 'observed_2025');
      assert.equal(item.source_ids.length, item.count);
      assert.equal(item.action, kind);
      assert.equal(item.denominator, catalog.eligible_action_plays);
      assert.ok(item.attributes.formation);
      assert.equal(typeof item.attributes.shotgun, 'boolean');
      assert.ok(!('yards_gained' in item) && !('outcome_label' in item));
    }
  }
  assert.equal(book.coverage.offense_participation_joined + book.coverage.offense_participation_missing,
    book.coverage.eligible_offense_scrimmage_plays);
  assert.equal(book.coverage.defense_participation_joined + book.coverage.defense_participation_missing,
    book.coverage.eligible_defense_scrimmage_plays);
  assert.ok(book.pregame_2026_comparison.eligible_plays > 0);
  assert.ok(book.pregame_2026_comparison.source_ids.every((x) => Number(x.game_id.split('_')[1]) <= 6));
}

function scenario(teamId, kind, seed = 'repeatable-demo') {
  const opponent = teamId === 'NE' ? 'CHI' : 'NE';
  const candidate = playbooks[teamId].offense.play_candidates[kind].candidates[0];
  const formation = candidate.attributes.formation;
  return createDemoScenario({ offenseId: teamId, defenseId: opponent, teams: snapshot.teams,
    playbooks, kind, formation, candidateId: candidate.candidate_id, seed, los: 45, dir: 1 });
}

const digest = (record) => {
  const hash = createHash('sha256');
  for (const frame of record.frames) hash.update(Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength));
  return hash.digest('hex');
};
const outputs = {};
for (const teamId of ['NE', 'CHI']) {
  for (const kind of ['run', 'pass']) {
    const a = scenario(teamId, kind);
    const b = scenario(teamId, kind);
    const O = a.lineups.offense, D = a.lineups.defense;
    assert.equal(Object.keys(O).length, 11);
    assert.equal(Object.keys(D).length, 11);
    assert.equal(new Set([...Object.values(O), ...Object.values(D)]).size, 22);
    assert.ok(Object.values(O).every((id) => snapshot.teams[teamId].roster.some((p) => p.id === id && p.availability === 'available')));
    assert.ok(Object.values(D).every((id) => snapshot.teams[a.play.def].roster.some((p) => p.id === id && p.availability === 'available')));
    assert.deepEqual(a.play, b.play, 'same team, formation, action and seed must select the same play inputs');
    assert.equal(a.selection.provenance, 'synthetic_variation');
    assert.deepEqual(a.selection.selector, { id: 'mock_historical_playbook_sampler.v1', status: 'mock', predictive: false });
    assert.equal(a.selection.playbook_entry.provenance, 'observed_2025');
    assert.equal(a.selection.playbook_entry.candidate_id, a.play.id.split(':').at(-1));
    assert.equal(a.selection.playbook_entry.attributes.formation, a.selection.formation_reference);
    assert.equal(a.play.shotgun, a.selection.playbook_entry.attributes.shotgun);
    assert.equal(a.selection.playbook_entry.source_ids.length, a.selection.playbook_entry.count);
    assert.equal(a.execution_contract.predictive_success, false);
    assert.equal(a.execution_contract.outcome_mode, 'free');
    assert.equal(a.execution_contract.hidden_historical_outcome_constraints, false);
    assert.equal(a.action_policy_inputs.outcome_anchor, null);
    assert.ok(a.selection.formation_observation.source_ids.length > 0);
    if (kind === 'run') {
      assert.equal(a.play.loc, a.selection.playbook_entry.attributes.run_location);
      assert.equal(a.play.gap, a.selection.playbook_entry.attributes.run_gap);
      assert.equal(a.play.outcome_mode, 'free');
      for (const key of ['gain', 'tacklers', 'end', 'endX', 'td', 'oob']) assert.ok(!(key in a.play));
      assert.ok(!('tacklers' in a.play));
    } else {
      assert.equal(a.play.loc, a.selection.playbook_entry.attributes.pass_location);
      assert.equal(a.play.kind, 'pass');
      assert.equal(a.play.outcome_mode, 'free');
      assert.ok(['go', 'curl', 'out', 'dig', 'slant', 'post', 'seam', 'flat'].includes(a.play.target_route));
      assert.equal(a.selection.selected_draws.depth, a.selection.playbook_entry.attributes.pass_length);
      for (const key of ['gain', 'tacklers', 'defender', 'interceptor', 'end', 'catchX', 'endX', 'complete_pass']) assert.ok(!(key in a.play));
    }
    const resultA = simulatePlay({ players: a.players }, a.play);
    const resultB = simulatePlay({ players: b.players }, b.play);
    assert.ok(resultA && resultA.frames.length > 2);
    assert.notEqual(resultA.end.reason, 'timeout_sim');
    assert.equal(resultA.expectEndX, null, 'free execution must not report a historical expected end spot');
    assert.equal(digest(resultA), digest(resultB), 'same seed must reproduce the physical trajectory');
    assert.deepEqual(resultA.end, resultB.end);
    const physicalA = executeSelectedPlay(a), physicalB = executeSelectedPlay(b);
    assert.equal(physicalA.schema_version, 'gridiron.play_execution.v1');
    assert.equal(physicalA.status, 'free_physics_mock_selector');
    assert.equal(physicalA.predictive_success, false);
    assert.equal(physicalA.failure, null);
    assert.equal(physicalA.trajectory.frames.length, physicalA.record.frames.length);
    assert.deepEqual(physicalA.interactions, physicalA.record.events);
    assert.deepEqual(physicalA.resulting_state, physicalA.record.end);
    assert.equal(digest(physicalA.record), digest(physicalB.record));
    outputs[`${teamId}-${kind}`] = { demo: a, result: resultA };
  }
}

// Switching the selector swaps roster IDs, not just names or uniforms.
assert.notDeepEqual(outputs['NE-run'].demo.lineups.offense, outputs['CHI-run'].demo.lineups.offense);
assert.notEqual(outputs['NE-run'].demo.play.off, outputs['NE-run'].demo.play.def);
assert.equal(outputs['NE-run'].demo.selection.formation_observation.count,
  playbooks.NE.offense.profile.formation.categories[outputs['NE-run'].demo.selection.formation_reference].count);

const seedA = scenario('NE', 'run', 'seed-A');
const seedB = scenario('NE', 'run', 'seed-B');
assert.ok(!('gain' in seedA.play) && !('gain' in seedB.play), 'free run scenarios do not contain a gain anchor');
assert.notEqual(seedA.play.id, seedB.play.id);
const freeRunA = simulatePlay({ players: seedA.players }, seedA.play);
const freeRunB = simulatePlay({ players: seedB.players }, seedB.play);
assert.notEqual(digest(freeRunA), digest(freeRunB), 'different seeds must change unconstrained run trajectories');
assert.notEqual(freeRunA.end.x, freeRunB.end.x, 'run end spots must emerge from the physical scenario');
assert.equal(simulatePlay({ players: seedA.players }, { ...seedA.play, gain: 4 }), null,
  'free mode rejects a supplied yardage anchor');

// Sanity sample the temporary selector against physical catch windows. This
// is an integration smoke test, not a model evaluation or calibration claim.
for (const teamId of ['NE', 'CHI']) {
  const candidate = playbooks[teamId].offense.play_candidates.pass.candidates[0];
  const eventsSeen = new Set();
  for (let i = 0; i < 12; i++) {
    const demo = createDemoScenario({ offenseId: teamId, defenseId: teamId === 'NE' ? 'CHI' : 'NE',
      teams: snapshot.teams, playbooks, kind: 'pass', formation: candidate.attributes.formation,
      candidateId: candidate.candidate_id, seed: `pass-outcome-${i}`, los: 45, dir: 1 });
    const result = simulatePlay({ players: demo.players }, demo.play);
    assert.equal(result.expectEndX, null);
    for (const event of result.events) if (['catch', 'interception', 'drop', 'pass_breakup', 'incomplete', 'sack'].includes(event.type)) eventsSeen.add(event.type);
  }
  assert.ok(eventsSeen.has('catch'), `${teamId} free pass sampler should produce a physical catch in the smoke sample`);
  assert.ok([...eventsSeen].some((event) => event !== 'catch'), `${teamId} free pass sampler should retain non-catch outcomes`);
}

const activeOff = snapshot.teams.NE.roster;
const activeDef = snapshot.teams.CHI.roster;
const baseLineups = buildLineups(activeOff, activeDef);
const extraWR = activeOff.find((p) => p.availability === 'available' && p.position === 'WR' && !Object.values(baseLineups.offense).includes(p.id));
assert.ok(extraWR);
assert.throws(() => validateLineups(activeOff, activeDef,
  { ...baseLineups.offense, QB: extraWR.id }, baseLineups.defense), /incompatible offensive role QB/);
const inactive = snapshot.teams.NE.roster.find((p) => p.availability === 'inactive');
assert.ok(inactive);
assert.throws(() => validateLineups(activeOff, activeDef,
  { ...baseLineups.offense, RB: inactive.id }, baseLineups.defense), /unavailable or absent/);
const defenseBench = activeDef.find((p) => p.availability === 'available' && !Object.values(baseLineups.defense).includes(p.id));
assert.ok(defenseBench);
assert.throws(() => validateLineups(activeOff, activeDef,
  { ...baseLineups.offense, RB: defenseBench.id }, baseLineups.defense), /wrong team/);
assert.throws(() => createDemoScenario({ offenseId: 'NE', defenseId: 'CHI', teams: snapshot.teams,
  playbooks: { ...playbooks, NE: { offense: {} } }, kind: 'run', formation: 'SHOTGUN', seed: 'x' }), /missing offense play concepts/);
assert.throws(() => createDemoScenario({ offenseId: 'NE', defenseId: 'CHI', teams: snapshot.teams,
  playbooks, kind: 'punt', formation: 'SHOTGUN', seed: 'x' }), /unsupported demo action/);
const contractRequest = {
  schema_version: 'gridiron.play_selection.v1', teams: snapshot.teams, playbooks,
  game_state: { game_id: 'contract-test', offense_team_id: 'NE', defense_team_id: 'CHI', down: 3,
    distance_yards: 4, yard_line: 52, score: { NE: 3, CHI: 0 }, clock_seconds: 720,
    timeouts: { NE: 3, CHI: 3 }, field_direction: -1 },
  active_rosters: Object.fromEntries(['NE', 'CHI'].map((t) => [t,
    snapshot.teams[t].roster.filter((p) => p.availability === 'available').map((p) => p.id)])),
  personnel_availability: { NE: { inactive_ids: snapshot.teams.NE.official_inactives },
    CHI: { inactive_ids: snapshot.teams.CHI.official_inactives } },
  demo_controls: { kind: 'run', formation: 'SHOTGUN',
    candidate_id: playbooks.NE.offense.play_candidates.run.candidates.find((x) => x.attributes.formation === 'SHOTGUN').candidate_id },
};
const contractResult = selectPlay(contractRequest);
const { offense_team_id: _offenseId, defense_team_id: _defenseId, ...expectedState } = contractRequest.game_state;
assert.deepEqual(contractResult.selection.game_state, expectedState);
assert.equal(contractResult.selection.team_id, 'NE');
assert.equal(contractResult.selection.opponent_id, 'CHI');
assert.equal(contractResult.play.dir, -1);
assert.throws(() => selectPlay({ ...contractRequest, active_rosters: { ...contractRequest.active_rosters,
  NE: [...contractRequest.active_rosters.NE, 'unjoined-player'] } }), /active roster join failed/);
assert.throws(() => selectPlay({ ...contractRequest, schema_version: 'gridiron.play_selection.v0' }), /unsupported play-selection schema/);
assert.equal(executeSelectedPlay({}).failure.code, 'physics_execution_failed');
const unsupportedPhysics = executeSelectedPlay({ ...outputs['NE-run'].demo,
  play: { ...outputs['NE-run'].demo.play, kind: 'unsupported' } });
assert.equal(unsupportedPhysics.status, 'unsupported');
assert.equal(unsupportedPhysics.failure.code, 'unsupported_action');

console.log('Patriots-Bears prototype: playbook reconciliation, 22-player validation, both-team run/pass physics, deterministic seeds, substitution failures, and unsupported-action reporting passed.');
