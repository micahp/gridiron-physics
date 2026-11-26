import assert from 'node:assert/strict';
import { World } from '../engine/world.js';
import { simulateAutonomousSpecialTeams } from '../engine/autonomous/special-teams.js';

const ids = ['K', ...Array.from({ length: 10 }, (_, i) => `C${i}`), 'R',
  ...Array.from({ length: 10 }, (_, i) => `B${i}`)];
function call(kind, seed) {
  return { schema_version: 'gridiron.autonomous-special-teams.v1', kind, seed,
    kicking_team: 'A', receiving_team: 'B', yardline_100: kind === 'punt' ? 45 : 65,
    player_evaluation_mode: 'shared_snapshot',
    lineups: { kicking: { [kind === 'punt' ? 'punter' : 'kicker']: 'K', coverage: ids.slice(1, 11) },
      receiving: { returner: 'R', blockers: ids.slice(12) } },
    player_profiles: Object.fromEntries(ids.map((id) => [id, { ratings: { SPD: 76, ACC: 75,
      AGI: 75, STR: 68, AWR: 70, PUR: 75, TAK: 70, BSH: 70, RBK: 70, IBL: 70,
      CTH: 78, CAR: 78, BCV: 75, ELU: 75, TRK: 65, PRC: 70, KPW: 70, KAC: 70 } }])) };
}
const original = World.prototype.step;
for (const kind of ['punt', 'kickoff']) for (const seed of [0, 2, 29]) {
  const input = call(kind, seed);
  const normal = simulateAutonomousSpecialTeams(input);
  World.prototype.step = function (dt, brain, afterBrains) {
    const pending = [];
    return original.call(this, dt, (player) => {
      pending.push(player);
      if (pending.length === this.players.length) for (const candidate of pending.reverse()) brain(candidate);
    }, afterBrains);
  };
  try {
    const reversed = simulateAutonomousSpecialTeams(input);
    assert.deepEqual(reversed.result, normal.result, `${kind} ${seed}: result`);
    assert.deepEqual(reversed.events, normal.events, `${kind} ${seed}: events`);
    assert.equal(reversed.diagnostics.player_evaluation_mode, 'shared_snapshot');
  } finally { World.prototype.step = original; }
}
console.log('punt and kickoff callback order passed');
