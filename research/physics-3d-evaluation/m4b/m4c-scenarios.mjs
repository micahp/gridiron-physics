import { instantiateScenario } from './scenarios.mjs';

const cradle = (overrides = {}) => ({ mass: 0.41, shape: 'football', halfExtents: [0.145, 0.085, 0.085],
  localOffsetM: [0.43, 0.22, 0], controlPointsLocalM: [[0, 0, -0.06], [0, 0, 0.06]],
  springNPerM: 500, damperNsPerM: 22, gripCapacityN: 1600, pointCapacityN: 850,
  extensionLimitM: 0.50, releaseOverloadTicks: 2, maximumReachM: 0.72,
  maximumContactSpeedMps: 2.8, secureAfterSeconds: 0.5, ...overrides });

const wrap = (capacityN = 4200, overrides = {}) => ({ enabled: true, capacityN, springNPerM: 5600,
  damperNsPerM: 560, extensionLimitM: 0.62, releaseOverloadTicks: 2, ...overrides });
const player = (id, team, p, v, extra = {}) => ({ id, team, p, v, mass: 98, friction: 0.78, balanceScale: 0.45, ...extra });
const rusher = (id, p, v, extra = {}) => player(id, 'defense', p, v, { yawRad: Math.PI, mass: 106, wrap: wrap(), ...extra });

const library = new Map();
const save = (scenario) => { scenario.version = 4; library.set(scenario.id, scenario); };

const upright = instantiateScenario('gang-three-upright');
upright.players = [
  player('carrier', 'offense', [0, 0.845, 0], [1.35, 0, 0], { mass: 106, balanceScale: 0.04, wrap: null }),
  rusher('defender-a', [1.28, 0.845, -0.58], [-2.2, 0, 0.48], { drive: { forceN: [-1500, 0, 0], startSeconds: 0.22, endSeconds: 1.0, applicationLocalM: [0, 0.48, 0] } }),
  rusher('defender-b', [1.28, 0.845, 0.58], [-2.2, 0, -0.48], { drive: { forceN: [-1500, 0, 0], startSeconds: 0.35, endSeconds: 1.15, applicationLocalM: [0, 0.48, 0] } }),
  rusher('defender-c', [-1.55, 0.845, 0], [3.1, 0, 0], { mass: 90, wrap: wrap(3300), drive: { forceN: [1000, 0, 0], startSeconds: 0.62, endSeconds: 1.4 } }),
];
upright.carriedBall = cradle({ gripCapacityN: 4000 });
save(upright);

const staggered = instantiateScenario('gang-staggered-three');
staggered.players = [
  player('carrier', 'offense', [0, 0.845, 0], [2.1, 0, 0], { mass: 96, balanceScale: 0.06, wrap: null }),
  rusher('first-hit', [1.55, 0.845, 0.12], [-2.55, 0, -0.08], { wrap: wrap(4600), drive: { forceN: [-1550, 0, 0], startSeconds: 0.22, endSeconds: 1.0, applicationLocalM: [0, 0.45, 0] } }),
  rusher('second-hit', [1.0, 0.845, -1.25], [-0.7, 0, 1.7], { drive: { forceN: [-1250, 0, 0], startSeconds: 0.45, endSeconds: 1.35, applicationLocalM: [0, 0.45, 0] }, wrap: wrap(4400) }),
  rusher('third-hit', [-1.6, 0.845, 1.0], [2.6, 0, -1.4], { drive: { forceN: [950, 0, 0], startSeconds: 0.68, endSeconds: 1.6, applicationLocalM: [0, 0.45, 0] }, wrap: wrap(3600) }),
];
staggered.carriedBall = cradle({ gripCapacityN: 4000 });
save(staggered);

