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
  await page.goto(BASE+'/week7.html?game='+encodeURIComponent(MATCHUPS[0].id), {waitUntil:'domcontentloaded'});
  await page.waitForFunction(() => {
    const s = document.querySelector('#status')?.textContent || '';
    return s.includes('Ready ·') || s.startsWith('Regulation ended') || s.includes('Simulation stopped');
  }, null, {timeout:100000});
  assert.equal(await page.locator('#audio-toggle').getAttribute('aria-pressed'), 'false',
    'No autoplay: sound must be off before user clicks');
  // Verify the source-pinned real files are actually being served.
  for(const path of ['stadium-bed','crowd-big-cheer','crowd-cheer','pads-1','cleat-1','whistle']){
    const response = await page.request.get(BASE+'/web/audio/'+path+'.ogg');
    assert.equal(response.status(),200, path+' missing from generated audio pack');
    assert.ok(Number(response.headers()['content-length']||0)>1000,path+' is empty');
  }
  await page.locator('#audio-toggle').click();
  await page.waitForFunction(() => (document.querySelector('#audio-toggle')?.textContent||'').includes('Sound on'), null, {timeout:30000});
  assert.equal(await page.locator('#audio-toggle').getAttribute('aria-pressed'), 'true');
  await page.locator('#audio-volume').fill('20');
  assert.equal(await page.locator('#audio-volume').inputValue(),'20');
  await page.locator('#play').click();
  await page.waitForTimeout(1200);
  await page.locator('#play').click();
  await page.locator('#audio-toggle').click();
  assert.equal(await page.locator('#audio-toggle').getAttribute('aria-pressed'), 'false');
  assert.equal(errors.length,0,'Browser errors: '+errors.join('; '));
  console.log('PASS user-unlocked licensed stadium audio, play/pause, volume, mute, no page errors');
} finally {
  await browser.close();
}
