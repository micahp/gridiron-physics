import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPuntSampler, MATCHUPS, generateGame, seeded, missedFieldGoalRestart, BLOCKED_PUNT_OUTCOMES,
  sampleBlockedPuntOutcome, sampleBlockedFieldGoalOutcome, sampleCoinTossLedger, validateHalfStartKickoffs, validateCoinTossLedger,
  sampleSafetyKickOutcome, SAFETY_KICK_CLASSES } from '../web/week7-core.js';

const league = JSON.parse(readFileSync(new URL('../data/special_teams/2025-league.json', import.meta.url), 'utf8'));

const sample = (type, down, gain, i) => ({
  attributes:{play_type:type,down,ydstogo:down===3?6:10,yardline_100:65},
  outcome_label:{yards_gained:gain, complete_pass:type==='pass'&&gain>0?1:0,
    interception:0,touchdown:0},
  source_id:{game_id:'2025_01_'+i,play_id:String(i)}
});
function book(id){
  const observed=[];
  for(let down=1;down<=4;down++)for(let i=0;i<17;i++){
    observed.push(sample('run',down,i%4===0?-1:2+(i%6),i+down*100));
    observed.push(sample('pass',down,i%3===0?0:5+(i%18),i+down*150));
  }
  return {team_id:id,offense:{observed_plays:observed,
    profile:{run_pass:{categories:{run:{rate:.46},pass:{rate:.54}}}},
    play_candidates:{run:{candidates:[{candidate_id:'run-'+id,count:30,
      attributes:{formation:'SHOTGUN'}}]},
      pass:{candidates:[{candidate_id:'pass-'+id,count:32,
        attributes:{formation:'SHOTGUN'}}]}}},defense:{observed_plays:observed}};
}
for(const m of MATCHUPS){
  const books={[m.home]:book(m.home),[m.away]:book(m.away)};
  const a=generateGame(m,books,'1042',league),b=generateGame(m,books,'1042',league);
  assert.deepEqual(a,b,'same seed and historical inputs reproduce');
  assert.equal(a.game_id,m.id);
  assert.ok(a.plays.length>40);
  assert.ok(a.drives.length>4);
  assert.ok(a.plays.filter(x=>x.type==='scrimmage').length>30);
  assert.ok(a.plays.every((p,i)=>p.index===i+1 && p.id.startsWith(m.id)));
  assert.ok(a.plays.every(p=>[m.home,m.away].includes(p.offense)));
  assert.ok(a.plays.every(p=>p.clock>=0 && p.clock<=900 && p.quarter>=1 && p.quarter<=4));
  assert.ok(a.plays.filter(p=>p.type==='scrimmage').every(p=>p.candidate?.candidate_id && p.source_id?.game_id?.startsWith('2025_')));
  const last=a.plays.at(-1);
  const regulationElapsed=!a.refusal && last.quarter===4 && last.runoff>=last.clock && a.drives.at(-1)?.reason==='end_regulation';
  assert.equal(a.complete_regulation,regulationElapsed);
  assert.equal(a.status,a.refusal?'UNSUPPORTED_RULE_REFUSAL':regulationElapsed
    ? (a.score[m.home]===a.score[m.away]?'REGULATION_COMPLETE_OVERTIME_UNMODELED':'REGULATION_COMPLETE_UNVALIDATED')
    :'SIMULATION_LIMIT_REACHED_UNVALIDATED');
  assert.ok(a.warnings.some(x=>x.includes('overtime')));
  // Special teams: the game opens with a kickoff, and every score and the second half open with one.
  assert.equal(a.plays[0].type,'kickoff');
  assert.ok(a.plays.some(p=>p.type==='kickoff' && p.quarter===3 && p.clock===900));
  a.plays.forEach((p,i)=>{
    if((p.type==='scrimmage' && p.touchdown) || (p.type==='field_goal' && p.good)){
      assert.equal(a.plays[i+1]?.type ?? 'kickoff', 'kickoff', 'score not followed by a kickoff at '+p.id);
    }
    if(p.type==='field_goal') assert.equal(p.distance, p.yl+18, 'field goal distance is yards to goal plus 10 end zone plus the 8-yard holder offset');
    if(p.type==='punt'){
      assert.ok(Number.isFinite(p.distance) && p.outcome, 'punt has distance and outcome');
      assert.ok(p.yl>40, 'punts only from beyond the 40');
      // Blocked punts are zero-yard punts; a punt with positive distance is never blocked.
      if(p.outcome==='blocked') assert.equal(p.distance,0,'blocked punt is a zero-yard punt');
      else assert.ok(p.distance>0,'non-blocked punt has positive distance');
    }
    if(p.type==='kickoff') assert.ok(['touchback','out_of_bounds','returned','fair_catch','downed'].includes(p.outcome));
    if(p.type==='scrimmage' || p.type==='punt' || p.type==='field_goal') assert.ok(p.yl>=1 && p.yl<=99, 'yardline in range at '+p.id);
  });
}

