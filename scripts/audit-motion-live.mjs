// Frame-by-frame audit of player MOTION as it actually appears in the viewer (clip + lean + hip twist + everything).
//
//   node scripts/audit-motion-live.mjs [--plays 12] [--url http://127.0.0.1:8141] [--out docs/MOTION-AUDIT-LIVE.md]
//
// Steps whole plays at 30 fps through the app's own hooks and, for every rigged player every frame, measures from the
// real bone positions: torso roll / twist / pitch, how far the arms swing, how far the hands spread from the body, and
// the elbow angles. Results are grouped by the clip on the body and checked against realistic ranges. Anything outside
// a range is listed; the exit code is 1 if a locomotion or set-piece clip fails. Needs Chrome and the dev server.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const arg = (name, dflt) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : dflt; };
const PLAYS = Number(arg('plays', 12));
const URL = arg('url', 'http://127.0.0.1:8141');
const OUT = arg('out', '');
const FLAGS = arg('flags', '').split(',').filter(Boolean);   // e.g. noLean,noTwist: switch a layer off to see what it contributes
const ONLY = arg('only', '');                                // restrict the report to clips matching this regex
const YD = 0.9144;

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
await page.addInitScript((flags) => { globalThis.__audit = Object.fromEntries(flags.map((f) => [f, true])); }, FLAGS);
await page.goto(`${URL}/week7.html?game=2026_07_CIN_BAL&debug`);
await page.waitForFunction(() => /^Ready ·/.test(document.getElementById('status')?.textContent || ''), null, { timeout: 300000 });

// samples[clip] = { n, roll:[], twist:[], pitch:[], swing:[], spread:[], elbow:[], ... } plus per-player series for swing windows
const agg = {};
const slotRows = {};
for (let play = 0; play < PLAYS; play++) {
  const res = await page.evaluate(async ({ play, YD }) => {
    const r = window.__gridironRenderer;
    if (!r.__orig) { r.__orig = r.draw; r.draw = (rec, t, dt) => (window.__manual ? r.__orig.call(r, rec, t, dt) : undefined); }
    window.__gridironChoose(play);
    await new Promise((x) => requestAnimationFrame(() => requestAnimationFrame(x)));
    const dur = window.__gridironState().duration;
    const rec = r.cueRec;
    const slotOf = new Map(rec.roster.map((p) => [p.id, p.slot]));
    const out = [];
    const deg = (v) => (v * 180) / Math.PI;
    const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
    window.__manual = true;
    const prevFeet = new Map();   // per player: world-space foot positions on the previous frame
    for (let s = 0; s < dur; s += 1 / 30) {
      window.__gridironDrawAt(s);
      for (const [id, o] of r.players) {
        const u = o.userData; if (!u.rigged || !u.controller?.current) continue;
        o.updateMatrixWorld(true);
        const inv = o.matrixWorld.clone().invert();
        const P = (n) => { const b = u.bones[n]; const v = new b.position.constructor(); b.getWorldPosition(v); return v.applyMatrix4(inv).multiplyScalar(YD); };
        const hip = P('hip'), neck = P('neck'), upL = P('upL'), upR = P('upR'), foreL = P('foreL'), foreR = P('foreR'), handL = P('handL'), handR = P('handR'), thL = P('thighL'), thR = P('thighR');
        // root-local axes: +x forward, +y up, z lateral (left is -z)
        const roll = deg(Math.atan2(upL.y - upR.y, Math.abs(upL.z - upR.z) + 1e-6));            // + = left shoulder up
        const sh = Math.atan2(upL.x - upR.x, upL.z - upR.z), hp = Math.atan2(thL.x - thR.x, thL.z - thR.z);
        const twist = deg(wrap(sh - hp));                                                         // shoulders turned relative to hips
        const pitch = deg(Math.atan2(neck.x - hip.x, neck.y - hip.y));                            // + = leaning forward
        const swingL = handL.x - upL.x, swingR = handR.x - upR.x;                                  // hand ahead of / behind its shoulder (m)
        const spread = Math.max(Math.abs(handL.z - hip.z), Math.abs(handR.z - hip.z));            // widest hand from the body centreline (m)
        const ang = (a, b) => { const d = a.x * b.x + a.y * b.y + a.z * b.z; return deg(Math.acos(Math.max(-1, Math.min(1, d / (a.length() * b.length() + 1e-9))))); };
        const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z, length() { return Math.hypot(this.x, this.y, this.z); } });
        const elbL = ang(sub(foreL, upL), sub(handL, foreL)), elbR = ang(sub(foreR, upR), sub(handR, foreR));
        // planted-foot slide: world-space horizontal speed of the foot that is on the ground (ball of the foot < 0.07 m up)
        const W = (n) => { const b = u.bones[n]; const v = new b.position.constructor(); b.getWorldPosition(v); return v.multiplyScalar(YD); };
        const fl = W('toeL'), fr = W('toeR');          // the ball of the foot is the contact point; the ankle travels over a planted foot
        const prev = prevFeet.get(id);
        let slide = null;
        if (prev && prev.t === s - 1 / 30 + 0 || (prev && Math.abs(prev.t - (s - 1 / 30)) < 1e-6)) {
          const low = fl.y < fr.y ? ['L', fl, prev.l] : ['R', fr, prev.r];
          if (low[1].y < 0.07) slide = Math.hypot(low[1].x - low[2].x, low[1].z - low[2].z) * 30;
        }
        prevFeet.set(id, { t: s, l: fl.clone(), r: fr.clone() });
        out.push({ id, slot: slotOf.get(id), clip: u.controller.current, t: s, roll, twist, pitch, swingL, swingR, spread, elbL, elbR, y: hip.y, slide });
      }
    }
    window.__manual = false;
    return { title: document.getElementById('snap-title')?.textContent, out };
  }, { play, YD });
  console.error(`play ${play}: ${res.title?.slice(0, 40)} (${res.out.length} samples)`);
  for (const row of res.out) {
    const a = (agg[row.clip] ??= { n: 0, rows: [] });
    a.n++; a.rows.push(row);
    if (row.slot === 'K' || row.slot === 'P') (slotRows[row.slot] ??= []).push(row);
  }
}
await browser.close();

