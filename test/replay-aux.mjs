// The aux side channel must be additive: same frames as before, plus per-player
// velocity / height / contact role / partner for renderers.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { simulatePlay } from '../engine/play.js';
import { createDemoScenario } from '../web/prototype-model.js';

const snapshot = JSON.parse(readFileSync(new URL('../data/teams/matchup-2026-10-22.json', import.meta.url)));
const playbooks = Object.fromEntries(['NE', 'CHI'].map((id) => [id,
  JSON.parse(readFileSync(new URL(`../data/playbooks/${id}-2025.json`, import.meta.url)))]));
let sawEngaged = false, sawWrap = false;
for (const kind of ['run', 'pass']) {
  const cand = playbooks.NE.offense.play_candidates[kind].candidates[0];
  const s = createDemoScenario({ offenseId: 'NE', defenseId: 'CHI', teams: snapshot.teams, playbooks, kind,
    formation: cand.attributes.formation, candidateId: cand.candidate_id, seed: 'repeatable-demo', los: 45, dir: 1 });
  const rec = simulatePlay({ players: s.players }, s.play);
  const n = rec.roster.length;
  assert.equal(rec.stride, n * 6 + 6, 'frame stride is unchanged');
  assert.equal(rec.auxStride, 5);
  assert.equal(rec.aux.length, rec.frames.length, 'one aux row per frame');
  for (let k = 0; k < rec.frames.length; k++) {
    const a = rec.aux[k], f = rec.frames[k];
    assert.equal(a.length, n * 5);
    for (let i = 0; i < n; i++) {
      const vx = a[i * 5], vy = a[i * 5 + 1], role = a[i * 5 + 3], partner = a[i * 5 + 4];
      // recorded speed must agree with the recorded velocity vector
      assert.ok(Math.abs(Math.hypot(vx, vy) - f[i * 6 + 3]) < 1e-3);
      assert.ok(role >= 0 && role <= 3);
      if (role === 0) assert.equal(partner, -1);
      else {
        assert.ok(partner >= 0 && partner < n && partner !== i);
        if (role === 1) { sawEngaged = true; assert.equal(a[partner * 5 + 4], i, 'engagements are mutual'); }
        if (role === 2) { sawWrap = true; assert.equal(a[partner * 5 + 3], 3); }
      }
    }
  }
}
assert.ok(sawEngaged, 'a run/pass play records at least one block engagement');
console.log(`replay aux ok (engaged=${sawEngaged}, wrap=${sawWrap})`);
