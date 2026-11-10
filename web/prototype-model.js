import { rng } from '../engine/rng.js';

const skill = (p) => p.ratings || {};
const depth = (p) => (p.depth_chart_position || '').toUpperCase();
const nameOrder = (a, b) => (b.overall_estimate ?? 0) - (a.overall_estimate ?? 0) || a.name.localeCompare(b.name);

function available(roster) {
  return roster.filter((p) => p.availability === 'available' && p.status === 'ACT');
}

function choose(pool, role, used, accepts) {
  const p = pool.filter((x) => !used.has(x.id) && accepts(x)).sort(nameOrder)[0];
  if (!p) throw new Error(`incompatible or unavailable personnel for role ${role}`);
  used.add(p.id);
  return p.id;
}

/** Assemble a unique, active 11-player unit from the frozen roster snapshot. */
export function buildLineups(offRoster, defRoster, overrides = {}) {
  const offense = available(offRoster), defense = available(defRoster);
  const offUsed = new Set(), defUsed = new Set(), O = {}, D = {}, adaptations = [];
  const isOl = (p) => p.position === 'OL' && ['OT', 'IOL'].includes(p.rating_group);
  const isTackle = (p) => isOl(p) && ['T', 'OT', 'LT', 'RT'].includes(depth(p));
  const isInterior = (p) => isOl(p) && ['C', 'G', 'OG', 'IOL', 'LG', 'RG'].includes(depth(p));
  O.LT = choose(offense, 'LT', offUsed, isTackle);
  O.RT = choose(offense, 'RT', offUsed, isTackle);
  O.C = choose(offense, 'C', offUsed, (p) => isInterior(p) && depth(p) === 'C');
  O.LG = choose(offense, 'LG', offUsed, isInterior);
  try {
    O.RG = choose(offense, 'RG', offUsed, isInterior);
  } catch (err) {
    if (!String(err).includes('role RG')) throw err;
    O.RG = choose(offense, 'RG', offUsed, (p) => isOl(p) && ['T', 'OT'].includes(depth(p)));
    adaptations.push({ player_id: O.RG, engine_slot: 'RG', roster_role: depth(offense.find((p) => p.id === O.RG)),
      provenance: 'synthetic_variation', reason: 'active week-7 roster has no second charted interior lineman; simulator requires five OL slots' });
  }
  O.QB = choose(offense, 'QB', offUsed, (p) => p.position === 'QB' || depth(p) === 'QB');
  O.RB = choose(offense, 'RB', offUsed, (p) => p.position === 'RB' || depth(p) === 'RB');
  O.TE = choose(offense, 'TE', offUsed, (p) => p.position === 'TE' || depth(p) === 'TE');
  for (const slot of ['WR1', 'WR2', 'WR3']) O[slot] = choose(offense, slot, offUsed, (p) => p.position === 'WR' || depth(p) === 'WR');

  const isEdge = (p) => ['DE', 'EDGE', 'OLB'].includes(depth(p)) || (!depth(p) && p.rating_group === 'EDGE');
  const isInteriorD = (p) => ['DT', 'NT', 'IDL'].includes(depth(p)) || (!depth(p) && p.rating_group === 'IDL');
  const isLb = (p) => ['ILB', 'MLB', 'LB'].includes(depth(p)) || (p.position === 'LB' && depth(p) !== 'OLB');
  const isCb = (p) => depth(p) === 'CB' || (!depth(p) && p.rating_group === 'CB');
  const isSafety = (p) => ['FS', 'SS', 'S', 'SAF'].includes(depth(p)) || (!depth(p) && p.rating_group === 'S');
  for (const slot of ['LEDGE', 'REDGE']) D[slot] = choose(defense, slot, defUsed, isEdge);
  for (const slot of ['LDT', 'RDT']) D[slot] = choose(defense, slot, defUsed, isInteriorD);
  for (const slot of ['MLB', 'WLB']) D[slot] = choose(defense, slot, defUsed, isLb);
  for (const slot of ['LCB', 'RCB', 'NB']) D[slot] = choose(defense, slot, defUsed, isCb);
  for (const slot of ['SS', 'FS']) D[slot] = choose(defense, slot, defUsed, isSafety);
  for (const [slot, id] of Object.entries(overrides.offense || {})) {
    if (!(slot in O)) throw new Error(`unknown offensive substitution slot ${slot}`);
    O[slot] = id;
  }
  for (const [slot, id] of Object.entries(overrides.defense || {})) {
    if (!(slot in D)) throw new Error(`unknown defensive substitution slot ${slot}`);
    D[slot] = id;
  }
  validateLineups(offRoster, defRoster, O, D);
  const usedIds = new Set(Object.values(O));
  const finalAdaptations = adaptations.filter((a) => usedIds.has(a.player_id));
  for (const slot of ['LG', 'RG']) {
    const p = offRoster.find((x) => x.id === O[slot]);
    if (p && isOl(p) && !isInterior(p) && !finalAdaptations.some((a) => a.player_id === p.id)) {
      finalAdaptations.push({ player_id: p.id, engine_slot: slot, roster_role: depth(p), provenance: 'synthetic_variation',
        reason: 'player is an offensive lineman but the frozen depth chart does not list an interior role' });
    }
  }
  return { offense: O, defense: D, role_adaptations: finalAdaptations };
}

