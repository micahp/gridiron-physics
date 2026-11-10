// Football-aware animation controller for the rigged player.
//
// rigged-player.js answers one question per frame: "which clip does this pose
// code mean?". That is a lookup, not a controller, and it has three visible
// consequences on a real play:
//
//   1. The mixer was advanced by the frame delta rather than by playback time,
//      so limb motion drifts from the recorded positions whenever the replay is
//      paused or played at a non-1x rate.
//   2. A one-shot clip starts at frame 0 the instant the pose code appears, so
//      the quarterback's release and the receiver's hands land wherever they
//      land relative to the ball instead of on the ball.
//   3. Every code change is an interrupt with a fixed 0.12 s fade, so 10 Hz
//      pose sampling flickers between stance and run and a finished one-shot
//      freezes on its last frame forever.
//
// This module owns the mixer instead: it derives cues from the recorded play,
// measures where each one-shot clip actually puts the body (release frame for a
// throw, reach frame for a catch), schedules the clip so that frame lands on the
// recorded event, and only then hands the body back to locomotion.
import * as THREE from './vendor/three.module.js';
import { POSE } from './pose-codes.js';
import { getRiggedAnimationSelection } from './rigged-player.js';

// Higher wins. A tackle (DOWN) can interrupt a throw; a throw cannot be
// interrupted by the run code that follows it.
const POSE_PRIORITY = {
  [POSE.DOWN]: 100,
  [POSE.WRAP]: 80,
  [POSE.BLOCK]: 70,
  [POSE.KNEEL]: 65,
  [POSE.THROW]: 60,
  [POSE.CATCH]: 55,
  [POSE.KICK]: 50,
  [POSE.HOLD]: 45,
  [POSE.CELEBRATE]: 40,
  [POSE.RUN]: 20,
  [POSE.BACKPEDAL]: 20,
  [POSE.STANCE]: 10,
};

// Clips that read as a cycle even though the source ships them as one-shots.
const LOOPING = new Map([
  [POSE.STANCE, true],
  [POSE.RUN, true],
  [POSE.BACKPEDAL, true],
  [POSE.BLOCK, true],
]);

// One-shot clips that must be anchored to a recorded moment. The value is the
// bone whose motion defines the anchor and how to score its extremes.
const ANCHORED = new Map([
  ['Quarterback Pass', { bone: 'handR', mode: 'forward' }],   // ball release
  ['Goalkeeper Catch', { bone: 'handR', mode: 'reach' }],      // standing catch, ball arrival (default)
  ['Football Catch 1', { bone: 'handR', mode: 'reach' }],      // dives/falls; not the default
  ['Football Catch 2', { bone: 'handR', mode: 'reach' }],
  ['Receiver Catch', { bone: 'handR', mode: 'reach' }],
]);

// ------------------------------------------------------------ football clips
//
// Authored in Blender for this rig (scripts/football_clips.py), keyed on what the replay
// actually says about a player: his position, the play type and his contact with another body
// (replay aux channel). A pose code alone cannot tell a lineman's stance from a receiver's.
const HAND_DOWN = /^(LT|LG|C|RG|RT|TE\d*|LEDGE|REDGE|LDT|RDT|NT|DT\d*|DE\d*|LS|FL\d+|PL\d+)$/;
const OFFENSIVE_LINE = /^(LT|LG|C|RG|RT|TE\d*|LS|FL\d+|PL\d+)$/; // includes the field-goal and punt protection units
export const FB = Object.freeze({
  STANCE_3PT: 'FB_Stance_3pt', STANCE_2PT: 'FB_Stance_2pt', QB_READY: 'FB_QB_Ready',
  BLOCK_PASS: 'FB_Block_Pass', BLOCK_RUN: 'FB_Block_Run', TACKLE: 'FB_Tackle_Wrap',
  CARRY: 'FB_Carry_Struggle', FALL: 'FB_Tackled_Fall', KICK: 'FB_Kick', PUNT: 'FB_Punt', HOLDER: 'FB_Holder',
  FALL_BACK: 'FB_Tackled_Back', GETUP: 'FB_GetUp', DROPBACK: 'FB_Dropback', STIFF_L: 'FB_StiffArm_L', STIFF_R: 'FB_StiffArm_R',
  TACKLE_DIVE: 'FB_Tackle_Dive', TACKLE_FORM: 'FB_Tackle_Form', SWIM: 'FB_Swim', RIP: 'FB_Rip',
  CATCH_HIGH: 'FB_Catch_High', CATCH_LOW: 'FB_Catch_Low', CATCH_RUN: 'FB_Catch_Run',
});
// seconds into each handoff clip at which the ball changes hands
const HANDOFF_ANCHOR = Object.freeze({ give: 0.55, take: 0.6 });
// seconds into FB_Kick / FB_Punt at which the foot meets the ball (scripts/football_clips.py)
const KICK_ANCHOR = Object.freeze({ kick: 0.42, punt: 0.40 });
// seconds into each one-shot at which the recorded moment (hands on the ball, arms closing on the carrier, the
// escape from a block) falls; the clip is started that long before the event (scripts/football_clips.py)
const ONESHOT_ANCHOR = Object.freeze({
  FB_Catch_High: 0.35, FB_Catch_Low: 0.35, FB_Catch_Run: 0.35, FB_Tackle_Dive: 0.3, FB_Tackle_Form: 0.3, FB_Swim: 0.45, FB_Rip: 0.45,
});
const ROLE = Object.freeze({ NONE: 0, ENGAGED: 1, TACKLER: 2, WRAPPED: 3 });

