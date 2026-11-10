// Versioned input contract for Stage One autonomous execution.
//
// The validator is deliberately strict: an autonomous play is defined only by
// the pre-snap call, the 22 declared players and their physical profiles. Any
// field that carries a realized outcome (yards gained, intended end spot,
// credited tackler, completion flag) is rejected rather than ignored, so a
// caller cannot smuggle a predetermined result into the engine.
export const PLAY_SCHEMA = 'gridiron.autonomous-play.v1';
export const RESULT_SCHEMA = 'gridiron.autonomous-result.v1';

// Field names that describe an outcome rather than a pre-snap fact.
export const PROHIBITED_FIELDS = [
  'gain', 'yards_gained', 'yards', 'endX', 'endY', 'end_x', 'end_y', 'endx', 'endy',
  'tackler', 'tacklers', 'sackers', 'sacker', 'complete', 'completion', 'touchdown',
  'interceptor', 'interception', 'outcome', 'outcome_anchor', 'expected_gain',
  'target_spot', 'final_spot', 'final_ball_spot', 'result', 'score', 'scoring',
  'tracking', 'tracking_frames', 'future_frames', 'future_tracking', 'post_snap_trajectory',
  'historical_record', 'history',
];

export const OFFENSE_ROLES = ['QB', 'RB', 'LT', 'LG', 'C', 'RG', 'RT', 'TE', 'WR1', 'WR2', 'WR3'];
export const DEFENSE_ROLES = ['LEDGE', 'LDT', 'RDT', 'REDGE', 'MLB', 'WLB', 'NB', 'LCB', 'RCB', 'SS', 'FS'];

// Contract front -> the front key the physics roster knows how to align.
export const FRONT_MAP = {
  nickel_over: 'nickel_over',
  nickel_under: 'nickel_under',
  nickel: 'nickel',
  over: 'over',
  under: 'under',
  even: 'even',
  odd: 'odd',
  bear: 'bear',
};

export const RUN_CONCEPTS = new Set(['inside_zone']);
export const PASS_CONCEPTS = new Set(['slant_flat']);
export const COVERAGES = new Set(['cover_1', 'cover_3']);
export const SNAP_TYPES = new Set(['under_center', 'shotgun']);

const RATING_NAMES = new Set([
  'SPD', 'ACC', 'AGI', 'STR', 'AWR', 'RBK', 'IBL', 'PBK', 'BSH', 'PMV', 'FMV',
  'TAK', 'BTK', 'ELU', 'BCV', 'TRK', 'PUR', 'CAR', 'PRC', 'CTH', 'CIT',
]);

/** Throw if any key anywhere in the payload names a realized outcome. */
export function assertNoOutcomeFields(value, path = '') {
  if (value == null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoOutcomeFields(item, `${path}[${i}]`));
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.toLowerCase();
    if (PROHIBITED_FIELDS.includes(normalized) || PROHIBITED_FIELDS.includes(key)) {
      throw new TypeError(`prohibited outcome field at ${path ? `${path}.` : ''}${key}: autonomous plays accept pre-snap inputs only`);
    }
    assertNoOutcomeFields(child, path ? `${path}.${key}` : key);
  }
}

const finite = (x) => typeof x === 'number' && Number.isFinite(x);
const requireObject = (value, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value;
};
const requireRange = (value, lo, hi, label) => {
  if (!finite(value) || value < lo || value > hi) throw new RangeError(`${label} must be a finite number from ${lo} to ${hi}`);
  return value;
};

/**
 * Validate a gridiron.autonomous-play.v1 payload.
 * Returns a normalized call description; throws on anything unsupported.
 */