export function validateLineups(offRoster, defRoster, O, D) {
  const rosterById = new Map([...available(offRoster), ...available(defRoster)].map((p) => [p.id, p]));
  const entries = [...Object.entries(O).map(([slot, id]) => ({ side: 'offense', slot, id })),
    ...Object.entries(D).map(([slot, id]) => ({ side: 'defense', slot, id }))];
  if (entries.length !== 22) throw new Error(`expected 22 on-field players; got ${entries.length}`);
  const ids = entries.map((x) => x.id);
  if (new Set(ids).size !== ids.length) throw new Error('duplicate on-field player id');
  const offIds = new Set(offRoster.map((p) => p.id));
  const defIds = new Set(defRoster.map((p) => p.id));
  for (const e of entries) {
    const p = rosterById.get(e.id);
    if (!p) throw new Error(`player ${e.id} is unavailable or absent from active rosters`);
    const rightTeam = e.side === 'offense' ? offIds.has(e.id) : defIds.has(e.id);
    if (!rightTeam) throw new Error(`player ${e.id} belongs to wrong team for ${e.slot}`);
    if (e.side === 'offense') {
      const ol = ['LT', 'LG', 'C', 'RG', 'RT'].includes(e.slot);
      const compatible = ol ? p.position === 'OL' && (['OT', 'IOL'].includes(p.rating_group) || ['T', 'OT', 'C', 'G', 'OG'].includes(depth(p)))
        : e.slot === 'QB' ? p.position === 'QB' || depth(p) === 'QB'
          : e.slot === 'RB' ? p.position === 'RB' || depth(p) === 'RB'
            : e.slot === 'TE' ? p.position === 'TE' || depth(p) === 'TE'
              : p.position === 'WR' || depth(p) === 'WR';
      if (!compatible) throw new Error(`player ${e.id} has incompatible offensive role ${e.slot}`);
    } else {
      const ok = {
        LEDGE: (q) => ['DE', 'EDGE', 'OLB'].includes(depth(q)) || (!depth(q) && q.rating_group === 'EDGE'),
        REDGE: (q) => ['DE', 'EDGE', 'OLB'].includes(depth(q)) || (!depth(q) && q.rating_group === 'EDGE'),
        LDT: (q) => ['DT', 'NT', 'IDL'].includes(depth(q)) || (!depth(q) && q.rating_group === 'IDL'),
        RDT: (q) => ['DT', 'NT', 'IDL'].includes(depth(q)) || (!depth(q) && q.rating_group === 'IDL'),
        MLB: (q) => ['ILB', 'MLB', 'LB'].includes(depth(q)) || (q.position === 'LB' && depth(q) !== 'OLB'),
        WLB: (q) => ['ILB', 'MLB', 'LB'].includes(depth(q)) || (q.position === 'LB' && depth(q) !== 'OLB'),
        LCB: (q) => depth(q) === 'CB' || (!depth(q) && q.rating_group === 'CB'),
        RCB: (q) => depth(q) === 'CB' || (!depth(q) && q.rating_group === 'CB'),
        NB: (q) => depth(q) === 'CB' || (!depth(q) && q.rating_group === 'CB'),
        SS: (q) => ['FS', 'SS', 'S', 'SAF'].includes(depth(q)) || (!depth(q) && q.rating_group === 'S'),
        FS: (q) => ['FS', 'SS', 'S', 'SAF'].includes(depth(q)) || (!depth(q) && q.rating_group === 'S'),
      }[e.slot];
      if (!ok(p)) throw new Error(`player ${e.id} has incompatible defensive role ${e.slot}`);
    }
  }
  if (Object.keys(O).length !== 11 || Object.keys(D).length !== 11) throw new Error('each side must field exactly 11 players');
  return true;
}