/**
 * Which authored football clip, if any, should own this player right now.
 * Returns { clipName, loop } or null to leave the choice to the pose code / locomotion.
 */
export function footballClip({ pose, speed = 0, contact = null, preSnap = false, hasClip = () => true }) {
  const ok = (clipName, loop) => (hasClip(clipName) ? { clipName, loop } : null);
  const role = contact?.role ?? ROLE.NONE;
  const slot = contact?.slot ?? null;
  const pass = contact?.kind === 'pass';
  if (pose === POSE.DOWN) return ok(FB.FALL, false);
  // the field-goal holder kneels over the spot (the engine marks him KNEEL, then HOLD once the ball is down)
  if (slot === 'H' && (pose === POSE.KNEEL || pose === POSE.HOLD)) return ok(FB.HOLDER, true);
  if (pose === POSE.WRAP || role === ROLE.TACKLER) return ok(FB.TACKLE, true);
  if (role === ROLE.WRAPPED) return ok(FB.CARRY, true);
  if (role === ROLE.ENGAGED || (pose === POSE.BLOCK && speed < 1.6)) {
    // an offensive lineman in pass protection sets; everyone else drives
    const setting = (pass || contact?.kind === 'kick') && OFFENSIVE_LINE.test(slot || '') && speed < 1.6;
    return ok(setting ? FB.BLOCK_PASS : FB.BLOCK_RUN, true);
  }
  // Before the snap the engine marks only the linemen STANCE; backs, receivers, the QB and the
  // secondary sit at ~0 m/s with a RUN or BACKPEDAL code. Standing still before the snap IS a stance.
  const waiting = pose === POSE.STANCE || (preSnap && (pose === POSE.RUN || pose === POSE.BACKPEDAL));
  if (waiting && speed < 0.6) {
    if (slot === 'QB') return ok(FB.QB_READY, true);
    return ok(HAND_DOWN.test(slot || '') ? FB.STANCE_3PT : FB.STANCE_2PT, true);
  }
  return null;
}

const FADE_IN = 0.14;        // seconds, crossfade into any new clip
const FADE_OUT = 0.18;       // seconds, crossfade back to locomotion
const MIN_POSE_HOLD = 0.08;  // seconds a pose must persist before it interrupts
const TAIL = 0.1;            // seconds a finished one-shot keeps the body
// Sanity guard only: animation time IS playback time here, so clamping the step
// would silently desync limbs from positions after a stalled frame.
const MAX_STEP = 2;
// These authored clips are long (Quarterback Pass is 7.7 s, Football Catch 1 is
// 4.2 s) because they carry their own idle lead-in. Anchoring by raw phase would
// start the windup seconds before the snap, so the lead is capped and the clip is
// entered mid-motion instead.
const MAX_LEAD = 0.7;
const FOLLOW_THROUGH = 0.6;  // keep the body on the clip this long after the anchor
const MAX_ONESHOT = 2.5;     // cap for pose-driven one-shots with no anchor

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const YD = 0.9144;

// ---------------------------------------------------------------- locomotion
//
// The clips are "in place": root motion was stripped so physics owns position.
// That only looks right if the planted foot sweeps backward at the speed the
// body is actually travelling. Each clip's natural ground speed is measured
// from the rig (planted-foot velocity relative to the hips), the clip whose
// speed is closest is chosen, and its playback rate is set to speed / natural
// speed so the foot stays put on the turf.
// The stock Standing Idle clasps the hands at the belt, which reads as hands behind the back from the side
// or behind. FB_Idle (authored for this rig) is the default; the stock clip stays as a fallback for old GLBs.
const IDLE_CLIPS = ['FB_Idle', 'Standing Idle'];
const PUSH_CLIP = 'Pushing In Place';
const RUN_TIERS = ['FB_Walk', 'Jogging In Place', 'run-in-place', 'Running in place', 'Sprint In Place'];
const CARRY_TIERS = ['FB_Walk', 'Running While Holding Something', 'Running in place', 'Sprint In Place'];
const BACK_TIERS = ['Running Backward in place'];
const BALL_BACK_TIERS = ['FB_Dropback']; // a quarterback backing up with the ball at his chest
const LOCO_CLIPS = new Set([...RUN_TIERS, ...CARRY_TIERS, ...BACK_TIERS, ...BALL_BACK_TIERS, ...IDLE_CLIPS, PUSH_CLIP]);
// Used only when a clip cannot be measured (no foot bones, e.g. unit-test rigs).
// Values are what the real rig measures at the default 1.88 m player height.
const FALLBACK_SPEED = {
  'FB_Walk': 1.1, 'Jogging In Place': 1.5, 'run-in-place': 3.1, 'Running in place': 4.2, 'Sprint In Place': 4.8,
  'Running While Holding Something': 3.0, 'Running Backward in place': 2.6, 'FB_Dropback': 2.2, [PUSH_CLIP]: 0.4,
};
const MIN_RATE = 0.6;         // below this a cycle reads as slow motion
const MAX_RATE = 1.6;         // above this cadence is cartoonish; accept a little slide
const TIER_HYSTERESIS = 0.12; // fraction past a tier boundary before switching
const IDLE_ENTER = 0.35;      // m/s: a "running" player this slow is standing
const IDLE_EXIT = 0.6;
const STANCE_MOVING = [1.0, 0.6];  // m/s enter/exit: stance code but clearly moving
const BLOCK_MOVING = [1.6, 1.2];   // m/s enter/exit: block code while running to the block
const BACK_ENTER = -0.4;      // cosine of facing vs travel: moving backwards
const BACK_EXIT = -0.15;
const GAIT_DWELL = 0.18;      // seconds a gait holds before another switch; a braking
                              // player otherwise crossfades through every tier at once

