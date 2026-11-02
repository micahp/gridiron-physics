import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

const [shortlistArg, traceDirArg, outputArg = 'docs/fixtures/e2/min-det-realism'] = process.argv.slice(2);
assert.ok(shortlistArg && traceDirArg,
  'usage: node scripts/import-lp-slc-marketing-seeds.mjs MARKETING_SEEDS.json TRACE_DIR [OUTPUT_DIR]');

const root = resolve(new URL('..', import.meta.url).pathname);
const shortlistPath = resolve(shortlistArg);
const traceDir = resolve(traceDirArg);
const outputDir = resolve(root, outputArg);
const upstreamDir = join(outputDir, 'upstream');
const gamesDir = join(outputDir, 'games');
const outputRelative = relative(root, outputDir).split(sep).join('/');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const writeJson = (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`);

const shortlist = JSON.parse(await readFile(shortlistPath, 'utf8'));
assert.equal(shortlist.schema, 'lp.nfl.slc-marketing-seeds.v1');
assert.ok(Array.isArray(shortlist.seeds) && shortlist.seeds.length > 0, 'shortlist must contain selected seeds');
const manifestPath = join(outputDir, 'MANIFEST.json');
try {
  const existing = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.equal(existing.schema, 'gridiron.lp.slc-seed-library.v1', 'refusing to replace an unrelated output directory');
  assert.equal(existing.source?.repository, 'Legendary Picks', 'refusing to replace an unrelated output directory');
  assert.equal(existing.source?.run_id, shortlist.run_id, 'refusing to replace artifacts from a different LP run');
  assert.deepEqual(existing.fixtures.map((entry) => entry.seed).sort((a, b) => a - b),
    shortlist.seeds.map((entry) => Number(entry.seed)).sort((a, b) => a - b),
    'refusing to replace a seed library with a different seed set');
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}
await mkdir(upstreamDir, { recursive: true });
await mkdir(gamesDir, { recursive: true });

const fixtures = [];
for (const selected of shortlist.seeds) {
  assert.equal(selected.replay_status, 'passed', `seed ${selected.seed} did not pass Stage B`);
  assert.equal(selected.gate?.renderable, true, `seed ${selected.seed} is not renderable`);
  const seed = Number(selected.seed);
  const sourcePath = join(traceDir, `seed-${seed}.json`);
  const sourceBytes = await readFile(sourcePath);
  const sourceHash = hash(sourceBytes);
  const trace = JSON.parse(sourceBytes.toString('utf8'));
  assert.equal(trace.seed, seed, `trace seed identity mismatch for ${seed}`);
  assert.equal(trace.result?.seed, seed, `record seed identity mismatch for ${seed}`);
  assert.equal(trace.source?.producer_worktree_dirty, false, `seed ${seed} came from a dirty source tree`);
  assert.equal(trace.source?.base_commit, shortlist.source_commit ?? trace.source?.base_commit,
    `source commit mismatch for seed ${seed}`);

  const upstreamRelative = `${outputRelative}/upstream/seed-${seed}.json`;
  const gameRelative = `${outputRelative}/games/seed-${seed}.json`;
  const upstreamPath = join(root, upstreamRelative);
  await writeFile(upstreamPath, sourceBytes);
  const payload = {
    contract: { name: 'gridiron.lp-full-game-payload', version: '1.0.0' },
    source: {
      ...trace.source,
      branch: trace.source.branch || `detached@${String(trace.source.base_commit ?? '').slice(0, 8)}`,
      event_record_type: 'statistical_slc_simulation',
      physical_trajectories: 'not_provided',
      payload_path: upstreamRelative,
      payload_sha256: sourceHash,
    },
    record: trace.result,
  };
  const gamePath = join(root, gameRelative);
  const gameBytes = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`);
  await writeFile(gamePath, gameBytes);
  fixtures.push({
    seed,
    file: gameRelative,
    sha256: hash(gameBytes),
    record_mode: trace.result.mode,
    source_commit: trace.source.base_commit,
    configuration_hash: trace.replay_boxscore?.configuration_hash,
    upstream_source_file: upstreamRelative,
    upstream_source_sha256: sourceHash,
  });
}

await writeJson(join(outputDir, 'marketing-seeds.json'), shortlist);
await writeJson(manifestPath, {
  schema: 'gridiron.lp.slc-seed-library.v1',
  contract: { name: 'gridiron.lp-full-game-payload', version: '1.0.0' },
  source: {
    repository: 'Legendary Picks',
    run_id: shortlist.run_id ?? null,
    source_commit: shortlist.source_commit ?? fixtures[0]?.source_commit ?? null,
    shortlist_sha256: hash(await readFile(shortlistPath)),
  },
  fixtures,
});
console.log(`Imported ${fixtures.length} pinned SLC seed payloads to ${relative(root, outputDir)}`);
