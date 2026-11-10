import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { auditDriveIndex, auditFootballState } from '../web/lp-game-state-audit.js';
import { auditConversionSource } from '../web/conversion-source-semantics.js';
import { adaptLpGamePayload, auditGridironV1SourceGaps } from '../web/lp-game-record-adapter.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(resolve(root, 'docs/fixtures/e2/MANIFEST.json'), 'utf8'));
const entry = manifest.fixtures[0];
const payloadBytes = await readFile(resolve(root, 'docs/fixtures/e2', entry.upstream_source_file));
assert.equal(createHash('sha256').update(payloadBytes).digest('hex'), entry.upstream_source_sha256);
const payload = JSON.parse(payloadBytes.toString('utf8'));
const transportBytes = await readFile(resolve(root, 'docs/fixtures/e2', entry.file));
assert.equal(createHash('sha256').update(transportBytes).digest('hex'), entry.sha256);
const transport = JSON.parse(transportBytes.toString('utf8'));
const record = payload.record;
const currentAudit = auditFootballState(record);
assert.deepEqual(record, transport.record, 'the final LP envelope must carry the pinned producer record unchanged');
assert.equal(transport.source.base_commit, manifest.lp_source.base_commit);
assert.equal(transport.source.base_commit, 'a442dcd72559cfaf2d04737fc2454cea486faf09');
assert.equal(manifest.lp_source.envelope_commit, 'f5db433cb0257177413f4a184369aa47a286dce1');
assert.equal(record.drives.length, 24);
assert.equal(record.drives.reduce((sum, drive) => sum + drive.plays.length, 0), 143);
assert.deepEqual(record.points, { A: 14, B: 10 });
const priorRecordBytes = await readFile(resolve(root, 'docs/fixtures/e2/audit-current-seed1-a785-record.json'));
const priorRecord = JSON.parse(priorRecordBytes.toString('utf8'));
const priorAudit = auditFootballState(priorRecord);
const f12RecordBytes = await readFile(resolve(root, 'docs/fixtures/e2/audit-current-seed1-f12-record.json'));
const f12Record = JSON.parse(f12RecordBytes.toString('utf8'));
const f12Audit = auditFootballState(f12Record);
const regressionEntry = manifest.regression_fixtures[0];
const regressionRawBytes = await readFile(resolve(root, 'docs/fixtures/e2', regressionEntry.upstream_source_file));
assert.equal(createHash('sha256').update(regressionRawBytes).digest('hex'), regressionEntry.upstream_source_sha256);
const regressionRaw = JSON.parse(regressionRawBytes.toString('utf8'));
const pinnedAudit = auditFootballState(regressionRaw.record);
const v1DocumentBytes = await readFile(resolve(root, 'docs/fixtures/e2', entry.v1_document_file));
assert.equal(createHash('sha256').update(v1DocumentBytes).digest('hex'), entry.v1_document_sha256);
const v1Document = JSON.parse(v1DocumentBytes.toString('utf8'));
const baselineReport = JSON.parse(await readFile(resolve(root,
  'docs/research/GRIDIRON-E2-INDEPENDENT-STATE-AUDIT-BASELINE-2026-10-24.json'), 'utf8'));
const reconciliationManifest = JSON.parse(await readFile(resolve(root,
  'docs/fixtures/e2/reconciliation/MANIFEST.json'), 'utf8'));
const reconciliationFixtures = new Map();
for (const entry of reconciliationManifest.fixtures) {
  const bytes = await readFile(resolve(root, 'docs/fixtures/e2/reconciliation', entry.file));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256,
    `reconciliation fixture seed ${entry.seed} must remain pinned`);
  const envelope = JSON.parse(bytes.toString('utf8'));
  assert.equal(envelope.source.base_commit, reconciliationManifest.producer_base_commit);
  assert.equal(envelope.record.seed, entry.seed);
  reconciliationFixtures.set(entry.seed, envelope);
}

assert.equal(currentAudit.finding_count, 0, 'the final LP record passes independent football-state checks');
assert.deepEqual(currentAudit.findings, baselineReport.current_lp_payload.football_state_audit.findings,
  'the current payload audit must exactly reproduce every path-level baseline finding');