/**
 * Measure a clip's gait in model space: the natural ground speed (planted-foot
 * velocity relative to the hips, model units per second) and a foot-phase
 * signature used to line strides up when switching clips. Cached by clip name;
 * every player shares one skeleton and clip set.
 */
const gaitCache = new Map();
export function measureGait(clips, clipName, model) {
  if (gaitCache.has(clipName)) return gaitCache.get(clipName);
  const clip = clips.get(clipName);
  // the ball of the foot is what is actually on the ground in stance; the ankle travels over it, so a gait measured
  // at the ankle understates the sweep and the controller then plays the clip too slowly for the ground speed
  const footL = clip && (findBone(model, 'toeL') || findBone(model, 'footL'));
  const footR = clip && (findBone(model, 'toeR') || findBone(model, 'footR'));
  if (!clip || !footL || !footR) {
    gaitCache.set(clipName, null);
    return null;
  }
  const mixer = new THREE.AnimationMixer(model);
  mixer.clipAction(clip).play();
  const n = Math.max(48, Math.round(clip.duration * 120));
  const inv = new THREE.Matrix4();
  const l = new THREE.Vector3();
  const r = new THREE.Vector3();
  const rows = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * clip.duration;
    mixer.setTime(t);
    model.updateMatrixWorld(true);
    inv.copy(model.matrixWorld).invert();
    footL.getWorldPosition(l).applyMatrix4(inv);
    footR.getWorldPosition(r).applyMatrix4(inv);
    rows.push({ t, lz: l.z, ly: l.y, rz: r.z, ry: r.y });
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(model);

  let minY = Infinity, maxY = -Infinity, range = 0;
  for (const q of rows) {
    minY = Math.min(minY, q.ly, q.ry);
    maxY = Math.max(maxY, q.ly, q.ry);
    range = Math.max(range, Math.abs(q.lz - q.rz));
  }
  // the model faces +Z, so a planted foot moves toward -Z while running forward
  const v = [];
  for (let i = 1; i < n; i++) {
    const dt = rows[i].t - rows[i - 1].t;
    for (const [z, y, other] of [['lz', 'ly', 'ry'], ['rz', 'ry', 'ly']]) {
      if (rows[i][y] > rows[i][other]) continue;                // not the lower foot
      if (rows[i][y] > minY + 0.25 * (maxY - minY)) continue;   // not on the ground
      v.push(-(rows[i][z] - rows[i - 1][z]) / dt);
    }
  }
  v.sort((a, b) => a - b);
  const speed = v.length ? Math.abs(v[Math.floor(v.length / 2)]) : 0;
  const gait = {
    speed,
    duration: clip.duration,
    // (left z - right z) and which foot is down: enough to match stride phase
    samples: range > 0.05
      ? rows.map((q) => ({ t: q.t, s: (q.lz - q.rz) / range, c: q.ly < q.ry ? -1 : 1 }))
      : null,
  };
  gaitCache.set(clipName, gait);
  return gait;
}

/** Time in clip `to` whose stride phase best matches clip `from` at `fromTime`. */
export function matchGaitPhase(from, fromTime, to) {
  const ft = ((fromTime % from.duration) + from.duration) % from.duration;
  let cur = from.samples[0];
  for (const q of from.samples) if (Math.abs(q.t - ft) < Math.abs(cur.t - ft)) cur = q;
  let best = to.samples[0], bestScore = Infinity;
  for (const q of to.samples) {
    const score = Math.abs(q.s - cur.s) + (q.c === cur.c ? 0 : 0.5);
    if (score < bestScore) { bestScore = score; best = q; }
  }
  return best.t;
}

/**
 * Derive per-player animation cues from a recorded play.
 *
 * The recording carries the moments a controller needs: the physics engine emits
 * `throw` and `catch` events with the acting player, so the anchor times come
 * straight from the simulation. Where a play has no such event - an older
 * recording, or a throw the engine never registered as an event - the pose codes
 * plus the ball's recorded flight are used as a fallback.
 */
