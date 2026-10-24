import { readFileSync } from 'node:fs';
const root = '/root/scratch-engines/ec18dee-diag';
globalThis.__win = true; globalThis.__log = [];
const { simulateGame } = await import(`${root}/engine/game.js`);
const game = JSON.parse(readFileSync(`${root}/web/data/game.json`, 'utf8'));
simulateGame(game);
const L = globalThis.__log;
const JONES = '4039059', WILSON = '4887558';
for (const e of L) {
  if (e.kind === 'spring' || e.kind === 'drag' || e.kind === 'contact') console.log(JSON.stringify(e));
  else if (e.kind === 'pre' && e.id === JONES) console.log('  pre  JONES', JSON.stringify({t: e.t, v: e.v, ext: e.ext, mode: e.mode, engaged: e.engaged}));
  else if (e.kind === 'post' && e.id === JONES) console.log('  post JONES', JSON.stringify({t: e.t, v: e.v, p: e.p}));
  else if (e.kind === 'pre' && e.id === WILSON) console.log('  pre  WILSON', JSON.stringify({t: e.t, v: e.v, ext: e.ext, mode: e.mode}));
}