assert.equal(currentAudit.counts.drive_index_mismatch ?? 0, 0, 'final drive indexes pass at both state boundaries');
assert.equal(baselineReport.current_lp_payload.producer_commit, manifest.lp_source.base_commit);
assert.equal(baselineReport.current_lp_payload.envelope_commit, manifest.lp_source.envelope_commit);
assert.deepEqual(baselineReport.current_lp_payload.producer_file_sha256, manifest.lp_source.producer_file_sha256);
assert.equal(baselineReport.current_lp_payload.raw_payload_sha256, entry.upstream_source_sha256);
assert.equal(baselineReport.current_lp_payload.envelope_sha256, entry.sha256);
assert.equal(baselineReport.current_lp_payload.conversion_source_script_commit,
  manifest.lp_source.conversion_source_script_commit);
assert.equal(baselineReport.current_lp_payload.conversion_source_script_sha256,
  manifest.lp_source.conversion_source_script_sha256);
assert.equal(f12Audit.finding_count, 0, 'the earlier f12 record remains byte-equivalent state evidence');
assert.deepEqual(f12Audit.findings, currentAudit.findings);
assert.deepEqual(f12Record, record, 'the final LP record content matches the previously audited f12 record');
assert.equal(priorAudit.finding_count, 1144, 'the earlier a785 missing-state baseline is preserved');
assert.equal(priorAudit.counts.score_state_missing, 572);
assert.equal(priorAudit.counts.timeout_state_missing, 572);
assert.deepEqual(priorAudit.findings, baselineReport.prior_a785_payload.football_state_audit.findings);
assert.equal(baselineReport.current_lp_payload.shared_v1_violations.length, 8,
  'the latest consumer audit closes score and timeout gaps; eight shared-v1 gaps remain open');
const v1SourceGapAudit = auditGridironV1SourceGaps(v1Document);
assert.equal(v1SourceGapAudit.sourceGapCount, 7,
  'the shared-v1 projection has seven individually reported unsourced fields');
assert.equal(baselineReport.current_lp_payload.shared_v1_document_source_gaps.source_gap_count, 7);
assert.deepEqual(v1SourceGapAudit.findings,
  baselineReport.current_lp_payload.shared_v1_document_source_gaps.findings);
assert.equal(baselineReport.prior_a785_payload.shared_v1_violations.length, 10);
assert.equal(pinnedAudit.finding_count, 1175, 'the archived 5fc payload remains the failing baseline');
assert.equal(pinnedAudit.counts.drive_index_mismatch, 23);
assert.equal(pinnedAudit.counts.score_state_missing, 576);
assert.equal(pinnedAudit.counts.timeout_state_missing, 576);
assert.equal(baselineReport.retained_pinned_regression_fixture.football_state_audit.finding_count, 1175,
  'the original 5fc findings remain fully listed');
const bothStateIndexFailures = auditDriveIndex(regressionRaw.record);
assert.equal(bothStateIndexFailures.length, 23);
assert.ok(bothStateIndexFailures.every((finding) => finding.plays.every((play) =>
  play.state_before === 1 && play.state_after === 1)), 'both state boundaries are part of the hard index gate');
for (const code of ['drive_index_mismatch', 'down_progression_invalid', 'possession_transition_invalid',
  'field_position_transition_invalid', 'score_state_ledger_mismatch', 'scoring_kick_restart_invalid',
  'quarter_transition_invalid', 'halftime_boundary_invalid', 'score_decreased', 'timeout_count_increased',
  'termination_invalid']) {
  assert.equal(currentAudit.counts[code] ?? 0, 0, `${code} has no finding in the current LP payload`);
}

const currentEnvelope = structuredClone(transport);
const currentAdapted = adaptLpGamePayload(currentEnvelope);
assert.equal(currentAdapted.drives.length, 24);
assert.equal(currentAdapted.sourcePlayCount, 143);
assert.equal(currentAdapted.footballStateAudit.finding_count, 0);
assert.equal(currentAdapted.validation.passed, true, 'the current producer payload passes consumer-level structural checks');
assert.equal(currentAdapted.sharedV1Audit.violations.length, 8,
  'raw record gaps include missing model/rules and pregame metadata, plus identity and the safe false validity flag');

