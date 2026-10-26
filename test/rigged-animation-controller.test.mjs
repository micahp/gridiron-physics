// Unit tests for the football-aware animation controller.
//
// These build a two-node rig and real AnimationClips so the mixer is the actual
// three.js mixer; nothing here needs a browser or the 15 MB player asset.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../web/vendor/three.module.js';
import { deriveCues, RiggedAnimationController, measureAnchor } from '../web/rigged-animation-controller.js';
import { POSE } from '../web/rigged-player.js';

const HZ = 30;
const T0 = 100; // arbitrary absolute playback origin, like a real rec.t0

/** A root with a single bone that can be animated by a clip. */
function makeRig() {
  const root = new THREE.Object3D();
  root.name = 'player';
  const hand = new THREE.Object3D();
  hand.name = 'handR';
  hand.position.set(0, 1, 0);
  root.add(hand);
  return { root, hand };
}

/** Clip whose hand travels forward and back, peaking at the halfway point. */
function makeClip(name, duration = 1) {
  const times = [0, 0.25, 0.5, 0.75, 1];
  const x = [0, 0.4, 1.0, 0.4, 0];
  const track = new THREE.VectorKeyframeTrack('handR.position', times, [0, 1, 0, 0.4, 1, 0, 1, 1, 0, 0.4, 1, 0, 0, 1, 0]);
  return new THREE.AnimationClip(name, duration, [track]);
}

function makeController() {
  const { root } = makeRig();
  const clips = new Map([
    ['Quarterback Pass', makeClip('Quarterback Pass', 1)],
    ['Football Catch 1', makeClip('Football Catch 1', 0.8)],
    ['Running in place', makeClip('Running in place', 0.7)],
    ['Football Stance', makeClip('Football Stance', 1.2)],
    ['Stunned (Knocked Down)', makeClip('Stunned (Knocked Down)', 0.9)],
  ]);
  const mixer = new THREE.AnimationMixer(root);
  root.userData.animation = { mixer, clips };
  root.userData.bones = {};
  const controller = new RiggedAnimationController(root);
  return { controller, root, clips, mixer };
}

/** Frame row layout the renderer uses: [x, z, heading, speed, pose, carrying]. */
function frame(x, z, speed, pose, carrying = 0) {
  return [x, z, 0, speed, pose, carrying];
}

test('deriveCues anchors the throw to the frame the ball leaves the hand', () => {
  const n = 1;
  const frames = [];
  // 0.0-0.9 s stance, 1.0 s throw code, ball leaves the ground at 1.333 s
  for (let k = 0; k < 60; k++) {
    const t = k / HZ;
    const pose = t < 1.0 ? POSE.STANCE : POSE.THROW;
    const ballY = t >= 1.333 ? 3 : 0.4;
    frames.push([...frame(50, 26, 0, pose), 50, 26, ballY * 0.9144, 0, 0, 0]);
  }
  const rec = { t0: T0, hz: HZ, roster: [{ id: 'qb' }], frames };
  const cues = deriveCues(rec).get('qb');
  assert.equal(cues.length, 1);
  assert.equal(cues[0].kind, 'throw');
  assert.ok(Math.abs(cues[0].at - (T0 + 1.0)) < 1e-6, `throw code at ${cues[0].at}`);
  assert.ok(Math.abs(cues[0].anchorAt - (T0 + 1.333)) < 0.04, `release at ${cues[0].anchorAt}`);
});

test('deriveCues falls back to a synthetic anchor when the ball never leaves the hand', () => {
  const frames = [];
  for (let k = 0; k < 45; k++) {
    const pose = k / HZ < 1.0 ? POSE.STANCE : POSE.THROW;
    frames.push([...frame(50, 26, 0, pose), 50, 26, 0.4 * 0.9144, 0, 0, 0]);
  }
  const rec = { t0: T0, hz: HZ, roster: [{ id: 'qb' }], frames };
  const cues = deriveCues(rec).get('qb');
  assert.equal(cues[0].kind, 'throw');
  assert.ok(cues[0].anchorAt > cues[0].at, 'anchor sits after the code change');
});

test('measureAnchor finds the most extended frame of a clip', () => {
  const { root, clips } = makeController();
  const u = measureAnchor(clips, 'Quarterback Pass', { bone: 'handR', mode: 'forward' }, root);
  assert.ok(Math.abs(u - 0.5) < 0.06, `anchor at ${u}, expected the 0.5 peak`);
});

test('a paused replay does not advance the mixer', () => {
  const { controller } = makeController();
  controller.tick({ time: T0, pose: POSE.RUN, speed: 5 });
  const before = controller.action.time;
  for (let i = 0; i < 5; i++) controller.tick({ time: T0, pose: POSE.RUN, speed: 5 });
  assert.equal(controller.action.time, before, 'mixer must freeze while playback time is frozen');
});

test('the mixer follows playback speed instead of frame rate', () => {
  const { controller } = makeController();
  controller.tick({ time: T0, pose: POSE.RUN, speed: 5 });
  controller.tick({ time: T0 + 0.5, pose: POSE.RUN, speed: 5 });
  const half = controller.action.time;
  assert.ok(Math.abs(half - 0.5 * controller.action.getEffectiveTimeScale()) < 0.05,
    `0.5 s of playback advanced the clip ${half}s`);
});

