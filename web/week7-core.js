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

export function createPuntSampler(puntTables, eventTable, sourceSha256) {
  const zeroDistanceCount = Number(puntTables?.distance_yards?.['0'] ?? 0);
  const blockedCount = Number(puntTables?.outcomes?.blocked ?? 0);
  if (zeroDistanceCount !== blockedCount) {
    throw new Error(`punt table mismatch: zero-yard rows=${zeroDistanceCount}, blocked outcomes=${blockedCount}`);
  }
  const events = eventTable?.events;
  if (eventTable?.schema_version !== 'gridiron.punt-event-samples.v1' || !Array.isArray(events) || !events.length) {
    throw new Error('missing versioned joint punt-event samples');
  }
  if (eventTable?.source?.sha256 !== sourceSha256) {
    throw new Error('punt event and league tables have different source hashes');
  }
  const policy = eventTable.field_position_binning;
  if (!Array.isArray(policy?.levels) || !policy.levels.length || policy.levels.some(level =>
      !Number.isInteger(level.width_yards) || level.width_yards < 1 ||
      !Number.isInteger(level.minimum_events) || level.minimum_events < 1) ||
      policy.levels.some((level,index) => index>0 && level.width_yards<=policy.levels[index-1].width_yards)) {
    throw new Error('invalid punt field-position bin policy');
  }
  const validOutcomes = new Set(['touchback', 'fair_catch', 'downed', 'out_of_bounds', 'blocked', 'returned']);
  for (const e of events) {
    const spotStatusValid = e.touchdown
      ? e.final_spot_yardline_100 === null && e.final_spot_status === 'not_applicable_touchdown' &&
        ['receiving_team','kicking_team'].includes(e.scoring_team) && e.possession_after === 'scoring_team'
      : Number.isFinite(e.final_spot_yardline_100) && e.final_spot_yardline_100 >= 1 &&
        e.final_spot_yardline_100 <= 99 && e.final_spot_status === 'observed_next_series_first_down_snap_proxy' &&
        e.scoring_team === null && ['receiving_team','kicking_team'].includes(e.possession_after);
    if (typeof e.touchdown !== 'boolean' ||
        !Number.isFinite(e.field_position_yardline_100) || e.field_position_yardline_100 < 1 || e.field_position_yardline_100 > 99 ||
        !Number.isFinite(e.gross_distance_yards) || e.gross_distance_yards < 0 ||
        !Number.isFinite(e.return_yards) || typeof e.touchdown !== 'boolean' || !spotStatusValid ||
        !validOutcomes.has(e.outcome) ||
        e.landing_status !== 'estimated_unresolved' || e.recovery_status !== 'estimated_unresolved') {
      throw new Error(`invalid joint punt event: ${e.source_game_id ?? '?'}:${e.source_play_id ?? '?'}`);
    }
    if ((e.outcome === 'blocked') !== (e.gross_distance_yards === 0)) {
      throw new Error(`punt event blocked/distance mismatch: ${e.source_game_id}:${e.source_play_id}`);
    }
  }
  const outcomeTotals = Object.fromEntries(Object.keys(puntTables.outcomes).map(key => [key,0]));
  const distanceTotals = {};
  for (const e of events) {
    outcomeTotals[e.outcome] = (outcomeTotals[e.outcome] ?? 0) + 1;
    distanceTotals[e.gross_distance_yards] = (distanceTotals[e.gross_distance_yards] ?? 0) + 1;
  }
  if (events.length !== Number(eventTable.n) ||
      Object.entries(puntTables.outcomes).some(([key,count]) => outcomeTotals[key] !== Number(count)) ||
      Object.entries(puntTables.distance_yards).some(([key,count]) => distanceTotals[key] !== Number(count)) ||
      Object.entries(distanceTotals).some(([key,count]) => Number(puntTables.distance_yards[key] ?? 0) !== count)) {
    throw new Error('joint punt events do not reconcile to the pinned outcome and distance tables');
  }
  const rowsForBin = (yardline, width) => {
    const lower = Math.floor((yardline - 1) / width) * width + 1;
    const upper = Math.min(100, lower + width - 1);
    // A recorded touchback must have enough recorded kick distance to reach
    // the goal line from this snap. This is a consistency constraint only;
    // distance is never used to assign the landing point or final spot.
    return { rows:events.filter(e => e.field_position_yardline_100 >= lower &&
      e.field_position_yardline_100 <= upper &&
      (e.outcome !== 'touchback' || e.gross_distance_yards >= yardline)), lower, upper };
  };

  // Select a complete historical punt tuple conditional on the snap field
  // position. Gross distance is metadata; final spot comes from the sampled
  // event record and is never calculated from distance or return yards.
  return (kickYl, rand) => {
    if (!Number.isFinite(kickYl) || kickYl < 1 || kickYl > 99) throw new Error('invalid punt field position');
    let selected = null;
    let binWidth = null;
    for (const level of policy.levels) {
      const candidate = rowsForBin(kickYl, level.width_yards);
      if (candidate.rows.length >= level.minimum_events) {
        selected = candidate;
        binWidth = level.width_yards;
        break;
      }
    }
    if (!selected) {
      selected = rowsForBin(kickYl,100);
      if (!selected.rows.length) throw new Error(`no compatible punt event at field position ${kickYl}`);
    }
    const record = selected.rows[Math.min(selected.rows.length - 1, Math.floor(rand() * selected.rows.length))];
    return {
      distance:record.gross_distance_yards,
      outcome:record.outcome,
      return_yards:record.return_yards,
      spot:record.final_spot_yardline_100,
      possession_after:record.possession_after,
      touchdown:record.touchdown,
      scoring_team:record.scoring_team,
      landing_yardline_100:null,
      landing_status:record.landing_status,
      recovery_yardline_100:null,
      recovery_status:record.recovery_status,
      final_spot_status:record.final_spot_status,
      sample:{kick_field_position_yardline_100:kickYl,
        source_field_position_yardline_100:record.field_position_yardline_100,
        source_game_id:record.source_game_id,source_play_id:record.source_play_id,
        field_position_yardline_100:record.field_position_yardline_100,
        bin_width_yards:binWidth,bin_lower_yardline_100:selected.lower,
        bin_upper_yardline_100:selected.upper,bin_sample_count:selected.rows.length},
    };
  };
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

export function generateGame(match, books, seed = '1042', league = null) {
  if (!match || !books?.[match.home] || !books?.[match.away]) throw new Error('missing pregame matchup or playbook');
  if (!league?.kickoffs || !league?.punts || !league?.punt_event_samples || !league?.field_goals || !league?.extra_points) throw new Error('missing 2025 special-teams and joint punt-event tables');
  const rand = seeded(match.id + '|' + seed);
  const puntSampler = createPuntSampler(league.punts, league.punt_event_samples, league.source?.sha256);
  const scores = { [match.home]:0, [match.away]:0 };
  const firstReceiver = rand() < 0.5 ? match.home : match.away;
  let offense = other(match.home, match.away, firstReceiver), quarter = 1, clock = 900, down = 1, togo = 10, yl = 75, drive = 1;
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
  function turnover(reason, nextYl = 75) {
    finishDrive(reason);
    offense = other(match.home, match.away, offense);
    down = 1; togo = 10; yl = clamp(nextYl, 2, 99);
  }
  function score(points, label) {
    scores[offense] += points;
    event({type:'administrative',action:label,points,scoreAfter:{...scores},
      note:'Illustrative scoring/restart. No special-teams physics claimed.'});
    turnover(label, 75);
  }
  // Kickoff by the kicking team. The receiving spot is yards to the goal the receiver attacks:
  // touchback = own 25, out of bounds = own 35, otherwise own 25 plus the return.
  function kickoff(kicking, endReason) {
    if (endReason) finishDrive(endReason);
    const outcome = pickCount(league.kickoffs.outcomes, rand);
    const ret = outcome === 'returned' ? sampleHist(league.kickoffs.return_yards, rand) : 0;
    const spot = outcome === 'out_of_bounds' ? 65 : clamp(75 - ret, 1, 99);
    offense = kicking;
    event({type:'kickoff',kind:'kickoff',action:'KICKOFF',outcome,return_yards:ret,points:0,
      note:'Outcome and return from 2025 league kickoffs (nflverse). Kick flight is not simulated.'});
    offense = other(match.home, match.away, kicking);
    down = 1; togo = 10; yl = spot;
  }
  function fieldGoalMake(distance) {
    const b = league.field_goals.buckets[distance < 30 ? 0 : distance < 40 ? 1 : distance < 50 ? 2 : distance < 60 ? 3 : 4];
    return b.attempts ? b.made / b.attempts : 0;
  }
  kickoff(offense, null);
  for (quarter = 1; quarter <= 4; quarter++) {
    clock = 900;
    if (quarter === 3) {
      if (driveStart < plays.length) finishDrive('halftime');
      kickoff(firstReceiver, null);
    }
    let qSnaps = 0;
    while (clock > 0 && snaps < 220 && qSnaps < 80) {
      const def = other(match.home, match.away, offense);
      const trailing = scores[offense] < scores[def];
      const lateGo = quarter === 4 && trailing && clock < 210 && togo <= 7;
      if (down === 4 && !lateGo) {
        const kickClock = clamp(Math.round(6 + rand() * 5), 1, clock);
        if (yl <= 40) {
          const distance = yl + 17;
          const good = rand() < fieldGoalMake(distance);
          event({type:'field_goal',kind:'field_goal',action:good?'FIELD GOAL GOOD':'FIELD GOAL MISSED',
            good,distance,points:good?3:0,runoff:kickClock,
            note:'Make rate from 2025 league field goals by distance (nflverse). Kick flight is not simulated.'});
          clock -= kickClock;
          if (good) { scores[offense] += 3; kickoff(offense, 'field_goal_good'); }
          else turnover('field_goal_miss',clamp(100-yl,20,95));
        } else {
          const pt = puntSampler(yl, rand);
          const scoringTeam = pt.touchdown
            ? (pt.scoring_team === 'receiving_team' ? other(match.home, match.away, offense) : offense)
            : null;
          const puntPlay = event({type:'punt',kind:'punt',action:pt.touchdown?'PUNT RETURN TOUCHDOWN':'PUNT',
            points:pt.touchdown?6:0,touchdown:pt.touchdown,runoff:kickClock,distance:pt.distance,
            outcome:pt.outcome,return_yards:pt.return_yards,
            punt_event:{...pt.sample,touchdown:pt.touchdown,
              scoring_team_side:pt.scoring_team,scoring_team:scoringTeam,
              final_spot_yardline_100:pt.spot,
              final_spot_status:pt.final_spot_status,possession_after:pt.possession_after,
              landing_yardline_100:pt.landing_yardline_100,landing_status:pt.landing_status,
              recovery_yardline_100:pt.recovery_yardline_100,recovery_status:pt.recovery_status},
            note:pt.touchdown
              ? `Joint 2025 punt-return touchdown sampled conditional on field position (bin ${pt.sample.bin_lower_yardline_100}-${pt.sample.bin_upper_yardline_100}, n=${pt.sample.bin_sample_count}); scoring side ${pt.scoring_team}. Restart spot is not applicable after a touchdown. Landing and recovery coordinates are estimated_unresolved; gross distance is not used as a landing point.`
              : `Joint 2025 punt event sampled conditional on field position (bin ${pt.sample.bin_lower_yardline_100}-${pt.sample.bin_upper_yardline_100}, n=${pt.sample.bin_sample_count}). Restart spot uses the observed next-series opening spot and may include intervening enforcement. Landing and recovery coordinates are estimated_unresolved; gross distance is not used as a landing point.`});
          clock -= kickClock;
          if (pt.touchdown) {
            finishDrive('punt_return_touchdown');
            scores[scoringTeam] += 6;
            if (rand() < xpRate) { scores[scoringTeam] += 1; puntPlay.try='XP good (2025 league rate)'; }
            else puntPlay.try='XP missed (2025 league rate)';
            puntPlay.scoreAfter = {...scores};
            offense = scoringTeam;
            kickoff(scoringTeam,null);
          } else {
            finishDrive('punt');
            if (pt.possession_after === 'receiving_team') offense = other(match.home, match.away, offense);
            down = 1; togo = Math.min(10, pt.spot); yl = pt.spot;
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
        kickoff(offense,'touchdown');
      } else if (result.interception) {
        turnover('interception',clamp(100-yl,2,99));
      } else {
        yl = clamp(yl - finalGain,1,99);
        if (finalGain >= togo) { down = 1; togo = Math.min(10,yl); }
        else { down++; togo = Math.max(1,togo-finalGain); }
        if (down > 4) turnover('turnover_on_downs',clamp(100-yl,2,99));
      }
    }
    if (qSnaps >= 80 || snaps >= 220) break;
    if (quarter === 2 && driveStart < plays.length) finishDrive('halftime');
    else if (quarter === 4 && driveStart < plays.length) finishDrive('end_regulation');
  }
  if (driveStart < plays.length && !drives.some(d=>d.end===plays.length-1))
    finishDrive('end_regulation');
  return {
    schema_version:'gridiron.week7-experimental.v1', game_id:match.id, seed:String(seed), match,
    provenance:{play_selection:'team 2025 observed rates + situational heuristic',
      outcome:'historical 2025 offense/defense resampling',rosters:'week-7 projected',
      physical_motion:'Gridiron outcome-constrained 3D',model_validated:false},
    status:'ILLUSTRATIVE_REGULATION_REPLAY_NOT_LEGAL_GAME',complete_regulation:false,
    score:{...scores}, plays, drives, source_play_count:snaps,
    warnings:['Not a validated NFL full-game simulator or betting forecast.',
      'Timeouts, penalties, play clock, onside kicks and overtime are unsupported.',
      'Kickoffs, punts and field goals use 2025 league rates, not kicker or team rates. Kick flight and returns are not simulated.',
      '2022 player tracking informs ongoing movement research; the trained team movement prior is not connected.'],
  };
}
