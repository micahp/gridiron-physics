// Basketball player body, in the same part format as the football body (web/stack/body.js):
// each part lives in one joint's frame, has signed-distance shapes and a palette index per point.
// The shared surface code (web/mesh/body-mesh.js) turns these parts into the skinned mesh.
//
// Anatomy and uniform are basketball's: a sleeveless jersey, short shorts, bare arms and thighs
// below the shorts, socks, sneakers. Proportions follow the skeleton (skeleton.js): 1.81 m to the
// crown, 0.492 m arm, 0.45 m thigh, 0.43 m shin. Palette indices are the football palette, so the
// same kit system and number plates apply.
import { PAL, sdRoundBox, sdEllipsoid, sdCone } from '../stack/body.js';

const P = PAL;
const HAIR = P.EYE;   // dark hair: the palette's darkest brown

// number plates on the chest, front and back, as the football body does them
const u15 = (z) => Math.min(15, Math.max(0, Math.round(z * 15)));
function chestMat(p) {
  if (p[1] > -0.02 && p[1] < 0.24 && Math.abs(p[2]) < 0.135) {
    const v = u15((p[1] + 0.02) / 0.26);
    if (p[0] > 0.085) return [P.NUM_F, u15((0.135 - p[2]) / 0.27), v];
    if (p[0] < -0.085) return [P.NUM_B, u15((p[2] + 0.135) / 0.27), v];
  }
  return P.JERSEY;
}

/** Parts for one body. Local frames: x forward, y up (along the bone), z the player's right. */
export const BASKET_PARTS = [];
const part = (o) => BASKET_PARTS.push({ prio: 1, thin: false, ...o });

// pelvis and shorts seat
part({
  joint: 'pelvis', bounds: [[-0.2, -0.15, -0.22], [0.2, 0.18, 0.22]],
  sdf: (p) => sdRoundBox(p, [0, 0.02, 0], [0.13, 0.09, 0.165], 0.05),
  mat: (p) => (p[1] > 0.085 ? P.BELT : P.PANTS),
});

// abdomen and chest (jersey), chest carries the number plates
part({
  joint: 'spine', bounds: [[-0.14, -0.06, -0.16], [0.14, 0.22, 0.16]],
  sdf: (p) => sdRoundBox(p, [0, 0.1, 0], [0.105, 0.11, 0.138], 0.06),
  mat: () => P.JERSEY,
});
part({
  joint: 'chest', prio: 1, bounds: [[-0.16, -0.08, -0.2], [0.16, 0.3, 0.2]],
  sdf: (p) => sdRoundBox(p, [0, 0.13, 0], [0.115, 0.14, 0.155], 0.065),
  mat: chestMat,
});

// neck and head: skin, a hair cap, eyes on the front
part({
  joint: 'neck', bounds: [[-0.09, -0.06, -0.09], [0.09, 0.16, 0.09]],
  sdf: (p) => sdCone(p, [0, -0.02, 0], [0, 0.1, 0], 0.055, 0.05),
  mat: () => P.SKIN,
});
part({
  joint: 'head', prio: 2, bounds: [[-0.12, -0.1, -0.12], [0.14, 0.26, 0.12]],
  sdf: (p) => sdEllipsoid(p, [0.005, 0.075, 0], [0.095, 0.115, 0.09]),
  mat: () => P.SKIN,
});
part({
  joint: 'head', prio: 2, bounds: [[-0.12, -0.02, -0.12], [0.12, 0.26, 0.12]],
  sdf: (p) => sdEllipsoid(p, [-0.005, 0.135, 0], [0.1, 0.075, 0.1]),
  mat: () => HAIR,
});
for (const s of [1, -1]) {
  part({
    joint: 'head', prio: 3, bounds: [[0.05, 0.04, -0.06], [0.12, 0.11, 0.06]],
    sdf: (p) => sdEllipsoid(p, [0.085, 0.085, s * 0.035], [0.012, 0.012, 0.012]),
    mat: () => P.EYE,
  });
}

// arms: shoulder ball, bicep and upper arm (bare), forearm, hand. Mirrored for each side.
for (const s of ['R', 'L']) {
  part({
    joint: 'sh' + s, bounds: [[-0.1, -0.12, -0.1], [0.1, 0.12, 0.1]],
    sdf: (p) => sdEllipsoid(p, [0, 0, 0], [0.065, 0.065, 0.065]),
    mat: () => P.SKIN,
  });
  part({
    joint: 'sh' + s, bounds: [[-0.1, -0.35, -0.1], [0.1, 0.02, 0.1]],
    sdf: (p) => sdCone(p, [0, 0, 0], [0, -0.303, 0], 0.056, 0.046),
    mat: () => P.SKIN,
  });
  part({
    joint: 'sh' + s, bounds: [[-0.1, -0.22, -0.1], [0.1, -0.02, 0.1]],
    sdf: (p) => sdEllipsoid(p, [0, -0.12, 0], [0.058, 0.085, 0.058]),
    mat: () => P.SKIN,
  });
  part({
    joint: 'el' + s, bounds: [[-0.08, -0.22, -0.08], [0.08, 0.04, 0.08]],
    sdf: (p) => sdCone(p, [0, 0, 0], [0, -0.189, 0], 0.048, 0.036),
    mat: () => P.SKIN,
  });
  part({
    joint: 'palm' + s, bounds: [[-0.09, -0.08, -0.09], [0.09, 0.06, 0.09]],
    sdf: (p) => sdEllipsoid(p, [0, 0, 0], [0.05, 0.03, 0.045]),
    mat: () => P.SKIN,
  });
}

// legs: shorts on the thigh, bare thigh below them, calf, sock, sneaker. Mirrored for each side.
for (const s of ['R', 'L']) {
  part({
    joint: 'hip' + s, bounds: [[-0.12, -0.5, -0.12], [0.12, 0.04, 0.12]],
    sdf: (p) => sdCone(p, [0, 0, 0], [0, -0.2, 0], 0.085, 0.075),
    mat: () => P.PANTS,
  });
  part({
    joint: 'hip' + s, bounds: [[-0.12, -0.5, -0.12], [0.12, 0.04, 0.12]],
    sdf: (p) => sdCone(p, [0, -0.2, 0], [0, -0.45, 0], 0.075, 0.062),
    mat: () => P.SKIN,
  });
  part({
    joint: 'kn' + s, bounds: [[-0.1, -0.46, -0.1], [0.1, 0.04, 0.1]],
    sdf: (p) => sdCone(p, [0, 0, 0], [0, -0.43, 0], 0.062, 0.045),
    mat: (p) => (p[1] < -0.22 ? P.SOCK : P.SKIN),
  });
  part({
    joint: 'an' + s, bounds: [[-0.08, -0.12, -0.08], [0.2, 0.06, 0.08]],
    sdf: (p) => sdRoundBox(p, [0.05, -0.05, 0], [0.1, 0.05, 0.05], 0.03),
    mat: () => P.CLEAT,
  });
  part({
    joint: 'an' + s, bounds: [[-0.08, -0.14, -0.08], [0.2, 0.0, 0.08]],
    sdf: (p) => sdRoundBox(p, [0.05, -0.1, 0], [0.11, 0.012, 0.055], 0.01),
    mat: () => P.SOLE,
  });
}
