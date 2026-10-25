import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPuntSampler, MATCHUPS, generateGame, seeded, missedFieldGoalRestart, BLOCKED_PUNT_OUTCOMES,
  sampleBlockedPuntOutcome, sampleCoinTossLedger, validateHalfStartKickoffs, validateCoinTossLedger } from '../web/week7-core.js';

const league = JSON.parse(readFileSync(new URL('../data/special_teams/2025-league.json', import.meta.url), 'utf8'));

const sample = (type, down, gain, i) => ({
  attributes:{play_type:type,down,ydstogo:down===3?6:10,yardline_100:65},
  outcome_label:{yards_gained:gain, complete_pass:type==='pass'&&gain>0?1:0,
    interception:0,touchdown:0},
  source_id:{game_id:'2025_01_'+i,play_id:String(i)}
});
function book(id){
  const observed=[];
  for(let down=1;down<=4;down++)for(let i=0;i<17;i++){
    observed.push(sample('run',down,i%4===0?-1:2+(i%6),i+down*100));
    observed.push(sample('pass',down,i%3===0?0:5+(i%18),i+down*150));
  }
  return {team_id:id,offense:{observed_plays:observed,
    profile:{run_pass:{categories:{run:{rate:.46},pass:{rate:.54}}}},
    play_candidates:{run:{candidates:[{candidate_id:'run-'+id,count:30,
      attributes:{formation:'SHOTGUN'}}]},
      pass:{candidates:[{candidate_id:'pass-'+id,count:32,
        attributes:{formation:'SHOTGUN'}}]}}},defense:{observed_plays:observed}};
}
for(const m of MATCHUPS){
  const books={[m.home]:book(m.home),[m.away]:book(m.away)};
  const a=generateGame(m,books,'1042',league),b=generateGame(m,books,'1042',league);
  assert.deepEqual(a,b,'same seed and historical inputs reproduce');
  assert.equal(a.game_id,m.id);
  assert.ok(a.plays.length>40);
  assert.ok(a.drives.length>4);
  assert.ok(a.plays.filter(x=>x.type==='scrimmage').length>30);
  assert.ok(a.plays.every((p,i)=>p.index===i+1 && p.id.startsWith(m.id)));
  assert.ok(a.plays.every(p=>[m.home,m.away].includes(p.offense)));
  assert.ok(a.plays.every(p=>p.clock>=0 && p.clock<=900 && p.quarter>=1 && p.quarter<=4));
  assert.ok(a.plays.filter(p=>p.type==='scrimmage').every(p=>p.candidate?.candidate_id && p.source_id?.game_id?.startsWith('2025_')));
  assert.equal(a.complete_regulation,false);
  assert.ok(a.warnings.some(x=>x.includes('overtime')));
  // Special teams: the game opens with a kickoff, and every score and the second half open with one.
  assert.equal(a.plays[0].type,'kickoff');
  assert.ok(a.plays.some(p=>p.type==='kickoff' && p.quarter===3 && p.clock===900));
  a.plays.forEach((p,i)=>{
    if((p.type==='scrimmage' && p.touchdown) || (p.type==='field_goal' && p.good)){
      assert.equal(a.plays[i+1]?.type ?? 'kickoff', 'kickoff', 'score not followed by a kickoff at '+p.id);
    }
    if(p.type==='field_goal') assert.equal(p.distance, p.yl+18, 'field goal distance is yards to goal plus 10 end zone plus the 8-yard holder offset');
    if(p.type==='punt'){
      assert.ok(Number.isFinite(p.distance) && p.outcome, 'punt has distance and outcome');
      assert.ok(p.yl>40, 'punts only from beyond the 40');
      // Blocked punts are zero-yard punts; a punt with positive distance is never blocked.
      if(p.outcome==='blocked') assert.equal(p.distance,0,'blocked punt is a zero-yard punt');
      else assert.ok(p.distance>0,'non-blocked punt has positive distance');
    }
    if(p.type==='kickoff') assert.ok(['touchback','out_of_bounds','returned','fair_catch','downed'].includes(p.outcome));
    if(p.type==='scrimmage' || p.type==='punt' || p.type==='field_goal') assert.ok(p.yl>=1 && p.yl<=99, 'yardline in range at '+p.id);
  });
}

// Sample independently seeded punts to verify the empirical marginals and
// the observed zero-distance/blocked-punt pairing without relying on a game
// seed happening to include a block.
const samplePunt = createPuntSampler(league.punts);
const sampleN = 50000;
const outcomeCounts = Object.fromEntries(Object.keys(league.punts.outcomes).map(k=>[k,0]));
const distanceCounts = Object.fromEntries(Object.keys(league.punts.distance_yards)
  .filter(k=>Number(k)>0).map(k=>[Number(k),0]));
