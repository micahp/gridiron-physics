import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { adaptLpGamePayload } from '../web/lp-game-record-adapter.js';
import { createWeek7StatisticalGame, simulateWeek7StatisticalPlay } from '../web/week7-statistical-model.js';

// Starters from the nflverse depth chart, with jersey numbers, replace the frozen partial roster for this check only.
// The pinned fixture is not modified; its checksum is still enforced by week7-statistical-replay.mjs.
const payload = JSON.parse(await readFile(new URL('../docs/fixtures/pregame/game-kc-sea-seed8-blocked.json', import.meta.url), 'utf8'));
const starters = JSON.parse(await readFile(new URL('../docs/fixtures/rosters/kc-sea-2026-10-25-starters.json', import.meta.url), 'utf8'));
payload.pregame_snapshot.rosters = starters.rosters;
const adapted = adaptLpGamePayload(payload);
const game = createWeek7StatisticalGame(payload);

const OFFENSE = new Set(['QB', 'RB', 'TE', 'WR1', 'WR2', 'WR3', 'LT', 'LG', 'C', 'RG', 'RT']);
let plays = 0, offenseBodies = 0, offenseNumbered = 0;
outer: for (const drive of adapted.drives) {
  for (const ip of drive.plays) {
    const replay = simulateWeek7StatisticalPlay(game, ip.source);
    for (const [side, slots] of Object.entries(replay.script.lineup)) {
      for (const [slot, ref] of Object.entries(slots)) {
        if (!OFFENSE.has(slot)) continue;
        const body = game.players[ref];
        offenseBodies++;
        if (body && body.jersey !== '?') offenseNumbered++;
      }
    }
    if (++plays >= 40) break outer;
  }
}
assert.equal(offenseNumbered, offenseBodies, `every offensive body on the field has a jersey number (${offenseNumbered}/${offenseBodies})`);
console.log(`PASS: ${offenseNumbered}/${offenseBodies} offensive bodies over ${plays} plays carry snapshot jersey numbers`);