// Completion describes the simulated regulation clock; it does not certify
// NFL legality. Pin a tied and a non-tied regulation ending from real playbooks.
{
  const m=MATCHUPS[0];
  const realBooks=Object.fromEntries([m.home,m.away].map(team=>[
    team,JSON.parse(readFileSync(new URL(`../data/playbooks/${team}-2025.json`,import.meta.url),'utf8'))]));
  const tied=generateGame(m,realBooks,'1',league);
  assert.equal(tied.score[m.home],tied.score[m.away],'seed 1 reaches Q4 expiration tied');
  assert.equal(tied.complete_regulation,true,'a tie still completes regulation');
  assert.equal(tied.status,'REGULATION_COMPLETE_OVERTIME_UNMODELED');
  assert.equal(tied.provenance.model_validated,false);
  assert.equal('valid_full_game' in tied,false,'regulation completion does not claim a valid full game');
  const nonTied=generateGame(m,realBooks,'2',league);
  assert.notEqual(nonTied.score[m.home],nonTied.score[m.away],'seed 2 reaches Q4 expiration with a winner');
  assert.equal(nonTied.complete_regulation,true);
  assert.equal(nonTied.status,'REGULATION_COMPLETE_UNVALIDATED');
  assert.equal(nonTied.provenance.model_validated,false);
  assert.equal('valid_full_game' in nonTied,false,'regulation completion does not claim a valid full game');
}

// A run/pass-heavy fixture hits the per-quarter snap guard before 0:00. It
// stays incomplete and its final drive is not mislabeled as end_regulation.
{
  const stalledBook=id=>{
    const observed=[];
    for(let down=1;down<=4;down++)for(let i=0;i<100;i++){
      observed.push(sample('pass',down,0,2000+i+down*100));
      observed.push(sample('run',down,0,4000+i+down*100));
    }
    return {team_id:id,offense:{observed_plays:observed,
      profile:{run_pass:{categories:{run:{rate:0},pass:{rate:1}}}},
      play_candidates:{run:{candidates:[{candidate_id:'stalled-run-'+id,count:1,attributes:{formation:'SHOTGUN'}}]},
        pass:{candidates:[{candidate_id:'stalled-pass-'+id,count:1,attributes:{formation:'SHOTGUN'}}]}}},
      defense:{observed_plays:observed}};
  };
  const m=MATCHUPS[0], books={[m.home]:stalledBook(m.home),[m.away]:stalledBook(m.away)};
  const noBlocked=structuredClone(league);
  noBlocked.punts.outcomes.blocked=0;
  noBlocked.punts.distance_yards['0']=0;
  noBlocked.field_goals.non_make_split.blocked=0;
  let stopped=null;
  for(let seed=1;seed<=20&&!stopped;seed++){
    const candidate=generateGame(m,books,String(seed),noBlocked);
    if(candidate.status==='SIMULATION_LIMIT_REACHED_UNVALIDATED') stopped=candidate;
  }
  assert.ok(stopped,'fixture reaches the simulation guard before Q4 expires');
  assert.equal(stopped.complete_regulation,false);
  assert.equal(stopped.drives.at(-1).reason,'simulation_limit');
}

// Sample independently seeded punts to verify the empirical marginals and
// the observed zero-distance/blocked-punt pairing without relying on a game
// seed happening to include a block.
const samplePunt = createPuntSampler(league.punts);
const sampleN = 50000;
const outcomeCounts = Object.fromEntries(Object.keys(league.punts.outcomes).map(k=>[k,0]));
const distanceCounts = Object.fromEntries(Object.keys(league.punts.distance_yards)
  .filter(k=>Number(k)>0).map(k=>[Number(k),0]));
let blockedCount = 0;
for(let i=0;i<sampleN;i++){
  const punt = samplePunt(60,seeded('punt-sample-'+i));
  outcomeCounts[punt.outcome]++;
  if(punt.outcome==='blocked'){
    blockedCount++;
    assert.equal(punt.distance,0,'blocked outcome has zero recorded distance');
  } else {
    assert.ok(punt.distance>0,'non-blocked outcome has positive recorded distance');
    distanceCounts[punt.distance]++;
  }
}
const outcomeTotal=Object.values(league.punts.outcomes).reduce((n,v)=>n+v,0);
const outcomeTv=0.5*Object.entries(league.punts.outcomes).reduce((n,[k,v])=>
  n+Math.abs(outcomeCounts[k]/sampleN-v/outcomeTotal),0);