export function validatePlayInput(input) {
  requireObject(input, 'play input');
  assertNoOutcomeFields(input);
  if (input.schema_version !== PLAY_SCHEMA) {
    throw new TypeError(`schema_version must be ${PLAY_SCHEMA}`);
  }
  if (input.mode !== 'autonomous_from_snap') {
    throw new TypeError('mode must be autonomous_from_snap');
  }
  if (typeof input.play_id !== 'string' || !input.play_id.trim()) throw new TypeError('play_id must be a non-empty string');
  if (!(typeof input.seed === 'string' && input.seed.trim()) && !Number.isInteger(input.seed)) {
    throw new TypeError('seed must be a non-empty string or an integer');
  }

  const situation = requireObject(input.situation, 'situation');
  const quarter = requireRange(situation.quarter, 1, 4, 'situation.quarter');
  const clock = requireRange(situation.clock_seconds, 0, 3600, 'situation.clock_seconds');
  const down = requireRange(situation.down, 1, 4, 'situation.down');
  const toGo = requireRange(situation.yards_to_go, 1, 99, 'situation.yards_to_go');
  const yardline = requireRange(situation.yardline_100, 1, 99, 'situation.yardline_100');
  if (situation.offense_direction !== 1 && situation.offense_direction !== -1) {
    throw new RangeError('situation.offense_direction must be 1 or -1');
  }
  const lateral = requireRange(situation.ball_lateral_yards, 1, 52.33, 'situation.ball_lateral_yards');

  const offense = requireObject(input.offense, 'offense');
  const defense = requireObject(input.defense, 'defense');
  if (typeof offense.team !== 'string' || !offense.team.trim()) throw new TypeError('offense.team must be a team abbreviation');
  if (typeof defense.team !== 'string' || !defense.team.trim()) throw new TypeError('defense.team must be a team abbreviation');
  if (offense.team === defense.team) throw new TypeError('offense and defense must be different teams');
  if (offense.formation !== 'singleback_11') throw new RangeError('only the singleback_11 formation is supported');

  const call = requireObject(offense.call, 'offense.call');
  if (call.family !== 'run' && call.family !== 'pass') throw new RangeError('offense.call.family must be run or pass');
  if (!RUN_CONCEPTS.has(call.concept) && !PASS_CONCEPTS.has(call.concept)) {
    throw new RangeError(`unsupported offensive concept: ${call.concept}`);
  }
  if (call.family === 'run' && !RUN_CONCEPTS.has(call.concept)) {
    throw new RangeError(`${call.concept} is a passing concept; set family to pass`);
  }
  if (call.family === 'pass' && !PASS_CONCEPTS.has(call.concept)) {
    throw new RangeError(`${call.concept} is a running concept; set family to run`);
  }
  if (call.direction !== 'left' && call.direction !== 'right') throw new RangeError('offense.call.direction must be left or right');
  if (!SNAP_TYPES.has(call.snap_type)) throw new RangeError(`unsupported snap type: ${call.snap_type}`);
  if (call.family === 'pass' && call.snap_type !== 'shotgun') throw new RangeError('quick passing is implemented from the shotgun only');

  const dcall = requireObject(defense.call, 'defense.call');
  if (!Object.hasOwn(FRONT_MAP, dcall.front)) throw new RangeError(`unsupported defensive front: ${dcall.front}`);
  if (!COVERAGES.has(dcall.coverage)) throw new RangeError(`unsupported coverage: ${dcall.coverage}`);
  if (dcall.run_fit != null && !['spill_force', 'box', 'cutback'].includes(dcall.run_fit)) {
    throw new RangeError(`unsupported run fit: ${dcall.run_fit}`);
  }

  const lineups = validateLineups(offense.lineup, defense.lineup, dcall);
  const profiles = validateProfiles(input.player_profiles, lineups);

  return {
    play_id: input.play_id,
    seed: String(input.seed),
    situation: {
      quarter, clock_seconds: clock, down, yards_to_go: toGo,
      yardline_100: yardline, offense_direction: situation.offense_direction,
      ball_lateral_yards: lateral,
    },
    offense: {
      team: offense.team, formation: 'singleback_11',
      family: call.family, concept: call.concept, direction: call.direction, snap_type: call.snap_type,
      lineup: lineups.offense,
    },
    defense: {
      team: defense.team, front: dcall.front, frontKey: FRONT_MAP[dcall.front],
      coverage: dcall.coverage, run_fit: dcall.run_fit ?? 'spill_force',
      lineup: lineups.defense,
    },
    profiles,
  };
}

