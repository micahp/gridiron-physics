import { Renderer } from './render.js';
import { selectPlay } from './prototype-model.js';
import { executeSelectedPlay } from './prototype-execution.js';
import { MATCHUPS, generateGame } from './week7-core.js';
import { describeWeek7Play } from './week7-play-description.js';

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
// Reuse the same 2026 lineups for timeline credits and the actual 3D play.
const selectedDemos = new Map();

function status(message, failure=false){$('status').textContent=message; $('status').style.color=failure?'#ffc3b8':'#c9eaff';}
function clock(v){return Math.floor(v/60)+':'+String(Math.floor(v%60)).padStart(2,'0');}
function safe(v){return Number.isFinite(Number(v))?Number(v):0;}
function playersMap(a,b) {
  return Object.fromEntries([...(a?.roster||[]), ...(b?.roster||[])].map(p=>[p.id,{...p,team:p.team_id,pos:p.rating_position,group:p.rating_group}]));
}
function makeViewer(){
  const home=snapshot.teams[match.home],away=snapshot.teams[match.away];
  if(!home || !away)throw new Error('one or both 2026 team rosters are missing');
  physicsGame = {home:match.home,away:match.away,seed:$('seed').value.trim()||'1042',
    teams:{[match.home]:teamStyle(match.home),[match.away]:teamStyle(match.away)},
    players:playersMap(home,away)};
  renderer = new Renderer($('view'),physicsGame,{displayFont:'"Saira Condensed", "Arial Narrow", sans-serif'});
  if(new URLSearchParams(location.search).has('debug')){
    window.__gridironRenderer=renderer;
    window.__gridironState=()=>({selected,hasRecord:Boolean(current),duration:current?.duration,animating,playing,playerCount:renderer.players.size});
  }
  renderer.setCamera('broadcast');renderer.resize();
  window.addEventListener('resize',()=>renderer.resize());
  $('view').addEventListener('click',e=>{const id=renderer.pick(e.clientX,e.clientY);if(id)inspectPlayer(id);});
}
function inspectPlayer(id){
  const p=physicsGame.players[id]; if(!p)return;
  const slot=rosterSlots.find(x=>x.id===id);
  if(slot&&slot.side!==rosterTeam){rosterTeam=slot.side;renderRoster();}
  renderer.select(id);
  document.querySelector('.tabs button[data-tab="ratings"]').click();
  for(const old of document.querySelectorAll('.pdetail'))old.remove();
  const detail=document.createElement('div');
  detail.className='pdetail';
  detail.innerHTML='<div class="card-h" style="grid-template-columns:1fr auto"><div><h2>'+esc(p.name)+'</h2><p>'+esc(p.team)+' · '+esc(p.pos)+' · OVR estimate</p></div><div class="big">'+esc(p.overall_estimate ?? 'n/r')+'</div></div>'+
    '<div class="attrs" style="margin-top:12px">'+Object.entries(p.ratings||{}).map(([k,v])=>'<div class="attr est"><div class="top"><span>'+esc(k)+'</span><b>'+esc(v)+'</b></div></div>').join('')+'</div>'+
    '<p class="note" style="margin-top:10px">Estimated public-research ratings, not EA-licensed player grades.</p>';
  const row=[...$('players').querySelectorAll('[data-player]')].find(b=>b.dataset.player===id);
  if(row){row.after(detail);row.scrollIntoView({block:'start'});}
  else{$('players').prepend(detail);detail.scrollIntoView({block:'start'});}
}
function drawPlayerList(demo) {
  rosterSlots = [...Object.entries(demo.lineups.offense).map(([slot,id])=>({side:demo.play.off,slot,id})),
    ...Object.entries(demo.lineups.defense).map(([slot,id])=>({side:demo.play.def,slot,id}))];
  renderRoster();
}
function renderRoster(){
  $('roster-t').hidden=false;
  $('roster-t').innerHTML=[match.away,match.home].map(t=>'<button data-team="'+esc(t)+'" class="'+(t===rosterTeam?'on':'')+'">'+esc(t)+'</button>').join('');
  $('players').innerHTML=rosterSlots.filter(x=>x.side===rosterTeam).map(x=>{const p=physicsGame.players[x.id];return '<button class="rrow" data-player="'+esc(x.id)+'"><span class="pos">'+esc(x.slot)+'</span><span>'+esc(p?.name||'Unknown')+'</span><span class="pos">'+esc(x.side)+'</span><span class="ovr">'+esc(p?.overall_estimate??'—')+'</span></button>';}).join('');
  for(const b of $('players').querySelectorAll('[data-player]'))b.addEventListener('click',()=>inspectPlayer(b.dataset.player));
}
const FORM_LABEL={'SHOTGUN':'Shotgun','UNDER CENTER':'Under center','PISTOL':'Pistol'};
const GAP_LABEL={end:'End',tackle:'Tackle',guard:'Guard'};
// Diagram geometry in a 160x96 box: line of scrimmage at y=60, offensive line at x=56..104.
const DIAG_ALIGN={'UNDER CENTER':{qb:[80,68],rb:[80,84]},'SHOTGUN':{qb:[80,80],rb:[68,80]},'PISTOL':{qb:[80,72],rb:[80,88]}};
const DIAG_GAP={end:{left:46,right:114},tackle:{left:62,right:98},guard:{left:74,right:86}};
const DIAG_ZONE={left:44,middle:80,right:116};
function cardLabel(c){
  const a=c.attributes, f=FORM_LABEL[a.formation]||a.formation;
  return c.action==='run'
    ? f+' · '+GAP_LABEL[a.run_gap]+' '+a.run_location
    : f+' · '+(a.pass_length==='deep'?'deep':'short')+' '+a.pass_location;
}
function playDiagram(c){
  const a=c.attributes, al=DIAG_ALIGN[a.formation]||DIAG_ALIGN['UNDER CENTER'];
  const ol=[56,68,80,92,104].map(x=>'<circle cx="'+x+'" cy="60" r="3.2" class="pd-ol"/>').join('');
  let play, rb='';
  if(c.action==='run'){
    const gx=DIAG_GAP[a.run_gap][a.run_location];
    rb='<circle cx="'+al.rb[0]+'" cy="'+al.rb[1]+'" r="3.6" class="pd-rb"/>';
    play='<path d="M'+al.rb[0]+' '+al.rb[1]+' L'+gx+' 60 L'+gx+' 26" class="pd-run"/><circle cx="'+gx+'" cy="26" r="2.6" class="pd-end"/>';
  }else{
    const tx=DIAG_ZONE[a.pass_location], ty=a.pass_length==='deep'?18:40;
    play='<path d="M'+al.qb[0]+' '+al.qb[1]+' L'+tx+' '+ty+'" class="pd-pass"/><circle cx="'+tx+'" cy="'+ty+'" r="4" class="pd-target"/>';
  }
  return '<svg viewBox="0 0 160 96" role="img" aria-label="'+esc(cardLabel(c))+'"><rect width="160" height="96" class="pd-field"/><line x1="6" x2="154" y1="60" y2="60" class="pd-los"/>'+
    ol+'<circle cx="'+al.qb[0]+'" cy="'+al.qb[1]+'" r="3.6" class="pd-qb"/>'+rb+play+'</svg>';
}
function playCard(c){
  const on=currentPlay?.playbook_candidate_id===c.candidate_id&&currentPlay.offense===bookTeam;
  const [lo,hi]=c.ci95_wilson;
  return '<div class="pcard'+(on?' on':'')+'">'+playDiagram(c)+'<div class="pc-t">'+esc(cardLabel(c))+'</div>'+
    '<div class="pc-n">'+c.count+' of '+c.denominator+' · '+(c.rate*100).toFixed(1)+'%</div>'+
    '<div class="pc-n">95% interval '+(lo*100).toFixed(1)+'–'+(hi*100).toFixed(1)+'%</div></div>';
}
function renderPlaybook(){
  $('book-t').innerHTML=[match.away,match.home].map(t=>'<button data-team="'+esc(t)+'" class="'+(t===bookTeam?'on':'')+'">'+esc(t)+'</button>').join('');
  const off=books[bookTeam].offense, prof=off.profile;
  const pass=prof.run_pass?.categories?.pass?.rate;
  const forms=Object.entries(prof.formation?.categories||{}).sort((a,b)=>b[1].count-a[1].count).slice(0,3)
    .map(([k,v])=>(FORM_LABEL[k]||k)+' '+(v.rate*100).toFixed(0)+'%').join(' · ');
  const snap=currentPlay?.type==='scrimmage'
    ? (currentPlay.offense===bookTeam ? 'Highlighted: the card this snap drew from.' : 'The current snap is '+currentPlay.offense+' offense. Switch team to see its card.')
    : 'The current event has no playbook card (kicks and punts).';
  const group=(kind,label)=>{
    const cs=[...off.play_candidates[kind].candidates].sort((a,b)=>b.count-a.count);
    return '<div class="pgroup">'+label+' · '+cs.length+' combinations</div><div class="pgrid">'+cs.map(playCard).join('')+'</div>';
  };
  $('playbook-head').textContent=bookTeam+' · 2025 charted offense';
  $('playbook-detail').innerHTML=
    '<p class="note">'+esc(prof.eligible_scrimmage_plays)+' charted plays · '+(pass==null?'—':(pass*100).toFixed(1)+'%')+' pass · '+esc(forms)+'</p>'+
    '<p class="note">'+esc(snap)+'</p>'+
    group('run','Run')+group('pass','Pass')+
    '<p class="note">Built from 2025 charted labels: formation, run gap or pass depth and side. Diagrams show the alignment and the run gap or pass target, not routes, blocks or coverage. These are tendencies, not play calls.</p>';
}
const POST_CLIP_PAUSE=.9, TEXT_EVENT_SECONDS=2.5;
let filter='all', playing=false, dwell=0, scoringAt=new Set(), keyAt=new Set();
let rosterSlots=[], rosterTeam=match.away;
let currentPlay=null, bookTeam=match.away, league=null;
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
function boxScore(sim){
  const teams=[match.away,match.home], out={};
  for(const t of teams)out[t]={quarters:[0,0,0,0],score:0,yards:0,rushAtt:0,rushYds:0,rushTD:0,passAtt:0,passComp:0,passYds:0,passTD:0,ints:0,thirdAtt:0,thirdConv:0,fgAtt:0,fgMade:0,punts:0,drives:0,top:0};
  for(const p of sim.plays){
    const s=out[p.offense]; if(!s)continue;
    if(p.type==='scrimmage'){
      const gain=Number(p.gain)||0;
      s.yards+=gain;
      if(p.kind==='run'){s.rushAtt++;s.rushYds+=gain;if(p.touchdown)s.rushTD++;}
      if(p.kind==='pass'){s.passAtt++;if(p.completed){s.passComp++;s.passYds+=gain;}if(p.interception)s.ints++;if(p.touchdown)s.passTD++;}
      if(p.down===3){s.thirdAtt++;if(p.touchdown||gain>=p.togo)s.thirdConv++;}
    }
    if(p.type==='field_goal'){s.fgAtt++;if(p.good)s.fgMade++;}
    if(p.type==='punt')s.punts++;
    const pts=(p.touchdown?6:0)+(p.try?.startsWith('XP good')?1:0)+(p.type==='field_goal'&&p.good?3:0);
    s.score+=pts;s.quarters[p.quarter-1]+=pts;
    s.top+=Number(p.runoff)||0;
  }
  for(const d of sim.drives)if(out[d.offense])out[d.offense].drives++;
  return out;
}
function renderBox(){
  const box=boxScore(simulation), teams=[match.away,match.home];
  const mmss=s=>Math.floor(s/60)+':'+String(Math.floor(s%60)).padStart(2,'0');
  $('linescore').innerHTML='<thead><tr><th></th><th>1</th><th>2</th><th>3</th><th>4</th><th>T</th></tr></thead><tbody>'+
    teams.map(t=>'<tr><td>'+esc(t)+'</td>'+box[t].quarters.map(n=>'<td>'+n+'</td>').join('')+'<td><b>'+box[t].score+'</b></td></tr>').join('')+'</tbody>';
  const rows=[
    ['Total yards', s=>s.yards],
    ['Rushing', s=>s.rushAtt+'–'+s.rushYds],
    ['Passing', s=>s.passComp+'/'+s.passAtt],
    ['Passing yards', s=>s.passYds],
    ['TD rush / pass', s=>s.rushTD+' / '+s.passTD],
    ['Interceptions', s=>s.ints],
    ['3rd down', s=>s.thirdConv+'/'+s.thirdAtt],
    ['Field goals', s=>s.fgMade+'/'+s.fgAtt],
    ['Punts', s=>s.punts],
    ['Drives', s=>s.drives],
    ['Time of possession', s=>mmss(s.top)],
  ];
  $('teamstats').innerHTML='<thead><tr><th></th>'+teams.map(t=>'<th>'+esc(t)+'</th>').join('')+'</tr></thead><tbody>'+
    rows.map(([label,f])=>'<tr><td>'+label+'</td>'+teams.map(t=>'<td>'+esc(f(box[t]))+'</td>').join('')+'</tr>').join('')+'</tbody>';
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
    if(!drives.has(p.drive))drives.set(p.drive,{offense:simulation.drives.find(d=>d.index===p.drive)?.offense??p.offense,rows:[]});
    drives.get(p.drive).rows.push({p,i});
  });
  $('timeline-head').textContent=shown+' of '+simulation.plays.length+' events · '+drives.size+' drives';
  $('timeline').innerHTML=[...drives].map(([n,d])=>
    '<div class="drive"><div class="drive-h" style="--team:'+esc(teamStyle(d.offense).color)+'"><span>Drive '+n+' · '+esc(d.offense)+'</span><span class="res">'+d.rows.length+(d.rows.length===1?' event':' events')+'</span></div>'+
    d.rows.map(({p,i})=>'<button class="pl'+(p.type==='scrimmage'?'':' admin')+(i===selected?' on':'')+'" data-index="'+i+'"><span class="dd">Q'+p.quarter+' '+clock(p.clock)+'</span><span class="txt">'+
      esc(describeWeek7Play(p, selectionFor(p)?.demo, physicsGame?.players).line)+'</span></button>').join('')+'</div>').join('');
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
function selectionFor(p){
  if(p.type!=='scrimmage')return null;
  if(!selectedDemos.has(p.id)){
    try{selectedDemos.set(p.id,{demo:makeSelected(p)});}
    catch(error){selectedDemos.set(p.id,{error});}
  }
  return selectedDemos.get(p.id);
}
function choose(idx){
  if(!simulation)return;
  selected=Math.max(0,Math.min(simulation.plays.length-1,idx));
  const p=simulation.plays[selected];
  currentPlay=p;
  const credit=describeWeek7Play(p, selectionFor(p)?.demo, physicsGame?.players);
  scoreAtPlay(p);
  $('snap-title').textContent='Play '+p.index+' · '+p.action+' · '+(credit.actors||p.offense);
  $('play-detail').innerHTML='<b>'+esc(p.action)+'</b>'+
    (credit.actors?' · '+esc(credit.actors):'')+(credit.result?' · '+esc(credit.result):'')+
    ' · Q'+p.quarter+' '+clock(p.clock)+' → '+clock(Math.max(0,p.clock-(p.runoff||0)))+
    '<br>'+esc(p.note||'')+
    (credit.actors?'<br><span class="note">Illustrative 2026 roster assignment for the 3D replay, not a historical player credit.</span>':'')+
    (p.try?'<br>'+esc(p.try):'');
  current=null;playSeconds=0;lastTick=null;animating=false;dwell=0;$('scrub').value='0';
  if(p.type!=='scrimmage'){
    currentSelection=null;
    $('replay-type').textContent='Text-only event';
    $('roster-t').hidden=true;rosterSlots=[];
    $('players').innerHTML='<p class="note">No physical special-teams animation for this event.</p>';
  }else{
    try{
      const resolved=selectionFor(p);
      if(resolved?.error)throw resolved.error;
      const demo=resolved?.demo;
      if(!demo)throw new Error('missing 2026 replay lineup');
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
      drawPlayerList(demo);
      animating=true;
    }catch(e){
      $('replay-type').textContent='Physical animation unavailable';
      $('play-detail').innerHTML+='<p class="warn">3D unavailable for this play: '+esc(e.message)+'. The game log remains accessible.</p>';
    }
  }
  for(const b of $('timeline').querySelectorAll('button[data-index]'))b.classList.toggle('on',Number(b.dataset.index)===selected);
  $('timeline').querySelector('.pl.on')?.scrollIntoView({block:'nearest'});
  renderPlaybook();
}
function simulate(){
  try{
    const seed=$('seed').value.trim()||'1042';
    if(physicsGame)physicsGame.seed=seed;
    simulation=generateGame(match,books,seed,league);
    selectedDemos.clear();
    ({scoring:scoringAt,key:keyAt}=classify(simulation));
    playing=false;
    renderFilter();renderTimeline();renderBox();choose(playable(-1,1)??0);renderPlayButton();
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
    // Playback time owns the animation clock too. A paused game must not
    // keep advancing the Mixamo skeleton, and ½×/2× must scale both equally.
    const animationDt=playing&&animating ? dt*Number($('speed').value) : 0;
    renderer.draw(current.rec,current.rec.t0+playSeconds,animationDt);
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
    const lr=await fetch('./data/special_teams/2025-league.json');
    if(!lr.ok)throw new Error('missing 2025 special-teams tables. Run python3 pipeline/build_special_teams_2025.py.');
    league=await lr.json();
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
    $('roster-t').addEventListener('click',e=>{const b=e.target.closest('[data-team]');if(!b)return;rosterTeam=b.dataset.team;renderRoster();});
    $('book-t').addEventListener('click',e=>{const b=e.target.closest('[data-team]');if(!b)return;bookTeam=b.dataset.team;renderPlaybook();});
    $('matchup').addEventListener('change',()=>{location.search='?game='+encodeURIComponent($('matchup').value);});
    simulate();
    requestAnimationFrame(animate);
  }catch(e){
    status('Assets not ready: '+e.message,true);
    $('play-detail').innerHTML='<p class="warn">'+esc(e.message)+'</p><p>Six-game picker is present, but no substitute players or fabricated lineups will be displayed.</p>';
  }
}
start();