import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adaptLpGamePayload, validatePregameSourcePin } from '../web/lp-game-record-adapter.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(resolve(root, 'docs/fixtures/pregame/MANIFEST.json'), 'utf8'));
const entry = manifest.fixtures[0];
const bytes = await readFile(resolve(root, 'docs/fixtures/pregame', entry.file));
const hash = createHash('sha256').update(bytes).digest('hex');
assert.equal(hash, entry.sha256, 'the frozen fixture must match its manifest checksum');
const payload = JSON.parse(bytes.toString('utf8'));

assert.equal(validatePregameSourcePin(payload, manifest, entry), true);
const adapted = adaptLpGamePayload(payload, { requireCompleteRegulation: false });
assert.equal(adapted.validation.findings.length, 0);
assert.equal(adapted.record.game_id, '2026_07_KC_SEA');
assert.equal(adapted.record.teams.away, 'KC');
assert.equal(adapted.record.teams.home, 'SEA');
assert.ok(Date.parse(adapted.record.as_of_utc) < Date.parse(adapted.record.scheduled_kickoff_utc));
assert.equal(adapted.record.roster_snapshot_id, payload.pregame_snapshot.roster_snapshot_id);
assert.equal(adapted.record.valid_full_game, false, 'unresolved rules remain an explicit gate');

const rosterByPlayer = new Map(Object.values(payload.pregame_snapshot.rosters).flatMap((team) =>
  team.players.map((player) => [`${player.gsis_id}:${player.pos_abb}`, player])));
for (const drive of adapted.drives) {
  for (const play of drive.plays) {
    for (const role of ['passer', 'rusher', 'receiver']) {
      const id = play.source.participants[`${role}_id`];
      if (id == null) continue;
      assert.ok(rosterByPlayer.has(`${id}:${play.source.participants[`${role}_position`]}`),
        `${role} must resolve within the pinned roster`);
    }
  }
}
for (const player of adapted.record.stats.player) {
  assert.ok(rosterByPlayer.has(`${player.player_id}:${player.player_position}`));
}
assert.ok(adapted.record.stats.player.some((player) => player.player_position === 'RB' && player.receiving?.tgt),
  'the seeded game should exercise eligible running back targets');
assert.deepEqual(
  adapted.record.stats.player.filter((player) => player.passing).map((player) => player.player_name).sort(),
  ['Patrick Mahomes', 'Sam Darnold'].sort(),
  'the frozen QB1s handle each team’s passing line',
);

const changedProducer = structuredClone(payload);
const firstProducerFile = Object.keys(changedProducer.source.producer_file_sha256)[0];
changedProducer.source.producer_file_sha256[firstProducerFile] = '0'.repeat(64);
assert.throws(() => validatePregameSourcePin(changedProducer, manifest, entry), /producer code hashes differ/);

const incompatibleContract = structuredClone(payload);
incompatibleContract.contract.version = '2.0.0';
assert.throws(() => validatePregameSourcePin(incompatibleContract, manifest, entry), /must use/);
assert.throws(() => adaptLpGamePayload(incompatibleContract), /unsupported payload contract/);

const corruptedRecord = structuredClone(payload);
corruptedRecord.record.drives[0].plays[0].outcome.yards_gained = 'corrupted';
assert.throws(() => adaptLpGamePayload(corruptedRecord, { requireCompleteRegulation: false }), /yards_gained/);
const corruptedBytes = Buffer.from(bytes.toString('utf8').replace(/("yards_gained": )(-?\d+)/, (_match, prefix, value) =>
  `${prefix}${Number(value) === 0 ? 1 : 0}`));
assert.notEqual(createHash('sha256').update(corruptedBytes).digest('hex'), entry.sha256,
  'a changed fixture record must fail the manifest checksum');

console.log(`pregame game integration passed: ${adapted.sourcePlayCount} plays, ${adapted.record.stats.player.length} player lines, pinned producer and snapshot`);