assert.ok(outcomeTv<0.02,`punt outcome distribution drifted (TV=${outcomeTv})`);
const positiveDistanceHist=Object.fromEntries(Object.entries(league.punts.distance_yards)
  .filter(([yards])=>Number(yards)>0));
const positiveTotal=Object.values(positiveDistanceHist).reduce((n,v)=>n+v,0);
const sampledNonBlocked=sampleN-blockedCount;
const distanceTv=0.5*Object.entries(positiveDistanceHist).reduce((n,[yards,v])=>
  n+Math.abs(distanceCounts[Number(yards)]/sampledNonBlocked-v/positiveTotal),0);
assert.ok(distanceTv<0.025,`non-blocked punt distance distribution drifted (TV=${distanceTv})`);
const expectedBlocked=Number(league.punts.outcomes.blocked)/outcomeTotal;
assert.ok(Math.abs(blockedCount/sampleN-expectedBlocked)<0.0011,
  `blocked punt rate drifted (${blockedCount/sampleN} vs ${expectedBlocked})`);
assert.throws(()=>createPuntSampler({
  ...league.punts,
  distance_yards:{...league.punts.distance_yards,'0':8},
}),/punt table mismatch/,'reject a changed blocked/zero-distance relationship');

// Missed-FG restart boundary: the kick spot is inside the receivers' 20 (kick position only, no contact claim).
assert.deepEqual(missedFieldGoalRestart(11).restartOwn, 20, 'kick spot 19 restarts at the 20');
assert.equal(missedFieldGoalRestart(11).kickSpotInside20, true);
assert.equal(missedFieldGoalRestart(12).restartOwn, 20, 'kick spot 20 restarts at the kick spot, which is the 20');
assert.equal(missedFieldGoalRestart(12).kickSpotInside20, false);
assert.equal(missedFieldGoalRestart(13).restartOwn, 21, 'kick spot 21 restarts at the kick spot');
assert.equal('untouched' in missedFieldGoalRestart(11), false, 'old untouched name is gone');

// Blocked punts: fail closed without a resolution table.
const rngBlocked = seeded('blocked-core');
assert.throws(()=>sampleBlockedPuntOutcome({}, rngBlocked), /missing blocked-punt/);
assert.equal(sampleBlockedPuntOutcome({blocked_resolution_pooled:{safety:3}}, rngBlocked), 'safety');

// Coin-toss ledger: both winners, both normal choices, Q3 kicker is the Q1 receiver.
const other = (m, t) => t === m.home ? m.away : m.home;
for (const m of MATCHUPS.slice(0, 2)) {
  const books = {[m.home]:book(m.home), [m.away]:book(m.away)};
  for (const winner of [m.home, m.away]) for (const choice of ['receive', 'defer']) {
    const g = generateGame(m, books, '7', league, {coinToss:{winner, choice}});
    const L = g.coin_toss_ledger;
    assert.equal(L.coin_toss.winner, winner);
    assert.equal(L.coin_toss.winner_deferred, choice === 'defer');
    assert.equal(L.source, 'authored_simulation_choice');
    const q1 = g.plays.find(p=>p.type==='kickoff' && p.reason==='half_start' && p.quarter===1);
    const q3 = g.plays.find(p=>p.type==='kickoff' && p.reason==='half_start' && p.quarter===3);
    const q1Receiver = choice === 'receive' ? winner : other(m, winner);
    assert.equal(q1.receiving_team, q1Receiver, `${m.id} ${winner} ${choice}: Q1 receiver`);
    assert.equal(q1.kicking_team, other(m, q1Receiver), `${m.id} ${winner} ${choice}: Q1 kicker`);
    assert.equal(q3.kicking_team, q1Receiver, `${m.id} ${winner} ${choice}: Q3 kicker is the Q1 receiver`);
    assert.equal(q3.receiving_team, q1.kicking_team, `${m.id} ${winner} ${choice}: Q3 receiver is the Q1 kicker`);
    assert.equal(validateHalfStartKickoffs(g.plays, L), true);
  }
  // A non-normal choice is rejected in normal mode.
  assert.throws(()=>generateGame(m, books, '7', league, {coinToss:{winner:m.home, choice:'kick'}}),
    /receive or defer/, 'kick choice is rejected in normal mode');
  // An inconsistent halftime kickoff, where the Q1 kicker kicks Q3 too, is rejected.
  const g = generateGame(m, books, '7', league, {coinToss:{winner:m.home, choice:'receive'}});
  const q1 = g.plays.find(p=>p.type==='kickoff' && p.reason==='half_start' && p.quarter===1);
  const bad = g.plays.map(p => p.type==='kickoff' && p.reason==='half_start' && p.quarter===3
    ? {...p, kicking_team:q1.kicking_team, receiving_team:q1.receiving_team} : p);
  assert.throws(()=>validateHalfStartKickoffs(bad, g.coin_toss_ledger), /same team|does not match/,
    'same team kicking both half-start kickoffs is rejected');
}

