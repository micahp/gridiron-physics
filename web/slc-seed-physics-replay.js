// Convert an immutable LP SLC game record into Gridiron's existing per-play
// outcome-constrained physics director inputs. LP remains authoritative for
// game state and outcomes; lineups come from the captured full team snapshot.
import { buildLineups, selectSpecialTeamsPlay } from './prototype-model.js';

const TEAM_STYLE = {
  MIN: { color: '#4f2683', alt: '#ffc62f', short: 'Vikings', name: 'Vikings' },
  DET: { color: '#0076b6', alt: '#b0b7bc', short: 'Lions', name: 'Lions' },
};
function actorEntry(person, participants, role, team) {
  if (person?.gsis_id) return { id: String(person.gsis_id), name: person.player_name || person.name || `${team} recorded ${role}`,
    team_id: person.team || team, position: person.pos_abb || person.position || 'WR', role };
  const id = participants?.[`${role}_id`];
  if (!id) return null;
  return { id: String(id), name: participants[`${role}_name`] || `${team} recorded ${role}`,
    team_id: participants[`${role}_team`] || team,
    position: participants[`${role}_position`] || 'WR', role };
}

function sourceActorProfile(actor, team, knownPlayers) {
  const player = knownPlayers.get(String(actor.id));
  if (!player) throw new Error(`SLC participant ${actor.id} is absent from the local ${team} roster`);
  if (player.team_id !== team) throw new Error(`SLC participant ${actor.id} is rostered to ${player.team_id}, not ${team}`);
  // The archived SLC event is authoritative for the named ball participants.
  // Retain them even if the later roster snapshot lists them as reserve.
  return player;
}

function playActors(play, offense) {
  const pre = play.outcome?.pre_event || {};
  const parts = play.participants || {};
  return {
    passer: actorEntry(pre.passer, parts, 'passer', offense),
    rusher: actorEntry(pre.rusher, parts, 'rusher', offense),
    receiver: actorEntry(pre.receiver, parts, 'receiver', offense),
  };
}

function useActor(lineup, actor, preferredSlots, team, knownPlayers, used) {
  if (!actor || actor.team_id !== team) return null;
  const player = sourceActorProfile(actor, team, knownPlayers);
  if (Object.values(lineup).some((id) => String(id) === String(actor.id))) {
    used.add(String(actor.id));
    return String(actor.id);
  }
  if (used.has(String(actor.id))) return String(actor.id);
  const slot = preferredSlots.find((candidate) => Object.hasOwn(lineup, candidate));
  if (!slot) throw new Error(`no Gridiron lineup slot for SLC participant ${player.name} (${player.position})`);
  lineup[slot] = String(actor.id);
  used.add(String(actor.id));
  return String(actor.id);
}

function sideTeams(record) {
  const bySide = Object.fromEntries(Object.entries(record.team_identity || {}).map(([side, value]) => [side, value.team]));
  return { A: bySide.A, B: bySide.B };
}

export function prepareSlcPhysicsReplay(record, teamSnapshot) {
  const teamsBySide = sideTeams(record);
  const home = record.teams?.home || Object.values(record.team_identity || {}).find((team) => team.side === 'home')?.team;
  const away = record.teams?.away || Object.values(record.team_identity || {}).find((team) => team.side === 'away')?.team;
  const rosterByTeam = Object.fromEntries([home, away].map((team) => {
    const roster = teamSnapshot?.teams?.[team]?.roster;
    if (!Array.isArray(roster) || roster.length < 53) {
      throw new Error(`${team} local full roster is missing or incomplete`);
    }
    const ids = roster.map((player) => String(player.id));
    if (new Set(ids).size !== ids.length) throw new Error(`${team} local roster contains duplicate player IDs`);
    if (roster.some((player) => !player.jersey || !player.physics || !player.ratings)) {
      throw new Error(`${team} local roster has a player without generated jersey, physics, or ratings`);
    }
    return [team, roster];
  }));
  const knownPlayers = new Map(Object.values(rosterByTeam).flat()
    .map((player) => [String(player.id), player]));
  const players = Object.fromEntries(Object.values(rosterByTeam).flat().map((player) => [player.id, player]));
  const teams = Object.fromEntries([home, away].map((team) => [team, { team_id: team, roster: rosterByTeam[team] }]));
  const game = { home, away, teams: { [home]: TEAM_STYLE[home] || { color: '#263b50', alt: '#d7e3ef', short: home, name: home },
    [away]: TEAM_STYLE[away] || { color: '#263b50', alt: '#d7e3ef', short: away, name: away } }, players };
  return { record, teamsBySide, rosterByTeam, teams, game, knownPlayers };
}