// ------------------------------------------------------------------ statistics
const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const std = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((v) => (v - m) ** 2))); };
const range = (a) => (a.length ? Math.max(...a) - Math.min(...a) : 0);
const LOCOMOTION = /^(Jogging In Place|run-in-place|Running in place|Sprint In Place|Running While Holding Something|Running Backward in place|FB_Walk|FB_Dropback)$/;

/** Per-clip stats. Arm swing is the range of each hand's forward offset over each player's own run of consecutive frames. */
function stats(rows) {
  const byPlayer = new Map();
  for (const r of rows) { if (!byPlayer.has(r.id)) byPlayer.set(r.id, []); byPlayer.get(r.id).push(r); }
  const swingRanges = [];
  for (const list of byPlayer.values()) {
    for (let i = 0; i + 30 <= list.length; i += 30) {                  // 1-second windows
      const w = list.slice(i, i + 30);
      swingRanges.push(Math.max(range(w.map((r) => r.swingL)), range(w.map((r) => r.swingR))));
    }
  }
  // roll "wobble" is the frame-to-frame change, which is what reads as rocking; the mean tilt is a deliberate lean
  const wobble = [];
  for (const list of byPlayer.values()) for (let i = 1; i < list.length; i++) wobble.push(Math.abs(list[i].roll - list[i - 1].roll));
  return {
    n: rows.length,
    rollStd: std(rows.map((r) => r.roll)), rollMax: Math.max(...rows.map((r) => Math.abs(r.roll))), rollWobble: mean(wobble) * 30,    // deg/s of side-to-side rocking
    twistStd: std(rows.map((r) => r.twist)), twistMax: Math.max(...rows.map((r) => Math.abs(r.twist))),
    pitchMean: mean(rows.map((r) => r.pitch)), pitchStd: std(rows.map((r) => r.pitch)),
    swing: swingRanges.length ? mean(swingRanges) : null,
    spreadMax: Math.max(...rows.map((r) => r.spread)), spreadMean: mean(rows.map((r) => r.spread)),
    slide: (() => { const v = rows.map((r) => r.slide).filter((x) => x !== null && x !== undefined); return v.length ? mean(v) : null; })(),
    elbowMin: Math.min(...rows.map((r) => Math.min(r.elbL, r.elbR))), elbowMax: Math.max(...rows.map((r) => Math.max(r.elbL, r.elbR))),
  };
}

