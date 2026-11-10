import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const lpRepo = process.env.LP_SEQUENCE_REPO;
const playwrightModule = process.env.PLAYWRIGHT_MODULE;
const chromePath = process.env.CHROME_BIN;
if (!lpRepo || !playwrightModule || !chromePath) {
  throw new Error('Set LP_SEQUENCE_REPO, PLAYWRIGHT_MODULE and CHROME_BIN for this real-browser source reconciliation.');
}
const pin = JSON.parse(await readFile(resolve(root, 'docs/fixtures/e2/real-record-pin.json'), 'utf8'));
const sourceBytes = execFileSync('git', ['-C', lpRepo, 'show', `${pin.lp_commit}:${pin.lp_artifact_path}`]);
const sourceHash = createHash('sha256').update(sourceBytes).digest('hex');
assert.equal(sourceHash, pin.lp_artifact_sha256);
assert.deepEqual(sourceBytes, await readFile(resolve(root, pin.local_snapshot_path)));
const { record } = JSON.parse(sourceBytes.toString('utf8'));
const { chromium } = await import(pathToFileURL(resolve(playwrightModule)).href);
const contentTypes = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };
const server = createServer(async (request, response) => {
  try {
    const path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = resolve(root, `.${path}`);
    if (file !== root && !file.startsWith(root + sep)) return response.writeHead(403).end('forbidden');
    const bytes = await readFile(file);
    response.writeHead(200, { 'content-type': `${contentTypes[extname(file)] ?? 'application/octet-stream'}; charset=utf-8` });
    response.end(bytes);
  } catch {
    response.writeHead(404).end('not found');
  }
});

await new Promise((done) => server.listen(0, '127.0.0.1', done));
const { port } = server.address();
const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox'] });
const errors = [];
const formatClock = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
const textFor = (key, value) => {
  if (value === null || value === undefined) return 'Not modelled';
  if (key === 'quarter') return `Q${value}`;
  if (key === 'clock_seconds') return formatClock(value);
  if (key === 'yards_to_go') return `${value} yd`;
  return String(value);
};