// --------------------------------------------------------- special teams
// The game generator samples a special-teams outcome from the 2025 league
// tables. The director can animate that outcome, but it needs a full 11-on-11
// kicking formation. Both units come from the same frozen active rosters as
// the scrimmage path: K, P and LS by listed position, everyone else from the
// ordinary lineup. No player is invented for the replay.
const KICKING_DROPS = { kickoff: ['WR3'], punt: ['WR2', 'WR3'], fg: ['TE', 'WR2', 'WR3'] };

function specialist(roster, position, teamId) {
  const p = available(roster).find((x) => x.position === position);
  if (!p) throw new Error(`${teamId} has no active ${position} on the frozen roster`);
  return p;
}

// Some frozen rosters have no active kicker (Miami carries two unavailable
// kickers). An active punter is a real player who kicks off in the NFL, so use
// him and state the duty switch rather than inventing a kicker.
function kicker(roster, teamId, adaptations) {
  const k = available(roster).find((x) => x.position === 'K');
  if (k) return k;
  const p = available(roster).find((x) => x.position === 'P');
  if (!p) throw new Error(`${teamId} has no active kicker or punter on the frozen roster`);
  adaptations.push({
    player_id: p.id, engine_slot: 'K', roster_role: 'P', provenance: 'roster_status',
    reason: `${teamId} has no active kicker on the frozen roster; the active punter kicks off`,
  });
  return p;
}

function kickingUnit(base, dropped, specialists) {
  const unit = {};
  for (const [slot, id] of Object.entries(base)) if (!dropped.includes(slot)) unit[slot] = id;
  for (const [slot, id] of Object.entries(specialists)) unit[slot] = id;
  if (Object.keys(unit).length !== 11) {
    throw new Error(`special-teams unit must field 11, got ${Object.keys(unit).length}`);
  }
  return unit;
}

/**
 * Build the kicking and receiving units for one sampled special-teams event.
 * `kind` is the director's play kind (kickoff, punt or fg).
 */
export function buildSpecialTeamsLineups(kickRoster, retRoster, kickTeamId, retTeamId, kind) {
  if (!KICKING_DROPS[kind]) throw new Error(`unsupported special-teams unit: ${kind}`);
  const base = buildLineups(kickRoster, retRoster);
  const adaptations = [];
  const kickId = kicker(kickRoster, kickTeamId, adaptations).id;
  const punter = available(kickRoster).find((p) => p.position === 'P');
  const punterId = punter?.id ?? kickId;
  const longSnapperId = specialist(kickRoster, 'LS', kickTeamId).id;

  let dropped, specialists, holder = punterId;
  if (kind === 'kickoff') {
    dropped = KICKING_DROPS.kickoff;
    specialists = { K: kickId };
  } else if (kind === 'punt') {
    dropped = KICKING_DROPS.punt;
    specialists = { P: punterId, LS: longSnapperId };
  } else if (kickId === punterId) {
    // No separate kicker: the punter kicks and the quarterback holds, so the
    // unit keeps 11 distinct players instead of listing one man twice.
    dropped = ['TE', 'WR3'];
    specialists = { K: kickId, LS: longSnapperId };
    holder = base.offense.QB;
  } else {
    dropped = KICKING_DROPS.fg;
    specialists = { K: kickId, P: punterId, LS: longSnapperId };
  }
  const kicking = kickingUnit(base.offense, dropped, specialists);

  // The returner is the fastest receiving-team defender; relabel his slot so
  // the roster panel states the role instead of inventing a new player.
  const retById = new Map(available(retRoster).map((p) => [p.id, p]));
  const [returnerSlot, returnerId] = Object.entries(base.defense)
    .sort((a, b) => (retById.get(b[1])?.physics?.vmax ?? 0) - (retById.get(a[1])?.physics?.vmax ?? 0))[0];
  const receiving = { ...base.defense };
  delete receiving[returnerSlot];
  receiving[kind === 'punt' ? 'PR' : 'KR'] = returnerId;

  // The director treats the first kicking id as the kicker/punter and the
  // first receiving id as the returner, so order the units accordingly.
  const kickingOrder = (kind === 'kickoff' ? ['K'] : kind === 'punt' ? ['P', 'LS'] : ['K', 'LS', 'P'])
    .filter((slot) => slot in kicking);
  const units = {
    [kickTeamId]: [...kickingOrder.map((slot) => kicking[slot]),
      ...Object.entries(kicking).filter(([slot]) => !kickingOrder.includes(slot)).map(([, id]) => id)],
    [retTeamId]: [returnerId, ...Object.entries(receiving)
      .filter(([slot]) => slot !== (kind === 'punt' ? 'PR' : 'KR')).map(([, id]) => id)],
  };
  for (const [team, list] of Object.entries(units)) {
    if (list.length !== 11 || new Set(list).size !== 11) {
      throw new Error(`${team} special-teams unit needs 11 distinct players, got ${new Set(list).size} of ${list.length}`);
    }
  }
  return { kicking, receiving, units, returner: returnerId, holder, specialists, adaptations };
}

