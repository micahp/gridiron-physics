import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tracePlay,scenarios} from './audit-liquid-ai-play.mjs';
import {simulateAutonomousPlay,scenarioFromCall} from '../engine/autonomous/simulator.js';
import {validatePlayInput} from '../engine/autonomous/schema.js';
import {simulatePassPlay,coverageContestActive} from '../engine/autonomous/passing.js';
import {simulatePassPlay as baselinePass} from '../engine/autonomous/.audit-baseline-pass.js';
import {toResultRecord,reconcileResult} from '../engine/autonomous/results.js';
const YD=.9144;
const executeWith=(raw,runner)=>{const call=validatePlayInput(raw);const config=scenarioFromCall(call).config;
 const run=runner({...config,contestDiagnostics:true});
 const record=toResultRecord(call,run); record.diagnostics.reconciliation=reconcileResult(record);
 record.diagnostics.pass_contests=run.diagnostics.pass_contests;return record;};
const execute=raw=>executeWith(raw,simulatePassPlay);
const baseline=raw=>executeWith(raw,baselinePass);
const dist=(p,b)=>Math.hypot(p.position_m.x-b.x,p.position_m.y-b.y)/YD;
function summarize(t){
 const reasons=[...t.ticks.flatMap(k=>k.reasons),...t.outside_tick_reasons].sort((a,b)=>a.t_s-b.t_s);
 const launch=reasons.find(r=>r.type==='qb_launch'),throwEvent=t.record.events.find(e=>e.type==='throw');
 const target=launch?.target_id;
 const airborne=t.ticks.map(k=>k.after_physics).filter(w=>w.ball.state==='air'&&w.ball.z>=.35&&w.ball.z<=2.75&&w.ball.vz<0);
 const eligible=(p)=>!p.down&&p.ai.playAssignment?.kind==='route'&&(!p.ai.playAssignment.check_release||p.ai.protectionReleased)&&!p.engaged_with;
 let closestTarget=null;
 for(const w of airborne){const p=w.players.find(p=>p.id===target);if(!p)continue;
  const d=dist(p,w.ball);if(!closestTarget||d<closestTarget.d)closestTarget={t:w.time_s,d,ball_z:w.ball.z,receiver_m:p.position_m,ball_m:{x:w.ball.x,y:w.ball.y},decision:p.ai.decision};}
 const firstReceiverRead=reasons.find(r=>r.type==='receiver_ball_read'&&r.player_id===target&&r.estimate);
 const firstDefenderBreak=t.record.events.find(e=>e.type==='decision'&&e.assignment==='break on the thrown ball');
 const firstContact=reasons.find(r=>r.type==='catch_candidates'&&r.candidates.length);
 const events=t.record.events.filter(e=>['route_break','qb_read','throw','catch_contest','pass_deflected','incomplete','catch','interception','whistle'].includes(e.type));
 const diagnostic=t.record.diagnostics.pass_contests?.throws?.[0];
 const coverageReads=reasons.filter(r=>r.type==='coverage_ball_read'&&r.estimate);
 return {id:t.call.play_id,mode:t.call.behavior_mode,terminal:t.record.result,launch,throwEvent,closestTarget,
 firstReceiverRead,firstDefenderBreak,firstContact,draws:reasons.filter(r=>r.type==='contest_draw'),
 rejected:reasons.filter(r=>r.type==='coverage_contact_rejected'),
 qb_reads:reasons.filter(r=>r.type==='qb_options'),coverageReads,events,diagnostic,
 eligibleReceiverCount:airborne.length?airborne[0].players.filter(eligible).length:0};
}
assert.equal(coverageContestActive({kind:'zone'},false),false);
assert.equal(coverageContestActive({kind:'man'},true),true);
assert.equal(coverageContestActive({kind:'rush'},false),true);
const results=[];let exactRegression=false;let rejectedTotal=0;let admittedCoverage=0;
for(const original of scenarios().filter(c=>c.offense?.call.family==='pass')){
 for(const mode of ['retro','detailed']){
  const call=structuredClone(original);call.behavior_mode=mode;
  const t=tracePlay(call,execute),untraced=simulateAutonomousPlay(call);
  assert.deepEqual(t.record.result,untraced.result);assert.deepEqual(t.record.events,untraced.events);
  assert.equal(t.record.diagnostics.reconciliation.ok,true);
  const s=summarize(t);results.push(s);
  const old=tracePlay(call,baseline), prior=summarize(old);
  const blocked=s.rejected;
  rejectedTotal+=blocked.length;
  for(const draw of s.draws){
    if(draw.assignment&&['man','zone','read'].includes(draw.assignment.kind)){
      admittedCoverage++;assert.equal(draw.recognized,true,'coverage contest must follow recognized pass');
    }
  }
  for(const k of [...t.ticks.flatMap(k=>k.reasons),...t.outside_tick_reasons]){
    if(k.type==='catch_candidates')for(const c of k.candidates)
      if(c.team==='D'&&c.assignment&&c.assignment.kind!=='rush')assert.equal(c.recognized,true);
  }
  if(original.play_id.endsWith('four-verticals')&&mode==='retro'){
    const bad=prior.draws.find(d=>d.player_id==='chi-ss');
    assert.ok(bad&&prior.firstDefenderBreak&&bad.t_s<prior.firstDefenderBreak.t,'exact prior early-contest reproduction');
    assert.ok(blocked.some(d=>d.player_id==='chi-ss'&&Math.abs(d.t_s-bad.t_s)<1e-8),'reject exact premature contest');
    assert.ok(!s.draws.some(d=>d.player_id==='chi-ss'&&d.t_s<=bad.t_s+1e-8),'no premature draw');
    exactRegression=true;
  }
  console.log('PASS_GATE_PAIR '+JSON.stringify({id:s.id,mode,baseline:prior.terminal,candidate:s.terminal,
    baseline_draws:prior.draws,candidate_draws:s.draws,first_rejected:blocked[0]??null,rejected_count:blocked.length}));
  s.baseline={terminal:prior.terminal,draws:prior.draws,firstDefenderBreak:prior.firstDefenderBreak,firstContact:prior.firstContact};
  writeFileSync(join(process.argv[2]??'audit-output','pass-'+original.play_id.split(':').at(-1)+'-'+mode+'.json'),JSON.stringify(t));
  const {qb_reads,coverageReads,events,diagnostic,rejected,baseline:baselineSummary,...compact}=s;
  console.log('PASS_ROLE_AUDIT '+JSON.stringify({...compact,
    firstQBRead:qb_reads[0],lastQBRead:qb_reads.at(-1),
    coverage:coverageReads.filter(r=>r.recognized&&r.eligible).slice(0,1),
    funnel:diagnostic?Object.fromEntries(Object.entries(diagnostic).filter(([k])=>/reachable_ticks|min_planar|probability_draws|accuracy_offset/.test(k))):null,
    relevantEvents:events.filter(e=>['throw','catch_contest','pass_deflected','incomplete'].includes(e.type))}));
 }
}
assert.ok(exactRegression&&rejectedTotal>0,'must reproduce and eliminate premature contest');
assert.ok(admittedCoverage>0,'must still admit recognized coverage opportunities');
console.log('PASS_GATE_CONTRACTS '+JSON.stringify({exactRegression,rejectedTotal,admittedCoverage}));
writeFileSync(join(process.argv[2]??'audit-output','passing-role-audit.json'),JSON.stringify(results,null,2));