function validateLineups(offenseLineup, defenseLineup, dcall) {
  const off = requireObject(offenseLineup, 'offense.lineup');
  const def = requireObject(defenseLineup, 'defense.lineup');
  const offKeys = Object.keys(off);
  const defKeys = Object.keys(def);
  if (offKeys.length !== 11) throw new RangeError(`offense lineup must contain exactly 11 players, received ${offKeys.length}`);
  if (defKeys.length !== 11) throw new RangeError(`defense lineup must contain exactly 11 players, received ${defKeys.length}`);
  const extraOff = offKeys.filter((k) => !OFFENSE_ROLES.includes(k));
  const extraDef = defKeys.filter((k) => !DEFENSE_ROLES.includes(k));
  if (extraOff.length) throw new RangeError(`unsupported offensive lineup slots: ${extraOff.join(', ')}`);
  if (extraDef.length) throw new RangeError(`unsupported defensive lineup slots: ${extraDef.join(', ')}`);
  for (const role of OFFENSE_ROLES) {
    if (typeof off[role] !== 'string' || !off[role].trim()) throw new TypeError(`offense.lineup.${role} must be a player id`);
  }
  for (const role of DEFENSE_ROLES) {
    if (typeof def[role] !== 'string' || !def[role].trim()) throw new TypeError(`defense.lineup.${role} must be a player id`);
  }
  if (dcall.front === 'nickel_over' || dcall.front === 'nickel_under' || dcall.front === 'nickel') {
    // nickel personnel carries a slot defender; the edge rushers replace SAM
  }
  const ids = [...Object.values(off), ...Object.values(def)];
  if (new Set(ids).size !== ids.length) throw new TypeError('each of the 22 player ids must be unique');
  return { offense: { ...off }, defense: { ...def } };
}

function validateProfiles(profiles, lineups) {
  const p = requireObject(profiles, 'player_profiles');
  const ids = [...Object.values(lineups.offense), ...Object.values(lineups.defense)];
  const normalized = new Map();
  for (const id of ids) {
    const profile = p[id];
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
      throw new TypeError(`player_profiles.${id} is required for every declared player`);
    }
    const ratings = profile.ratings ?? {};
    if (typeof ratings !== 'object' || Array.isArray(ratings)) throw new TypeError(`player_profiles.${id}.ratings must be an object`);
    for (const [name, value] of Object.entries(ratings)) {
      if (!RATING_NAMES.has(name)) throw new TypeError(`unsupported rating ${name} for ${id}`);
      if (!finite(value) || value < 1 || value > 99) throw new RangeError(`${id}.${name} must be from 1 to 99`);
    }
    const physics = profile.physics ?? {};
    if (typeof physics !== 'object' || Array.isArray(physics)) throw new TypeError(`player_profiles.${id}.physics must be an object`);
    for (const [name, value] of Object.entries(physics)) {
      if (!['mass', 'height', 'radius', 'vmax', 'f0', 'drive', 'alat', 'reach'].includes(name)) {
        throw new TypeError(`unsupported physical parameter ${name} for ${id}`);
      }
      if (!finite(value) || value <= 0) throw new RangeError(`${id}.${name} must be a positive finite number`);
    }
    if (physics.mass != null && (physics.mass < 50 || physics.mass > 200)) throw new RangeError(`${id}.mass must be from 50 to 200 kg`);
    if (physics.vmax != null && (physics.vmax < 3 || physics.vmax > 13)) throw new RangeError(`${id}.vmax must be from 3 to 13 m/s`);
    normalized.set(id, { ratings: { ...ratings }, physics: { ...physics } });
  }
  return normalized;
}
