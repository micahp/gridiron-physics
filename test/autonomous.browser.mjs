import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8080';
const SHOTS = new URL('../docs/evidence/autonomous-acceptance/', import.meta.url);
await mkdir(SHOTS, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
page.on('pageerror', (error) => errors.push(String(error)));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

async function runToWhistle() {
  await page.locator('#snap').click();
  await page.waitForFunction(() => {
    const result = document.querySelector('#result-main')?.textContent || '';
    return !document.querySelector('#snap')?.disabled
      && (!document.querySelector('#toggle')?.disabled && result === 'Play in progress' || result === 'Simulation failed');
  }, null, { timeout: 60000 });
  assert.equal(await page.locator('#toggle').isDisabled(), false, await page.locator('#result-detail').innerText());
  await page.locator('#scrub').evaluate((slider) => {
    slider.value = '500';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => document.querySelector('#carrier-readout')?.textContent.startsWith('Current ball carrier:'));
  assert.match(await page.locator('#focus-decision').innerText(), /O\.RB/);
  assert.match(await page.locator('#lane-readout').innerText(), /RB lane:|Carrier path:/);
  await page.locator('#scrub').evaluate((slider) => {
    slider.value = '1000';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => {
    const text = document.querySelector('#result-main')?.textContent || '';
    return text !== 'Play in progress' && text !== 'No play has been run.';
  }, null, { timeout: 10000 });
  return {
    result: await page.locator('#result-main').innerText(),
    detail: await page.locator('#result-detail').innerText(),
  };
}

try {
  await page.goto(`${BASE}/autonomous.html`, { waitUntil: 'domcontentloaded' });
  await page.locator('#field').waitFor();
  assert.ok(await page.locator('#field').evaluate((canvas) => canvas.width > 0 && canvas.height > 0));
  await page.locator('#seed').fill('inside-zone-demo-1');
  const first = await runToWhistle();
  assert.match(first.result, /tackle|touchdown|out of bounds|safety|failure/i);
  assert.match(await page.locator('#carrier-readout').innerText(), /Ball carrier at whistle:/);
  assert.match(await page.locator('#lane-readout').innerText(), /RB lane:/);
  assert.match(await page.locator('#play-events').innerText(), /whistle/i);
  assert.match(await page.locator('#play-events').innerText(), /recognizes the run/i);
  assert.match(await page.locator('#result-detail').innerText(), /made contact|blockers won/i);

  await page.locator('#show-decisions').check();
  assert.equal(await page.locator('#decision-list .decision-row').count(), 22);
  await page.locator('#focus-player').selectOption('D.MIKE');
  assert.match(await page.locator('#focus-decision').innerText(), /D\.MIKE/);
  await page.locator('[data-cam="top"]').click();
  assert.ok(await page.locator('[data-cam="top"]').evaluate((button) => button.classList.contains('on')));
  await page.locator('[data-cam="broadcast"]').click();
  await page.screenshot({ path: new URL('inside-zone-outcome.png', SHOTS).pathname });
  await page.locator('.controls').evaluate((panel) => { panel.scrollTop = panel.scrollHeight; });
  await page.screenshot({ path: new URL('inside-zone-player-decisions.png', SHOTS).pathname });
  await page.locator('.controls').evaluate((panel) => { panel.scrollTop = 0; });

  await page.locator('#front').selectOption('bear');
  const second = await runToWhistle();
  assert.ok(await page.locator('#compare-runs').innerText().then((text) => text.includes('Previous') && text.includes('Current')));
  assert.match(await page.locator('#compare-runs').innerText(), /over[\s\S]*bear|bear[\s\S]*over/);
  await page.screenshot({ path: new URL('inside-zone-run-comparison.png', SHOTS).pathname });

  // Passing family: the same viewer runs the slant–flat executor end to end.
  await page.locator('#play-call').selectOption('slant_flat');
  assert.equal(await page.locator('#coverage-row').isVisible(), true, 'coverage appears for a pass call');
  assert.equal(await page.locator('#front option[value="bear"]').isVisible(), false, 'run fronts are hidden for a pass call');
  await page.locator('#front').selectOption('nickel_over');
  await page.locator('#coverage').selectOption('cover_1');
  await page.locator('#seed').fill('slant-flat-browser-1');
  const pass = await runToWhistle();
  assert.match(pass.result, /tackle|touchdown|out of bounds|incomplete|sack|failure/i);
  const passEvents = await page.locator('#play-events').innerText();
  assert.match(passEvents, /throw|sack/i, 'the pass log shows a throw or a sack');
  assert.match(await page.locator('#compare-runs').innerText(), /slant.fl&#x2013;?flat|slant–flat|slant-flat/);
  await page.locator('#focus-player').selectOption('O.QB');
  assert.match(await page.locator('#focus-decision').innerText(), /O\.QB/);
  await page.screenshot({ path: new URL('slant-flat-outcome.png', SHOTS).pathname });

  await page.locator('#play-call').selectOption('inside_zone');
  await page.locator('#front').selectOption('bear');
  await page.locator('#seed').fill('inside-zone-demo-1');
  const replay = await runToWhistle();
  assert.deepEqual(replay, second, 'same seed, front and ratings reproduce the displayed result exactly');

  // Matchup and field position controls: the offense and defense are always different teams,
  // and the starting spot is a real input.
  await page.locator('#offense-team').selectOption('CHI');
  assert.notEqual(await page.locator('#defense-team').inputValue(), 'CHI', 'the defense switches away from the offense');
  await page.locator('#yardline').fill('90');
  await page.locator('#snap').click();
  assert.match(await page.locator('#stage-label').textContent(), /CHI offense vs NE defense/, 'the snap names the matchup');
  await page.waitForFunction(() => {
    const result = document.querySelector('#result-main')?.textContent || '';
    return result !== 'Play in progress' && result.length > 0;
  }, null, { timeout: 60000 });
  assert.equal(errors.length, 0, `browser errors: ${errors.join('; ')}`);
  console.log(`PASS autonomous browser: ${first.result}; same-seed replay ${replay.result}; comparison screenshot captured`);
} finally {
  await browser.close();
}
