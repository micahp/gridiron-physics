import { simulatePlay } from '../engine/play.js';

const RATING_KEYS = ['ACC', 'AGI', 'AWR', 'BCV', 'BSH', 'BTK', 'CAR', 'CIT', 'CTH', 'ELU', 'FMV', 'IBL', 'INJ',
  'JMP', 'KAC', 'KPW', 'MCV', 'PBK', 'PMV', 'POW', 'PRC', 'PRS', 'PUR', 'RBK', 'RTE', 'SPC', 'SPD', 'STA',
  'STR', 'TAK', 'THA', 'THP', 'TRK', 'ZCV'];

// These neutral position profiles let the existing Week 7 physics director
// animate a statistical play without claiming LP supplied player measurements.
const PROFILES = {
  QB:  { mass: 101, height: 1.88, radius: 0.31, vmax: 8.1, tau: 0.86, drive: 710, alat: 6.3, reach: 3.05 },
  RB:  { mass: 96,  height: 1.82, radius: 0.30, vmax: 9.0, tau: 0.80, drive: 650, alat: 7.2, reach: 3.00 },
  WR:  { mass: 92,  height: 1.84, radius: 0.30, vmax: 9.2, tau: 0.82, drive: 610, alat: 7.4, reach: 3.00 },
  TE:  { mass: 112, height: 1.91, radius: 0.33, vmax: 8.2, tau: 0.88, drive: 800, alat: 6.1, reach: 3.18 },
  OL:  { mass: 137, height: 1.94, radius: 0.36, vmax: 7.3, tau: 0.96, drive: 980, alat: 4.9, reach: 3.28 },
  EDGE:{ mass: 119, height: 1.91, radius: 0.34, vmax: 8.0, tau: 0.88, drive: 870, alat: 6.0, reach: 3.18 },
  IDL: { mass: 137, height: 1.91, radius: 0.36, vmax: 7.2, tau: 0.98, drive: 1020, alat: 4.7, reach: 3.28 },
  LB:  { mass: 108, height: 1.87, radius: 0.32, vmax: 8.4, tau: 0.84, drive: 760, alat: 6.7, reach: 3.10 },
  DB:  { mass: 91,  height: 1.82, radius: 0.29, vmax: 9.0, tau: 0.81, drive: 620, alat: 7.5, reach: 2.95 },
  K:   { mass: 91,  height: 1.85, radius: 0.29, vmax: 8.0, tau: 0.87, drive: 600, alat: 6.0, reach: 2.95 },
};

const OFFENSE_SLOTS = ['LT', 'LG', 'C', 'RG', 'RT', 'QB', 'RB', 'TE', 'WR1', 'WR2', 'WR3'];
const DEFENSE_SLOTS = ['LEDGE', 'LDT', 'RDT', 'REDGE', 'MLB', 'WLB', 'LCB', 'RCB', 'NB', 'SS', 'FS'];
const OL_SLOTS = ['LT', 'LG', 'C', 'RG', 'RT'];

function playerInfo({ id, name, team, pos, profile }) {
  const physics = { ...profile, f0: profile.mass * profile.vmax / profile.tau };
  return {
    id, name, short: name, jersey: '?', team, pos, group: pos,
    ratings: Object.fromEntries(RATING_KEYS.map((key) => [key, 65])),
    physics,
  };
}

function profileForPosition(position) {
  if (position === 'QB' || position === 'RB' || position === 'WR' || position === 'TE') return PROFILES[position];
  if (position === 'FB') return PROFILES.TE;
  return PROFILES.DB;
}

function sideRoster(payload, side) {
  const team = payload.record.team_identity?.[side]?.team;
  const roster = Object.values(payload.pregame_snapshot?.rosters ?? {}).find((entry) => entry.team === team);
  if (!roster?.players?.length) throw new Error(`frozen pregame roster is missing for ${side} (${team ?? 'unknown'})`);
  return roster.players;
}

function generatedId(side, role) {
  return `gridiron:${side}:${role}`;
}