function locationFromLabel(value) {
  const v = String(value || '').toLowerCase();
  if (v === 'l' || v.includes('left')) return 'left';
  if (v === 'r' || v.includes('right')) return 'right';
  return 'middle';
}

function gapFromLabel(value) {
  const v = String(value || '').toLowerCase();
  if (v.includes('end')) return 'end';
  if (v.includes('tackle')) return 'tackle';
  if (v.includes('guard')) return 'guard';
  return 'middle';
}

function sourceField(play) {
  const field = play.field?.before;
  if (!field || ![-1, 1].includes(field.dir) || !Number.isFinite(field.los)) {
    throw new Error('the LP record has no supported field direction and line of scrimmage');
  }
  return field;
}

function scrimmageSelection(model, play, drive, offense, defense, field) {
  const generated = buildLineups(model.rosterByTeam[offense], model.rosterByTeam[defense]);
  const offenseLineup = { ...generated.offense };
  const defenseLineup = { ...generated.defense };
  const actors = playActors(play, offense);
  const used = new Set();
  const passer = useActor(offenseLineup, actors.passer, ['QB'], offense, model.knownPlayers, used);
  const rusherSlots = actors.rusher?.position === 'QB' ? ['QB']
    : actors.rusher?.position === 'TE' ? ['TE']
      : actors.rusher?.position === 'WR' ? ['WR1', 'WR2', 'WR3'] : ['RB'];
  const rusher = useActor(offenseLineup, actors.rusher, rusherSlots, offense, model.knownPlayers, used);
  const receiverGroup = actors.receiver?.position === 'TE' ? ['TE'] : actors.receiver?.position === 'RB' ? ['RB'] : ['WR1', 'WR2', 'WR3'];
  const receiver = useActor(offenseLineup, actors.receiver, receiverGroup, offense, model.knownPlayers, used);
  const pre = play.outcome?.pre_event || {};
  const labels = pre.labels || {};
  const sourceType = play.event_type;
  const kind = sourceType === 'run' || sourceType === 'fumble_lost' ? 'run'
    : sourceType === 'pass_complete' ? 'complete' : sourceType === 'pass_incomplete' ? 'incomplete'
      : sourceType === 'interception' ? 'int' : sourceType === 'sack' ? 'sack' : null;
  if (!kind) throw new Error(`no Gridiron scrimmage director for LP event ${sourceType}`);
  const gain = Number(play.outcome?.yards_gained ?? 0);
  const sourceAir = Number(play.participants?.air_yards);
  const air = Number.isFinite(sourceAir) && sourceAir > 0 ? sourceAir
    : /deep/i.test(String(labels.D || '')) ? 20 : /short/i.test(String(labels.D || '')) ? Math.max(1, Math.min(7, Math.max(1, gain))) : 12;
  const scenario = { id: play.id, off: offense, def: defense, dir: field.dir, los: field.los,
    lineup: { [offense]: offenseLineup, [defense]: defenseLineup }, text: `LP source play ${play.sequence}`,
    shotgun: /shotgun/i.test(pre.formation || ''), kind, kindGroup: kind === 'run' ? 'run' : 'pass',
    loc: locationFromLabel(kind === 'run' ? labels.K : labels.E), gap: gapFromLabel(labels.C),
    gain, td: Boolean(play.outcome?.touchdown), carrier: rusher || offenseLineup.RB,
    target: receiver || offenseLineup.WR1, air, yac: gain - air,
    interceptor: kind === 'int' ? defenseLineup.LCB : undefined,
    defender: kind === 'incomplete' ? defenseLineup.NB : undefined,
    end: kind === 'int' && Number.isFinite(play.field?.after?.los) ? play.field.after.los : undefined,
  };
  const unsupported = ['LP does not provide tracking trajectories; the other on-field players are assigned from the captured depth chart for this reconstructed formation.'];
  const reserveActors = [...new Map([actors.passer, actors.rusher, actors.receiver]
    .filter(Boolean).map((actor) => [String(actor.id), model.knownPlayers.get(String(actor.id))])).values()]
    .filter((player) => player && (player.status !== 'ACT' || player.availability !== 'available'));
  if (reserveActors.length) unsupported.push(`The archived SLC play names rostered participant(s) marked ${[...new Set(reserveActors.map((player) => player.status))].join('/')} in the local roster snapshot: ${reserveActors.map((player) => `${player.name} #${player.jersey}`).join(', ')}.`);
  if (sourceAir == null || !Number.isFinite(sourceAir)) unsupported.push('Pass depth is inferred from the LP play label because air yards are absent.');
  if (sourceType === 'fumble_lost') unsupported.push('The LP source records a fumble turnover; Gridiron shows the recorded run but does not model the fumble/recovery contact.');
  if (!actors.passer && ['complete', 'incomplete', 'int', 'sack'].includes(kind)) unsupported.push('LP omits passer identity for this play; the charted roster QB is used.');
  return { play: scenario, players: model.game.players,
    lineups: { ...generated, offense: offenseLineup, defense: defenseLineup },
    action_policy_inputs: { outcome_anchor: { event_type: sourceType, yards_gained: play.outcome?.yards_gained,
      touchdown: play.outcome?.touchdown, source_id: play.id } },
    execution_contract: { mode: 'outcome_constrained_3d_reconstruction', predictive_success: false, unsupported } };
}

function specialTeamsSelection(model, play, drive, offense, defense, field) {
  const afterLos = play.field?.after?.los;
  if (play.event_type === 'punt' && !Number.isFinite(afterLos)) {
    throw new Error('punt source has no next-possession spot for an outcome-constrained 3D kick');
  }
  const isFg = play.event_type === 'field_goal_attempt';
  const driveMade = drive.field_goal_made;
  const result = play.outcome?.field_goal_result;
  const good = result === 'made' ? true : result === 'missed' ? false : typeof driveMade === 'boolean' ? driveMade : null;
  if (isFg && good == null) throw new Error('field-goal made/missed result is absent from the LP record');
  const event = isFg
    ? { id: play.id, type: 'field_goal', offense, defense, yl: 100 - field.los, good,
      distance: play.outcome?.field_goal_feasibility?.kick_distance_yards }
    : { id: play.id, type: 'punt', offense, defense, yl: 100 - field.los, outcome: 'downed', receiving_spot: afterLos };
  const selected = selectSpecialTeamsPlay({ schema_version: 'gridiron.play_selection.v1', teams: model.teams,
    game_state: { game_id: model.record.game_id, quarter: play.state_before.quarter, clock_seconds: play.state_before.clock_seconds },
    demo_controls: { kind: isFg ? 'field_goal' : 'punt', event }, random_seed: String(play.id) });
  selected.play.id = play.id;
  selected.play.dir = field.dir;
  selected.play.los = field.los;
  if (!isFg) {
    selected.play.land = afterLos;
    selected.play.downed = true;
    selected.play.returner = undefined;
  }
  selected.execution_contract.unsupported.push('LP does not identify the special-teams unit or physical kick flight; Gridiron assembles the unit from the captured roster and depth chart.');
  if (!isFg) selected.execution_contract.unsupported.push('Punt return detail is absent; the 3D ball is downed at the LP next-possession spot.');
  else if (!good) selected.execution_contract.unsupported.push('LP records only made/missed; miss direction in the 3D clip is illustrative.');
  selected.action_policy_inputs.outcome_anchor = { source_id: play.id, event_type: play.event_type,
    good: isFg ? good : undefined, next_possession_spot: isFg ? undefined : afterLos };
  return selected;
}

export function selectionForSlcPlay(model, item) {
  const { play, drive } = item;
  const field = sourceField(play);
  const offense = model.teamsBySide[play.state_before.offense_team];
  const defense = model.teamsBySide[play.state_before.defense_team];
  if (!offense || !defense || offense === defense) throw new Error('LP play has an invalid offense/defense team join');
  if (play.event_type === 'punt' || play.event_type === 'field_goal_attempt') {
    return specialTeamsSelection(model, play, drive, offense, defense, field);
  }
  return scrimmageSelection(model, play, drive, offense, defense, field);
}

export function slcPlayLabel(play) {
  const labels = { run: 'Run', pass_complete: 'Pass complete', pass_incomplete: 'Pass incomplete', sack: 'Sack',
    interception: 'Interception', fumble_lost: 'Fumble lost', punt: 'Punt', field_goal_attempt: 'Field goal' };
  return labels[play.event_type] || play.event_type;
}

export function slcParticipantLine(play) {
  const pre = play.outcome?.pre_event || {};
  const names = [];
  if (pre.passer?.player_name) names.push(pre.passer.player_name);
  if (pre.rusher?.player_name) names.push(pre.rusher.player_name);
  if (pre.receiver?.player_name) names.push(pre.receiver.player_name);
  return [...new Set(names)].join(' · ');
}
