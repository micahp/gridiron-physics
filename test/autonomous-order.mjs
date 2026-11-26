import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { World } from '../engine/world.js';
import { simulatePassPlay } from '../engine/autonomous/passing.js';

const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const stateHash = (world) => {
  const state = {
    time: world.t,
    ball: { state: world.ball.state, holder: world.ball.holder?.id ?? null,
      x: world.ball.x, y: world.ball.y, z: world.ball.z, vx: world.ball.vx, vy: world.ball.vy,
      vz: world.ball.vz, target: world.ball.target?.id ?? null },
    players: world.players.map((p) => ({ id: p.id, x: p.p.x, y: p.p.y, vx: p.v.x, vy: p.v.y,
      dv: p.dv, ext: p.ext, heading: p.h, face: p.face, speed: p.speed, pose: p.pose,
      down: p.down, hasBall: p.hasBall, engaged: p.engaged?.id ?? null,
      assignment: p.ai.assignment ?? null, decision: p.ai.decision ?? null,
      nextDecision: p.ai.nextDecision ?? null, lastPhase: p.ai.lastPhase ?? null,
      escape: p.ai.escape ?? null, targetId: p.ai.targetId ?? null,
      blockOn: p.ai.blockOn?.id ?? null, routeIndex: p.ai.routeIndex ?? null }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    engagements: world.engagements.map((e) => [e.a.id, e.b.id].sort())
      .sort((a, b) => a.join(':').localeCompare(b.join(':'))),
    wraps: world.wraps.map((w) => ({ tackler: w.tackler.id, carrier: w.carrier.id,
      t0: w.t0, fall: w.fall, done: w.done }))
      .sort((a, b) => `${a.tackler}:${a.carrier}`.localeCompare(`${b.tackler}:${b.carrier}`)),
  };
  return createHash('sha256').update(canonical(state)).digest('hex');
};

const base = { seed: 'same-tick-qb-sack-order', front: 'nickel_over', coverage: 'cover_1',
  direction: 'right', resultOnly: true, playerEvaluationMode: 'shared_snapshot' };
const reference = simulatePassPlay(base);
const throwEvent = reference.events.find((event) => event.type === 'throw');
assert.ok(throwEvent, 'reference play has a QB release tick');

function runWithOrder(reverseAtRelease) {
  const originalStep = World.prototype.step;
  let injection = null;
  let injected = false;
  World.prototype.step = function (dt, brains, afterBrains) {
    const atReleaseTick = Math.abs(this.t - throwEvent.t) < dt * 0.51;
    if (!injected && atReleaseTick) {
      const qb = this.players.find((player) => player.slot === 'QB' && player.team === 'O');
      const rusher = this.players.find((player) => player.slot === 'LEDGE' && player.team === 'D');
      assert.ok(qb && rusher, 'QB and edge rusher exist');
      assert.equal(this.ball.holder, qb, 'ball is held by QB at the intervention tick');
      for (const engagement of [...this.engagements]) {
        if (engagement.a === rusher || engagement.b === rusher) this.disengage(engagement);
      }
      const reach = qb.r + rusher.r + 0.1;
      rusher.p.x = qb.p.x - reach;
      rusher.p.y = qb.p.y;
      rusher.v.x = 0;
      rusher.v.y = 0;
      rusher.shedCD = 1;
      qb.R.CAR = 1e9;
      qb.ai.nextDecision = this.t;
      rusher.ai.nextDecision = this.t;
      injection = { time: this.t, reach_meters: reach, qb_x: qb.p.x, qb_y: qb.p.y,
        rusher_x: rusher.p.x, rusher_y: rusher.p.y };
      injected = true;
    }

    if (!reverseAtRelease || !atReleaseTick) {
      return originalStep.call(this, dt, brains, afterBrains);
    }
    const pending = [];
    const expected = this.players.length;
    return originalStep.call(this, dt, (player) => {
      pending.push(player);
      if (pending.length === expected) {
        for (const candidate of pending.reverse()) brains(candidate);
      }
    }, afterBrains);
  };

  try {
    const result = simulatePassPlay(base);
    assert.ok(injected, 'the deterministic intervention tick was reached');
    return { result, injection };
  } finally {
    World.prototype.step = originalStep;
  }
}

const qbFirst = runWithOrder(false);
const rusherFirst = runWithOrder(true);
const rusherFirstReplay = runWithOrder(true);
assert.deepEqual(qbFirst.injection, rusherFirst.injection,
  'both orders receive identical same-tick player geometry');
assert.equal(qbFirst.result.terminal.reason, 'sack',
  'same-tick unblocked contact interrupts the staged QB release');
assert.equal(rusherFirst.result.terminal.reason, 'sack',
  'reversing callbacks does not change sack arbitration');
assert.equal(qbFirst.result.terminal.time, rusherFirst.result.terminal.time);
assert.deepEqual(rusherFirst.result.events, rusherFirstReplay.result.events,
  'reversed callback replay is deterministic');

function runNaturalOrder(reverse, scenario = base) {
  const originalStep = World.prototype.step;
  const ticks = [];
  World.prototype.step = function (dt, brains, afterBrains) {
    const pre = stateHash(this);
    let count = 0;
    let postBrains = null;
    const apply = (player) => {
      brains(player);
      count += 1;
      if (count === this.players.length) postBrains = stateHash(this);
    };
    let result;
    if (reverse) {
      const pending = [];
      result = originalStep.call(this, dt, (player) => {
        pending.push(player);
        if (pending.length === this.players.length) {
          for (const candidate of pending.reverse()) apply(candidate);
        }
      }, () => {
        if (postBrains == null) postBrains = stateHash(this);
        afterBrains?.();
      });
    } else {
      result = originalStep.call(this, dt, apply, () => {
        if (postBrains == null) postBrains = stateHash(this);
        afterBrains?.();
      });
    }
    ticks.push({ pre, postBrains, postStep: stateHash(this) });
    return result;
  };
  try {
    return { result: simulatePassPlay(scenario), ticks };
  } finally {
    World.prototype.step = originalStep;
  }
}

let naturalTicks = 0;
for (let seed = 1; seed <= 5; seed += 1) {
  const scenario = { seed, front: seed % 2 ? 'nickel_over' : 'nickel_under',
    coverage: seed % 3 ? 'cover_1' : 'cover_3', direction: seed % 2 ? 'left' : 'right',
    dir: seed % 4 < 2 ? 1 : -1, los: 20 + (seed * 13) % 60,
    ballY: [23.583, 26.667, 29.75][seed % 3], resultOnly: true,
    playerEvaluationMode: 'shared_snapshot' };
  const naturalForward = runNaturalOrder(false, scenario);
  const naturalReverse = runNaturalOrder(true, scenario);
  assert.deepEqual(naturalForward.ticks, naturalReverse.ticks,
    `player state and movement match every tick for seed ${seed} under reversed callback order`);
  assert.equal(canonical(naturalForward.result.terminal), canonical(naturalReverse.result.terminal),
    `terminal outcome is callback-order independent for seed ${seed}`);
  assert.deepEqual(naturalForward.result.events.map(canonical), naturalReverse.result.events.map(canonical),
    `event rows are deterministically ordered for seed ${seed}`);
  naturalTicks += naturalForward.ticks.length;
}

const fumbleOffense = Object.fromEntries(['QB', 'RB', 'TE', 'WR1', 'WR2', 'WR3']
  .map((slot) => [`O.${slot}`, { CAR: 1 }]));
const fumbleDefense = Object.fromEntries(['LDE', 'LDT', 'RDT', 'RDE', 'WILL', 'MIKE',
  'LCB', 'RCB', 'NB', 'SS', 'FS'].map((slot) => [`D.${slot}`, { TAK: 99, STR: 99, PRC: 99 }]));
const fumbleScenario = { seed: 31, front: 'nickel', coverage: 'cover_1', direction: 'right',
  dir: 1, los: 40, ballY: 26.67, resultOnly: true, playerEvaluationMode: 'shared_snapshot',
  ratingOverrides: { ...fumbleOffense, ...fumbleDefense } };
const fumbleForward = runNaturalOrder(false, fumbleScenario);
const fumbleReverse = runNaturalOrder(true, fumbleScenario);
assert.deepEqual(fumbleForward.ticks, fumbleReverse.ticks,
  'loose-ball pursuit, recovery, and return remain order-independent');
assert.equal(canonical(fumbleForward.result.fumble), canonical(fumbleReverse.result.fumble),
  'fumble recovery and return facts remain identical under reversed callback order');
assert.deepEqual(fumbleForward.result.events.map(canonical), fumbleReverse.result.events.map(canonical),
  'fumble sequence event rows remain identically ordered');
naturalTicks += fumbleForward.ticks.length;

console.log(`autonomous callback-order arbitration ok: injected sack at ${qbFirst.result.terminal.time.toFixed(3)}s; pass/fumble state matched over 6 plays and ${naturalTicks} ticks`);
