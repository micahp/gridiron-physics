// Experimental, seed-reproducible 2026 matchup play sequence.
// Historical 2025 offense/defense outcomes are training examples, never actual 2026 results.
// This intentionally DOES NOT claim a legal NFL full-game engine or calibrated prediction.

export function seeded(seed) {
  let h = 2166136261 >>> 0;
  for (const c of String(seed)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return () => { h = (h + 0x6d2b79f5) >>> 0; let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const num = (n, fallback = null) => n === null || n === undefined || n === '' || !Number.isFinite(Number(n)) ? fallback : Number(n);
const other = (a, b, id) => id === a ? b : a;
const nDown = (o) => num(o?.attributes?.down);
const nDist = (o) => num(o?.attributes?.ydstogo);
const nYl = (o) => num(o?.attributes?.yardline_100);

function sampleHist(hist, rand) {
  const entries = Object.entries(hist).map(([k, v]) => [Number(k), v]);
  const total = entries.reduce((n, [, v]) => n + v, 0);
  let pick = rand() * total;
  for (const [k, v] of entries) if ((pick -= v) < 0) return k;
  return entries[entries.length - 1][0];
}

function pickCount(counts, rand) {
  const entries = Object.entries(counts);
  const total = entries.reduce((n, [, v]) => n + v, 0);
  let pick = rand() * total;
  for (const [k, v] of entries) if ((pick -= v) < 0) return k;
  return entries[entries.length - 1][0];
}

// Kickoff placement under the 2026 rules (Rule 6-1-5, page 23).
//
// Landing zone runs from the receiving team's goal line to its own 20. A
// touchback is spotted by whether the kick touched the landing zone first:
//   - touched the landing zone, then rolled into the end zone -> receiving team's 20
//   - reached the end zone in the air without touching the zone       -> receiving team's 35
//   - kickoff from midfield (the 50), either touchback type          -> receiving team's 20
// Short of the landing zone or out of bounds -> the receiving team's 40 under the
// standard election (25 yards from a kickoff at the kicking team's 35).
//
// yardline_100 is 0 at the opponent's goal and 100 at the offense's own goal,
// so a receiving team's own N is yardline_100 100 - N.
export const KICKOFF_SPOTS = {
  landing_zone_touchback: 80, // receiving team's own 20
  in_air_touchback: 65,      // receiving team's own 35
  midfield_touchback: 80,    // receiving team's own 20 (2026 midfield exception)
  out_of_bounds: 60,         // receiving team's own 40
  short_of_landing_zone: 60, // receiving team's own 40
};

export function createKickoffSampler(kickoffTables) {
  const outcomes = kickoffTables?.outcomes;
  if (!outcomes) throw new Error('missing kickoff outcome table');
  const split = kickoffTables.touchback_spot || { landing_zone: 0, in_air: 0 };
  const tbTotal = Number(split.landing_zone || 0) + Number(split.in_air || 0);
  if (!tbTotal) throw new Error('missing kickoff touchback landing-zone split');
  // Fraction of touchbacks that touched the landing zone before the end zone.
  const zoneShare = Number(split.landing_zone) / tbTotal;
  const returns = kickoffTables.return_yards || {};

  return (kickSpotOwn, rand) => {
    const outcome = pickCount(outcomes, rand);
    const ret = outcome === 'returned' ? sampleHist(returns, rand) : 0;
    if (outcome === 'touchback') {
      // A kickoff from midfield takes the 2026 exception regardless of type.
      if (kickSpotOwn === 50) {
        return { outcome, return_yards: 0, spot: KICKOFF_SPOTS.midfield_touchback,
          touchback_type: 'midfield', note: '2026 Rule 6-1-5: touchback on a kickoff from the 50 is the receiving team\'s 20.' };
      }
      const zone = rand() < zoneShare;
      const spot = zone ? KICKOFF_SPOTS.landing_zone_touchback : KICKOFF_SPOTS.in_air_touchback;
      return { outcome, return_yards: 0, spot,
        touchback_type: zone ? 'landing_zone' : 'in_air',
        note: zone
          ? '2026 Rule 6-1-5: the kick touched the landing zone, so the touchback is the receiving team\'s 20.'
          : '2026 Rule 6-1-5: the kick reached the end zone in the air, so the touchback is the receiving team\'s 35.' };
    }
    if (outcome === 'out_of_bounds') {
      return { outcome, return_yards: 0, spot: KICKOFF_SPOTS.out_of_bounds,
        touchback_type: null,
        note: '2026 Rule 6-2-4: out of bounds, the receiving team takes the ball at its 40 under the standard election.' };
    }
    // A returned or dead kick: the receiving team starts where the ball came to
    // rest. The 2025 landing spot is not modelled, so the return is applied from
    // the receiving team's 25 and the result is clamped into the field.
    const spot = clamp(75 - ret, 1, 99);
    return { outcome, return_yards: ret, spot, touchback_type: null,
      note: 'Outcome and return from 2025 league kickoffs (nflverse). Kick flight is not simulated.' };
  };
}

export function createPuntSampler(puntTables) {  const zeroDistanceCount = Number(puntTables?.distance_yards?.['0'] ?? 0);
  const blockedCount = Number(puntTables?.outcomes?.blocked ?? 0);
  if (zeroDistanceCount !== blockedCount) {
    throw new Error(`punt table mismatch: zero-yard rows=${zeroDistanceCount}, blocked outcomes=${blockedCount}`);
  }
  const nonBlockedPuntDistances = Object.fromEntries(
    Object.entries(puntTables.distance_yards).filter(([yards, count]) => Number(yards) > 0 && count > 0),
  );
  if (!Object.keys(nonBlockedPuntDistances).length) throw new Error('missing positive-distance punts');

  // Keep the empirical outcome and positive-distance marginals; couple only
  // the observed blocked/zero-distance pair.
  return (kickYl, rand) => {
    const outcome = pickCount(puntTables.outcomes, rand);
    const distance = outcome === 'blocked' ? 0 : Math.round(sampleHist(nonBlockedPuntDistances, rand));
    if (outcome === 'blocked') {
      // Zero is the recorded kick-distance value, not a modeled recovery path.
      return { distance, outcome, return_yards:0, spot:clamp(100 - kickYl, 1, 99) };
    }
    const landing = kickYl - distance;
    const ret = outcome === 'returned' ? sampleHist(puntTables.return_yards, rand) : 0;
    const spot = outcome === 'touchback' ? 80 : clamp(100 - (landing + ret), 1, 99);
    return { distance, outcome, return_yards:ret, spot };
  };
}

// nflverse-derived estimate, not a verified physical holder location. The
// holder offset that nflverse kick_distance implies after the 10-yard end zone
// is 8 yards in 88% of 6,312 FGs (2020-2025).
export const FG_HOLDER_OFFSET_ESTIMATE = 8;
// 2026 Rule 11-4-2 Field Goal Attempt Note (5): at most 5 seconds of runoff for
// a successful field goal or an unsuccessful attempt that leaves the field of
// play. Miss location is not sampled, so miss runoff is an unverified estimate
// and is not claimed to follow the Note (5) cap.
export const FG_RUNOFF_CAP = 5;
export function missedFieldGoalRestart(yl) {
  const kickSpotOwn = yl + FG_HOLDER_OFFSET_ESTIMATE;
  const kickSpotInside20 = kickSpotOwn < 20;
  return { kickSpotOwn, kickSpotInside20, restartOwn: kickSpotInside20 ? 20 : kickSpotOwn };
}
export const BLOCKED_PUNT_OUTCOMES = ['receiving_recovery', 'kicking_recovery', 'out_of_bounds', 'safety'];
const BLOCKED_PUNT_NOTES = {
  receiving_recovery: 'Blocked punt recovered by the receiving team at the sampled punt spot (estimate).',
  kicking_recovery: 'Blocked punt recovered by the kicking team, which keeps the ball at the line of scrimmage.',
  out_of_bounds: 'Blocked punt went out of bounds; the receiving team takes over at the sampled punt spot (estimate).',
  safety: 'Blocked punt into the kicking team\'s end zone: a safety, then the kicking team free-kicks.',
};
// Whether a receiving-team blocked-punt recovery was returned for a touchdown,
// from the pooled 2022-2025 split. Fails closed when the split is missing.
export function sampleBlockedTouchdown(puntTable, rand) {
  const counts = puntTable?.blocked_receiving_touchdown_pooled;
  if (!counts) throw new Error('missing blocked-punt touchdown table');
  const total = (counts.touchdown || 0) + (counts.no_touchdown || 0);
  if (!(total > 0)) throw new Error('blocked-punt touchdown table has no observations');
  return rand() * total < (counts.touchdown || 0);
}
// Samples a blocked-punt outcome from the observed 2025 counts. Fails closed
// when the table is missing or has no observations rather than inventing one.
export function sampleBlockedPuntOutcome(puntTable, rand) {
  const counts = puntTable?.blocked_resolution_pooled;
  if (!counts) throw new Error('missing blocked-punt resolution table');
  const total = BLOCKED_PUNT_OUTCOMES.reduce((n, k) => n + (counts[k] || 0), 0);
  if (!(total > 0)) throw new Error('blocked-punt resolution table has no observations');
  let pick = rand() * total;
  let last = null;
  for (const k of BLOCKED_PUNT_OUTCOMES) {
    const c = counts[k] || 0;
    if (!c) continue;
    last = k;
    pick -= c;
    if (pick < 0) return k;
  }
  return last;
}
// Normal-mode coin toss ledger, from docs/rules/NFL-2026-GAME-STATE-RULES.md.
// The winner's receive/defer choice is an authored simulation assumption, not
// an observed or verified rate.
export const TOSS_RECEIVE_PROBABILITY = 0.5;
// Rule 4-2-2: the winner's first choice is receive, or defer to the second half.
// The other team takes the remaining privilege, which is the goal to defend.
// Normal mode always elects receive for the first-choice team.
function deriveNormalLedger(winner, loser, deferred) {
  const firstChooser = deferred ? loser : winner;
  const secondChooser = other(winner, loser, firstChooser);
  return {
    first_half: { first_choice_team: firstChooser, choice_type: 'receive', choice_value: 'receive',
      other_team_choice: 'goal_to_defend', kicking_team: other(winner, loser, firstChooser),
      receiving_team: firstChooser, defended_goal_by_team: other(winner, loser, firstChooser) },
    second_half: { first_choice_team: secondChooser, choice_type: 'receive', choice_value: 'receive',
      kicking_team: firstChooser, receiving_team: secondChooser, defended_goal_by_team: firstChooser },
  };
}
export function sampleCoinTossLedger(match, rand, { winner, choice } = {}) {
  const w = winner ?? (rand() < 0.5 ? match.home : match.away);
  const l = other(match.home, match.away, w);
  const c = choice ?? (rand() < TOSS_RECEIVE_PROBABILITY ? 'receive' : 'defer');
  if (c !== 'receive' && c !== 'defer') throw new Error(`normal-mode toss choice must be receive or defer, got ${c}`);
  return {
    rules_version: '2026', source: 'authored_simulation_choice',
    coin_toss: { winner: w, loser: l, winner_deferred: c === 'defer' },
    ...deriveNormalLedger(w, l, c === 'defer'),
  };
}
// Recomputes every ledger role from the coin toss alone and throws on any
// stored field that disagrees, so a hand-edited or inconsistent ledger fails closed.
export function validateCoinTossLedger(ledger) {
  const { winner, loser, winner_deferred: deferred } = ledger.coin_toss;
  if (!winner || !loser || winner === loser) throw new Error('coin toss must name distinct winner and loser');
  const expected = deriveNormalLedger(winner, loser, deferred);
  for (const half of ['first_half', 'second_half']) for (const [k, v] of Object.entries(expected[half]))
    if (ledger[half]?.[k] !== v) throw new Error(`${half}.${k} is ${ledger[half]?.[k]}, toss implies ${v}`);
  if (ledger.first_half.kicking_team === ledger.first_half.receiving_team) throw new Error('kicker and receiver are the same team');
  return true;
}
// Checks that Q1 and Q3 open with exactly one half-start kickoff each, with
// distinct kickers that match the ledger. Throws so invalid games fail closed.
export function validateHalfStartKickoffs(plays, ledger) {
  validateCoinTossLedger(ledger);
  const starts = plays.filter(p => p.type === 'kickoff' && p.reason === 'half_start');
  if (starts.length !== 2) throw new Error(`expected 2 half-start kickoffs, found ${starts.length}`);
  const [q1, q3] = starts;
  if (q1.quarter !== 1 || q3.quarter !== 3) throw new Error('half-start kickoffs must open Q1 and Q3');
  if (q1.kicking_team === q3.kicking_team) throw new Error('same team kicks both half-start kickoffs');
  if (q1.kicking_team !== ledger.first_half.kicking_team) throw new Error('Q1 kicker does not match the toss ledger');
  if (q3.kicking_team !== ledger.second_half.kicking_team) throw new Error('Q3 kicker does not match the toss ledger');
  if (q3.kicking_team !== ledger.first_half.receiving_team) throw new Error('Q3 kicker must be the Q1 receiver');
  return true;
}

export const MATCHUPS = [
  { id:'2026_07_CIN_BAL',away:'CIN',home:'BAL',ref:'2022_05_CIN_BAL',day:'Oct 25' },
  { id:'2026_07_MIA_NYJ',away:'MIA',home:'NYJ',ref:'2022_05_MIA_NYJ',day:'Oct 25' },
  { id:'2026_07_SF_ATL',away:'SF',home:'ATL',ref:'2022_06_SF_ATL',day:'Oct 25' },
  { id:'2026_07_TB_CAR',away:'TB',home:'CAR',ref:'2022_07_TB_CAR',day:'Oct 25' },
  { id:'2026_07_GB_DET',away:'GB',home:'DET',ref:'2022_09_GB_DET',day:'Oct 25' },
  { id:'2026_07_DAL_PHI',away:'DAL',home:'PHI',ref:'2022_06_DAL_PHI',day:'Oct 26' },
];

function sourceCandidates(book, type, state) {
  const arr = book?.offense?.observed_plays || [];
  const filtered = arr.filter(p => p?.attributes?.play_type === type && num(p?.outcome_label?.yards_gained) !== null);
  if (!filtered.length) throw new Error(book?.team_id + ' has no usable 2025 ' + type + ' outcomes');
  const sameDown = filtered.filter(p => nDown(p) === state.down);
  const similarDistance = sameDown.filter(p => Math.abs((nDist(p) ?? 10) - state.togo) <= 3);
  const similarField = similarDistance.filter(p => Math.abs((nYl(p) ?? 50) - state.yl) <= 25);
  return similarField.length >= 12 ? similarField : similarDistance.length >= 12 ? similarDistance : sameDown.length >= 12 ? sameDown : filtered;
}

function chooseKind(book, state, rand) {
  const c = book.offense?.profile?.run_pass?.categories || {};
  const r = num(c.run?.rate), p = num(c.pass?.rate);
  const runShare = r !== null && p !== null && (r + p) > 0 ? r / (r + p) : 0.42;
  let pass = 1 - runShare;
  pass += state.down === 3 ? (state.togo >= 7 ? 0.19 : 0.04) : 0;
  pass += state.togo >= 11 ? 0.15 : 0;
  pass += state.clock <= 120 && (state.quarter === 2 || state.quarter === 4) ? 0.10 : 0;
  return rand() < clamp(pass, 0.15, 0.91) ? 'pass' : 'run';
}

function samplePlay(book, defBook, state, type, rand) {
  const pool = sourceCandidates(book, type, state);
  const source = pool[Math.floor(rand() * pool.length)];
  // Simple defense-conditioned blend of observed 2025 outcomes, not a learned matchup model.
  const defensePool = (defBook?.defense?.observed_plays || []).filter(p =>
    p?.attributes?.play_type === type && num(p?.outcome_label?.yards_gained) !== null &&
    (nDown(p) === state.down || state.down === 4));
  const defense = defensePool.length ? defensePool[Math.floor(rand() * defensePool.length)] : null;
  const offGain = num(source.outcome_label.yards_gained, 0);
  const defGain = num(defense?.outcome_label?.yards_gained, offGain);
  const gain = clamp(Math.round(0.75 * offGain + 0.25 * defGain), -18, 75);
  const sourceComplete = num(source.outcome_label.complete_pass) === 1;
  const defComplete = num(defense?.outcome_label?.complete_pass);
  const interception = type === 'pass' && (num(source.outcome_label.interception) === 1 ||
    (num(defense?.outcome_label?.interception) === 1 && rand() < 0.25));
  const complete = type === 'pass' && !interception && (defComplete === null ? sourceComplete :
    rand() < 0.75 ? sourceComplete : defComplete === 1);
  return { gain:type === 'pass' && !complete ? 0 : gain, complete, interception,
    source_id: source.source_id || null, defense_source_id:defense?.source_id || null };
}

function playbookCandidate(book, kind, rand) {
  const a = book?.offense?.play_candidates?.[kind]?.candidates || [];
  if (!a.length) throw new Error(book.team_id + ' has no ' + kind + ' formations');
  const total = a.reduce((n, c) => n + c.count, 0);
  let pick = rand() * total;
  return a.find(c => (pick -= c.count) < 0) || a[a.length - 1];
}

export function generateGame(match, books, seed = '1042', league = null, { coinToss } = {}) {
  if (!match || !books?.[match.home] || !books?.[match.away]) throw new Error('missing pregame matchup or playbook');
  if (!league?.kickoffs || !league?.punts || !league?.field_goals || !league?.extra_points) throw new Error('missing 2025 special-teams tables');
  const rand = seeded(match.id + '|' + seed);
  const puntSampler = createPuntSampler(league.punts);
  const kickoffSampler = createKickoffSampler(league.kickoffs);
  const scores = { [match.home]:0, [match.away]:0 };
  const ledger = sampleCoinTossLedger(match, rand, coinToss);
  let offense = ledger.first_half.kicking_team, quarter = 1, clock = 900, down = 1, togo = 10, yl = 75, drive = 1;
  const plays = [], drives = [];
  let driveStart = 0, snaps = 0;
  const xpRate = league.extra_points.good / Object.values(league.extra_points).reduce((n, v) => n + v, 0);

  function event(data) {
    const item = { id:match.id + ':' + seed + ':' + (plays.length + 1), index:plays.length + 1,
      quarter, clock, drive, offense, defense:other(match.home,match.away,offense),
      down, togo, yl, score:{...scores}, ...data };
    plays.push(item); return item;
  }
  function finishDrive(reason) {
    if (driveStart < plays.length) drives.push({
      index:drive, offense, start:driveStart, end:plays.length - 1, reason });
    drive++;
    driveStart = plays.length;
  }
  // A new series for `offense` at `nextYl`. Yards to go is the smaller of 10
  // and the distance to the goal line, so a first down inside the 10 sets
  // goal-to-go rather than a full 10 yards.
  function newSeries(nextYl) {
    down = 1;
    yl = clamp(nextYl, 1, 99);
    togo = Math.min(10, yl);
  }
  function turnover(reason, nextYl = 75) {
    finishDrive(reason);
    offense = other(match.home, match.away, offense);
    newSeries(nextYl);
  }
  function score(points, label) {
    scores[offense] += points;
    event({type:'administrative',action:label,points,scoreAfter:{...scores},
      note:'Illustrative scoring/restart. No special-teams physics claimed.'});
    turnover(label, 75);
  }
  // Schedule the kickoff that follows a score. If the period has expired, the
  // kickoff belongs to the next period and is deferred until the quarter loop
  // advances, rather than being recorded at 00:00 of the period that ended.
  function scheduleKickoff(kicking, reason) {
    if (clock <= 0) { pendingKickoff = { kicking, reason }; return null; }
    return kickoff(kicking, reason, { reason });
  }
  // Kickoff is a special-teams event between drives: the kicking team and the
  // receiving team are recorded separately, and the event is not attributed to
  // the receiving team's offensive drive. `endReason` closes the drive that
  // preceded the kick (a score, a punt, or the end of a half).
  //
  // A kickoff scheduled after a quarter expires is deferred: the quarter and
  // clock are advanced to the next period before the kickoff is recorded, so
  // the kickoff never appears at 00:00 in the period that just ended.
  let pendingKickoff = null;
  function kickoff(kicking, endReason, options = {}) {
    if (endReason) finishDrive(endReason);
    const receiving = other(match.home, match.away, kicking);
    // The kickoff is normally taken from the kicking team's 35.
    const kickSpotOwn = options.fromMidfield ? 50 : 35;
    const sampled = kickoffSampler(kickSpotOwn, rand);
    // The receiving team takes over before the event is recorded, so the
    // kickoff is never attributed to the kicking team's offensive drive and
    // it opens the receiving team's drive.
    offense = receiving;
    newSeries(sampled.spot);
    return event({
      type:'kickoff', kind:'kickoff', action:'KICKOFF', outcome:sampled.outcome,
      return_yards:sampled.return_yards, points:0,
      // Special-teams ownership: who kicked and who receives. `offense` on the
      // event is the receiving team, because they have the ball next.
      kicking_team:kicking, receiving_team:receiving,
      touchback_type:sampled.touchback_type,
      receiving_spot:sampled.spot,
      possession_after:receiving,
      reason:options.reason || null,
      note:sampled.note });
  }
  // Estimate the punt spot from kickYl and the sampled distance/return. The
  // generator does not model the full kick trajectory or the outcome-distance
  // relationship beyond the blocked/zero-distance pairing.
  function fieldGoalBlockedShare() {
    const s = league.field_goals.non_make_split;
    return s.blocked / (s.blocked + s.missed);
  }
  function fieldGoalMake(distance) {
    const b = league.field_goals.buckets[distance < 30 ? 0 : distance < 40 ? 1 : distance < 50 ? 2 : distance < 60 ? 3 : 4];
    return b.attempts ? b.made / b.attempts : 0;
  }
  // A rule the inputs cannot resolve stops the game with an explicit refusal
  // event rather than a sampled or assumed outcome.
  let refusal = null;
  function refuse(rule, detail) {
    refusal = { rule, detail };
    event({type:'unsupported_rule', kind:'unsupported_rule', action:'REFUSED', points:0, runoff:0,
      rule, detail, note:detail});
  }
  kickoff(offense, null, { reason: 'half_start' });
  for (quarter = 1; quarter <= 4; quarter++) {
    clock = 900;
    if (quarter === 3) {
      // Halftime ends the half and resolves a new kickoff. The kickoff belongs
      // to the second half, so it is recorded after the clock is reset and is
      // not attributed to the closing drive of the first half.
      if (driveStart < plays.length) finishDrive('halftime');
      kickoff(ledger.second_half.kicking_team, null, { reason: 'half_start' });
    } else if (pendingKickoff) {
      // A post-score kickoff deferred out of the previous period belongs to
      // this period. It is recorded at the start of the period, never at 00:00
      // of the period that ended.
      const { kicking, reason } = pendingKickoff;
      pendingKickoff = null;
      kickoff(kicking, reason, { reason });
    }
    let qSnaps = 0;
    while (clock > 0 && snaps < 220 && qSnaps < 80 && !refusal) {
      const def = other(match.home, match.away, offense);
      const trailing = scores[offense] < scores[def];
      const lateGo = quarter === 4 && trailing && clock < 210 && togo <= 7;
      if (down === 4 && !lateGo) {
        if (yl <= 40) {
          const distance = yl + 10 + FG_HOLDER_OFFSET_ESTIMATE;
          const good = rand() < fieldGoalMake(distance);
          const blocked = !good && rand() < fieldGoalBlockedShare();
          // Misses are capped at 5 s too: the miss type (in or out of the field of play) is not modeled.
          const runoff = good
            ? Math.min(clock, FG_RUNOFF_CAP)
            : Math.min(clock, 4 + Math.floor(rand() * 2));
          event({type:'field_goal',kind:'field_goal',action:good?'FIELD GOAL GOOD':blocked?'FIELD GOAL BLOCKED':'FIELD GOAL MISSED',
            good,blocked,distance,points:good?3:0,runoff,
            runoff_basis: good ? 'rule_11_4_2_note_5_cap' : 'unverified_miss_estimate',
            note:'Make rate from 2025 league field goals by distance (nflverse). Kick flight is not simulated.'});
          clock -= runoff;
          if (blocked) {
            refuse('blocked_field_goal',
              'Blocked field goal is a live ball. Its restart (Rule 11-4-2) and possession depend on whether the ball was touched beyond the line and where it was recovered, which the inputs do not record.');
          } else if (good) {
            scores[offense] += 3;
            scheduleKickoff(offense, 'field_goal_good');
          } else {
            // Kick spot is estimated as the LOS plus the holder offset, measured
            // from the receivers' goal. Touch-beyond-LOS and kick-behind-LOS
            // exceptions are not modeled.
            const { kickSpotOwn, kickSpotInside20, restartOwn } = missedFieldGoalRestart(yl);
            finishDrive('field_goal_miss');
            offense = other(match.home, match.away, offense);
            newSeries(100 - restartOwn);
            const missed = plays[plays.length - 1];
            missed.restart_spot = 100 - restartOwn;
            missed.kick_spot_own_estimate = kickSpotOwn;
            missed.restart_rule = kickSpotInside20
              ? '2026 Rule 11-4-2(a): untouched miss with the estimated kick spot inside the receivers\' 20; the receiving team takes the ball at its 20.'
              : '2026 Rule 11-4-2(b): untouched miss with the estimated kick spot at or beyond the receivers\' 20; the receiving team takes the ball at the kick spot (estimate: 8 yards behind the LOS).';
            missed.kick_spot_inside_20 = kickSpotInside20;
          }
        } else {
          const pt = puntSampler(yl, rand);
          const runoff = clamp(Math.round(6 + rand() * 5), 1, clock);
          if (pt.outcome === 'blocked') {
            const resolution = sampleBlockedPuntOutcome(league.punts, rand);
            const receiving = other(match.home, match.away, offense);
            const recovering = resolution === 'kicking_recovery' ? offense : receiving;
            const punt = event({type:'punt',kind:'punt',action:'PUNT',points:0,runoff,distance:pt.distance,
              outcome:'blocked',return_yards:0,
              recovery_team:recovering,
              possession_after:recovering,
              possession_resolution:resolution,
              note:BLOCKED_PUNT_NOTES[resolution]});
            clock -= runoff;
            if (resolution === 'kicking_recovery') {
              refuse('blocked_punt_kicking_recovery',
                'Kicking-team recovery at the line of scrimmage: Rule 2-3-1 (series continues) versus 2-3-2 (first and 10) depends on whether the recovery is behind or beyond the line, which the inputs do not record.');
            } else if (resolution === 'safety') {
              scores[receiving] += 2;
              punt.scoreAfter = {...scores};
              event({type:'safety_kick',kind:'free_kick',action:'SAFETY KICK',points:0,
                offense:receiving, defense:offense, kicking_team:offense, receiving_team:receiving,
                kick_spot_own:20, receiving_spot:null, outcome:null, possession_after:receiving,
                note:'Safety kick from the kicking team\'s own 20. The 2025 data has no safety-kick outcome table, so the receiving spot is not sampled.'});
              refuse('safety_kick',
                'Safety kick receiving spot has no observed outcome table. The 2025 data has no safety-kick counts, so none are sampled.');
            }
            else if (resolution === 'receiving_recovery' && sampleBlockedTouchdown(league.punts, rand)) {
              scores[receiving] += 6;
              punt.touchdown_return = true;
              punt.note = 'Blocked punt recovered by the receiving team and returned for a touchdown (pooled 2022-2025 split).';
              punt.scoreAfter = {...scores};
              if (rand() < xpRate) { scores[receiving] += 1; punt.try = 'XP good (2025 league rate)'; }
              else punt.try = 'XP missed (2025 league rate)';
              punt.scoreAfter = {...scores};
              scheduleKickoff(receiving, 'touchdown');
            }
            else turnover('blocked_punt', pt.spot);
          } else {
            event({type:'punt',kind:'punt',action:'PUNT',points:0,runoff,distance:pt.distance,
              outcome:pt.outcome,return_yards:pt.return_yards,
              note:'Distance, outcome and return from 2025 league punts (nflverse). Kick flight is not simulated.'});
            clock -= runoff;
            turnover('punt',pt.spot);
          }
        }
        continue;
      }
      const book = books[offense];
      const kind = chooseKind(book,{quarter,clock,down,togo,yl},rand);
      const result = samplePlay(book,books[def],{quarter,clock,down,togo,yl},kind,rand);
      const candidate = playbookCandidate(book,kind,rand);
      const finalGain = clamp(result.gain, -Math.min(yl-1,18), yl);
      const touchdown = result.gain >= yl && !result.interception;
      const runoff = Math.min(clock,
        kind === 'pass' && !result.complete ? 4+Math.floor(rand()*5) : 20+Math.floor(rand()*24));
      const item = event({type:'scrimmage',kind,action:kind === 'run'?'RUN':result.interception?'INTERCEPTION':
        result.complete?'PASS COMPLETE':'PASS INCOMPLETE',
        gain:touchdown?yl:finalGain, completed:result.complete,interception:result.interception,touchdown,
        runoff, playbook_candidate_id:candidate.candidate_id,formation:candidate.attributes.formation,
        candidate,source_id:result.source_id,defense_source_id:result.defense_source_id,
        note:'Sampled from 2025 historical play outcomes; reconstructed 2026 assignment and 3D animation.'});
      clock -= runoff; snaps++; qSnaps++;
      if (touchdown) {
        scores[offense] += 6;
        item.scoreAfter = {...scores};
        // Extra point at the 2025 league make rate. Kick flight is not simulated.
        if (rand() < xpRate) { scores[offense] += 1; item.try='XP good (2025 league rate)'; }
        else item.try='XP missed (2025 league rate)';
        item.scoreAfter = {...scores};
        scheduleKickoff(offense,'touchdown');
      } else if (result.interception) {
        turnover('interception',clamp(100-yl,2,99));
      } else {
        yl = clamp(yl - finalGain,1,99);
        if (finalGain >= togo) { down = 1; togo = Math.min(10,yl); }
        else { down++; togo = Math.max(1,togo-finalGain); }
        if (down > 4) turnover('turnover_on_downs',clamp(100-yl,2,99));
      }
    }
    if (refusal || qSnaps >= 80 || snaps >= 220) break;
    if (quarter === 2 && driveStart < plays.length) finishDrive('halftime');
    else if (quarter === 4 && driveStart < plays.length) finishDrive('end_regulation');
    // A post-score kickoff deferred out of Q2 is superseded by the second
    // half's own half-opening kickoff.
    if (quarter === 2 && pendingKickoff) pendingKickoff = null;
  }
  const completeRegulation = !refusal && quarter > 4 && clock <= 0;
  if (driveStart < plays.length && !drives.some(d=>d.end===plays.length-1))
    finishDrive(refusal ? 'unsupported_rule' : completeRegulation ? 'end_regulation' : 'simulation_limit');
  const q3HalfStartRecorded = plays.some(p=>p.type==='kickoff'&&p.reason==='half_start'&&p.quarter===3);
  if (!refusal && (completeRegulation || q3HalfStartRecorded)) validateHalfStartKickoffs(plays, ledger);
  const tiedAtRegulationEnd = scores[match.home] === scores[match.away];
  const status = refusal ? 'UNSUPPORTED_RULE_REFUSAL'
    : !completeRegulation ? 'SIMULATION_LIMIT_REACHED_UNVALIDATED'
      : tiedAtRegulationEnd ? 'REGULATION_COMPLETE_OVERTIME_UNMODELED'
        : 'REGULATION_COMPLETE_UNVALIDATED';
  return {
    schema_version:'gridiron.week7-experimental.v1', game_id:match.id, seed:String(seed), match, coin_toss_ledger:ledger,
    provenance:{play_selection:'team 2025 observed rates + situational heuristic',
      outcome:'historical 2025 offense/defense resampling',rosters:'week-7 projected',
      physical_motion:'Gridiron outcome-constrained 3D',model_validated:false},
    status, refusal, complete_regulation:completeRegulation,
    score:{...scores}, plays, drives, source_play_count:snaps,
    warnings:['Not a validated NFL full-game simulator or betting forecast.',
      'Timeouts, penalties, play clock, onside kicks and overtime are unsupported.',
      'Kickoffs, punts and field goals use 2025 league rates, not kicker or team rates. Kick flight and returns are not simulated.',
      '2022 player tracking informs ongoing movement research; the trained team movement prior is not connected.'],
  };
}
