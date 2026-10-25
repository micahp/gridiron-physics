import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { MATCHUPS } from '../web/week7-core.js';

// Run against a static server serving the repo root, e.g.
//   BASE_URL=http://127.0.0.1:8137 node --test test/week7.browser.mjs
// or `npm run test:ui`. Requires the generated 12-team assets (data/playbooks,
// data/teams/week7-six-2026-10-24.json, data/special_teams/2025-league.json).
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8080';
const roster = JSON.parse(readFileSync(new URL('../data/teams/week7-six-2026-10-24.json', import.meta.url)));
// Seeds verified to complete with no refusal. Re-survey if the generator changes.
const PLAYABLE_SEEDS = {
  '2026_07_CIN_BAL':'1042', '2026_07_MIA_NYJ':'1', '2026_07_SF_ATL':'1042',
  '2026_07_TB_CAR':'1042', '2026_07_GB_DET':'1042', '2026_07_DAL_PHI':'1042',
};
const browser=await chromium.launch({
  headless:true,
  args:['--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist'],
});
const errors=[];
const page=await browser.newPage({viewport:{width:1280,height:880}});
page.on('pageerror',e=>errors.push(String(e)));
page.on('console',m=>{if(m.type()==='error')errors.push('console: '+m.text());});
const waitForStatus=()=>page.waitForFunction(()=>{
  const s=document.querySelector('#status')?.textContent||'';
  return s.includes('Ready ·')||s.includes('Simulation stopped:')||s.includes('Assets not ready:')||s.includes('Simulation failed:');
},null,{timeout:100000,polling:250});
const safety=[];
const rendered=[];
try{
  // Safety: each matchup on its default seed either initializes or stops with an explicit reason.
  for(const game of MATCHUPS){
    await page.goto(BASE+'/week7.html?game='+encodeURIComponent(game.id),{waitUntil:'domcontentloaded'});
    await waitForStatus();
    const status=await page.locator('#status').innerText();
    const refused=/Simulation stopped: unsupported rule \(/.test(status);
    assert.ok(refused||/Ready ·/.test(status),'matchup '+game.id+' did not initialize: '+status);
    if(refused){
      assert.match(status,/Simulation stopped: unsupported rule \([a-z_]+\)\. .+/,game.id+' refusal must state a reason: '+status);
      assert.match(status,/no final result/,game.id+' refusal must not present a final result');
      assert.equal(await page.locator('#timeline button[data-index]', {hasText:'REFUSED'}).count(),1,game.id+' refusal event is listed once');
    }
    safety.push({game:game.id,default:refused?'refused':'ready'});
  }

  // Playable: each matchup on its pinned seed must complete and render a real 22-player play.
  for(const game of MATCHUPS){
    const seed=PLAYABLE_SEEDS[game.id];
    await page.goto(BASE+'/week7.html?game='+encodeURIComponent(game.id),{waitUntil:'domcontentloaded'});
    await waitForStatus();
    await page.fill('#seed',seed);
    await page.click('#simulate');
    const status=await page.locator('#status').innerText();
    assert.match(status,/Ready ·/,game.id+' pinned seed '+seed+' must complete without refusal: '+status);
    const n=await page.locator('#timeline button[data-index]').count();
    assert.ok(n>40,'not enough generated events for '+game.id+': '+n);
    // The game opens with a kickoff, which is text-only (no 3D), so select the
    // first scrimmage play to exercise the physical 22-player animation.
    await page.locator('#timeline button[data-index="0"]').click();
    assert.match(await page.locator('#replay-type').innerText(),/Text-only event/,game.id+' opening kickoff should be text-only');
    // The kickoff is a special-teams event and must show both teams.
    const koText=await page.locator('#play-detail').innerText();
    assert.match(koText,/→/,game.id+' kickoff detail should name the kicking and receiving teams: '+koText);
    assert.match(koText,/touchback|return|out of bounds/i,game.id+' kickoff detail should name the outcome: '+koText);
    await page.locator('#timeline button.pl:not(.admin)').first().click();
    const event=await page.locator('#replay-type').innerText();
    assert.match(event,/22-player 3D/,game.id+' physical animation unavailable: '+await page.locator('#play-detail').innerText());
    const playText=await page.locator('#play-detail').innerText();
    const timelineText=await page.locator('#timeline .pl.on').innerText();
    const activeNames=[...roster.teams[game.home].roster,...roster.teams[game.away].roster]
      .filter(p=>p.status==='ACT'&&p.availability==='available').map(p=>p.name);
    assert.ok(activeNames.some(name=>playText.includes(name)),
      game.id+' selected 3D play has no named 2026 participant');
    assert.ok(activeNames.some(name=>timelineText.includes(name)),
      game.id+' timeline row lacks matching player attribution');
    assert.match(playText,/Illustrative 2026 roster assignment/,
      game.id+' missing historical-credit disclaimer');
    rendered.push({game:game.id,seed,events:n,first:event});
  }
  await page.locator('#again').click();
  const lastSeed=PLAYABLE_SEEDS[MATCHUPS.at(-1).id];
  assert.equal(await page.locator('#seed').inputValue(),String(Number(lastSeed)+1));
  assert.equal(errors.length,0,'browser errors: '+errors.join('; '));
  console.log('PASS safety: default seeds initialize or refuse with a reason: '+JSON.stringify(safety));
  console.log('PASS playable: pinned seeds render 22-player 3D plays: '+JSON.stringify(rendered));

// Forced refusal: every punt is a blocked kicking-team recovery, which the
// generator refuses rather than resolving. Verifies the viewer reports the stop.
{
  const forced = JSON.parse(readFileSync(new URL('../data/special_teams/2025-league.json', import.meta.url), 'utf8'));
  forced.punts = {...forced.punts, outcomes:{blocked:1}, distance_yards:{'0':1,'40':1},
    blocked_resolution_pooled:{receiving_recovery:0, kicking_recovery:1, out_of_bounds:0, safety:0}};
  const refusalErrors = [];
  const rpage = await browser.newPage({viewport:{width:1280,height:880}});
  rpage.on('pageerror',e=>refusalErrors.push(String(e)));
  rpage.on('console',m=>{if(m.type()==='error')refusalErrors.push('console: '+m.text());});
  await rpage.route('**/data/special_teams/2025-league.json', route=>route.fulfill({
    contentType:'application/json', body:JSON.stringify(forced)}));
  const game = MATCHUPS[0];
  await rpage.goto(BASE+'/week7.html?game='+encodeURIComponent(game.id),{waitUntil:'domcontentloaded'});
  await rpage.waitForFunction(()=>(document.querySelector('#status')?.textContent||'').match(/Simulation stopped|Ready ·|failed|not ready/),null,{timeout:100000});
  const st = await rpage.locator('#status').innerText();
  assert.match(st,/Simulation stopped: unsupported rule \(blocked_punt_kicking_recovery\)/,'refusal status: '+st);
  assert.match(st,/no final result/,'refusal must not present a final result');
  const refused = rpage.locator('#timeline button[data-index]', {hasText:'REFUSED'});
  assert.equal(await refused.count(), 1, 'refusal event is listed once in the timeline');
  await refused.first().click();
  assert.match(await rpage.locator('#play-detail').innerText(), /Blocked punt|line of scrimmage|Rule 2-3-1/i,'refusal reason shown');
  assert.equal(refusalErrors.length, 0, 'refusal browser errors: '+refusalErrors.join('; '));
  // Recover: remove the forced table and switch to a normal game.
  await rpage.unroute('**/data/special_teams/2025-league.json');
  await rpage.goto(BASE+'/week7.html?game='+encodeURIComponent(MATCHUPS[1].id),{waitUntil:'domcontentloaded'});
  await rpage.waitForFunction(()=>(document.querySelector('#status')?.textContent||'').match(/Ready ·|Simulation stopped|failed|not ready/),null,{timeout:100000});
  const recovered = await rpage.locator('#status').innerText();
  assert.doesNotMatch(recovered,/blocked_punt_kicking_recovery/,'forced refusal is gone after recovery');
  assert.match(recovered,/Ready ·|Simulation stopped: unsupported rule \(/,'viewer recovers after a refused game: '+recovered);
  await rpage.close();
  console.log('PASS refusal display: stop status, refused event, reason, and recovery');
}
}finally{await browser.close();}
