import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// Measures physics pose transitions against *actual* mixer action activations.
// Standalone on research branch; does not require building a new football mesh.
const url = (process.env.BASE_URL || 'http://127.0.0.1:8137')
  + '/week7.html?game=2026_07_CIN_BAL&debug=1';
const browser = await chromium.launch({ headless:true,
  args:['--use-gl=angle','--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist']
});
const page = await browser.newPage({viewport:{width:1366,height:900}});
try{
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelector('#status')?.textContent?.includes('Ready ·')
    && window.__gridironRenderer?.riggedGltf,{},{timeout:100000});
  const buttons=await page.locator('#timeline button.pl:not(.admin)').all();
  let chosen=null;
  for(const btn of buttons){
    if(/PASS COMPLETE/i.test(await btn.innerText())){
      chosen=await btn.innerText();
      await btn.click();
      break;
    }
  }
  assert.ok(chosen,'cannot find completed pass in seed 1042');
  assert.match(await page.locator('#replay-type').innerText(),/22-player 3D/);
  await page.evaluate(()=>{
    window.__poseAudit=[];
    window.__poseAuditInterval=setInterval(()=>{
      const s=window.__gridironFrameSnapshot?.();
      if(s?.players?.length)window.__poseAudit.push(s);
    },22);
  });
  // Clicking the timeline starts the new play. Let the full clip finish.
  await page.waitForTimeout(6800);
  const probe=await page.evaluate(()=>{
    clearInterval(window.__poseAuditInterval);
    return window.__poseAudit;
  });
  const samples={};
  for(const state of ['THROW','CATCH','RUN','STANCE','BACKPEDAL']){
    const code={THROW:4,CATCH:5,RUN:1,STANCE:0,BACKPEDAL:9}[state];
    const samplesWithPose=probe.flatMap(x=>x.players.filter(p=>p.pose===code));
    const active=Object.fromEntries(samplesWithPose.reduce((m,p)=>m.set(p.clip,(m.get(p.clip)||0)+1),new Map()));
    samples[state]={physicsSamples:samplesWithPose.length,activeClips:active,
      expectedClipSamples:samplesWithPose.filter(p=>p.clip===({THROW:'Quarterback Pass',CATCH:'Football Catch 1',
        RUN:'Running in place',
        STANCE:'Football Stance',BACKPEDAL:'Running Backward in place'}[state])).length};
  }
  // RUN calculated with carry policy dynamically instead of hardcoding.
  samples.RUN.expectedClipSamples=probe.flatMap(x=>x.players.filter(p=>p.pose===1))
    .filter(p=>p.clip===(p.carrying?'Running While Holding Something':'Running in place')).length;
  console.log('PASS_PLAY_POSE_AUDIT',JSON.stringify({chosen,samples,probeCount:probe.length,first:probe[0]?.time,last:probe.at(-1)?.time,meta:await page.evaluate(()=>window.__gridironRecordMeta?.())}));
  assert.ok(probe.length>150,'live browser pose sampler must cover multiple seconds');
  assert.ok(samples.THROW.physicsSamples>0,'QB physics never emitted THROW in completed pass');
  assert.ok(samples.CATCH.physicsSamples>0,'receiver physics never emitted CATCH in completed pass');
  assert.ok(samples.THROW.expectedClipSamples>0,'QB had THROW pose but never activated Quarterback Pass clip');
  assert.ok(samples.CATCH.expectedClipSamples>0,'receiver had CATCH pose but never activated Football Catch 1 clip');

  // Ensure animated skeletons freeze while the replay is paused.
  if(await page.locator('#play').getAttribute('aria-label')==='Pause')await page.locator('#play').click();
  const before=await page.evaluate(()=>window.__gridironFrameSnapshot?.());
  await page.waitForTimeout(330);
  const after=await page.evaluate(()=>window.__gridironFrameSnapshot?.());
  assert.equal(after.time,before.time,'game time moved while paused');
  const clipTime = new Map(before.players.map(p=>[p.id,p.clipTime]));
  const progressed = after.players.filter(p=>p.clipTime!=null && clipTime.get(p.id)!=null && Math.abs(p.clipTime-clipTime.get(p.id))>1e-5);
  assert.equal(progressed.length,0,'rigged clip animation advanced while paused: '+JSON.stringify(progressed.slice(0,4)));
  console.log('PASS rigged pose transitions and paused mixer freeze');
}finally{await browser.close();}
