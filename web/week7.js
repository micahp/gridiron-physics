import { Renderer } from './render.js';
import { selectPlay } from './prototype-model.js';
import { executeSelectedPlay } from './prototype-execution.js';
import { MATCHUPS, generateGame } from './week7-core.js';

const $ = id => document.getElementById(id);
const esc = x => String(x ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const colors = {
  CIN:['#fb4f14','#111111','Bengals'],BAL:['#241773','#9e7c0c','Ravens'],
  MIA:['#008e97','#fc4c02','Dolphins'],NYJ:['#125740','#ffffff','Jets'],
  SF:['#aa0000','#b3995d','49ers'],ATL:['#a71930','#000000','Falcons'],
  TB:['#d50a0a','#34302b','Buccaneers'],CAR:['#0085ca','#101820','Panthers'],
  GB:['#203731','#ffb612','Packers'],DET:['#0076b6','#b0b7bc','Lions'],
  DAL:['#041e42','#869397','Cowboys'],PHI:['#004c54','#a5acaf','Eagles'],
};
const teamStyle = id => { const [color,alt,short] = colors[id] || ['#33485b','#dbe9f2',id];return {color,alt,short,name:short}; };
const matchQuery = new URLSearchParams(location.search).get('game');
const match = MATCHUPS.find(m=>m.id===matchQuery) || MATCHUPS[0];
$('matchup').innerHTML = MATCHUPS.map(m=>'<option value="'+esc(m.id)+'">'+esc(m.away+' @ '+m.home+' · '+m.day)+'</option>').join('');
$('matchup').value = match.id;
$('away-name').textContent = match.away;
$('home-name').textContent = match.home;

let snapshot, books, physicsGame, renderer, simulation, selected = 0, current = null, currentSelection = null;
let animating = false, lastTick = null, playSeconds = 0;

function status(message, failure=false){$('status').textContent=message; $('status').style.color=failure?'#ffc3b8':'#c9eaff';}
function clock(v){return Math.floor(v/60)+':'+String(Math.floor(v%60)).padStart(2,'0');}
function safe(v){return Number.isFinite(Number(v))?Number(v):0;}
function playersMap(a,b) {
  return Object.fromEntries([...(a?.roster||[]), ...(b?.roster||[])].map(p=>[p.id,{...p,team:p.team_id,pos:p.rating_position,group:p.rating_group}]));
}
function makeViewer(){
  const home=snapshot.teams[match.home],away=snapshot.teams[match.away];
  if(!home || !away)throw new Error('one or both 2026 team rosters are missing');
  physicsGame = {home:match.home,away:match.away,
    teams:{[match.home]:teamStyle(match.home),[match.away]:teamStyle(match.away)},
    players:playersMap(home,away)};
  renderer = new Renderer($('field'),physicsGame,{displayFont:'Arial, sans-serif'});
  renderer.setCamera('all22');renderer.resize();
  window.addEventListener('resize',()=>renderer.resize());
  $('field').addEventListener('click',e=>{const id=renderer.pick(e.clientX,e.clientY);if(id)inspectPlayer(id);});
}
function inspectPlayer(id){
  const p=physicsGame.players[id]; if(!p)return;
  renderer.select(id);
  $('player-detail').innerHTML='<b>'+esc(p.name)+'</b> · '+esc(p.team)+' · '+esc(p.pos)+'<div>OVR estimate: '+esc(p.overall_estimate ?? 'not rated')+'</div>'+
    '<div>'+Object.entries(p.ratings||{}).map(([k,v])=>esc(k)+' '+esc(v)).join(' · ')+'</div>'+
    '<div class="tiny">Estimated public-research ratings, not EA-licensed player grades.</div>';
}
function drawPlayerList(demo) {
  const slots = [...Object.entries(demo.lineups.offense).map(([slot,id])=>({side:demo.play.off,slot,id})),
    ...Object.entries(demo.lineups.defense).map(([slot,id])=>({side:demo.play.def,slot,id}))];
  $('players').innerHTML=slots.map(x=>{const p=physicsGame.players[x.id];return '<button data-player="'+esc(x.id)+'">'+
    esc(x.slot)+' · '+esc(p?.name||'Unknown')+'<br><span class="tiny">'+esc(x.side)+' · '+esc(p?.overall_estimate??'—')+'</span></button>';}).join('');
  for(const b of $('players').querySelectorAll('[data-player]'))b.addEventListener('click',()=>inspectPlayer(b.dataset.player));
}
function showPlaybook(p,demo){
  const team=books[p.offense], prof=team.offense.profile, c=demo?.selection?.playbook_entry || p.candidate;
  const kind=p.kind, cat=prof.run_pass?.categories?.[kind], in2026=team.pregame_2026_comparison;
  $('playbook-head').textContent=p.offense+' offensive profile';
  $('playbook-detail').innerHTML=
    '<div class="kv"><span>2025 charted plays</span><strong>'+esc(prof.eligible_scrimmage_plays)+'</strong></div>'+
    '<div class="kv"><span>Historical '+esc(kind)+' share</span><strong>'+esc(cat?.rate == null?'—':(cat.rate*100).toFixed(1)+'%')+'</strong></div>'+
    '<div class="kv"><span>Formation reference</span><strong>'+esc(p.formation||'Not charted')+'</strong></div>'+
    '<div class="kv"><span>Candidate frequency</span><strong>'+esc(c?(c.count+'/'+c.denominator):'—')+'</strong></div>'+
    '<p class="tiny">2026 Weeks 1–6 descriptive plays: '+esc(in2026?.eligible_plays??'not available')+
    '. The call is inferred from 2025 charted attributes, not an observed 2026 coach call.</p>'+
    '<p class="tiny">2025 offense sample: '+esc(p.source_id?.game_id??'—')+' / '+esc(p.source_id?.play_id??'—')+
    '<br>2025 defense sample: '+esc(p.defense_source_id?.game_id??'—')+' / '+esc(p.defense_source_id?.play_id??'—')+'</p>';
}
function renderTimeline(){
  $('timeline-head').textContent = simulation.plays.length+' events · '+simulation.drives.length+' drives';
  let last=0;
  $('timeline').innerHTML=simulation.plays.map((p,i)=>{
    let header='';
    if(p.drive!==last){last=p.drive;header='<div class="drive-label">Drive '+p.drive+' · '+esc(p.offense)+'</div>';}
    return header+'<button data-index="'+i+'" class="'+(i===selected?'active':'')+'"><span>Q'+p.quarter+' '+clock(p.clock)+' · '+esc(p.action)+'</span>'+
      '<span class="tiny">'+(p.type==='scrimmage'?esc(p.gain)+' yd':p.type==='field_goal'?'KICK':'EVENT')+'</span></button>';
  }).join('');
  $('timeline').querySelectorAll('button[data-index]').forEach(b=>b.addEventListener('click',()=>choose(Number(b.dataset.index))));
}
function scoreAtPlay(p) {
  const score=p.scoreAfter || p.score || simulation.score;
  $('away-score').textContent=score[match.away]??0;
  $('home-score').textContent=score[match.home]??0;
  $('game-clock').textContent='Q'+p.quarter+' · '+clock(p.clock);
  $('down-distance').textContent=p.down+' & '+p.togo+' · '+(p.yl===50?'MIDFIELD':p.yl+' YDS TO GOAL');
  $('possession').textContent=p.offense+' ball · Drive '+p.drive;
}
function makeSelected(p){
  // Adapter uses current 2026 roster, real 2025 playbook catalog, and LP-like chosen outcome.
  const input={schema_version:'gridiron.play_selection.v1',
    teams:{[match.home]:snapshot.teams[match.home],[match.away]:snapshot.teams[match.away]},
    playbooks:books,
    active_rosters:Object.fromEntries([match.home,match.away].map(id=>[
      id,snapshot.teams[id].roster.filter(x=>x.status==='ACT'&&x.availability==='available').map(x=>x.id)])),
    personnel_availability:{[match.home]:{inactive_ids:[]},[match.away]:{inactive_ids:[]}},
    game_state:{game_id:match.id,offense_team_id:p.offense,defense_team_id:p.defense,down:p.down,
      distance_yards:p.togo,yard_line:p.offense===match.home?100-p.yl:p.yl,
      score:p.score,clock_seconds:p.clock,
      timeouts:{[match.home]:3,[match.away]:3},
      field_direction:(p.offense===match.home?1:-1)*(p.quarter%2===0?-1:1)},
    demo_controls:{kind:p.kind,formation:p.formation,candidate_id:p.playbook_candidate_id},random_seed:simulation.seed+'|'+p.id};
  const demo=selectPlay(input);
  const direction=input.game_state.field_direction;
  demo.play.dir=direction;
  demo.play.los=direction===1?100-p.yl:p.yl;
  demo.play.id=p.id;
  if(p.kind==='run'){demo.play.gain=p.gain;demo.play.td=Boolean(p.touchdown);}
  else {
    demo.play.kind=p.interception?'int':p.completed?'complete':'incomplete';
    demo.play.air=Math.max(1,Math.min(30,Math.round(Math.max(0,p.gain)*0.65)||7));
    demo.play.yac=Math.max(0,p.gain-demo.play.air);
    demo.play.td=Boolean(p.touchdown);
    if(p.interception)demo.play.interceptor=demo.lineups.defense.CB1 || demo.lineups.defense.SS;
  }
  demo.execution_contract.unsupported.push('2025 sampled outcome anchors the 2026 visualization; physics does not predict the result');
  return demo;
}
function choose(idx){
  if(!simulation)return;
  selected=Math.max(0,Math.min(simulation.plays.length-1,idx));
  const p=simulation.plays[selected];
  scoreAtPlay(p); $('snap-title').textContent='Play '+p.index+' · '+p.action+' · '+p.offense;
  $('play-detail').innerHTML='<b>'+esc(p.action)+'</b> · '+(p.type==='scrimmage'?esc(p.gain)+' yards · ':'')+
    'Q'+p.quarter+' '+clock(p.clock)+' → '+clock(Math.max(0,p.clock-(p.runoff||0)))+
    '<br>'+esc(p.note||'')+(p.try?'<br>'+esc(p.try):'');
  current=null;playSeconds=0;lastTick=null;animating=false;$('scrub').value='0';
  if(p.type!=='scrimmage'){
    $('replay-type').textContent='Text-only event';
    $('players').innerHTML='<p class="tiny">No physical special-teams animation for this event.</p>';
    $('playbook-detail').textContent='Administrative/special-teams event; no observed tracking trajectory asserted.';
  }else{
    try{
      const demo=makeSelected(p);
      currentSelection=demo;
      renderer.clearTrail();
      const roster=[...Object.entries(demo.lineups.offense).map(([slot,id])=>({id,team:p.offense,slot})),
        ...Object.entries(demo.lineups.defense).map(([slot,id])=>({id,team:p.defense,slot}))];
      renderer.setRoster(roster);
      renderer.setLines(demo.play.los,demo.play.los+demo.play.dir*p.togo);
      const result=executeSelectedPlay(demo);
      if(result.failure) throw new Error(result.failure.message);
      if(!result.record?.frames?.length)throw new Error('physics returned no frames');
      current={rec:result.record,duration:(result.record.frames.length-1)/result.record.hz};
      $('replay-type').textContent='22-player 3D · constrained';
      drawPlayerList(demo);showPlaybook(p,demo);
      animating=true;
    }catch(e){
      $('replay-type').textContent='Physical animation unavailable';
      $('play-detail').innerHTML+='<p class="warn">3D unavailable for this play: '+esc(e.message)+'. The game log remains accessible.</p>';
      showPlaybook(p,null);
    }
  }
  for(const b of $('timeline').querySelectorAll('button[data-index]'))b.classList.toggle('active',Number(b.dataset.index)===selected);
  $('timeline').querySelector('button.active')?.scrollIntoView({block:'nearest'});
}
function simulate(){
  try{
    const seed=$('seed').value.trim()||'1042';
    simulation=generateGame(match,books,seed);
    selected=0;
    renderTimeline();choose(0);
    status('Ready · '+simulation.source_play_count+' hypothetical snaps · '+simulation.drives.length+
      ' drives · '+match.away+' '+simulation.score[match.away]+' / '+match.home+' '+simulation.score[match.home]+
      ' · experimental, not legally validated');
  }catch(e){status('Simulation failed: '+e.message,true);}
}
function animate(now){
  if(current&&renderer){
    if(lastTick===null)lastTick=now;
    const dt=Math.min(.06,(now-lastTick)/1000);lastTick=now;
    if(animating)playSeconds=Math.min(current.duration,playSeconds+dt*Number($('speed').value));
    renderer.draw(current.rec,current.rec.t0+playSeconds,dt);
    $('scrub').value=String(Math.round(1000*playSeconds/Math.max(.01,current.duration)));
    if(playSeconds>=current.duration)animating=false;
  }
  if(renderer){renderer.updateCamera(1/60,{dir:currentSelection?.play?.dir??1});renderer.render();}
  requestAnimationFrame(animate);
}
async function start(){
  try{
    const resp=await fetch('./data/teams/week7-six-2026-10-24.json');
    if(!resp.ok)throw new Error('missing 12-team snapshot. Run python3 pipeline/build_week7_six.py after fetching pinned source files.');
    snapshot=await resp.json();
    const ids=[match.home,match.away];
    const bs=await Promise.all(ids.map(id=>fetch('./data/playbooks/'+id+'-2025.json')));
    for(const r of bs)if(!r.ok)throw new Error('missing '+r.url+'. Build twelve 2025 team playbook profiles.');
    books=Object.fromEntries((await Promise.all(bs.map(r=>r.json()))).map((v,i)=>[ids[i],v]));
    if(!ids.every(id=>snapshot.teams?.[id]?.roster?.length&&books[id]?.offense?.observed_plays?.length))
      throw new Error('Incomplete matchup roster or observed team playbook');
    makeViewer();
    $('simulate').disabled=false;$('again').disabled=false;
    $('simulate').addEventListener('click',simulate);
    $('again').addEventListener('click',()=>{$('seed').value=String((Number($('seed').value)||1042)+1);simulate();});
    $('previous').addEventListener('click',()=>choose(selected-1));
    $('next').addEventListener('click',()=>choose(selected+1));
    $('play').addEventListener('click',()=>{playSeconds=0;lastTick=null;animating=true;});
    $('scrub').addEventListener('input',()=>{if(current){playSeconds=current.duration*Number($('scrub').value)/1000;animating=false;}});
    $('camera').addEventListener('change',()=>renderer.setCamera($('camera').value));
    $('matchup').addEventListener('change',()=>{location.search='?game='+encodeURIComponent($('matchup').value);});
    simulate();
    requestAnimationFrame(animate);
  }catch(e){
    status('Assets not ready: '+e.message,true);
    $('play-detail').innerHTML='<p class="warn">'+esc(e.message)+'</p><p>Six-game picker is present, but no substitute players or fabricated lineups will be displayed.</p>';
  }
}
start();