// ---- Review corrections: targeted positive and negative fixtures -----------
const punts = league.punts;
const forcedBlocked = (outcome, td = {touchdown:0, no_touchdown:1}) => ({...league, punts:{outcomes:{blocked:1}, distance_yards:{'0':1,'40':1},
  blocked_receiving_touchdown_pooled: td,
  blocked_resolution_pooled:Object.fromEntries(['receiving_recovery','kicking_recovery','out_of_bounds','safety']
    .map(k=>[k,k===outcome?1:0]))}});
const findGame = (predicate, league_, count=8) => {
  for (const m of MATCHUPS.slice(0,2)) for (const seed of ['1042','1','2','3','4','5','6','7'].slice(0,count)) {
    const books = {[m.home]:book(m.home), [m.away]:book(m.away)};
    const g = generateGame(m, books, seed, league_);
    if (predicate(g)) return g;
  }
  return null;
};

// (2) Blocked-punt recovery by the kicking team: refused, no automatic first down.
{
  const g = findGame(g=>g.plays.some(p=>p.type==='punt'), forcedBlocked('kicking_recovery'));
  assert.ok(g, 'a forced kicking-recovery game has a punt');
  assert.equal(g.status, 'UNSUPPORTED_RULE_REFUSAL');
  assert.equal(g.complete_regulation,false,'a rule refusal before 0:00 is not a regulation completion');
  assert.equal(g.refusal.rule, 'blocked_punt_kicking_recovery');
  const last = g.plays.at(-1);
  assert.equal(last.type, 'unsupported_rule', 'game ends at the refusal, with no sampled next series');
  const punt = g.plays.find(p=>p.type==='punt');
  assert.equal(punt.possession_resolution, 'kicking_recovery');
  assert.equal(punt.possession_after, punt.offense, 'kicking team keeps the ball, not an automatic first down');
}
// (2) Negative: a receiving-team recovery is a turnover, not a refusal or a kicking-team first down.
{
  const g = findGame(g=>g.plays.some(p=>p.type==='punt'), forcedBlocked('receiving_recovery'));
  assert.ok(['REGULATION_COMPLETE_UNVALIDATED','REGULATION_COMPLETE_OVERTIME_UNMODELED',
    'SIMULATION_LIMIT_REACHED_UNVALIDATED'].includes(g.status));
  assert.equal(g.refusal,null,'a receiving-team recovery is modeled, not refused');
  const punt = g.plays.find(p=>p.type==='punt');
  const nxt = g.plays[punt.index];
  assert.notEqual(nxt.offense, punt.offense, 'receiving team takes over after a receiving recovery');
  assert.equal(nxt.down, 1);
  assert.equal(nxt.togo, Math.min(10, nxt.yl));
}

// (2b) Receiving recovery returned for a touchdown: 6 points, then an XP and a kickoff by the scoring team.
{
  const g = findGame(g=>g.plays.some(p=>p.type==='punt'), forcedBlocked('receiving_recovery', {touchdown:1, no_touchdown:0}));
  const punt = g.plays.find(p=>p.type==='punt');
  assert.equal(punt.touchdown_return, true, 'touchdown return is marked');
  assert.equal(punt.possession_after, punt.recovery_team, 'receiving team is the recovering team');
  assert.equal(punt.scoreAfter[punt.recovery_team], punt.score[punt.recovery_team] + 6 + (punt.try?.startsWith('XP good') ? 1 : 0),
    'touchdown return scores 6 plus the XP');
  const ko = g.plays[punt.index];
  assert.equal(ko.type, 'kickoff', 'touchdown return is followed by a kickoff');
  assert.equal(ko.kicking_team, punt.recovery_team, 'the scoring team kicks off');
}

// (1) Safety free kick, sampled from the 2025 post-safety rows. Each test forces
// a single class so the outcome is known. The kicking team is the one scored on,
// kicks from its own 20, and possession and drive continue with the receiving team.
const onlyClass = (name) => ({...league.safety_kicks, categories: Object.fromEntries(
  SAFETY_KICK_CLASSES.map(k => [k, k === name ? league.safety_kicks.categories[k] : {n:0, rows:[]}]))});
