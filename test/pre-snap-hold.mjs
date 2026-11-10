// Nobody may run an assignment before the snap: standing still pre-snap is what lets a stance read as a stance.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { simulatePlay } from '../engine/play.js';
import { createDemoScenario } from '../web/prototype-model.js';

const snapshot = JSON.parse(readFileSync(new URL('../data/teams/matchup-2026-10-22.json', import.meta.url)));
const playbooks = Object.fromEntries(['NE', 'CHI'].map((id) => [id, JSON.parse(readFileSync(new URL(`../data/playbooks/${id}-2025.json`, import.meta.url)))]));
const scenario = (kind, seed) => {
  const c = playbooks.NE.offense.play_candidates[kind].candidates[0];
  return createDemoScenario({ offenseId: 'NE', defenseId: 'CHI', teams: snapshot.teams, playbooks, kind,
    formation: c.attributes.formation, candidateId: c.candidate_id, seed, los: 45, dir: 1 });
};
for (const kind of ['run', 'pass']) {
  for (const seed of ['a', 'b', 'c']) {
    const s = scenario(kind, seed);
    const rec = simulatePlay({ players: s.players }, s.play);
    const n = rec.roster.length;
    let worst = 0;
    for (let k = 0; k < rec.frames.length && rec.t0 + k / rec.hz < -1e-6; k++) {
      for (let i = 0; i < n; i++) worst = Math.max(worst, rec.frames[k][i * 6 + 3]);
    }
    assert.ok(worst < 0.2, `${kind}/${seed}: a player moved at ${worst.toFixed(2)} m/s before the snap`);
    const early = rec.events.filter((e) => e.t < -1e-6 && ['hit', 'tackle', 'shed'].includes(e.type));
    assert.equal(early.length, 0, `${kind}/${seed}: contact before the snap: ${early.map((e) => e.type)}`);
    assert.notEqual(rec.end.reason, 'timeout_sim');
    // opting out restores the old behaviour (used to prove the hold is what changed)
    const o = scenario(kind, seed);
    const old = simulatePlay({ players: o.players }, o.play, { holdPreSnap: false });
    let oldWorst = 0;
    for (let k = 0; k < old.frames.length && old.t0 + k / old.hz < -1e-6; k++) for (let i = 0; i < n; i++) oldWorst = Math.max(oldWorst, old.frames[k][i * 6 + 3]);
    assert.ok(oldWorst > 1, 'holdPreSnap:false should still show the old pre-snap running start');
  }
}
console.log('pre-snap hold ok');
