import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { adaptLpGamePayload, auditGridironContractV1Record } from '../web/lp-game-record-adapter.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(resolve(root, 'docs/fixtures/e2/MANIFEST.json'), 'utf8'));
const fixtureEntry = manifest.fixtures[0];
const fixtureBytes = await readFile(resolve(root, 'docs/fixtures/e2', fixtureEntry.file));
const fixtureHash = createHash('sha256').update(fixtureBytes).digest('hex');
assert.equal(fixtureHash, fixtureEntry.sha256, 'fixture must match its pinned SHA-256');
const payload = JSON.parse(fixtureBytes.toString('utf8'));
const upstreamBytes = await readFile(resolve(root, 'docs/fixtures/e2', fixtureEntry.upstream_source_file));
assert.equal(createHash('sha256').update(upstreamBytes).digest('hex'), fixtureEntry.upstream_source_sha256,
  'original LP payload must match its pinned SHA-256');
const upstream = JSON.parse(upstreamBytes.toString('utf8'));
const before = JSON.stringify(payload.record);

assert.throws(() => adaptLpGamePayload(payload), /rejected 23 drive-index mismatches/,
  'the pinned LP record must fail closed on all drive-index defects');
assert.equal(JSON.stringify(payload.record), before, 'a rejected source record must remain untouched');
assert.deepEqual(payload.record, upstream.record, 'the pinned transport record must match the pinned LP record');

// Test-only navigation control: repair only drive_index in memory so the adapter's
// remaining checks and the browser's drive/play selectors can be exercised. This
// is not a rewritten or replacement LP fixture.
const navigationControl = structuredClone(payload);
for (const drive of navigationControl.record.drives) {
  for (const play of drive.plays) {
    play.state_before.drive_index = drive.index;
    play.state_after.drive_index = drive.index;
  }
}
const adapted = adaptLpGamePayload(navigationControl);
assert.deepEqual(adapted.record, navigationControl.record,
  'the adapter must preserve even the test-only source record exactly');
assert.equal(payload.source.base_commit, manifest.lp_source.base_commit, 'producer commit must match the manifest');
assert.equal(payload.source.branch, manifest.lp_source.branch, 'producer branch must match the manifest');
assert.equal(adapted.drives.length, 24);
assert.equal(adapted.sourcePlayCount, 144);
assert.equal(adapted.record.points.A, 11);
assert.equal(adapted.record.points.B, 17);
assert.equal(adapted.record.complete_regulation, true);
assert.equal(adapted.record.valid_full_game, false);
assert.equal(adapted.validation.passed, true, 'the in-memory control has corrected drive indexes');
assert.equal(adapted.footballStateAudit.counts.score_state_missing, 576,
  'all missing score snapshots must be retained in the independent audit');
assert.equal(adapted.footballStateAudit.counts.timeout_state_missing, 576,
  'all missing timeout snapshots must be retained in the independent audit');
assert.equal(adapted.footballStateAudit.counts.drive_index_mismatch, undefined);
const findingsDoc = await readFile(resolve(root, 'docs/research/GRIDIRON-E2-OPEN-FINDINGS-2026-10-24.md'), 'utf8');
const driveSection = findingsDoc.split('## Drive-index findings (23)')[1].split('## Shared-contract audit violations (10)')[0];
const driveRows = driveSection.split('\n').filter((line) => /^\| \d+ \|/.test(line));
assert.equal(driveRows.length, 23, 'each drive-index finding must have a documented row');
assert.ok(driveRows.every((line) => line.includes('LP E2 producer-side')),
  'every historical drive-index finding must name LP as its original owner');
assert.ok(driveRows.every((line) => line.includes('CLOSED in f12; retained in 5fc regression')),
  'all 23 historical index defects must be marked closed in current LP output and retained as regression');
const contractSection = findingsDoc.split('## Shared-contract audit violations (10)')[1];
const contractRows = contractSection.split('\n').filter((line) => /^\| \d+ \|/.test(line));
assert.equal(contractRows.length, 10, 'all ten v1 gaps must have a triage row');
assert.ok(contractRows.every((line) => line.includes('LP E2 producer-side') && line.split('|').length === 8),
  'each v1 triage row must identify the LP owner and current disposition');
assert.equal(contractRows.filter((line) => line.includes('| OPEN |')).length, 8,
  'eight v1 gaps remain open in f12');
assert.equal(contractRows.filter((line) => line.includes('CLOSED in f12')).length, 2,
  'score and timeout state coverage close in f12');
assert.equal(adapted.sharedV1Audit.conforms, false);
assert.equal(adapted.sharedV1Audit.violations.length, 10);
assert.ok(!adapted.sharedV1Audit.violations.some((issue) => /play ID|simulation_id/.test(issue)));
const allPlays = adapted.record.drives.flatMap((drive) => drive.plays);
assert.deepEqual(allPlays.map((play) => play.sequence), allPlays.map((_, index) => index + 1));
assert.deepEqual(allPlays.map((play) => play.id), allPlays.map((_, index) => `${adapted.record.simulation_id}:${index + 1}`));
assert.equal(JSON.stringify(payload.record), before, 'adapter must not mutate the pinned LP record');
assert.ok(Object.isFrozen(adapted.record.drives[0].plays[0].outcome), 'source copy must be immutable');
assert.equal(adapted.drives[0].plays[0].source, adapted.record.drives[0].plays[0]);

