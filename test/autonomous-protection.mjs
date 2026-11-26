import assert from 'node:assert/strict';
import { World } from '../engine/world.js';
import { simulatePassPlay } from '../engine/autonomous/passing.js';
import { exampleAssignments } from '../engine/autonomous/example-assignments.js';

function playWithBlitzer(mode) {
  const step = World.prototype.step;
  const engage = World.prototype.engage;
  let injected = false;
  const contacts = [];
  World.prototype.step = function (dt, brains, afterBrains) {
    if (!injected && this.t >= 0.25) {
      const qb = this.players.find((p) => p.roleKey === 'O.QB');
      const back = this.players.find((p) => p.roleKey === 'O.RB');
      const blitzer = this.players.find((p) => p.roleKey === 'D.MLB');
      for (const pair of [...this.engagements]) this.disengage(pair);
      for (const defender of this.players.filter((p) => p.team === 'D' && p !== blitzer)) {
        defender.p.x = qb.p.x + 10;
        defender.p.y = Math.max(2, defender.p.y);
      }
      blitzer.p.x = qb.p.x + 1.4;
      blitzer.p.y = qb.p.y + 0.8;
      blitzer.v.x = -2;
      back.p.x = blitzer.p.x - 0.5;
      back.p.y = blitzer.p.y;
      back.ai.nextDecision = this.t;
      blitzer.ai.nextDecision = this.t;
      injected = true;
    }
    return step.call(this, dt, brains, afterBrains);
  };
  World.prototype.engage = function (a, b) {
    if ([a.roleKey, b.roleKey].includes('O.RB') && [a.roleKey, b.roleKey].includes('D.MLB')) contacts.push(this.t);
    return engage.call(this, a, b);
  };
  try {
    const assignments = exampleAssignments('slant_flat', 'man');
    assignments.defense.MLB = { kind: 'rush' };
    return { result: simulatePassPlay({ seed: 'protection', concept: 'assigned', assignments,
      front: 'nickel_over', coverage: 'cover_1', direction: 'right', resultOnly: true,
      playerEvaluationMode: mode }), contacts, injected };
  } finally {
    World.prototype.step = step;
    World.prototype.engage = engage;
  }
}
for (const mode of ['legacy_sequential', 'shared_snapshot']) {
  const { result, contacts, injected } = playWithBlitzer(mode);
  assert.ok(injected && contacts.length, `${mode}: check-release back picks up advancing linebacker`);
  const release = result.events.find((e) => e.type === 'protection_release' && e.role === 'O.RB');
  assert.ok(!release || release.t > contacts[0], `${mode}: back does not release before the threat`);
}
const containAssignments = exampleAssignments('slant_flat', 'zone');
const directAssignments = structuredClone(containAssignments);
directAssignments.defense.LEDGE.rush_lane = 'direct';
function rushPlay(assignments) {
  return simulatePassPlay({ seed: 'edge', concept: 'assigned', assignments, front: 'nickel_over',
    coverage: 'cover_3', direction: 'right' });
}
const contain = rushPlay(containAssignments);
const direct = rushPlay(directAssignments);
assert.ok(contain.events.some((event) => event.type === 'decision' && event.role === 'D.LEDGE'
  && event.assignment === 'contain the passer'), 'outside edge enters contain');
assert.ok(!direct.events.some((event) => event.type === 'decision' && event.role === 'D.LEDGE'
  && event.assignment === 'contain the passer'), 'direct rush does not use contain');
const edgeId = contain.roster.find((player) => player.roleKey === 'D.LEDGE').id;
assert.notDeepEqual(contain.trajectories[edgeId], direct.trajectories[edgeId],
  'declared edge responsibility changes live movement');
function tackleTarget(mode) {
  const step = World.prototype.step;
  let captured = null;
  World.prototype.step = function (dt, brains, afterBrains) {
    if (captured === null && this.t >= 0.25) {
      for (const pair of [...this.engagements]) this.disengage(pair);
      const tackle = this.players.find((p) => p.roleKey === 'O.LT');
      const edge = this.players.find((p) => p.roleKey === 'D.LEDGE');
      const far = this.players.find((p) => p.roleKey === 'D.REDGE');
      const qb = this.players.find((p) => p.roleKey === 'O.QB');
      for (const defender of this.players.filter((p) => p.team === 'D')) defender.down = true;
      edge.down = far.down = false;
      edge.p = { x: tackle.p.x + 1, y: tackle.p.y + 1 };
      far.p = { x: qb.p.x + 0.5, y: qb.p.y - 1.5 };
      tackle.ai.nextDecision = this.t;
      tackle.ai.nextTargetAt = 0;
      tackle.ai.blockOn = null;
      const value = step.call(this, dt, brains, afterBrains);
      captured = tackle.ai.blockOn?.roleKey ?? 'none';
      return value;
    }
    return step.call(this, dt, brains, afterBrains);
  };
  try {
    simulatePassPlay({ seed: 'protection-area', concept: 'assigned',
      assignments: exampleAssignments('slant_flat', 'zone'), front: 'nickel_over',
      coverage: 'cover_3', direction: 'right', resultOnly: true, playerEvaluationMode: mode });
    return captured;
  } finally { World.prototype.step = step; }
}
for (const mode of ['legacy_sequential', 'shared_snapshot']) {
  assert.equal(tackleTarget(mode), 'D.LEDGE', `${mode}: left tackle retains its protection area`);
}
console.log('check-release blitz pickup passed in both evaluation modes');
