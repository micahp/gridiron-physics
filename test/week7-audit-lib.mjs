// Reusable state-rule audit for the week-7 generator.
//
// `auditModule(core, league, book)` runs every acceptance check against the
// exported API of a `web/week7-core.js`-shaped module. It is factored out of
// `week7-audit.mjs` so the same checks can be run against a deliberately
// mutated copy of the generator, proving the assertions are not vacuous.
//
// Where the event model cannot prove legality, the event is reported as
// unverified rather than assumed legal.
import assert from 'node:assert/strict';

// Valid receiving-team spots after a kickoff, under 2026 Rule 6-1-5 and 6-2-4.
const VALID_KICKOFF_SPOTS = new Set([80, 65, 60]);

// The acceptance games are the six seed-1042 fixtures. A deterministic seed
// sweep is added on top so the rules that seed 1042 never exercises are still
// covered by a real generated game rather than by a hand-written assertion.
export const SEEDS = ['1042', ...Array.from({length:12},(_,i)=>String(i+1))];

export function auditModule(core, league, book) {
  const {MATCHUPS, generateGame} = core;
  const violations = [];
  const unverified = [];
  const fail = (game, check, detail) => violations.push({game, check, detail});

  for(const m of MATCHUPS){
   for(const seed of SEEDS){
    const books={[m.home]:book(m.home),[m.away]:book(m.away)};
    const g=generateGame(m,books,seed,league);
    const plays=g.plays;
    const tag=(check,detail)=>fail(`${m.id}#${seed}`,check,detail);

    // ---- 1. Goal-to-go ---------------------------------------------------
    // On every play, yards to go may not exceed the distance to the goal line.
    for(const p of plays){
      if(p.type==='scrimmage'||p.type==='punt'||p.type==='field_goal'){
        if(p.togo>p.yl) tag('goal_to_go',
          `${p.id} togo=${p.togo} exceeds distance to goal yl=${p.yl}`);
        if(p.togo<1) tag('goal_to_go',`${p.id} togo=${p.togo} is not positive`);
      }
      // A new series that starts inside the 10 must be goal-to-go. This covers
      // every way a series can begin there: a first down, a turnover deep in
      // the opponent's territory, a missed-FG restart, and a kickoff return
      // that lands inside the 10.
      if(p.down===1 && p.yl<10 && p.togo!==p.yl){
        tag('goal_to_go',`${p.id} new series at yl=${p.yl} has togo=${p.togo}, expected ${p.yl}`);
      }
    }

    // ---- Coin-toss ledger: the remaining privilege is the goal to defend -----
    // Checked against the rule's wording, not the generator's own derivation.
    if(g.coin_toss_ledger.first_half.other_team_choice!=='goal_to_defend')
      tag('ledger',`other_team_choice is ${g.coin_toss_ledger.first_half.other_team_choice}, expected goal_to_defend`);

    // ---- 2/3. Kickoff placement and ownership ----------------------------
    for(const p of plays){
      if(p.type!=='kickoff') continue;
      if(!p.kicking_team||!p.receiving_team)
        tag('kickoff_ownership',`${p.id} is missing kicking/receiving teams`);
      if(p.kicking_team===p.receiving_team)
        tag('kickoff_ownership',`${p.id} kicker and receiver are the same team`);
      if(!VALID_KICKOFF_SPOTS.has(p.receiving_spot) && p.outcome!=='returned' && p.outcome!=='fair_catch' && p.outcome!=='downed')
        tag('kickoff_spot',`${p.id} outcome=${p.outcome} invalid receiving spot ${p.receiving_spot}`);
      // Touchback spots must match the touchback type.
      if(p.touchback_type==='landing_zone' && p.receiving_spot!==80)
        tag('kickoff_spot',`${p.id} landing-zone touchback spotted at ${p.receiving_spot}, expected 80`);
      if(p.touchback_type==='in_air' && p.receiving_spot!==65)
        tag('kickoff_spot',`${p.id} in-air touchback spotted at ${p.receiving_spot}, expected 65`);
      if(p.touchback_type==='midfield' && p.receiving_spot!==80)
        tag('kickoff_spot',`${p.id} midfield touchback spotted at ${p.receiving_spot}, expected 80`);
      // The receiving team must be the team with the ball next.
      if(p.possession_after!==p.receiving_team)
        tag('kickoff_ownership',`${p.id} possession_after=${p.possession_after} is not the receiving team`);
      // The kickoff event itself must be owned by the receiving team: it is a
      // special-teams event, and the ball it produces belongs to the receiver.
      if(p.offense!==p.receiving_team)
        tag('kickoff_ownership',`${p.id} kickoff offense=${p.offense} is not the receiving team ${p.receiving_team}`);
      if(p.defense!==p.kicking_team)
        tag('kickoff_ownership',`${p.id} kickoff defense=${p.defense} is not the kicking team ${p.kicking_team}`);
      // The kickoff must open a drive owned by the receiving team, and the
      // first scrimmage play after it must be that team's.
      const next=plays[p.index];
      if(next&&next.type==='scrimmage'&&next.offense!==p.receiving_team)
        tag('kickoff_ownership',`${p.id} is followed by a ${next.offense} scrimmage play, expected ${p.receiving_team}`);
      const dr=g.drives.find(d=>d.index===p.drive);
      if(dr&&dr.offense!==p.receiving_team)
        tag('kickoff_ownership',`${p.id} opens drive ${p.drive} owned by ${dr.offense}, expected ${p.receiving_team}`);
    }

    // ---- 4. Quarter transitions ------------------------------------------
    // A kickoff may never be recorded at 00:00 of a quarter.
    for(const p of plays){
      if(p.type==='kickoff' && p.clock===0)
        tag('quarter_transition',`${p.id} kickoff recorded at 00:00 in Q${p.quarter}`);
    }
    // The clock must not increase as the game progresses, except at a period
    // boundary where the clock resets to 15:00.
    for(let i=1;i<plays.length;i++){
      const prev=plays[i-1], cur=plays[i];
      if(cur.quarter===prev.quarter && cur.clock>prev.clock)
        tag('quarter_transition',`${cur.id} clock rose from ${prev.clock} to ${cur.clock} within Q${cur.quarter}`);
    }
    // Q1 and Q3 each open with a kickoff at 15:00. A refused game stops early
    // and has no Q3 opening, so the check applies only to complete games.
    for(const q of (g.refusal ? [1] : [1,3])){
      const open=plays.find(p=>p.quarter===q && p.type==='kickoff');
      if(!open) tag('quarter_transition',`no kickoff opens Q${q}`);
      else if(open.clock!==900) tag('quarter_transition',`Q${q} opening kickoff at clock ${open.clock}, expected 900`);
    }

    // ---- 5. Missed field goal restarts -----------------------------------
    for(const p of plays){
      if(p.type!=='field_goal' || p.good || p.blocked) continue;
      if(p.restart_spot===undefined){ tag('missed_fg',`${p.id} missed field goal has no restart spot`); continue; }
      // Rule 11-4-2(a)/(b) with the estimated kick spot: LOS plus the 8-yard
      // holder offset, measured from the receivers' goal. The old LOS-as-spot
      // restart (receiverOwn = LOS) must be rejected.
      const tryYl=p.yl;                       // yards to the kicking team's goal = receivers' own number at the LOS
      const kickSpotOwn=tryYl+8;
      const expected = kickSpotOwn<20 ? 80 : 100-kickSpotOwn;
      if(p.restart_spot!==expected)
        tag('missed_fg',`${p.id} restart spot ${p.restart_spot}, expected ${expected} (try at yl ${tryYl}, kick spot own ${kickSpotOwn})`);
      if(!String(p.restart_rule||'').includes('11-4-2'))
        tag('missed_fg',`${p.id} restart cites ${p.restart_rule}, expected Rule 11-4-2`);
      if(p.restart_spot<1||p.restart_spot>99)
        tag('missed_fg',`${p.id} restart spot ${p.restart_spot} out of range`);
    }

    // ---- 6. Punt outcome/distance contradictions --------------------------
    for(const p of plays){
      if(p.type==='field_goal' && p.good && p.runoff>5)
        tag('fg_clock',`${p.id} successful field goal runoff ${p.runoff}s exceeds the 5 s cap`);
      if(p.type==='field_goal' && !p.good && p.runoff>5)
        tag('fg_clock',`${p.id} missed field goal runoff ${p.runoff}s exceeds the 5 s cap`);
      if(p.type!=='punt') continue;
      if(p.outcome==='blocked' && p.distance!==0)
        tag('punt_contradiction',`${p.id} blocked punt has distance ${p.distance}`);
      if(p.outcome==='blocked' && !core.BLOCKED_PUNT_OUTCOMES.includes(p.possession_resolution))
        tag('punt_contradiction',`${p.id} blocked punt possession is unresolved or unlabelled`);
      if(p.outcome==='blocked' && p.possession_after!==p.recovery_team)
        tag('punt_contradiction',`${p.id} blocked punt possession ${p.possession_after} does not match recovery ${p.recovery_team}`);
      if(p.outcome!=='blocked' && !(p.distance>0))
        tag('punt_contradiction',`${p.id} ${p.outcome} punt has distance ${p.distance}`);
    }

    // ---- Score and possession continuity ---------------------------------
    // The score carried forward must match the score recorded on each play.
    const running={[m.home]:0,[m.away]:0};
    for(const p of plays){
      // The score before the play.
      for(const t of [m.home,m.away]){
        if(p.score && p.score[t]!==running[t])
          tag('score_continuity',`${p.id} pre-play score ${t}=${p.score[t]} but carried ${running[t]}`);
      }
      const xp=p.try?.startsWith('XP good')?1:0;
      const scorer=p.touchdown_return?p.recovery_team:p.offense;
      const pts=p.touchdown_return?0:(p.touchdown?6:0)+(p.type==='field_goal'&&p.good?3:0)+xp;
      if(p.touchdown_return) running[scorer]+=6+xp;
      if(pts) running[p.offense]+=pts;
      if(p.possession_resolution==='safety') running[p.offense===m.home?m.away:m.home]+=2;
      // The score after the play.
      if(p.scoreAfter){
        for(const t of [m.home,m.away]){
          if(p.scoreAfter[t]!==running[t])
            tag('score_continuity',`${p.id} post-play score ${t}=${p.scoreAfter[t]} but accumulated ${running[t]}`);
        }
      }
    }
    for(const t of [m.home,m.away]){
      if(running[t]!==g.score[t])
        tag('score_continuity',`final score ${t}=${g.score[t]} but plays total ${running[t]}`);
    }

    // Possession continuity: within a drive the offense may not change. A change
    // of possession must come with a new drive.
    for(let i=1;i<plays.length;i++){
      const prev=plays[i-1], cur=plays[i];
      if(cur.offense===prev.offense) continue;
      if(cur.drive===prev.drive)
        tag('possession_continuity',
          `${cur.id} offense changed from ${prev.offense} to ${cur.offense} inside drive ${cur.drive}`);
    }
   }
  }

  return {violations, unverified};
}

