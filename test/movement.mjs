import assert from 'node:assert/strict';
import { initializeMovementScene, proposeMovement, stepMovement, recordMovementFrame, replayMovement } from '../engine/movement/index.js';
import { hockeyResearchConfig, createHockeyConstraints, createHockeyMovementPolicy, hockeyFeatures, stepHockeyMovement } from '../engine/movement/sports/hockey.js';

const initial = initializeMovementScene({ observationStep: 7, puck: { x: 0, y: 0 },
  players: [
    { id: 'a', team: 'Home', x: -2, y: 0, history: [{ x: -4, y: 0 }, { x: -3, y: 0 }, { x: -2, y: 0 }] },
    { id: 'b', team: 'Away', x: 2, y: 0, history: [{ x: 4, y: 0 }, { x: 3, y: 0 }, { x: 2, y: 0 }] },
  ] }, hockeyResearchConfig);
const policy = (_state, id) => ({ playerId: id, dx: id === 'a' ? 3 : -3, dy: 0 });
const intents = proposeMovement(initial, policy);
const next = stepMovement(initial, intents, createHockeyConstraints({ maxDisplacement: 1, minimumPairSeparation: 2 }));
assert.equal(next.observationStep, 8);
assert.ok(next.players.every((p) => Math.abs(p.x) <= 100 && Math.abs(p.y) <= 42.5));
assert.equal(initial.players[0].x, -2, 'step must not mutate input');
const frame = recordMovementFrame(next, { model: 'test' });
assert.equal(replayMovement({ frames: [frame] })[0].provenance.model, 'test');
assert.equal(hockeyFeatures(initial, initial.players[0]).length, 23);
const model = { mean: [0, 0, 0, 0], scale: [1, 1, 1, 1],
  coefficients: [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0]], featureVersion: 'v0.1-test' };
const hockeyPolicy = createHockeyMovementPolicy(model);
const hockeyIntents = proposeMovement(initial, hockeyPolicy);
assert.equal(hockeyIntents.length, 2);
const hockeyState = initializeMovementScene({ observationStep: 0, puck: { x: 0, y: 0 },
  puckHistory: [{ x: -1, y: 0 }, { x: 0, y: 0 }], players: [
    { id: 'a', team: 'Home', x: -2, y: 0, history: [{ x: -4, y: 0 }, { x: -3, y: 0 }, { x: -2, y: 0 }] },
    { id: 'b', team: 'Away', x: 2, y: 0, history: [{ x: 4, y: 0 }, { x: 3, y: 0 }, { x: 2, y: 0 }] },
  ] }, hockeyResearchConfig);
const puckNext = stepHockeyMovement(hockeyState, proposeMovement(hockeyState, policy));
assert.equal(puckNext.puck.x, 1, 'puck helper advances by ordinal displacement');
assert.equal(puckNext.stepUnit, 'image_id_increment');
console.log('movement interface tests passed');
