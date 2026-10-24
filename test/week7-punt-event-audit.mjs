import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MATCHUPS, generateGame } from '../web/week7-core.js';

const json = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const league = json('../data/special_teams/2025-league.json');
league.punt_event_samples = json('../data/special_teams/2025-punt-events.json');
const events = league.punt_event_samples.events;
const sourceById = new Map(events.map(e => [`${e.source_game_id}:${e.source_play_id}`, e]));
const report = [];

for (const matchup of MATCHUPS) {
  const books = Object.fromEntries([matchup.home, matchup.away].map(team =>
    [team, json(`../data/playbooks/${team}-2025.json`)]));
  const game = generateGame(matchup, books, '1042', league);
  const punts = game.plays.map((play,index) => ({play,index})).filter(x => x.play.type === 'punt');
  let touchbackShort = 0, otherDistanceReachesGoal = 0, directTransitions = 0, boundaryTransitions = 0;
  for (const {play,index} of punts) {
    const p = play.punt_event;
    assert.ok(p, `${game.game_id}:${play.id} has no joint punt event`);
    const source = sourceById.get(`${p.source_game_id}:${p.source_play_id}`);
    assert.ok(source, `${game.game_id}:${play.id} source event is missing`);
    assert.equal(play.outcome, source.outcome);
    assert.equal(play.distance, source.gross_distance_yards);
    assert.equal(play.return_yards, source.return_yards);
    assert.equal(p.source_field_position_yardline_100, source.field_position_yardline_100);
    assert.equal(p.final_spot_yardline_100, source.final_spot_yardline_100);
    assert.equal(p.possession_after, source.possession_after);
    assert.equal(p.landing_yardline_100, null);
    assert.equal(p.landing_status, 'estimated_unresolved');
    assert.equal(p.recovery_yardline_100, null);
    assert.equal(p.recovery_status, 'estimated_unresolved');
    if (source.touchdown) {
      assert.equal(play.touchdown, true);
      assert.equal(p.final_spot_yardline_100, null);
      assert.equal(p.final_spot_status, 'not_applicable_touchdown');
      assert.equal(p.possession_after, 'scoring_team');
      const expectedScorer = source.scoring_team === 'receiving_team' ? play.defense : play.offense;
      assert.equal(p.scoring_team, expectedScorer);
      assert.equal(play.scoreAfter[expectedScorer] - play.score[expectedScorer], 6 + (play.try?.startsWith('XP good') ? 1 : 0));
      assert.equal(game.plays[index+1]?.type, 'kickoff', 'punt touchdown restarts with a kickoff');
    } else {
      assert.equal(play.touchdown, false);
      assert.equal(p.final_spot_status, 'observed_next_series_first_down_snap_proxy');
    }
    assert.ok(source.field_position_yardline_100 >= p.bin_lower_yardline_100 &&
      source.field_position_yardline_100 <= p.bin_upper_yardline_100);

    if (play.outcome === 'touchback' && play.distance < play.yl) touchbackShort++;
    if (play.outcome !== 'touchback' && play.distance >= play.yl) otherDistanceReachesGoal++;
    const next = game.plays[index + 1];
    if (next && ['scrimmage','punt','field_goal'].includes(next.type)) {
      const expectedOffense = p.possession_after === 'receiving_team' ? play.defense : play.offense;
      assert.equal(next.offense, expectedOffense, `${game.game_id}:${play.id} possession transition`);
      assert.equal(next.yl, p.final_spot_yardline_100, `${game.game_id}:${play.id} restart spot`);
      directTransitions++;
    } else boundaryTransitions++;
  }
  assert.equal(touchbackShort, 0, `${game.game_id} has a short-distance touchback`);
  report.push({game:game.game_id,punts:punts.length,touchback_short:touchbackShort,
    other_distance_reaches_goal:otherDistanceReachesGoal,landing_unresolved:punts.length,
    checked_restart_transitions:directTransitions,period_boundary_transitions:boundaryTransitions});
}

// Seed 12 in the first matchup samples a punt return touchdown, exercising its
// six-point scorer, extra point, and kickoff path independently of seed 1042.
const tdMatchup = MATCHUPS[0];
const tdBooks = Object.fromEntries([tdMatchup.home,tdMatchup.away].map(team =>
  [team,json(`../data/playbooks/${team}-2025.json`)]));
const tdGame = generateGame(tdMatchup,tdBooks,'12',league);
const tdIndex = tdGame.plays.findIndex(play => play.type==='punt' && play.touchdown);
assert.notEqual(tdIndex,-1,'punt-return touchdown fixture exists');
const tdPlay = tdGame.plays[tdIndex];
assert.ok(tdPlay.punt_event.scoring_team);
assert.equal(tdPlay.scoreAfter[tdPlay.punt_event.scoring_team] - tdPlay.score[tdPlay.punt_event.scoring_team],
  6 + (tdPlay.try?.startsWith('XP good') ? 1 : 0));
assert.equal(tdGame.plays[tdIndex+1]?.type,'kickoff');
assert.equal(tdGame.plays[tdIndex+1]?.offense,tdPlay.punt_event.scoring_team);

console.log(`PASS joint punt-event consistency across ${MATCHUPS.length} actual matchup simulations (seed 1042)`);
console.log(JSON.stringify(report));
console.log(`PASS punt-return touchdown scoring and kickoff fixture (seed 12, ${tdPlay.punt_event.scoring_team})`);
