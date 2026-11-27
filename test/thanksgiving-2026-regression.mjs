import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { statFieldSpot, serializeReturnGeometry } from '../engine/autonomous/field-geometry.js';
import { makeLiveProgressTracker } from '../engine/autonomous/live-progress.js';
import { simulateAutonomousPlay } from '../engine/autonomous/simulator.js';

assert.equal(statFieldSpot(102, 1), 0);
assert.equal(statFieldSpot(99.8, 1), 1);
assert.equal(statFieldSpot(0.2, 1), 99);
assert.throws(() => statFieldSpot(111, 1));
assert.deepEqual(serializeReturnGeometry({recoveryX:102, deadBallX:75, direction:1, carrierTeam:'D'}),
  {return_yards:25, return_displacement_yards:27});
assert.deepEqual(serializeReturnGeometry({recoveryX:-2, deadBallX:25, direction:-1, carrierTeam:'D'}),
  {return_yards:25, return_displacement_yards:27});
const slow = makeLiveProgressTracker({time:0,x:0,y:0,phase:'held:a',distance:.25});
for (let i=1;i<=480;i++) assert.ok(slow.observe({time:i/120,x:i/120,y:0,phase:'held:a'}) < .3);
const stuck = makeLiveProgressTracker({time:0,x:0,y:0,phase:'held:a',distance:.25});
assert.equal(stuck.observe({time:3.5,x:0,y:0,phase:'held:a'}),3.5);
assert.equal(stuck.observe({time:3.5,x:0,y:0,phase:'loose'}),0);

const evidence = JSON.parse(readFileSync(new URL('./fixtures/thanksgiving-2026-live-failures.json',import.meta.url),'utf8'));
const failures = [];
for (const row of evidence.plays) {
  try {
    const result = simulateAutonomousPlay({...row.call, output_mode:'result_only'});
    assert.equal(result.status,'complete',JSON.stringify(result.failure));
    assert.equal(result.diagnostics.reconciliation.ok,true,JSON.stringify(result.diagnostics.reconciliation));
    assert.equal(result.events.filter(e=>e.type==='whistle').length,1);
    console.log(row.game_id,row.game_seed,'PASS',result.result.event,result.result.elapsed_seconds);
  } catch (error) {
    failures.push({game:row.game_id,seed:row.game_seed,error:String(error)});
    console.error(row.game_id,row.game_seed,'FAIL',String(error));
  }
}
assert.deepEqual(failures,[]);
