import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { adaptLpGamePayload, validatePregameSourcePin } from '../web/lp-game-record-adapter.js';
import { createWeek7StatisticalGame, simulateWeek7StatisticalPlay } from '../web/week7-statistical-model.js';

const manifest = JSON.parse(await readFile(new URL('../docs/fixtures/pregame/MANIFEST.json', import.meta.url), 'utf8'));
const entry = manifest.fixtures.find((fixture) => fixture.file === manifest.default_fixture);
assert.ok(entry, 'the active full-depth game fixture is pinned');
assert.ok(entry.roster_snapshot, 'the active fixture pins its full-depth roster');
const bytes = await readFile(new URL(`../docs/fixtures/pregame/${entry.file}`, import.meta.url));
assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256);
const payload = JSON.parse(bytes.toString('utf8'));
assert.equal(validatePregameSourcePin(payload, manifest, entry), true);
const rosterBytes = await readFile(new URL(`../${entry.roster_snapshot.file}`, import.meta.url));
const provenanceBytes = await readFile(new URL(`../${entry.roster_snapshot.provenance_file}`, import.meta.url));
const rosterSha = createHash('sha256').update(rosterBytes).digest('hex');
assert.equal(rosterSha, entry.roster_snapshot.sha256);
assert.equal(createHash('sha256').update(provenanceBytes).digest('hex'), entry.roster_snapshot.provenance_sha256);
assert.equal(JSON.parse(provenanceBytes.toString('utf8')).output.sha256, rosterSha);
assert.equal(payload.pregame_snapshot.roster_snapshot_source.full_depth_roster_sha256, rosterSha);
const adapted = adaptLpGamePayload(payload);
const game = createWeek7StatisticalGame(payload);
const expectedRoleRows = { KC: 74, SEA: 70 };
const rosterById = new Map(Object.values(payload.pregame_snapshot.rosters)
  .flatMap((roster) => roster.players.map((player) => [player.gsis_id, player])));
for (const roster of Object.values(payload.pregame_snapshot.rosters)) {
  assert.equal(roster.players.length, expectedRoleRows[roster.team]);
  assert.equal(new Set(roster.players.map((player) => player.gsis_id)).size, 63);
  assert.equal(roster.players.filter((player) => player.starter).length, 28);
  assert.ok(roster.players.every((player) => Number.isInteger(player.jersey_number)));
  assert.ok(roster.players.some((player) => !player.starter && player.group === '3WR 1TE' && player.pos_abb === 'RB'));
  assert.ok(roster.players.some((player) => !player.starter && player.group === '3WR 1TE' && player.pos_abb === 'WR'));
}
assert.ok(adapted.record.stats.player.some((stat) => rosterById.get(stat.player_id)?.starter === false),
  'the pinned game allocates statistics to at least one depth-chart backup');

const OFFENSE = new Set(['QB', 'RB', 'TE', 'WR1', 'WR2', 'WR3', 'LT', 'LG', 'C', 'RG', 'RT']);
let plays = 0, offenseBodies = 0, offenseNumbered = 0, defenseBodies = 0, specialTeamsBodies = 0;
for (const drive of adapted.drives) {
  for (const ip of drive.plays) {
    const replay = simulateWeek7StatisticalPlay(game, ip.source);
    for (const [side, slots] of Object.entries(replay.script.lineup)) {
      if (side === replay.script.def) {
        const defenders = Object.values(slots);
        assert.equal(new Set(defenders).size, 11, `LP play ${ip.source.sequence} has 11 distinct defenders`);
        for (const pid of defenders) {
          const body = game.players[pid];
          assert.ok(body, `defender ${pid} resolves to a frozen roster player`);
          assert.notEqual(body.jersey, '?', `defender ${body.name} has a jersey number`);
          defenseBodies++;
        }
      }
      for (const [slot, ref] of Object.entries(slots)) {
        if (!OFFENSE.has(slot)) continue;
        const body = game.players[ref];
        offenseBodies++;
        if (body && body.jersey !== '?') offenseNumbered++;
      }
    }
    for (const players of Object.values(replay.script.units ?? {})) {
      for (const pid of players) {
        const body = game.players[pid];
        assert.ok(body, `special-teams player ${pid} resolves to a frozen roster player`);
        assert.notEqual(body.jersey, '?', `special-teams player ${body.name} has a jersey number`);
        specialTeamsBodies++;
      }
    }
    plays++;
  }
}
assert.equal(plays, adapted.sourcePlayCount, 'every play in the pinned full-depth game replays');
assert.equal(offenseNumbered, offenseBodies, `every offensive body on the field has a jersey number (${offenseNumbered}/${offenseBodies})`);
assert.equal(defenseBodies, plays * 11);
console.log(`PASS: all ${plays} pinned plays replay; ${offenseNumbered}/${offenseBodies} offensive and ${defenseBodies}/${defenseBodies} defensive bodies have jersey numbers; ${specialTeamsBodies} special-teams slots resolve; backup stats resolve`);
