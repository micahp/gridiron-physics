// Frame trace of one player's feet in the real viewer: clip, speed, toe heights, foot-lock state, ground speed of each toe.
//   node scripts/trace-feet.mjs [--play 0] [--clip Sprint] [--fps 60] [--frames 40] [--shots dir]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const arg = (name, dflt) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : dflt; };
const PLAY = Number(arg('play', 0)), CLIP = arg('clip', 'Sprint'), FPS = Number(arg('fps', 60)), FRAMES = Number(arg('frames', 40));
const SHOTS = arg('shots', ''), FLAGS = arg('flags', '').split(',').filter(Boolean);
const URL = arg('url', 'http://127.0.0.1:8141');

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
await page.addInitScript((flags) => { globalThis.__audit = Object.fromEntries(flags.map((f) => [f, true])); }, FLAGS);
await page.goto(`${URL}/week7.html?game=2026_07_CIN_BAL&debug`);
await page.waitForFunction(() => /^Ready ·/.test(document.getElementById('status')?.textContent || ''), null, { timeout: 300000 });

const found = await page.evaluate(async ({ PLAY, CLIP, FPS }) => {
  const r = window.__gridironRenderer;
  r.__orig = r.draw; r.draw = (rec, t, dt) => (window.__manual ? r.__orig.call(r, rec, t, dt) : undefined);
  window.__gridironChoose(PLAY);
  await new Promise((x) => setTimeout(x, 1500));
  window.__manual = true;
  const dur = window.__gridironState().duration;
  const re = new RegExp(CLIP);
  // find the player who spends the longest unbroken run on the clip
  const runs = new Map(); let best = null;
  for (let s = 0; s < dur; s += 1 / FPS) {
    window.__gridironDrawAt(s);
    for (const [id, o] of r.players) {
      const u = o.userData; if (!u.rigged) continue;
      const on = re.test(u.controller?.current || '');
      const cur = runs.get(id);
      if (on) { if (cur) cur.n++; else runs.set(id, { start: s, n: 1 }); const c = runs.get(id); if (!best || c.n > best.n) best = { id, start: c.start, n: c.n }; }
      else runs.delete(id);
    }
  }
  return best;
}, { PLAY, CLIP, FPS });
if (!found) { console.log('no player on a clip matching', CLIP); await browser.close(); process.exit(1); }
console.log(`player ${found.id}: ${found.n} frames on /${CLIP}/ from t=${found.start.toFixed(2)}`);
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const t0 = found.start + Math.max(0, (found.n / FPS) * 0.3);
let prev = null;
console.log('   t   clip                 spd  toeL  toeR  L R   vL    vR  (toe heights m, ground speed of each toe m/s; * = pinned)');
for (let i = 0; i < FRAMES; i++) {
  const s = t0 + i / FPS;
  const row = await page.evaluate(({ s, id, first }) => {
    const r = window.__gridironRenderer, YD = 0.9144;
    if (first) for (let w = Math.max(0, s - 2.5); w < s; w += 1 / 60) window.__gridironDrawAt(w);   // warm the state up to the first frame
    window.__gridironDrawAt(s);
    const o = r.players.get(id), u = o.userData;
    const W = (n) => { const b = u.bones[n]; const v = new b.position.constructor(); b.getWorldPosition(v); return { x: v.x * YD, y: (v.y - o.position.y) * YD, z: v.z * YD }; };
    if (window.__followShot) {
      const c = r.camera, side = 7;
      const yaw = -o.rotation.y;
      c.position.set(o.position.x + Math.sin(yaw) * side, 1.2, o.position.z - Math.cos(yaw) * side);
      c.lookAt(o.position.x, 0.9, o.position.z); c.fov = 22; c.updateProjectionMatrix();
      r.renderer.render(r.scene, c);
    }
    return { clip: u.controller.current, l: W('toeL'), r: W('toeR'), on: [u.feet?.L?.on, u.feet?.R?.on], x: o.position.x * YD, z: o.position.z * YD };
  }, { s, id: found.id, first: i === 0 });
  const v = (a, b) => (prev ? Math.hypot(a.x - b.x, a.z - b.z) * FPS : 0);
  const spd = prev ? Math.hypot(row.x - prev.x, row.z - prev.z) * FPS : 0;
  console.log(`${s.toFixed(3)} ${row.clip.padEnd(20).slice(0, 20)} ${spd.toFixed(1).padStart(4)} ${row.l.y.toFixed(2)}  ${row.r.y.toFixed(2)}  ${row.on[0] ? '*' : '.'} ${row.on[1] ? '*' : '.'} ${v(row.l, prev?.l).toFixed(1).padStart(5)} ${v(row.r, prev?.r).toFixed(1).padStart(5)}`);
  prev = row;
  if (SHOTS) {
    await page.evaluate(() => { window.__followShot = true; });
    await page.evaluate(({ s }) => window.__gridironDrawAt(s), { s });
    await page.locator('canvas').first().screenshot({ path: `${SHOTS}/f${String(i).padStart(3, '0')}.png` });
  }
}
await browser.close();
