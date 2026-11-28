// Read-only audit of actual man-assignment steering before possession.
// Do not change the controller or choose outcomes to demonstrate the defect.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tracePlay, scenarios } from './audit-liquid-ai-play.mjs';
import { simulateAutonomousPlay } from '../engine/autonomous/simulator.js';
import { exampleAssignments } from '../engine/autonomous/example-assignments.js';

const out = process.argv[2] ?? 'audit-output';
mkdirSync(out, { recursive:true });
const base = scenarios().find(c=>c.play_id==='liquid-audit:pass');
assert.ok(base);
const cases = [base];
for (const concept of ['curls','four_verticals']) {
  const c = structuredClone(base);
  c.play_id = 'liquid-audit:man-' + concept;
  c.assignments = exampleAssignments(concept,'man');
  cases.push(c);
}
const reversed = structuredClone(base);
reversed.play_id = 'liquid-audit:man-field-reversed';
reversed.situation.offense_direction = -1;
cases.push(reversed);
const zone = structuredClone(base);
zone.play_id = 'liquid-audit:man-zone-negative';
zone.defense.call.coverage = 'cover_3';
zone.assignments = exampleAssignments('slant_flat','zone');
cases.push(zone);
const summaries=[];
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8, 'steering geometry differs: '+a+' vs '+b);
for (const call of cases) {
  const untraced=simulateAutonomousPlay(call), trace=tracePlay(call);
  assert.deepEqual(trace.record.result,untraced.result);
  assert.deepEqual(trace.record.events,untraced.events);
  assert.deepEqual(trace.record.diagnostics.reconciliation,untraced.diagnostics.reconciliation);
  const rows=[], counts={}, firstHidden={};
  const delivered=new Set();
  for (const tick of trace.ticks) {
    for (const m of tick.memory) if(m.op==='estimate' && m.result) delivered.add(m.observer+'|'+m.target);
    for (const row of tick.reasons.filter(r=>r.type==='man_coverage_tracking')) {
      const player=tick.before.players.find(p=>p.id===row.player_id);
      const target=tick.before.players.find(p=>p.id===row.target_id);
      const defenderSlot=Object.entries(call.defense.lineup).find(([,id])=>id===row.player_id)?.[0];
      const task=call.assignments.defense[defenderSlot];
      assert.equal(task.kind,'man');
      assert.equal(call.offense.lineup[task.target_slot],row.target_id);
      const decision=tick.decisions.find(d=>d.id===row.player_id);
      assert.ok(player && target && decision);
      for(const axis of ['x','y']){
        close(row.target_position_m[axis],target.position_m[axis]);
        close(row.target_velocity_mps[axis],target.velocity_mps[axis]);
        close(row.target_m[axis],target.position_m[axis]+target.velocity_mps[axis]*row.lead_seconds);
        close(row.desired_velocity_mps[axis],decision.after.desired_velocity_mps[axis]);
      }
      const dx=row.target_m.x-player.position_m.x,dy=row.target_m.y-player.position_m.y;
      const d=Math.hypot(dx,dy);
      const speed=d<0.04?0:Math.min(row.max_speed_mps*0.95,Math.sqrt(32*d));
      close(row.desired_velocity_mps.x,d<0.04?0:dx/d*speed);
      close(row.desired_velocity_mps.y,d<0.04?0:dy/d*speed);
      const seen=delivered.has(row.player_id+'|'+row.target_id);
      const entry={...row,tick:tick.index,role:defenderSlot,receiver_slot:task.target_slot,
        prior_delivered_receiver_estimate:seen};
      rows.push(entry);
      const counter=counts[defenderSlot]??={decisions:0,visible:0,occluded:0,outside_fov:0,out_of_range:0,without_memory:0};
      counter.decisions++;
      counter[row.visibility.reason==='visible'?'visible':row.visibility.reason]++;
      if(!seen)counter.without_memory++;
      if(!row.visibility.visible && !seen && !firstHidden[defenderSlot])firstHidden[defenderSlot]=entry;
    }
  }
  const summary={id:call.play_id,seed:call.seed,result:trace.record.result,
    tracking_decisions:rows.length,hidden_without_memory:rows.filter(r=>!r.visibility.visible&&!r.prior_delivered_receiver_estimate).length,
    counts,first_hidden_by_role:firstHidden};
  if(call===zone)assert.equal(rows.length,0,'zone assignment must not execute man tracking');
  else assert.ok(rows.length>0,'authored man assignments must execute actual tracking');
  summaries.push(summary);
  console.log('MAN_COVERAGE_AUDIT '+JSON.stringify(summary));
  writeFileSync(join(out,'man-coverage-'+call.play_id.split(':').at(-1)+'.json'),JSON.stringify({summary,rows},null,2));
}
assert.ok(summaries.some(r=>r.hidden_without_memory>0),'must reproduce invisible receiver tracking or report no reproduction');
