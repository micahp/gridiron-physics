import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MATCHUPS, generateGame } from '../web/week7-core.js';

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
    if(p.type==='field_goal') assert.equal(p.distance, p.yl+17, 'field goal distance is yards to goal plus 17');
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
console.log('PASS six matchup playbooks, deterministic 4-period experimental logs, explicit scope guards');
