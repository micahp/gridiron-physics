import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { adaptLpGamePayload } from '../web/lp-game-record-adapter.js';
import { resolveAssignedFieldSpot } from '../web/field-end-assignment.js';
import { auditDriveIndex } from '../web/lp-game-state-audit.js';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const candidateDir = process.env.E2_REPIN_CANDIDATE_DIR;
const lpRepo = process.env.LP_E2_REPO;
const lpCommit = process.env.LP_E2_COMMIT;
const lpPayloadPath = process.env.LP_E2_PAYLOAD_PATH;
const playwrightModule = process.env.PLAYWRIGHT_MODULE;
const chromePath = process.env.CHROME_BIN;
if (![candidateDir, lpRepo, lpCommit, lpPayloadPath, playwrightModule, chromePath].every(Boolean)) {
  throw new Error('E2 repin candidate paths, LP provenance, PLAYWRIGHT_MODULE and CHROME_BIN are required.');
}

const candidateManifestBytes = await readFile(resolve(candidateDir, 'manifest.json'));
const candidateEnvelopeBytes = await readFile(resolve(candidateDir, 'envelope.json'));
const candidateRawBytes = await readFile(resolve(candidateDir, 'raw.json'));
const assignmentBytes = await readFile(resolve(root, 'test/fixtures/field-end-assignment/e2-seed1-authored.json'));
const manifest = JSON.parse(candidateManifestBytes.toString('utf8'));
const envelope = JSON.parse(candidateEnvelopeBytes.toString('utf8'));
const raw = JSON.parse(candidateRawBytes.toString('utf8'));
const assignment = JSON.parse(assignmentBytes.toString('utf8'));
const entry = manifest.fixtures[0];
const payloadHash = createHash('sha256').update(candidateRawBytes).digest('hex');
const envelopeHash = createHash('sha256').update(candidateEnvelopeBytes).digest('hex');
const canonical = (value) => JSON.stringify(value, (_key, item) => {
  if (item && typeof item === 'object' && !Array.isArray(item)) {
    return Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]]));
  }
  return item;
});

assert.equal(payloadHash, entry.upstream_source_sha256, 'candidate raw artifact must match its SHA pin');
const immutableLpBytes = execFileSync('git', ['-C', lpRepo, 'show', `${lpCommit}:${lpPayloadPath}`]);
assert.deepEqual(candidateRawBytes, immutableLpBytes, 'candidate raw artifact must equal the selected immutable LP Git blob');
assert.equal(envelopeHash, entry.sha256, 'candidate envelope must match its SHA pin');
assert.equal(envelope.source.base_commit, lpCommit, 'candidate envelope must name the LP evidence commit');
assert.equal(envelope.source.payload_path, lpPayloadPath, 'candidate envelope must name the immutable LP artifact path');
assert.equal(envelope.source.payload_sha256, payloadHash, 'candidate envelope must pin the immutable LP artifact bytes');
assert.equal(canonical(envelope.record), canonical(raw.record), 'candidate envelope must preserve the LP record');
assert.equal(raw.record.seed, 1, 'repin harness is scoped to immutable seed 1');

const recordBefore = JSON.stringify(raw.record);
const adapted = adaptLpGamePayload(envelope);
assert.equal(JSON.stringify(raw.record), recordBefore, 'adapter and derived field projection may not mutate the raw LP record');
assert.equal(adapted.footballStateAudit.finding_count, 0, 'candidate must pass the independent football-state audit');
const driveIndexMismatches = auditDriveIndex(raw.record).length;
assert.equal(driveIndexMismatches, 0, 'candidate must pass the hard drive-index reject');

let fieldPositionsChecked = 0;
let nullSpotsPreserved = 0;
const directionCounts = { '+1': 0, '-1': 0 };
for (const drive of raw.record.drives) {
  for (const play of drive.plays) {
    const stateAfter = play.state_after;
    const fieldAfter = play.field?.after;
    assert.ok(fieldAfter && typeof fieldAfter === 'object', `play ${play.id} must expose its field.after display block`);
    if (stateAfter.yardline_100 === null || stateAfter.yardline_100 === undefined) {
      assert.equal(fieldAfter.dir, null, `play ${play.id} terminal direction must remain unknown`);
      assert.equal(fieldAfter.los, null, `play ${play.id} terminal LOS must remain unknown`);
      nullSpotsPreserved += 1;
      continue;
    }
    const projectedStateAfter = {
      ...stateAfter,
      ...resolveAssignedFieldSpot({
        assignment,
        teamId: stateAfter.offense_team,
        period: `Q${stateAfter.quarter}`,
        yardline100: stateAfter.yardline_100,
      }),
    };
    assert.equal(fieldAfter.dir, projectedStateAfter.dir, `play ${play.id} state_after dir must match explicit assignment`);
    assert.equal(fieldAfter.los, projectedStateAfter.los, `play ${play.id} state_after los must match the conversion`);
    directionCounts[projectedStateAfter.dir === 1 ? '+1' : '-1'] += 1;
    fieldPositionsChecked += 1;
  }
}
assert.ok(directionCounts['+1'] > 0 && directionCounts['-1'] > 0, 'seed 1 must exercise both direction conversions');

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
};
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = resolve(root, `.${pathname}`);
    if (file !== root && !file.startsWith(root + sep)) {
      response.writeHead(403).end('forbidden');
      return;
    }
    const bytes = await readFile(file);
    response.writeHead(200, { 'content-type': contentTypes[extname(file)] ?? 'application/octet-stream' });
    response.end(bytes);
  } catch {
    response.writeHead(404).end('not found');
  }
});

