import assert from 'node:assert/strict';
import { exampleAssignments } from '../engine/autonomous/example-assignments.js';
import { validateAssignments } from '../engine/autonomous/assignments.js';
import { simulatePassPlay } from '../engine/autonomous/passing.js';
import { World } from '../engine/world.js';
import { YD, FIELD_W_YD } from '../engine/constants.js';
import { simulateAutonomousPlay } from '../engine/autonomous/simulator.js';
import { buildSampleCall } from './autonomous-fixtures.mjs';

function play(order) {
  const assignments = exampleAssignments('slant_flat', 'man');
  assignments.offense.QB.read_order = order;
  return simulatePassPlay({ seed: 1, concept: 'assigned', assignments, front: 'nickel_over',
    coverage: 'cover_1', direction: 'right', resultOnly: true });
}
const first = play(['WR2', 'WR3', 'WR1', 'RB']);
const second = play(['WR3', 'WR2', 'WR1', 'RB']);
const firstDecision = (result) => result.events.find((event) => ['qb_read', 'throw'].includes(event.type));
assert.equal(firstDecision(first).target_id, 'O.WR2');
assert.equal(firstDecision(second).target_id, 'O.WR3');
assert.ok(second.events.some((event) => event.type === 'throw' && event.target_id === 'O.WR3'),
  'an available short route can be the first throw');
const invalid = exampleAssignments('slant_flat', 'man');
invalid.offense.QB.read_order = ['WR2', 'WR2'];
assert.throws(() => validateAssignments(invalid, { executable: true }), /read order/);
for (const mode of ['legacy_sequential', 'shared_snapshot']) {
  const step = World.prototype.step;
  let injected = false;
  World.prototype.step = function (dt, brains, afterBrains) {
    if (!injected && this.t >= 0.25) {
      const qb = this.players.find((p) => p.roleKey === 'O.QB');
      for (const defender of this.players.filter((p) => p.team === 'D')) {
        defender.p.x = qb.p.x + 20;
      }
      qb.ai.escape = { x: -1, y: 0 };
      qb.ai.quarterbackState = 'escape';
      injected = true;
    }
    return step.call(this, dt, brains, afterBrains);
  };
  try {
    const assignments = exampleAssignments('slant_flat', 'zone');
    const result = simulatePassPlay({ seed: 'escape-clear', concept: 'assigned', assignments,
      front: 'nickel_over', coverage: 'cover_3', direction: 'right', resultOnly: true,
      playerEvaluationMode: mode });
    assert.ok(injected && result.events.some((event) => event.type === 'quarterback_state'
      && event.state === 'read' && event.reason === 'pressure_cleared'), `${mode}: escape returns to reading`);
  } finally { World.prototype.step = step; }
}
for (const initialLateral of [0, 6]) {
  const step = World.prototype.step;
  const event = World.prototype.event;
  let prepared = false;
  let releaseLateral = null;
  World.prototype.event = function (type, data) {
    if (type === 'throw_away') {
      const qb = this.players.find((p) => p.roleKey === 'O.QB');
      releaseLateral = Math.abs(qb.p.y / YD - 26.67);
    }
    return event.call(this, type, data);
  };
  World.prototype.step = function (dt, brains, afterBrains) {
    if (!prepared && this.t >= 0.3) {
      const qb = this.players.find((p) => p.roleKey === 'O.QB');
      for (const defender of this.players.filter((p) => p.team === 'D')) defender.down = true;
      for (const receiver of this.players.filter((p) => p.team === 'O'
        && ['TE', 'WR1', 'WR2', 'WR3'].includes(p.slot))) receiver.down = true;
      qb.p.y = (26.67 + initialLateral) * YD;
      qb.ai.nextDecision = this.t;
      prepared = true;
    }
    return step.call(this, dt, brains, afterBrains);
  };
  try {
    const assignments = exampleAssignments('slant_flat', 'zone');
    const result = simulatePassPlay({ seed: `throwaway-${initialLateral}`, concept: 'assigned', assignments,
      front: 'nickel_over', coverage: 'cover_3', direction: 'right', resultOnly: true });
    assert.ok(prepared);
    const throwaway = result.events.find((event) => event.type === 'throw_away');
    if (initialLateral === 0) {
      assert.ok(result.events.some((event) => event.type === 'quarterback_state'
        && event.state === 'escape' && event.reason === 'throwaway_not_legal_from_pocket'));
      assert.ok(throwaway, 'QB eventually escapes the pocket before throwing the ball away');
    } else {
      assert.ok(throwaway, 'outside-pocket QB can throw the ball away');
    }
    assert.ok(releaseLateral > 5,
      'throwaway is released only after the QB leaves the tackle box');
    assert.ok(throwaway.t >= 3, 'throwaway follows the read progression timeout');
  } finally { World.prototype.step = step; World.prototype.event = event; }
}
{
  const step = World.prototype.step;
  let injected = false;
  World.prototype.step = function (dt, brains, afterBrains) {
    if (!injected && this.t >= 0.4) {
      const qb = this.players.find((p) => p.roleKey === 'O.QB');
      for (const defender of this.players.filter((p) => p.team === 'D')) defender.down = true;
      qb.p.x = 35 * YD + 0.25;
      qb.p.y = (FIELD_W_YD - 0.05) * YD;
      qb.v = { x: 2, y: 7 };
      qb.ai.nextDecision = this.t + 2;
      injected = true;
    }
    return step.call(this, dt, brains, afterBrains);
  };
  try {
    const call = buildSampleCall({ family: 'pass', concept: 'assigned', snap_type: 'shotgun', coverage: 'cover_3' });
    call.situation.yardline_100 = 35;
    call.assignments = exampleAssignments('slant_flat', 'zone');
    const result = simulateAutonomousPlay(call);
    assert.ok(injected && result.events.some((event) => event.type === 'quarterback_state'
      && event.state === 'carry' && event.reason === 'crossed_line'));
    assert.equal(result.status, 'complete');
    assert.equal(result.result.carrier_id, call.offense.lineup.QB);
    assert.ok(!result.events.some((event) => event.type === 'throw' || event.type === 'throw_away'));
    assert.equal(result.diagnostics.reconciliation.ok, true);
  } finally { World.prototype.step = step; }
}
console.log('play-specific quarterback progression passed');
