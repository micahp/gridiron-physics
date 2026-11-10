import assert from 'node:assert/strict';
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
  const manifest = JSON.parse(await readFile(resolve(root, 'docs/fixtures/e2/MANIFEST.json'), 'utf8'));
  const entry = manifest.fixtures[0];
  const regression = manifest.regression_fixtures[0];
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}/e2-game-viewer.html`);
  await page.locator('#viewer-content:not([hidden])').waitFor({ timeout: 15000 });
  assert.equal(await page.locator('#load-error').isHidden(), true);
  assert.equal(await page.locator('#drive-select option').count(), 24);
  assert.equal(await page.locator('#score-a').innerText(), '14');
  assert.equal(await page.locator('#score-b').innerText(), '10');
  await page.locator('#drive-select').selectOption('23');
  assert.match(await page.locator('#drive-summary').innerText(), /Drive 24/);
  const finalDrivePlayCount = await page.locator('#play-select option').count();
  await page.locator('#play-select').selectOption(String(finalDrivePlayCount - 1));
  assert.match(await page.locator('#play-meta').innerText(), /24 \/ 143/);
  assert.match(await page.locator('#state-audit-summary').innerText(), /0 findings/);
  assert.match(await page.locator('#e3-clock-caveat').innerText(), /594 \/ 7016/);
  assert.match(await page.locator('#e3-load-status').innerText(), /verified by SHA-256/);
  assert.match(await page.locator('#e3-lp-clock-status').innerText(), /15,768 rows/);
  assert.match(await page.locator('#e3-lp-clock-status').innerText(), /9,066 matched/);
  assert.equal(await page.locator('#e3-lp-clock-table tbody tr').count(), 8);
  assert.match(await page.locator('#e3-lp-clock-null-policy').innerText(), /unresolvable remain null/);
  const lpClockRows = await page.locator('#e3-lp-clock-table tbody tr').allInnerTexts();
  assert.match(lpClockRows.join('\n'), /timeouts_remaining\s+0\s+0\s+9066/);
  assert.match(lpClockRows.join('\n'), /penalty_clock_stop\s+0\s+0\s+9066/);
  assert.match(lpClockRows.join('\n'), /two_minute_warning_event\s+0\s+0\s+9066/);
  assert.match(await page.locator('#e3-unsupported-list').innerText(), /timeouts[\s\S]*two_minute_warning/);
  assert.match(await page.locator('#conversion-source-status').innerText(), /PASS/);
  assert.match(await page.locator('#e3-play-table').innerText(), /Generated · n=143/);
  assert.equal(await page.locator('#e3-play-table tbody tr').count(), 4);
  assert.equal(await page.locator('#e3-drive-table tbody tr').count(), 5);
  assert.equal(await page.locator('#e3-game-table tbody tr').count(), 13);
  await context.close();

  const oldEnvelope = await readFile(resolve(root, 'docs/fixtures/e2', regression.file), 'utf8');
  const oldRaw = await readFile(resolve(root, 'docs/fixtures/e2', regression.upstream_source_file), 'utf8');
  const legacyManifest = structuredClone(manifest);
  legacyManifest.fixtures = [{
    file: regression.file,
    sha256: regression.sha256,
    upstream_source_file: regression.upstream_source_file,
    upstream_source_sha256: regression.upstream_source_sha256,
  }];
  legacyManifest.lp_source.base_commit = regression.producer_commit;
  legacyManifest.lp_source.conversion_source_script_commit = regression.conversion_source_script_commit;
  legacyManifest.lp_source.conversion_source_script_file = regression.conversion_source_script_file;
  legacyManifest.lp_source.conversion_source_script_sha256 = regression.conversion_source_script_sha256;
  const regressionContext = await browser.newContext();
  await regressionContext.route('**/docs/fixtures/e2/MANIFEST.json', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(legacyManifest),
  }));
  await regressionContext.route(`**/docs/fixtures/e2/${regression.file}`, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: oldEnvelope,
  }));
  await regressionContext.route(`**/docs/fixtures/e2/${regression.upstream_source_file}`, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: oldRaw,
  }));
  const regressionPage = await regressionContext.newPage();
  regressionPage.on('pageerror', (error) => pageErrors.push(error.message));
  await regressionPage.goto(`http://127.0.0.1:${port}/e2-game-viewer.html`);
  await regressionPage.locator('#load-error:not([hidden])').waitFor({ timeout: 15000 });
  assert.match(await regressionPage.locator('#load-error').innerText(), /23 drive-index mismatches/);
  assert.equal(await regressionPage.locator('#viewer-content').isHidden(), true);
  assert.match(await regressionPage.locator('#state-audit-summary').innerText(), /1175 findings/);
  assert.match(await regressionPage.locator('#conversion-source-status').innerText(), /EPA-positive success/);
  assert.equal(pageErrors.length, 0, `browser runtime errors: ${pageErrors.join('; ')}`);
  await regressionContext.close();

  const fallbackPage = await browser.newPage();
  fallbackPage.on('pageerror', (error) => pageErrors.push(error.message));
  await fallbackPage.goto(`http://127.0.0.1:${port}/e2-matchups.html`);
  await fallbackPage.locator('#matchup-rows tr').nth(5).waitFor();
  assert.equal(await fallbackPage.locator('#matchup-rows tr').count(), 6);
  assert.match(await fallbackPage.locator('.retrospective-banner').innerText(), /2022-pool retrospective demonstration.*Not a 2026 forecast.*valid_full_game=false/);
  assert.match(await fallbackPage.locator('#matchup-rows').innerText(), /Bengals at Ravens[\s\S]*Dolphins at Jets[\s\S]*49ers at Falcons[\s\S]*Buccaneers at Panthers[\s\S]*Packers at Lions[\s\S]*Cowboys at Eagles/);
  assert.match(await fallbackPage.locator('#index-error').innerText(), /not available yet/);
  assert.equal(await fallbackPage.locator('#matchup-rows a').count(), 0, 'missing LP rows must not point at another game');
  await fallbackPage.close();

  // This route fixture exercises index-to-viewer navigation only; the indexed
  // artifact is intercepted in memory and is not represented as a real matchup.
  const indexContext = await browser.newContext();
  await indexContext.route('**/docs/fixtures/e2/matchup-index.json', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      lp_source: manifest.lp_source,
      games: [{
        matchup_id: 'bengals-at-ravens',
        away_team: 'Bengals',
        home_team: 'Ravens',
        final_score: { away: 10, home: 14 },
        drive_count: 24,
        play_count: 143,
        fixture: {
          file: `docs/fixtures/e2/${entry.file}`,
          sha256: entry.sha256,
          upstream_source_file: `docs/fixtures/e2/${entry.upstream_source_file}`,
          upstream_source_sha256: entry.upstream_source_sha256,
        },
      }],
    }),
  }));
  const indexPage = await indexContext.newPage();
  indexPage.on('pageerror', (error) => pageErrors.push(error.message));
  await indexPage.goto(`http://127.0.0.1:${port}/e2-matchups.html`);
  await indexPage.locator('#matchup-rows a').waitFor();
  assert.match(await indexPage.locator('#matchup-rows tr').first().innerText(), /Bengals at Ravens[\s\S]*10 – 14[\s\S]*24[\s\S]*143/);
  await indexPage.locator('#matchup-rows a').first().click();
  await indexPage.locator('#viewer-content:not([hidden])').waitFor({ timeout: 15000 });
  assert.match(await indexPage.locator('#mode-label').innerText(), /Bengals at Ravens/i);
  assert.equal(await indexPage.locator('#drive-select option').count(), 24);
  await indexPage.locator('#drive-select').selectOption('23');
  assert.match(await indexPage.locator('#drive-summary').innerText(), /Drive 24/);
  const indexedPlayCount = await indexPage.locator('#play-select option').count();
  await indexPage.locator('#play-select').selectOption(String(indexedPlayCount - 1));
  assert.match(await indexPage.locator('#play-meta').innerText(), /Q[1-4]/);
  assert.match(await indexPage.locator('.retrospective-banner').innerText(), /valid_full_game=false/);
  assert.equal(pageErrors.length, 0, `browser runtime errors: ${pageErrors.join('; ')}`);
  await indexContext.close();

  console.log('Real Chromium navigation: current pinned E2 record; old 5fc rejected; six-row fallback and fixture-only indexed play navigation pass');
  console.log(`Browser runtime errors: ${pageErrors.length}`);
} finally {
  await browser.close();
  await new Promise((done, reject) => server.close((error) => error ? reject(error) : done()));
}
