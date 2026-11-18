// Interaction specs: the vocabulary the runtime (tackle-sim.js, tackles.js) and
// the validator (tools/validate-tackles.mjs) share. A spec says who takes part,
// when the interaction may be chosen, how much the runtime may correct to line
// the two bodies up, which body parts must touch, and what counts as a failure.
// Numbers are design limits to test against, not measured NFL or Madden values.

export const TACKLE_WRAP = {
  action: 'tackle.wrap',
  version: 1,
  actors: { attacker: 'defender', receiver: 'ball_carrier' },
  selection: {
    trigger_distance_m: 0.9,          // centre to centre when contact starts
    closing_speed_mps: [0, 16],
  },
  phases: {
    align: { duration_s: 0.12, max_root_shift_m: 0.22, max_rotation_deg: 25 },
    hold: { duration_s: [0.14, 0.55] },
    takedown: { duration_s: 0.72, fall_direction: 'combined_momentum' },
  },
  contact: {
    // during hold the attacker's palms must be on the receiver's body
    constraints: [
      { source: 'attacker.palmR', target: 'receiver.torso' },
      { source: 'attacker.palmL', target: 'receiver.torso' },
    ],
    tolerance_m: 0.05,
  },
  limits: {
    penetration_m: 0.04,              // deepest point of one body inside the other
    foot_slide_m: 0.1,                // drift of a planted foot over one plant
    root_speed_mps: 14,               // per-frame root motion faster than this is a pop
  },
  fallback: 'tackle.glancing',        // when alignment would exceed its limits
};

export const TACKLE_DIVE = {
  ...TACKLE_WRAP,
  action: 'tackle.dive',
  selection: { trigger_distance_m: 1.2, closing_speed_mps: [0, 16] },
  contact: {
    constraints: [
      { source: 'attacker.palmR', target: 'receiver.legs' },
      { source: 'attacker.palmL', target: 'receiver.legs' },
    ],
    tolerance_m: 0.06,
  },
};

export const SPECS = { wrap: TACKLE_WRAP, dive: TACKLE_DIVE };