const duplicateId = structuredClone(navigationControl);
duplicateId.record.drives[1].plays[0].id = duplicateId.record.drives[0].plays[0].id;
assert.throws(() => adaptLpGamePayload(duplicateId), /id must be .*:5/);

const wrongSequence = structuredClone(navigationControl);
wrongSequence.record.drives[1].plays[0].sequence = 1;
wrongSequence.record.drives[1].plays[0].id = `${payload.record.simulation_id}:1`;
assert.throws(() => adaptLpGamePayload(wrongSequence), /sequence must be 5 across the game/);

const missingSimulationId = structuredClone(navigationControl);
delete missingSimulationId.record.simulation_id;
assert.throws(() => adaptLpGamePayload(missingSimulationId), /record.simulation_id must be a non-empty string/);

const countOnly = structuredClone(navigationControl);
delete countOnly.record.drives[0].plays;
assert.throws(() => adaptLpGamePayload(countOnly), /must contain the source plays/);

const shortGame = structuredClone(navigationControl);
shortGame.record.complete_regulation = false;
assert.throws(() => adaptLpGamePayload(shortGame), /requires a complete regulation record/);

const scoreMismatch = structuredClone(navigationControl);
scoreMismatch.record.points.A += 1;
assert.ok(adaptLpGamePayload(scoreMismatch).validation.findings.some((finding) => finding.includes('points disagree')));

const validV1 = {
  mode: 'pregame_full_game',
  game_id: '2026_08_DEN_SEA',
  model_version: 'nfl-seq-v1',
  rules_version: 'nfl-2026',
  as_of_utc: '2026-10-23T12:00:00Z',
  scheduled_kickoff_utc: '2026-10-24T12:00:00Z',
  teams: { home: 'DEN', away: 'SEA' },
  roster_snapshot_id: 'roster-snapshot-v1',
  valid_full_game: true,
  plays: [{
    state_before: { home_score: 0, away_score: 0, home_timeouts: 3, away_timeouts: 3 },
    state_after: { home_score: 0, away_score: 0, home_timeouts: 3, away_timeouts: 3 },
  }],
};
assert.deepEqual(auditGridironContractV1Record(validV1), { conforms: true, violations: [] },
  'the audit must recognize documented top-level metadata and both play states');
const emptyV1 = structuredClone(validV1);
emptyV1.plays = [];
assert.ok(auditGridironContractV1Record(emptyV1).violations.includes('full-game play stream is empty'),
  'a full-game record must contain plays');
const nestedAsOfOnly = structuredClone(validV1);
delete nestedAsOfOnly.as_of_utc;
nestedAsOfOnly.provenance = { as_of_utc: validV1.as_of_utc };
assert.ok(auditGridironContractV1Record(nestedAsOfOnly).violations.some((issue) => issue.includes('top-level as_of_utc')),
  'nested provenance must not substitute for the shared-v1 top-level as-of field');
const postKickoffAsOf = structuredClone(validV1);
postKickoffAsOf.as_of_utc = '2026-10-24T12:00:00Z';
assert.ok(auditGridironContractV1Record(postKickoffAsOf).violations.some((issue) => issue.includes('top-level as_of_utc')),
  'the pregame as-of timestamp must precede scheduled kickoff');
const missingAfterState = structuredClone(validV1);
delete missingAfterState.plays[0].state_after.home_score;
assert.ok(auditGridironContractV1Record(missingAfterState).violations.includes('play states do not carry home/away score'),
  'the audit must check state_after as well as state_before');
missingAfterState.plays[0].state_after.home_timeouts = null;
assert.ok(auditGridironContractV1Record(missingAfterState).violations.includes('play states do not carry timeout counts'),
  'the audit must check timeout values in state_after');
const placeholderTeams = structuredClone(validV1);
placeholderTeams.teams = { home: 'A', away: 'B' };
assert.ok(auditGridironContractV1Record(placeholderTeams).violations.includes('missing real home/away team identities'),
  'A/B labels are not real team identities');

console.log('LP E2 game adapter: assertions passed');
console.log(`fixture=${fixtureEntry.file} sha256=${fixtureHash}`);
console.log(`upstream=${fixtureEntry.upstream_source_file} sha256=${fixtureEntry.upstream_source_sha256}`);
console.log(`drives=${adapted.drives.length} plays=${adapted.sourcePlayCount} score=A ${adapted.record.points.A}, B ${adapted.record.points.B}`);
console.log(`source validation findings=${adapted.validation.findings.length}; shared-v1 violations=${adapted.sharedV1Audit.violations.length}`);
