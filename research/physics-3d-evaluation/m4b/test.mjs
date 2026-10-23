import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SCENARIOS, VERSION_PROFILES, instantiateScenario } from './scenarios.mjs';
import { ENGINE_IDS, compareSignatures, runScenario } from './simulation.mjs';

assert.equal(SCENARIOS.length, 16);
assert.equal(new Set(SCENARIOS.map((row) => row.id)).size, SCENARIOS.length);
assert.ok(SCENARIOS.every((row) => row.durationSeconds >= 7.5));
assert.equal(SCENARIOS.find((row) => row.id === 'short-yardage-22-player').players.length, 22);
assert.equal(SCENARIOS.find((row) => row.id === 'tush-push-eight').players.length, 8);
assert.equal(SCENARIOS.find((row) => row.id === 'fumble-eight-pile-live-ball').players.length, 8);
assert.equal(SCENARIOS.find((row) => row.id === 'fumble-eight-pile-ball-escapes').players.length, 8);
assert.equal(VERSION_PROFILES['proxy-v1-single-capsule'].geometry, 'single-capsule');
assert.equal(VERSION_PROFILES['proxy-v2-compound'].geometry, 'compound');
assert.ok(SCENARIOS.some((row) => row.category === 'gang-tackle'));
assert.ok(SCENARIOS.some((row) => row.category === 'shared-sack'));
assert.ok(SCENARIOS.some((row) => row.category === 'fumble-pileup'));
assert.ok(SCENARIOS.some((row) => row.category === 'short-yardage-scrum'));

function shortFixture(id, durationSeconds = 1.35) {
  const scenario = instantiateScenario(id);
  scenario.durationSeconds = durationSeconds;
  return scenario;
}