test('a cue that is already late seeks into the clip instead of restarting it', () => {
  const { controller } = makeController();
  const cues = [{ kind: 'throw', at: T0 + 1.0, anchorAt: T0 + 1.3 }];
  controller.setCues(cues);
  controller.tick({ time: T0, pose: POSE.THROW, speed: 0 });
  // arrive after the release frame: the clip must be mid-throw, not at frame 0
  controller.tick({ time: T0 + 1.25, pose: POSE.THROW, speed: 0 });
  assert.equal(controller.current, 'Quarterback Pass');
  assert.ok(controller.action.time > 0.2, `action.time ${controller.action.time} should be past the start`);
});

test('pose flicker at sampling rate does not restart the clip', () => {
  const { controller } = makeController();
  controller.tick({ time: T0, pose: POSE.RUN, speed: 5 });
  const startedAt = controller.action.time;
  // stance/run alternating every frame for 0.3 s
  for (let i = 1; i <= 9; i++) {
    controller.tick({ time: T0 + i * 0.033, pose: i % 2 ? POSE.STANCE : POSE.RUN, speed: 5 });
  }
  assert.equal(controller.current, 'Running in place', 'single-frame stance must not steal the body');
  assert.ok(controller.action.time > startedAt);
});

test('a finished one-shot hands the body back to locomotion', () => {
  const { controller } = makeController();
  controller.setCues([{ kind: 'throw', at: T0, anchorAt: T0 + 0.5 }]);
  controller.tick({ time: T0, pose: POSE.THROW, speed: 0 });
  assert.equal(controller.current, 'Quarterback Pass');
  // clip is 1 s + 0.1 s tail; run code arrives afterwards
  controller.tick({ time: T0 + 1.3, pose: POSE.RUN, speed: 4 });
  assert.equal(controller.current, 'Running in place', `still on ${controller.current}`);
});

test('a higher-priority state interrupts a one-shot', () => {
  const { controller } = makeController();
  controller.setCues([{ kind: 'throw', at: T0, anchorAt: T0 + 0.5 }]);
  controller.tick({ time: T0, pose: POSE.THROW, speed: 0 });
  controller.tick({ time: T0 + 0.35, pose: POSE.DOWN, speed: 0 });
  assert.equal(controller.current, 'Stunned (Knocked Down)', `down should interrupt the throw, got ${controller.current}`);
});

test('recorded throw/catch events win over pose heuristics, with the acting player', () => {
  // 30 Hz, ball airborne from 1.2 s, back down at 1.6 s
  const frames = [];
  for (let k = 0; k < 90; k++) {
    const t = k / HZ;
    const airborne = t >= 1.2 && t < 1.6;
    // two players then six ball fields: the layout is roster.length * 6 + 6
    frames.push([
      ...frame(50, 26, 0, t < 0.5 ? POSE.STANCE : POSE.RUN),
      ...frame(52, 30, 0, POSE.RUN),
      50, 26, (airborne ? 3 : 0.4) * 0.9144, 0, 0, 0,
    ]);
  }
  const rec = {
    t0: T0, hz: HZ, roster: [{ id: 'qb' }, { id: 'wr' }], frames,
    events: [{ type: 'throw', t: T0 + 1.15, by: 'qb' }, { type: 'catch', t: T0 + 1.55, by: 'wr' }],
  };
  const cues = deriveCues(rec);
  const qb = cues.get('qb');
  const wr = cues.get('wr');
  assert.equal(qb.length, 1);
  assert.equal(qb[0].source, 'event');
  assert.ok(Math.abs(qb[0].at - (T0 + 1.15)) < 1e-9, 'event time is used verbatim');
  assert.ok(qb[0].anchorAt >= T0 + 1.2 && qb[0].anchorAt < T0 + 1.25, `release ${qb[0].anchorAt}`);
  assert.equal(wr[0].kind, 'catch');
  assert.equal(wr[0].source, 'event');
});

test('an anchored throw plays its windup before the ball leaves the hand', () => {
  const { controller, clips } = makeController();
  const duration = clips.get('Quarterback Pass').duration;
  // anchor sits at the middle of the 1 s clip, release at T0 + 2.0
  controller.setCues([{ kind: 'throw', at: T0 + 1.9, anchorAt: T0 + 2.0 }]);
  // step in from before the throw
  for (let t = T0 + 1.2; t < T0 + 2.0; t += 0.033) {
    controller.tick({ time: Math.round(t * 1000) / 1000, pose: POSE.RUN, speed: 4 });
  }
  controller.tick({ time: T0 + 2.0, pose: POSE.THROW, speed: 0 });
  assert.equal(controller.current, 'Quarterback Pass');
  // at the release the clip must be at its anchor frame, not at the start
  const phase = controller.action.time / duration;
  assert.ok(Math.abs(phase - 0.5) < 0.06, `phase ${phase} should be the measured anchor`);
});

test('a latched throw code hands the body to locomotion once the ball is gone', () => {
  const { controller } = makeController();
  controller.setCues([{ kind: 'throw', at: T0 + 1.0, anchorAt: T0 + 1.2 }]);
  controller.tick({ time: T0 + 1.0, pose: POSE.THROW, speed: 0 });
  assert.equal(controller.current, 'Quarterback Pass');
  // the recording keeps saying THROW, and now he is jogging at 4 yd/s
  controller.tick({ time: T0 + 2.2, pose: POSE.THROW, speed: 4 });
  assert.equal(controller.current, 'Running in place', `expected locomotion, got ${controller.current}`);
});
