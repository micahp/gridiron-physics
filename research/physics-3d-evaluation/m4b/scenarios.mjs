const P = (id, team, p, v = [0, 0, 0], extra = {}) => ({ id, team, p, v, mass: 96, friction: 0.72, balanceScale: 0.8, ...extra });
const defender = (id, p, v, extra = {}) => P(id, 'defense', p, v, { yawRad: Math.PI, mass: 104, ...extra });
const blocker = (id, p, extra = {}) => P(id, 'offense', p, [0, 0, 0], { mass: 128, friction: 0.9, drive: { forceN: [0, 0, 0] }, ...extra });
const wrap = (capacityN = 2600) => ({ enabled: true, capacityN, springNPerM: 4200, damperNsPerM: 440, extensionLimitM: 0.72, releaseOverloadTicks: 2 });
const carryBall = { mass: 0.41, shape: 'football', halfExtents: [0.145, 0.085, 0.085], localOffsetM: [0.43, 0.22, 0], springNPerM: 1450, damperNsPerM: 48, maxForceN: 150 };
const qbCarryBall = { ...carryBall, localOffsetM: [-0.43, 0.22, 0] };
const snapBall = { ...carryBall, localOffsetM: [-0.35, 0.22, 0] };

const threeDefenders = [
  defender('defender-a', [1.45, 0.845, -1.25], [-0.5, 0, 1.8], { wrap: wrap(2800) }),
  defender('defender-b', [1.55, 0.845, 1.25], [-0.6, 0, -1.8], { wrap: wrap(2800) }),
  defender('defender-c', [-1.7, 0.845, 0.05], [3.6, 0, 0], { mass: 88, wrap: wrap(1500) }),
];

const lineOffense = [-1.2, -0.6, 0, 0.6, 1.2].map((z, i) => blocker(`ol-${i + 1}`, [-0.52, 0.845, z], {
  drive: { forceN: [i === 2 ? 680 : 520, 0, 0], startSeconds: 0.08, endSeconds: 2.1, applicationLocalM: [0, 0.25, 0] },
}));
const lineDefense = [-1.45, -0.87, -0.29, 0.29, 0.87, 1.45].map((z, i) => defender(`front-${i + 1}`, [0.55 + (i % 2) * 0.34, 0.845, z], [0, 0, 0], {
  mass: 112 + (i % 3) * 4, drive: { forceN: [-420, 0, 0], startSeconds: 0.05, endSeconds: 2.1 },
}));

const pilePlayers = (count) => {
  const rows = [
    P('carrier', 'offense', [0, 0.845, 0], [1.25, 0, 0], { mass: 98, wrap: null }),
  ];
  for (let i = 0; i < count - 1; i++) {
    const angle = (2 * Math.PI * i) / Math.max(4, count - 1);
    const radius = i < 3 ? 0.92 : 1.45 + 0.15 * (i % 2);
    rows.push(defender(`pile-defender-${i + 1}`,
      [0.35 + Math.cos(angle) * radius, 0.845, Math.sin(angle) * radius],
      [-Math.cos(angle) * 0.8, 0, -Math.sin(angle) * 0.8], { mass: 90 + (i % 4) * 7, wrap: null }));
  }
  return rows;
};

const escapePilePlayers = [
  P('carrier', 'offense', [0, 0.845, 0], [1.2, 0, 0], { mass: 100, wrap: null }),
  defender('pile-tackler', [-0.65, 0.845, 0], [2.5, 0, 0], { wrap: null }),
  defender('pile-defender-2', [-0.75, 0.845, 0.52], [1.2, 0, -0.2], { wrap: null }),
  P('pile-teammate-3', 'offense', [-0.75, 0.845, -0.52], [1.2, 0, 0.2], { mass: 96, wrap: null }),
  defender('pile-defender-4', [-1.3, 0.845, 0.82], [1, 0, -0.35], { mass: 100, wrap: null }),
  P('pile-teammate-5', 'offense', [-1.3, 0.845, -0.82], [1, 0, 0.35], { mass: 112, friction: 0.8, wrap: null }),
  defender('pile-defender-6', [-1.9, 0.845, 0.32], [1.5, 0, 0], { mass: 90, wrap: null }),
  P('pile-teammate-7', 'offense', [-1.9, 0.845, -0.32], [1.5, 0, 0], { mass: 110, friction: 0.8, wrap: null }),
];

