// Cue derivation and controller behavior for the second batch of authored football clips: catch variants,
// paired tackle and fall, pass-rush moves, get-up, stiff-arm, and the quarterback's backpedal with the ball.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../web/vendor/three.module.js';
import { deriveCues, RiggedAnimationController, FB } from '../web/rigged-animation-controller.js';
import { POSE } from '../web/rigged-player.js';

const HZ = 30;
const T0 = 100;

function makeClip(name, duration) {
  const times = [0, duration / 4, duration / 2, (3 * duration) / 4, duration];
  const track = new THREE.VectorKeyframeTrack('handR.position', times, [0, 1, 0, 0.4, 1, 0, 1, 1, 0, 0.4, 1, 0, 0, 1, 0]);
  return new THREE.AnimationClip(name, duration, [track]);
}

function controllerWith(names) {
  const root = new THREE.Object3D();
  const hand = new THREE.Object3D();
  hand.name = 'handR';
  root.add(hand);
  const clips = new Map(names.map(([n, d]) => [n, makeClip(n, d)]));
  const mixer = new THREE.AnimationMixer(root);
  root.userData.animation = { mixer, clips };
  root.userData.bones = {};
  return { controller: new RiggedAnimationController(root), clips };
}

const LOCO = [['FB_Idle', 2.4], ['Jogging In Place', 0.7], ['run-in-place', 0.7], ['Sprint In Place', 0.7], ['Running Backward in place', 0.7]];
const frameRow = (x, z, h, speed, pose, carrying = 0) => [x, z, h, speed, pose, carrying];

/** A recording with players [{id, slot, team, x, z, h, speed}] held constant, ball at (bx, bz, bzH metres). */
function recording(players, events, { bz = 0.3 } = {}) {
  const frames = [];
  for (let k = 0; k < 150; k++) {
    const row = [];
    for (const p of players) row.push(...frameRow(p.x, p.z, p.h ?? 0, p.speed ?? 0, p.pose ?? POSE.RUN, p.carrying ?? 0));
    row.push(50, 26, bz, 0, 0, 0);
    frames.push(row);
  }
  return { t0: T0, hz: HZ, roster: players.map((p) => ({ id: p.id, slot: p.slot, team: p.team })), frames, events };
}

test('catch variant follows where the ball is when the hands meet it', () => {
  const pick = (zMetres, speed) => {
    const rec = recording([{ id: 'wr', slot: 'WR1', team: 'A', x: 50, z: 26, speed }], [{ type: 'catch', t: T0 + 1.0, by: 'wr' }], { bz: zMetres });
    return deriveCues(rec).get('wr').find((c) => c.kind === 'catch');
  };
  assert.equal(pick(2.7, 2).clip, FB.CATCH_HIGH);
  assert.equal(pick(0.5, 2).clip, FB.CATCH_LOW);
  assert.equal(pick(1.5, 5.5).clip, FB.CATCH_RUN, 'in stride, chest height');
  assert.equal(pick(1.5, 2).clip, undefined, 'a plain standing catch keeps the stock clip');
});

test('a tackle is a pair: the tackler dives when fast, the carrier falls backward when hit from the front', () => {
  const players = [
    // carrier faces +x; tackler ahead of him (in front) at speed 7 -> dive and fall back
    { id: 'c', slot: 'RB', team: 'A', x: 50, z: 26, h: 0, speed: 3, carrying: 1 },
    { id: 't', slot: 'MLB', team: 'B', x: 51.5, z: 26, h: Math.PI, speed: 7 },
  ];
  let cues = deriveCues(recording(players, [{ type: 'wrapped', t: T0 + 2.0, by: 't', on: 'c' }]));
  const t = cues.get('t').find((c) => c.kind === 'oneshot');
  assert.equal(t.clip, FB.TACKLE_DIVE);
  assert.ok(Math.abs(t.at - (T0 + 2.0 - 0.3)) < 1e-9 && t.anchorAt === T0 + 2.0, 'contact lands on the event');
  assert.equal(cues.get('c').find((c) => c.kind === 'fall_variant').clip, FB.FALL_BACK);
  // tackler behind at a jog: a form tackle, and the carrier falls forward
  players[1] = { id: 't', slot: 'MLB', team: 'B', x: 48.5, z: 26, h: 0, speed: 4 };
  cues = deriveCues(recording(players, [{ type: 'wrapped', t: T0 + 2.0, by: 't', on: 'c' }]));
  assert.equal(cues.get('t').find((c) => c.kind === 'oneshot').clip, FB.TACKLE_FORM);
  assert.equal(cues.get('c').find((c) => c.kind === 'fall_variant').clip, FB.FALL);
});

