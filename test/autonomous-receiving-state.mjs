import assert from 'node:assert/strict';
import { receivingAssignmentActive } from '../engine/autonomous/passing.js';

assert.equal(receivingAssignmentActive({kind:'block'}, true), false);
assert.equal(receivingAssignmentActive({kind:'route',check_release:true}, false), false);
assert.equal(receivingAssignmentActive({kind:'route',check_release:true}, true, true), false);
assert.equal(receivingAssignmentActive({kind:'route',check_release:true}, true), true);
assert.equal(receivingAssignmentActive({kind:'route'}, false), true);
console.log('receiving assignment activation checks passed');
