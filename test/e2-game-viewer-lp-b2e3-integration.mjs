import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const lpRepo = process.env.LP_E2_REPO ?? '/root/lp-nfl-sequence-e2';
const lpCommit = process.env.LP_E2_COMMIT ?? 'b2e3be4876d644d2ad8a5f94b7d25365ba7ba724';
const lpPayloadPath = 'docs/fixtures/e2/e2-game-seed1.json';
const playwrightModule = process.env.PLAYWRIGHT_MODULE;
const chromePath = process.env.CHROME_BIN;
if (!playwrightModule || !chromePath) {
  throw new Error('Set PLAYWRIGHT_MODULE and CHROME_BIN for the real-browser integration proof.');
}

const resolvedCommit = execFileSync('git', ['-C', lpRepo, 'rev-parse', `${lpCommit}^{commit}`], { encoding: 'utf8' }).trim();
assert.equal(resolvedCommit, lpCommit, 'the requested LP evidence commit must resolve exactly');
const lpPayloadBytes = execFileSync('git', ['-C', lpRepo, 'show', `${resolvedCommit}:${lpPayloadPath}`]);
const lpPayloadSha256 = createHash('sha256').update(lpPayloadBytes).digest('hex');
const lpPayload = JSON.parse(lpPayloadBytes.toString('utf8'));

const manifest = JSON.parse(await readFile(resolve(root, 'docs/fixtures/e2/MANIFEST.json'), 'utf8'));
const entry = manifest.fixtures[0];
const envelope = JSON.parse(await readFile(resolve(root, 'docs/fixtures/e2', entry.file), 'utf8'));
const pinnedRaw = await readFile(resolve(root, 'docs/fixtures/e2', entry.upstream_source_file));
const pinnedRawSha256 = createHash('sha256').update(pinnedRaw).digest('hex');
const contractBytes = await readFile(resolve(root, 'docs/GRIDIRON-CONTRACT-v1.md'));
const contractSha256 = createHash('sha256').update(contractBytes).digest('hex');

assert.equal(lpPayloadSha256, entry.upstream_source_sha256, 'b2e3 raw payload must match the current raw-source SHA pin');
assert.equal(lpPayloadSha256, pinnedRawSha256, 'b2e3 raw payload must be byte-identical to the current Gridiron raw-source fixture');
assert.deepEqual(lpPayload.record, envelope.record, 'the viewer envelope record must equal the LP b2e3 record');
assert.equal(manifest.lp_source.base_commit, envelope.source.base_commit, 'the committed envelope pin remains internally consistent');

// Change only the upstream raw-source URL in this in-memory browser response.
// The committed Gridiron manifest, envelope, producer SHA pin and record are not rewritten.
const b2SourceAlias = 'lp-e2-game-seed1-b2e3be48.json';
const browserManifest = structuredClone(manifest);
browserManifest.fixtures[0].upstream_source_file = b2SourceAlias;

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
  const context = await browser.newContext();
  await context.route('**/docs/fixtures/e2/MANIFEST.json', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(browserManifest),
  }));
  await context.route(`**/docs/fixtures/e2/${b2SourceAlias}`, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: lpPayloadBytes,
  }));
  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}/e2-game-viewer.html`);
  await page.locator('#viewer-content:not([hidden])').waitFor({ timeout: 15000 });
  assert.equal(await page.locator('#load-error').isHidden(), true);
  assert.equal(await page.locator('#drive-select option').count(), 24);
  assert.equal(await page.locator('#score-a').innerText(), '14');
  assert.equal(await page.locator('#score-b').innerText(), '10');
  assert.match(await page.locator('#state-audit-summary').innerText(), /0 findings/);
  await page.locator('#drive-select').selectOption('23');
  const finalDrivePlayCount = await page.locator('#play-select option').count();
  await page.locator('#play-select').selectOption(String(finalDrivePlayCount - 1));
  assert.match(await page.locator('#play-meta').innerText(), /24 \/ 143/);
  assert.match(await page.locator('#e3-load-status').innerText(), /verified by SHA-256/);
  assert.equal(pageErrors.length, 0, `browser runtime errors: ${pageErrors.join('; ')}`);

  console.log(`LP source commit: ${resolvedCommit}`);
  console.log(`LP raw payload SHA-256: ${lpPayloadSha256}`);
  console.log(`Gridiron shared contract v1 SHA-256: ${contractSha256}`);
  console.log(`Viewer integration: loaded and navigated 24 drives / 143 plays; score A ${lpPayload.record.points.A}–B ${lpPayload.record.points.B}; independent state audit 0 findings`);
  console.log(`Committed Gridiron pin unchanged: envelope ${manifest.lp_source.envelope_commit}; raw producer ${manifest.lp_source.base_commit}`);
  console.log(`Browser runtime errors: ${pageErrors.length}`);
  await context.close();
} finally {
  await browser.close();
  await new Promise((done, reject) => server.close((error) => error ? reject(error) : done()));
}