export function createWeek7StatisticalGame(payload) {
  const identities = payload.record.team_identity;
  const home = Object.keys(identities).find((side) => identities[side].side === 'home');
  const away = Object.keys(identities).find((side) => identities[side].side === 'away');
  if (!home || !away || home === away) throw new Error('record must identify distinct home and away teams');
  const rosters = { A: sideRoster(payload, 'A'), B: sideRoster(payload, 'B') };
  const players = {};
  for (const side of ['A', 'B']) {
    for (const source of rosters[side]) {
      players[source.gsis_id] = playerInfo({
        id: source.gsis_id, name: source.player_name, team: side, pos: source.pos_abb,
        profile: profileForPosition(source.pos_abb),
      });
    }
    for (const slot of OL_SLOTS) {
      const id = generatedId(side, `OL-${slot}`);
      players[id] = playerInfo({ id, name: `${identities[side].team} ${slot} · generic`, team: side, pos: 'OL', profile: PROFILES.OL });
    }
    for (const slot of DEFENSE_SLOTS) {
      const id = generatedId(side, `DEF-${slot}`);
      const group = ['LEDGE', 'REDGE'].includes(slot) ? 'EDGE'
        : ['LDT', 'RDT'].includes(slot) ? 'IDL'
          : ['MLB', 'WLB'].includes(slot) ? 'LB' : 'DB';
      players[id] = playerInfo({ id, name: `${identities[side].team} ${slot} · generic`, team: side, pos: group, profile: PROFILES[group] });
    }
    for (const role of ['K', 'P', 'LS', 'H']) {
      const id = generatedId(side, role);
      players[id] = playerInfo({ id, name: `${identities[side].team} ${role} · generic`, team: side, pos: role, profile: PROFILES.K });
    }
  }
  const colors = {
    KC: { color: '#e31837', alt: '#ffb81c', short: 'KC', name: 'Kansas City Chiefs' },
    SEA: { color: '#002244', alt: '#69be28', short: 'SEA', name: 'Seattle Seahawks' },
  };
  const teamStyle = (side) => colors[identities[side].team]
    ?? { color: '#33485b', alt: '#dbe9f2', short: identities[side].team, name: identities[side].team };
  return {
    home, away,
    teams: { A: teamStyle('A'), B: teamStyle('B') },
    players,
    rosters,
    identities,
  };
}

function offenseLineup(game, side, play) {
  const roster = game.rosters[side];
  const byId = new Map(roster.map((player) => [player.gsis_id, player]));
  const participants = play.participants ?? {};
  const lineup = {};
  const used = new Set();
  const valid = (id, fieldSide, accepted = null) => {
    const player = id == null ? null : byId.get(id);
    return player && (!fieldSide || participants[fieldSide] === side)
      && (!accepted || accepted.includes(player.pos_abb)) ? player : null;
  };
  const assign = (slot, player) => {
    if (!player || used.has(player.gsis_id)) return false;
    lineup[slot] = { pid: player.gsis_id };
    used.add(player.gsis_id);
    return true;
  };
  const ranked = (positions) => roster.filter((player) => positions.includes(player.pos_abb))
    .sort((a, b) => (a.pos_rank ?? 999) - (b.pos_rank ?? 999) || a.player_name.localeCompare(b.player_name));

  const passer = valid(participants.passer_id, 'passer_side', ['QB']);
  const rusher = valid(participants.rusher_id, 'rusher_side', ['RB', 'FB', 'QB']);
  const receiver = valid(participants.receiver_id, 'receiver_side', ['WR', 'TE', 'RB', 'FB']);
  assign('QB', passer ?? (rusher?.pos_abb === 'QB' ? rusher : null) ?? ranked(['QB'])[0]);
  if (rusher && rusher.pos_abb !== 'QB') assign('RB', rusher);
  if (receiver) {
    const slot = receiver.pos_abb === 'TE' ? 'TE' : ['RB', 'FB'].includes(receiver.pos_abb) ? 'RB' : 'WR1';
    assign(slot, receiver);
  }
  if (!lineup.RB) assign('RB', ranked(['RB', 'FB']).find((player) => !used.has(player.gsis_id)));
  if (!lineup.TE) assign('TE', ranked(['TE']).find((player) => !used.has(player.gsis_id)));
  const wideouts = ranked(['WR']).filter((player) => !used.has(player.gsis_id));
  if (lineup.WR1?.pid && byId.get(lineup.WR1.pid)?.pos_abb !== 'WR') delete lineup.WR1;
  if (receiver?.pos_abb === 'WR' && !lineup.WR1) assign('WR1', receiver);
  for (const slot of ['WR1', 'WR2', 'WR3']) {
    if (!lineup[slot]) assign(slot, wideouts.find((player) => !used.has(player.gsis_id)));
  }
  for (const slot of OL_SLOTS) {
    const id = generatedId(side, `OL-${slot}`);
    lineup[slot] = { pid: id };
  }
  for (const slot of ['QB', 'RB', 'TE', 'WR1', 'WR2', 'WR3']) {
    if (!lineup[slot]) throw new Error(`frozen ${game.identities[side].team} depth chart cannot fill ${slot}`);
  }
  const ids = Object.values(lineup).map((entry) => entry.pid);
  if (ids.length !== 11 || new Set(ids).size !== 11) throw new Error(`invalid 11-player offense for ${side}`);
  return lineup;
}

