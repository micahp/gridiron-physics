import assert from 'node:assert/strict';
import { nextRecoveryAttempt } from '../engine/autonomous/contact-attempts.js';

const a = { id: 'a' }, b = { id: 'b' };
const attempts = new Set();
assert.equal(nextRecoveryAttempt(attempts, [a, b]), a);
assert.equal(nextRecoveryAttempt(attempts, [a, b]), b, 'second player is not blocked by nearest player');
for (let i = 0; i < 240; i++) {
  assert.equal(nextRecoveryAttempt(attempts, [a, b]), null, 'continuous contact never creates another draw');
}
assert.equal(nextRecoveryAttempt(attempts, [b]), null);
assert.equal(nextRecoveryAttempt(attempts, [a, b]), a, 'a player can try again after leaving contact');
assert.equal(nextRecoveryAttempt(attempts, []), null);
assert.equal(nextRecoveryAttempt(attempts, [b]), b, 'new contact begins a new opportunity');
console.log('loose-ball continuous-contact opportunities passed');
