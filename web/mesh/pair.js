// One frame of a paired tackle for the attacker, the same in the game, the lab
// and the validator. Order matters: the body is separated first (torso, pelvis,
// head, legs pushed out of the carrier), then the arms are solved from where the
// body ended up (palms on, elbows clear), so the root push can't undo the hand
// contact. Everything here is metres.
//   recv: { J, place }    carrier's joints and placement this frame
//   att:  { pose, place } tackler's pose and placement (place.ground = last frame's)
import { fk } from '../stack/skeleton.js';
import { applyContactIK, applyCarrierArm } from './ik.js';
import { capsules, resolveContact, bodyDistance } from './contact.js';

export function solveTackler(w, t, dt, recv, att, { ik = true, collide = true } = {}) {
  const sep = w.sep || (w.sep = [0, 0, 0]);
  const recvBody = capsules(recv.J, recv.place, { arms: true });
  let pose = att.pose;
  // 1. body separation (the tackler's arms are not part of it: they are solved next)
  if (collide) {
    const at = { ...att.place, x: att.place.x + sep[0], z: att.place.z + sep[2] };
    w.lastDepth = resolveContact(w, capsules(fk(pose), at), recvBody, dt);
  }
  const k = att.place.scale || 1;
  const place = { ...att.place, x: att.place.x + sep[0], z: att.place.z + sep[2], ground: (att.place.ground || 0) };
  pose = { ...pose, root: { ...pose.root, lift: (pose.root.lift || 0) + sep[1] / k } };
  // 2. arms, from where the body is now
  if (ik) pose = applyContactIK(pose, w, t, { place, recvJ: recv.J, recvPlace: recv.place, recvDist: (p) => bodyDistance(recv.J, recv.place, p) });
  return { pose, x: place.x, z: place.z };
}

/** After the tackler is placed: the carrier's free arm, kept clear of the tackler (hand on his pad when head-on). */
export function solveCarrierArm(w, t, carrier, tackler) {
  return applyCarrierArm(carrier.pose, w, t, { place: carrier.place, attJ: tackler.J, attPlace: tackler.place, attDist: (p) => bodyDistance(tackler.J, tackler.place, p) });
}
