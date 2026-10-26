// Proves the animation controller hits the recorded moments in a real play.
//
// Uses the viewer's own ?debug hooks (no test-only globals): pick a play, place
// playback at exact seconds, and read which clip is on each body plus the
// distance from the hand bone to the ball.
//
// Run: BASE=http://127.0.0.1:8233 node test/anim-controller-probe.mjs
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:8233';
const GAME = process.env.GAME || '2026_07_CIN_BAL';

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(`${BASE}/week7.html?game=${GAME}&debug`);
await page.waitForFunction(() => /^Ready \u00b7/.test(document.getElementById('status')?.textContent || ''), null, { timeout: 240000 });
await page.waitForFunction(() => !!window.__gridironRenderer, null, { timeout: 120000 });

// Find a play whose cue list has a throw on one player and a catch on another.
const found = await page.evaluate(async () => {
  const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  for (let i = 0; i < 200; i++) {
    window.__gridironChoose(i);
    await frame(); // draw() derives the cue list for the selected play
    const r = window.__gridironRenderer;
    const cues = r.cuesById;
    if (!cues?.size) continue;
    let thrower = null;
    let catcher = null;
    for (const [id, list] of cues) {
      const t = list.find((q) => q.kind === 'throw');
      if (t && !thrower) thrower = { id, cue: t };
      const k = list.find((q) => q.kind === 'catch');
      if (k && id !== thrower?.id) catcher = { id, cue: k };
    }
    if (thrower && catcher && catcher.cue.anchorAt > thrower.cue.anchorAt) {
      return { index: i, thrower, catcher, t0: r.cueRec?.t0 ?? null };
    }
  }
  return null;
});
if (!found) {
  console.log(JSON.stringify({ ok: false, reason: 'no play with a throw and a catch cue' }));
  await browser.close();
  process.exit(1);
}

// The rigged GLB loads asynchronously and swaps the bodies in; measuring before
// that lands silently measures the primitive fallback (no bones, no controller).
await page.waitForFunction(() => {
  const r = window.__gridironRenderer;
  return [...r.players.values()].some((p) => p.userData.rigged && p.userData.bones?.handR);
}, null, { timeout: 180000 });
await page.evaluate(async (index) => {
  const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  window.__gridironChoose(index);
  await frame();
}, found.index);

const measure = (anchored) => page.evaluate(({ thrower, catcher, anchored }) => {
  const r = window.__gridironRenderer;
  // fresh controllers so each pass starts cold
  for (const [, pl] of r.players) {
    pl.userData.animation?.mixer?.stopAllAction();
    pl.userData.controller = null;
  }
  if (!anchored) {
    // the old behaviour: every clip starts from frame 0 when its pose code
    // appears, so nothing is anchored to the ball
    r.cueRec = r.cueRec;
    r.cuesById = new Map();
  } else {
    r.cueRec = null; // let draw() derive the cues again
  }
  const read = (id) => {
    const row = window.__gridironAnimationState().find((x) => x.id === id) || {};
    return { clip: row.clip ?? null, phase: row.phase === null ? null : Math.round(row.phase * 100) / 100, d: row.handToBall };
  };
  // Cue times are absolute playback time (the base renderer.draw() receives);
  // __gridironDrawAt takes seconds from the snap, so convert with rec.t0.
  const t0 = window.__gridironRecordMeta()?.t0 ?? 0;
  let t = Math.round((thrower.cue.at - 0.8) * 1000) / 1000;
  const end = catcher.cue.anchorAt + 0.2;
  let atRelease = null;
  let atCatch = null;
  while (t <= end) {
    window.__gridironDrawAt(t - t0);
    if (!atRelease && t >= thrower.cue.anchorAt) atRelease = { t, ...read(thrower.id) };
    if (!atCatch && t >= catcher.cue.anchorAt) atCatch = { t, ...read(catcher.id) };
    t = Math.round((t + 0.033) * 1000) / 1000;
  }
  if (anchored) {
    // does the body come off the long pass clip after the follow-through?
    window.__gridironDrawAt(catcher.cue.anchorAt + 0.9 - t0);
    return { atRelease, atCatch, afterFollowThrough: { t: catcher.cue.anchorAt + 0.9, ...read(thrower.id) } };
  }
  return { atRelease, atCatch };
}, { thrower: found.thrower, catcher: found.catcher, anchored });

const anchored = await measure(true);
const legacy = await measure(false);

const fmt = (label, r) => `${label.padEnd(9)} release: ${String(r.atRelease.clip).padEnd(17)} phase ${String(r.atRelease.phase).padStart(4)}  ball ${r.atRelease.d.toFixed(2)} yd`
  + `  ||  arrival: ${String(r.atCatch.clip).padEnd(17)} phase ${String(r.atCatch.phase).padStart(4)}  ball ${r.atCatch.d.toFixed(2)} yd`;

const out = {
  play: found.index,
  cueTimes: {
    throwCode: found.thrower.cue.at,
    ballLeavesHand: found.thrower.cue.anchorAt,
    catchCode: found.catcher.cue.at,
    ballArrives: found.catcher.cue.anchorAt,
  },
  anchored,
  legacy,
  errors: errors.slice(0, 4),
  ok: anchored.atRelease.clip === 'Quarterback Pass'
    && anchored.atCatch.clip === 'Football Catch 1'
    && anchored.atCatch.d < 1.5
    && anchored.afterFollowThrough?.clip === 'Running in place',
};

console.log(fmt('anchored', anchored));
console.log('after follow-through: QB is on', anchored.afterFollowThrough?.clip, 'at phase', anchored.afterFollowThrough?.phase);
console.log(fmt('legacy', legacy));
console.log(JSON.stringify(out));
await browser.close();
process.exit(out.ok ? 0 : 1);