/** The physical play script for one sampled special-teams outcome. */
function specialTeamsPlay({ kind, kickTeamId, returnTeamId, event, units, returner, holder, specialists, seed }) {
  const dir = 1; // every special-teams replay is oriented with the kicking team attacking right
  const id = `demo:${kickTeamId}:${returnTeamId}:${kind}:${seed}`;
  const base = {
    id, off: kickTeamId, def: returnTeamId, kind, kindGroup: 'kick', dir, units,
    text: `Sampled 2025 ${kind.replace('_', ' ')} outcome; 22-player reconstructed alignment`,
  };
  if (kind === 'kickoff') {
    const los = event.touchback_type === 'midfield' ? 50 : 35;
    const returned = event.outcome === 'returned';
    const fairCatch = event.outcome === 'fair_catch';
    return {
      ...base, los,
      // Absolute yard line where the ball comes down in the kicking team's
      // frame (0 = kicking goal, 100 = receiving goal). The receiving spot is
      // already in that frame; a return starts where the ball landed.
      land: event.outcome === 'touchback' ? 103
        : returned ? Math.min(103, event.receiving_spot + event.return_yards)
          : event.receiving_spot,
      returner: returned || fairCatch ? returner : undefined,
      end: returned ? event.receiving_spot : undefined,
      touchback: event.outcome === 'touchback',
      oob: event.outcome === 'out_of_bounds',
      fairCatch,
    };
  }
  if (kind === 'punt') {
    const los = 100 - event.yl;
    const returned = event.outcome === 'returned';
    const fairCatch = event.outcome === 'fair_catch';
    return {
      ...base, los,
      punter: specialists.P, longSnapper: specialists.LS,
      // Same absolute frame as the kickoff: a punt lands `distance` past the
      // snap and a return starts from there.
      land: event.outcome === 'touchback' ? 103
        : returned ? Math.min(103, event.receiving_spot + event.return_yards)
          : event.receiving_spot,
      returner: returned || fairCatch ? returner : undefined,
      end: returned ? event.receiving_spot : undefined,
      touchback: event.outcome === 'touchback',
      oob: event.outcome === 'out_of_bounds',
      downed: event.outcome === 'downed',
      fairCatch,
    };
  }
  const los = 100 - event.yl;
  const misses = ['wide left', 'wide right', 'short'];
  const pick = [...String(event.id)].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 997, 7);
  return {
    ...base, los,
    kicker: specialists.K, holder, snapper: specialists.LS,
    good: Boolean(event.good),
    miss: event.good ? null : misses[pick % misses.length],
    distance: event.distance,
  };
}

