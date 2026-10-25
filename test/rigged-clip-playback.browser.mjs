import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// Proves the authored clips actually run in a real game, frame by frame, rather
// than only that the GLB loads:
//   THROW frames  -> Quarterback Pass
//   CATCH frames  -> a run clip, never a catch clip
//   moving carrier-> Running While Holding Something
//   standing      -> Idle (nobody jogs in place)
// Run against a static server: BASE_URL=http://127.0.0.1:8160 node --test test/rigged-clip-playback.browser.mjs
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8080';
const PRE_SNAP_FRAMES = 0.9 * 30;
const STATIONARY = 0.2;

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const errors = [];
const page = await browser.newPage({ viewport: { width: 1280, height: 880 } });
page.on('pageerror', (e) => errors.push(String(e)));

const waitForRecord = async () => {
  for (let i = 0; i < 40; i++) {
    const rec = await page.evaluate(() => window.__gridironPlay());
    if (rec) return rec;
    await page.waitForTimeout(100);
  }
  return null;
};

try {
  await page.goto(`${BASE}/week7.html?game=2026_07_CIN_BAL&debug`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const s = document.querySelector('#status')?.textContent || '';
    return s.includes('Ready ·') || s.startsWith('Regulation ended')
      || s.includes('Simulation stopped') || s.includes('Assets not ready') || s.includes('Simulation failed');
  }, null, { timeout: 90000 });
  const status = await page.evaluate(() => document.querySelector('#status')?.textContent || '');
  assert.ok(!/Assets not ready|Simulation failed/.test(status), `app did not load: ${status}`);

  // Walk to a pass play: the run play has no THROW frames.
  let found = null;
  for (let i = 0; i < 14 && !found; i++) {
    const rec = await waitForRecord();
    if (rec) {
      const throws = rec.frames.filter((f) => {
        for (let k = 4; k < f.length - 6; k += 6) if (f[k] === 4) return true;
        return false;
      }).length;
      if (throws > 3) found = { rec, index: i, throws };
    }
    if (!found) {
      await page.click('#next');
      await page.waitForTimeout(400);
    }
  }
  assert.ok(found, 'no pass play with THROW frames was reachable in the first 14 plays');

  const rec = await waitForRecord();
  const duration = (rec.frames.length - 1) / rec.hz;
  const names = Object.fromEntries(
    (await page.evaluate(() => window.__gridironAnimation())).map((a) => [a.id, a.name]),
  );

  // Sample inside the page: one round trip per play instead of one per frame.
  const tally = await page.evaluate(async ({ frames, ids, hz, t0, preSnapFrames, stationary }) => {
    const names = Object.fromEntries(window.__gridironAnimation().map((a) => [a.id, a.name]));
    const out = { throw: {}, catch: {}, carry: {}, standing: {}, preSnap: {}, bad: [] };
    const bump = (bucket, key) => { bucket[key] = (bucket[key] || 0) + 1; };
    // Drive the renderer directly: the animation loop is not needed to advance
    // clip selection, and skipping GPU frames keeps this test fast.
    const renderer = window.__gridironRenderer;
    const rec = { frames, roster: ids.map((id) => ({ id })), t0, hz };
    for (let k = 0; k < frames.length; k++) {
      renderer.draw(rec, t0 + k / hz, 1 / 60);
      const clips = new Map(window.__gridironAnimation().map((a) => [a.id, a.clip]));
      const f = frames[k];
      for (let i = 0; i < ids.length; i++) {
        const pose = f[i * 6 + 4], speed = f[i * 6 + 3], carrying = f[i * 6 + 5] > 0.5;
        const clip = clips.get(ids[i]) ?? 'none';
        const who = names[ids[i]] ?? ids[i];
        if (pose === 4) { bump(out.throw, `${who}:${clip}`); if (clip !== 'Quarterback Pass') out.bad.push({ k, who, kind: 'throw', clip }); }
        if (pose === 5) { bump(out.catch, `${who}:${clip}`); if (/catch/i.test(clip)) out.bad.push({ k, who, kind: 'catch', clip }); }
        if (pose === 1 && carrying && speed >= 0.35) { bump(out.carry, clip); if (clip !== 'Running While Holding Something') out.bad.push({ k, who, kind: 'carry', clip }); }
        if (pose === 1 && speed < stationary) { bump(out.standing, clip); if (clip !== 'Idle') out.bad.push({ k, who, kind: 'standing', clip }); }
        if (k < preSnapFrames) {
          bump(out.preSnap, clip);
          // Backpedaling defensive backs are correct; a forward jog or a carry
          // cycle while the ball is still on the ground is not.
          if (['Running in place', 'Running While Holding Something'].includes(clip)) out.bad.push({ k, who, kind: 'presnap', clip });
        }
      }
    }
    // Regression: a clip switch used to set the incoming action's weight to 0
    // before fading it in, and fadeIn multiplies by that weight, so the ramp
    // stayed at zero and every player held the bind pose. A settled clip must
    // reach full weight.
    for (let k = 0; k < 40; k++) renderer.draw(rec, t0 + (frames.length - 1) / hz, 1 / 60);
    const rigged = [...renderer.players.values()].filter((o) => o.userData.rigged);
    out.minWeight = rigged.length ? Math.min(...rigged.map((o) => o.userData.animation.activeAction?.getEffectiveWeight() ?? 0)) : 0;
    out.riggedCount = rigged.length;
    return out;
  }, { frames: rec.frames, ids: rec.ids, hz: rec.hz, t0: rec.t0, preSnapFrames: PRE_SNAP_FRAMES, stationary: STATIONARY });

  assert.deepEqual(tally.bad.slice(0, 5), [], `clip mismatches: ${JSON.stringify(tally.bad.slice(0, 5))}`);
  assert.ok(tally.riggedCount > 0, 'no rigged players were built');
  assert.ok(tally.minWeight > 0.99, `rigged clip weight collapsed to the bind pose: ${tally.minWeight}`);
  assert.ok(Object.keys(tally.throw).length > 0, 'no THROW frames were sampled');
  assert.ok(Object.keys(tally.catch).length > 0, 'no CATCH frames were sampled');
  assert.ok(Object.keys(tally.carry).length > 0, 'no moving-carry frames were sampled');
  assert.deepEqual(errors, [], 'page errors during clip playback');
  console.log('PASS authored clips play in a real game:', JSON.stringify({
    play: found.index,
    frames: rec.frames.length,
    throw: tally.throw,
    catch: tally.catch,
    carry: tally.carry,
    standing: tally.standing,
    preSnap: tally.preSnap,
  }));
} finally {
  await browser.close();
}
