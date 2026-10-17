import {simulatePlay} from '../engine/play.js';
import {Renderer} from './render.js';
import {LOOKS,generate} from '../engine/what-if.js';
const $=s=>document.querySelector(s);
const game=await(await fetch('web/data/game.json')).json();
await document.fonts.ready;
const R=new Renderer($('#view'),game,{displayFont:'"Saira Condensed",sans-serif'});
new ResizeObserver(()=>R.resize()).observe($('#view'));R.resize();R.setCamera('all22');
const st={look:'zone',rec:null,out:null,t:0,playing:false,speed:1,last:0,busy:false};
const end=()=>st.rec?st.rec.t0+(st.rec.frames.length-1)/st.rec.hz:0;
function probabilities(){
 $('#probability-rows').innerHTML='';
 $('#model-look').textContent=LOOKS[st.look].label.toUpperCase();
 for(const [key,p] of Object.entries(LOOKS[st.look])){
 if(key==='label')continue;
 const row=document.createElement('div');row.className='prob';
 const label=document.createElement('div');label.className='prob-labels';
 const name=document.createElement('span');name.textContent=({complete:'Completion',incomplete:'Incompletion',sack:'Sack',int:'Interception'})[key];
 const pct=document.createElement('b');pct.textContent=Math.round(p*100)+'%';label.append(name,pct);
 const track=document.createElement('div');track.className='bar-track';const bar=document.createElement('i');bar.style.width=(p*100)+'%';track.append(bar);row.append(label,track);$('#probability-rows').append(row);
 }
 document.querySelectorAll('[data-defense]').forEach(b=>{b.classList.toggle('active',b.dataset.defense===st.look);b.setAttribute('aria-pressed',String(b.dataset.defense===st.look));});
}
function updateControls(){
 $('#pause').textContent=st.playing?'❚❚':'▶';$('#time').textContent=Math.max(0,st.t).toFixed(1)+'s';
 $('#scrub').value=st.rec?Math.round(1000*(st.t-st.rec.t0)/(end()-st.rec.t0)):0;
}
async function run(){
 if(st.busy)return;
 const seed=Number($('#seed').value);
 if(!Number.isSafeInteger(seed)||seed<0){$('#result-summary').textContent='Enter a valid nonnegative integer seed';return}
 st.busy=true;$('#run').disabled=true;$('#another').disabled=true;$('#phase').textContent='SIMULATING PHYSICS';
 try{
 const out=generate(game,st.look,seed);
 await new Promise(resolve=>requestAnimationFrame(resolve));
 const rec=simulatePlay(game,out.play,{ballY:53.333/2});
 if(!rec?.frames?.length)throw Error('Physics engine returned no frames');
 st.out=out;st.rec=rec;st.t=rec.t0;st.playing=true;
 R.setRoster(rec.roster);R.setLines(out.play.los,out.play.los+out.play.dir*3);R.clearTrail();R.draw(rec,st.t,0);
 const g=out.result;
 $('#sample-kind').textContent=g.kind.toUpperCase();
 $('#result-number').textContent=['complete','sack'].includes(g.kind)?(g.gain>0?'+':'')+g.gain+' YDS':g.kind==='int'?'TURNOVER':'0 YDS';
 $('#result-number').classList.toggle('negative',['int','sack'].includes(g.kind));
 $('#result-summary').textContent=({complete:'Quick slant caught. '+(g.converted?'First down!':'Short of the marker.'),incomplete:'Pass falls incomplete. Fourth down.',sack:'Quarterback sacked. Fourth down.',int:'Pass intercepted. Change of possession.'})[g.kind];
 $('#result-details').textContent='Illustrative outcome probability: '+Math.round(g.probability*100)+'% · Seed '+seed;
 $('#field-caption').textContent='Q4 · 3rd & 3 · Slant vs '+LOOKS[st.look].label;
 $('#phase').textContent='22-PLAYER PHYSICS REPLAY';
 const events=$('#events');events.replaceChildren();
 for(const e of rec.events.filter(x=>['snap','throw','catch','tackle','interception','incomplete','drop','pass_breakup'].includes(x.type)).slice(0,14)){
 const b=document.createElement('button');b.textContent=e.type.toUpperCase().replaceAll('_',' ')+' · '+Math.max(0,e.t).toFixed(2)+'s';
 b.onclick=()=>{st.t=Math.max(st.rec.t0,Math.min(end(),e.t));st.playing=false;updateControls()};events.append(b)
 }
 }catch(e){$('#phase').textContent='SIMULATION ERROR';$('#result-summary').textContent=String(e.message||e);console.error(e)}
 finally{st.busy=false;$('#run').disabled=false;$('#another').disabled=false;updateControls()}
}
document.querySelectorAll('[data-defense]').forEach(b=>b.onclick=()=>{st.look=b.dataset.defense;probabilities();run()});
$('#run').onclick=run;
$('#another').onclick=()=>{$('#seed').value=String(Number($('#seed').value||0)+1);run()};
$('#pause').onclick=()=>{if(!st.rec)return;if(st.t>=end())st.t=st.rec.t0;st.playing=!st.playing;updateControls()};
$('#restart').onclick=()=>{if(!st.rec)return;st.t=st.rec.t0;st.playing=true;R.clearTrail();updateControls()};
$('#scrub').oninput=e=>{if(!st.rec)return;st.t=st.rec.t0+(end()-st.rec.t0)*Number(e.target.value)/1000;st.playing=false;R.clearTrail()};
$('#speed').onchange=e=>st.speed=Number(e.target.value);
document.querySelectorAll('[data-cam]').forEach(b=>b.onclick=()=>{R.setCamera(b.dataset.cam);document.querySelectorAll('[data-cam]').forEach(c=>c.classList.toggle('selected',c===b))});
function loop(now){const dt=st.last?Math.min(.08,(now-st.last)/1000):0;st.last=now;
 if(st.rec){if(st.playing){st.t=Math.min(end(),st.t+dt*st.speed);if(st.t>=end())st.playing=false}R.draw(st.rec,st.t,dt);R.updateCamera(dt,{dir:st.out.play.dir});updateControls()}R.render();requestAnimationFrame(loop)}
probabilities();requestAnimationFrame(loop);await run();
