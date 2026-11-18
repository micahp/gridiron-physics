// Planted-foot slide of every gait, on its own (tackle acceptance does not use
// foot slide until this passes). Each gait is played at speeds across its range
// with the cycle driven by the stride measured from the animation (stride.js);
// a foot is planted while its sole is within 3.5 cm of the turf, and its slide
// is how far it moves across the turf during one plant.
//   node tools/validate-locomotion.mjs
import * as THREE from '../web/vendor/three.module.js';
import { ACTIONS } from '../web/stack/actions.js';
import { buildBody, MeshPlayer } from '../web/mesh/body-mesh.js';
import { strideOf } from '../web/mesh/stride.js';
import { TACKLE_WRAP } from '../web/mesh/interactions.js';

const LIMIT = TACKLE_WRAP.limits.foot_slide_m, DT = 1 / 60;
const body = buildBody(0.03);
const GAITS = {
  walk: { dir: 0, speeds: [1, 1.5, 2] }, jog: { dir: 0, speeds: [2.5, 3.5, 4.5] }, sprint: { dir: 0, speeds: [5.5, 7, 8.5] },
  carry: { dir: 0, speeds: [5, 6.5, 8] }, stiffL: { dir: 0, speeds: [5, 6.5] }, backpedal: { dir: Math.PI, speeds: [1.5, 2.5, 3.5] },
  shuffleR: { dir: Math.PI / 2, speeds: [1, 2] }, shuffleL: { dir: -Math.PI / 2, speeds: [1, 2] },
};
const v = new THREE.Vector3();
let fails = 0;
for (const [name, g] of Object.entries(GAITS)) {
  const stride = strideOf(name, ACTIONS[name].fn);
  const row = [];
  for (const sp of g.speeds) {
    const mp = new MeshPlayer(body, { kit: {}, ownBall: false });
    let x = 0, z = 0, ph = 0, worst = 0;
    const plant = { R: null, L: null };
    for (let f = 0; f < 240; f++) {
      x += Math.cos(g.dir) * sp * DT; z += Math.sin(g.dir) * sp * DT; ph += (sp / stride) * DT;
      mp.setPose(ACTIONS[name].fn(((ph % 1) + 1) % 1), x, z, 0);
      mp.root.updateMatrixWorld(true);
      for (const s of ['R', 'L']) {
        const j = mp.J['an' + s];
        const p = v.set(j.p[0] + j.R[0] * 0.05 + j.R[1] * -0.075, j.p[1] + j.R[3] * 0.05 + j.R[4] * -0.075, j.p[2] + j.R[6] * 0.05 + j.R[7] * -0.075).applyMatrix4(mp.inner.matrixWorld);
        if (p.y < 0.035) { if (!plant[s]) plant[s] = p.clone(); if (f > 30) worst = Math.max(worst, Math.hypot(p.x - plant[s].x, p.z - plant[s].z)); }
        else plant[s] = null;
      }
    }
    if (worst > LIMIT) fails++;
    row.push(`${sp} m/s: ${(worst * 100).toFixed(1)} cm${worst > LIMIT ? ' FAIL' : ''}`);
  }
  console.log(`${name.padEnd(10)} stride ${stride.toFixed(2)} m   ${row.join('   ')}`);
}
console.log(fails ? `${fails} gait/speed cases over the ${LIMIT * 100} cm limit` : `all gaits under ${LIMIT * 100} cm per plant`);
