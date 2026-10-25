// State-rule audit for the six seed-1042 games.
//
// This asserts the acceptance criteria from the game-state audit: no
// goal-to-go violations, no invalid kickoff spots, no kickoff ownership
// mismatches, no invalid quarter transitions, no invalid missed-field-goal
// restarts, no punt outcome/distance contradictions, and full score and
// possession continuity.
//
// Where the event model cannot prove legality, the event is reported as
// unverified rather than assumed legal.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as core from '../web/week7-core.js';
import { MATCHUPS, generateGame, seeded } from '../web/week7-core.js';
import { auditModule, auditKickoffSampler, auditSafetyKickPath } from './week7-audit-lib.mjs';

const league = JSON.parse(readFileSync(new URL('../data/special_teams/2025-league.json', import.meta.url), 'utf8'));

// Reuse the fixture books from the unit test so both files exercise the same
// 2025 offense/defense samples.
const sample = (type, down, gain, i) => ({
  attributes:{play_type:type,down,ydstogo:down===3?6:10,yardline_100:65},
  outcome_label:{yards_gained:gain,complete_pass:type==='pass'&&gain>0?1:0,
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
    play_candidates:{
      run:{candidates:[{candidate_id:'run-'+id,count:30,
        attributes:{formation:'SHOTGUN'}}]},
      pass:{candidates:[{candidate_id:'pass-'+id,count:32,
        attributes:{formation:'SHOTGUN'}}]}}},
    defense:{observed_plays:observed}};
}

const {violations, unverified} = auditModule(core, league, book);
auditKickoffSampler(core, league, book);
auditSafetyKickPath(core, league, book);

// ---- Determinism: the same seed must reproduce the same payload hash ----
for(const m of MATCHUPS){
  const books={[m.home]:book(m.home),[m.away]:book(m.away)};
  const a=generateGame(m,books,'1042',league);
  const b=generateGame(m,books,'1042',league);
  const h=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
  assert.equal(h(a),h(b),`${m.id} is not deterministic for seed 1042`);
  // A different seed must produce a different payload.
  const c=generateGame(m,books,'1043',league);
  assert.notEqual(h(a),h(c),`${m.id} did not change with a different seed`);
}

if(unverified.length) console.log('UNVERIFIED EVENTS: '+JSON.stringify(unverified,null,1));
if(violations.length){
  console.error('STATE-RULE VIOLATIONS: '+violations.length);
  for(const v of violations.slice(0,40)) console.error(`  [${v.check}] ${v.game} ${v.detail}`);
  if(violations.length>40) console.error(`  ... and ${violations.length-40} more`);
  process.exit(1);
}
console.log('PASS six seed-1042 games: 0 goal-to-go, kickoff spot, kickoff ownership, quarter transition, missed-FG restart and punt contradictions; 100% score and possession continuity; deterministic payload hashes');
