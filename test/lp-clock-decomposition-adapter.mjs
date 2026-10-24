import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  joinPhysicalTiming,
  loadLpClockDecomposition,
  parseLpClockCsv,
  validateLpClockSummary,
} from '../web/lp-clock-decomposition-adapter.js';

const root = resolve(new URL('..', import.meta.url).pathname);
async function localFetch(path) {
  const bytes = await readFile(resolve(root, String(path)));
  return {
    ok: true,
    status: 200,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    json: async () => JSON.parse(bytes.toString('utf8')),
  };
}

const loaded = await loadLpClockDecomposition(localFetch);
let scenarios = 0;
assert.equal(loaded.manifest.source.commit, '4e18cb9f9e5b29ae9e105cbed37f90dc915c83da');
assert.equal(loaded.rows.length, 15768);
assert.equal(loaded.joined.length, 9289);
assert.deepEqual(loaded.joinSummary.counts, { matched: 9066, no_lp_key: 223, no_source_row: 0 });
assert.equal(loaded.joinSummary.fields.in_play_s.inferred + loaded.joinSummary.fields.in_play_s.unresolvable, 9066);
scenarios += 1;

const joined = loaded.joined.find((item) => item.join_status === 'matched');
assert.ok(joined);
for (const field of ['timeouts_remaining', 'penalty_clock_stop', 'two_minute_warning_event']) {
  assert.equal(joined.clock.metrics[field].label, 'unresolvable');
  assert.equal(joined.clock.metrics[field].value, null);
}
assert.equal(Object.hasOwn(joined.clock.metrics, 'elapsed_seconds'), false);
assert.ok(Object.hasOwn(joined.physical, 'elapsed_seconds'));
scenarios += 1;

const missingSource = joinPhysicalTiming([{
  lp_join_status: 'matched', lp_game_id: 'missing_game', lp_play_id: 987654, week: 1,
}], loaded.rows);
assert.equal(missingSource[0].join_status, 'no_source_row');
assert.equal(missingSource[0].clock, null);
scenarios += 1;
const missingKey = joinPhysicalTiming([{ lp_join_status: 'unmatched', lp_game_id: null, lp_play_id: null }], loaded.rows);
assert.equal(missingKey[0].join_status, 'no_lp_key');
assert.equal(missingKey[0].clock, null);
scenarios += 1;

const manifest = JSON.parse(await readFile(resolve(root, 'docs/fixtures/e3/lp-clock-decomposition/MANIFEST.json'), 'utf8'));
function encodeRow(headers, raw) {
  return headers.map((key) => `"${String(raw[key]).replaceAll('"', '""')}"`).join(',');
}
const oneRowManifest = structuredClone(manifest);
oneRowManifest.source.rows = 1;
const first = loaded.rows[0].raw;
const invalidUnresolvable = { ...first, timeouts_remaining: '1' };
assert.throws(() => parseLpClockCsv(`${manifest.csv_header.join(',')}\n${encodeRow(manifest.csv_header, invalidUnresolvable)}\n`, oneRowManifest), /marked unresolvable/);
scenarios += 1;
const invalidInferred = { ...first, in_play_s: '' };
assert.throws(() => parseLpClockCsv(`${manifest.csv_header.join(',')}\n${encodeRow(manifest.csv_header, invalidInferred)}\n`, oneRowManifest), /no value/);
scenarios += 1;

const badSummary = structuredClone(loaded.summary);
badSummary.labels.game_clock_delta_s.inferred -= 1;
assert.throws(() => validateLpClockSummary(badSummary, loaded.rows, manifest), /disagree for game_clock_delta_s/);
scenarios += 1;

const badHashFetch = async (path) => {
  const response = await localFetch(path);
  if (!String(path).endsWith('e3-clock-decomposition.csv')) return response;
  const original = await response.arrayBuffer();
  const bytes = new Uint8Array(original);
  bytes[bytes.length - 2] ^= 1;
  return { ...response, arrayBuffer: async () => bytes.buffer };
};
await assert.rejects(loadLpClockDecomposition(badHashFetch), /SHA-256 mismatch/);
scenarios += 1;

console.log(`LP clock consumer tests: ${scenarios}/8 scenario groups passed`);
console.log(`Pinned LP source: ${loaded.rows.length} rows; exact-key physical join ${loaded.joinSummary.counts.matched}/9066; no-key ${loaded.joinSummary.counts.no_lp_key}; missing source rows ${loaded.joinSummary.counts.no_source_row}`);
console.log('Unresolvable-value policy: null preserved; no clock or elapsed-time substitution');
