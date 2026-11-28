import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tracePlay,scenarios} from './audit-liquid-ai-play.mjs';
import {simulateInsideZone as baselineRun} from '../engine/.audit-baseline-run.js';
import {scenarioFromCall,simulateAutonomousPlay} from '../engine/autonomous/simulator.js';
import {validatePlayInput} from '../engine/autonomous/schema.js';
import {toResultRecord,reconcileResult} from '../engine/autonomous/results.js';
const baseline=raw=>{const call=validatePlayInput(raw);const r=toResultRecord(call,baselineRun(scenarioFromCall(call).config));r.diagnostics.reconciliation=reconcileResult(r);return r;};
const roleList=['O.RB','O.LT','O.LG','O.C','O.RG','O.RT','O.TE','D.LDE','D.LDT','D.RDT','D.RDE','D.MIKE','D.WILL','D.SAM'];
function evidence(trace){
  const handoff=trace.record.events.find(e=>e.type==='handoff');
  const changes={};let previous={};
  for(const tick of trace.ticks)for(const d of tick.decisions){
    const a=d.after.ai,role=d.role;
    if(!roleList.includes(role))continue;
    const id=a.blockOn?.player_ref??null;
    if(id&&id!==previous[role]) (changes[role]??=[]).push({t:tick.before.time_s,target:id});
    previous[role]=id;
  }
  const relevant=[0,0.0083333333,0.2,0.4416666667,0.5416666667,0.7416666667,0.8416666667,1.1416666667,1.3416666667,1.4583333333];
  const snapshots=relevant.map(t=>{
    const tick=trace.ticks[Math.round(t*120)];
    if(!tick)return {t,unavailable:true};
    return {t:tick.before.time_s,players:tick.decisions.filter(d=>roleList.includes(d.role)).map(d=>({role:d.role,x:d.before.position_m.x,y:d.before.position_m.y,assignment:d.after.ai.playAssignment,decision:d.after.ai.decision,target:d.after.ai.blockOn?.player_ref??null,engaged:d.before.engaged_with,recognized:d.after.ai.runRecognized??null,lane:d.after.ai.lane??null,dv:d.after.desired_velocity_mps})),
      reasons:tick.reasons.filter(r=>r.type==='front_fit'||r.type==='rb_read'||r.type==='block_target')};
  });
  return {result:trace.record.result,status:trace.record.status,reconciliation:trace.record.diagnostics.reconciliation,handoff:handoff?.t??null,
    changes,recognition:trace.record.events.filter(e=>e.type==='defensive_run_read'),lane:trace.record.events.filter(e=>e.type==='lane_read'),snapshots};
}
let all=[];
for(const call of scenarios().filter(c=>c.offense?.call.family==='run')){
  const old=tracePlay(call,baseline),next=tracePlay(call);
  assert.deepEqual(old.record.events,baseline(call).events);
  assert.deepEqual(next.record.events,simulateAutonomousPlay(call).events);
  assert.equal(next.record.diagnostics.reconciliation.ok,true);
  let checks={block_target:0,front_fit:0,pursuit:0,steering:0};
  for(const tick of next.ticks)for(const r of tick.reasons){
    if(r.type==='block_target'&&r.responsibility==='zone_block'){
      checks.block_target++;
      if(r.selected_id){const selected=r.candidates.find(x=>x.id===r.selected_id);assert.ok(selected);assert.ok(Math.abs(selected.lateral_yards-r.track_lateral_yards)<=r.envelope_yards+1e-9);}
    }
    if(r.type==='front_fit'){
      checks.front_fit++;
      if(r.pursuit){checks.pursuit++;assert.ok(r.recognized);const d=tick.decisions.find(d=>d.id===r.player_id);assert.ok(r.observation_age_s+1e-9>=d.after.ai.runReadDelay);}
    }
    if(r.type==='rb_steering'){checks.steering++;assert.equal(r.selected_lane,r.applied_lane);}
  }
  assert.ok(checks.block_target&&checks.front_fit&&checks.steering);
  let b=evidence(old),c=evidence(next);all.push({id:call.play_id,baseline:b,candidate:c,checks});
  console.log('RUN_ROLE_COMPARE '+JSON.stringify({id:call.play_id,checks,baseline:{result:b.result,rt:b.changes['O.RT'],recognition:b.recognition,lane:b.lane},candidate:{result:c.result,rt:c.changes['O.RT'],recognition:c.recognition,lane:c.lane},baselineAtCuts:b.snapshots.filter(x=>x.t>1.13&&x.t<1.35).map(x=>({t:x.t,players:x.players?.filter(p=>['O.RB','O.RG','O.RT','D.MIKE','D.RDT','D.RDE'].includes(p.role))}))}));
}
assert.ok(all.some(x=>x.checks.pursuit>0),'recognition/pursuit must be exercised');
writeFileSync(join(process.argv[2]??'audit-output','paired-run-role-audit.json'),JSON.stringify(all,null,2));