const withSafety = (name) => ({...forcedBlocked('safety'), safety_kicks: onlyClass(name)});
const nextPlay = (g, p) => g.plays.find(q => q.index === p.index + 1);
// (1a) Normal free kick: the spot is an observed 2025 post-safety spot, and play continues with the receiving team.
{
  const g = findGame(g=>g.plays.some(p=>p.type==='safety_kick'), withSafety('normal_free_kick'));
  assert.ok(g, 'a forced normal-kick game has a safety kick');
  const punt = g.plays.find(p=>p.type==='punt');
  const sk = g.plays.find(p=>p.type==='safety_kick');
  assert.equal(sk.kick_type, 'normal_free_kick');
  assert.equal(sk.kick_spot_own, 20, 'safety kick is taken from the own 20');
  const observed = league.safety_kicks.categories.normal_free_kick.rows.map(r=>r.receiving_spot_yardline_100);
  assert.ok(observed.includes(sk.receiving_spot), 'receiving spot is one of the observed 2025 post-safety spots');
  assert.equal(sk.yl, sk.receiving_spot, 'ball is placed at the sampled spot');
  assert.equal(sk.possession_after, sk.receiving_team, 'receiving team takes possession');
  assert.equal(punt.scoreAfter[sk.receiving_team], punt.score[sk.receiving_team]+2, 'safety scores 2 for the receiving team');
  assert.notEqual(sk.drive, punt.drive, 'safety kick opens a new drive');
  assert.equal(sk.offense, sk.receiving_team, 'safety kick is owned by the receiving team');
  // Possession continuity: the next scrimmage play is the receiving team's first down in the same drive.
  const nxt = nextPlay(g, sk);
  assert.ok(nxt, 'a play follows the safety kick');
  assert.equal(nxt.offense, sk.receiving_team, 'next play is the receiving team');
  assert.equal(nxt.drive, sk.drive, 'next play stays in the safety-kick drive');
  assert.equal(nxt.down, 1);
  assert.equal(nxt.togo, Math.min(10, nxt.yl));
  assert.ok(g.plays.filter(p=>p.drive===sk.drive).every(p=>p.offense===sk.receiving_team),
    'every event in the safety-kick drive is owned by the receiving team');
  assert.equal(sk.source.game_id.startsWith('2025_'), true, 'sampled kick names its 2025 source row');
}
// (1b) Onside kick recovered or fair caught by the receiving team: its own event type, from the kicking team's 20.
{
  const g = findGame(g=>g.plays.some(p=>p.type==='onside_kick'), withSafety('onside_receiving_possession'));
  assert.ok(g, 'a forced onside game has an onside kick');
  const on = g.plays.find(p=>p.type==='onside_kick');
  assert.equal(on.kick_type, 'onside_receiving_possession');
  assert.equal(on.kick_spot_own, 20, 'onside kick is taken from the kicking team\'s own 20');
  assert.ok([38, 31].includes(on.receiving_spot), 'onside spot is one of the two observed receiving-team onside spots');
  assert.equal(on.possession_after, on.receiving_team, 'receiving team keeps the ball after a receiving-team onside outcome');
  assert.equal(g.refusal?.rule, undefined, 'a receiving-team onside outcome is not refused');
  const nxt = nextPlay(g, on);
  assert.equal(nxt.offense, on.receiving_team, 'next play is the receiving team');
  assert.equal(nxt.drive, on.drive, 'next play stays in the onside drive');
}
// (1c) Onside kick recovered by the kicking team (2025_08_CLE_NE, kick play 3742, next play 3771).
// Rule 7-3-1(e): the kicking team keeps the ball as a new series, first and 10 at the recovery spot.
{
  const g = findGame(g=>g.plays.some(p=>p.type==='onside_kick'), withSafety('onside_kicking_recovery'));
  assert.ok(g, 'a forced kicking-recovery game has an onside kick');
  assert.ok(!g.refusal, 'a kicking-team recovery is not refused');
  const on = g.plays.find(p=>p.type==='onside_kick');
  assert.equal(on.kick_type, 'onside_kicking_recovery');
  assert.equal(on.kick_spot_own, 20, 'onside kick is taken from the own 20');
  assert.equal(on.offense, on.kicking_team, 'the kicking team owns the recovery');
  assert.equal(on.possession_after, on.kicking_team, 'the kicking team keeps the ball');
  assert.equal(on.recovery_spot, 67, 'recovery spot is the kicking team own 33 (offense yardline 67), from the kick row');
  assert.equal(on.source.game_id, '2025_08_CLE_NE');
  assert.equal(on.source.play_id, '3742');
  const nxt = nextPlay(g, on);
  assert.ok(nxt, 'a play follows the recovery');
  assert.equal(nxt.offense, on.kicking_team, 'next play is the kicking team');
  assert.equal(nxt.drive, on.drive, 'next play stays in the same drive');
  assert.equal(nxt.down, 1, 'down is 1');
  assert.equal(nxt.togo, 10, 'distance is 10');
  assert.equal(nxt.yl, 67, 'next play starts at the recovery spot');
}
// (1c-2) Fail closed: an unparseable recovery spot or a row without first-and-10 is an error, not a guess.
{
  const rng = seeded('recovery-fail-closed');
  const base = league.safety_kicks.categories.onside_kicking_recovery.rows[0];
  const mk = (row) => ({categories:{normal_free_kick:{n:0, rows:[]}, onside_receiving_possession:{n:0, rows:[]},
    onside_kicking_recovery:{n:1, rows:[row]}}});
  assert.throws(()=>sampleSafetyKickOutcome(mk({...base, offense_spot_yardline_100:undefined}), rng), /no valid recovery spot/);
  assert.throws(()=>sampleSafetyKickOutcome(mk({...base, offense_spot_yardline_100:'x'}), rng), /no valid recovery spot/);
  assert.throws(()=>sampleSafetyKickOutcome(mk({...base, next_play_down:2}), rng), /does not record first and 10/);
}
// (1d) Suspect labels and excluded kick plays are never sampled; the 2025 counts are pinned.
{
  const sk = league.safety_kicks;
  assert.equal(sk.safeties, 12, '12 regular-season safety rows');
  assert.equal(sk.no_kick_after_safety.n, 1, 'one safety ends the game with no kick');
  assert.deepEqual(Object.fromEntries(SAFETY_KICK_CLASSES.map(k=>[k, sk.categories[k].n])),
    {normal_free_kick:5, onside_receiving_possession:2, onside_kicking_recovery:1}, '2025 class counts');
  assert.equal(sk.suspect_onside_labels.n, 1);
  assert.equal(sk.excluded.penalty_on_kick.n, 1);
  assert.equal(sk.excluded.return_fumble.n, 1);
  const suspect = new Set(sk.suspect_onside_labels.rows.map(r=>r.game_id+':'+r.play_id));
  assert.ok(suspect.has('2025_05_DET_CIN:4114'), 'the contradictory onside label is flagged');
  const excluded = new Set([...sk.excluded.penalty_on_kick.rows, ...sk.excluded.return_fumble.rows].map(r=>r.game_id+':'+r.play_id));
  const sampled = new Set(SAFETY_KICK_CLASSES.flatMap(k=>sk.categories[k].rows.map(r=>r.game_id+':'+r.play_id)));
  for (const id of [...suspect, ...excluded]) assert.ok(!sampled.has(id), `${id} is excluded from the sampled table`);
  const rng = seeded('suspect-exclusion');
  for (let i = 0; i < 300; i++) {
    const r = sampleSafetyKickOutcome(sk, rng);
    if (r.source) assert.ok(sampled.has(r.source.game_id+':'+r.source.play_id), 'sampler draws only from sampled rows');
  }
}
// (1e) Fail closed: missing, empty or below-minimum tables never invent an outcome.
{
  const rng = seeded('safety-fail-closed');
  assert.throws(()=>sampleSafetyKickOutcome(undefined, rng), /missing safety-kick outcome table/);
  assert.throws(()=>sampleSafetyKickOutcome({}, rng), /missing safety-kick outcome table/);
  assert.throws(()=>sampleSafetyKickOutcome({categories:{}}, rng), /no observations/);
  assert.throws(()=>sampleSafetyKickOutcome({categories:{normal_free_kick:{n:0, rows:[]}}}, rng), /no observations/);
  const row = {game_id:'x', play_id:'1', outcome:'touchback', return_yards:0, receiving_spot_yardline_100:65};
  const one = {categories:{normal_free_kick:{n:1, rows:[row]}, onside_receiving_possession:{n:0, rows:[]}, onside_kicking_recovery:{n:0, rows:[]}}};
  const r1 = sampleSafetyKickOutcome(one, rng);
  assert.equal(r1.refusal, 'safety_kick_below_minimum_sample', 'a class below the minimum is refused');
  assert.equal(r1.spot, undefined, 'a refused draw has no spot');
  const g = generateGame(MATCHUPS[0], {[MATCHUPS[0].home]:book(MATCHUPS[0].home), [MATCHUPS[0].away]:book(MATCHUPS[0].away)}, '1042',
    {...withSafety('normal_free_kick'), safety_kicks:{categories:{...onlyClass('normal_free_kick').categories,
      normal_free_kick:{n:1, rows:[row]}}}});
  const gg = findGame(g=>g.refusal?.rule==='safety_kick_below_minimum_sample', {...withSafety('normal_free_kick'),
    safety_kicks:{categories:{...onlyClass('normal_free_kick').categories, normal_free_kick:{n:1, rows:[row]}}}});
  assert.ok(gg, 'a game that draws a below-minimum class refuses rather than sampling it');
  assert.equal(gg.plays.find(p=>p.type==='safety_kick').receiving_spot, null);
  assert.ok(g, 'game construction with a one-row class still runs');
  assert.throws(()=>generateGame(MATCHUPS[0], {[MATCHUPS[0].home]:book(MATCHUPS[0].home), [MATCHUPS[0].away]:book(MATCHUPS[0].away)}, '1042',
    {...forcedBlocked('safety'), safety_kicks:undefined}), /missing safety-kick outcome table/,
    'a missing safety table throws; no fallback table is used');
}
// (1f) Under the real 2025 table, no game produces a safety-kick outcome that is not a sampled row.
{
  for (const m of MATCHUPS.slice(0,2)) for (const seed of ['1042','1','2']) {
    const g = generateGame(m, {[m.home]:book(m.home), [m.away]:book(m.away)}, seed, league);
    for (const p of g.plays.filter(q=>q.type==='safety_kick'||q.type==='onside_kick')) {
      if (p.receiving_spot !== null) assert.ok(p.source, 'a sampled safety-kick event names its 2025 source row');
    }
  }
}

