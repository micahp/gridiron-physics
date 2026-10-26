import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { adaptLpGamePayload, validatePregameSourcePin } from '../web/lp-game-record-adapter.js';
import { createWeek7StatisticalGame, simulateWeek7StatisticalPlay } from '../web/week7-statistical-model.js';

const manifest = JSON.parse(await readFile(new URL('../docs/fixtures/pregame/MANIFEST.json', import.meta.url), 'utf8'));
const entry = manifest.fixtures.find((fixture) => fixture.file === manifest.default_fixture);
assert.ok(entry, 'the active full-starter game fixture is pinned');
const bytes = await readFile(new URL(`../docs/fixtures/pregame/${entry.file}`, import.meta.url));
assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
const payload = JSON.parse(bytes.toString('utf8'));
assert.equal(validatePregameSourcePin(payload, manifest, entry), true);
const adapted = adaptLpGamePayload(payload);
const game = createWeek7StatisticalGame(payload);
for (const roster of Object.values(payload.pregame_snapshot.rosters)) {
  assert.equal(roster.players.length, 28);
  assert.ok(roster.players.every((player) => player.jersey_number !== null));
}

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
console.log(`PASS: ${offenseNumbered}/${offenseBodies} offensive bodies over ${plays} plays carry pinned snapshot jersey numbers`);
