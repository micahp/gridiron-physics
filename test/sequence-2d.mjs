import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { adaptSequence, clockLabel } from '../web/sequence-2d-model.js';

const FIXTURE = new URL('../docs/fixtures/e2/lp-e2-game-seed1-1ca75609.json', import.meta.url);
const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));

function copy() { return structuredClone(fixture); }

test('adapts the checked-in real E2 source record without inventing a future NFL game', () => {
  const parsed = adaptSequence(fixture);
  assert.equal(parsed.source, fixture.record);
  assert.equal(parsed.plays.length, fixture.record.drives.reduce((n, d) => n + d.plays.length, 0));
  assert.equal(parsed.plays[0].id, fixture.record.drives[0].plays[0].id);
  assert.equal(parsed.plays[0].sourcePlay, fixture.record.drives[0].plays[0]);
  assert.equal(parsed.validFullGame, false);
  assert.match(parsed.origin, /Research record/);
  assert.equal(parsed.labels.A, 'A (unidentified)');
  assert.equal(parsed.labels.B, 'B (unidentified)');
  assert.match(parsed.limitation, /No participant coordinates/);
});

test('adapting a supplied run is read only, including nested play state and results', () => {
  const input = copy();
  const original = JSON.stringify(input);
  adaptSequence(input);
  assert.equal(JSON.stringify(input), original);
});

test('supports run_slc_game.py result envelope, raw game, and named team identity', () => {
  const input = copy();
  input.record.team_identity = {A:{team:'ARI',side:'home'}, B:{team:'DAL',side:'away'}};
  input.record.game_id = '2026_08_ARI_DAL';
  const view = adaptSequence({result:input.record,event_trace:[]});
  assert.equal(view.labels.A, 'ARI');
  assert.equal(view.labels.B, 'DAL');
  assert.equal(view.gameId, '2026_08_ARI_DAL');
  assert.equal(adaptSequence(input.record).plays.length, view.plays.length);
});

test('refuses aggregate output instead of hallucinating plays from boxscores', () => {
  assert.throws(() => adaptSequence({summary:{requested_games:10000},boxscore_export:{enabled:true}}),
    /Aggregate 10K batch reports/);
});

test('maps offense-relative yardline_100 and draws only directly sourced same-period displacement', () => {
  const input = copy();
  const play = input.record.drives[0].plays[0];
  play.state_before.yardline_100 = 72;
  play.state_before.yards_to_go = 10;
  play.state_after.yardline_100 = 67;
  const view = adaptSequence(input);
  assert.equal(view.plays[0].startX, 28);
  assert.equal(view.plays[0].endX, 33);
  assert.equal(view.plays[0].lineToGain, 38);
});

test('never draws a continuous route across possession or quarter changes', () => {
  const input = copy();
  input.record.drives[0].plays[0].state_after.offense_team = 'B';
  assert.equal(adaptSequence(input).plays[0].endX, null);
  input.record.drives[0].plays[0].state_after.offense_team = 'A';
  input.record.drives[0].plays[0].state_after.quarter = 2;
  assert.equal(adaptSequence(input).plays[0].endX, null);
});

test('missing source yardline, clock, and scores remain missing', () => {
  const input = copy();
  const play = input.record.drives[0].plays[0];
  play.state_before.yardline_100 = null;
  play.state_before.clock_seconds = null;
  play.state_before.home_score = null;
  play.state_after.yardline_100 = null;
  const parsed = adaptSequence(input).plays[0];
  assert.equal(parsed.startX, null);
  assert.equal(parsed.endX, null);
  assert.equal(parsed.before.home_score, null);
  assert.equal(parsed.before.clock_seconds, null);
  assert.equal(clockLabel(parsed.before.clock_seconds), 'clock unknown');
});

test('fails on invalid/duplicate canonical play ids and nonmonotonic sequences', () => {
  const input = copy();
  const first = input.record.drives[0].plays[0];
  const second = input.record.drives[0].plays[1];
  second.id = first.id;
  assert.throws(() => adaptSequence(input), /duplicate canonical play id/);
  second.id = 'unique';
  second.sequence = first.sequence;
  assert.throws(() => adaptSequence(input), /repeated or out of order/);
});

test('does not convert an unsupported event to an ordinary run', () => {
  const input = copy();
  input.record.drives[0].plays[0].event_type = 'unmodeled_rule_transition';
  const play = adaptSequence(input).plays[0];
  assert.equal(play.supportedLabel, false);
  assert.match(play.title, /Unsupported event/);
});

test('before-play scoreboard is never synthesized from the final game score', () => {
  const input = copy();
  input.record.points = {A: 98, B: 88};
  const view = adaptSequence(input);
  assert.equal(view.plays[0].before.home_score, fixture.record.drives[0].plays[0].state_before.home_score);
  assert.notEqual(view.plays[0].before.home_score, 98);
});
