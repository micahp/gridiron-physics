// One frame of a paired tackle for the attacker, the same in the game, the lab
// and the validator: contact IK puts his palms on the carrier, then collision
// pushes his body out of the carrier's. Everything here is metres.
//   recv: { J, place }    carrier's joints and placement this frame
//   att:  { pose, place } tackler's pose and placement (place.ground = last frame's)
// Returns the tackler's pose (lift raised when he lands on top) and his drawn position.
import { fk } from '../stack/skeleton.js';
import { applyTackleIK } from './ik.js';
import { capsules, resolveContact, placeToWorld } from './contact.js';

export function solveTackler(w, t, dt, recv, att, { ik = true, collide = true } = {}) {
  const sep = w.sep || (w.sep = [0, 0, 0]);
  const place = { ...att.place, x: att.place.x + sep[0], z: att.place.z + sep[2] };
  let pose = att.pose;
  if (ik) pose = applyTackleIK(pose, w, t, { attacker: place, attScale: place.scale, attGround: place.ground, recvJ: recv.J, recvWorld: (p) => placeToWorld(recv.place, p) });
  if (collide) {
    const J = fk(pose);
    w.lastDepth = resolveContact(w, capsules(J, { ...place, ground: place.ground }, { arms: true }), capsules(recv.J, recv.place), dt);
    place.x = att.place.x + sep[0]; place.z = att.place.z + sep[2];
  }
  const k = place.scale || 1;
  pose = { ...pose, root: { ...pose.root, lift: (pose.root.lift || 0) + sep[1] / k } };
  return { pose, x: place.x, z: place.z };
}
