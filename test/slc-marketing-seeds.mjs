import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { adaptLpGamePayload } from '../web/lp-game-record-adapter.js';

const root = resolve(new URL('..', import.meta.url).pathname);
const manifestPath = resolve(root, 'docs/fixtures/e2/min-det-realism/MANIFEST.json');
const shortlistPath = resolve(root, 'docs/fixtures/e2/min-det-realism/marketing-seeds.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const shortlist = JSON.parse(await readFile(shortlistPath, 'utf8'));
assert.equal(manifest.contract.name, 'gridiron.lp-full-game-payload');
assert.equal(manifest.contract.version, '1.0.0');
assert.equal(shortlist.schema, 'lp.nfl.slc-marketing-seeds.v1');
assert.equal(manifest.fixtures.length, shortlist.seeds.length);

const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;
for (const selected of shortlist.seeds) {
  const pin = manifest.fixtures.find((entry) => entry.seed === selected.seed);
  assert.ok(pin, `seed ${selected.seed} has a pinned payload`);
  const envelopeBytes = await readFile(resolve(root, pin.file));
  assert.equal(createHash('sha256').update(envelopeBytes).digest('hex'), pin.sha256,
    `seed ${selected.seed} envelope matches its SHA-256`);
  const payload = JSON.parse(envelopeBytes.toString('utf8'));
  assert.equal(payload.record.seed, selected.seed);
  assert.equal(payload.record.mode, pin.record_mode, 'LP record mode is preserved');
  assert.equal(payload.source.event_record_type, 'statistical_slc_simulation');
  assert.equal(payload.source.physical_trajectories, 'not_provided');
  const traceBytes = await readFile(resolve(root, pin.upstream_source_file));
  assert.equal(createHash('sha256').update(traceBytes).digest('hex'), pin.upstream_source_sha256);
  const trace = JSON.parse(traceBytes.toString('utf8'));
  assert.deepEqual(canonical(payload.record), canonical(trace.result),
    `seed ${selected.seed} record equals its exact replay trace`);
  const adapted = adaptLpGamePayload(payload);
  assert.equal(adapted.validation.passed, true, `seed ${selected.seed} passes the E2 record adapter`);
  assert.match(adapted.displayLabel, /^HYPOTHETICAL SLC GAME/);
  assert.equal(adapted.record.seed, selected.seed);
  assert.deepEqual(adapted.record, payload.record, 'adapter preserves all LP source fields');
  assert.equal(adapted.sharedV1Audit.conforms, false,
    'the research E2 payload does not promote the statistical source to shared-v1 full-game conformance');
}
console.log(`SLC marketing payloads: ${shortlist.seeds.length} verified, immutable E2 records`);