// (3) Observed blocked-punt counts are preserved; zero-count outcomes are never sampled.
assert.deepEqual(punts.blocked_resolution, {receiving_recovery:7, kicking_recovery:2, out_of_bounds:0, safety:0},
  'observed 2025 blocked-punt counts');
{
  assert.deepEqual(punts.blocked_resolution_pooled, {receiving_recovery:21, kicking_recovery:11, out_of_bounds:4, safety:3},
    'pooled 2022-2025 blocked-punt counts');
  const rngReal = seeded('blocked-pooled');
  const seen = new Set();
  const hits = {receiving_recovery:0, kicking_recovery:0, out_of_bounds:0, safety:0};
  for (let i = 0; i < 20000; i++) { const k = sampleBlockedPuntOutcome(punts, rngReal); seen.add(k); hits[k]++; }
  assert.deepEqual([...seen].sort(), [...BLOCKED_PUNT_OUTCOMES].sort(), 'all pooled outcomes are sampled');
  for (const [k, n] of Object.entries({receiving_recovery:21, kicking_recovery:11, out_of_bounds:4, safety:3})) {
    assert.ok(Math.abs(hits[k]/20000 - n/39) < 0.01, `${k} sampled share ${hits[k]/20000} vs ${n/39}`);
  }
  assert.throws(()=>sampleBlockedPuntOutcome({blocked_resolution:punts.blocked_resolution}, rngReal), /missing blocked-punt/,
    'the 2025 counts are not the sampling table');
}

