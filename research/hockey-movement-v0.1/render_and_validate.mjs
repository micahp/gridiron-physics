#!/usr/bin/env node
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '../..');
const archiveDir = join(here, 'archive');
const manifest = JSON.parse(await readFile(join(archiveDir, 'manifest.json'), 'utf8'));
const entry = manifest.archives.at(-1);
if (!entry) throw new Error('No registered scenario archive');
if (entry.archive_id !== 'jc-2026-10-23-v1') throw new Error(`Expected the immutable JC archive, found ${entry.archive_id || 'no archive ID'}`);
const archiveBytes = await readFile(join(archiveDir, entry.archive_file));
const digest = createHash('sha256').update(archiveBytes).digest('hex');
if (digest !== entry.archive_sha256) throw new Error('Registered scenario archive SHA-256 mismatch');
const archivePayload = JSON.parse(gunzipSync(archiveBytes).toString('utf8'));

const playwrightModule = process.env.PLAYWRIGHT_MODULE || '/root/legendarypicks/node_modules/playwright';
const require = createRequire(join('/root/legendarypicks', 'package.json'));
const { chromium } = require(playwrightModule);
const baseUrl = process.argv[2] || 'http://127.0.0.1:8099/research/hockey-movement-v0.1/viewer/';
const outputDir = join(archiveDir, 'clips', entry.archive_id);
const videoTemp = join(outputDir, 'tmp');
await mkdir(outputDir, { recursive: true });
await rm(videoTemp, { recursive: true, force: true });
await mkdir(videoTemp, { recursive: true });
function recordedDuration(path) {
  const output = execFileSync(process.env.FFPROBE || 'ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'json', path,
  ], { encoding: 'utf8' });
  const seconds = Number(JSON.parse(output).format?.duration);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`Invalid recorded video duration: ${path}`);
  return seconds;
}

