// Shared pre-snap fixtures for the Stage One tests. These carry calls,
// personnel and physical profiles only; no fixture contains a result.
import { PLAY_SCHEMA } from '../engine/autonomous/schema.js';

const OFFENSE_ROLES = ['QB', 'RB', 'LT', 'LG', 'C', 'RG', 'RT', 'TE', 'WR1', 'WR2', 'WR3'];
const DEFENSE_ROLES = ['LEDGE', 'LDT', 'RDT', 'REDGE', 'MLB', 'WLB', 'NB', 'LCB', 'RCB', 'SS', 'FS'];

const ARCHETYPE = {
  QB: 'QB', RB: 'RB', LT: 'OL', LG: 'OL', C: 'OL', RG: 'OL', RT: 'OL', TE: 'TE',
  WR1: 'WR', WR2: 'WR', WR3: 'WR',
  LEDGE: 'DL', LDT: 'DL', RDT: 'DL', REDGE: 'DL',
  MLB: 'LB', WLB: 'LB', NB: 'DB', LCB: 'DB', RCB: 'DB', SS: 'DB', FS: 'DB',
};

/** Deterministic, distinct abilities per slot so tests can see who is who. */
export function profileFor(slot, side) {
  const base = { QB: 68, RB: 82, LT: 71, LG: 74, C: 76, RG: 73, RT: 70, TE: 69, WR1: 84, WR2: 80, WR3: 77 };
  const dBase = { LEDGE: 78, LDT: 75, RDT: 77, REDGE: 79, MLB: 74, WLB: 76, NB: 81, LCB: 83, RCB: 80, SS: 78, FS: 82 };
  const seed = (base[slot] ?? dBase[slot] ?? 70) + (side === 'D' ? -6 : 0);
  const ratings = { SPD: seed, ACC: seed, AGI: seed, STR: seed, AWR: seed, BTK: seed, ELU: seed, TAK: seed, PUR: seed, RBK: seed, IBL: seed, PBK: seed, BSH: seed, PMV: seed, FMV: seed, BCV: seed, CAR: seed, CTH: seed, PRC: seed, CIT: seed, TRK: seed };
  return {
    name: `${side} ${slot}`,
    ratings,
    physics: {},
  };
}

export function buildSampleCall(overrides = {}) {
  const offenseTeam = overrides.offenseTeam ?? 'NE';
  const defenseTeam = overrides.defenseTeam ?? 'CHI';
  const offenseLineup = Object.fromEntries(OFFENSE_ROLES.map((s) => [s, `ne-${s.toLowerCase()}`]));
  const defenseLineup = Object.fromEntries(DEFENSE_ROLES.map((s) => [s, `chi-${s.toLowerCase()}`]));
  const profiles = {};
  for (const [slot, id] of Object.entries(offenseLineup)) profiles[id] = profileFor(slot, 'O');
  for (const [slot, id] of Object.entries(defenseLineup)) profiles[id] = profileFor(slot, 'D');
  return {
    schema_version: PLAY_SCHEMA,
    mode: 'autonomous_from_snap',
    play_id: 'sandbox:inside-zone:1042',
    seed: '1042',
    situation: {
      quarter: 2, clock_seconds: 430, down: 2, yards_to_go: 6,
      yardline_100: 45, offense_direction: 1, ball_lateral_yards: 26.67,
    },
    offense: {
      team: offenseTeam,
      formation: 'singleback_11',
      call: {
        family: overrides.family ?? 'run',
        concept: overrides.concept ?? 'inside_zone',
        direction: overrides.direction ?? 'right',
        snap_type: overrides.snap_type ?? 'under_center',
      },
      lineup: offenseLineup,
    },
    defense: {
      team: defenseTeam,
      call: {
        front: overrides.front ?? 'nickel_over',
        coverage: overrides.coverage ?? 'cover_3',
        run_fit: 'spill_force',
      },
      lineup: defenseLineup,
    },
    player_profiles: profiles,
  };
}