// (4) Ledger: recomputed from the toss alone; tampered stored fields fail closed.
{
  const m = MATCHUPS[0];
  const books = {[m.home]:book(m.home), [m.away]:book(m.away)};
  const g = generateGame(m, books, '7', league, {coinToss:{winner:m.home, choice:'defer'}});
  const L = g.coin_toss_ledger;
  assert.equal(validateCoinTossLedger(L), true);
  assert.equal(L.first_half.first_choice_team, m.away, 'defer: loser has first-half choice');
  assert.equal(L.first_half.other_team_choice, 'goal_to_defend', 'other team takes the remaining goal privilege');
  assert.equal(L.first_half.defended_goal_by_team, m.home, 'winner defends the first-half goal the loser chose');
  assert.equal(L.second_half.defended_goal_by_team, m.away);
  const clone = () => structuredClone(L);
  const tampered = clone(); tampered.first_half.other_team_choice = 'kick';
  assert.throws(()=>validateCoinTossLedger(tampered), /other_team_choice/, 'old kick/defer value is rejected');
  const flipped = clone(); flipped.first_half.defended_goal_by_team = m.away;
  assert.throws(()=>validateCoinTossLedger(flipped), /defended_goal_by_team/, 'defended goal must follow the toss');
  const swapped = clone(); swapped.second_half.receiving_team = swapped.second_half.kicking_team;
  assert.throws(()=>validateCoinTossLedger(swapped), /receiving_team|same team/, 'kicker and receiver must differ');
}

