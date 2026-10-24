import test from 'node:test';
import assert from 'node:assert/strict';
import {LOOKS,sample,generate} from '../engine/what-if.js';
test('every illustrative table sums to exactly one',()=>{
 for(const look of Object.values(LOOKS)) assert.ok(Math.abs(look.complete+look.incomplete+look.sack+look.int-1)<1e-10);
});
test('seeded outcome is deterministic',()=>assert.deepEqual(sample('zone',101),sample('zone',101)));
test('all outcomes are accessible',()=>{
 const found=new Set();for(let i=0;i<2000;i++)found.add(sample('zone',i).kind);
 assert.deepEqual([...found].sort(),['complete','incomplete','int','sack']);
});
test('script is constructed without copying the observed outcome',()=>{
 const game={home:'7',away:'26',teams:{7:{abbr:'DEN'},26:{abbr:'SEA'}},players:{},
 plays:[{q:4,off:'7',def:'26',gain:99,kind:'run',lineup:{7:{QB:'q',WR1:'wr'},26:{RCB:'cb',REDGE:'edge'}}}]};
 const a=generate(game,'zone',101);
 assert.equal(a.play.down,3);assert.equal(a.play.dist,3);assert.equal(a.play.q,4);
 assert.equal(a.play.los,28);assert.equal(a.play.concept,'slant');assert.notEqual(a.play.kind,'run');
 assert.equal(a.play.qb,'q');assert.equal(a.play.lineup[7].WR1,'wr');
 assert.equal(game.plays[0].gain,99);
});
test('bad configurations reject',()=>{assert.throws(()=>sample('unknown',1));assert.throws(()=>sample('zone',-1))});
