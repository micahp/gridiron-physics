import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {simulatePassPlay as candidate} from '../engine/autonomous/passing.js';
const {simulatePassPlay:baseline}=await import(pathToFileURL(resolve(process.argv[2],'engine/autonomous/passing.js')));
const defense=Object.fromEntries(['LDE','LDT','RDT','RDE','WILL','MIKE','LCB','RCB','NB','SS','FS'].map(role=>['D.'+role,{TAK:99,STR:99,PRC:99}]));
const run=(fn,car)=>fn({seed:6,front:'nickel',coverage:'cover_1',direction:'right',dir:1,los:40,ballY:26.67,resultOnly:true,
 ratingOverrides:{...Object.fromEntries(['QB','RB','TE','WR1','WR2','WR3'].map(role=>['O.'+role,{CAR:car}])),...defense}});
for(const car of [1,99]){
 const a=run(baseline,car),b=run(candidate,car);
 console.log('FROZEN_FUMBLE_PAIR '+JSON.stringify({car,baseline:{terminal:a.terminal,fumble:a.fumble,events:a.events.filter(e=>['throw','catch','interception','fumble','whistle'].includes(e.type))},candidate:{terminal:b.terminal,fumble:b.fumble}}));
 assert.deepEqual(a.terminal,b.terminal);assert.deepEqual(a.fumble,b.fumble);assert.deepEqual(a.events,b.events);
}
