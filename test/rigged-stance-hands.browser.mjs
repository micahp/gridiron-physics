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
      const hd = o.rotation.y;
      const fx = Math.cos(hd), fz = -Math.sin(hd);   // character forward
      const sx = -Math.sin(hd), sz = -Math.cos(hd);  // character left
      const hp = b.hip.matrixWorld.elements;
      const rel = (bone) => {
        const m = bone.matrixWorld.elements;
        return {
          fwd: ((m[12] - hp[12]) * fx) + ((m[14] - hp[14]) * fz),
          side: ((m[12] - hp[12]) * sx) + ((m[14] - hp[14]) * sz),
        };
      };
      const l = rel(b.handL), rr = rel(b.handR);
      rows.push({
        id,
        fwd: +(((l.fwd + rr.fwd) / 2)).toFixed(3),
        sideL: +l.side.toFixed(3),
        sideR: +rr.side.toFixed(3),
        apart: +Math.hypot(l.side - rr.side, l.fwd - rr.fwd).toFixed(3),
      });
    }
    return rows;
  });

  assert.ok(sample && sample.length >= 6, `expected a full stance, sampled ${sample ? sample.length : 0} players`);
  // Hands meeting behind the spine sit within a hand's width of each other; a
  // natural hang puts them roughly a shoulder apart.
  const closest = sample.reduce((min, r) => (r.apart < min.apart ? r : min), sample[0]);
  const claspedSide = sample.filter((r) => Math.abs(r.sideL) < 0.1 || Math.abs(r.sideR) < 0.1);
  assert.ok(closest.apart > 0.3, `hands nearly meet (${closest.apart} yd apart) — reads as clasped behind the back`);
  assert.deepEqual(claspedSide.slice(0, 4), [], 'a hand sits on the spine centre line');
  const mean = sample.reduce((s, r) => s + r.fwd, 0) / sample.length;
  assert.ok(mean > -0.02, `stance hands sit behind the hip line (mean ${mean.toFixed(3)} yd)`);
  assert.deepEqual(errors, [], 'page errors while sampling the stance');
  console.log('PASS stance hands hang at the sides:', JSON.stringify({
    players: sample.length,
    meanFwd: +mean.toFixed(3),
    closestPair: closest.apart,
    meanSpread: +(sample.reduce((s, r) => s + r.apart, 0) / sample.length).toFixed(3),
  }));
} finally {
  await browser.close();
}