const sackFinish = instantiateScenario('sack-initiate-finish');
sackFinish.players = [
  player('quarterback', 'offense', [0, 0.845, 0], [0.3, 0, 0], { mass: 100, role: 'quarterback', balanceScale: 0.01 }),
  rusher('initiator', [1.42, 0.845, 0.08], [-3.1, 0, -0.12], { wrap: wrap(6500), drive: { forceN: [-1800, 0, 0], startSeconds: 0.24, endSeconds: 1.1, applicationLocalM: [0, 0.5, 0] } }),
  rusher('finisher', [-1.25, 0.845, 0.55], [2.7, 0, -0.5], { wrap: wrap(6800), drive: { forceN: [1450, 0, 0], startSeconds: 0.48, endSeconds: 1.4, applicationLocalM: [0, 0.5, 0] } }),
];
sackFinish.carrierId = 'quarterback'; sackFinish.carriedBall = cradle({ localOffsetM: [-0.43, 0.22, 0], gripCapacityN: 4000 });
save(sackFinish);

const throwWindow = instantiateScenario('sack-throw-window');
throwWindow.players = [
  player('quarterback', 'offense', [0, 0.845, 0], [0, 0, 0], { mass: 102, role: 'quarterback', balanceScale: 0.2 }),
  rusher('rusher-a', [1.45, 0.845, -0.38], [-2.55, 0, 0.28], { wrap: wrap(4200) }),
  rusher('rusher-b', [2.45, 0.845, 0.72], [-2.0, 0, -0.5], { wrap: wrap(4200) }),
];
throwWindow.sackTargetId = 'quarterback'; throwWindow.carrierId = 'quarterback';
throwWindow.carriedBall = cradle({ localOffsetM: [-0.43, 0.22, 0], gripCapacityN: 4000 });
throwWindow.throwAtSeconds = 0.52; throwWindow.throwVelocityMps = [16, 5, 0.2];
save(throwWindow);

const simultaneous = instantiateScenario('gang-two-opposite-open');
simultaneous.players = [
  player('carrier', 'offense', [0, 0.845, 0], [1.2, 0, 0], { mass: 90, balanceScale: 0, wrap: null }),
  rusher('defender-left', [1.55, 0.845, -0.40], [-2.7, 0, 0], { wrap: wrap(10000, { springNPerM: 8000, damperNsPerM: 800, extensionLimitM: 0.8 }),
    drive: { forceN: [-2600, 0, 0], startSeconds: 0.2, endSeconds: 1.7, applicationLocalM: [0, 0.55, 0] } }),
  rusher('defender-right', [1.55, 0.845, 0.40], [-2.6, 0, 0], { wrap: wrap(10000, { springNPerM: 8000, damperNsPerM: 800, extensionLimitM: 0.8 }),
    drive: { forceN: [-2600, 0, 0], startSeconds: 0.27, endSeconds: 1.7, applicationLocalM: [0, 0.55, 0] } }),
];
simultaneous.carriedBall = cradle({ gripCapacityN: 3800 });
save(simultaneous);

const sharedSack = instantiateScenario('sack-simultaneous-two');
sharedSack.players = [
  player('quarterback', 'offense', [0, 0.845, 0], [0.1, 0, 0], { mass: 102, role: 'quarterback', balanceScale: 0 }),
  rusher('rusher-left', [1.14, 0.845, -0.46], [-3.1, 0, 1.1], { wrap: wrap(7600, { springNPerM: 7200, damperNsPerM: 800 }), drive: { forceN: [-1750, 0, 0], startSeconds: 0.18, endSeconds: 1.2, applicationLocalM: [0, 0.5, 0] } }),
  rusher('rusher-right', [-1.25, 0.845, 0.62], [2.9, 0, -0.65], { wrap: wrap(7600, { springNPerM: 7200, damperNsPerM: 800 }), drive: { forceN: [1550, 0, 0], startSeconds: 0.32, endSeconds: 1.35, applicationLocalM: [0, 0.5, 0] } }),
];
sharedSack.carrierId = 'quarterback'; sharedSack.sackTargetId = 'quarterback';
sharedSack.carriedBall = cradle({ localOffsetM: [-0.43, 0.22, 0], gripCapacityN: 4000 });
save(sharedSack);

const pile = instantiateScenario('fumble-eight-pile-live-ball');
pile.players.find((row) => row.id === 'pile-defender-1').v = [-3.0, 0, 0];
pile.carriedBall = cradle({ localOffsetM: [0.75, 0.20, 0], springNPerM: 500, damperNsPerM: 22,
  gripCapacityN: 40, pointCapacityN: 40, extensionLimitM: 0.22, maximumContactSpeedMps: 3.0 });
