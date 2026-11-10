// Uniform detail beyond the jersey: team gloves, striped socks and team-colored cleats are repainted into the model's
// own textures; pure pixel passes, no browser needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { recolorSkinAtlas, recolorCleatAtlas } from '../web/rigged-player.js';

const SIZE = 2048;
const KIT = { pants: '#111111', sock: '#111111', trim: '#ff0000', number: '#ffffff', glove: '#00ff00' };

function atlas() {
  const d = new Uint8ClampedArray(SIZE * SIZE * 4);
  for (let i = 0; i < d.length; i += 4) d[i + 3] = 255;     // opaque black background
  return d;
}
const put = (d, x, y, r, g, b) => { const i = (y * SIZE + x) * 4; d[i] = r; d[i + 1] = g; d[i + 2] = b; };
const at = (d, x, y) => { const i = (y * SIZE + x) * 4; return [d[i], d[i + 1], d[i + 2]]; };

test('gloves: dark cloth takes the glove colour, the white swoosh takes the number colour, the background stays black', () => {
  const d = atlas();
  put(d, 200, 1000, 30, 30, 30);            // dark glove cloth, inside the left glove island
  put(d, 220, 1000, 240, 240, 240);         // white swoosh
  recolorSkinAtlas(d, SIZE, KIT);
  const [r, g, b] = at(d, 200, 1000);
  assert.ok(g > 120 && r < 40 && b < 40, `glove cloth should be green, got ${at(d, 200, 1000)}`);
  const sw = at(d, 220, 1000);
  assert.ok(sw[0] > 180 && sw[1] > 180 && sw[2] > 180, `swoosh should be white, got ${sw}`);
  assert.deepEqual(at(d, 100, 1600), [0, 0, 0], 'outside the glove islands nothing changes');
});

test('socks: skin pixels of the calf islands become sock colour with two stripes, arms and face stay skin', () => {
  const d = atlas();
  const [x0, y0, x1, y1] = [1193, 869, 1680, 1108];                      // first calf island (2048 px)
  const skin = [226, 180, 165];
  const rows = [y0 + 2, Math.round(y0 + 0.24 * (y1 - y0)), Math.round(y0 + 0.37 * (y1 - y0)), Math.round(y0 + 0.5 * (y1 - y0)), y1 - 4];
  for (const y of rows) put(d, 1300, y, ...skin);
  put(d, 1800, 300, ...skin);                                            // arm island pixel: must not change
  recolorSkinAtlas(d, SIZE, KIT);
  const base = at(d, 1300, rows[0]), stripe1 = at(d, 1300, rows[1]), gap = at(d, 1300, rows[2]), stripe2 = at(d, 1300, rows[3]), ankle = at(d, 1300, rows[4]);
  assert.ok(base[0] < 40 && base[1] < 40, `sock base is the sock colour (black), got ${base}`);
  assert.ok(stripe1[0] > 200 && stripe1[1] < 40, `first stripe is the trim colour (red), got ${stripe1}`);
  assert.ok(gap[0] < 40, `between the stripes is sock base, got ${gap}`);
  assert.ok(stripe2[0] > 200, `second stripe is red, got ${stripe2}`);
  assert.ok(ankle[0] < 40, `the ankle end is sock base, got ${ankle}`);
  assert.deepEqual(at(d, 1800, 300), skin, 'the arm island is untouched');
});

test('cleats: dark leather takes the team colour and keeps its shading; stud holes stay dark', () => {
  const d = new Uint8ClampedArray(4 * 4);
  for (let i = 0; i < 4; i++) d[i * 4 + 3] = 255;
  d.set([20, 20, 20], 0);       // dim leather
  d.set([60, 60, 60], 4);       // brighter leather (a highlight)
  d.set([2, 2, 2], 8);          // stud hole
  recolorCleatAtlas(d, 2, '#ff0000');
  assert.ok(d[0] > 100 && d[1] < 10 && d[2] < 10, `leather becomes red, got ${[d[0], d[1], d[2]]}`);
  assert.ok(d[4] > d[0], 'a brighter source pixel stays brighter');
  assert.deepEqual([d[8], d[9], d[10]], [2, 2, 2], 'the stud hole is untouched');
});