const launchArgs = [
  '--no-sandbox', '--disable-dev-shm-usage', '--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader',
] ;
const browser = await chromium.launch({ headless: true, args: launchArgs });
const browserVersion = browser.version();
const errors = [];
const pageErrors = [];
const viewport = { width: 1280, height: 900 };
async function screenshotIfMissing(page, path) {
  try {
    const existing = await stat(path);
    if (existing.size <= 0) throw new Error(`Existing screenshot is empty: ${path}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await page.screenshot({ path, fullPage: true });
  }
}
const testContext = await browser.newContext({ viewport });
const page = await testContext.newPage();
page.on('pageerror', (error) => pageErrors.push(String(error)));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
await page.goto(baseUrl, { waitUntil: 'networkidle' });
await page.waitForFunction(() => document.querySelector('#status')?.textContent?.startsWith('Loaded '), null, { timeout: 60_000 });
const panels = await page.locator('.canvas-wrap canvas').count();
const scenarioCount = await page.locator('#scenario option').count();
if (panels !== 4 || scenarioCount < 10) throw new Error(`Viewer content gate failed: ${panels} canvases, ${scenarioCount} scenarios`);

const scenarioOptions = await page.locator('#scenario option').evaluateAll((options) => options.map((o) => ({ value: o.value, text: o.textContent })));
const p1Scenario = scenarioOptions.find((o) => {
  const text = o.text.toLowerCase();
  return text.includes('2025-') && text.includes('p1');
}) || scenarioOptions[0];
await page.locator('#scenario').selectOption(p1Scenario.value);
const scenarioData = archivePayload.scenarios[p1Scenario.value];
if (!archivePayload.joint_coherence?.scenario_ids?.includes(p1Scenario.value)) throw new Error('Selected visual scenario is outside the frozen JC population');
const focusTeam = scenarioData.period_one_goalie_right_team;
if (scenarioData.period === 'P1' && focusTeam) await page.locator('#focus-team').selectOption(focusTeam);
const modelSelectors = page.locator('.panel-head select');
if (await modelSelectors.count() !== 4) throw new Error('Expected four independently selectable replay panes');
await page.locator('#scrub').evaluate((element) => { element.value = '1'; element.dispatchEvent(new Event('input', { bubbles: true })); });
const firstGroupFrame = scenarioData.frames.find((frame) => frame.step === 1)?.joint_coherence;
if (!firstGroupFrame?.eligible) throw new Error('Selected JC visual scenario has no eligible +1 group measurement');
if (await page.locator('#group-metrics .group-metric-table tbody tr').count() !== 3) throw new Error('JC group panel did not display all three models');
const groupPanelText = await page.locator('#group-metrics').innerText();
if (!groupPanelText.includes('Scored at +1 ordinal increment (not seconds)') || !groupPanelText.includes(firstGroupFrame.models.M0.centroid_pooled_error_ft.toFixed(2))) {
  throw new Error('JC group panel does not match the frozen +1 measurement');
}
await page.locator('#scrub').evaluate((element) => { element.value = '45'; element.dispatchEvent(new Event('input', { bubbles: true })); });
const finalGroupFrame = scenarioData.frames.find((frame) => frame.step === 45)?.joint_coherence;
if (!finalGroupFrame || await page.locator('#group-metrics .group-metric-table tbody tr').count() !== 3) throw new Error('JC group panel failed to scrub to +45');
const outsideScenario = scenarioOptions.find((option) => !archivePayload.joint_coherence.scenario_ids.includes(option.value));
if (!outsideScenario) throw new Error('No category-only scenario available to check the unavailable state');
await page.locator('#scenario').selectOption(outsideScenario.value);
await page.locator('#scrub').evaluate((element) => { element.value = '1'; element.dispatchEvent(new Event('input', { bubbles: true })); });
if (!(await page.locator('#group-metrics').innerText()).includes('not in the frozen 200-start JC evaluation')) throw new Error('Unscored category scenario did not show an explicit unavailable state');
await page.locator('#scenario').selectOption(p1Scenario.value);
await page.locator('#scrub').evaluate((element) => { element.value = '0'; element.dispatchEvent(new Event('input', { bubbles: true })); });
await modelSelectors.nth(0).selectOption('M1');
await modelSelectors.nth(0).selectOption('Observed');
for (const id of ['trails', 'vectors', 'distances', 'uncertainty']) {
  const toggle = page.locator(`#${id}`);
  const wasChecked = await toggle.isChecked();
  if (wasChecked) await toggle.uncheck(); else await toggle.check();
  if ((await toggle.isChecked()) === wasChecked) throw new Error(`${id} overlay did not toggle`);
  if (wasChecked) await toggle.check(); else await toggle.uncheck();
  if ((await toggle.isChecked()) !== wasChecked) throw new Error(`${id} overlay did not restore`);
}
const scrub = page.locator('#scrub');
await page.locator('#play').click();
await page.waitForTimeout(300);
const playedStep = Number(await scrub.inputValue());
if (playedStep < 1) throw new Error('Play did not advance the observation index');
await page.locator('#pause').click();
const pausedAt = Number(await scrub.inputValue());
await page.waitForTimeout(250);
const pausedStep = Number(await scrub.inputValue());
if (pausedStep !== pausedAt) throw new Error('Pause did not hold the observation index');
await scrub.evaluate((element) => { element.value = '0'; element.dispatchEvent(new Event('input', { bubbles: true })); });
await page.locator('#camera').selectOption('side');
await page.waitForTimeout(250);
await page.locator('#camera').selectOption('top');
const transformDisabled = await page.locator('#transform').isDisabled();
if (p1Scenario.text.includes('P1') && transformDisabled) throw new Error('Period-one attack-direction transform is unexpectedly disabled');
if (!transformDisabled) await page.locator('#transform').selectOption('attack-right');
await page.locator('#run-policy').click();
await page.waitForFunction(() => document.querySelector('#status')?.textContent?.includes('Max path difference'), null, { timeout: 60_000 });
const parityText = await page.locator('#status').textContent();
const parity = Number(parityText.match(/difference from Python archive: ([0-9.]+) ft/)?.[1]);
if (!Number.isFinite(parity) || parity > 0.05) throw new Error(`Gridiron policy replay does not match the versioned rollout: ${parityText}`);
await scrub.evaluate((element) => { element.value = '15'; element.dispatchEvent(new Event('input', { bubbles: true })); });
await page.waitForTimeout(250);
const errorRows = await page.locator('#errors .error-row').count();
if (errorRows < 1) throw new Error('Per-player future-label errors were not rendered at step 15');
await screenshotIfMissing(page, join(outputDir, 'viewer-topdown-step15.png'));
await page.locator('#camera').selectOption('side');
await screenshotIfMissing(page, join(outputDir, 'viewer-rink-side-step15.png'));
await page.locator('#camera').selectOption('top');
await page.locator('#scrub').evaluate((element) => { element.value = '0'; element.dispatchEvent(new Event('input', { bubbles: true })); });
await screenshotIfMissing(page, join(outputDir, 'viewer-topdown.png'));
if (!transformDisabled) await page.locator('#transform').selectOption('raw');
await page.locator('#camera').selectOption('side');
await screenshotIfMissing(page, join(outputDir, 'viewer-rink-side.png'));
await testContext.close();
await browser.close();

const frozenCategories = [
  'oriented_attack_end_puck_proximity',
  'opposite_end_puck_proximity',
  'central_strip_geometry',
  'multiple_skaters_closing_on_puck_geometry',
  'skater_separating_from_nearest_opponent',
  'aligned_teammate_movement_geometry',
  'tracking_missingness_or_identity_conflict',
];
const clips = [];
const unavailable = [];
for (const category of frozenCategories) {
  const option = scenarioOptions.find((row) => row.text.includes(category));
  if (!option) { unavailable.push(category); continue; }
  const slug = category.replaceAll(/[^a-z0-9-]+/gi, '-').replace(/^-|-$/g, '');
  const output = join(outputDir, `${slug}.webm`);
  try {
    const existing = await stat(output);
    if (existing.size <= 0) throw new Error(`Existing clip is empty: ${output}`);
    clips.push({ category, scenario_option: option.text, file: basename(output), bytes: existing.size,
      sha256: createHash('sha256').update(await readFile(output)).digest('hex'),
      duration_seconds: recordedDuration(output), preserved_from_previous_capture: true });
    continue;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const clipBrowser = await chromium.launch({ headless: true, args: launchArgs });
  const context = await clipBrowser.newContext({ viewport, recordVideo: { dir: videoTemp, size: viewport } });
  const clipPage = await context.newPage();
  clipPage.on('pageerror', (error) => pageErrors.push(String(error)));
  clipPage.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await clipPage.goto(baseUrl, { waitUntil: 'networkidle' });
  await clipPage.waitForFunction(() => document.querySelector('#status')?.textContent?.startsWith('Loaded '), null, { timeout: 60_000 });
  await clipPage.locator('#scenario').selectOption(option.value);
  await clipPage.locator('#camera').selectOption('top');
  const range = clipPage.locator('#scrub');
  for (let step = 0; step <= 45; step++) {
    await range.evaluate((element, value) => { element.value = String(value); element.dispatchEvent(new Event('input', { bubbles: true })); }, step);
    await clipPage.waitForTimeout(90);
  }
  const video = clipPage.video();
  await context.close();
  const temporary = await video.path();
  await copyFile(temporary, output);
  await unlink(temporary);
  await clipBrowser.close();
  const bytes = await stat(output);
  clips.push({ category, scenario_option: option.text, file: basename(output), bytes: bytes.size,
    sha256: createHash('sha256').update(await readFile(output)).digest('hex'),
    duration_seconds: recordedDuration(output),
    preserved_from_previous_capture: false });
}
await rm(videoTemp, { recursive: true, force: true });
if (pageErrors.length || errors.length) throw new Error(JSON.stringify({ pageErrors, consoleErrors: errors }, null, 2));
if (clips.length < 3) throw new Error(`Too few representative replay clips rendered: ${clips.length}`);
if (unavailable.length) throw new Error(`Missing required JC visual categories: ${unavailable.join(', ')}`);
const gridironCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
const result = {
  viewer: 'research/hockey-movement-v0.1/viewer/',
  archive_id: entry.archive_id,
  versioned_archive: entry.archive_file,
  archive_sha256: entry.archive_sha256,
  preregistration_sha256: archivePayload.joint_coherence.preregistration_sha256,
  preregistration_commits: archivePayload.joint_coherence.preregistration_commits,
  joint_coherence_results_sha256: archivePayload.joint_coherence.results_sha256,
  joint_coherence_evaluation_commit: archivePayload.joint_coherence.evaluation_commit,
  source_prediction_archive_sha256: archivePayload.source_hashes.scenario_archive,
  legendarypicks_code_commit: entry.legendarypicks_git_commit,
  legendarypicks_evaluation_commit: archivePayload.joint_coherence.evaluation_commit,
  gridiron_movement_engine_commit: entry.gridiron_movement_engine_commit,
  gridiron_validation_commit: gridironCommit,
  browser_version: browserVersion,
  page_errors: pageErrors,
  console_errors: errors,
  panels,
  scenario_count: scenarioCount,
  validated_scenario_id: p1Scenario.value,
  validated_input_cutoff_image_id: scenarioData.cutoff_image_id,
  validated_prediction_horizon_ordinal_steps_not_seconds: scenarioData.horizon_ordinal_steps,
  validated_group_metric_steps_ordinal_increments_not_seconds: [1, 45],
  uncertainty_status_at_step_15: {
    tracking_confidence: scenarioData.tracking_confidence,
    personnel_completeness: scenarioData.personnel_completeness,
    identity_conflicts_quarantined: scenarioData.identity_conflicts_quarantined,
    missing_xy_count: scenarioData.frames.find((frame) => frame.step === 15)?.observed?.missing_xy_count ?? null,
    conflicted_present: scenarioData.frames.find((frame) => frame.step === 15)?.observed?.conflicted_present ?? null,
  },
  in_browser_policy_max_path_difference_ft: parity,
  per_player_error_rows_at_step_15: errorRows,
  screenshots: ['viewer-topdown.png', 'viewer-rink-side.png', 'viewer-topdown-step15.png', 'viewer-rink-side-step15.png'],
  clips,
  categories_without_sample: unavailable,
  visual_transform: 'Observed rink XY; period-one attack-right transform only when orientation metadata exists',
  timebase: 'ordinal Image Id increments; no validated seconds',
};
const manifestPath = join(archiveDir, `visual-validation-${entry.archive_id}.json`);
await writeFile(manifestPath, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(result, null, 2));