let blockedCount = 0;
for(let i=0;i<sampleN;i++){
  const punt = samplePunt(60,seeded('punt-sample-'+i));
  outcomeCounts[punt.outcome]++;
  if(punt.outcome==='blocked'){
    blockedCount++;
    assert.equal(punt.distance,0,'blocked outcome has zero recorded distance');
  } else {
    assert.ok(punt.distance>0,'non-blocked outcome has positive recorded distance');
    distanceCounts[punt.distance]++;
  }
}
const outcomeTotal=Object.values(league.punts.outcomes).reduce((n,v)=>n+v,0);
const outcomeTv=0.5*Object.entries(league.punts.outcomes).reduce((n,[k,v])=>
  n+Math.abs(outcomeCounts[k]/sampleN-v/outcomeTotal),0);
assert.ok(outcomeTv<0.02,`punt outcome distribution drifted (TV=${outcomeTv})`);
const positiveDistanceHist=Object.fromEntries(Object.entries(league.punts.distance_yards)
  .filter(([yards])=>Number(yards)>0));
const positiveTotal=Object.values(positiveDistanceHist).reduce((n,v)=>n+v,0);
const sampledNonBlocked=sampleN-blockedCount;
const distanceTv=0.5*Object.entries(positiveDistanceHist).reduce((n,[yards,v])=>
  n+Math.abs(distanceCounts[Number(yards)]/sampledNonBlocked-v/positiveTotal),0);
assert.ok(distanceTv<0.025,`non-blocked punt distance distribution drifted (TV=${distanceTv})`);
const expectedBlocked=Number(league.punts.outcomes.blocked)/outcomeTotal;
assert.ok(Math.abs(blockedCount/sampleN-expectedBlocked)<0.0011,
  `blocked punt rate drifted (${blockedCount/sampleN} vs ${expectedBlocked})`);
assert.throws(()=>createPuntSampler({
  ...league.punts,
  distance_yards:{...league.punts.distance_yards,'0':8},
}),/punt table mismatch/,'reject a changed blocked/zero-distance relationship');

// Missed-FG restart boundary: the kick spot is inside the receivers' 20 (kick position only, no contact claim).
assert.deepEqual(missedFieldGoalRestart(11).restartOwn, 20, 'kick spot 19 restarts at the 20');
assert.equal(missedFieldGoalRestart(11).kickSpotInside20, true);
assert.equal(missedFieldGoalRestart(12).restartOwn, 20, 'kick spot 20 restarts at the kick spot, which is the 20');
assert.equal(missedFieldGoalRestart(12).kickSpotInside20, false);
assert.equal(missedFieldGoalRestart(13).restartOwn, 21, 'kick spot 21 restarts at the kick spot');
assert.equal('untouched' in missedFieldGoalRestart(11), false, 'old untouched name is gone');

// Blocked punts: fail closed without a resolution table.
const rngBlocked = seeded('blocked-core');
assert.throws(()=>sampleBlockedPuntOutcome({}, rngBlocked), /missing blocked-punt/);
assert.equal(sampleBlockedPuntOutcome({blocked_resolution_pooled:{safety:3}}, rngBlocked), 'safety');

// Coin-toss ledger: both winners, both normal choices, Q3 kicker is the Q1 receiver.
const other = (m, t) => t === m.home ? m.away : m.home;
for (const m of MATCHUPS.slice(0, 2)) {
  const books = {[m.home]:book(m.home), [m.away]:book(m.away)};
  for (const winner of [m.home, m.away]) for (const choice of ['receive', 'defer']) {
    const g = generateGame(m, books, '7', league, {coinToss:{winner, choice}});
    const L = g.coin_toss_ledger;
    assert.equal(L.coin_toss.winner, winner);
    assert.equal(L.coin_toss.winner_deferred, choice === 'defer');
    assert.equal(L.source, 'authored_simulation_choice');
    const q1 = g.plays.find(p=>p.type==='kickoff' && p.reason==='half_start' && p.quarter===1);
    const q3 = g.plays.find(p=>p.type==='kickoff' && p.reason==='half_start' && p.quarter===3);
    const q1Receiver = choice === 'receive' ? winner : other(m, winner);
    assert.equal(q1.receiving_team, q1Receiver, `${m.id} ${winner} ${choice}: Q1 receiver`);
    assert.equal(q1.kicking_team, other(m, q1Receiver), `${m.id} ${winner} ${choice}: Q1 kicker`);
    assert.equal(q3.kicking_team, q1Receiver, `${m.id} ${winner} ${choice}: Q3 kicker is the Q1 receiver`);
    assert.equal(q3.receiving_team, q1.kicking_team, `${m.id} ${winner} ${choice}: Q3 receiver is the Q1 kicker`);
    assert.equal(validateHalfStartKickoffs(g.plays, L), true);
  }
  // A non-normal choice is rejected in normal mode.
  assert.throws(()=>generateGame(m, books, '7', league, {coinToss:{winner:m.home, choice:'kick'}}),
    /receive or defer/, 'kick choice is rejected in normal mode');
  // An inconsistent halftime kickoff, where the Q1 kicker kicks Q3 too, is rejected.
  const g = generateGame(m, books, '7', league, {coinToss:{winner:m.home, choice:'receive'}});
  const q1 = g.plays.find(p=>p.type==='kickoff' && p.reason==='half_start' && p.quarter===1);
  const bad = g.plays.map(p => p.type==='kickoff' && p.reason==='half_start' && p.quarter===3
    ? {...p, kicking_team:q1.kicking_team, receiving_team:q1.receiving_team} : p);
  assert.throws(()=>validateHalfStartKickoffs(bad, g.coin_toss_ledger), /same team|does not match/,
    'same team kicking both half-start kickoffs is rejected');
}

