import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// Live game-state regression, not a GLB inventory test. Run with a local
// HTTP server serving repository root on BASE_URL.
const base = process.env.BASE_URL || 'http://127.0.0.1:8137';
const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
const getState = async () => page.evaluate(() => {
  const renderer = window.__gridironRenderer;
  if (!renderer) return { error: 'No debug renderer' };
  const players = [...renderer.players.values()];
  const byClip = {};
  const byPose = {};
  for (const player of players) {
    const animation = player.userData.animation;
    const name = animation?.activeClipName || 'NONE';
    byClip[name] = (byClip[name] || 0) + 1;
  }
  return {
    rigLoaded: !!renderer.riggedGltf,
    rigCount: players.filter(p => p.userData.rigged).length,
    primitiveCount: players.filter(p => !p.userData.rigged).length,
    clipsLoaded: renderer.riggedGltf?.animations?.length ?? 0,
    activeNames: Object.keys(byClip).filter(n => n !== 'NONE'),
    byClip, byPose,
    state: window.__gridironState?.(),
    rigLoadMs: renderer.rigLoadMs,
  };
});
async function choosePlay(pattern) {
  const buttons = await page.locator('#timeline button.pl:not(.admin)').all();
  for (const button of buttons) {
    const text = await button.innerText();
    if (pattern.test(text)) {
      await button.click();
      assert.match(await page.locator('#replay-type').innerText(), /22-player 3D/, '3D replay unavailable for ' + text);
      return text.replace(/\s+/g, ' ').slice(0, 160);
    }
  }
  throw new Error('No visible scrimmage play matches ' + pattern);
}
async function samplePlay(label, pattern) {
  const chosen = await choosePlay(pattern);
  await page.waitForTimeout(300);
  const paused = await getState();
  if (await page.locator('#play').getAttribute('aria-label') === 'Pause') await page.locator('#play').click();
  await page.locator('#play').click(); // explicitly start physical playback
  const snapshots = [];
  for (let j = 0; j < 15; j++) {
    await page.waitForTimeout(140);
    snapshots.push(await getState());
  }
  await page.locator('#play').click();
  const names = [...new Set(snapshots.flatMap(s => s.activeNames || []))];
  console.log('LIVE_ANIM_AUDIT ' + JSON.stringify({ label, chosen, paused, clips: names, frames: snapshots.map(s => ({ rig: s.rigCount, primitive: s.primitiveCount, byClip: s.byClip, playing: s.state?.playing })) }));
  assert.ok(paused.rigLoaded, label + ' did not load GLB');
  assert.equal(paused.rigCount, 22, label + ' still used primitive mesh');
  assert.equal(paused.primitiveCount, 0, label + ' used primitive mesh');
  assert.ok(names.length > 0, label + ' contains ZERO activated glTF animations');
  assert.ok(snapshots.every(s => s.rigCount === 22), label + ' loses rigged meshes');
  return { label, names };
}
try {
  await page.goto(base + '/week7.html?game=2026_07_CIN_BAL&debug=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => (document.querySelector('#status')?.textContent || '').includes('Ready ·'), null, {timeout: 100000});
  await page.waitForFunction(() => window.__gridironRenderer?.riggedGltf && window.__gridironRenderer.players.size > 0, null, {timeout: 100000});
  const run = await samplePlay('run', /\bRun\b/i);
  const pass = await samplePlay('pass', /Pass Complete|Pass Incomplete|Interception/i);
  assert.ok(!errors.length, 'page errors: ' + errors.join('; '));
  console.log('PASS live mixamo clips activated in actual six-game app, run and pass: ' + JSON.stringify({run, pass}));
} finally {
  await browser.close();
}
