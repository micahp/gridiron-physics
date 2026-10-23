import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');
const RESULTS = path.join(HERE, 'results');
const INDEX = path.join(RESULTS, 'archive-index.json');
const M4C = 'm4c-contact-possession-v1';
const M4B = 'proxy-v2-compound';
const SEED = Number(process.argv[2] ?? 41027);
const SCREENSHOT_SCENARIOS = ['gang-two-opposite-open', 'gang-staggered-three', 'gang-three-upright',
  'sack-simultaneous-two', 'sack-initiate-finish', 'sack-throw-window', 'possession-retained',
  'possession-force-fumble', 'recovery-failed', 'recovery-secure', 'recovery-contested',
  'fumble-eight-pile-live-ball', 'tush-push-eight', 'short-yardage-22-player',
  'grip-escape-one-held', 'grip-break-multiple-forward'];
const VIDEO_SCENARIOS = ['gang-two-opposite-open', 'sack-simultaneous-two', 'possession-retained',
  'fumble-eight-pile-live-ball', 'tush-push-eight', 'short-yardage-22-player'];
const CAMERAS = ['all22', 'sideline', 'closeup'];
const ENGINES = ['rapier3d-compat', 'jolt-physics-js'];
const FPS = 12;
const TEMP = await mkdtemp(path.join(os.tmpdir(), 'm4c-capture-'));
const mime = new Map([['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'], ['.css', 'text/css; charset=utf-8'], ['.json', 'application/json; charset=utf-8'],
  ['.gz', 'application/gzip'], ['.png', 'image/png'], ['.webm', 'video/webm'], ['.wasm', 'application/wasm']]);
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const target = path.resolve(REPO, `.${pathname}`);
    if (target !== REPO && !target.startsWith(`${REPO}${path.sep}`)) { response.writeHead(403).end('forbidden'); return; }
    const info = await stat(target);
    if (!info.isFile()) { response.writeHead(404).end('not found'); return; }
    response.setHeader('Content-Type', mime.get(path.extname(target)) ?? 'application/octet-stream');
    response.setHeader('Cache-Control', 'no-store'); createReadStream(target).pipe(response);
  } catch { response.writeHead(404).end('not found'); }
});
async function ensureNew(destination) {
  try { await access(destination); throw new Error(`Refusing to overwrite immutable visual artifact: ${destination}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const getRecord = (index, scenarioId, engine, version, commit) => index.records.find((row) => row.scenarioId === scenarioId
  && row.seed === SEED && row.engine === engine && row.simulationVersion === version && row.sourceCommit === commit);

let browser;
try {
  const index = JSON.parse(await readFile(INDEX, 'utf8'));
  const commits = { m4c: index.activeProfileCommits?.[M4C], m4b: index.activeProfileCommits?.[M4B] };
  if (!commits.m4c || !commits.m4b) throw new Error('Run M4b and M4c archive commands before visual capture.');
  const m4bComparisonCommits = Object.fromEntries(VIDEO_SCENARIOS.map((scenarioId) => {
    if (scenarioId !== 'possession-retained') return [scenarioId, commits.m4b];
    const rows = index.records.filter((row) => row.scenarioId === scenarioId && row.seed === SEED
      && row.simulationVersion === M4B && row.behaviorVersion === 'm4b');
    const sourceCommit = rows[0]?.sourceCommit;
    if (!sourceCommit || ENGINES.some((engine) => !rows.some((row) => row.engine === engine))) {
      throw new Error('Missing full-rate M4b-policy replay for the matched possession-retention fixture.');
    }
    return [scenarioId, sourceCommit];
  }));
  for (const scenarioId of SCREENSHOT_SCENARIOS) for (const engine of ENGINES) {
    if (!getRecord(index, scenarioId, engine, M4C, commits.m4c)) throw new Error(`Missing M4c screenshot replay: ${scenarioId}/${engine}`);
  }
  for (const scenarioId of VIDEO_SCENARIOS) for (const engine of ENGINES) {
    if (!getRecord(index, scenarioId, engine, M4B, m4bComparisonCommits[scenarioId])) throw new Error(`Missing M4b comparison replay: ${scenarioId}/${engine}`);
  }
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-webgl',
    '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1080 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('requestfailed', (request) => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
  await page.goto(`http://127.0.0.1:${port}/research/physics-3d-evaluation/m4b/archive/index.html`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.__m4bArchive?.current?.leftReplay), null, { timeout: 30000 });
  await page.evaluate(() => window.__m4bArchive.setDebug(true));

  const screenshotRows = new Map();
  for (const scenarioId of SCREENSHOT_SCENARIOS) for (const engine of ENGINES) {
    const selection = { scenarioId, seed: SEED, leftEngine: engine, rightEngine: engine,
      leftVersion: `${M4C}|${commits.m4c}`, rightVersion: `${M4C}|${commits.m4c}`, camera: 'sideline' };
    await page.evaluate(async (value) => window.__m4bArchive.loadSelection(value), selection);
    const cameraPaths = {};
    for (const camera of CAMERAS) {
      await page.evaluate((value) => { document.getElementById('camera').value = value; window.__m4bArchive.drawAt(0.8); }, camera);
      await page.waitForTimeout(80);
      const relative = `../screenshots/m4c/${scenarioId}/${engine}/seed-${SEED}/${camera}.png`;
      const destination = path.join(HERE, 'screenshots', 'm4c', scenarioId, engine, `seed-${SEED}`, `${camera}.png`);
      await ensureNew(destination); await mkdir(path.dirname(destination), { recursive: true });
      await page.locator('#left-view').screenshot({ path: destination, animations: 'disabled' });
      cameraPaths[camera] = relative;
    }
    screenshotRows.set(`${scenarioId}|${engine}`, cameraPaths);
  }

  const ffmpeg = await (async () => {
    const candidates = process.env.FFMPEG_PATH ? [process.env.FFMPEG_PATH]
      : ['/root/.hermes/tools/ffmpeg-9.0.1-linux-x64/bin/ffmpeg', 'ffmpeg'];
    for (const candidate of candidates) try { await access(candidate); execFileSync(candidate, ['-version'], { stdio: 'ignore' }); return candidate; } catch {}
    throw new Error('ffmpeg was not found. Set FFMPEG_PATH to a local ffmpeg executable.');
  })();
  const videoRows = new Map();
  for (const scenarioId of VIDEO_SCENARIOS) for (const engine of ENGINES) {
    const leftVersion = `${M4B}|${m4bComparisonCommits[scenarioId]}`;
    const rightVersion = `${M4C}|${commits.m4c}`;
    await page.evaluate(async (value) => window.__m4bArchive.loadSelection(value), { scenarioId, seed: SEED,
      leftEngine: engine, rightEngine: engine, leftVersion,
      rightVersion, camera: 'sideline' });
    const duration = await page.evaluate(() => Math.min(window.__m4bArchive.current.leftReplay.payload.replay.durationSeconds,
      window.__m4bArchive.current.rightReplay.payload.replay.durationSeconds));
    const frameCount = Math.floor(duration * FPS) + 1;
    const frameDirectory = path.join(TEMP, `${scenarioId}-${engine}`); await mkdir(frameDirectory, { recursive: true });
    for (let frame = 0; frame < frameCount; frame++) {
      await page.evaluate((time) => window.__m4bArchive.drawAt(time), Math.min(duration, frame / FPS));
      await page.locator('.viewers').screenshot({ path: path.join(frameDirectory, `frame-${String(frame).padStart(5, '0')}.png`), animations: 'disabled' });
    }
    const filename = `${engine}-${m4bComparisonCommits[scenarioId].slice(0, 10)}-vs-${commits.m4c.slice(0, 10)}-seed-${SEED}-sideline.webm`;
    const destination = path.join(HERE, 'videos', 'm4c', scenarioId, filename);
    await ensureNew(destination); await mkdir(path.dirname(destination), { recursive: true });
    execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-framerate', String(FPS), '-i',
      path.join(frameDirectory, 'frame-%05d.png'), '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '5',
      '-b:v', '900k', '-pix_fmt', 'yuv420p', '-an', destination], { stdio: 'pipe' });
    const relative = `../videos/m4c/${scenarioId}/${filename}`;
    videoRows.set(`${scenarioId}|${engine}|${M4B}|${m4bComparisonCommits[scenarioId]}`, relative);
    videoRows.set(`${scenarioId}|${engine}|${M4C}|${commits.m4c}`, relative);
  }

  index.records = index.records.map((row) => {
    const screenshotKey = `${row.scenarioId}|${row.engine}`;
    const videoKey = `${row.scenarioId}|${row.engine}|${row.simulationVersion}|${row.sourceCommit}`;
    const isCurrentM4c = row.simulationVersion === M4C && row.sourceCommit === commits.m4c;
    return { ...row, screenshots: isCurrentM4c ? screenshotRows.get(screenshotKey) ?? row.screenshots ?? null : row.screenshots ?? null,
      videoPath: videoRows.get(videoKey) ?? row.videoPath ?? null };
  });
  index.generatedAt = new Date().toISOString();
  index.m4cVisualArtifacts = { sourceCommit: commits.m4c, fixedCameraTimeSeconds: 0.8, screenshotCameras: CAMERAS,
    comparisonVideoCamera: 'sideline', comparisonVideoFps: FPS, comparisonVideoCodec: 'VP9 WebM',
    screenshotScenarioIds: SCREENSHOT_SCENARIOS, comparisonScenarioIds: VIDEO_SCENARIOS, m4bComparisonCommits };
  await writeFile(INDEX, `${JSON.stringify(index, null, 2)}\n`);
  if (errors.length) throw new Error(`Browser reported errors:\n${errors.join('\n')}`);
  console.log(JSON.stringify({ screenshotCount: screenshotRows.size * CAMERAS.length,
    comparisonVideoCount: VIDEO_SCENARIOS.length * ENGINES.length, screenshots: screenshotRows.size,
    manifest: INDEX, m4cCommit: commits.m4c, m4bCommit: commits.m4b }, null, 2));
} finally {
  await browser?.close(); await new Promise((resolve) => server.close(resolve));
  await rm(TEMP, { recursive: true, force: true });
}