export const VERSION_PROFILES = Object.freeze({
  'proxy-v1-single-capsule': {
    id: 'proxy-v1-single-capsule', title: 'M4b proxy v1 · single capsule', geometry: 'single-capsule',
    description: 'One dynamic vertical capsule per player; 3D rotation and contacts are solver-resolved.',
  },
  'proxy-v2-compound': {
    id: 'proxy-v2-compound', title: 'M4b proxy v2 · five-part rigid compound', geometry: 'compound',
    description: 'Five fixed capsules/spheres form one freely rotating rigid player body; no articulated joints.',
  },
});

export const SCENARIOS = [
  {
    id: 'gang-two-opposite-open', category: 'gang-tackle', title: 'Two defenders, opposing angles, open field', durationSeconds: 7.5,
    players: [P('carrier', 'offense', [0, 0.845, 0], [2.5, 0, 0], { mass: 96, wrap: null }),
      defender('defender-left', [0.75, 0.845, -0.65], [-1.2, 0, 1.1], { wrap: wrap(3000) }),
      defender('defender-right', [0.75, 0.845, 0.65], [-1.2, 0, -1.1], { wrap: wrap(3000) })],
    carriedBall: carryBall,
  },
  {
    id: 'gang-three-upright', category: 'gang-tackle', title: 'Three defenders engage upright runner', durationSeconds: 7.5,
    players: [P('carrier', 'offense', [0, 0.845, 0], [1.25, 0, 0], { mass: 108, balanceScale: 1.1, wrap: null }), ...threeDefenders],
    carriedBall: carryBall,
  },
  {
    id: 'gang-four-blockers-congested', category: 'gang-tackle', title: 'Four defenders against runner and blockers', durationSeconds: 7.5,
    players: [P('carrier', 'offense', [-0.2, 0.845, 0], [1.8, 0, 0], { mass: 102, wrap: null }),
      ...lineOffense.slice(0, 3), ...lineDefense.slice(0, 3), defender('edge-rusher', [1.7, 0.845, 1.65], [-1.1, 0, -1.4], { wrap: wrap(2600) })],
    carriedBall: carryBall,
  },
  {
    id: 'gang-staggered-three', category: 'gang-tackle', title: 'First hit followed by second and third defenders', durationSeconds: 7.5,
    players: [P('carrier', 'offense', [0, 0.845, 0], [2.5, 0, 0], { mass: 94, wrap: null }),
      defender('first-hit', [1.45, 0.845, 0.15], [-2.0, 0, 0], { wrap: wrap(3200) }),
      defender('second-hit', [4.2, 0.845, -1.35], [0, 0, 0], { drive: { forceN: [-420, 0, 220], startSeconds: 0.9, endSeconds: 2.2 }, wrap: wrap(2400) }),
      defender('third-hit', [5.3, 0.845, 1.65], [0, 0, 0], { drive: { forceN: [-380, 0, -260], startSeconds: 1.45, endSeconds: 2.7 }, wrap: wrap(1800) })],
    carriedBall: carryBall,
  },
  {
    id: 'gang-one-grip-breaks', category: 'gang-tackle', title: 'One grip releases while a second remains', durationSeconds: 7.5,
    players: [P('carrier', 'offense', [0, 0.845, 0], [2.0, 0, 0], { mass: 104, drive: { forceN: [850, 0, 0], startSeconds: 0.6, endSeconds: 1.8 }, wrap: null }),
      defender('weak-holder', [1.35, 0.845, -0.45], [-1.0, 0, 0.2], { wrap: wrap(420) }),
      defender('strong-holder', [1.5, 0.845, 0.5], [-0.7, 0, -0.1], { wrap: wrap(4200) })],
    carriedBall: carryBall,
  },
  {
    id: 'gang-multiple-escape', category: 'gang-tackle', title: 'Runner escapes multiple low-capacity contacts', durationSeconds: 7.5,
    players: [P('carrier', 'offense', [0, 0.845, 0], [2.8, 0, 0], { mass: 112, drive: { forceN: [1250, 0, 0], startSeconds: 0.2, endSeconds: 1.8 }, wrap: null }),
      ...[0, 1, 2].map((i) => defender(`low-grip-${i + 1}`, [1.4 + i * 0.28, 0.845, (i - 1) * 0.55], [-0.4, 0, 0], { wrap: wrap(280) }))],
    carriedBall: carryBall,
  },
  {
    id: 'sack-simultaneous-two', category: 'shared-sack', title: 'Two rushers reach quarterback simultaneously', durationSeconds: 7.5,
    players: [P('quarterback', 'offense', [0, 0.845, 0], [0, 0, 0], { mass: 102, role: 'quarterback' }),
      defender('rusher-left', [1.0, 0.845, -0.55], [-1.4, 0, 0.9], { wrap: wrap(2800) }),
      defender('rusher-right', [1.0, 0.845, 0.55], [-1.4, 0, -0.9], { wrap: wrap(2800) })],
    carrierId: 'quarterback', carriedBall: qbCarryBall, sackTargetId: 'quarterback',
  },
  {
    id: 'sack-initiate-finish', category: 'shared-sack', title: 'One defender initiates, another completes takedown', durationSeconds: 7.5,
    players: [P('quarterback', 'offense', [0, 0.845, 0], [0.35, 0, 0], { mass: 98, role: 'quarterback' }),
      defender('initiator', [1.25, 0.845, 0.25], [-1.55, 0, -0.15], { wrap: wrap(2400) }),
      defender('finisher', [2.6, 0.845, -0.85], [-0.2, 0, 0], { drive: { forceN: [-480, 0, 220], startSeconds: 0.55, endSeconds: 2.3 }, wrap: wrap(2600) })],
    carrierId: 'quarterback', carriedBall: qbCarryBall, sackTargetId: 'quarterback',
  },
  {
    id: 'sack-throw-window', category: 'shared-sack', title: 'Quarterback releases before sack is complete', durationSeconds: 7.5,
    players: [P('quarterback', 'offense', [0, 0.845, 0], [0, 0, 0], { mass: 102, role: 'quarterback' }),
      defender('rusher-a', [1.9, 0.845, -0.65], [-1.55, 0, 0.15], { wrap: wrap(2200) }),
      defender('rusher-b', [2.35, 0.845, 0.8], [-0.7, 0, -0.25], { wrap: wrap(2200) })],
    carrierId: 'quarterback', carriedBall: carryBall, sackTargetId: 'quarterback',
    throwAtSeconds: 0.58, throwVelocityMps: [18, 5.5, 0.5],
  },
  {
    id: 'fumble-two-recovery', category: 'fumble-pileup', title: 'Loose ball, two opposing recovery attempts', durationSeconds: 7.5,
    players: [P('carrier', 'offense', [0, 0.845, 0], [1.5, 0, 0], { mass: 100, wrap: null }),
      defender('recovery-left', [1.25, 0.845, -0.6], [-1.0, 0, 0.8], { wrap: wrap(1400) }),
      defender('recovery-right', [1.25, 0.845, 0.6], [-1.0, 0, -0.8], { wrap: wrap(1400) })],
    carriedBall: carryBall, fumbleOnFirstContact: true,
  },
  {
    id: 'fumble-recovery-under-contact', category: 'fumble-pileup', title: 'Recovery attempt while another defender makes contact', durationSeconds: 7.5,
    players: [P('carrier', 'offense', [0, 0.845, 0], [1.5, 0, 0], { mass: 100, wrap: null }),
      defender('initial-tackler', [1.2, 0.845, 0], [-1.1, 0, 0], { wrap: wrap(1800) }),
      P('recovery-attempt', 'offense', [0.28, 0.845, 0.78], [0.15, 0, -0.65], { mass: 92, drive: { forceN: [240, 0, -110], startSeconds: 0.35, endSeconds: 1.4 } }),
      defender('contacting-defender', [1.15, 0.845, 1.05], [-0.55, 0, -0.62], { wrap: null })],
    carriedBall: carryBall, fumbleOnFirstContact: true,
  },
  {
    id: 'fumble-four-pile', category: 'fumble-pileup', title: 'Four-player recovery pileup', durationSeconds: 7.5,
    players: pilePlayers(4), carriedBall: carryBall, fumbleOnFirstContact: true,
  },
  {
    id: 'fumble-eight-pile-live-ball', category: 'fumble-pileup', title: 'Eight-player pile, ball can escape and stay live', durationSeconds: 7.5,
    players: pilePlayers(8),
    carriedBall: { ...carryBall, localOffsetM: [0.43, 0.22, 0], springNPerM: 1450 },
    fumbleOnFirstContact: true, fumbleImpulseNs: [0.8, 1.1, 1.7],
  },
  {
    id: 'fumble-eight-pile-ball-escapes', category: 'fumble-pileup', title: 'Eight-player scrum, loose ball escapes into open field', durationSeconds: 7.5,
    players: escapePilePlayers, carriedBall: carryBall, fumbleOnFirstContact: true, fumbleImpulseNs: [2.5, 0.6, 0],
  },
  {
    id: 'tush-push-eight', category: 'short-yardage-scrum', title: 'QB sneak with line drive and two teammates behind', durationSeconds: 7.5,
    players: [P('quarterback', 'offense', [-1.15, 0.845, 0], [0, 0, 0], { mass: 102, role: 'quarterback', drive: { forceN: [320, 0, 0], startSeconds: 0.05, endSeconds: 2.0 } }),
      blocker('center', [-0.62, 0.845, 0], { drive: { forceN: [650, 0, 0], startSeconds: 0.05, endSeconds: 2.0, applicationLocalM: [0, 0.2, 0] } }),
      ...[-0.62, 0.62].map((z, i) => blocker(`guard-${i + 1}`, [-0.66, 0.845, z], { drive: { forceN: [520, 0, 0], startSeconds: 0.05, endSeconds: 2.0 } })),
      P('push-back-a', 'offense', [-2.0, 0.845, -0.24], [0, 0, 0], { mass: 112, drive: { forceN: [650, 0, 0], startSeconds: 0.05, endSeconds: 1.4 } }),
      P('push-back-b', 'offense', [-2.48, 0.845, 0.24], [0, 0, 0], { mass: 112, drive: { forceN: [650, 0, 0], startSeconds: 0.2, endSeconds: 1.55 } }),
      defender('defensive-front-left', [0.62, 0.845, -0.55], [0, 0, 0], { drive: { forceN: [-320, 0, 120], startSeconds: 0.05, endSeconds: 2.0 } }),
      defender('defensive-front-right', [0.62, 0.845, 0.55], [0, 0, 0], { drive: { forceN: [-320, 0, -120], startSeconds: 0.05, endSeconds: 2.0 } })],
    carrierId: 'quarterback', ballOriginId: 'center', carriedBall: snapBall,
    snapAtSeconds: 0, snapTargetId: 'quarterback', snapVelocityMps: [-3.4, 0.65, 0],
  },
  {
    id: 'short-yardage-22-player', category: 'short-yardage-scrum', title: '22-player crowded line-of-scrimmage stress test', durationSeconds: 7.5,
    players: [
      P('quarterback', 'offense', [-1.5, 0.845, 0], [0, 0, 0], { mass: 102, role: 'quarterback', drive: { forceN: [260, 0, 0], startSeconds: 0.08, endSeconds: 2.2 } }),
      ...lineOffense,
      ...[-1.8, -1.35, 1.35, 1.8, -0.2].map((z, i) => P(`backfield-${i + 1}`, 'offense', [-1.35 - (i % 2) * 0.45, 0.845, z], [0, 0, 0], { mass: 96 + i * 2,
        drive: { forceN: [360, 0, 0], startSeconds: 0.12 + (i % 2) * 0.05, endSeconds: 1.65 } })),
      ...lineDefense,
      ...[-1.8, -1.35, 1.35, 1.8, 0].map((z, i) => defender(`second-level-${i + 1}`, [1.65 + (i % 2) * 0.32, 0.845, z], [0, 0, 0], {
        mass: 102 + i * 3, drive: { forceN: [-300, 0, 0], startSeconds: 0.12, endSeconds: 2.1 },
      })),
    ],
    carrierId: 'quarterback', ballOriginId: 'ol-3', carriedBall: snapBall,
    snapAtSeconds: 0, snapTargetId: 'quarterback', snapVelocityMps: [-3.4, 0.65, 0],
  },
];

export const SCENARIO_BY_ID = new Map(SCENARIOS.map((scenario) => [scenario.id, scenario]));
export const DEFAULT_SEED = 41027;

export function instantiateScenario(id, seed = DEFAULT_SEED) {
  const source = SCENARIO_BY_ID.get(id);
  if (!source) throw new Error(`Unknown M4b scenario: ${id}`);
  return structuredClone({ ...source, seed, version: 1 });
}
