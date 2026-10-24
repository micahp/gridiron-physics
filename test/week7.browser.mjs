import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { MATCHUPS } from '../web/week7-core.js';

// Run against a static server serving the repo root, e.g.
//   BASE_URL=http://127.0.0.1:8137 node --test test/week7.browser.mjs
// or `npm run test:ui`. Requires the generated 12-team assets (data/playbooks,
// data/teams/week7-six-2026-10-24.json, data/special_teams/2025-league.json).
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8080';
const browser=await chromium.launch({
  headless:true,
  args:['--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist'],
});
const errors=[];
const page=await browser.newPage({viewport:{width:1280,height:880}});
page.on('pageerror',e=>errors.push(String(e)));
page.on('console',m=>{if(m.type()==='error')errors.push('console: '+m.text());});
const rendered=[];
try{
  for(const game of MATCHUPS){
    await page.goto(BASE+'/week7.html?game='+encodeURIComponent(game.id),{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>{
      const s=document.querySelector('#status')?.textContent||'';
      return s.includes('Ready ·')||s.includes('Assets not ready:')||s.includes('Simulation failed:');
    },null,{timeout:100000});
    const status=await page.locator('#status').innerText();
    assert.match(status,/Ready ·/,'matchup '+game.id+' did not initialize: '+status);
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
    rendered.push({game:game.id,events:n,first:event});
  }
  await page.locator('#again').click();
  assert.equal(await page.locator('#seed').inputValue(),'1043');
  assert.equal(errors.length,0,'browser errors: '+errors.join('; '));
  console.log('PASS full 3D render on six 2026 matchups: '+JSON.stringify(rendered));
}finally{await browser.close();}
