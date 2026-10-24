import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { adaptLpGamePayload } from '../web/lp-game-record-adapter.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(resolve(root, 'docs/fixtures/e2/MANIFEST.json'), 'utf8'));
const fixtureEntry = manifest.fixtures[0];
const fixtureBytes = await readFile(resolve(root, 'docs/fixtures/e2', fixtureEntry.file));
const fixtureHash = createHash('sha256').update(fixtureBytes).digest('hex');
assert.equal(fixtureHash, fixtureEntry.sha256, 'fixture must match its pinned SHA-256');
const payload = JSON.parse(fixtureBytes.toString('utf8'));
const before = JSON.stringify(payload.record);

const adapted = adaptLpGamePayload(payload);
assert.equal(adapted.drives.length, 24);
assert.equal(adapted.sourcePlayCount, 144);
assert.equal(adapted.record.points.A, 11);
assert.equal(adapted.record.points.B, 17);
assert.equal(adapted.record.complete_regulation, true);
assert.equal(adapted.record.valid_full_game, false);
assert.equal(adapted.validation.passed, false, 'known LP drive-index defect must be visible');
assert.equal(adapted.validation.findings.length, 23);
assert.ok(adapted.validation.findings.every((finding) => finding.includes('drive_index 1/1')));
assert.equal(adapted.sharedV1Audit.conforms, false);
assert.ok(adapted.sharedV1Audit.violations.some((issue) => issue.includes('drive-local simulation prefixes')));
assert.equal(JSON.stringify(adapted.record), before, 'adapter must preserve the LP record exactly');
assert.ok(Object.isFrozen(adapted.record.drives[0].plays[0].outcome), 'source copy must be immutable');
assert.equal(adapted.drives[0].plays[0].source, adapted.record.drives[0].plays[0]);

const duplicateId = structuredClone(payload);
duplicateId.record.drives[1].plays[0].id = duplicateId.record.drives[0].plays[0].id;
assert.throws(() => adaptLpGamePayload(duplicateId), /duplicate source play ID/);

const wrongSequence = structuredClone(payload);
wrongSequence.record.drives[0].plays[0].id = 'e2-1-drive1:2';
assert.throws(() => adaptLpGamePayload(wrongSequence), /source sequence suffix/);

const countOnly = structuredClone(payload);
delete countOnly.record.drives[0].plays;
assert.throws(() => adaptLpGamePayload(countOnly), /must contain the source plays/);

const shortGame = structuredClone(payload);
shortGame.record.complete_regulation = false;
assert.throws(() => adaptLpGamePayload(shortGame), /requires a complete regulation record/);

const scoreMismatch = structuredClone(payload);
scoreMismatch.record.points.A += 1;
assert.ok(adaptLpGamePayload(scoreMismatch).validation.findings.some((finding) => finding.includes('points disagree')));

console.log('LP E2 game adapter: assertions passed');
console.log(`fixture=${fixtureEntry.file} sha256=${fixtureHash}`);
console.log(`drives=${adapted.drives.length} plays=${adapted.sourcePlayCount} score=A ${adapted.record.points.A}, B ${adapted.record.points.B}`);
console.log(`source validation findings=${adapted.validation.findings.length}; shared-v1 violations=${adapted.sharedV1Audit.violations.length}`);
