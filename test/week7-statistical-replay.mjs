import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createWeek7StatisticalGame, simulateWeek7StatisticalPlay } from '../web/week7-statistical-model.js';
import { adaptLpGamePayload, validatePregameSourcePin } from '../web/lp-game-record-adapter.js';

const fixturePath = new URL('../docs/fixtures/pregame/game-kc-sea-seed8-blocked.json', import.meta.url);
const manifestPath = new URL('../docs/fixtures/pregame/MANIFEST.json', import.meta.url);
const fixtureBytes = await readFile(fixturePath);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const entry = manifest.fixtures[0];
assert.equal(createHash('sha256').update(fixtureBytes).digest('hex'), entry.sha256, 'pinned fixture checksum');
const payload = JSON.parse(fixtureBytes.toString('utf8'));
assert.equal(validatePregameSourcePin(payload, manifest, entry), true);
const sourceBefore = JSON.stringify(payload);
const adapted = adaptLpGamePayload(payload);
assert.equal(adapted.validation.passed, true);
assert.equal(adapted.record.valid_full_game, true);

const game = createWeek7StatisticalGame(payload);
const eventCounts = {};
let blockedReplay = null;
let replayed = 0;
for (const drive of adapted.drives) {
  for (const indexedPlay of drive.plays) {
    const play = indexedPlay.source;
    eventCounts[play.event_type] = (eventCounts[play.event_type] ?? 0) + 1;
    const replay = simulateWeek7StatisticalPlay(game, play);
    assert.equal(replay.record.roster.length, 22, `LP play ${play.sequence} has a 22-player replay`);
    assert.equal(new Set(replay.record.roster.map((player) => player.id)).size, 22,
      `LP play ${play.sequence} uses distinct replay bodies`);
    assert.ok(replay.record.frames.length > 1, `LP play ${play.sequence} has 3D frames`);
    if (play.event_type === 'blocked_field_goal') blockedReplay = replay;
    replayed += 1;
  }
}

assert.equal(replayed, 144);
assert.equal(eventCounts.blocked_field_goal, 1);
assert.equal(blockedReplay?.visualKind, 'blocked_kick');
assert.equal(sourceBefore, JSON.stringify(payload), '3D generation must not mutate LP results');
console.log(`PASS: ${replayed} pinned LP plays replay with 22 Gridiron bodies; LP source remains immutable; blocked FG cue rendered.`);