pile.recoveryPolicy = { handAnchorLocalM: [0.08, -0.48, 0], maximumReachM: 1.0, maximumContactSpeedMps: 20,
  gripCapacityN: 1500, pointCapacityN: 800, springNPerM: 350, damperNsPerM: 15,
  extensionLimitM: 0.60, secureAfterSeconds: 0.5 };
delete pile.fumbleOnFirstContact;
delete pile.fumbleImpulseNs;
save(pile);

const retained = {
  id: 'possession-retained', category: 'ball-possession', title: 'Runner keeps the football through contact', durationSeconds: 2.4,
  carrierId: 'runner', seed: 41027,
  players: [player('runner', 'offense', [0, 0.845, 0], [4.0, 0, 0], { mass: 98, balanceScale: 0.8,
    drive: { forceN: [1200, 0, 0], startSeconds: 0.1, endSeconds: 1.0 } }),
    rusher('impact-defender', [1.35, 0.845, 0], [-4.0, 0, 0], { wrap: wrap(1600),
      drive: { forceN: [-1200, 0, 0], startSeconds: 0.1, endSeconds: 1.0 } })],
  carriedBall: cradle({ gripCapacityN: 1600, springNPerM: 500, damperNsPerM: 22,
    secureAfterSeconds: 1.0 }),
};
save(retained);

const fumble = {
  id: 'possession-force-fumble', category: 'ball-possession', title: 'Impact overloads the runner’s two-point cradle', durationSeconds: 2.2,
  carrierId: 'runner', seed: 41027,
  players: [player('runner', 'offense', [0, 0.845, 0], [1.5, 0, 0], { mass: 96, balanceScale: 0.8 }),
    rusher('ball-striker', [0.95, 0.845, 0], [-4.5, 0, 0], { mass: 112, wrap: null })],
  carriedBall: cradle({ springNPerM: 500, damperNsPerM: 22,
    gripCapacityN: 40, pointCapacityN: 40, extensionLimitM: 0.22 }),
};
save(fumble);

const looseBall = (p, v = [0, 0, 0], overrides = {}) => ({ mass: 0.41, shape: 'football',
  halfExtents: [0.145, 0.085, 0.085], p, v, angular: [0, 0, 0],
  localOffsetM: [0.08, -0.48, 0], springNPerM: 1500, damperNsPerM: 90,
  gripCapacityN: 900, pointCapacityN: 500, extensionLimitM: 0.35, releaseOverloadTicks: 2,
  controlPointsLocalM: [[0, 0, -0.06], [0, 0, 0.06]], ...overrides });

save({ id: 'recovery-failed', category: 'ball-possession', title: 'Fast strike contacts the ball but fails to cradle it',
  durationSeconds: 1.6, carrierId: 'striker', seed: 41027,
  players: [player('striker', 'defense', [-0.82, 0.845, 0], [6.5, 0, 0], { mass: 104, recovery: { maximumContactSpeedMps: 1.8, singleAttempt: true } })],
  looseBall: looseBall([0, 0.16, 0], [0, 0, 0], { springNPerM: 500, damperNsPerM: 22,
    gripCapacityN: 40, pointCapacityN: 40, extensionLimitM: 0.22 }),
  recoveryPolicy: { handAnchorLocalM: [0.08, -0.48, 0], maximumReachM: 0.7, maximumContactSpeedMps: 1.8 },
});

save({ id: 'recovery-secure', category: 'ball-possession', title: 'Player establishes and maintains a loose-ball cradle',
  durationSeconds: 1.8, carrierId: 'recoverer', seed: 41027,
  players: [player('recoverer', 'offense', [-0.46, 0.845, 0], [1.55, 0, 0], { mass: 96,
    recovery: { handAnchorLocalM: [0.08, -0.48, 0], maximumReachM: 0.76, maximumContactSpeedMps: 2.2 } })],
  looseBall: looseBall([0, 0.16, 0], [0, 0, 0], { springNPerM: 350, damperNsPerM: 15,
    localOffsetM: [0.08, -0.48, 0], gripCapacityN: 1500, pointCapacityN: 800, extensionLimitM: 0.60 }),
  recoveryPolicy: { handAnchorLocalM: [0.08, -0.48, 0], maximumReachM: 0.76,
    maximumContactSpeedMps: 2.2, gripEstablishmentSeconds: 0.08, secureAfterSeconds: 0.5 },
});

