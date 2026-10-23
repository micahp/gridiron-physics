import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(new URL('../../..', import.meta.url).pathname);
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm' };
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    const file = resolve(root, `.${path}`);
    if (file !== root && !file.startsWith(root + sep)) throw new Error('outside repository root');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': mime[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((listen) => server.listen(0, '127.0.0.1', listen));
let browser;
try {
  const options = { headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'] };
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) options.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  browser = await chromium.launch(options);
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !message.text().includes('Failed to load resource')) errors.push(message.text()); });
  page.on('response', (response) => { if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) errors.push(`${response.status()} ${response.url()}`); });
  const response = await page.goto(`http://127.0.0.1:${server.address().port}/research/physics-3d-evaluation/m1b/index.html`);
  assert.equal(response.status(), 200);
  try { await page.waitForFunction(() => window.__m1bRunScenario && document.body.dataset.rendererReady === 'true', null, { timeout: 10000 }); }
  catch (error) { throw new Error(`M1b browser did not initialize: ${errors.join('\n')}\n${error.message}`); }

  const successful = await page.evaluate(async () => {
    const result = await window.__m1bRunScenario('successful-tackle', 'rapier3d-compat');
    return { outcome: result.outcome, frames: result.frames.length };
  });
  assert.equal(successful.outcome, 'successful_tackle');
  await page.waitForFunction(() => window.__m1bRendered?.playerBodies === 2 && window.__m1bRendered.poses.length === 2);
  const rendered = await page.evaluate(() => window.__m1bRendered);
  assert.equal(rendered.poses.every((p) => p.position.length === 3 && p.quaternion.length === 4
    && p.position.every((v, i) => Math.abs(v - p.renderedPosition[i]) < 1e-10)
    && p.quaternion.every((v, i) => Math.abs(v - p.renderedQuaternion[i]) < 1e-10)), true);
  await page.locator('#debug').check();
  await page.locator('#frame').evaluate((input) => { input.value = input.max; input.dispatchEvent(new Event('input', { bubbles: true })); });
  assert.equal(await page.evaluate(() => window.__m1bRendered.frame), successful.frames - 1);

  await page.selectOption('#scenario', 'broken-tackle');
  await page.locator('#compare').click();
  await page.waitForFunction(() => document.body.dataset.demoReady === 'true' && document.querySelector('#output').textContent.includes('jolt-physics-js'));
  const paired = await page.evaluate(() => JSON.parse(document.querySelector('#output').textContent));
  assert.equal(paired['rapier3d-compat'].grip.broken, true);
  assert.equal(paired['jolt-physics-js'].grip.broken, true);

  const missed = await page.evaluate(async () => {
    const result = await window.__m1bRunScenario('missed-tackle', 'jolt-physics-js');
    return { outcome: result.outcome };
  });
  assert.equal(missed.outcome, 'missed_tackle');
  assert.equal(await page.evaluate(() => window.__m1bRendered.engine), 'jolt-physics-js');
  const stumble = await page.evaluate(async () => {
    const result = await window.__m1bRunScenario('stumble-recovery', 'rapier3d-compat');
    return { scenario: result.scenario, events: result.events.map((event) => event.type) };
  });
  assert.equal(stumble.scenario, 'stumble-recovery');
  assert.ok(stumble.events.includes('balance_disturbance_started'));
  assert.ok(stumble.events.includes('upright_stabilized_after_disturbance'));
  assert.equal(await page.evaluate(() => window.__m1bRendered.playerBodies), 1);
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log(JSON.stringify({ passed: true, browser: await browser.version(), replayScenarios: ['successful-tackle', 'broken-tackle', 'missed-tackle', 'stumble-recovery'],
    threeRenderer: true, visiblePoseFromPhysicsFrames: true, debugView: true, comparisonEngines: ['rapier3d-compat', 'jolt-physics-js'] }, null, 2));
} finally {
  if (browser) await browser.close();
  await new Promise((close) => server.close(close));
}