// Realistic ranges. Locomotion: the torso should not rock side to side or whip, the arms should pump, the hands stay near the body.
const CHECKS = [
  { id: 'rocking', test: (s, c) => LOCOMOTION.test(c) && s.rollStd > 7, msg: (s) => `shoulders rock side to side: roll std ${s.rollStd.toFixed(1)} deg (limit 7; real sprinting is about 3 to 5), peak ${s.rollMax.toFixed(0)}` },
  { id: 'twist', test: (s, c) => LOCOMOTION.test(c) && s.twistMax > 40, msg: (s) => `shoulders twist ${s.twistMax.toFixed(0)} deg off the hips (limit 35)` },
  { id: 'no-arm-swing', test: (s, c) => /^(Sprint In Place|run-in-place|Running in place|Jogging In Place)$/.test(c) && s.swing !== null && s.swing < 0.5, msg: (s) => `arms barely swing: hands move ${s.swing.toFixed(2)} m fore-aft per second (a runner's arms pump about 0.5 to 0.8)` },
  { id: 'arms-out', test: (s, c) => (LOCOMOTION.test(c) || /Idle|Stance|Block|Holder|QB_Ready/.test(c)) && s.spreadMax > 0.85, msg: (s) => `hands reach ${s.spreadMax.toFixed(2)} m from the body line (limit 0.85)` },
  { id: 'arms-out-kick', test: (s, c) => /^FB_(Kick|Punt)$/.test(c) && s.spreadMean > 0.55, msg: (s) => `arms held wide: mean hand spread ${s.spreadMean.toFixed(2)} m during the kick (a kicker's arms stay near the body, limit 0.55)` },
  { id: 'foot-slide', test: (s, c) => (LOCOMOTION.test(c) || /^FB_(Kick|Punt)$/.test(c)) && s.slide !== null && s.slide > 0.8, msg: (s) => `planted foot slides ${s.slide.toFixed(2)} m/s over the ground (limit 0.8; the body floats)` },
  { id: 'upright-run', test: (s, c) => /^(Sprint In Place|Running in place)$/.test(c) && s.pitchMean < 2, msg: (s) => `sprinting upright: mean forward lean ${s.pitchMean.toFixed(0)} deg (a sprinter leans >= 5)` },
];

const rows = Object.entries(agg).filter(([clip]) => !ONLY || new RegExp(ONLY).test(clip)).map(([clip, a]) => ({ clip, ...stats(a.rows) })).sort((x, y) => y.n - x.n);
const flags = [];
for (const r of rows) for (const c of CHECKS) if (c.test(r, r.clip)) flags.push({ clip: r.clip, check: c.id, msg: c.msg(r), n: r.n });

const f = (v, d = 1) => (v === null || v === undefined ? '-' : v.toFixed(d));
let md = `# Live motion audit\n\nGenerated by \`scripts/audit-motion-live.mjs\` over ${PLAYS} plays at 30 fps. Metrics come from the real bone positions in the viewer, so they include the clip, the lean, the hip twist and everything else on the body.\n\n`;
md += `Switched off: ${FLAGS.join(', ') || 'nothing'}

`;
md += `## Flags (${flags.length})\n\n` + (flags.length ? flags.map((x) => `- **${x.clip}** [${x.check}] ${x.msg} (${x.n} frames)`).join('\n') : 'None.') + '\n\n';
md += `## Per clip\n\n| Clip | Frames | Roll std deg | Roll max | Twist max | Pitch mean | Arm swing m/s | Hand spread max m | Foot slide m/s | Elbow min-max deg |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n`;
for (const r of rows) md += `| ${r.clip} | ${r.n} | ${f(r.rollStd, 1)} | ${f(r.rollMax, 0)} | ${f(r.twistMax, 0)} | ${f(r.pitchMean, 0)} | ${f(r.swing, 2)} | ${f(r.spreadMax, 2)} | ${f(r.slide, 2)} | ${f(r.elbowMin, 0)}-${f(r.elbowMax, 0)} |\n`;
for (const slot of ['K', 'P']) {
  if (!slotRows[slot]) continue;
  const byClip = {};
  for (const r of slotRows[slot]) (byClip[r.clip] ??= []).push(r);
  md += `\n## Slot ${slot} (${slot === 'K' ? 'kicker' : 'punter'}), by clip\n\n| Clip | Frames | Roll std deg | Roll max | Twist max | Pitch mean | Arm swing m/s | Hand spread mean/max m | Foot slide m/s |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n`;
  for (const [clip, list] of Object.entries(byClip)) { const s = stats(list); md += `| ${clip} | ${s.n} | ${f(s.rollStd, 1)} | ${f(s.rollMax, 0)} | ${f(s.twistMax, 0)} | ${f(s.pitchMean, 0)} | ${f(s.swing, 2)} | ${f(s.spreadMean, 2)}/${f(s.spreadMax, 2)} | ${f(s.slide, 2)} |\n`; }
}
console.log(md);
if (OUT) writeFileSync(OUT, md);
process.exit(flags.some((x) => LOCOMOTION.test(x.clip) || /^FB_/.test(x.clip)) ? 1 : 0);