export function deriveCues(rec, { hz = rec?.hz || 30 } = {}) {
  const cues = new Map();
  if (!rec?.frames?.length || !rec.roster?.length) return cues;
  const n = rec.roster.length;
  const bw = n * 6;                        // ball offset in each frame row
  const t0 = rec.t0 ?? 0;
  const at = (k) => t0 + k / hz;           // absolute playback time of frame k
  const index = (t) => Math.max(0, Math.min(rec.frames.length - 1, Math.round((t - t0) * hz)));
  const ballUp = (k) => rec.frames[k][bw + 2] / 0.9144 > 0.6; // metres -> yards
  const push = (id, cue) => {
    if (!cues.has(id)) cues.set(id, []);
    cues.get(id).push(cue);
  };

  // 0. handoffs: a recorded event naming both players. The giver's hands reach the taker's belly at
  // the anchor frame of the clip, so the clip starts that long before the event.
  const slotOf = new Map(rec.roster.map((r, i) => [r.id, i]));
  for (const e of rec.events || []) {
    if (e?.type !== 'handoff' || !e.from || !e.to) continue;
    const k = index(e.t), gi = slotOf.get(e.from), ti = slotOf.get(e.to);
    if (gi === undefined || ti === undefined) continue;
    const f = rec.frames[k];
    // which side of the giver the taker is on, and the reverse (field heading h: left = (sin h, -cos h))
    const sideOf = (a, b) => {
      const h = f[a * 6 + 2];
      return ((f[b * 6] - f[a * 6]) * Math.sin(h) - (f[b * 6 + 1] - f[a * 6 + 1]) * Math.cos(h)) > 0 ? 'L' : 'R';
    };
    push(e.from, { kind: 'handoff_give', side: sideOf(gi, ti), at: e.t - HANDOFF_ANCHOR.give, anchorAt: e.t, source: 'event' });
    push(e.to, { kind: 'handoff_take', side: sideOf(ti, gi), at: e.t - HANDOFF_ANCHOR.take, anchorAt: e.t, source: 'event' });
  }

  // 0c. tackles: the tackler dives or form-tackles with contact on the 'wrapped' event, and the carrier goes
  // down backward when the tackler is in front of him, forward otherwise (a pair, timed to the same moment)
  for (const e of rec.events || []) {
    if (e?.type !== 'wrapped' || !e.by || !e.on) continue;
    const ti = slotOf.get(e.by), ci = slotOf.get(e.on);
    if (ti === undefined || ci === undefined) continue;
    const f = rec.frames[index(e.t)];
    const clip = f[ti * 6 + 3] > 6.0 ? FB.TACKLE_DIVE : FB.TACKLE_FORM;
    push(e.by, { kind: 'oneshot', clip, at: e.t - ONESHOT_ANCHOR[clip], anchorAt: e.t, source: 'event' });
    const h = f[ci * 6 + 2], dx = f[ti * 6] - f[ci * 6], dz = f[ti * 6 + 1] - f[ci * 6 + 1];
    const front = dx * Math.cos(h) + dz * Math.sin(h) > 0.25 * Math.hypot(dx, dz);
    push(e.on, { kind: 'fall_variant', clip: front ? FB.FALL_BACK : FB.FALL, at: e.t, anchorAt: e.t, source: 'event' });
  }
  // 0d. a defender who sheds a block does it with a swim or a rip (one per second at most per player)
  const lastRush = new Map();
  for (const e of rec.events || []) {
    if (e?.type !== 'shed' || !e.by) continue;
    const i = slotOf.get(e.by);
    if (i === undefined || rec.frames[index(e.t)][i * 6 + 3] > 5) continue;
    if (e.t - (lastRush.get(e.by) ?? -9) < 1.0) continue;
    lastRush.set(e.by, e.t);
    const clip = [...e.by].reduce((a, c) => a + c.charCodeAt(0), 0) % 2 ? FB.SWIM : FB.RIP;
    push(e.by, { kind: 'oneshot', clip, at: e.t - ONESHOT_ANCHOR[clip], anchorAt: e.t, source: 'event' });
  }

  // 0b. kicks: the engine stamps KICK at contact and never clears it, so the pose code says nothing about when
  // the kick happens; the 'kick' event does. The clip starts early enough that the foot meets the ball on it.
  for (const e of rec.events || []) {
    if (e?.type !== 'kick' || !e.by) continue;
    const who = rec.roster.find((r) => r.id === e.by);
    const punt = who?.slot === 'P';
    push(e.by, { kind: 'kick', punt, at: e.t - (punt ? KICK_ANCHOR.punt : KICK_ANCHOR.kick), anchorAt: e.t, source: 'event' });
  }

  // 1. recorded events: exact player and exact time
  for (const e of rec.events || []) {
    if (!e?.by || (e.type !== 'throw' && e.type !== 'catch')) continue;
    const k = index(e.t);
    let anchor = e.t;
    if (e.type === 'throw') {
      for (let j = k; j < Math.min(rec.frames.length, k + Math.round(hz * 0.6)); j++) {
        if (ballUp(j)) { anchor = at(j); break; }
      }
      if (anchor === e.t) anchor = e.t + 0.35; // ball never left the hand
    } else {
      for (let j = k; j < Math.min(rec.frames.length, k + Math.round(hz * 0.6)); j++) {
        if (!ballUp(j)) { anchor = at(j); break; }
      }
    }
    // which catch: judged from where the ball is when the hands meet it
    let clip = null;
    const ri = slotOf.get(e.by);
    if (e.type === 'catch' && ri !== undefined) {
      const z = rec.frames[k][bw + 2], v = rec.frames[k][ri * 6 + 3];
      clip = z > 2.3 ? FB.CATCH_HIGH : z < 0.85 ? FB.CATCH_LOW : v > 4.0 ? FB.CATCH_RUN : null;
    }
    push(e.by, { kind: e.type, at: e.t, anchorAt: anchor, source: 'event', ...(clip ? { clip } : {}) });
  }

  // 2. fallback for players the event stream did not mention
  for (let i = 0; i < n; i++) {
    const id = rec.roster[i].id;
    if (cues.has(id)) continue;
    const base = i * 6;
    let prevPose = null;
    let throwAt = null;
    for (let k = 0; k < rec.frames.length; k++) {
      const f = rec.frames[k];
      const pose = f[base + 4];
      if (pose !== prevPose) {
        if (pose === POSE.THROW) throwAt = k;
        if (pose === POSE.CATCH) {
          let arrival = null;
          for (let j = k; j < Math.min(rec.frames.length, k + Math.round(hz * 0.5)); j++) {
            if (!ballUp(j)) { arrival = j; break; }
          }
          push(id, { kind: 'catch', at: at(k), anchorAt: at(arrival ?? Math.min(k + 9, rec.frames.length - 1)), source: 'pose' });
        }
      }
      if (throwAt !== null && pose === POSE.THROW && ballUp(k)) {
        push(id, { kind: 'throw', at: at(throwAt), anchorAt: at(k), source: 'pose' });
        throwAt = null;
      }
      prevPose = pose;
    }
    if (throwAt !== null) {
      push(id, { kind: 'throw', at: at(throwAt), anchorAt: at(throwAt) + 0.35, source: 'pose' });
    }
  }

  for (const list of cues.values()) list.sort((a, b) => a.at - b.at);
  return cues;
}

