import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPuntSampler, MATCHUPS, generateGame, seeded, missedFieldGoalRestart,
  sampleBlockedPuntOutcome, sampleCoinTossLedger, validateHalfStartKickoffs } from '../web/week7-core.js';

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

// Missed-FG restart boundary: the kick spot at the receivers' 20 is not untouched.
assert.deepEqual(missedFieldGoalRestart(11).restartOwn, 20, 'kick spot 19 restarts at the 20');
assert.equal(missedFieldGoalRestart(11).untouched, true);
assert.equal(missedFieldGoalRestart(12).restartOwn, 20, 'kick spot 20 restarts at the kick spot, which is the 20');
assert.equal(missedFieldGoalRestart(12).untouched, false);
assert.equal(missedFieldGoalRestart(13).restartOwn, 21, 'kick spot 21 restarts at the kick spot');

// Blocked punts: fail closed without a resolution table.
const rngBlocked = seeded('blocked-core');
assert.throws(()=>sampleBlockedPuntOutcome({}, rngBlocked), /missing blocked-punt/);
assert.equal(sampleBlockedPuntOutcome({blocked_resolution:{safety:3}}, rngBlocked), 'safety');

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

console.log('PASS six matchup playbooks, deterministic 4-period experimental logs, explicit scope guards');
