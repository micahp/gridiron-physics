import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../..');
const RESULTS = path.join(HERE, 'results');
const INDEX = path.join(RESULTS, 'archive-index.json');
const SEED = Number(process.argv[2] ?? 41027);
const SCENARIOS = ['gang-two-opposite-open', 'sack-simultaneous-two', 'fumble-eight-pile-live-ball', 'tush-push-eight'];
const CAMERAS = ['all22', 'sideline', 'closeup'];
const VERSIONS = ['proxy-v1-single-capsule', 'proxy-v2-compound'];
const ENGINES = ['rapier3d-compat', 'jolt-physics-js'];
const FPS = 12;
const TEMP = await mkdtemp(path.join(os.tmpdir(), 'm4b-capture-'));
async function ensureNewArtifact(destination) {
  try { await access(destination); throw new Error(`Refusing to overwrite immutable visual artifact: ${destination}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}

const mime = new Map([
  ['.html', 'text/html; charset=utf-8'], ['.js', 'text/javascript; charset=utf-8'], ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'], ['.json', 'application/json; charset=utf-8'], ['.gz', 'application/gzip'],
  ['.png', 'image/png'], ['.webm', 'video/webm'], ['.svg', 'image/svg+xml'], ['.wasm', 'application/wasm'],
]);
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const target = path.resolve(REPO, `.${pathname}`);
    if (target !== REPO && !target.startsWith(`${REPO}${path.sep}`)) { response.writeHead(403).end('forbidden'); return; }
    const info = await stat(target);
    if (!info.isFile()) { response.writeHead(404).end('not found'); return; }
    response.setHeader('Content-Type', mime.get(path.extname(target)) ?? 'application/octet-stream');
    response.setHeader('Cache-Control', 'no-store');
    createReadStream(target).pipe(response);
  } catch { response.writeHead(404).end('not found'); }
});

let browser;
try {
  const index = JSON.parse(await readFile(INDEX, 'utf8'));
  const availableProfiles = new Set(index.records.map((row) => row.simulationVersion));
  for (const profile of VERSIONS) if (!availableProfiles.has(profile)) throw new Error(`Archive is missing simulation version ${profile}. Run the benchmark for both versions first.`);
  const profileCommits = Object.fromEntries(VERSIONS.map((profile) => [profile, index.activeProfileCommits?.[profile]
    ?? index.records.find((row) => row.simulationVersion === profile)?.sourceCommit]));
  for (const scenarioId of SCENARIOS) for (const engine of ENGINES) for (const profile of VERSIONS) {
    const found = index.records.some((row) => row.scenarioId === scenarioId && row.engine === engine && row.simulationVersion === profile
      && row.sourceCommit === profileCommits[profile] && row.seed === SEED);
    if (!found) throw new Error(`Missing ${scenarioId} / ${engine} / ${profile} / seed ${SEED}; run both M4b benchmarks first.`);
  }

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1080 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('requestfailed', (request) => errors.push(`${request.url()}: ${request.failure()?.errorText}`));
  await page.goto(`http://127.0.0.1:${port}/research/physics-3d-evaluation/m4b/archive/index.html`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.__m4bArchive?.current?.leftReplay), null, { timeout: 30000 });
  const captureInfo = [];
  const screenshotRows = new Map();

  for (const scenarioId of SCENARIOS) for (const engine of ENGINES) for (const version of VERSIONS) {
    const selection = { scenarioId, seed: SEED, leftEngine: engine, rightEngine: engine,
      leftVersion: `${version}|${profileCommits[version]}`, rightVersion: `${version}|${profileCommits[version]}`, camera: 'sideline' };
    await page.evaluate(async (value) => window.__m4bArchive.loadSelection(value), selection);
    const profileFolder = `${scenarioId}/${engine}/${version}-${profileCommits[version].slice(0, 10)}`;
    const paths = {};
    for (const camera of CAMERAS) {
      await page.evaluate(({ camera: cameraValue }) => {
        document.getElementById('camera').value = cameraValue;
        window.__m4bArchive.drawAt(0.8);
      }, { camera });
      await page.waitForTimeout(80);
      const relative = `../screenshots/${profileFolder}/${camera}.png`;
      const destination = path.join(HERE, 'screenshots', profileFolder, `${camera}.png`);
      await ensureNewArtifact(destination);
      await mkdir(path.dirname(destination), { recursive: true });
      await page.locator('#left-view').screenshot({ path: destination, animations: 'disabled' });
      paths[camera] = relative;
    }
    const geometry = await page.evaluate(() => window.__m4bArchive.current.leftReplay.payload.archiveMetadata.playerGeometry);
    captureInfo.push({ scenarioId, engine, version, geometry, screenshots: paths });
    screenshotRows.set(`${scenarioId}|${engine}|${version}|${profileCommits[version]}|${SEED}`, paths);
  }

  const ffmpeg = await (async () => {
    const candidates = process.env.FFMPEG_PATH ? [process.env.FFMPEG_PATH]
      : ['/root/.hermes/tools/ffmpeg-9.0.1-linux-x64/bin/ffmpeg', 'ffmpeg'];
    for (const candidate of candidates) {
      try { await access(candidate); execFileSync(candidate, ['-version'], { stdio: 'ignore' }); return candidate; } catch {}
    }
    throw new Error('ffmpeg was not found. Set FFMPEG_PATH to a local ffmpeg executable.');
  })();
  const videoRows = new Map();
  for (const scenarioId of SCENARIOS) for (const engine of ENGINES) {
    await page.evaluate(async (value) => window.__m4bArchive.loadSelection(value), {
      scenarioId, seed: SEED, leftEngine: engine, rightEngine: engine,
      leftVersion: `${VERSIONS[0]}|${profileCommits[VERSIONS[0]]}`,
      rightVersion: `${VERSIONS[1]}|${profileCommits[VERSIONS[1]]}`, camera: 'sideline',
    });
    const duration = await page.evaluate(() => Math.min(window.__m4bArchive.current.leftReplay.payload.replay.durationSeconds,
      window.__m4bArchive.current.rightReplay.payload.replay.durationSeconds));
    const frameCount = Math.floor(duration * FPS) + 1;
    const frameDirectory = path.join(TEMP, `${scenarioId}-${engine}`);
    await mkdir(frameDirectory, { recursive: true });
    for (let frame = 0; frame < frameCount; frame++) {
      const timeSeconds = Math.min(duration, frame / FPS);
      await page.evaluate((time) => window.__m4bArchive.drawAt(time), timeSeconds);
      const framePath = path.join(frameDirectory, `frame-${String(frame).padStart(5, '0')}.png`);
      await page.locator('.viewers').screenshot({ path: framePath, animations: 'disabled' });
    }
    const videoName = `${engine}-${profileCommits[VERSIONS[0]].slice(0, 10)}-vs-${profileCommits[VERSIONS[1]].slice(0, 10)}-sideline.webm`;
    const destination = path.join(HERE, 'videos', scenarioId, videoName);
    await ensureNewArtifact(destination);
    await mkdir(path.dirname(destination), { recursive: true });
    execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', String(FPS), '-i', path.join(frameDirectory, 'frame-%05d.png'),
      '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '5', '-b:v', '900k', '-pix_fmt', 'yuv420p', '-an', destination], { stdio: 'pipe' });
    const relativeVideoPath = `../videos/${scenarioId}/${videoName}`;
    for (const version of VERSIONS) videoRows.set(`${scenarioId}|${engine}|${version}|${profileCommits[version]}|${SEED}`, relativeVideoPath);
    captureInfo.push({ scenarioId, engine, comparisonVideo: relativeVideoPath, frames: frameCount, fps: FPS, durationSeconds: duration });
  }

  index.records = index.records.map((row) => {
    const key = `${row.scenarioId}|${row.engine}|${row.simulationVersion}|${row.sourceCommit}|${row.seed}`;
    return { ...row, screenshots: screenshotRows.get(key) ?? row.screenshots ?? null,
      videoPath: videoRows.get(key) ?? row.videoPath ?? null };
  });
  index.generatedAt = new Date().toISOString();
  index.visualArtifacts = { cameraCaptureTimeSeconds: 0.8, screenshotCameras: CAMERAS, comparisonVideoCamera: 'sideline',
    comparisonVideoFps: FPS, comparisonVideoCodec: 'VP9 WebM', archivedScenarioIds: SCENARIOS };
  await writeFile(INDEX, `${JSON.stringify(index, null, 2)}\n`);
  if (errors.length) throw new Error(`Browser reported errors:\n${errors.join('\n')}`);
  console.log(JSON.stringify({ screenshotCount: screenshotRows.size * CAMERAS.length, comparisonVideoCount: SCENARIOS.length * ENGINES.length,
    captureInfo, manifest: INDEX }, null, 2));
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
  await rm(TEMP, { recursive: true, force: true });
}