/**
 * Measure where a clip puts a bone at its extremes, in normalised clip time.
 * Runs on a throwaway mixer so the live mixer is untouched, and caches by clip
 * name because every player clones the same skeleton.
 */
const anchorCache = new Map();
export function measureAnchor(clips, clipName, spec, root) {
  const key = `${clipName}:${spec.bone}:${spec.mode}`;
  if (anchorCache.has(key)) return anchorCache.get(key);
  const clip = clips.get(clipName);
  const bone = findBone(root, spec.bone);
  if (!clip || !bone) {
    anchorCache.set(key, 0);
    return 0;
  }
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(clip);
  action.play();
  const samples = 24;
  const origin = new THREE.Vector3();
  const p = new THREE.Vector3();
  let best = -Infinity;
  let bestT = 0;
  for (let i = 0; i < samples; i++) {
    const u = i / (samples - 1);
    mixer.setTime(u * clip.duration);
    root.updateMatrixWorld(true);
    root.getWorldPosition(origin);
    bone.getWorldPosition(p);
    // forward/reach: how far the hand is downfield of the body, plus height for
    // the catch reach so a raised arm beats a fully extended low one
    const forward = p.x - origin.x;
    const score = spec.mode === 'reach' ? forward + (p.y - origin.y) * 0.5 : forward;
    if (score > best) { best = score; bestT = u; }
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(root);
  anchorCache.set(key, bestT);
  return bestT;
}

function findBone(root, name) {
  let found = null;
  root.traverse((o) => {
    if (found) return;
    const clean = o.name.replace(/\./g, '');
    if (clean === name || o.name === name) found = o;
  });
  return found;
}

/** Is this a cycle that carries the body along the ground (as opposed to a set-piece or contact clip)? */
export function isLocomotionClip(name) {
  return !!name && LOCO_CLIPS.has(name);
}

/** Attach a controller to a built rigged player (idempotent). */
export function ensureController(root) {
  const u = root.userData;
  if (u.controller || !u.animation?.mixer) return u.controller || null;
  u.controller = new RiggedAnimationController(root);
  return u.controller;
}

const KICK_CLIP = 'Goalkeeper Drop Kick';
const KICK_RATE = 2.3;
export class RiggedAnimationController {
  constructor(root) {
    this.root = root;
    this.animation = root.userData.animation;
    this.mixer = this.animation.mixer;
    this.clips = this.animation.clips;
    this.time = null;         // last playback time seen
    this.action = null;
    this.clipName = null;
    this.lock = null;         // { clipName, until, priority }
    this.poseSince = 0;
    this.pendingPose = null;
    this.scheduled = new Set(); // cue keys already honoured
    this.lastPose = null;
    this.fallVariant = null;   // set by a 'fall_variant' cue: which way this carrier goes down
    this.lastStiff = -9;
    this.lastAnchorAt = null;   // playback time of the most recent anchored moment
    this.model = this.mixer?.getRoot?.() || root;
    this.loco = { clip: null, idle: false, back: false, stanceMoving: false, blockMoving: false };
    this.speedCache = new Map();
    this.modelScale = null;
    // Measure every run clip now, while the roster is being built. Doing it lazily put a
    // ~50 ms stall in the middle of the first play that needed each gait. The cache is
    // shared, so only the first player pays.
    for (const name of LOCO_CLIPS) this.gait(name);
  }

  /** Model units -> metres for this player (players are scaled to height). */
  modelToMetres() {
    if (this.modelScale === null) {
      this.root.updateMatrixWorld(true);
      const a = new THREE.Vector3();
      const b = new THREE.Vector3();
      this.model.getWorldScale(a);
      this.root.getWorldScale(b);
      this.modelScale = (a.x / (b.x || 1)) * YD;
    }
    return this.modelScale;
  }

  gait(clipName) {
    return measureGait(this.clips, clipName, this.model);
  }

  /** Natural ground speed of a locomotion clip for this player, in m/s. */
  nativeSpeed(clipName) {
    if (this.speedCache.has(clipName)) return this.speedCache.get(clipName);
    const gait = this.gait(clipName);
    let v = gait ? gait.speed * this.modelToMetres() : NaN;
    if (!(v > 0.2 && v < 12)) v = FALLBACK_SPEED[clipName] ?? 4;
    this.speedCache.set(clipName, v);
    return v;
  }

  /** Should this pose be shown as locomotion at this speed? */
  wantsLocomotion(pose, speed) {
    const L = this.loco;
    L.stanceMoving = pose === POSE.STANCE && speed > STANCE_MOVING[L.stanceMoving ? 1 : 0];
    L.blockMoving = pose === POSE.BLOCK && speed > BLOCK_MOVING[L.blockMoving ? 1 : 0];
    return pose === POSE.RUN || pose === POSE.BACKPEDAL || L.stanceMoving || L.blockMoving;
  }

  /** Pick the locomotion clip and playback rate for a speed (m/s) and direction. */
  pickLocomotion({ speed, pose, carrying, travel, time = 0 }) {
    const L = this.loco;
    // hold the current gait briefly; only its playback rate follows the speed
    if (L.clip && L.since !== undefined && time >= L.since && time - L.since < GAIT_DWELL && this.clips.has(L.clip)) {
      const rate = IDLE_CLIPS.includes(L.clip) ? 1 : clamp(speed / this.nativeSpeed(L.clip), MIN_RATE, MAX_RATE);
      return { clipName: L.clip, rate };
    }
    const chosen = this.chooseGait({ speed, pose, carrying, travel });
    if (chosen && chosen.clipName !== L.clip) L.since = time;
    L.clip = chosen?.clipName ?? null;
    return chosen;
  }

  chooseGait({ speed, pose, carrying, travel }) {
    const L = this.loco;
    // the measured direction of travel decides which way the feet sweep; the
    // pose code is only a fallback when the player is too slow to tell
    const known = travel !== null && travel !== undefined && speed > 0.8;
    L.back = known ? travel < (L.back ? BACK_EXIT : BACK_ENTER) : pose === POSE.BACKPEDAL;
    const idleName = IDLE_CLIPS.find((n) => this.clips.has(n));
    L.idle = speed < (L.idle ? IDLE_EXIT : IDLE_ENTER) && !!idleName;
    if (L.idle) return { clipName: idleName, rate: 1 };

    // 'Running in place' is a high-knee drill (feet rise 85 cm): only a fallback for models without a real jog
    const drill = (n) => n === 'Running in place' && this.clips.has('Jogging In Place');
    const pick = (names) => names.filter((n) => this.clips.has(n) && !drill(n))
      .map((n) => ({ n, v: this.nativeSpeed(n) }))
      .sort((a, b) => a.v - b.v);
    const ballBack = L.back && carrying ? pick(BALL_BACK_TIERS) : [];
    let tiers = ballBack.length ? ballBack : pick(L.back ? BACK_TIERS : carrying ? CARRY_TIERS : RUN_TIERS);
    if (!tiers.length) tiers = pick(RUN_TIERS);
    if (!tiers.length) return null;

    let i = tiers.findIndex((t) => t.n === L.clip);
    if (i < 0) {
      // nearest natural speed on a log scale
      const s = Math.max(speed, 0.1);
      i = 0;
      for (let k = 1; k < tiers.length; k++) {
        if (Math.abs(Math.log(s / tiers[k].v)) < Math.abs(Math.log(s / tiers[i].v))) i = k;
      }
    } else {
      const edge = (a, b) => Math.sqrt(tiers[a].v * tiers[b].v);
      while (i < tiers.length - 1 && speed > edge(i, i + 1) * (1 + TIER_HYSTERESIS)) i++;
      while (i > 0 && speed < edge(i - 1, i) * (1 - TIER_HYSTERESIS)) i--;
    }
    return { clipName: tiers[i].n, rate: clamp(speed / tiers[i].v, MIN_RATE, MAX_RATE) };
  }

  /** Clips this player must start at an exact playback time. */
  setCues(cues) {
    this.cues = Array.isArray(cues) ? cues : [];
    this.cuesRaw = cues ?? null;
    this.scheduled.clear();
    this.fallVariant = null;
    this.lastPose = null;
    this.time = null; // a new play restarts the clock; no cross-play dt
    return this;
  }

  /**
   * Advance from playback time, not frame time: 0 while paused, 2x at 2x.
   * Returns true when a clip owns the body (so the caller must not also pose it).
   */
  tick({ time, pose: rawPose, speed = 0, carrying = false, travel = null, contact = null }) {
    // KICK is stamped at contact and never cleared: with the authored FB_Kick the kick itself is played from the
    // 'kick' event (honourCues), so afterwards a KICK code must not hold the body on a finished clip
    const pose = rawPose === POSE.KICK && this.clips.has(FB.KICK) ? POSE.RUN : rawPose;
    const dt = this.time === null ? 0 : clamp(time - this.time, 0, MAX_STEP);
    this.time = time;
    if (!this.animation?.mixer) return false;

    this.honourCues(time);
    let selection = getRiggedAnimationSelection(pose, carrying);
    // A throw or catch code often stays latched in the recording after the ball
    // has gone. Playing the clip forever is what made the quarterbacks look
    // possessed; once the follow-through is over the body belongs to locomotion.
    const anchoredOver = this.lastAnchorAt !== null && time > this.lastAnchorAt + FOLLOW_THROUGH;
    // authored football clips own the body where the replay says what the player is doing (stance,
    // block, tackle, tackled); otherwise locomotion picks a gait from his real speed
    // getting up: a tackled player stands up, he does not snap from the ground into a run
    if (this.lastPose === POSE.DOWN && pose !== POSE.DOWN && this.clips.has(FB.GETUP)
        && (!this.lock || this.lock.clipName === FB.FALL || this.lock.clipName === FB.FALL_BACK)) {
      this.lock = null;
      this.play(FB.GETUP, { loop: false, priority: POSE_PRIORITY[POSE.KNEEL], time, lockUntil: time + this.clips.get(FB.GETUP).duration });
    }
    // the variant is set while he is still being wrapped, so it only clears once he is back on his feet
    if (this.lastPose === POSE.DOWN && pose !== POSE.DOWN) this.fallVariant = null;
    this.lastPose = pose;
    // a carrier with a defender closing on one side puts out the arm on that side
    if (carrying && contact?.opp && contact.role !== ROLE.WRAPPED && !this.lock && speed > 3.5 && time - this.lastStiff > 1.6) {
      const stiff = contact.opp.side === 'L' ? FB.STIFF_L : FB.STIFF_R;
      if (this.clips.has(stiff)) {
        this.lastStiff = time;
        this.play(stiff, { loop: false, priority: POSE_PRIORITY[POSE.THROW], time, lockUntil: time + this.clips.get(stiff).duration });
      }
    }
    let football = footballClip({ pose, speed, contact, preSnap: time < 0 && contact?.kind !== 'kick', hasClip: (n) => this.clips.has(n) });
    if (football?.clipName === FB.FALL && this.fallVariant && this.clips.has(this.fallVariant)) football = { clipName: this.fallVariant, loop: false };
    let loco = null;
    if (football) {
      selection = { clipName: football.clipName, loop: football.loop };
    } else if ((anchoredOver && ANCHORED.has(selection?.clipName)) || this.wantsLocomotion(pose, speed)) {
      loco = this.pickLocomotion({ speed, pose, carrying, travel, time });
      if (loco) selection = { clipName: loco.clipName, loop: true };
    }
    const clipName = selection?.clipName ?? null;
    const priority = POSE_PRIORITY[pose] ?? 0;

    if (pose !== this.pendingPose) {
      this.pendingPose = pose;
      this.poseSince = time;
    }

    const interrupting = !!this.lock && priority > this.lock.priority + 20;
    if (this.lock && (time >= this.lock.until || interrupting)) this.lock = null;

    // MIN_POSE_HOLD exists to swallow single-frame code flicker, not to stall a
    // body that is showing nothing, sitting on a finished one-shot, or being
    // taken over by a tackle.
    const held = time - this.poseSince >= MIN_POSE_HOLD;
    const idle = !this.action || this.isFinished(dt);
    const canSwitch = interrupting || (!this.lock && (held || idle));
    if (clipName && clipName !== this.clipName && canSwitch) {
      const assertedLoop = LOOPING.get(pose) ?? (getRiggedAnimationSelection(pose)?.loop === true);
      // locomotion clips are cycles whatever pose code asked for them
      const loop = football ? football.loop : (!!loco || assertedLoop || LOCO_CLIPS.has(clipName));
      // Anchored one-shots are started by honourCues with a seek, not here.
      if (!ANCHORED.has(clipName)) this.play(clipName, { loop, priority, time });
    }
    if (!clipName && this.clipName && !this.lock) this.stop(time);
    // stride matching: the planted foot must sweep back as fast as the body moves
    if (this.action && loco && this.clipName === loco.clipName) {
      this.action.setEffectiveTimeScale(loco.rate);
    } else if (this.action && this.clipName === KICK_CLIP) {
      // the 3.9 s goalkeeper drop-kick wind-up is far slower than a real kick
      this.action.setEffectiveTimeScale(KICK_RATE);
    } else if (this.action && this.clipName === PUSH_CLIP) {
      this.action.setEffectiveTimeScale(clamp(speed / this.nativeSpeed(PUSH_CLIP), 1, 1.4));
    }
    this.mixer.update(dt);
    return !!this.clipName;
  }

  /** The clip a cue plays, where the recorded moment falls inside it, and how it ranks; null if nothing to play. */
  resolveCue(cue) {
    const has = (n) => !!n && this.clips.has(n);
    if (cue.kind === 'fall_variant') return null;
    if (cue.kind === 'kick') {
      const clipName = cue.punt ? FB.PUNT : FB.KICK;
      return has(clipName) && { clipName, anchorSeconds: KICK_ANCHOR[cue.punt ? 'punt' : 'kick'], priority: POSE_PRIORITY[POSE.KICK], full: true };
    }
    if (cue.kind === 'handoff_give' || cue.kind === 'handoff_take') {
      const clipName = `FB_Handoff_${cue.kind === 'handoff_give' ? 'Give' : 'Take'}_${cue.side}`;
      return has(clipName) && { clipName, anchorSeconds: HANDOFF_ANCHOR[cue.kind === 'handoff_give' ? 'give' : 'take'], priority: POSE_PRIORITY[POSE.THROW], full: false };
    }
    if (cue.kind === 'oneshot') {
      const clipName = cue.clip;
      const priority = /^FB_Tackle/.test(clipName || '') ? POSE_PRIORITY[POSE.WRAP] : POSE_PRIORITY[POSE.BLOCK];
      return has(clipName) && { clipName, anchorSeconds: ONESHOT_ANCHOR[clipName] ?? 0.3, priority, full: true };
    }
    if (cue.kind === 'catch' && has(cue.clip)) {
      return { clipName: cue.clip, anchorSeconds: ONESHOT_ANCHOR[cue.clip] ?? 0.35, priority: POSE_PRIORITY[POSE.CATCH], full: true };
    }
    // throw, or the standing catch: the stock clip, with the anchor measured from the hand's motion
    const clipName = (cue.kind === 'throw' ? getRiggedAnimationSelection(POSE.THROW) : getRiggedAnimationSelection(POSE.CATCH))?.clipName;
    if (!has(clipName)) return null;
    const spec = ANCHORED.get(clipName);
    const anchor = spec ? measureAnchor(this.clips, clipName, spec, this.root) : 0;
    return { clipName, anchorSeconds: anchor * this.clips.get(clipName).duration, priority: cue.kind === 'throw' ? POSE_PRIORITY[POSE.THROW] : POSE_PRIORITY[POSE.CATCH], full: false };
  }

  honourCues(time) {
    if (!this.cues?.length) return;
    for (const cue of this.cues) {
      const key = `${cue.kind}:${cue.at.toFixed(3)}`;
      if (this.scheduled.has(key)) continue;
      if (time < cue.at) continue;
      this.scheduled.add(key);
      if (cue.kind === 'fall_variant') { this.fallVariant = cue.clip; continue; }
      const r = this.resolveCue(cue);
      if (!r) continue;
      const clip = this.clips.get(r.clipName);
      // start the clip early enough that its anchor frame lands on the recorded
      // event; if we are already late, seek into it instead of restarting
      const anchorTime = r.anchorSeconds;             // where the release/reach/contact sits in the clip
      const lead = Math.min(anchorTime, MAX_LEAD);    // how much windup we are willing to play
      const startAt = cue.anchorAt - lead;
      // invariant: clip time = anchorTime + (playback time - anchor time), so the
      // anchor lands on the recorded event whether we started on time or late
      const offset = time > startAt
        ? clamp(anchorTime + (time - cue.anchorAt), 0, clip.duration - 1e-3)
        : Math.max(0, anchorTime - lead);
      this.lastAnchorAt = cue.anchorAt;
      this.play(r.clipName, {
        loop: false,
        priority: r.priority,
        time,
        offset,
        lockUntil: r.full ? cue.anchorAt + (clip.duration - anchorTime) : cue.anchorAt + FOLLOW_THROUGH, // set pieces play out in full
      });
    }
  }

  play(clipName, { loop = false, priority = 0, time = 0, offset = 0, lockUntil = null }) {
    const clip = this.clips.get(clipName);
    if (!clip) return;
    const prev = this.action;
    const next = this.mixer.clipAction(clip);
    if (next === prev && loop) return;
    next.reset();
    next.enabled = true;
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    next.clampWhenFinished = !loop;
    next.time = offset;
    next.setEffectiveTimeScale(1);
    // carry the stride across so the feet do not pop when one run clip
    // replaces another: match which foot is down and how far apart they are
    if (loop && prev && prev.getClip() !== clip && LOCO_CLIPS.has(prev.getClip().name)) {
      const from = this.gait(prev.getClip().name);
      const to = this.gait(clipName);
      if (from?.samples && to?.samples) {
        next.time = matchGaitPhase(from, prev.time, to);
      } else {
        const prevDur = prev.getClip().duration || 1;
        next.time = ((prev.time / prevDur) % 1) * clip.duration;
      }
    }
    // Full base weight, then fade in. fadeIn() scales the base weight, so a base
    // weight of 0 here left every clip after the first permanently invisible and
    // froze the player in whatever pose the previous clip faded out of.
    next.setEffectiveWeight(1);
    next.play();
    if (prev && prev !== next) {
      next.fadeIn(FADE_IN);
      prev.fadeOut(FADE_OUT);
    }
    this.action = next;
    this.clipName = clipName;
    // mirror into the older debug surface (__gridironFrameSnapshot) so existing
    // tests and the HUD read the clip that is actually on the body
    if (this.animation) {
      this.animation.activeAction = next;
      this.animation.activeClipName = clipName;
    }
    if (!loop) {
      this.lock = {
        clipName,
        priority,
        until: lockUntil ?? (time + Math.min(clip.duration, MAX_ONESHOT) + TAIL),
      };
    }
  }

  /**
   * Has the current one-shot run out? The mixer is advanced at the end of tick,
   * so project by the step this tick is about to apply - otherwise a clip that
   * ends this frame is only noticed on the next one.
   */
  isFinished(dt = 0) {
    if (!this.action) return true;
    const clip = this.action.getClip();
    if (this.action.loop !== THREE.LoopOnce) return false;
    const step = dt * Math.abs(this.action.getEffectiveTimeScale() || 1);
    return this.action.time + step >= clip.duration - 1e-3;
  }

  stop(time = 0) {
    if (this.action) {
      this.action.fadeOut(FADE_OUT);
      this.action = null;
      this.clipName = null;
    }
    this.lock = null;
  }

  /** Which clip is on the body right now (tests and debug HUD). */
  get current() {
    return this.clipName;
  }
}