// ---- Review corrections: targeted positive and negative fixtures -----------
const punts = league.punts;
const forcedBlocked = (outcome) => ({...league, punts:{outcomes:{blocked:1}, distance_yards:{'0':1,'40':1},
  blocked_resolution_pooled:Object.fromEntries(['receiving_recovery','kicking_recovery','out_of_bounds','safety']
    .map(k=>[k,k===outcome?1:0]))}});
const findGame = (predicate, league_, count=8) => {
  for (const m of MATCHUPS.slice(0,2)) for (const seed of ['1042','1','2','3','4','5','6','7'].slice(0,count)) {
    const books = {[m.home]:book(m.home), [m.away]:book(m.away)};
    const g = generateGame(m, books, seed, league_);
    if (predicate(g)) return g;
  }
  return null;
};

// (2) Blocked-punt recovery by the kicking team: refused, no automatic first down.
{
  const g = findGame(g=>g.plays.some(p=>p.type==='punt'), forcedBlocked('kicking_recovery'));
  assert.ok(g, 'a forced kicking-recovery game has a punt');
  assert.equal(g.status, 'UNSUPPORTED_RULE_REFUSAL');
  assert.equal(g.refusal.rule, 'blocked_punt_kicking_recovery');
  const last = g.plays.at(-1);
  assert.equal(last.type, 'unsupported_rule', 'game ends at the refusal, with no sampled next series');
  const punt = g.plays.find(p=>p.type==='punt');
  assert.equal(punt.possession_resolution, 'kicking_recovery');
  assert.equal(punt.possession_after, punt.offense, 'kicking team keeps the ball, not an automatic first down');
}
// (2) Negative: a receiving-team recovery is a turnover, not a refusal or a kicking-team first down.
{
  const g = findGame(g=>g.plays.some(p=>p.type==='punt'), forcedBlocked('receiving_recovery'));
  assert.equal(g.status, 'ILLUSTRATIVE_REGULATION_REPLAY_NOT_LEGAL_GAME');
  const punt = g.plays.find(p=>p.type==='punt');
  const nxt = g.plays[punt.index];
  assert.notEqual(nxt.offense, punt.offense, 'receiving team takes over after a receiving recovery');
  assert.equal(nxt.down, 1);
  assert.equal(nxt.togo, Math.min(10, nxt.yl));
}

// (1) Safety: a distinct free kick from the kicking team's own 20, not an ordinary kickoff.
{
  const g = findGame(g=>g.plays.some(p=>p.type==='punt'), forcedBlocked('safety'));
  assert.equal(g.refusal.rule, 'safety_kick');
  const sk = g.plays.find(p=>p.type==='safety_kick');
  assert.ok(sk, 'safety kick is an explicit event');
  assert.equal(sk.kick_spot_own, 20, 'safety kick is taken from the own 20');
  assert.equal(sk.receiving_spot, null, 'receiving spot is not sampled');
  assert.equal(sk.possession_after, sk.receiving_team, 'receiving team takes possession');
  assert.ok(!g.plays.some(p=>p.type==='kickoff' && p.reason==='safety'), 'no ordinary kickoff for a safety');
  const punt = g.plays.find(p=>p.type==='punt');
  assert.equal(punt.scoreAfter[sk.receiving_team], punt.score[sk.receiving_team]+2, 'safety scores 2 for the receiving team');
}
// (1) Negative: the real 2025 table has no safety counts, so no safety kick is ever generated.
{
  for (const m of MATCHUPS.slice(0,2)) for (const seed of ['1042','1','2']) {
    const g = generateGame(m, {[m.home]:book(m.home), [m.away]:book(m.away)}, seed, league);
    assert.ok(!g.plays.some(p=>p.type==='safety_kick'), 'no sampled safety kick under the observed table');
  }
}

