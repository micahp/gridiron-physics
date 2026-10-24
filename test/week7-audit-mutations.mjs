// Mutation test for the state-rule audit.
//
// Each case applies a textual mutation to a COPY of web/week7-core.js and
// runs the same audit against the mutated module. The audit must fail for
// every mutation: if a mutation survives, the corresponding assertion is
// vacuous and the fix is not actually being verified.
//
// The generator source is never modified in place. The copy is written to a
// temp directory and imported from there.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { auditModule, auditKickoffSampler } from './week7-audit-lib.mjs';

const CORE_URL = new URL('../web/week7-core.js', import.meta.url);
const source = readFileSync(CORE_URL, 'utf8');
const league = JSON.parse(readFileSync(new URL('../data/special_teams/2025-league.json', import.meta.url), 'utf8'));

const sample = (type, down, gain, i) => ({
  attributes:{play_type:type,down,ydstogo:down===3?6:10,yardline_100:65},
  outcome_label:{yards_gained:gain,complete_pass:type==='pass'&&gain>0?1:0,
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
    play_candidates:{
      run:{candidates:[{candidate_id:'run-'+id,count:30,
        attributes:{formation:'SHOTGUN'}}]},
      pass:{candidates:[{candidate_id:'pass-'+id,count:32,
        attributes:{formation:'SHOTGUN'}}]}}},
    defense:{observed_plays:observed}};
}

// Each mutation is {name, from, to}. `from` must appear exactly once, so a
// mutation cannot silently become a no-op.
const MUTATIONS = [
  {name:'landing-zone touchback spotted at own 25',
    from:'landing_zone_touchback: 80,', to:'landing_zone_touchback: 75,'},
  {name:'in-air touchback spotted at own 20',
    from:'in_air_touchback: 65,', to:'in_air_touchback: 80,'},
  {name:'out-of-bounds kickoff spotted at own 35',
    from:'out_of_bounds: 60,', to:'out_of_bounds: 65,'},
  {name:'midfield touchback exception removed',
    from:'midfield_touchback: 80,', to:'midfield_touchback: 65,'},
  {name:'new series always starts with a fresh 10 yards',
    from:'    togo = Math.min(10, yl);\n  }\n  function turnover',
    to:'    togo = 10;\n  }\n  function turnover'},
  {name:'scrimmage first down always starts a fresh 10',
    from:'if (finalGain >= togo) { down = 1; togo = Math.min(10,yl); }',
    to:'if (finalGain >= togo) { down = 1; togo = 10; }'},
  {name:'kickoff keeps the kicking team as the offense',
    from:'    offense = receiving;\n    newSeries(sampled.spot);',
    to:'    newSeries(sampled.spot);'},
  {name:'kickoff deferred out of a quarter is recorded at 00:00',
    from:'  function scheduleKickoff(kicking, reason) {\n    if (clock <= 0) { pendingKickoff = { kicking, reason }; return null; }',
    to:'  function scheduleKickoff(kicking, reason) {\n    if (false) { pendingKickoff = { kicking, reason }; return null; }'},
  {name:'missed field goal restarts at the 20 regardless of the try',
    from:'const restartOwn = untouched ? 20 : kickSpotOwn;',
    to:'const restartOwn = 20;'},
  {name:'missed field goal spots the ball at the LOS, not the kick spot (old behavior)',
    from:'const kickSpotOwn = yl + FG_HOLDER_OFFSET_ESTIMATE;',
    to:'const kickSpotOwn = yl;'},
  {name:'missed field goal kick spot is off by one yard',
    from:'const kickSpotOwn = yl + FG_HOLDER_OFFSET_ESTIMATE;',
    to:'const kickSpotOwn = yl + FG_HOLDER_OFFSET_ESTIMATE + 1;'},
  {name:'field goal runoff is uncapped at 11 seconds',
    from:'Math.min(clock, FG_RUNOFF_CAP, good ? FG_RUNOFF_CAP : 4 + Math.floor(rand() * 2))',
    to:'Math.min(clock, good ? 11 : 4 + Math.floor(rand() * 2))'},
  {name:'blocked punt always goes to the receiving team',
    from:'const recovery = blockedPuntRecovery(rand);',
    to:"const recovery = (blockedPuntRecovery(rand), 'receiving');"},
  {name:'blocked punt transfers possession even when the kicking team recovers',
    from:"if (recovery === 'receiving') turnover('blocked_punt', pt.spot);",
    to:"if (true) turnover('blocked_punt', pt.spot);"},
  {name:'blocked punt keeps a positive kick distance',
    from:"const distance = outcome === 'blocked' ? 0 : Math.round(sampleHist(nonBlockedPuntDistances, rand));",
    to:'const distance = Math.round(sampleHist(nonBlockedPuntDistances, rand));'},
];

const dir = mkdtempSync(join(tmpdir(), 'week7-mut-'));
let failures = 0;
try {
  for (const mut of MUTATIONS) {
    const occurrences = source.split(mut.from).length - 1;
    if (occurrences !== 1) {
      console.error(`MUTATION ${mut.name}: pattern occurs ${occurrences} times, expected exactly 1`);
      failures++;
      continue;
    }
    const file = join(dir, `core-${mutationsIndex(mut)}.js`);
    writeFileSync(file, source.replace(mut.from, mut.to));
    const mutated = await import(pathToFileURL(file).href);
    let caught = false;
    let why = '';
    try {
      const {violations} = auditModule(mutated, league, book);
      if (violations.length) {
        caught = true;
        why = `${violations.length} violations, first [${violations[0].check}] ${violations[0].detail}`;
      } else {
        try { auditKickoffSampler(mutated, league, book); }
        catch (err) { caught = true; why = `sampler assertion: ${err.message}`; }
      }
    } catch (err) {
      caught = true;
      why = `threw: ${err.message}`;
    }
    if (caught) console.log(`caught  ${mut.name} -> ${why}`);
    else { console.error(`SURVIVED ${mut.name}`); failures++; }
  }
} finally {
  rmSync(dir, {recursive:true, force:true});
}

function mutationsIndex(mut) {
  return MUTATIONS.indexOf(mut);
}

if (failures) {
  console.error(`\n${failures} mutation(s) survived: the audit does not prove that fix.`);
  process.exit(1);
}
console.log(`\nPASS all ${MUTATIONS.length} mutations were caught by the audit`);
