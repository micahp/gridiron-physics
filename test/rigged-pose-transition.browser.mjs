import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// Seek to the actual engine's throw/catch event timestamps. Under software
// rendering 6s of wall-clock time may advance less than 1s of game time;
// wall-clock playback sampling is NOT a valid pose-activation gate.
const base = process.env.BASE_URL || 'http://127.0.0.1:8137';
const browser = await chromium.launch({headless:true,
  args:['--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
const page = await browser.newPage({viewport:{width:1280,height:880}});
const failures=[];
page.on('pageerror',e=>failures.push(String(e)));

async function seek(seconds, meta) {
  const units=Math.max(0,Math.min(1000,Math.round(seconds/meta.duration*1000)));
  await page.locator('#scrub').evaluate((element, value) => {
    element.value=String(value);
    element.dispatchEvent(new Event('input',{bubbles:true}));
  },units);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
  return await page.evaluate(()=>window.__gridironFrameSnapshot?.());
}

try {
  await page.goto(base+'/week7.html?game=2026_07_CIN_BAL&debug=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelector('#status')?.textContent?.includes('Ready ·')
    && window.__gridironRenderer?.riggedGltf,null,{timeout:100000});
  const buttons=await page.locator('#timeline button.pl:not(.admin)').all();
  let chosen;
  for(const button of buttons) {
    const label=await button.innerText();
    if(/PASS COMPLETE/i.test(label)) {chosen=label;await button.click();break;}
  }
  assert.ok(chosen,'no completed pass found in seed-1042 BAL/CIN game');
  assert.match(await page.locator('#replay-type').innerText(),/22-player 3D/);
  // Clicking timeline starts the play. Pause before seeking.
  if(await page.locator('#play').getAttribute('aria-label')==='Pause')await page.locator('#play').click();
  const meta=await page.evaluate(()=>window.__gridironRecordMeta?.());
  const eThrow=meta.events.find(e=>e.type==='throw');
  const eCatch=meta.events.find(e=>e.type==='catch');
  assert.ok(eThrow,'physics must contain real quarterback throw event');
  assert.ok(eCatch,'physics must contain real receiver catch event');
  assert.ok(meta.throwSpeed>0,'physical throw must carry positive ball speed');
  const inspect=[];
  for(const [label,ev,poseCode,clipName] of [
    ['THROW',eThrow,4,'Quarterback Pass'],['CATCH',eCatch,5,'Football Catch 1'],
  ]) {
    const snapshots=[];
    for(const shift of [-0.20,-0.10,0,0.05,0.10,0.20,0.35]) {
      const frame=await seek(ev.t-meta.t0+shift,meta);
      const player=frame?.players.find(p=>p.id===ev.by);
      snapshots.push({time:frame?.time,offset:shift,index:frame?.index,
        physicsPose:player?.pose,activatedClip:player?.clip,clipTime:player?.clipTime});
    }
    const physics=snapshots.filter(z=>z.physicsPose===poseCode);
    const activated=physics.filter(z=>z.activatedClip===clipName);
    inspect.push({label,actor:ev.by,physicsFrames:physics.length,correctActivations:activated.length,snapshots});
  }
  console.log('PRECISE_EVENT_ANIMATION_AUDIT',JSON.stringify({chosen,meta,inspect}));
  assert.ok(inspect[0].physicsFrames>0,'QB THROW event never produced recorded THROW pose');
  assert.ok(inspect[1].physicsFrames>0,'receiver CATCH event never produced recorded CATCH pose');
  assert.ok(inspect[0].correctActivations>0,'THROW pose did not select Quarterback Pass clip');
  assert.ok(inspect[1].correctActivations>0,'CATCH pose did not select Football Catch 1 clip');

  const before=await page.evaluate(()=>window.__gridironFrameSnapshot?.());
  await page.waitForTimeout(350);
  const after=await page.evaluate(()=>window.__gridironFrameSnapshot?.());
  assert.equal(after.time,before.time,'replay time advanced while paused');
  assert.ok(before.players.every((p,i)=>p.clipTime===after.players[i].clipTime),
    'rigged AnimationMixer continued to advance while replay was paused');
  assert.ok(!failures.length,'browser errors: '+failures.join('; '));
  console.log('PASS precise event-to-bone-action binding and paused mixer time');
} finally {await browser.close();}