const seed9 = reconciliationFixtures.get(9);
const seed11 = reconciliationFixtures.get(11);
const seed101 = reconciliationFixtures.get(101);
const seed176 = reconciliationFixtures.get(176);
assert.equal(reconciliationManifest.producer_source_tree_sha256,
  seed176.record.research_source.source_tree_sha256);
assert.equal(adaptLpGamePayload(seed11, { requireCompleteRegulation: false }).footballStateAudit.finding_count, 0,
  'an expired Q1 kickoff return correctly opens Q2 at 15:00 for its receiver');
const seed101Adapted = adaptLpGamePayload(seed101, { requireCompleteRegulation: false });
assert.equal(seed101Adapted.validation.findings.length, 0);
assert.equal(seed101Adapted.footballStateAudit.finding_count, 0,
  'a Q2 score at 0:00 uses the explicit skipped-score-kick and halftime boundary');
assert.ok(seed101.record.boundaries.some((boundary) => boundary.kind === 'skipped_post_score_kick'
  && boundary.drive_index === 7));
const seed101MissingSkip = structuredClone(seed101.record);
seed101MissingSkip.boundaries = seed101MissingSkip.boundaries.filter((boundary) =>
  boundary.kind !== 'skipped_post_score_kick');
assert.ok(auditFootballState(seed101MissingSkip).findings
  .some((finding) => finding.code === 'scoring_kick_restart_invalid'),
'a Q2 score without a post-score kick requires explicit halftime-skip evidence');
const seed176Adapted = adaptLpGamePayload(seed176, { requireCompleteRegulation: false });
assert.equal(seed176Adapted.validation.findings.length, 0,
  'the later Q3 half-start, not the expired Q2 scoring kickoff, owns the next drive');
assert.equal(seed176Adapted.footballStateAudit.finding_count, 0);
assert.deepEqual(seed176.record, seed176Adapted.record,
  'reconciliation validation must preserve the emitted LP record');
const seed176Kick6 = seed176.record.kickoffs[5];
assert.deepEqual([seed176Kick6.kind, seed176Kick6.quarter, seed176Kick6.clock_before,
  seed176Kick6.runoff_seconds, seed176Kick6.clock_expired_during_kickoff], ['post_field_goal', 2, 4, 6, true]);
const seed176HalfBoundary = seed176.record.boundaries.find((boundary) => boundary.kind === 'halftime');
assert.deepEqual([seed176HalfBoundary.from_quarter, seed176HalfBoundary.to_quarter,
  seed176HalfBoundary.drive_index], [2, 3, 10]);
assert.deepEqual([seed176.record.kickoffs[6].kind, seed176.record.kickoffs[6].quarter,
  seed176.record.kickoffs[6].receiving_team, seed176.record.drives[10].offense_team,
  seed176.record.drives[10].quarter_start, seed176.record.drives[10].clock_start],
['half_start', 3, 'B', 'B', 3, 894]);

const seed176WrongQ3Receiver = structuredClone(seed176);
seed176WrongQ3Receiver.record.kickoffs[6].receiving_team = 'A';
assert.ok(adaptLpGamePayload(seed176WrongQ3Receiver, { requireCompleteRegulation: false }).validation.findings
  .some((finding) => finding.includes('Kickoff 7 receiver disagrees')),
'a wrong Q3 half-start receiver must still fail structural validation');
assert.ok(auditFootballState(seed176WrongQ3Receiver.record).findings
  .some((finding) => finding.code === 'halftime_restart_invalid'
    || finding.code === 'halftime_restart_possession_invalid'),
'the independent toss ledger must reject a wrong Q3 receiver');

const seed176WrongScoringReceiver = structuredClone(seed176);
seed176WrongScoringReceiver.record.kickoffs[5].receiving_team = 'B';
assert.ok(adaptLpGamePayload(seed176WrongScoringReceiver, { requireCompleteRegulation: false }).validation.findings
  .some((finding) => finding.includes('scoring restart has incorrect teams')),
'halftime handoff must not hide an incorrectly linked Q2 scoring kickoff');

