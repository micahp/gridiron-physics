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
  ['Football Catch 1', { bone: 'handR', mode: 'reach' }],      // ball arrival
  ['Football Catch 2', { bone: 'handR', mode: 'reach' }],
  ['Receiver Catch', { bone: 'handR', mode: 'reach' }],
]);

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
    push(e.by, { kind: e.type, at: e.t, anchorAt: anchor, source: 'event' });
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

/** Attach a controller to a built rigged player (idempotent). */
export function ensureController(root) {
  const u = root.userData;
  if (u.controller || !u.animation?.mixer) return u.controller || null;
  u.controller = new RiggedAnimationController(root);
  return u.controller;
}

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
    this.lastAnchorAt = null;   // playback time of the most recent anchored moment
  }

  /** Clips this player must start at an exact playback time. */
  setCues(cues) {
    this.cues = Array.isArray(cues) ? cues : [];
    this.cuesRaw = cues ?? null;
    this.scheduled.clear();
    this.time = null; // a new play restarts the clock; no cross-play dt
    return this;
  }

  /**
   * Advance from playback time, not frame time: 0 while paused, 2x at 2x.
   * Returns true when a clip owns the body (so the caller must not also pose it).
   */
  tick({ time, pose, speed = 0, carrying = false }) {
    const dt = this.time === null ? 0 : clamp(time - this.time, 0, MAX_STEP);
    this.time = time;
    if (!this.animation?.mixer) return false;

    this.honourCues(time);
    let selection = getRiggedAnimationSelection(pose, carrying);
    // A throw or catch code often stays latched in the recording after the ball
    // has gone. Playing the clip forever is what made the quarterbacks look
    // possessed; once the follow-through is over the body belongs to locomotion.
    const anchoredOver = this.lastAnchorAt !== null && time > this.lastAnchorAt + FOLLOW_THROUGH;
    if (anchoredOver && ANCHORED.has(selection?.clipName)) {
      selection = getRiggedAnimationSelection(speed > 0.5 ? POSE.RUN : POSE.STANCE, carrying);
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
      const loop = assertedLoop
        || clipName === 'Running in place' || clipName === 'Running While Holding Something';
      // Anchored one-shots are started by honourCues with a seek, not here.
      if (!ANCHORED.has(clipName)) this.play(clipName, { loop, priority, time });
    }
    if (!clipName && this.clipName && !this.lock) this.stop(time);
    this.mixer.update(dt);
    return !!this.clipName;
  }

  honourCues(time) {
    if (!this.cues?.length) return;
    for (const cue of this.cues) {
      const key = `${cue.kind}:${cue.at.toFixed(3)}`;
      if (this.scheduled.has(key)) continue;
      if (time < cue.at) continue;
      this.scheduled.add(key);
      const selection = cue.kind === 'throw'
        ? getRiggedAnimationSelection(POSE.THROW)
        : getRiggedAnimationSelection(POSE.CATCH);
      const clipName = selection?.clipName;
      const clip = clipName && this.clips.get(clipName);
      if (!clip) continue;
      const spec = ANCHORED.get(clipName);
      const anchor = spec ? measureAnchor(this.clips, clipName, spec, this.root) : 0;
      // start the clip early enough that its anchor frame lands on the recorded
      // event; if we are already late, seek into it instead of restarting
      const anchorTime = anchor * clip.duration;      // where the release/reach sits in the clip
      const lead = Math.min(anchorTime, MAX_LEAD);    // how much windup we are willing to play
      const startAt = cue.anchorAt - lead;
      // invariant: clip time = anchorTime + (playback time - anchor time), so the
      // anchor lands on the recorded event whether we started on time or late
      const offset = time > startAt
        ? clamp(anchorTime + (time - cue.anchorAt), 0, clip.duration - 1e-3)
        : Math.max(0, anchorTime - lead);
      this.lastAnchorAt = cue.anchorAt;
      this.play(clipName, {
        loop: false,
        priority: cue.kind === 'throw' ? POSE_PRIORITY[POSE.THROW] : POSE_PRIORITY[POSE.CATCH],
        time,
        offset,
        lockUntil: cue.anchorAt + FOLLOW_THROUGH,
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
    // carry the locomotion phase across so the stride does not pop when a run
    // clip replaces a backpedal clip
    if (loop && prev && prev.getClip() !== clip && LOOPING_CLIPS.has(prev.getClip().name)) {
      const prevDur = prev.getClip().duration || 1;
      const phase = (prev.time / prevDur) % 1;
      next.time = phase * clip.duration;
    }
    next.setEffectiveWeight(prev ? 0 : 1);
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

const LOOPING_CLIPS = new Set(['Running in place', 'Running Backward in place', 'Pushing In Place', 'Football Stance']);
