import { readFileSync } from 'node:fs';
const root = process.argv[2];
const { simulateGame } = await import(`${root}/engine/game.js`);
const game = JSON.parse(readFileSync(`${root}/web/data/game.json`, 'utf8'));
const res = simulateGame(game);
const r = res[18];
const YD = 0.9144;
const n = r.roster.length;
const stride = r.stride;
console.log('engine:', root.split('/').pop(), '| roster', n, 'stride', stride, 'hz', r.hz, 't0', r.t0);
const viol = r.stats.filter((s) => s.top > game.players[s.id].physics.vmax * 1.08)
  .map((s) => ({ id: s.id, name: game.players[s.id].name, top: +s.top.toFixed(2), vmax: game.players[s.id].physics.vmax, idx: r.roster.findIndex((p) => p.id === s.id) }));
console.log('violators:', JSON.stringify(viol));
const maxByPlayer = r.stats.map((s) => ({ name: game.players[s.id].name, top: s.top, vmax: game.players[s.id].physics.vmax }))
  .sort((a, b) => b.top / b.vmax - a.top / a.vmax).slice(0, 4);
console.log('top ratio:', JSON.stringify(maxByPlayer.map((x) => ({ n: x.name, top: +x.top.toFixed(2), vmax: +x.vmax.toFixed(2), r: +(x.top / x.vmax).toFixed(2) }))));
for (const v of viol.slice(0, 2)) {
  const o = v.idx * 6;
  let first = -1;
  for (let k = 0; k < r.frames.length; k++) {
    const sp = r.frames[k][o + 3];
    if (sp > game.players[v.id].physics.vmax * 1.08) { first = k; break; }
  }
  if (first < 0) { console.log(v.name, 'no frame above threshold'); continue; }
  const t = r.t0 + first / r.hz;
  console.log(`\n${v.name} first above 1.08*vmax at frame ${first}, t=${t.toFixed(3)} s`);
  for (let k = Math.max(0, first - 3); k <= Math.min(r.frames.length - 1, first + 2); k++) {
    const f = r.frames[k];
    console.log(`  k=${k} t=${(r.t0 + k / r.hz).toFixed(3)} speed=${f[o + 3].toFixed(2)} pos=(${(f[o] * YD).toFixed(2)}, ${(f[o + 1] * YD).toFixed(2)}) pose=${f[o + 4]}`);
  }
  const tt = r.t0 + first / r.hz;
  const near = [];
  const f = r.frames[first];
  for (let j = 0; j < n; j++) {
    if (j === v.idx) continue;
    const dx = (f[j * 6] - f[o]) * YD, dy = (f[j * 6 + 1] - f[o + 1]) * YD;
    const d = Math.hypot(dx, dy);
    if (d < 2.5) near.push({ name: game.players[r.roster[j].id].name, d: +d.toFixed(2), speed: +f[j * 6 + 3].toFixed(2) });
  }
  console.log('  players within 2.5 m at that frame:', JSON.stringify(near));
  const ev = r.events.filter((e) => Math.abs(e.t - tt) <= 0.25);
  console.log('  events within 0.25 s:', JSON.stringify(ev.map((e) => ({ t: +e.t.toFixed(3), type: e.type, by: e.by && game.players[e.by]?.name, on: e.on && game.players[e.on]?.name, from: e.from && game.players[e.from]?.name, closing: e.closing && +e.closing.toFixed(2), energy: e.energy && +e.energy.toFixed(1) }))));
}
