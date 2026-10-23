import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright';

const root = resolve(new URL('../..', import.meta.url).pathname);
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
await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
const { port } = server.address();
let browser;
try {
  const launch = { headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader'] };
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE) launch.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  browser = await chromium.launch(launch);
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error' && !message.text().includes('Failed to load resource')) errors.push(message.text()); });
  page.on('response', (response) => { if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) errors.push(`${response.status()} ${response.url()}`); });
  const response = await page.goto(`http://127.0.0.1:${port}/research/physics-3d-evaluation/index.html`);
  assert.equal(response.status(), 200);
  try { await page.waitForFunction(() => window.runEvaluationHarness && document.body.dataset.rendererReady === 'true', null, { timeout: 10000 }); }
  catch (error) { throw new Error(`Browser app not ready (renderer=${await page.locator('body').getAttribute('data-renderer-ready')}, eval=${await page.evaluate(() => typeof window.runEvaluationHarness)}): ${errors.join('\n')}\n${error.message}`); }
  await page.selectOption('#engine', 'jolt');
  await page.selectOption('#scenario', 'side-tackle');
  await page.locator('#run').click();
  await page.waitForFunction(() => window.__physicsRendered?.playerBodies === 2 && window.__physicsRendered?.poses?.length === 2);
  const uiTackle = await page.evaluate(() => JSON.parse(document.querySelector('#output').textContent));
  assert.equal(uiTackle.engine, 'jolt-physics-js');
  assert.equal(uiTackle.scenario, 'side-tackle');
  const uiTacklePose = await page.evaluate(() => window.__physicsRendered);
  assert.equal(uiTacklePose.poses.every((p) => p.position.length === 3 && p.quaternion.length === 4), true);
  await page.locator('#pass').click();
  await page.waitForFunction(() => window.__physicsRendered?.ball === true);
  const uiPass = await page.evaluate(() => JSON.parse(document.querySelector('#output').textContent));
  assert.equal(uiPass.engine, 'jolt-physics-js');
  assert.equal(uiPass.catchFeasible, true);
  const results = await page.evaluate(() => window.runEvaluationHarness({ simulations: 100, stepsPerSimulation: 30 }));
  assert.equal(results.tackles.length, 14);
  assert.equal(results.tackles.every((r) => r.contact.occurred && r.finite), true);
  assert.equal(results.passes.length, 4);
  assert.equal(results.passes.every((r) => r.catchFeasible && r.finite), true);
  assert.equal(results.passes.find((r) => r.engine === 'jolt-physics-js' && r.scenario === 'pass-with-defender-in-trajectory').deflectionFeasible, true);
  assert.equal(results.benchmarks.every((r) => r.playerBodies === 22 && r.finite && r.elapsedMs > 0), true);
  assert.equal(errors.length, 0, errors.join('\n'));
  console.log(JSON.stringify({ passed: true, browser: await browser.version(), renderer: await page.locator('canvas').count(), ui: { engine: uiTackle.engine, scenario: uiTackle.scenario, renderedPlayerBodies: uiTacklePose.playerBodies, actual3DPose: true, passContact: uiPass.physicalContacts }, tackleResults: results.tackles.length, passResults: results.passes.map((r) => [r.engine, r.scenario, r.physicalContacts]), browser22PlayerRuns: results.benchmarks.map((r) => [r.engine, r.playerBodies, r.finite, r.elapsedMs]) }, null, 2));
} finally {
  if (browser) await browser.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