const summaries = [];
for (const engine of ENGINE_IDS) {
  const gangContactTimesByGeometry = {};
  for (const geometry of ['single-capsule', 'compound']) {
    const opposingGangTackle = await runScenario(engine, shortFixture('gang-two-opposite-open'), { playerGeometry: geometry });
    const carrierContactTimes = ['carrier::defender-left', 'carrier::defender-right'].map((pairId) => {
      const contact = opposingGangTackle.contacts.find((row) => row.pairId === pairId);
      assert.ok(contact, `${engine}/${geometry}: ${pairId} records physical contact`);
      return contact.firstTimeSeconds;
    });
    assert.ok(Math.abs(carrierContactTimes[0] - carrierContactTimes[1]) <= 1 / 120,
      `${engine}/${geometry}: opposing defenders make simultaneous physical contact`);
    gangContactTimesByGeometry[geometry] = carrierContactTimes;
  }

  const simultaneousSack = await runScenario(engine, shortFixture('sack-simultaneous-two'), { playerGeometry: 'compound' });
  const quarterbackContacts = simultaneousSack.contacts.filter((row) => row.pairId.startsWith('quarterback::'));
  assert.equal(quarterbackContacts.length, 2, `${engine}: both rushers make physical quarterback contact`);
  const contactTimes = quarterbackContacts.map((row) => row.firstTimeSeconds);
  assert.ok(Math.max(...contactTimes) - Math.min(...contactTimes) <= 1 / 120, `${engine}: the two contacts are simultaneous within one physics step`);
  assert.ok(simultaneousSack.events.some((row) => row.type === 'player_contact_started' && row.pointsM.length > 0));
  assert.ok(simultaneousSack.frames.every((frame) => Array.isArray(frame.diagnostics.totalLinearMomentumKgMps)
    && Array.isArray(frame.diagnostics.totalAngularMomentumAboutOriginKgM2PerSec)
    && frame.diagnostics.knownForceInputs.gravityForceNByBody), `${engine}: replay records momentum and named force inputs`);
  assert.equal(simultaneousSack.outcome.sack.officialHalfSackCredit.includes('not assigned'), true);

  const fumble = await runScenario(engine, shortFixture('fumble-two-recovery'), { playerGeometry: 'compound' });
  assert.ok(fumble.events.some((row) => row.type === 'ball_released' && row.reason.includes('first physical opponent contact')));
  assert.equal(fumble.outcome.football.status, 'loose_live_recovery_unresolved');
  assert.match(fumble.outcome.football.recovery, /unresolved/);
  assert.equal(fumble.diagnostics.finite, true);
  assert.ok(fumble.frames.some((frame) => frame.football?.status === 'loose_fumble'));

  const pileFumble = await runScenario(engine, shortFixture('fumble-eight-pile-live-ball'), { playerGeometry: 'compound' });
  assert.ok(pileFumble.events.some((row) => row.type === 'scenario_impulse'), `${engine}: configured fumble impulse is applied`);
  assert.equal(pileFumble.outcome.football.status, 'loose_live_recovery_unresolved');
  assert.equal(pileFumble.diagnostics.finite, true);
  const pileBallMaxSpeedMps = Math.max(...pileFumble.frames.map((frame) => Math.hypot(...frame.football.linearVelocityMps)));
  assert.ok(pileBallMaxSpeedMps < 30, `${engine}: fumble ball force does not accumulate after each physics step`);

  const escapingPile = await runScenario(engine, shortFixture('fumble-eight-pile-ball-escapes', 2), { playerGeometry: 'compound', recordStride: 15 });
  assert.ok(escapingPile.events.some((row) => row.type === 'ball_released'));
  assert.equal(escapingPile.outcome.football.status, 'loose_live_recovery_unresolved');
  const ballDistanceFromNearestPlayerM = Math.min(...Object.values(escapingPile.frames.at(-1).players)
    .map((player) => Math.hypot(...player.positionM.map((value, axis) => value - escapingPile.frames.at(-1).football.positionM[axis]))));
  assert.ok(ballDistanceFromNearestPlayerM > 2, `${engine}: loose ball physically escapes the eight-player scrum`);

  const gangTackle = await runScenario(engine, shortFixture('gang-four-blockers-congested'), { playerGeometry: 'compound' });
  const carrierContacts = gangTackle.contacts.filter((row) => row.pairId.startsWith('carrier::'));
  assert.ok(carrierContacts.length >= 2, `${engine}: congested gang tackle has multiple physical carrier contacts`);

  const scrum = await runScenario(engine, shortFixture('tush-push-eight', 1.6), { playerGeometry: 'compound' });
  assert.equal(scrum.diagnostics.playerCount, 8);
  assert.ok(scrum.contacts.length > 0, `${engine}: short-yardage scrum includes body contact`);
  assert.ok(scrum.events.some((row) => row.type === 'football_snap_release'), `${engine}: the line-of-scrimmage fixture starts with a snap`);
  assert.ok(scrum.events.some((row) => row.type === 'snap_reception_unresolved'), `${engine}: catch state remains explicit without hand control`);
  assert.ok(scrum.outcome.rawProgress.maximumCarrierOriginXM > -1.15, `${engine}: ball-carrier trajectory is recorded`);
  assert.match(scrum.outcome.rawProgress.interpretation, /no first-down, touchdown/);

  const maxLine = await runScenario(engine, shortFixture('short-yardage-22-player', 0.7), { playerGeometry: 'single-capsule', recordStride: 6 });
  assert.equal(maxLine.diagnostics.playerCount, 22);
  assert.equal(maxLine.diagnostics.finite, true);
  assert.ok(maxLine.contacts.length > 0, `${engine}: 22-player line produces physical contacts`);

  const repeatScenario = shortFixture('gang-two-opposite-open', 1.35);
  const repeatA = await runScenario(engine, repeatScenario, { playerGeometry: 'single-capsule', recordStride: 30 });
  const repeatB = await runScenario(engine, repeatScenario, { playerGeometry: 'single-capsule', recordStride: 30 });
  assert.equal(compareSignatures(repeatA, repeatB), true, `${engine}: identical seed and fixture repeat within process`);
  summaries.push({ engine, simultaneousSackContacts: contactTimes, looseBall: fumble.outcome.football.status,
    pileFumbleImpulseCount: pileFumble.events.filter((row) => row.type === 'scenario_impulse').length,
    pileBallMaxSpeedMps,
    escapedBallDistanceM: ballDistanceFromNearestPlayerM,
    opposingGangTackleContacts: gangContactTimesByGeometry, gangCarrierContactPairs: carrierContacts.length, scrumContacts: scrum.contacts.length,
    playerCount22Contacts: maxLine.contacts.length, repeatable: true });
}

try {
  const index = JSON.parse(await readFile(new URL('./results/archive-index.json', import.meta.url), 'utf8'));
  for (const version of Object.keys(VERSION_PROFILES)) {
    const commit = index.activeProfileCommits?.[version];
    if (!commit) continue;
    const summary = JSON.parse(await readFile(new URL(`./results/${version}/${commit.slice(0, 10)}/summary.json`, import.meta.url), 'utf8'));
    const archivedScenarioCount = new Set(summary.scenarioResults.map((row) => row.scenarioId)).size;
    assert.equal(summary.scenarioResults.length, archivedScenarioCount * ENGINE_IDS.length);
    assert.ok(summary.scenarioResults.every((row) => row.status === 'failed' || row.diagnostics.finite));
    assert.ok(summary.scenarioResults.every((row) => row.status === 'failed' || (row.outcome && row.contacts)));
    assert.ok(summary.scenarioResults.every((row) => row.status === 'failed' || row.runtime.wallTimeMs >= 0));
  }
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}

console.log(JSON.stringify({ passed: true, scenarios: SCENARIOS.length, engineRuns: summaries,
  invariants: ['simultaneous contacts', 'real 22-player contacts', 'fumble release and unresolved recovery', 'scrum trajectory', 'deterministic repeats'] }, null, 2));