await new Promise((done) => server.listen(0, '127.0.0.1', done));
const { port } = server.address();
const { chromium } = await import(pathToFileURL(resolve(playwrightModule)).href);
const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox'] });
const pageErrors = [];

try {
  const browserManifest = structuredClone(manifest);
  const browserEntry = browserManifest.fixtures[0];
  const sourceAlias = 'repin-candidate-seed1.json';
  browserEntry.upstream_source_file = sourceAlias;
  const context = await browser.newContext();
  await context.route('**/docs/fixtures/e2/MANIFEST.json', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(browserManifest),
  }));
  await context.route(`**/docs/fixtures/e2/${browserEntry.file}`, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: candidateEnvelopeBytes,
  }));
  await context.route(`**/docs/fixtures/e2/${sourceAlias}`, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: candidateRawBytes,
  }));
  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}/e2-game-viewer.html`);
  await page.locator('#viewer-content:not([hidden])').waitFor({ timeout: 15000 });
  assert.equal(await page.locator('#load-error').isHidden(), true);
  const driveCount = raw.record.drives.length;
  const playCount = raw.record.drives.reduce((sum, drive) => sum + drive.plays.length, 0);
  assert.equal(await page.locator('#drive-select option').count(), driveCount);
  assert.equal(await page.locator('#score-a').innerText(), String(raw.record.points.A));
  assert.equal(await page.locator('#score-b').innerText(), String(raw.record.points.B));
  assert.match(await page.locator('#state-audit-summary').innerText(), /0 findings/);
  await page.locator('#drive-select').selectOption(String(driveCount - 1));
  const finalDrivePlayCount = await page.locator('#play-select option').count();
  await page.locator('#play-select').selectOption(String(finalDrivePlayCount - 1));
  const finalSequence = raw.record.drives.at(-1).plays.at(-1).sequence;
  assert.match(await page.locator('#play-meta').innerText(), new RegExp(`${driveCount} \/ ${finalSequence}`));
  assert.match(await page.locator('#e3-load-status').innerText(), /verified by SHA-256/);
  assert.equal(pageErrors.length, 0, `browser runtime errors: ${pageErrors.join('; ')}`);

  console.log(`PASS adapter + independent state audit: ${driveCount} drives / ${playCount} plays; 0 state findings; drive-index mismatches=${driveIndexMismatches}; ${adapted.sharedV1Audit.violations.length} raw-record v1 gaps`);
  console.log(`PASS field-end projection: team-period-field-end-v1 (authored test-only); ${fieldPositionsChecked} state_after spots (+1=${directionCounts['+1']}, -1=${directionCounts['-1']}); ${nullSpotsPreserved} null terminal spots preserved; 0 mismatches`);
  console.log(`PASS browser viewer: loaded and navigated Drive ${driveCount} / Play ${finalSequence}; score A ${raw.record.points.A}–B ${raw.record.points.B}; runtime errors=${pageErrors.length}`);
  const missingDurationPlays = raw.record.drives.flatMap((drive) => drive.plays)
    .filter((play) => play.outcome.duration_seconds == null).length;
  console.log(`OPEN shared-v1/pregame gate: ${adapted.sharedV1Audit.violations.length} raw-record gaps; valid_full_game=${raw.record.valid_full_game}`);
  for (const violation of adapted.sharedV1Audit.violations) console.log(`  OPEN producer field: ${violation}`);
  console.log(`OPEN pregame fixture requirements: scheduled game ID; real home/away rosters; as-of and snapshot hashes; model/rules versions; explicit duration for ${missingDurationPlays}/${playCount} plays; valid_full_game=true`);
  console.log(`LP valid_full_game=${raw.record.valid_full_game}; unsupported_rules=${JSON.stringify(raw.record.unsupported_rules)}`);
  await context.close();
} finally {
  await browser.close();
  await new Promise((done, reject) => server.close((error) => error ? reject(error) : done()));
}