save({ id: 'recovery-contested', category: 'ball-possession', title: 'Two opponents reach for the same loose football',
  durationSeconds: 1.8, carrierId: 'recoverer-a', seed: 41027, allowContestedRecovery: true,
  players: [player('recoverer-a', 'offense', [-0.38, 0.845, -0.10], [0.6, 0, 0.06], { mass: 96 }),
    player('recoverer-b', 'defense', [0.38, 0.845, 0.10], [-0.6, 0, -0.06], { mass: 102 })],
  looseBall: looseBall([0, 0.16, 0], [0, 0, 0], { springNPerM: 300, damperNsPerM: 12,
    gripCapacityN: 1800, pointCapacityN: 900, extensionLimitM: 0.70 }),
  recoveryPolicy: { allowContestedRecovery: true, handAnchorLocalM: [0.08, -0.48, 0], maximumReachM: 0.78,
    maximumContactSpeedMps: 2.5, secureAfterSeconds: 0.5 },
});

const tush = instantiateScenario('tush-push-eight');
tush.players.find((row) => row.id === 'center').p = [-0.20, 0.845, 0];
tush.players.find((row) => row.id === 'guard-1').p = [-0.25, 0.845, -0.80];
tush.players.find((row) => row.id === 'guard-2').p = [-0.25, 0.845, 0.80];
tush.players.find((row) => row.id === 'defensive-front-left').p = [0.85, 0.845, -0.55];
tush.players.find((row) => row.id === 'defensive-front-right').p = [0.85, 0.845, 0.55];
tush.carriedBall = cradle({ localOffsetM: [-0.35, 0.22, 0], springNPerM: 300, damperNsPerM: 12,
  gripCapacityN: 1800, pointCapacityN: 900, extensionLimitM: 0.70,
  secureAfterSeconds: 0.25, maximumContactSpeedMps: 4.0 });
tush.ballOriginId = 'center'; tush.snapTargetId = 'quarterback'; tush.snapAtSeconds = 0;
tush.snapVelocityMps = [-1.2, 0.1, 0];
save(tush);

const line22 = instantiateScenario('short-yardage-22-player');
line22.players.filter((row) => row.id.startsWith('backfield-')).forEach((row, index) => {
  row.p = [[-2.7, 0.845, -1.8], [-3.6, 0.845, -1.35], [-2.7, 0.845, 1.35],
    [-3.6, 0.845, 1.8], [-3.2, 0.845, 0]][index];
});
line22.carriedBall = cradle({ localOffsetM: [-0.35, 0.22, 0], springNPerM: 300, damperNsPerM: 12,
  gripCapacityN: 1800, pointCapacityN: 900, extensionLimitM: 0.70,
  secureAfterSeconds: 0.25, maximumContactSpeedMps: 4.0 });
line22.ballOriginId = 'ol-3'; line22.snapTargetId = 'quarterback'; line22.snapAtSeconds = 0;
line22.snapVelocityMps = [-1.2, 0.1, 0];
save(line22);

export const M4C_SCENARIOS = Object.freeze([...library.values()]);
export const M4C_SCENARIO_BY_ID = new Map(M4C_SCENARIOS.map((scenario) => [scenario.id, scenario]));
export const M4C_PRIORITY_IDS = Object.freeze([
  'gang-two-opposite-open', 'sack-simultaneous-two', 'possession-retained', 'possession-force-fumble',
  'fumble-eight-pile-live-ball',
  'recovery-failed', 'recovery-secure', 'recovery-contested', 'tush-push-eight', 'short-yardage-22-player',
  'gang-three-upright', 'gang-staggered-three', 'sack-initiate-finish', 'sack-throw-window',
]);

export function instantiateM4CScenario(id, seed = 41027, overrides = {}) {
  const base = M4C_SCENARIO_BY_ID.get(id);
  if (!base) throw new Error(`Unknown M4c scenario: ${id}`);
  return structuredClone({ ...base, ...overrides, seed, version: 4 });
}
