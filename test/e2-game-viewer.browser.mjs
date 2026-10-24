import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const playwrightModule = process.env.PLAYWRIGHT_MODULE;
const chromePath = process.env.CHROME_BIN;
if (!playwrightModule || !chromePath) {
  throw new Error('Set PLAYWRIGHT_MODULE and CHROME_BIN to run the real-browser navigation test.');
}
const { chromium } = await import(pathToFileURL(resolve(playwrightModule)).href);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

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
const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox'] });
const pageErrors = [];

try {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}/e2-game-viewer.html`);
  await page.locator('#load-error:not([hidden])').waitFor({ timeout: 15000 });
  assert.match(await page.locator('#load-error').innerText(), /23 drive-index mismatches/);
  assert.equal(await page.locator('#viewer-content').isHidden(), true,
    'the source with drive-index defects must not expose game navigation');
  assert.match(await page.locator('#e3-clock-caveat').innerText(), /594 \/ 7016/);
  assert.match(await page.locator('#e3-load-status').innerText(), /verified by SHA-256/);
  assert.match(await page.locator('#e3-unsupported-list').innerText(), /timeouts[\s\S]*two_minute_warning/);
  assert.match(await page.locator('#conversion-source-status').innerText(), /EPA-positive success/);
  assert.equal(await page.locator('#e3-play-table tbody tr').count(), 4);
  assert.equal(await page.locator('#e3-drive-table tbody tr').count(), 5);
  assert.equal(await page.locator('#e3-game-table tbody tr').count(), 13);
  await context.close();

  // Browser-only synthetic control: repair only the index fields in memory so
  // the actual UI selectors can be exercised. No fixture file or LP outcome is
  // written, committed, or represented as a valid LP payload.
  const manifest = JSON.parse(await readFile(resolve(root, 'docs/fixtures/e2/MANIFEST.json'), 'utf8'));
  const entry = manifest.fixtures[0];
  const transport = JSON.parse(await readFile(resolve(root, 'docs/fixtures/e2', entry.file), 'utf8'));
  const upstream = JSON.parse(await readFile(resolve(root, 'docs/fixtures/e2', entry.upstream_source_file), 'utf8'));
  for (const record of [transport.record, upstream.record]) {
    for (const drive of record.drives) for (const play of drive.plays) {
      play.state_before.drive_index = drive.index;
      play.state_after.drive_index = drive.index;
    }
  }
  const upstreamText = JSON.stringify(upstream);
  const upstreamHash = sha256(Buffer.from(upstreamText));
  transport.source.payload_sha256 = upstreamHash;
  const transportText = JSON.stringify(transport);
  const transportHash = sha256(Buffer.from(transportText));
  const testManifest = structuredClone(manifest);
  testManifest.fixtures[0].sha256 = transportHash;
  testManifest.fixtures[0].upstream_source_sha256 = upstreamHash;
  const testManifestText = JSON.stringify(testManifest);

  const controlContext = await browser.newContext();
  await controlContext.route('**/docs/fixtures/e2/MANIFEST.json', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: testManifestText,
  }));
  await controlContext.route(`**/docs/fixtures/e2/${entry.file}`, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: transportText,
  }));
  await controlContext.route(`**/docs/fixtures/e2/${entry.upstream_source_file}`, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: upstreamText,
  }));
  const control = await controlContext.newPage();
  control.on('pageerror', (error) => pageErrors.push(error.message));
  await control.goto(`http://127.0.0.1:${port}/e2-game-viewer.html`);
  await control.locator('#viewer-content:not([hidden])').waitFor({ timeout: 15000 });
  assert.equal(await control.locator('#load-error').isHidden(), true);
  assert.equal(await control.locator('#drive-select option').count(), 24);
  await control.locator('#drive-select').selectOption('23');
  assert.match(await control.locator('#drive-summary').innerText(), /Drive 24/);
  const finalDrivePlayCount = await control.locator('#play-select option').count();
  await control.locator('#play-select').selectOption(String(finalDrivePlayCount - 1));
  assert.match(await control.locator('#play-meta').innerText(), /24 \/ 144/);
  assert.match(await control.locator('#state-audit-table').innerText(), /score_state_missing[\s\S]*576/,
    'the navigation control still exposes missing state; it does not promote the record');
  assert.equal(pageErrors.length, 0, `browser runtime errors: ${pageErrors.join('; ')}`);
  await controlContext.close();

  console.log('Real Chromium navigation: 2 page loads; pinned 5fc hard-rejected; in-memory control navigated Drive 24 / Play 144');
  console.log(`Browser runtime errors: ${pageErrors.length}`);
} finally {
  await browser.close();
  await new Promise((done, reject) => server.close((error) => error ? reject(error) : done()));
}