/** Versioned adapter for a sampled special-teams event and its 2026 replay. */
export function selectSpecialTeamsPlay(input) {
  if (input?.schema_version !== 'gridiron.play_selection.v1') throw new Error('unsupported play-selection schema version');
  const state = input.game_state || {};
  const controls = input.demo_controls || {};
  const event = controls.event;
  const kind = controls.kind;
  if (!event) throw new Error('special-teams selection is missing the sampled event');
  if (!['kickoff', 'punt', 'field_goal'].includes(event.type)) throw new Error(`unsupported special-teams event: ${event.type}`);
  if (event.type === 'punt' && event.outcome === 'blocked') throw new Error('blocked punts have no physical replay model');
  if (event.type === 'field_goal' && event.blocked) throw new Error('blocked field goals have no physical replay model');
  const kickTeamId = event.type === 'kickoff' ? event.kicking_team : event.offense;
  const returnTeamId = event.type === 'kickoff' ? event.receiving_team : event.defense;
  const teams = input.teams || {};
  if (!teams[kickTeamId] || !teams[returnTeamId] || kickTeamId === returnTeamId) {
    throw new Error('special-teams team configuration join failed');
  }
  const joined = {};
  for (const id of [kickTeamId, returnTeamId]) {
    const source = teams[id];
    const activeIds = input.active_rosters?.[id] ? new Set(input.active_rosters[id]) : null;
    const inactiveIds = new Set(input.personnel_availability?.[id]?.inactive_ids || []);
    const roster = source.roster.filter((p) => (!activeIds || activeIds.has(p.id)) && !inactiveIds.has(p.id) &&
      p.status === 'ACT' && p.availability === 'available');
    if (activeIds && roster.length !== activeIds.size) throw new Error(`active roster join failed for ${id}`);
    joined[id] = { ...source, roster };
  }
  const playKind = kind === 'field_goal' ? 'fg' : kind;
  const units = buildSpecialTeamsLineups(joined[kickTeamId].roster, joined[returnTeamId].roster,
    kickTeamId, returnTeamId, playKind);
  const play = specialTeamsPlay({
    kind: playKind, kickTeamId, returnTeamId, event, units: units.units,
    returner: units.returner, holder: units.holder, specialists: units.specialists,
    seed: input.random_seed,
  });
  const players = Object.fromEntries([...joined[kickTeamId].roster, ...joined[returnTeamId].roster]
    .map((p) => [p.id, { ...p, team: p.team_id, pos: p.rating_position, group: p.rating_group }]));
  return {
    schema_version: 'gridiron.play_selection.v1',
    selection: {
      play_id: `${play.id}:${event.id}`,
      provenance: 'synthetic_replay_of_sampled_outcome',
      provenance_basis: '2025_league_special_teams_tables',
      team_id: kickTeamId, opponent_id: returnTeamId, formation_reference: null,
      selected_draws: { event_id: event.id, type: event.type, outcome: event.outcome ?? (event.good ? 'good' : 'miss'),
        return_yards: event.return_yards ?? null, distance: event.distance ?? null },
      role_adaptations: units.adaptations,
      random_seed: String(input.random_seed),
      probability_note: 'The outcome is sampled from 2025 league tables by the game generator. The 3D replay reconstructs that outcome; it is not a prediction.',
    },
    play,
    players,
    lineups: { offense: units.kicking, defense: units.receiving },
    action_policy_inputs: {
      outcome_anchor: { kind: event.type, outcome: event.outcome ?? (event.good ? 'good' : 'miss'),
        provenance: 'observed_2025_special_teams_tables', purpose: 'sampled outcome anchors the 3D replay' },
      game_state: state,
    },
    execution_contract: {
      mode: 'constrained_visualization', predictive_success: false,
      unsupported: ['special-teams outcome prediction; the replay reconstructs the sampled 2025 outcome',
        'blocked kicks, onside kicks and safeties have no physical replay model'],
      hidden_historical_outcome_constraints: false,
    },
  };
}

function normalizeGap(value) {
  const v = String(value || '').toLowerCase();
  if (['end', 'tackle', 'guard', 'middle'].includes(v)) return v;
  if (v.includes('tackle')) return 'tackle';
  if (v.includes('guard')) return 'guard';
  if (v.includes('end')) return 'end';
  return 'middle';
}

function observedCandidates(playbook, kind, formation) {
  return (playbook.offense.play_candidates?.[kind]?.candidates || [])
    .filter((candidate) => candidate.attributes?.formation === formation);
}

