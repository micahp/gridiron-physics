import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MATCHUPS, generateGame } from '../web/week7-core.js';

const json = path => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const league = json('../data/special_teams/2025-league.json');
league.punt_event_samples = json('../data/special_teams/2025-punt-events.json');
const events = league.punt_event_samples.events;
const sourceById = new Map(events.map(e => [`${e.source_game_id}:${e.source_play_id}`, e]));
const report = [];
let q1PuntContinuations = 0, q2PuntHalftimeTransitions = 0;

for (const matchup of MATCHUPS) {
  const books = Object.fromEntries([matchup.home, matchup.away].map(team =>
    [team, json(`../data/playbooks/${team}-2025.json`)]));
  const game = generateGame(matchup, books, '1042', league);
  const quarters = [...new Set(game.plays.map(play => play.quarter))];
  assert.deepEqual(quarters, [1, 2, 3, 4], `${game.game_id} covers all four quarter boundaries`);
  const quarterTransitions = game.plays.slice(1).flatMap((play, i) => {
    const previous = game.plays[i];
    return previous.quarter === play.quarter ? [] : [[previous.quarter, play.quarter]];
  });
  assert.deepEqual(quarterTransitions, [[1, 2], [2, 3], [3, 4]],
    `${game.game_id} advances through each quarter exactly once`);
  const q3Kickoffs = game.plays.filter(play => play.type === 'kickoff' && play.quarter === 3 && play.clock === 900);
  assert.equal(q3Kickoffs.length, 1, `${game.game_id} has one halftime kickoff`);
  assert.equal(q3Kickoffs[0].clock, 900, `${game.game_id} halftime kickoff starts Q3 at 15:00`);
  const q3KickoffIndex = game.plays.indexOf(q3Kickoffs[0]);
  assert.equal(game.plays.findIndex(play => play.quarter === 3), q3KickoffIndex,
    `${game.game_id} opens Q3 with the halftime kickoff`);
  const punts = game.plays.map((play,index) => ({play,index})).filter(x => x.play.type === 'punt');
  let touchbackShort = 0, otherDistanceReachesGoal = 0, directTransitions = 0, quarterBoundaryPunts = 0;
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
      if (next.quarter !== play.quarter) {
        assert.equal(next.quarter, play.quarter + 1, `${game.game_id}:${play.id} advances one quarter`);
        assert.ok(play.quarter === 1 || play.quarter === 3,
          `${game.game_id}:${play.id} only carries a punt restart across Q1/Q2 or Q3/Q4`);
        quarterBoundaryPunts++;
        if (play.quarter === 1) q1PuntContinuations++;
      }
      directTransitions++;
    } else {
      if (next && play.quarter === 2 && next.quarter === 3) {
        assert.equal(next.type, 'kickoff', `${game.game_id}:${play.id} hands off to halftime kickoff`);
        assert.equal(next.clock, 900, `${game.game_id}:${play.id} halftime kickoff starts at 15:00`);
        assert.equal(game.drives.find(drive => drive.end === index)?.reason, 'punt',
          `${game.game_id}:${play.id} ends the punt drive before the halftime kickoff`);
        quarterBoundaryPunts++;
        q2PuntHalftimeTransitions++;
      }
    }
  }
  assert.equal(touchbackShort, 0, `${game.game_id} has a short-distance touchback`);
  report.push({game:game.game_id,punts:punts.length,touchback_short:touchbackShort,
    other_distance_reaches_goal:otherDistanceReachesGoal,landing_unresolved:punts.length,
    checked_restart_transitions:directTransitions,quarter_boundary_punts:quarterBoundaryPunts});
}

const auditedPuntCount = report.reduce((total, row) => total + row.punts, 0);
assert.equal(auditedPuntCount, 49, 'the six seed-1042 matchup replays contain the 49-punt audit sample');
assert.ok(q1PuntContinuations > 0, 'a Q1 punt keeps its possession and restart spot across the Q1/Q2 boundary');
assert.ok(q2PuntHalftimeTransitions > 0, 'a Q2 punt closes at halftime before the Q3 kickoff');

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
console.log(`PASS 49-punt audit and quarter-boundary transitions (Q1 carryovers=${q1PuntContinuations}, Q2 halftime=${q2PuntHalftimeTransitions})`);
console.log(JSON.stringify(report));
console.log(`PASS punt-return touchdown scoring and kickoff fixture (seed 12, ${tdPlay.punt_event.scoring_team})`);