// ---- Kickoff placement regression tests --------------------------------
// The generated games do not naturally produce every kickoff outcome, so the
// 2026 Rule 6-1-5 placement rules are tested directly against the sampler.
export function auditKickoffSampler(core, league, book) {
  const {createKickoffSampler} = core;
  const only=(outcome)=>({...league.kickoffs,outcomes:{[outcome]:1}});
  const always=(outcome,type)=>{
    const s=createKickoffSampler(only(outcome));
    // Force the touchback type by controlling the random draw.
    const rand=()=>type==='landing_zone'?0.0:0.999999;
    return s(35,rand);
  };

  // Touchback that touched the landing zone -> the receiving team's 20 (yl 80).
  const zone=always('touchback','landing_zone');
  assert.equal(zone.spot,80,"landing-zone touchback must be spotted at the receiving team's 20");
  assert.equal(zone.touchback_type,'landing_zone');

  // Touchback that reached the end zone in the air -> the receiving team's 35 (yl 65).
  const air=always('touchback','in_air');
  assert.equal(air.spot,65,"in-air touchback must be spotted at the receiving team's 35");
  assert.equal(air.touchback_type,'in_air');

  // The 2026 midfield exception: a kickoff from the 50 is spotted at the
  // receiving team's 20 for either touchback type.
  for(const type of ['landing_zone','in_air']){
    const mid=createKickoffSampler(only('touchback'))(50,()=>type==='landing_zone'?0.0:0.999999);
    assert.equal(mid.spot,80,`midfield ${type} touchback must be spotted at the receiving team's 20`);
    assert.equal(mid.touchback_type,'midfield');
  }

  // Out of bounds -> the receiving team's 40 (yl 60).
  const oob=createKickoffSampler(only('out_of_bounds'))(35,core.seeded('oob'));
  assert.equal(oob.spot,60,"out-of-bounds kickoff must be spotted at the receiving team's 40");

  // The sampler must reject a table with no touchback landing-zone split.
  assert.throws(()=>createKickoffSampler({...league.kickoffs,touchback_spot:{landing_zone:0,in_air:0}}),
    /landing-zone split/,'reject a kickoff table with no touchback split');

  // Blocked punts sample all four observed outcomes, and the sampler fails
  // closed when the resolution table is missing or empty.
  const rng=core.seeded('blocked-outcome');
  const mixed={blocked_resolution_pooled:{receiving_recovery:7,kicking_recovery:2,out_of_bounds:1,safety:1}};
  const sampled=new Set();
  for(let i=0;i<4000;i++) sampled.add(core.sampleBlockedPuntOutcome(mixed,rng));
  assert.deepEqual([...sampled].sort(),[...core.BLOCKED_PUNT_OUTCOMES].sort(),
    'all four blocked-punt outcomes must be sampled');
  assert.throws(()=>core.sampleBlockedPuntOutcome({},rng),/missing blocked-punt/,'missing table must fail closed');
  assert.throws(()=>core.sampleBlockedPuntOutcome({blocked_resolution_pooled:{receiving_recovery:0,kicking_recovery:0,out_of_bounds:0,safety:0}},rng),
    /no observations/,'an empty table must fail closed');
  assert.ok(core.BLOCKED_PUNT_OUTCOMES.includes(core.sampleBlockedPuntOutcome(league.punts,rng)),
    'observed 2025 table yields a known outcome');

  // Generator call site: a table with one outcome forces that outcome on every
  // blocked punt, so each branch's possession and next-play ownership is checked
  // in real generated games.
  for(const outcome of core.BLOCKED_PUNT_OUTCOMES){
    const only={...league,punts:{outcomes:{blocked:1},distance_yards:{'0':1,'40':1},
      blocked_receiving_touchdown_pooled:{touchdown:0,no_touchdown:1},
      blocked_resolution_pooled:Object.fromEntries(core.BLOCKED_PUNT_OUTCOMES.map(k=>[k,k===outcome?1:0]))}};
    const seen=new Set();
    for(const m of core.MATCHUPS.slice(0,2)) for(const seed of ['1042','1','2','3']){
      const books={[m.home]:book(m.home),[m.away]:book(m.away)};
      const g=core.generateGame(m,books,seed,only);
      for(const p of g.plays){
        if(p.type!=='punt') continue;
        seen.add(p.possession_resolution);
        assert.equal(p.distance,0,`${p.id} blocked punt must be a zero-yard punt`);
        if(p.possession_resolution==='safety')
          assert.equal(p.scoreAfter[p.possession_after],p.score[p.possession_after]+2,'safety scores 2 for the receiving team');
        if(p.possession_resolution==='kicking_recovery'||p.possession_resolution==='safety'){
          assert.ok(g.refusal, `${p.id} ${p.possession_resolution} must refuse the game, not continue`);
          continue;
        }
        if(p.possession_resolution==='safety')
          assert.equal(p.scoreAfter[p.possession_after],p.score[p.possession_after]+2,'safety scores 2 for the receiving team');
        const next=g.plays[p.index];
        if(next && next.quarter===p.quarter && next.type!=='kickoff' && next.offense!==p.possession_after)
          throw new Error(`${p.id} blocked punt possession ${p.possession_after} but next play offense is ${next.offense}`);
      }
    }
    assert.deepEqual([...seen],[outcome],`generated blocked punts must all resolve as ${outcome}`);
  }

  // Receiving recoveries returned for a touchdown: six points for the recovering
  // team, then a kickoff that the scoring team takes.
  const tdTable={...league,punts:{outcomes:{blocked:1},distance_yards:{'0':1,'40':1},
    blocked_resolution_pooled:{receiving_recovery:1,kicking_recovery:0,out_of_bounds:0,safety:0},
    blocked_receiving_touchdown_pooled:{touchdown:1,no_touchdown:0}}};
  let tds=0;
  for(const m of core.MATCHUPS.slice(0,2)) for(const seed of ['1042','1','2']){
    const g=core.generateGame(m,{[m.home]:book(m.home),[m.away]:book(m.away)},seed,tdTable);
    for(const p of g.plays){
      if(!p.touchdown_return) continue;
      tds++;
      assert.equal(p.scoreAfter[p.recovery_team],p.score[p.recovery_team]+6+(p.try?.startsWith('XP good')?1:0),
        `${p.id} touchdown return must score 6 plus any XP`);
      const next=g.plays[p.index];
      assert.equal(next.type,'kickoff',`${p.id} touchdown return must be followed by a kickoff`);
      assert.equal(next.kicking_team,p.recovery_team,`${p.id} scoring team must kick off`);
    }
  }
  assert.ok(tds>0,'forced touchdown returns are generated');

  // A return touchdown with a made PAT must credit six plus one to the recovering
  // team only. The punting team keeps nothing, and the full audit must agree.
  const patTable={...tdTable, extra_points:{good:1}};
  let patReturns=0;
  for(const m of core.MATCHUPS.slice(0,2)) for(const seed of ['1042','1','2']){
    const g=core.generateGame(m,{[m.home]:book(m.home),[m.away]:book(m.away)},seed,patTable);
    patReturns+=g.plays.filter(p=>p.touchdown_return&&p.try?.startsWith('XP good')).length;
  }
  assert.ok(patReturns>0,'forced touchdown returns with a made PAT are generated');
  const patViolations=auditModule(core,patTable,book).violations.filter(v=>v.check==='score_continuity');
  assert.deepEqual(patViolations,[],'return touchdown with PAT must satisfy score continuity');
}