/** Build an explicitly constrained integration-demo input, never a prediction. */
export function createDemoScenario({ offenseId, defenseId, teams, playbooks, kind, formation, seed, candidateId = null, los = 45, dir = 1, personnelOverrides = {} }) {
  if (!['run', 'pass'].includes(kind)) throw new Error(`unsupported demo action: ${kind}`);
  const team = teams[offenseId], defenseTeam = teams[defenseId], playbook = playbooks[offenseId];
  if (!team || !defenseTeam || offenseId === defenseId) throw new Error('offense and defense must be distinct configured teams');
  if (!playbook || !playbook.offense?.profile) throw new Error(`missing offense play concepts for ${offenseId}`);
  const profile = playbook.offense.profile;
  const formationItem = profile.formation?.categories?.[formation];
  if (!formationItem) throw new Error(`formation ${formation} is not present in ${offenseId} observed_2025 data`);
  const candidates = observedCandidates(playbook, kind, formation);
  if (!candidates.length) throw new Error(`no observed ${kind} playbook entries are charted for ${formation} (${offenseId})`);
  const lineups = buildLineups(team.roster, defenseTeam.roster, personnelOverrides);
  const random = rng(`${seed}|${offenseId}|${defenseId}|${kind}|${formation}|${candidateId || ''}`);
  let candidate;
  if (candidateId) {
    candidate = candidates.find((item) => item.candidate_id === candidateId);
    if (!candidate) throw new Error(`playbook entry ${candidateId} is not a ${kind} entry for ${offenseId}/${formation}`);
  } else {
    const total = candidates.reduce((n, item) => n + item.count, 0);
    let pick = random() * total;
    candidate = candidates.find((item) => (pick -= item.count) < 0) || candidates.at(-1);
  }
  const attributes = candidate.attributes;
  const useShotgun = attributes.shotgun;
  const players = Object.fromEntries([...team.roster, ...defenseTeam.roster].map((p) => [p.id, {
    ...p, team: p.team_id, pos: p.rating_position, group: p.rating_group,
  }]));
  const lineupsByTeam = { [offenseId]: lineups.offense, [defenseId]: lineups.defense };
  let play, draw;
  if (kind === 'run') {
    const loc = attributes.run_location;
    const gap = attributes.run_gap;
    const carrier = lineups.offense.RB;
    // This synthetic gain exists only because the current director pins runs to S.gain.
    const syntheticGain = Math.round((1.5 + random() * 6) * 10) / 10;
    play = {
      id: `demo:${offenseId}:${defenseId}:run:${seed}:${candidate.candidate_id}`, off: offenseId, def: defenseId,
      kind: 'run', kindGroup: 'run', los, dir, shotgun: useShotgun,
      text: `Synthetic 11-personnel alignment; observed ${formation} attribute-combination reference`, lineup: lineupsByTeam,
      carrier, gain: syntheticGain, loc: loc || 'middle', gap: normalizeGap(gap),
    };
    draw = { location: loc, gap };
  } else {
    const loc = attributes.pass_location;
    const depthItem = attributes.pass_length;
    const targetSlot = ['WR1', 'WR2', 'WR3'][Math.floor(random() * 3)];
    const air = /deep/i.test(depthItem || '') ? 22 : /short/i.test(depthItem || '') ? 7 : 14;
    play = {
      id: `demo:${offenseId}:${defenseId}:pass:${seed}:${candidate.candidate_id}`, off: offenseId, def: defenseId,
      kind: 'incomplete', kindGroup: 'pass', los, dir, shotgun: useShotgun,
      text: `Synthetic 11-personnel alignment; observed ${formation} attribute-combination reference`, lineup: lineupsByTeam,
      target: lineups.offense[targetSlot], air, loc: loc || 'middle',
    };
    draw = { location: loc, depth: depthItem, targetSlot };
  }
  const typeCategory = profile.run_pass?.categories?.[kind];
  const typeRate = typeCategory ? typeCategory.rate : null;
  return {
    schema_version: 'gridiron.play_selection.v1',
    selection: {
      play_id: `demo-${candidate.candidate_id}-${seed}`,
      provenance: 'synthetic_variation', provenance_basis: 'observed_2025', team_id: offenseId,
      opponent_id: defenseId, formation_reference: formation,
      playbook_entry: {
        candidate_id: candidate.candidate_id, provenance: candidate.provenance,
        candidate_kind: candidate.candidate_kind, action: candidate.action,
        attributes: candidate.attributes, count: candidate.count, denominator: candidate.denominator,
        rate: candidate.rate, ci95_wilson: candidate.ci95_wilson, source_ids: candidate.source_ids,
        claim_limit: candidate.claim_limit,
      },
      formation_observation: { count: formationItem.count, denominator: profile.formation.observed,
        eligible_denominator: profile.formation.denominator, rate: formationItem.rate,
        ci95_wilson: formationItem.ci95_wilson, source_ids: formationItem.source_ids },
      historical_type_marginal_rate: typeRate,
      historical_type_marginal_ci95_wilson: typeCategory?.ci95_wilson ?? null,
      personnel_concept: '11 personnel (1 RB, 1 TE, 3 WR); synthetic demo unit, not necessarily the selected historical formation personnel',
      selected_draws: draw,
      random_seed: String(seed), selection_probability: null,
      probability_note: 'The demo is user-selected. Historical play-type and formation frequencies are separate marginals, not a calibrated joint selection probability.',
    },
    play,
    players,
    lineups,
    action_policy_inputs: kind === 'run'
      ? { carrier_id: play.carrier, concept: 'synthetic run using selected charted gap/location labels', blockers: 'engine-generated run blocking', defense: 'engine-generated pursuit', outcome_anchor: { field: 'gain', value: play.gain, provenance: 'synthetic_variation', purpose: 'required by the current outcome-constrained director' } }
      : { target_id: play.target, target_role: draw.targetSlot, concept: 'synthetic pass using selected charted depth/direction labels', other_routes: 'engine generated', coverage: 'engine generated', outcome_anchor: { kind: 'incomplete', provenance: 'synthetic_variation', purpose: 'demo-only supported throw and resolution path' } },
    execution_contract: {
      mode: 'constrained_visualization', predictive_success: false,
      unsupported: kind === 'run'
        ? ['free-running outcome selection; current engine requires a fixed gain/end-spot anchor']
        : ['catch/incompletion outcome prediction; demo deliberately selects the engine incomplete branch', 'custom route and coverage assignment injection'],
      hidden_historical_outcome_constraints: false,
    },
  };
}

