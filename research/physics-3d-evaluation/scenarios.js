export const DT = 1 / 120;
export const PLAYER_HEIGHT = 1.82;
export const CONTACT_SWEEP_ANGLES_DEG = [0, 30, 60, 90];
export const CONTACT_SWEEP_SPEEDS_MPS = [4, 6, 8];

// World axes: x = downfield, y = vertical, z = across the field.
// The initial velocities are policy outputs for this controlled experiment;
// after launch, rigid-body motion and contact are resolved by the physics engine.
export const TACKLE_SCENARIOS = [
  { id: 'head-on', duration: 1.8, carrier: { p: [0, 0.845, 0], v: [3.0, 0, 0], mass: 96, strength: 80 }, defender: { p: [2.0, 0.845, 0], v: [-3.0, 0, 0], mass: 108, strength: 88 } },
  { id: 'side-tackle', duration: 1.8, carrier: { p: [0, 0.845, 0], v: [2.5, 0, 0], mass: 96, strength: 80 }, defender: { p: [0.45, 0.845, 1.25], v: [-0.5, 0, -3.2], mass: 108, strength: 88 } },
  { id: 'rear-pursuit', duration: 1.8, carrier: { p: [0.4, 0.845, 0], v: [4.0, 0, 0], mass: 96, strength: 80 }, defender: { p: [-1.45, 0.845, 0], v: [6.0, 0, 0], mass: 88, strength: 83 } },
  { id: 'high-speed', duration: 1.5, carrier: { p: [0, 0.845, 0], v: [8.0, 0, 0], mass: 92, strength: 79 }, defender: { p: [2.0, 0.845, 0], v: [-7.0, 0, 0], mass: 112, strength: 91 } },
  { id: 'low-speed', duration: 2.2, carrier: { p: [0, 0.845, 0], v: [1.0, 0, 0], mass: 104, strength: 87 }, defender: { p: [1.9, 0.845, 0], v: [-0.7, 0, 0], mass: 96, strength: 84 } },
  { id: 'glancing-impact', duration: 1.8, carrier: { p: [0, 0.845, 0], v: [4.3, 0, 0], mass: 96, strength: 80 }, defender: { p: [1.05, 0.845, 0.54], v: [-2.5, 0, -0.5], mass: 101, strength: 86 } },
  { id: 'escape-attempt-strength-drive', duration: 2.0, carrier: { p: [0, 0.845, 0], v: [3.2, 0, 0], mass: 106, strength: 92, postContactDrivePerStrengthN: 5.65 }, defender: { p: [1.95, 0.845, 0], v: [-2.7, 0, 0], mass: 84, strength: 76 } },
];

// Controlled geometry sweep. The stationary defender faces -x. The carrier
// starts 2 m away, travels directly into the defender at the requested speed,
// and is yaw-aligned to its travel vector. Angle is carrier heading relative
// to the defender's forward axis: 0° head-on; 90° side-on. Both players use
// fixed 96/108 kg masses, the shared five-collider proxy, and no outcome draw.
export function contactSweepScenario(approachAngleDeg, closingSpeedMps) {
  const angleRad = approachAngleDeg * Math.PI / 180;
  const dx = Math.cos(angleRad), dz = Math.sin(angleRad);
  return {
    id: `angle-${approachAngleDeg}-speed-${closingSpeedMps}`,
    duration: 1.5,
    carrier: {
      p: [-2 * dx, 0.845, -2 * dz],
      v: [closingSpeedMps * dx, 0, closingSpeedMps * dz],
      mass: 96,
      strength: 80,
      yawRad: -angleRad,
    },
    defender: {
      p: [0, 0.845, 0],
      v: [0, 0, 0],
      mass: 108,
      strength: 88,
      yawRad: Math.PI,
    },
  };
}

export const PASS_SCENARIO = {
  id: 'aerodynamic-pass-with-contested-target',
  duration: 1.55,
  flightTime: 1.15,
  launch: { x: 0, y: 0.05, z: 1.82 },
  target: { x: 16, y: 0.05, z: 1.65 },
  quarterback: { p: [-1.25, 0.845, 0], mass: 102 },
  receiver: { p: [16.0, 0.845, 0.05], v: [0, 0, 0], mass: 89, strength: 78 },
  defender: { p: [15.8, 0.845, 1.25], v: [0, 0, -0.08], mass: 96, strength: 85 },
};

export const PASS_DEFLECTION_SCENARIO = {
  ...PASS_SCENARIO,
  id: 'pass-with-defender-in-trajectory',
  defender: { p: [15.4, 0.845, 0.20], v: [0, 0, 0], mass: 96, strength: 85 },
};

export const BODY_LAYOUT = [
  // Approximate humanoid compound geometry, fixed to one freely rotating body.
  { part: 'torso', shape: 'capsule', pos: [0, -0.04, 0], halfHeight: 0.55, radius: 0.25, massShare: 0.55 },
  { part: 'pelvis', shape: 'capsule', pos: [0, -0.36, 0], halfHeight: 0.18, radius: 0.19, massShare: 0.20 },
  { part: 'head', shape: 'sphere', pos: [0, 0.62, 0], radius: 0.15, massShare: 0.07 },
  { part: 'left-arm', shape: 'capsule', pos: [0.03, 0.60, -0.15], halfHeight: 0.20, radius: 0.095, massShare: 0.09, axis: 'x' },
  { part: 'right-arm', shape: 'capsule', pos: [0.03, 0.60, 0.15], halfHeight: 0.20, radius: 0.095, massShare: 0.09, axis: 'x' },
];