// (5) FG runoff: the successful-FG cap is rule-based; miss runoff is an unverified estimate.
{
  const goods = [], misses = [];
  for (const m of MATCHUPS.slice(0,3)) for (const seed of ['1042','1','2','3','4','5']) {
    const g = generateGame(m, {[m.home]:book(m.home), [m.away]:book(m.away)}, seed, league);
    for (const p of g.plays) if (p.type==='field_goal') (p.good ? goods : misses).push(p);
  }
  assert.ok(goods.length && misses.length, 'fixtures cover made and missed field goals');
  for (const p of goods) {
    assert.equal(p.runoff_basis, 'rule_11_4_2_note_5_cap');
    assert.ok(p.runoff <= 5, 'successful FG runoff is capped by Note (5)');
  }
  for (const p of misses) {
    assert.equal(p.runoff_basis, 'unverified_miss_estimate', 'miss runoff is not labelled as the verified cap');
    assert.ok(p.runoff >= 1 && p.runoff <= 5);
  }
}

// (7) Blocked field goals refuse explicitly; a table with no blocks never does.
{
  const noMake = (blocked, missed, resolution = {receiving_recovery:0, kicking_recovery:1, no_recovery:0}) => ({...league, field_goals:{...league.field_goals,
    buckets:league.field_goals.buckets.map(b=>({...b, made:0})),
    non_make_split:{blocked, missed}, blocked_resolution:resolution,
    blocked_receiving_touchdown:{touchdown:0, no_touchdown:1}}});
  const g = findGame(g=>g.plays.some(p=>p.type==='field_goal'), noMake(1, 0));
  assert.ok(g, 'a forced blocked-FG game has a field goal attempt');
  assert.equal(g.refusal.rule, 'blocked_field_goal');
  assert.equal(g.complete_regulation,false,'a blocked-FG refusal before 0:00 is not a regulation completion');
  const fg = g.plays.find(p=>p.type==='field_goal');
  assert.equal(fg.blocked, true);
  assert.equal(g.plays.at(-1).type, 'unsupported_rule', 'game ends at the refusal, with no restart');
  for (const m of MATCHUPS.slice(0,2)) for (const seed of ['1042','1','2']) {
    const h = generateGame(m, {[m.home]:book(m.home), [m.away]:book(m.away)}, seed, noMake(0, 1));
    assert.ok(!h.refusal || h.refusal.rule !== 'blocked_field_goal', 'no blocked-FG refusal when the table has no blocks');
    assert.ok(!h.plays.some(p=>p.blocked), 'no blocked field goal is sampled');
  }
  // Receiving recovery: possession passes at the line, with no refusal.
  const recv = findGame(g=>g.plays.some(p=>p.blocked), noMake(1, 0, {receiving_recovery:1, kicking_recovery:0, no_recovery:0}));
  assert.ok(recv && !recv.refusal, 'a receiving-team blocked-FG recovery completes without refusal');
  const bfg = recv.plays.find(p=>p.type==='field_goal'&&p.blocked);
  assert.equal(bfg.possession_resolution, 'receiving_recovery');
  assert.equal(bfg.possession_after, bfg.recovery_team, 'receiving team takes possession');
  assert.notEqual(recv.plays[bfg.index].offense, bfg.offense, 'the next play belongs to the receiving team');
  // No recovery: the play is restarted as an untouched miss, labelled as such.
  const none = findGame(g=>g.plays.some(p=>p.blocked), noMake(1, 0, {receiving_recovery:0, kicking_recovery:0, no_recovery:1}));
  assert.ok(none && !none.refusal, 'a blocked FG with no recovery completes without refusal');
  const nb = none.plays.find(p=>p.type==='field_goal'&&p.blocked);
  assert.equal(nb.possession_resolution, 'no_recovery');
  assert.ok(nb.restart_spot !== undefined, 'no-recovery blocked FG restarts at a spot');
  // Fail closed: a missing or empty blocked-FG table never invents an outcome.
  assert.throws(()=>sampleBlockedFieldGoalOutcome({}, seeded('fg')), /missing blocked-field-goal/);
  assert.throws(()=>sampleBlockedFieldGoalOutcome({blocked_resolution:{}}, seeded('fg')), /no observations/);
}

// (6) Missed-FG output names kick position, not contact.
{
  const g = findGame(g=>g.plays.some(p=>p.type==='field_goal' && !p.good), league);
  const miss = g.plays.find(p=>p.type==='field_goal' && !p.good);
  assert.equal(typeof miss.kick_spot_inside_20, 'boolean');
  assert.equal('restart_untouched' in miss, false, 'old restart_untouched field is gone');
}

console.log('PASS six matchup playbooks, deterministic 4-period experimental logs, explicit scope guards');