/** Versioned adapter for the parallel play-selection contract. */
export function selectPlay(input) {
  if (input?.schema_version !== 'gridiron.play_selection.v1') throw new Error('unsupported play-selection schema version');
  const state = input.game_state || {};
  const offenseId = state.offense_team_id, defenseId = state.defense_team_id;
  if (!input.teams?.[offenseId] || !input.teams?.[defenseId]) throw new Error('team configuration join failed');
  const teams = {};
  for (const id of [offenseId, defenseId]) {
    const source = input.teams[id];
    const activeIds = input.active_rosters?.[id] ? new Set(input.active_rosters[id]) : null;
    const inactiveIds = new Set(input.personnel_availability?.[id]?.inactive_ids || []);
    const roster = source.roster.filter((p) => (!activeIds || activeIds.has(p.id)) && !inactiveIds.has(p.id) &&
      p.status === 'ACT' && p.availability === 'available');
    if (activeIds && roster.length !== activeIds.size) throw new Error(`active roster join failed for ${id}`);
    teams[id] = { ...source, roster };
  }
  const controls = input.demo_controls || {};
  const scenario = createDemoScenario({
    offenseId, defenseId, teams, playbooks: input.playbooks, kind: controls.kind,
    formation: controls.formation, candidateId: controls.candidate_id || null,
    seed: input.random_seed, personnelOverrides: controls.personnel_overrides || {},
    los: state.yard_line ?? 45, dir: state.field_direction ?? 1,
  });
  scenario.selection.game_state = {
    game_id: state.game_id ?? null, down: state.down ?? null,
    distance_yards: state.distance_yards ?? null, yard_line: state.yard_line ?? null,
    score: state.score ?? null, clock_seconds: state.clock_seconds ?? null,
    timeouts: state.timeouts ?? null, field_direction: state.field_direction ?? 1,
  };
  return scenario;
}

export function validateDemoSnapshot(snapshot) {
  const ids = new Set();
  for (const [teamId, team] of Object.entries(snapshot.teams || {})) {
    for (const p of team.roster || []) {
      if (!p.id || p.team_id !== teamId) throw new Error(`roster membership join failed for ${teamId}/${p.id}`);
      if (ids.has(p.id)) throw new Error(`duplicate cross-team player id ${p.id}`);
      ids.add(p.id);
      if (Object.keys(p.ratings || {}).length !== 35) throw new Error(`missing 35-attribute ratings for ${p.id}`);
      if (!p.physics?.mass || !p.physics?.vmax || !p.physics?.f0) throw new Error(`missing physics body inputs for ${p.id}`);
    }
  }
  return true;
}
