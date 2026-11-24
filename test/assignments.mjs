import assert from 'node:assert/strict';
import { validateAssignments, ASSIGNMENT_SCHEMA } from '../engine/autonomous/assignments.js';

const call = { schema_version: ASSIGNMENT_SCHEMA,
  offense: { QB: { kind: 'quarterback' }, WR1: { kind: 'route', route: 'slant' }, LT: { kind: 'block' } },
  defense: { LCB: { kind: 'man', target_slot: 'WR1' }, FS: { kind: 'zone', bounds: [5, 20, -10, 10] },
    LEDGE: { kind: 'rush' } } };
assert.equal(validateAssignments(call), call);
assert.throws(() => validateAssignments({ ...call, offense: { WR1: { kind: 'route', route: 'wheel' } } }), /unsupported route/);
assert.throws(() => validateAssignments({ ...call, defense: { FS: { kind: 'zone', bounds: [5, 1, 0, 1] } } }), /invalid zone/);
assert.throws(() => validateAssignments({ ...call, outcome: 'complete' }), /prohibited outcome/);
console.log('assignment descriptions validate without realized outcomes');
