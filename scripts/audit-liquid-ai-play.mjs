// Read-only diagnostic. Run in a dedicated Node process, never in the shared
// simulation server. This observes the actual synchronous executor, not a clone.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { Player, World } from '../engine/world.js';
import { ObservationMemory } from '../engine/autonomous/perception.js';
import { simulateAutonomousPlay } from '../engine/autonomous/simulator.js';
import { simulateAutonomousSpecialTeams } from '../engine/autonomous/special-teams.js';
import { exampleAssignments, exampleRunAssignments } from '../engine/autonomous/example-assignments.js';
import { buildSampleCall } from '../test/autonomous-fixtures.mjs';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const copy = value => {
  if (value instanceof Player) return { player_ref: value.id };
  if (value instanceof Map) return [...value.entries()].map(([k,v]) => [copy(k), copy(v)]);
  if (value instanceof Set) return [...value].map(copy);
  if (Array.isArray(value)) return value.map(copy);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).filter(([,v]) => typeof v !== 'function' && v !== undefined)
      .map(([k,v]) => [k,copy(v)]));
  return typeof value === 'function' || value === undefined ? null : value;
};
const playerState = p => ({
  id:p.id, role:p.roleKey, slot:p.slot, team:p.team, mode:p.mode, position_m:copy(p.p),
  velocity_mps:copy(p.v), desired_velocity_mps:copy(p.dv), force_N:copy(p.ext),
  heading_rad:p.h, face_rad:p.face, pose:p.pose, down:p.down, has_ball:p.hasBall,
  engaged_with:p.engaged?.id ?? null, shed_cooldown:p.shedCD, speed_cap:p.speedCap,
  force_cap:p.forceCap, stumble:p.stumble, ai:copy(p.ai),
});
const worldState = w => ({
  time_s:w.t, ball:copy(w.ball), players:w.players.map(playerState),
  engagements:copy(w.engagements), wraps:copy(w.wraps), event_count:w.events.length,
});
function changed(before,after) {
  return Object.fromEntries(Object.entries(after).filter(([k,v]) =>
    JSON.stringify(v)!==JSON.stringify(before[k])));
}
const execute = call => call.schema_version === 'gridiron.autonomous-special-teams.v1' ? simulateAutonomousSpecialTeams(call) : simulateAutonomousPlay(call);
export function tracePlay(call) {
  const ticks=[], owners=new WeakMap();
  let tick=null, world=null;
  const original=World.prototype.step;
  const priorAudit=World.prototype.auditDecision;
  World.prototype.auditDecision=function(type,data){ if(tick) tick.reasons.push({type,...copy(data)}); };
  const capture=ObservationMemory.prototype.capture, advance=ObservationMemory.prototype.advance,
    estimate=ObservationMemory.prototype.estimate;
  function memoryState(m) {return {pending:copy(m.pending),last_seen:copy(m.lastSeen),counts:copy(m.counts)};}
  ObservationMemory.prototype.capture=function(observer,target,blockers,at,options) {
    owners.set(this,observer.id);
    const result=capture.call(this,observer,target,blockers,at,options);
    if(tick) tick.memory.push({op:'capture',observer:observer.id,target:target.id,at_s:at,result:copy(result)});
    return result;
  };
  ObservationMemory.prototype.advance=function(now) {
    const result=advance.call(this,now);
    if(tick) tick.memory.push({op:'advance',observer:owners.get(this)??null,at_s:now,state:memoryState(this)});
    return result;
  };
  ObservationMemory.prototype.estimate=function(id,now) {
    const result=estimate.call(this,id,now);
    if(tick) tick.memory.push({op:'estimate',observer:owners.get(this)??null,target:id,at_s:now,result:copy(result)});
    return result;
  };
  World.prototype.step=function(dt,brain,afterBrains) {
    world=this;
    const row={index:ticks.length,dt_s:dt,before:worldState(this),decisions:[],memory:[],reasons:[]};
    tick=row;
    const result=original.call(this,dt,player=>{
      const before=playerState(player);
      brain(player);
      const after=playerState(player);
      row.decisions.push({id:player.id,role:player.roleKey,before,after,
        changed:changed(before,after)});
    },()=>{
      if(afterBrains)afterBrains();
      row.after_arbitration=worldState(this);
    });
    row.after_physics=worldState(this);
    row.events=copy(this.events.slice(row.before.event_count));
    ticks.push(row);tick=null;
    return result;
  };
  try {
    const record=execute(call);
    assert.ok(world && ticks.length,'actual World.step must execute');
    assert.ok(ticks.every(t=>t.decisions.length===22 && t.before.players.length===22
      && new Set(t.decisions.map(d=>d.id)).size===22),'each tick must visit all 22 players exactly once');
    return {schema:'gridiron.liquid-ai-tick-audit.v1',call:copy(call),
      units:{position:'meters',velocity:'meters/second',heading:'radians',time:'seconds'},
      ticks,final_world:worldState(world),record:copy(record)};
  } finally {
    World.prototype.step=original;
    if(priorAudit===undefined) delete World.prototype.auditDecision; else World.prototype.auditDecision=priorAudit;
    ObservationMemory.prototype.capture=capture;
    ObservationMemory.prototype.advance=advance;
    ObservationMemory.prototype.estimate=estimate;
  }
}
function sample(kind) {
  const run=kind==='run';
  const call=buildSampleCall(run?{family:'run',concept:'inside_zone',direction:'right'}:
    {family:'pass',concept:'assigned',snap_type:'shotgun',coverage:'cover_1'});
  call.play_id='liquid-audit:'+kind;call.seed=run?'5':'1042';
  call.assignments=run?exampleRunAssignments('right'):exampleAssignments('slant_flat','man');
  call.player_evaluation_mode='shared_snapshot';
  call.output_mode='result_only'; // the audit records native ticks independently of render frames
  if(!run) call.behavior_mode='retro';
  return call;
}
function scenarios() {
  const run = sample('run');
  const alternative = structuredClone(run); alternative.play_id='liquid-audit:run-backside-c'; alternative.assignments.offense.RB.aiming_gap='backside_c';
  const left=structuredClone(run); left.play_id='liquid-audit:run-left'; left.offense.call.direction='left'; left.assignments=exampleRunAssignments('left');
  const reversed=structuredClone(run); reversed.play_id='liquid-audit:run-field-reversed'; reversed.situation.offense_direction=-1;
  const front=structuredClone(run); front.play_id='liquid-audit:run-under'; front.defense.call.front='under';
  const pass=sample('pass');
  const zone=structuredClone(pass); zone.play_id='liquid-audit:slant-flat-zone'; zone.defense.call.coverage='cover_3'; zone.assignments=exampleAssignments('slant_flat','zone');
  const curls=structuredClone(zone); curls.play_id='liquid-audit:curls'; curls.assignments=exampleAssignments('curls','zone');
  const verticals=structuredClone(zone); verticals.play_id='liquid-audit:four-verticals'; verticals.assignments=exampleAssignments('four_verticals','zone');
  const saved = name => JSON.parse(readFileSync(new URL('../test/fixtures/'+name, import.meta.url),'utf8'));
  return [run,alternative,left,reversed,front,pass,zone,curls,verticals,
    saved('blocked-field-goal-seed-300027.json'),saved('muffed-kick-endline-seed-300021.json')];
}
function summarize(trace) {
  const {ticks,record}=trace;
  const roles=ticks[0].before.players.map(p=>({id:p.id,role:p.role,assignment:p.ai.playAssignment}));
  for(const role of roles) {
    const states=[];
    for(const tick of ticks) {
      const d=tick.decisions.find(d=>d.id===role.id),a=d.after.ai;
      const state={assignment:a.assignment??null,decision:a.decision??null,
        runner_state:a.runnerState??null,qb_state:a.quarterbackState??null,
        lane:a.lane??null,lane_locked:a.laneLocked??null,route_index:a.routeIndex??null,
        protection_released:a.protectionReleased??null,run_recognized:a.runRecognized??null,
        target:a.targetId??a.blockOn?.player_ref??null,engaged:d.after.engaged_with};
      if(!states.length||JSON.stringify(states.at(-1).state)!==JSON.stringify(state))
        states.push({tick:tick.index,t_s:tick.before.time_s,state});
    }
    role.transitions=states;
    role.memory_estimates=ticks.flatMap(t=>t.memory).filter(m=>m.observer===role.id&&m.op==='estimate').length;
  }
  return {call:trace.call,terminal:record.result,status:record.status,reconciliation:record.diagnostics.reconciliation,
    ticks:ticks.length,dt_s:ticks[0].dt_s,role_count:roles.length,roles,
    events:record.events.filter(e=>['snap','snap_receive','handoff','lane_read','runner_state','defensive_run_read',
      'qb_read','quarterback_state','throw','throw_away','route_break','protection_release','catch_contest',
      'pass_deflected','incomplete','tackle_attempt','sack','whistle','simulation_failure'].includes(e.type))};
}
const args=process.argv.slice(2);
const out=args[0]??'liquid-ai-audit';
const calls=args[1]?[JSON.parse(readFileSync(args[1],'utf8'))]:scenarios();
mkdirSync(out,{recursive:true});
const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
for(const [i,call] of calls.entries()) {
  const baseline=execute(call);
  const trace=tracePlay(call);
  assert.deepEqual(trace.record.result,baseline.result,'instrumentation must preserve result');
  assert.deepEqual(trace.record.events,baseline.events,'instrumentation must preserve all event rows');
  assert.deepEqual(trace.record.diagnostics.reconciliation,baseline.diagnostics.reconciliation);
  const summary=summarize(trace);
  summary.engine_commit=revision;summary.call_sha256=hash(call);summary.events_sha256=hash(baseline.events);
  summary.trace_sha256=hash(trace);summary.result_event_parity=true;
  const reasons=trace.ticks.flatMap(t=>t.reasons.map(r=>({tick:t.index,t_s:t.before.time_s,...r})));
  summary.rb_audit={reads:reasons.filter(r=>r.type==='rb_read'),score_evaluations:reasons.filter(r=>r.type==='rb_lane_scores').length,
    first_score:reasons.find(r=>r.type==='rb_lane_scores')??null,
    switch_guards:reasons.filter(r=>r.type==='rb_switch_guard'),
    selected_applied_differences:reasons.filter(r=>r.type==='rb_steering'&&r.selected_lane!==r.applied_lane).length,
    first_steering:reasons.find(r=>r.type==='rb_steering')??null};
  if(call.offense?.call.family==='run'){
    assert.ok(summary.rb_audit.reads.length,'must inspect actual RB reads');
    assert.equal(summary.rb_audit.reads[0].selected_gap,call.assignments.offense.RB.aiming_gap);
  }
  writeFileSync(join(out,'play-'+i+'.json'),JSON.stringify(trace));
  writeFileSync(join(out,'summary-'+i+'.json'),JSON.stringify(summary,null,2));
  const compact={...summary,call:{id:call.play_id??call.kind,family:call.offense?.call.family??call.kind,seed:call.seed},
    roles:summary.roles.map(r=>({role:r.role,transitions:r.transitions.length,memory_estimates:r.memory_estimates,
      ...( ['O.QB','O.RB','O.WR2','O.RT','D.MLB','D.RCB','D.MIKE','D.RDE'].includes(r.role)?
        {first:r.transitions.slice(0,6)}:{})})),events:summary.events.slice(0,30)};
  console.log('LIQUID_AUDIT '+JSON.stringify({...compact,roles:undefined,events:undefined,rb_audit:{...summary.rb_audit,reads:summary.rb_audit.reads.slice(0,12),switch_guards:summary.rb_audit.switch_guards.slice(0,5)}}));
}

copyFileSync(fileURLToPath(new URL('../liquid-ai-audit.html',import.meta.url)),join(out,'liquid-ai-audit.html'));
