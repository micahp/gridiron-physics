import assert from 'node:assert/strict';
import { createQbEyes, probeSightline } from '../engine/autonomous/perception.js';

// Meters. The quarterback stands at the origin facing +x with his gaze on his body heading.
const YD = 0.9144;
const body = (id, x, y, group = 'OL', r = 0.35, down = false) => ({ id, p: { x, y }, v: { x: 0, y: 0 }, r, down, info: { group } });
const qb = { id: 'O.QB', p: { x: 0, y: 0 }, v: { x: 0, y: 0 }, h: 0, r: 0.3, down: false, info: { group: 'QB' } };
const receiver = (x, y) => body('O.WR2', x, y, 'WR', 0.3);
const see = (model, target, others) => probeSightline(createQbEyes(qb, model), target, [qb, target, ...others]).visible;

const TWENTY_YD = 20 * YD;
const results = [];
const check = (name, predicted, actual) => {
  results.push({ name, predicted, actual });
  assert.deepEqual(actual, predicted, `${name}: predicted ${predicted}, geometry gave ${actual}`);
};

for (const model of ['chest', 'anatomical']) {
  const wr = receiver(TWENTY_YD, 0);
  check(`${model}: clear receiver at 20 yd is visible`, true, see(model, wr, []));
  check(`${model}: lineman on the sightline at mid-field hides him`, false, see(model, wr, [body('O.LT', TWENTY_YD / 2, 0)]));
  check(`${model}: lineman 0.30 m off the line still hides him (inside a 0.35 m body)`, false, see(model, wr, [body('O.LT', TWENTY_YD / 2, 0.30)]));
  check(`${model}: lineman 0.40 m off the line leaves him visible`, true, see(model, wr, [body('O.LT', TWENTY_YD / 2, 0.40)]));
  check(`${model}: receiver beyond 30 yd is out of range`, false, see(model, receiver(31 * YD, 0), []));
  check(`${model}: receiver 10 m away at 80 degrees is outside the field of view`, false, see(model, receiver(10 * Math.cos(80 * Math.PI / 180), 10 * Math.sin(80 * Math.PI / 180)), []));
  // Mirror symmetry: a lineman on either side of the line hides a receiver on that side, and the results match.
  check(`${model}: left-side lineman hides a left-side receiver`, false, see(model, receiver(TWENTY_YD, 0.5), [body('O.LT', TWENTY_YD / 2, 0.5)]));
  check(`${model}: right-side lineman hides a right-side receiver`, false, see(model, receiver(TWENTY_YD, -0.5), [body('O.LT', TWENTY_YD / 2, -0.5)]));
  const mirrorWr = receiver(TWENTY_YD, -0.5);
  check(`${model}: receiver 0.5 m off the line, open on the other side`, true, see(model, mirrorWr, []));
}

// A downed lineman is about half a meter high, so he should not block a sightline.
const downed = body('O.LT', TWENTY_YD / 2, 0, 'OL', 0.35, true);
check('anatomical: downed lineman does not block', true, see('anatomical', receiver(TWENTY_YD, 0), [downed]));
const chestDowned = see('chest', receiver(TWENTY_YD, 0), [downed]);
results.push({ name: 'chest: downed lineman (documented deviation, original model keeps full height)', predicted: true, actual: chestDowned });

// A moving lineman: visibility flips when his footprint leaves the corridor.
{
  const wr = receiver(TWENTY_YD, 0);
  const lineman = body('O.LT', TWENTY_YD / 2, 0);
  const eyes = createQbEyes(qb, 'chest');
  const before = probeSightline(eyes, wr, [qb, wr, lineman]).visible;
  lineman.p = { x: TWENTY_YD / 2, y: 0.8 };
  const after = probeSightline(eyes, wr, [qb, wr, lineman]).visible;
  check('moving lineman: hidden on the line, visible once he steps 0.8 m off', [false, true], [before, after]);
}

console.log(JSON.stringify(results.map((r) => [r.name, r.predicted, r.actual])));
console.log('autonomous sightline ok: clear, occluded, corridor edge, range, field of view, mirror, downed body, moving body');
