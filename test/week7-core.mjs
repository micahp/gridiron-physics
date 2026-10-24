import assert from 'node:assert/strict';
import { MATCHUPS, generateGame } from '../web/week7-core.js';

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
  const a=generateGame(m,books,'1042'),b=generateGame(m,books,'1042');
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
}
console.log('PASS six matchup playbooks, deterministic 4-period experimental logs, explicit scope guards');
