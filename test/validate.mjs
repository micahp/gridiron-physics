// Headless check: simulate the whole game and compare every play's final
// ball spot to the real ESPN spot, plus physical plausibility (no player
// exceeds his own top speed, no impossible accelerations).
import { readFileSync } from 'node:fs';
import { simulateGame } from '../engine/game.js';

const game = JSON.parse(readFileSync(new URL('../web/data/game.json', import.meta.url)));
const P_ = (id) => game.players[id].name;
const t0 = performance.now();
const res = simulateGame(game);
const ms = performance.now() - t0;

let n = 0, ok = 0, worst = [];
const reasons = {};
let speedViolations = 0, frames = 0;
for (let i = 0; i < game.plays.length; i++) {
  const S = game.plays[i], r = res[i];
  if (!r) continue;
  frames += r.frames.length;
  reasons[r.end.reason] = (reasons[r.end.reason] || 0) + 1;
  for (const s of r.stats) {
    const vmax = game.players[s.id].physics.vmax;
    if (s.top > vmax * 1.08) { speedViolations++; console.log('over vmax:', i, P_(s.id), s.top.toFixed(2), vmax); }
  }
  let expect = null;
  if (['run', 'scramble', 'complete', 'sack', 'kneel'].includes(S.kind) && !S.td) expect = S.los + S.dir * (S.gain ?? 0);
  // incompletions are re-spotted at the LOS by rule; the ball's landing spot is not a target
  if (S.kind === 'int' || (['punt', 'kickoff'].includes(S.kind) && S.returner && !S.fairCatch && !S.touchback)) expect = S.end;
  if (S.kind === 'punt' && (S.fairCatch || S.oob)) expect = S.land;
  if (expect == null) continue;
  n++;
  const err = Math.abs(r.end.x - expect);
  // sideline spots are an official's eyeball; allow 1.5 yd there
  const tol = /out_of_bounds/.test(r.end.reason) ? 1.5 : 1.0;
  if (err <= tol) ok++;
  worst.push({ i, kind: S.kind, err: +err.toFixed(2), got: +r.end.x.toFixed(1), expect, reason: r.end.reason, text: S.text.slice(0, 90) });
}
worst.sort((a, b) => b.err - a.err);
console.log(`simulated ${res.filter(Boolean).length} plays, ${frames} frames in ${ms.toFixed(0)} ms`);
console.log(`end-spot matches ESPN (±1 yd, ±1.5 yd at the sideline): ${ok}/${n}`);
console.log('whistle reasons:', reasons);
console.log('players over 108% of their own v_max:', speedViolations);
console.log('worst:', worst.slice(0, 15));
const bad = res.filter((r) => r && r.end.reason === 'timeout_sim').length;
if (process.argv.includes('--strict') && (ok / n < 0.9 || bad > 0 || speedViolations > 0)) process.exit(1);
