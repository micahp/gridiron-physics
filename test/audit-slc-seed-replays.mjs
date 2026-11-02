import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { adaptLpGamePayload } from '../web/lp-game-record-adapter.js';

const [traceDirArg, outputArg] = process.argv.slice(2);
assert.ok(traceDirArg && outputArg, 'usage: node test/audit-slc-seed-replays.mjs TRACE_DIR OUTPUT_JSON');
const traceDir = resolve(traceDirArg);
const files = (await readdir(traceDir)).filter((name) => /^seed-\d+\.json$/.test(name)).sort();
const seeds = [];
for (const file of files) {
  const bytes = await readFile(join(traceDir, file));
  const trace = JSON.parse(bytes.toString('utf8'));
  const seed = Number(basename(file).match(/^seed-(\d+)\.json$/)[1]);
  const findings = [];
  let validationPassed = false;
  let sharedV1Conforms = false;
  if (trace.seed !== seed || trace.result?.seed !== seed) findings.push('trace or record seed identity mismatch');
  try {
    const producer = trace.source ?? {};
    const payload = {
      contract: { name: 'gridiron.lp-full-game-payload', version: '1.0.0' },
      source: {
        ...producer,
        branch: producer.branch || `detached@${String(producer.base_commit ?? '').slice(0, 8)}`,
        event_record_type: 'statistical_slc_simulation',
        physical_trajectories: 'not_provided',
        payload_path: `docs/fixtures/e2/min-det-realism/upstream/seed-${seed}.json`,
        payload_sha256: createHash('sha256').update(bytes).digest('hex'),
      },
      record: trace.result,
    };
    const adapted = adaptLpGamePayload(payload);
    validationPassed = adapted.validation.passed;
    sharedV1Conforms = adapted.sharedV1Audit.conforms;
    findings.push(...adapted.validation.findings.map((item) => String(item)));
    if (!validationPassed) findings.push('adapter validation did not pass');
  } catch (error) {
    findings.push(String(error?.message ?? error));
  }
  if (findings.some((item) => item.includes('seed identity mismatch'))) validationPassed = false;
  seeds.push({ seed, passed: validationPassed, validation_passed: validationPassed,
    shared_v1_conforms: sharedV1Conforms, findings });
}
const report = {
  schema: 'gridiron.lp.slc-seed-contract-audit.v1',
  audited: seeds.length,
  passed: seeds.filter((item) => item.passed).length,
  rejected: seeds.filter((item) => !item.passed).length,
  seeds,
};
await writeFile(resolve(outputArg), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ audited: report.audited, passed: report.passed, rejected: report.rejected }));