function defenseLineup(side) {
  return Object.fromEntries(DEFENSE_SLOTS.map((slot) => [slot, { pid: generatedId(side, `DEF-${slot}`) }]));
}

function teamUnits(game, side, kind, offense, defense) {
  const defenseIds = Object.values(defense).map((entry) => entry.pid);
  if (kind === 'punt') {
    return {
      [side]: [generatedId(side, 'P'), generatedId(side, 'LS'), ...OL_SLOTS.map((slot) => generatedId(side, `OL-${slot}`)),
        offense.QB.pid, offense.RB.pid, offense.TE.pid, offense.WR1.pid],
      [side === 'A' ? 'B' : 'A']: defenseIds,
    };
  }
  const fieldGoalUnit = [generatedId(side, 'K'), generatedId(side, 'LS'), generatedId(side, 'H'),
    ...OL_SLOTS.map((slot) => generatedId(side, `OL-${slot}`)), offense.QB.pid, offense.RB.pid, offense.TE.pid];
  return { [side]: fieldGoalUnit, [side === 'A' ? 'B' : 'A']: defenseIds };
}

export function buildWeek7StatisticalPlay(game, play) {
  const state = play.state_before;
  const off = state.offense_team;
  const def = state.defense_team;
  if (!['A', 'B'].includes(off) || def !== (off === 'A' ? 'B' : 'A')) throw new Error(`invalid possession on LP play ${play.sequence}`);
  const field = play.field?.before;
  if (!Number.isFinite(field?.los) || ![-1, 1].includes(field?.dir)) {
    throw new Error(`LP play ${play.sequence} has no pinned field direction and line of scrimmage`);
  }
  const offense = offenseLineup(game, off, play);
  const defense = defenseLineup(def);
  const lineups = { [off]: offense, [def]: defense };
  const engineLineup = Object.fromEntries(Object.entries(lineups).map(([side, slots]) => [side,
    Object.fromEntries(Object.entries(slots).map(([slot, entry]) => [slot, entry.pid]))]));
  const p = play.participants ?? {};
  const o = play.outcome ?? {};
  const script = {
    id: play.id,
    off,
    def,
    dir: field.dir,
    los: field.los,
    lineup: engineLineup,
    shotgun: true,
    text: 'LP statistical result anchored to an illustrative 3D physics replay',
    loc: 'middle',
    gap: 'guard',
    td: o.touchdown === true,
    gain: Number.isFinite(o.yards_gained) ? o.yards_gained : 0,
    replayNote: '3D movement is generated from generic position templates; the LP play result remains authoritative.',
  };
  let visualKind;
  switch (play.event_type) {
    case 'run':
      script.kind = 'run';
      script.kindGroup = 'run';
      script.carrier = p.rusher_id && game.players[p.rusher_id] ? p.rusher_id : offense.RB.pid;
      visualKind = 'physics';
      break;
    case 'sack':
      script.kind = 'sack';
      script.kindGroup = 'pass';
      script.sackers = [defense.LEDGE.pid];
      visualKind = 'physics';
      break;
    case 'pass_complete':
    case 'pass_incomplete':
    case 'interception': {
      const intercepted = play.event_type === 'interception' || o.turnover === true;
      script.kind = intercepted ? 'int' : play.event_type === 'pass_complete' ? 'complete' : 'incomplete';
      script.kindGroup = 'pass';
      script.target = p.receiver_id && game.players[p.receiver_id] ? p.receiver_id : offense.WR1.pid;
      script.interceptor = defense.NB.pid;
      script.end = Number.isFinite(play.field?.after?.los) ? play.field.after.los : undefined;
      const total = Math.abs(Number.isFinite(o.yards_gained) ? o.yards_gained : 7);
      script.air = Math.max(2, Math.min(24, Number.isFinite(p.air_yards) ? p.air_yards : Math.round(total * 0.65) || 7));
      script.yac = (Number.isFinite(o.yards_gained) ? o.yards_gained : 0) - script.air;
      visualKind = 'physics';
      break;
    }
    case 'fumble_lost':
      // The source does not identify the fumble carrier/recovery path. Render
      // the preceding pass/run motion and keep the LP turnover in the overlay.
      script.kind = p.sampled_play_context?.play_type === 'pass' ? 'complete' : 'run';
      script.kindGroup = script.kind === 'complete' ? 'pass' : 'run';
      script.carrier = p.rusher_id && game.players[p.rusher_id] ? p.rusher_id : offense.RB.pid;
      script.target = p.receiver_id && game.players[p.receiver_id] ? p.receiver_id : offense.WR1.pid;
      script.air = Math.max(2, Math.min(16, Number(p.air_yards) || 6));
      script.yac = (Number.isFinite(o.yards_gained) ? o.yards_gained : 0) - script.air;
      script.replayNote = 'LP records a lost fumble. The 3D director shows the play movement; fumble contact and recovery are not simulated.';
      visualKind = 'schematic_turnover';
      break;
    case 'punt': {
      const units = teamUnits(game, off, 'punt', offense, defense);
      script.kind = 'punt';
      script.kindGroup = 'kick';
      script.units = units;
      script.punter = generatedId(off, 'P');
      script.longSnapper = generatedId(off, 'LS');
      script.returner = undefined;
      script.downed = true;
      script.land = Number.isFinite(play.field?.after?.los) ? play.field.after.los : field.los + field.dir * 40;
      script.replayNote = 'Punt flight is a constrained 3D visualization; LP supplies the resulting possession and spot.';
      visualKind = 'physics';
      break;
    }
    case 'field_goal_attempt':
    case 'blocked_field_goal': {
      const units = teamUnits(game, off, 'field_goal', offense, defense);
      const blocked = play.event_type === 'blocked_field_goal' || o.field_goal_result === 'blocked';
      script.kind = 'fg';
      script.kindGroup = 'kick';
      script.units = units;
      script.kicker = generatedId(off, 'K');
      script.holder = generatedId(off, 'H');
      script.snapper = generatedId(off, 'LS');
      script.good = o.field_goal_result === 'made';
      script.miss = blocked ? 'short' : 'wide right';
      script.distance = state.yardline_100 + 17;
      script.blockedVisual = blocked;
      script.replayNote = blocked
        ? 'LP records a blocked field goal. The rush is physics-rendered; the deflection cue is constrained to LP’s result, not collision-solved.'
        : 'The kick animation is illustrative; LP supplies the made/missed result.';
      visualKind = blocked ? 'blocked_kick' : 'physics';
      break;
    }
    default:
      throw new Error(`unsupported LP event type: ${play.event_type}`);
  }
  return { script, visualKind, offense, defense };
}