const seed11WrongRolloverClock = structuredClone(seed11.record);
seed11WrongRolloverClock.drives[6].clock_start = 899;
seed11WrongRolloverClock.drives[6].plays[0].state_before.clock_seconds = 899;
assert.ok(auditFootballState(seed11WrongRolloverClock).findings
  .some((finding) => finding.code === 'kick_restart_clock_mismatch'),
'a quarter reset with an incorrect next-drive clock must remain a hard finding');

const seed9Audit = auditFootballState(seed9.record);
assert.equal(seed9Audit.counts.safety_kick_outcome_unverified, 1,
  'legacy safety free kicks without a separate observed outcome table remain rejected');

const poisonRulesMatrix = structuredClone(record);
Object.defineProperty(poisonRulesMatrix, 'rules_matrix', { get() { throw new Error('rules_matrix must not be read'); } });
assert.doesNotThrow(() => auditFootballState(poisonRulesMatrix), 'independent audit must ignore producer rules_matrix');

function negativeFixture(name, mutate, expectedCode, expectedPathPart) {
  const fixture = structuredClone(record);
  mutate(fixture);
  const audit = auditFootballState(fixture);
  assert.equal(audit.passed, false, `${name}: negative fixture must fail the audit`);
  const finding = audit.findings.find((item) => item.code === expectedCode
    && (!expectedPathPart || item.path.includes(expectedPathPart)));
  assert.ok(finding, `${name}: expected ${expectedCode} at ${expectedPathPart ?? 'a relevant path'}`);
  return name;
}

const negatives = [
  negativeFixture('before-state drive index mismatch', (r) => {
    r.drives[1].plays[0].state_before.drive_index = 1;
  }, 'drive_index_mismatch', 'state_before/after.drive_index'),
  negativeFixture('after-state drive index mismatch', (r) => {
    r.drives[1].plays[0].state_after.drive_index = 1;
  }, 'drive_index_mismatch', 'state_before/after.drive_index'),
  negativeFixture('down range', (r) => { r.drives[0].plays[0].state_before.down = 0; },
    'down_state_invalid', 'state_before.down'),
  negativeFixture('down progression', (r) => {
    const play = r.drives[0].plays[0];
    play.state_after.down = play.state_after.down === 4 ? 3 : play.state_after.down + 1;
  }, 'down_progression_invalid', 'state_after.down'),
  negativeFixture('same side on offense and defense', (r) => {
    const play = r.drives[0].plays[0];
    play.state_before.defense_team = play.state_before.offense_team;
  }, 'possession_state_invalid', 'state_before.offense_team/defense_team'),
  negativeFixture('turnover fails to change possession', (r) => {
    const play = r.drives.flatMap((drive) => drive.plays).find((item) => item.outcome.turnover || item.outcome.punt);
    play.state_after.offense_team = play.state_before.offense_team;
    play.state_after.defense_team = play.state_before.defense_team;
  }, 'possession_transition_invalid', 'state_after.offense_team'),
  negativeFixture('field position outside field', (r) => { r.drives[0].plays[0].state_before.yardline_100 = 101; },
    'field_position_invalid', 'state_before.yardline_100'),
  negativeFixture('yard gain and spot disagree', (r) => {
    const play = r.drives[0].plays[0];
    play.state_after.yardline_100 += 1;
  }, 'field_position_transition_invalid', 'state_after.yardline_100'),
  negativeFixture('kick restart receiver', (r) => { r.kickoffs[0].receiving_team = r.kickoffs[0].kicking_team; },
    'kick_restart_invalid', 'receiving_team'),
  negativeFixture('missing scoring restart', (r) => {
    const drive = r.drives.find((item) => item.points_scored_on_drive
      && ['touchdown', 'field_goal_attempt', 'safety'].includes(item.terminal));
    r.kickoffs = r.kickoffs.filter((kick) => kick.after_drive !== drive.index);
  }, 'scoring_kick_restart_invalid', 'after_drive='),
  negativeFixture('in-play quarter boundary clock reset', (r) => {
    const play = r.drives.flatMap((drive) => drive.plays).find((item) => item.state_after.quarter > item.state_before.quarter);
    assert.ok(play, 'baseline contains an in-play Q1/Q3 boundary');
    play.state_after.clock_seconds = 899;
  }, 'quarter_transition_invalid', 'state_after.quarter/clock_seconds'),
  negativeFixture('halftime boundary must link Q2 to Q3', (r) => {
    const boundary = r.boundaries.find((item) => item.kind === 'halftime');
    boundary.from_quarter = 1;
  }, 'halftime_restart_invalid', 'record.boundaries'),
  negativeFixture('new quarter starts after the correct kickoff runoff', (r) => {
    const index = r.drives.findIndex((drive, offset) => offset > 0
      && drive.quarter_start > r.drives[offset - 1].plays.at(-1).state_after.quarter);
    assert.ok(index > 0, 'current sample has an inter-quarter drive boundary');
    r.drives[index].clock_start = 899;
  },
    'quarter_start_clock_invalid', 'clock_start'),
  negativeFixture('score cannot decrease', (r) => {
    const play = r.drives[0].plays[0];
    play.state_before.home_score = 3;
    play.state_after.home_score = 2;
  }, 'score_decreased', 'state_after.home_score'),
  negativeFixture('score must reconcile to drive ledger', (r) => {
    r.drives[0].plays[0].state_after.home_score += 1;
  }, 'score_state_ledger_mismatch', 'state_after.home_score/away_score'),
  negativeFixture('timeout count cannot rise within a half', (r) => {
    const play = r.drives[0].plays[0];
    play.state_before.home_timeouts = 2;
    play.state_after.home_timeouts = 3;
  }, 'timeout_count_increased', 'state_after.home_timeouts'),
  negativeFixture('timeouts limited to three', (r) => { r.drives[0].plays[0].state_before.away_timeouts = 4; },
    'timeout_state_invalid', 'state_before.away_timeouts'),
  negativeFixture('regulation termination', (r) => { r.final_clock_seconds = 1; },
    'termination_invalid', 'record.status/final_quarter/final_clock_seconds'),
];