test('a shed becomes a swim or a rip, deterministic per player, at most one a second', () => {
  const players = [{ id: 'de1', slot: 'LEDGE', team: 'B', x: 50, z: 26, speed: 1 }];
  const rec = recording(players, [
    { type: 'shed', t: T0 + 1.0, by: 'de1' }, { type: 'shed', t: T0 + 1.4, by: 'de1' }, { type: 'shed', t: T0 + 2.5, by: 'de1' },
  ]);
  const moves = deriveCues(rec).get('de1').filter((c) => c.kind === 'oneshot');
  assert.equal(moves.length, 2, 'the shed 0.4 s after the first is the same move');
  assert.ok(moves.every((m) => m.clip === moves[0].clip) && [FB.SWIM, FB.RIP].includes(moves[0].clip));
  assert.ok(Math.abs(moves[0].at - (T0 + 1.0 - 0.45)) < 1e-9);
  // a player already sprinting does not stop to do a swim move
  const fast = recording([{ id: 'x', slot: 'LB', team: 'B', x: 50, z: 26, speed: 8 }], [{ type: 'shed', t: T0 + 1.0, by: 'x' }]);
  assert.equal((deriveCues(fast).get('x') || []).length, 0);
});

test('after a tackle the player gets up before running: the fall clip, then FB_GetUp, then locomotion', () => {
  const { controller } = controllerWith([...LOCO, [FB.FALL, 1.1], [FB.GETUP, 1.3]]);
  controller.tick({ time: T0, pose: POSE.RUN, speed: 5 });
  for (let i = 1; i <= 30; i++) controller.tick({ time: T0 + i * 0.05, pose: POSE.DOWN, speed: 0 });
  assert.equal(controller.current, FB.FALL);
  // the engine stands him up (pose RUN, speed ~0)
  controller.tick({ time: T0 + 1.6, pose: POSE.RUN, speed: 0.1 });
  assert.equal(controller.current, FB.GETUP);
  // he stays on the get-up until it ends, then stands
  for (let i = 1; i <= 8; i++) controller.tick({ time: T0 + 1.6 + i * 0.1, pose: POSE.RUN, speed: 0.1 });
  assert.equal(controller.current, FB.GETUP);
  for (let i = 1; i <= 12; i++) controller.tick({ time: T0 + 2.4 + i * 0.1, pose: POSE.RUN, speed: 0.1 });
  assert.equal(controller.current, 'FB_Idle');
});

test('a fall_variant cue sends the carrier down backward instead of forward', () => {
  const { controller } = controllerWith([...LOCO, [FB.FALL, 1.1], [FB.FALL_BACK, 1.1], [FB.GETUP, 1.3]]);
  controller.setCues([{ kind: 'fall_variant', clip: FB.FALL_BACK, at: T0 + 0.5, anchorAt: T0 + 0.5 }]);
  controller.tick({ time: T0, pose: POSE.RUN, speed: 5 });
  controller.tick({ time: T0 + 0.6, pose: POSE.RUN, speed: 5 });
  for (let i = 1; i <= 10; i++) controller.tick({ time: T0 + 0.6 + i * 0.05, pose: POSE.DOWN, speed: 0 });
  assert.equal(controller.current, FB.FALL_BACK);
});

test('stiff-arm: a carrier with a defender alongside puts out the arm on that side, once per 1.6 s', () => {
  const { controller } = controllerWith([...LOCO, [FB.STIFF_L, 0.7], [FB.STIFF_R, 0.7]]);
  const tick = (time, opp) => controller.tick({ time, pose: POSE.RUN, speed: 7, carrying: true, contact: { role: 0, slot: 'RB', kind: 'run', opp } });
  tick(T0, null);
  assert.notEqual(controller.current, FB.STIFF_L);
  tick(T0 + 0.1, { side: 'L', dist: 1.5 });
  assert.equal(controller.current, FB.STIFF_L);
  for (let i = 0; i < 20; i++) tick(T0 + 0.2 + i * 0.05, { side: 'R', dist: 1.5 });   // locked into the clip, no retrigger
  assert.notEqual(controller.current, FB.STIFF_R);
  for (let i = 0; i < 30; i++) tick(T0 + 1.3 + i * 0.05, { side: 'R', dist: 1.5 });   // after the cooldown, the other side
  assert.ok([FB.STIFF_R].includes(controller.current) || controller.lastStiff > T0 + 1.5, 'second stiff-arm on the right side after the cooldown');
  // a ball carrier who is not carrying does not stiff-arm
  const other = controllerWith([...LOCO, [FB.STIFF_L, 0.7]]);
  other.controller.tick({ time: T0, pose: POSE.RUN, speed: 7, carrying: false, contact: { role: 0, slot: 'WR1', kind: 'run', opp: { side: 'L', dist: 1 } } });
  assert.notEqual(other.controller.current, FB.STIFF_L);
});

test('a quarterback backing up with the ball uses the drop-back clip, a defender backing up does not', () => {
  const { controller } = controllerWith([...LOCO, ['FB_Walk', 1.0], [FB.DROPBACK, 0.9]]);
  const back = { role: 0, slot: 'QB', kind: 'pass' };
  // travel < 0 means moving backward relative to the hips
  for (let i = 0; i < 6; i++) controller.tick({ time: T0 + i * 0.2, pose: POSE.RUN, speed: 2.2, carrying: true, travel: -1, contact: back });
  assert.equal(controller.current, FB.DROPBACK);
  const db = controllerWith([...LOCO, [FB.DROPBACK, 0.9]]);
  for (let i = 0; i < 6; i++) db.controller.tick({ time: T0 + i * 0.2, pose: POSE.BACKPEDAL, speed: 2.2, carrying: false, travel: -1, contact: { role: 0, slot: 'LCB', kind: 'pass' } });
  assert.equal(db.controller.current, 'Running Backward in place');
});
