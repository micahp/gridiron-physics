import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { MATCHUPS } from '../web/week7-core.js';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8080';
const browser = await chromium.launch({ headless: true,
  args:['--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist']
});
const page = await browser.newPage({viewport:{width:1280,height:880}});
const errors = [];
page.on('pageerror', err => errors.push(String(err)));
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
try {
  // The static toggle is visible before async matchup data finishes loading.
  // Delay those requests and click during the loading state to prove the user
  // gesture is not silently lost before the app wires up its listeners.
  await page.route('**/data/**', async route => {
    await new Promise(resolve => setTimeout(resolve, 1200));
    await route.continue();
  });
  await page.goto(BASE+'/week7.html?game='+encodeURIComponent(MATCHUPS[0].id), {waitUntil:'domcontentloaded'});
  await page.waitForFunction(() => (document.querySelector('#status')?.textContent||'').includes('Loading matchup data'), null, {timeout:10000});
  const audioToggle = page.locator('#audio-toggle');
  assert.equal(await audioToggle.getAttribute('aria-pressed'), 'false',
    'No autoplay: sound must be off before user clicks');
  await audioToggle.click();
  await page.waitForFunction(() => (document.querySelector('#audio-toggle')?.textContent||'').includes('Sound on'), null, {timeout:10000});
  await page.waitForFunction(() => (document.querySelector('#status')?.textContent||'').includes('Ready ·'), null, {timeout:100000});
  assert.equal(await audioToggle.getAttribute('aria-pressed'), 'true',
    'an early user click during loading must enable audio');
  // Verify the source-pinned real files are actually being served.
  for(const path of ['stadium-bed','crowd-big-cheer','crowd-cheer','pads-1','cleat-1','whistle']){
    const response = await page.request.get(BASE+'/web/audio/'+path+'.ogg');
    assert.equal(response.status(),200, path+' missing from generated audio pack');
    assert.ok(Number(response.headers()['content-length']||0)>1000,path+' is empty');
  }
  await page.locator('#audio-volume').fill('20');
  assert.equal(await page.locator('#audio-volume').inputValue(),'20');
  await page.locator('#play').click();
  await page.waitForTimeout(1200);
  await page.locator('#play').click();
  await page.locator('#audio-toggle').click();
  assert.equal(await page.locator('#audio-toggle').getAttribute('aria-pressed'), 'false');
  assert.equal(errors.length,0,'Browser errors: '+errors.join('; '));
  console.log('PASS user-unlocked licensed stadium audio, play/pause, volume, mute, no page errors');

  // Regression: markup that predates the audio controls (a cached page, or an
  // older build) must still render the game. Wiring the audio controls happens
  // before start(), so an unguarded null there used to abort startup and leave
  // the app stuck on "Loading matchup data…" with no drives, plays, or box score.
  const stale = (await (await page.request.get(BASE+'/week7.html')).text())
    .replace(/<button type="button" id="audio-toggle"[^>]*>[^<]*<\/button>\s*/s, '')
    .replace(/<label class="auto" for="audio-volume">[\s\S]*?<\/label>\s*/, '');
  assert.ok(!/id="audio-toggle"/.test(stale), 'test fixture must not contain the audio toggle');
  const stalePage = await browser.newPage({viewport:{width:1280,height:880}});
  const staleErrors = [];
  stalePage.on('pageerror', err => staleErrors.push(String(err)));
  try {
    await stalePage.route('**/week7.html*', route => route.fulfill({status:200,contentType:'text/html',body:stale}));
    await stalePage.goto(BASE+'/week7.html?game='+encodeURIComponent(MATCHUPS[0].id), {waitUntil:'domcontentloaded'});
    await stalePage.waitForFunction(() => (document.querySelector('#status')?.textContent||'').includes('Ready ·'), null, {timeout:100000});
    const detail = await stalePage.locator('#play-detail').innerText();
    assert.ok(detail.trim().length>40, 'play detail must render without the audio controls');
    assert.equal(staleErrors.length,0,'page errors without audio markup: '+staleErrors.join('; '));
    console.log('PASS game renders without audio controls (no startup abort)');
  } finally {
    await stalePage.close();
  }
} finally {
  await browser.close();
}