function addBlockedKickCue(record, script) {
  const kick = record.events.find((event) => event.type === 'kick');
  if (!kick || !record.frames.length) return record;
  const n = record.roster.length;
  const offset = n * 6;
  const first = Math.max(0, Math.min(record.frames.length - 1, Math.round((kick.t - record.t0) * record.hz)));
  const last = Math.min(record.frames.length - 1, first + Math.round(0.32 * record.hz));
  const start = record.frames[first];
  const x0 = start[offset], y0 = start[offset + 1];
  const blockX = Math.max(0.5, Math.min(99.5, script.los + script.dir * 0.2));
  for (let i = first; i <= last; i++) {
    const frame = record.frames[i];
    const progress = last === first ? 1 : (i - first) / (last - first);
    frame[offset] = x0 + (blockX - x0) * progress;
    frame[offset + 1] = y0;
    frame[offset + 2] = 0.15 + Math.sin(progress * Math.PI) * 0.95;
    frame[offset + 4] = Math.PI;
    frame[offset + 5] = -0.45;
  }
  for (let i = last + 1; i < record.frames.length; i++) {
    const frame = record.frames[i];
    frame[offset] = blockX;
    frame[offset + 1] = y0;
    frame[offset + 2] = 0.15;
    frame[offset + 4] = Math.PI;
    frame[offset + 5] = 0;
  }
  return record;
}

export function simulateWeek7StatisticalPlay(game, play) {
  const mapped = buildWeek7StatisticalPlay(game, play);
  const record = simulatePlay(game, mapped.script, { ballY: 26.667 });
  if (!record?.frames?.length) throw new Error(`Gridiron physics returned no frames for LP play ${play.sequence}`);
  if (mapped.visualKind === 'blocked_kick') addBlockedKickCue(record, mapped.script);
  return { ...mapped, record };
}