// (3) Observed blocked-punt counts are preserved; zero-count outcomes are never sampled.
assert.deepEqual(punts.blocked_resolution, {receiving_recovery:7, kicking_recovery:2, out_of_bounds:0, safety:0},
  'observed 2025 blocked-punt counts');
{
  assert.deepEqual(punts.blocked_resolution_pooled, {receiving_recovery:21, kicking_recovery:11, out_of_bounds:4, safety:3},
    'pooled 2022-2025 blocked-punt counts');
  const rngReal = seeded('blocked-pooled');
  const seen = new Set();
  const hits = {receiving_recovery:0, kicking_recovery:0, out_of_bounds:0, safety:0};
  for (let i = 0; i < 20000; i++) { const k = sampleBlockedPuntOutcome(punts, rngReal); seen.add(k); hits[k]++; }
  assert.deepEqual([...seen].sort(), [...BLOCKED_PUNT_OUTCOMES].sort(), 'all pooled outcomes are sampled');
  for (const [k, n] of Object.entries({receiving_recovery:21, kicking_recovery:11, out_of_bounds:4, safety:3})) {
    assert.ok(Math.abs(hits[k]/20000 - n/39) < 0.01, `${k} sampled share ${hits[k]/20000} vs ${n/39}`);
  }
  assert.throws(()=>sampleBlockedPuntOutcome({blocked_resolution:punts.blocked_resolution}, rngReal), /missing blocked-punt/,
    'the 2025 counts are not the sampling table');
}

// (4) Ledger: recomputed from the toss alone; tampered stored fields fail closed.
{
  const m = MATCHUPS[0];
  const books = {[m.home]:book(m.home), [m.away]:book(m.away)};
  const g = generateGame(m, books, '7', league, {coinToss:{winner:m.home, choice:'defer'}});
  const L = g.coin_toss_ledger;
  assert.equal(validateCoinTossLedger(L), true);
  assert.equal(L.first_half.first_choice_team, m.away, 'defer: loser has first-half choice');
  assert.equal(L.first_half.other_team_choice, 'goal_to_defend', 'other team takes the remaining goal privilege');
  assert.equal(L.first_half.defended_goal_by_team, m.home, 'winner defends the first-half goal the loser chose');
  assert.equal(L.second_half.defended_goal_by_team, m.away);
  const clone = () => structuredClone(L);
  const tampered = clone(); tampered.first_half.other_team_choice = 'kick';
  assert.throws(()=>validateCoinTossLedger(tampered), /other_team_choice/, 'old kick/defer value is rejected');
  const flipped = clone(); flipped.first_half.defended_goal_by_team = m.away;
  assert.throws(()=>validateCoinTossLedger(flipped), /defended_goal_by_team/, 'defended goal must follow the toss');
  const swapped = clone(); swapped.second_half.receiving_team = swapped.second_half.kicking_team;
  assert.throws(()=>validateCoinTossLedger(swapped), /receiving_team|same team/, 'kicker and receiver must differ');
}

// (5) FG runoff: the successful-FG cap is rule-based; miss runoff is an unverified estimate.
{
  const goods = [], misses = [];
  for (const m of MATCHUPS.slice(0,3)) for (const seed of ['1042','1','2','3','4','5']) {
    const g = generateGame(m, {[m.home]:book(m.home), [m.away]:book(m.away)}, seed, league);
    for (const p of g.plays) if (p.type==='field_goal') (p.good ? goods : misses).push(p);
  }
  assert.ok(goods.length && misses.length, 'fixtures cover made and missed field goals');
  for (const p of goods) {
    assert.equal(p.runoff_basis, 'rule_11_4_2_note_5_cap');
    assert.ok(p.runoff <= 5, 'successful FG runoff is capped by Note (5)');
  }
  for (const p of misses) {
    assert.equal(p.runoff_basis, 'unverified_miss_estimate', 'miss runoff is not labelled as the verified cap');
    assert.ok(p.runoff >= 1 && p.runoff <= 5);
  }
}

// (6) Missed-FG output names kick position, not contact.
{
  const g = findGame(g=>g.plays.some(p=>p.type==='field_goal' && !p.good), league);
  const miss = g.plays.find(p=>p.type==='field_goal' && !p.good);
  assert.equal(typeof miss.kick_spot_inside_20, 'boolean');
  assert.equal('restart_untouched' in miss, false, 'old restart_untouched field is gone');
}

console.log('PASS six matchup playbooks, deterministic 4-period experimental logs, explicit scope guards');