const oldEpaSource = auditConversionSource({
  producerFileSha256: { 'scripts/nfl_sequence/measure_kick_outcomes.py': 'f16616f80adfb4108dd189557d968cdacad680c77eea0bdec1fe46198cb622d0' },
  sourceDescription: 'nfl_pbp success flag',
});
assert.equal(oldEpaSource.passed, false, 'EPA success cannot pass as a conversion result');
assert.deepEqual(oldEpaSource.findings.map((finding) => finding.family), ['extra_point', 'two_point']);
const publisherSource = auditConversionSource({
  producerFileSha256: { 'scripts/nfl_sequence/measure_kick_outcomes.py': '97f13669b4e6a1c4d25c5be4cf14483a3f47621f4c10106cb24943f35bfbdb3e' },
  sourceDescription: 'kick_results.csv (publisher fields extra_point_result, two_point_conv_result)',
});
assert.equal(publisherSource.passed, true, 'the later producer hash uses publisher conversion result fields');
const latestCommittedPublisherSource = auditConversionSource({
  producerFileSha256: {
    ...transport.source.producer_file_sha256,
    [manifest.lp_source.conversion_source_script_file]: manifest.lp_source.conversion_source_script_sha256,
  },
  sourceDescription: payload.sources.kick_table,
});
assert.equal(latestCommittedPublisherSource.passed, true, 'final LP conversion source uses pinned publisher result fields');
assert.equal(auditConversionSource({ producerFileSha256: {}, sourceDescription: 'success' }).passed, false,
  'unknown or unpinned conversion semantics must fail closed');
const e3Manifest = JSON.parse(await readFile(resolve(root, 'docs/fixtures/e3/observed-2022-2025/lp-manifest.json'), 'utf8'));
assert.match(e3Manifest.definitions.epa_success, /EPA-positive/,
  'the source definition must remain explicit that E3 success is not a scoring flag');

console.log(`Final LP a442 audit: ${currentAudit.finding_count} football-state findings; raw-record v1 gaps=${currentAdapted.sharedV1Audit.violations.length}`);
console.log(`Prior LP a785: ${priorAudit.finding_count} missing-state findings; archived 5fc regression: ${pinnedAudit.finding_count} findings including ${pinnedAudit.counts.drive_index_mismatch} drive-index mismatches`);
console.log(`Negative fixtures: ${negatives.length}/${negatives.length} rejected with the expected finding`);
console.log('Conversion-source semantics: final publisher fields accepted; EPA-success and unknown sources rejected');
