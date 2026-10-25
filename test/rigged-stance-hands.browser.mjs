import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// Guards the "hands clasped behind the back" look. The asset's idle clip puts
// the hands at hip depth inside a barrel-shaped jersey, so from behind the
// forearm disappears into the torso silhouette. updateRiggedAnimation applies a
// small shoulder abduction/forward offset on top of every clip; this checks on
// a real rendered frame that a standing player's hands sit in front of the hip
// line rather than behind it.
//   BASE_URL=http://127.0.0.1:8160 node --test test/rigged-stance-hands.browser.mjs
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8080';

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const errors = [];
const page = await browser.newPage({ viewport: { width: 1280, height: 880 } });
page.on('pageerror', (e) => errors.push(String(e)));

try {
  await page.goto(`${BASE}/week7.html?game=2026_07_CIN_BAL&debug`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const s = document.querySelector('#status')?.textContent || '';
    return s.includes('Ready ·') || s.includes('Simulation stopped') || s.includes('Simulation failed');
  }, null, { timeout: 90000 });
  const status = await page.evaluate(() => document.querySelector('#status')?.textContent || '');
  assert.ok(!/Assets not ready|Simulation failed/.test(status), `app did not load: ${status}`);

  // Park on a play without starting it: every player holds the stance.
  await page.click('#next');
  await page.waitForTimeout(2000);

  const sample = await page.evaluate(() => {
    const r = window.__gridironRenderer;
    if (!r) return null;
    const rows = [];
    for (const [id, o] of r.players) {
      const b = o.userData?.bones;
      const clip = o.userData?.animation?.activeClipName;
      if (!b?.handL || !b?.handR || !b?.hip || clip !== 'Idle') continue;
      const hd = o.rotation.y, fx = Math.cos(hd), fz = -Math.sin(hd);
      const hp = b.hip.matrixWorld.elements;
      const lf = ((b.handL.matrixWorld.elements[12] - hp[12]) * fx) + ((b.handL.matrixWorld.elements[14] - hp[14]) * fz);
      const rf = ((b.handR.matrixWorld.elements[12] - hp[12]) * fx) + ((b.handR.matrixWorld.elements[14] - hp[14]) * fz);
      rows.push({ id, fwd: +(((lf + rf) / 2)).toFixed(3) });
    }
    return rows;
  });

  assert.ok(sample && sample.length >= 6, `expected a full stance, sampled ${sample ? sample.length : 0} players`);
  const mean = sample.reduce((s, r) => s + r.fwd, 0) / sample.length;
  const behind = sample.filter((r) => r.fwd < -0.02);
  assert.deepEqual(behind, [], `players whose hands sit behind the hip line: ${JSON.stringify(behind.slice(0, 4))}`);
  assert.ok(mean > 0.05, `stance hands sit at the hip line (mean ${mean.toFixed(3)} yd in front)`);
  assert.deepEqual(errors, [], 'page errors while sampling the stance');
  console.log('PASS stance hands clear the torso:', JSON.stringify({ players: sample.length, mean: +mean.toFixed(3), min: Math.min(...sample.map((r) => r.fwd)) }));
} finally {
  await browser.close();
}
