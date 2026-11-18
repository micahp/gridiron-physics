// Pose crossfade shared by the game, the labs and the validator.
/** Blend two filled poses (angles and root fields linearly; flags from b). */
export function lerpPose(a, b, w) {
  if (w >= 1) return b;
  const o = {};
  for (const k in b) {
    const x = a[k], y = b[k];
    if (Array.isArray(y)) o[k] = y.map((v, i) => (x?.[i] ?? v) + (v - (x?.[i] ?? v)) * w);
    else if (y && typeof y === 'object') { o[k] = {}; for (const r in y) o[k][r] = (x?.[r] ?? y[r]) + (y[r] - (x?.[r] ?? y[r])) * w; }
    else if (typeof y === 'number') o[k] = (typeof x === 'number' ? x : y) + (y - (typeof x === 'number' ? x : y)) * w;
    else o[k] = y;
  }
  return o;
}