try {
  const page = await browser.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}/e2-matchups.html`);
  const matchupNames = [
    'Bengals at Ravens', 'Dolphins at Jets', '49ers at Falcons',
    'Buccaneers at Panthers', 'Packers at Lions', 'Cowboys at Eagles',
  ];
  assert.equal(await page.locator('tbody tr').count(), matchupNames.length);
  assert.match(await page.locator('.retrospective-banner').innerText(), /2022-pool retrospective demonstration.*Not a 2026 forecast.*valid_full_game=false/);
  for (const [offset, matchup] of matchupNames.entries()) {
    const cells = await page.locator('tbody tr').nth(offset).locator('td').allInnerTexts();
    assert.equal(cells[0], matchup);
    assert.equal(cells[1], 'Unavailable');
    assert.equal(cells[2], 'Unavailable');
    assert.equal(cells[3], 'Unavailable');
    assert.match(cells[4], /No matching LP matchup entry/);
  }
  await page.getByRole('link', { name: /Inspect the unmapped LP seed-1 record/ }).click();
  await page.waitForFunction((count) => document.querySelectorAll('#drive-select option').length === count,
    record.drives.length, { timeout: 15000 });
  assert.equal(await page.locator('#load-error').isHidden(), true);
  assert.match(await page.locator('.retrospective-banner').innerText(), /2022-pool retrospective demonstration.*Not a 2026 forecast.*valid_full_game=false/);
  assert.equal(await page.locator('#final-a').getAttribute('data-value'), String(record.points.A));
  assert.equal(await page.locator('#final-b').getAttribute('data-value'), String(record.points.B));
  assert.match(await page.locator('#game-flags').innerText(), /valid_full_game=false/);
  assert.match(await page.locator('#source-mode').innerText(), /legal_game_state_first_piece.*retrospective.*not a forecast/i);
  assert.match(await page.locator('#source-meta').innerText(), new RegExp(pin.lp_commit));
  assert.equal(await page.locator('#drive-rows tr').count(), record.drives.length);

  const stateFields = [
    'quarter', 'clock_seconds', 'down', 'yards_to_go', 'yardline_100',
    'offense_team', 'defense_team', 'home_score', 'away_score', 'drive_index',
  ];
  let reconciled = 0;
  for (const [driveOffset, drive] of record.drives.entries()) {
    await page.locator('#drive-select').selectOption(String(driveOffset));
    const row = await page.locator('#drive-rows tr').nth(driveOffset).locator('td').allInnerTexts();
    assert.equal(row[0], `Drive ${drive.index}`);
    assert.equal(row[1], drive.offense_team);
    assert.equal(row[2], `Q${drive.quarter_start} ${formatClock(drive.clock_start)}`);
    assert.equal(row[3], String(drive.plays.length));
    assert.equal(row[4], drive.terminal);
    assert.equal(row[5], `Q${drive.end_quarter} ${formatClock(drive.end_clock)}`);

    for (const [playOffset, play] of drive.plays.entries()) {
      await page.locator('#play-select').selectOption(String(playOffset));
      assert.equal(await page.locator('#event-text').getAttribute('data-value'), play.event_type);
      assert.equal(await page.locator('#event-text').innerText(),
        `${play.event_type} · yards_gained ${play.outcome.yards_gained ?? 'not modelled'} · touchdown ${play.outcome.touchdown}`);
      assert.equal(await page.locator('#replay-availability').getAttribute('data-value'), 'unavailable');
      assert.match(await page.locator('#replay-availability').innerText(), /3D replay unavailable for this play/);
      assert.equal(await page.locator('#summary-drive-index').getAttribute('data-value'), String(drive.index));
      assert.equal(await page.locator('#summary-state-drive-index').getAttribute('data-value'), String(play.state_before.drive_index));
      for (const [phase, state] of [['before', play.state_before], ['after', play.state_after]]) {
        const displayed = new Map(await page.locator(`#${phase}-state [data-field]`).evaluateAll((nodes) =>
          nodes.map((node) => [node.dataset.field, { raw: node.dataset.value, text: node.textContent }]))
          .then((entries) => entries));
        for (const key of stateFields) {
          const field = `${phase}-${key}`;
          const value = state[key] ?? null;
          assert.deepEqual(displayed.get(field), {
            raw: value === null ? 'null' : String(value),
            text: textFor(key, value),
          }, `${play.id} ${field}`);
        }
      }
      reconciled += 1;
    }
  }
  assert.equal(reconciled, pin.play_count);
  await page.locator('#drive-select').selectOption('0');
  await page.locator('#play-select').selectOption(String(record.drives[0].plays.length - 1));
  await page.locator('#next-play').click();
  assert.equal(await page.locator('#summary-drive-index').getAttribute('data-value'), '2', 'next-play crosses to the next drive');
  await page.locator('#previous-play').click();
  assert.equal(await page.locator('#summary-drive-index').getAttribute('data-value'), '1', 'previous-play crosses to the prior drive');
  assert.equal(errors.length, 0, `browser errors: ${errors.join('; ')}`);
  console.log(`PASS Chromium rendered and reconciled every LP play: ${reconciled}/${pin.play_count}, drives=${record.drives.length}`);
  console.log(`PASS browser exact-field checks: clocks=${reconciled * 2}, quarter=${reconciled * 2}, scores=${reconciled * 4}, drive index=${reconciled * 3}, possession=${reconciled * 4}, down/distance=${reconciled * 4}, ball spot=${reconciled * 2}`);
  console.log(`PASS navigation boundaries; 3D unavailable status shown per play; browser errors=${errors.length}`);
} finally {
  await browser.close();
  await new Promise((done, reject) => server.close((error) => error ? reject(error) : done()));
}
