import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPuntSampler, MATCHUPS, generateGame, seeded } from '../web/week7-core.js';

const league = JSON.parse(readFileSync(new URL('../data/special_teams/2025-league.json', import.meta.url), 'utf8'));
league.punt_event_samples = JSON.parse(readFileSync(new URL('../data/special_teams/2025-punt-events.json', import.meta.url), 'utf8'));

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
    if(p.type==='field_goal') assert.equal(p.distance, p.yl+17, 'field goal distance is yards to goal plus 17');
    if(p.type==='punt'){
      assert.ok(Number.isFinite(p.distance) && p.outcome, 'punt has distance and outcome');
      assert.ok(p.yl>40, 'punts only from beyond the 40');
      // Blocked punts are zero-yard punts; a punt with positive distance is never blocked.
      if(p.outcome==='blocked') assert.equal(p.distance,0,'blocked punt is a zero-yard punt');
      else assert.ok(p.distance>0,'non-blocked punt has positive distance');
      assert.ok(p.punt_event, 'punt carries joint-event provenance');
      assert.equal(p.punt_event.kick_field_position_yardline_100,p.yl);
      if(p.touchdown){
        assert.equal(p.punt_event.final_spot_status,'not_applicable_touchdown');
        assert.equal(p.punt_event.final_spot_yardline_100,null);
        assert.ok(p.punt_event.scoring_team);
        assert.equal(a.plays[p.index]?.type,'kickoff','punt return touchdown is followed by a kickoff');
      }else{
        assert.equal(p.punt_event.final_spot_status,'observed_next_series_first_down_snap_proxy');
        assert.ok(Number.isFinite(p.punt_event.final_spot_yardline_100));
      }
      assert.equal(p.punt_event.landing_yardline_100,null);
      assert.equal(p.punt_event.landing_status,'estimated_unresolved');
      assert.equal(p.punt_event.recovery_yardline_100,null);
      assert.equal(p.punt_event.recovery_status,'estimated_unresolved');
      assert.ok(['receiving_team','kicking_team','scoring_team'].includes(p.punt_event.possession_after));
    }
    if(p.type==='kickoff') assert.ok(['touchback','out_of_bounds','returned','fair_catch','downed'].includes(p.outcome));
    if(p.type==='scrimmage' || p.type==='punt' || p.type==='field_goal') assert.ok(p.yl>=1 && p.yl<=99, 'yardline in range at '+p.id);
  });
}

// Sample at the source field-position mix, then verify the joint event row and
// its historical marginals. Landing and recovery coordinates stay unresolved.
const eventRecords = league.punt_event_samples.events;
const sourceById = new Map(eventRecords.map(e=>[e.source_game_id+':'+e.source_play_id,e]));
const fieldPositionHist = Object.fromEntries(eventRecords.reduce((hist,e)=>{
  hist.set(e.field_position_yardline_100,(hist.get(e.field_position_yardline_100)||0)+1);return hist;
},new Map()));
const samplePunt = createPuntSampler(league.punts,league.punt_event_samples,league.source.sha256);
const sampleN = 50000;
const outcomeCounts = Object.fromEntries(Object.keys(league.punts.outcomes).map(k=>[k,0]));
const distanceCounts = Object.fromEntries(Object.keys(league.punts.distance_yards)
  .filter(k=>Number(k)>0).map(k=>[Number(k),0]));
let blockedCount = 0;
let touchbackShort = 0, otherDistanceReachesGoal = 0, puntTouchdowns = 0;
for(let i=0;i<sampleN;i++){
  const fieldRand=seeded('punt-field-'+i)();
  const fieldEntries=Object.entries(fieldPositionHist).map(([k,v])=>[Number(k),v]);
  let fieldPick=fieldRand*fieldEntries.reduce((n,[,v])=>n+v,0), kickYl=fieldEntries.at(-1)[0];
  for(const [y,n] of fieldEntries)if((fieldPick-=n)<0){kickYl=y;break;}
  const punt = samplePunt(kickYl,seeded('punt-sample-'+i));
  outcomeCounts[punt.outcome]++;
  if(punt.outcome==='touchback' && punt.distance<kickYl) touchbackShort++;
  if(punt.outcome!=='touchback' && punt.distance>=kickYl) otherDistanceReachesGoal++;
  assert.equal(punt.landing_yardline_100,null,'gross distance does not invent a landing coordinate');
  assert.equal(punt.landing_status,'estimated_unresolved');
  assert.equal(punt.recovery_yardline_100,null);
  assert.equal(punt.recovery_status,'estimated_unresolved');
  const source=sourceById.get(punt.sample.source_game_id+':'+punt.sample.source_play_id);
  assert.ok(source,'sample provenance resolves to source event');
  assert.equal(punt.possession_after,source.possession_after);
  assert.ok(source.field_position_yardline_100>=punt.sample.bin_lower_yardline_100 &&
    source.field_position_yardline_100<=punt.sample.bin_upper_yardline_100,
    'sampled event belongs to its reported conditioning bin');
  if(punt.touchdown){
    puntTouchdowns++;
    assert.equal(punt.spot,null);
    assert.equal(punt.final_spot_status,'not_applicable_touchdown');
    assert.equal(punt.possession_after,'scoring_team');
    assert.equal(punt.scoring_team,source.scoring_team);
  }else{
    assert.equal(punt.spot,source.final_spot_yardline_100,'restart spot comes from the joint record');
    assert.equal(punt.final_spot_status,'observed_next_series_first_down_snap_proxy');
  }
  if(punt.outcome==='touchback') assert.ok(punt.distance>=kickYl,
    'touchback kick distance reaches the goal line from the generated snap');
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
assert.equal(touchbackShort,0,'touchback distance must reach the goal line from its generated snap');
assert.ok(puntTouchdowns>0,'50,000-sample fixture includes punt-return touchdowns');
assert.throws(()=>createPuntSampler({
  ...league.punts,
  distance_yards:{...league.punts.distance_yards,'0':8},
},league.punt_event_samples,league.source.sha256),/punt table mismatch/,'reject a changed blocked/zero-distance relationship');
assert.equal(samplePunt(25,seeded('punt-fallback')).sample.bin_width_yards,20,
  'sparse primary field-position bin falls back to the broader bin');
assert.throws(()=>createPuntSampler(league.punts,{...league.punt_event_samples,source:{sha256:'drift'}},league.source.sha256),
  /different source hashes/,'reject joint event data from a different source version');

console.log('PASS six matchup playbooks, deterministic 4-period experimental logs, explicit scope guards');
console.log(`PASS 50,000 joint punt-event samples; outcome TV=${outcomeTv.toFixed(4)}, positive-distance TV=${distanceTv.toFixed(4)}, blocked=${blockedCount}, punt touchdowns=${puntTouchdowns}, short touchbacks=${touchbackShort}, non-touchback distance reaching goal=${otherDistanceReachesGoal}; field-position fallback and estimated landing semantics`);
