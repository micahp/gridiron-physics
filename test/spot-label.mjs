import assert from 'node:assert/strict';
import { mascotOf, spotText } from '../web/spot-label.js';

assert.equal(mascotOf('Kansas City Chiefs'), 'Chiefs');
assert.equal(mascotOf('Seattle Seahawks'), 'Seahawks');
assert.equal(spotText(80, 'KC', 'SEA'), 'KC 20', 'own side is read from the offense');
assert.equal(spotText(15, 'KC', 'SEA'), 'SEA 15', 'the opponent side is read from the defense');
assert.equal(spotText(50, 'KC', 'SEA'), 'MIDFIELD');
assert.equal(spotText(undefined, 'KC', 'SEA'), '');
console.log('PASS: mascot names and spot labels');
