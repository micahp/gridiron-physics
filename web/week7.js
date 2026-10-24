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
for (const [side, id] of [['away', match.away], ['home', match.home]]) {
  $(side+'-name').textContent = id;
  $('bug-'+side).style.setProperty('--team', teamStyle(id).color);
}

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
  renderer = new Renderer($('view'),physicsGame,{displayFont:'"Saira Condensed", "Arial Narrow", sans-serif'});
  renderer.setCamera('broadcast');renderer.resize();
  window.addEventListener('resize',()=>renderer.resize());
  $('view').addEventListener('click',e=>{const id=renderer.pick(e.clientX,e.clientY);if(id)inspectPlayer(id);});
}
function inspectPlayer(id){
  const p=physicsGame.players[id]; if(!p)return;
  renderer.select(id);
  $('player-detail').innerHTML='<div class="card-h" style="grid-template-columns:1fr auto"><div><h2>'+esc(p.name)+'</h2><p>'+esc(p.team)+' · '+esc(p.pos)+' · OVR estimate</p></div><div class="big">'+esc(p.overall_estimate ?? 'n/r')+'</div></div>'+
    '<div class="attrs" style="margin-top:12px">'+Object.entries(p.ratings||{}).map(([k,v])=>'<div class="attr est"><div class="top"><span>'+esc(k)+'</span><b>'+esc(v)+'</b></div></div>').join('')+'</div>'+
    '<p class="note" style="margin-top:10px">Estimated public-research ratings, not EA-licensed player grades.</p>';
}
function drawPlayerList(demo) {
  const slots = [...Object.entries(demo.lineups.offense).map(([slot,id])=>({side:demo.play.off,slot,id})),
    ...Object.entries(demo.lineups.defense).map(([slot,id])=>({side:demo.play.def,slot,id}))];
  $('players').innerHTML=slots.map(x=>{const p=physicsGame.players[x.id];return '<button class="rrow" data-player="'+esc(x.id)+'"><span class="pos">'+esc(x.slot)+'</span><span>'+esc(p?.name||'Unknown')+'</span><span class="pos">'+esc(x.side)+'</span><span class="ovr">'+esc(p?.overall_estimate??'—')+'</span></button>';}).join('');
  for(const b of $('players').querySelectorAll('[data-player]'))b.addEventListener('click',()=>inspectPlayer(b.dataset.player));
}
function showPlaybook(p,demo){
  const team=books[p.offense], prof=team.offense.profile, c=demo?.selection?.playbook_entry || p.candidate;
  const kind=p.kind, cat=prof.run_pass?.categories?.[kind], in2026=team.pregame_2026_comparison;
  $('playbook-head').textContent=p.offense+' offensive profile';
  $('playbook-detail').innerHTML=
    '<dl class="kv"><dt>2025 charted plays</dt><dd>'+esc(prof.eligible_scrimmage_plays)+'</dd>'+
    '<dt>Historical '+esc(kind)+' share</dt><dd>'+esc(cat?.rate == null?'—':(cat.rate*100).toFixed(1)+'%')+'</dd>'+
    '<dt>Formation reference</dt><dd>'+esc(p.formation||'Not charted')+'</dd>'+
    '<dt>Candidate frequency</dt><dd>'+esc(c?(c.count+'/'+c.denominator):'—')+'</dd></dl>'+
    '<p class="note">2026 Weeks 1–6 descriptive plays: '+esc(in2026?.eligible_plays??'not available')+
    '. The call is inferred from 2025 charted attributes, not an observed 2026 coach call.</p>'+
    '<p class="note">2025 offense sample: '+esc(p.source_id?.game_id??'—')+' / '+esc(p.source_id?.play_id??'—')+
    '<br>2025 defense sample: '+esc(p.defense_source_id?.game_id??'—')+' / '+esc(p.defense_source_id?.play_id??'—')+'</p>';
}
const POST_CLIP_PAUSE=.9, TEXT_EVENT_SECONDS=2.5;
let filter='all', playing=false, dwell=0, scoringAt=new Set(), keyAt=new Set();
function classify(sim){
  // Scoring: touchdowns and made field goals. Key: those, plus interceptions, 20+ yard gains and
  // turnovers on downs. There is no win-probability model here, so this is not ESPN's ranked list.
  const scoring=new Set(), key=new Set();
  sim.plays.forEach((p,i)=>{
    const scored=Boolean(p.touchdown||(p.type==='field_goal'&&p.good)||(p.type==='administrative'&&p.points>0));
    if(scored)scoring.add(i);
    if(scored||p.interception||(p.type==='scrimmage'&&Number(p.gain)>=20))key.add(i);
  });
  for(const d of sim.drives)if(d.reason==='turnover_on_downs'&&sim.plays[d.end])key.add(d.end);
  return {scoring,key};
}
function matches(i){return filter==='all'||(filter==='scoring'?scoringAt.has(i):keyAt.has(i));}
function playable(i,step){
  let j=i;
  do j+=step; while(j>=0&&j<simulation.plays.length&&!matches(j));
  return j>=0&&j<simulation.plays.length?j:null;
}
function renderFilter(){
  const counts={all:simulation.plays.length,scoring:scoringAt.size,key:keyAt.size};
  $('filterbar').innerHTML=[['all','All plays'],['scoring','Scoring'],['key','Key plays']].map(([v,label])=>
    '<button data-filter="'+v+'" class="'+(filter===v?'on':'')+'">'+label+'<span>'+counts[v]+'</span></button>').join('');
}
function setFilter(v){
  filter=v;renderFilter();renderTimeline();
  if(!matches(selected)){const j=playable(selected,1)??playable(selected,-1);if(j!=null)choose(j);}
}
function renderPlayButton(){
  $('play').textContent=playing?'❚❚':'▶';
  $('play').setAttribute('aria-label',playing?'Pause':'Play through the plays');
  $('play').title=playing?'Pause (space)':'Play through the plays (space)';
}
function advance(){
  dwell=0;
  const j=playable(selected,1);
  if(j!=null)choose(j);
  else{playing=false;renderPlayButton();}
}
function startFrom(i){choose(i);playing=true;dwell=0;renderPlayButton();}
function renderTimeline(){
  const drives=new Map();let shown=0;
  simulation.plays.forEach((p,i)=>{
    if(!matches(i))return;
    shown++;
    if(!drives.has(p.drive))drives.set(p.drive,{offense:p.offense,rows:[]});
    drives.get(p.drive).rows.push({p,i});
  });
  $('timeline-head').textContent=shown+' of '+simulation.plays.length+' events · '+drives.size+' drives';
  $('timeline').innerHTML=[...drives].map(([n,d])=>
    '<div class="drive"><div class="drive-h" style="--team:'+esc(teamStyle(d.offense).color)+'"><span>Drive '+n+' · '+esc(d.offense)+'</span><span class="res">'+d.rows.length+(d.rows.length===1?' event':' events')+'</span></div>'+
    d.rows.map(({p,i})=>'<button class="pl'+(p.type==='administrative'?' admin':'')+(i===selected?' on':'')+'" data-index="'+i+'"><span class="dd">Q'+p.quarter+' '+clock(p.clock)+'</span><span class="txt">'+esc(p.action)+' · '+
      (p.touchdown?'TOUCHDOWN':p.type==='scrimmage'?esc(p.gain)+' yd':p.type==='field_goal'?'kick':'event')+'</span></button>').join('')+'</div>').join('');
  $('timeline').querySelectorAll('button[data-index]').forEach(b=>b.addEventListener('click',()=>startFrom(Number(b.dataset.index))));
}
function scoreAtPlay(p) {
  const score=p.scoreAfter || p.score || simulation.score;
  $('away-score').textContent=score[match.away]??0;
  $('home-score').textContent=score[match.home]??0;
  $('bug-q').textContent='Q'+p.quarter;
  $('game-clock').textContent=clock(p.clock);
  $('down-distance').textContent=p.down+' & '+p.togo+' · '+(p.yl===50?'MIDFIELD':p.yl+' YDS TO GOAL');
  $('bug-away').classList.toggle('poss',p.offense===match.away);
  $('bug-home').classList.toggle('poss',p.offense===match.home);
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
  current=null;playSeconds=0;lastTick=null;animating=false;dwell=0;$('scrub').value='0';
  if(p.type!=='scrimmage'){
    $('replay-type').textContent='Text-only event';
    $('players').innerHTML='<p class="note">No physical special-teams animation for this event.</p>';
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
  for(const b of $('timeline').querySelectorAll('button[data-index]'))b.classList.toggle('on',Number(b.dataset.index)===selected);
  $('timeline').querySelector('.pl.on')?.scrollIntoView({block:'nearest'});
}
function simulate(){
  try{
    const seed=$('seed').value.trim()||'1042';
    simulation=generateGame(match,books,seed);
    ({scoring:scoringAt,key:keyAt}=classify(simulation));
    playing=false;
    renderFilter();renderTimeline();choose(playable(-1,1)??0);renderPlayButton();
    status('Ready · '+simulation.source_play_count+' hypothetical snaps · '+simulation.drives.length+
      ' drives · '+match.away+' '+simulation.score[match.away]+' / '+match.home+' '+simulation.score[match.home]+
      ' · experimental, not legally validated');
  }catch(e){status('Simulation failed: '+e.message,true);}
}
function animate(now){
  if(lastTick===null)lastTick=now;
  const dt=Math.min(.06,(now-lastTick)/1000);lastTick=now;
  if(current&&renderer){
    if(animating&&playing)playSeconds=Math.min(current.duration,playSeconds+dt*Number($('speed').value));
    renderer.draw(current.rec,current.rec.t0+playSeconds,dt);
    $('scrub').value=String(Math.round(1000*playSeconds/Math.max(.01,current.duration)));
    if(playSeconds>=current.duration)animating=false;
  }
  if(playing&&!animating){
    dwell+=dt;
    if(dwell>=(current?POST_CLIP_PAUSE:TEXT_EVENT_SECONDS))advance();
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
    $('previous').addEventListener('click',()=>{const j=playable(selected,-1);if(j!=null)choose(j);});
    $('next').addEventListener('click',()=>{const j=playable(selected,1);if(j!=null)choose(j);});
    $('play').addEventListener('click',()=>{playing=!playing;dwell=0;renderPlayButton();});
    $('filterbar').addEventListener('click',e=>{const b=e.target.closest('[data-filter]');if(b)setFilter(b.dataset.filter);});
    document.addEventListener('keydown',e=>{if(e.code==='Space'&&e.target===document.body){e.preventDefault();$('play').click();}});
    $('scrub').addEventListener('input',()=>{if(current){playing=false;renderPlayButton();playSeconds=current.duration*Number($('scrub').value)/1000;animating=playSeconds<current.duration;}});
    for(const b of document.querySelectorAll('.cams button[data-cam]'))b.addEventListener('click',()=>{
      for(const o of document.querySelectorAll('.cams button'))o.classList.toggle('on',o===b);
      renderer.setCamera(b.dataset.cam);
    });
    for(const b of document.querySelectorAll('.tabs button[data-tab]'))b.addEventListener('click',()=>{
      for(const o of document.querySelectorAll('.tabs button'))o.classList.toggle('on',o===b);
      for(const t of document.querySelectorAll('.tab'))t.hidden=t.id!=='tab-'+b.dataset.tab;
    });
    $('matchup').addEventListener('change',()=>{location.search='?game='+encodeURIComponent($('matchup').value);});
    simulate();
    requestAnimationFrame(animate);
  }catch(e){
    status('Assets not ready: '+e.message,true);
    $('play-detail').innerHTML='<p class="warn">'+esc(e.message)+'</p><p>Six-game picker is present, but no substitute players or fabricated lineups will be displayed.</p>';
  }
}
start();