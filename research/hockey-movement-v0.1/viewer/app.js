import * as THREE from '../../../web/vendor/three.module.js';
import { OrbitControls } from '../../../web/vendor/OrbitControls.js';
import { initializeMovementScene, proposeMovement, recordMovementFrame } from '../../../engine/movement/index.js';
import { hockeyResearchConfig, createHockeyConstraints, createHockeyMovementPolicy, stepHockeyMovement } from '../../../engine/movement/sports/hockey.js';

const MODELS=['Observed','M0','M1','M2','M0 engine','M1 engine','M2 engine'];
const COLORS={Home:0x38a9ff,Away:0xff775f};
const $=(id)=>document.getElementById(id);
let archive, scenario, timer=null, enginePaths=null;
const panels=[];

function decompress(buffer){return new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))).text()}
function mkLine(points,color,opacity=1){const g=new THREE.BufferGeometry().setFromPoints(points);const m=new THREE.LineBasicMaterial({color,transparent:opacity<1,opacity});return new THREE.Line(g,m)}
function circle(radius,color,z=.08){const pts=[];for(let i=0;i<=64;i++){const a=2*Math.PI*i/64;pts.push(new THREE.Vector3(Math.cos(a)*radius,Math.sin(a)*radius,z))}return mkLine(pts,color,.7)}

function rink(scene){
  const ice=new THREE.Mesh(new THREE.PlaneGeometry(200,85),new THREE.MeshBasicMaterial({color:0x1c3039,side:THREE.DoubleSide}));ice.position.z=-.5;scene.add(ice);
  const white=0xd7e7ec,red=0xc74b50,blue=0x3978bf;
  scene.add(mkLine([new THREE.Vector3(-100,-42.5,0),new THREE.Vector3(100,-42.5,0),new THREE.Vector3(100,42.5,0),new THREE.Vector3(-100,42.5,0),new THREE.Vector3(-100,-42.5,0)],white,.8));
  scene.add(mkLine([new THREE.Vector3(0,-42.5,.02),new THREE.Vector3(0,42.5,.02)],red,.7));
  for(const x of [-25,25])scene.add(mkLine([new THREE.Vector3(x,-42.5,.02),new THREE.Vector3(x,42.5,.02)],blue,.6));
  for(const x of [-89,89])scene.add(mkLine([new THREE.Vector3(x,-42.5,.02),new THREE.Vector3(x,42.5,.02)],red,.5));
  scene.add(circle(15,red,.025));
  for(const x of [-69,69])for(const y of [-22,22]){const c=circle(15,red,.025);c.position.x=x;c.position.y=y;scene.add(c)}
}

function textSprite(label,color){const c=document.createElement('canvas');c.width=128;c.height=42;const x=c.getContext('2d');x.fillStyle='#10161bdc';x.fillRect(0,0,128,42);x.fillStyle=`#${color.toString(16).padStart(6,'0')}`;x.font='bold 25px sans-serif';x.textAlign='center';x.fillText(label.slice(-8),64,29);const t=new THREE.CanvasTexture(c);const s=new THREE.Sprite(new THREE.SpriteMaterial({map:t,transparent:true,depthTest:false}));s.scale.set(8,2.6,1);return s}

class View{
  constructor(container,title,defaultModel){
    this.container=container;this.model=defaultModel;this.canvas=container.querySelector('canvas');this.scene=new THREE.Scene();this.scene.background=new THREE.Color(0x11171b);rink(this.scene);
    this.camera=new THREE.PerspectiveCamera(42,1,.1,1000);this.camera.position.set(0,0,190);this.camera.up.set(0,1,0);this.camera.lookAt(0,0,0);
    this.renderer=new THREE.WebGLRenderer({canvas:this.canvas,antialias:true,alpha:false});this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));
    this.controls=new OrbitControls(this.camera,this.canvas);this.controls.enableDamping=true;this.controls.enablePan=true;this.controls.minDistance=75;this.controls.maxDistance=350;
    this.dynamic=[];this.resize=new ResizeObserver(()=>this.renderSize());this.resize.observe(this.canvas.parentElement);this.renderSize();
    this.animate=()=>{this.controls.update();this.renderer.render(this.scene,this.camera);setTimeout(this.animate,50)};this.animate();
    this.container.querySelector('select').addEventListener('change',e=>{this.model=e.target.value;draw()});
  }
  renderSize(){const r=this.canvas.parentElement.getBoundingClientRect();this.renderer.setSize(r.width,r.height,false);this.camera.aspect=r.width/r.height;this.camera.updateProjectionMatrix()}
  clear(){for(const o of this.dynamic){this.scene.remove(o);o.geometry?.dispose();o.material?.dispose()}this.dynamic=[]}
  add(o){this.scene.add(o);this.dynamic.push(o)}
}

function makePanels(){
  const root=$('panels');root.innerHTML='';
  for(const [i,label] of ['Observed replay','Independent / interaction comparison','Interaction-aware policy','Constrained policy'].entries()){
    const card=document.createElement('article');card.className='panel';card.innerHTML=`<div class="panel-head"><strong>${label}</strong><select aria-label="Model for ${label}">${MODELS.map(m=>`<option>${m}</option>`).join('')}</select></div><div class="canvas-wrap"><canvas></canvas><div class="legend">Home · blue &nbsp; Away · coral &nbsp; puck · gold</div><div class="uncertainty-badge"></div></div>`;root.append(card);
    const defaults=['Observed','M0','M1','M2'];card.querySelector('select').value=defaults[i];panels.push(new View(card,label,defaults[i]));
  }
  setCamera('top');
}

function frameAt(step){return scenario.frames.find(f=>f.step===step)||scenario.frames[0]}
function modelFrame(frame,model){if(model==='Observed')return null;if(model.endsWith('engine')&&enginePaths){const name=model.replace(' engine','');const f=enginePaths[name]?.[frame.step];if(!f)return null;return {players:Object.fromEntries(f.players.map(p=>[p.id,[p.x,p.y]])),puck:f.puck}}const m=model.replace(' engine','');return frame.models?.[m]||null}
function playerPath(model,id,step){const coords=[];for(let i=0;i<=step;i++){const f=frameAt(i);const m=model==='Observed'?null:modelFrame(f,model);const p=model==='Observed'?f.observed?.players?.[id]:m?.players?.[id];if(p)coords.push(new THREE.Vector3(p[0],p[1],.25));else if(coords.length)coords.push(null)}return coords}
function modelPuck(frame,model){if(model==='Observed')return frame.observed?.puck;return modelFrame(frame,model)?.puck}
function flipAttackAxis(){return $('transform').value==='attack-right'&&scenario.period==='P1'&&scenario.period_one_goalie_right_team===$('focus-team').value}
function displayXY(x,y){return [flipAttackAxis()?-x:x,y]}

function drawView(view,step){
  view.clear();const frame=frameAt(step);if(!frame)return;const model=view.model==='Observed'?'Observed':view.model;
  const generated=model.endsWith('engine')?modelFrame(frame,model):null;
  const current=frameAt(step);const source=model==='Observed'?current.observed?.players||{}:modelFrame(current,model)?.players||{};
  const idmeta=new Map((scenario.initial_state.players||[]).map(p=>[p.id,p]));
  for(const [id,xy] of Object.entries(source)){
    const meta=idmeta.get(id)||{team:'Home'};const color=COLORS[meta.team]||0xffffff;
    const [px,py]=displayXY(xy[0],xy[1]);
    const sphere=new THREE.Mesh(new THREE.SphereGeometry(1.8,14,10),new THREE.MeshBasicMaterial({color}));sphere.position.set(px,py,.7);view.add(sphere);
    const label=textSprite(id.split('|').at(-1),color);label.position.set(px+2,py+2,2);view.add(label);
    if($('trails').checked){const path=playerPath(model,id,step).map(v=>v?new THREE.Vector3(...displayXY(v.x,v.y),v.z):null);let segment=[];for(const v of path){if(v)segment.push(v);else if(segment.length>1){view.add(mkLine(segment,color,.45));segment=[]}}if(segment.length>1)view.add(mkLine(segment,color,.45))}
    if($('vectors').checked&&step>0){const prev=playerPath(model,id,step-1).filter(Boolean).at(-1);if(prev){const [ax,ay]=displayXY(xy[0],xy[1]);view.add(mkLine([new THREE.Vector3(...displayXY(prev.x,prev.y),prev.z),new THREE.Vector3(ax,ay,.8)],color,.8))}}
    if($('uncertainty').checked&&model!=='Observed'&&current.observed?.players&&!current.observed.players[id]){
      const ring=new THREE.Mesh(new THREE.RingGeometry(2.4,3.2,20),new THREE.MeshBasicMaterial({color:0xf7cb5b,side:THREE.DoubleSide}));ring.position.set(xy[0],xy[1],1);view.add(ring)
    }
  }
  const puck=modelPuck(frame,model);if(puck&&Number.isFinite(puck.x)&&Number.isFinite(puck.y)){
    const [px,py]=displayXY(puck.x,puck.y);const ball=new THREE.Mesh(new THREE.SphereGeometry(1.2,12,8),new THREE.MeshBasicMaterial({color:0xf7cb5b}));ball.position.set(px,py,1.2);view.add(ball)
    if($('trails').checked){const pts=[];for(let i=0;i<=step;i++){const p=modelPuck(frameAt(i),model);if(p){const [x,y]=displayXY(p.x,p.y);pts.push(new THREE.Vector3(x,y,1.1))}}if(pts.length>1)view.add(mkLine(pts,0xf7cb5b,.75))}
  }
  if($('distances').checked){const ps=Object.entries(source);for(let i=0;i<ps.length;i++)for(let j=i+1;j<ps.length;j++){
    const a=displayXY(...ps[i][1]),b=displayXY(...ps[j][1]),d=Math.hypot(a[0]-b[0],a[1]-b[1]);if(d<15)view.add(mkLine([new THREE.Vector3(a[0],a[1],.6),new THREE.Vector3(b[0],b[1],.6)],0xf7cb5b,.5));}}
  const uncertain=current.observed&&(current.observed.tracking_uncertainty_category||current.observed.missing_xy_count||current.observed.conflicted_present);
  const badge=view.container.querySelector('.uncertainty-badge');badge.textContent=$('uncertainty').checked&&uncertain?
    (current.observed.tracking_uncertainty_category?'TRACKING UNCERTAINTY · cutoff has missingness or identity-conflict flag':
      `TRACKING UNCERTAINTY · ${current.observed.missing_xy_count||0} missing XY row(s) · identity conflict present`):'';
}

function drawErrors(step){
  const f=frameAt(step);const observed=f.observed?.players||{};const rows=[];
  for(const [i,v] of panels.entries()){
    if(v.model==='Observed')continue;const mf=modelFrame(f,v.model);if(!mf)continue;
    for(const [id,xy] of Object.entries(mf.players||{}))if(observed[id])rows.push({id,model:v.model,error:Math.hypot(xy[0]-observed[id][0],xy[1]-observed[id][1]),team:(scenario.initial_state.players.find(p=>p.id===id)||{}).team});
  }
  $('errors').innerHTML=`<div class="error-list">${rows.slice(0,100).map(r=>`<div class="error-row"><span>${r.team||'—'} · ${r.id.split('|').at(-1)} · ${r.model}</span><span>${r.error.toFixed(2)} ft</span></div>`).join('')}${rows.length?`<p>Shown only where a future observed label exists. ${rows.length} model/player comparisons.</p>`:'No observed position labels at this step.'}<p class="${f.observed?.missing_xy_count||f.observed?.conflicted_present?'missing':''}">Missing XY rows: ${f.observed?.missing_xy_count??'not observed'} · conflicted identity present: ${f.observed?.conflicted_present??'not observed'}</p></div>`;
}

function metric(value){return Number.isFinite(value)?value.toFixed(2):'—'}

function drawGroupMetrics(step){
  const host=$('group-metrics');
  const meta=archive.joint_coherence;
  if(!meta?.scenario_ids?.includes(scenario.scenario_id)){
    host.innerHTML='<p class="group-metric-unavailable">This scenario was not in the frozen 200-start JC evaluation.</p>';
    return;
  }
  if(step===0){
    host.innerHTML='<p class="group-metric-status">Cutoff state. Group scores begin at +1 ordinal increment (not seconds).</p><p class="group-metric-meta">No future positions are scored at the input cutoff.</p>';
    return;
  }
  const score=frameAt(step)?.joint_coherence;
  if(!score){host.innerHTML='<p class="group-metric-unavailable">JC record unavailable for this step.</p>';return}
  const c=score.counts||{};
  const coverage=`Common skaters H/A ${c.common_home_skaters??'—'}/${c.common_away_skaters??'—'}; within-team pairs H/A ${c.home_within_team_pairs??'—'}/${c.away_within_team_pairs??'—'}; all pairs ${c.all_unique_pairs??'—'}.`;
  if(!score.eligible){
    host.innerHTML=`<p class="group-metric-status">Not eligible at +${step} ordinal increment (not seconds): ${score.exclusion_reason||'group eligibility rule not met'}.</p><p class="group-metric-meta">${coverage} Missing labels are not imputed. Frozen result SHA-256: ${meta.results_sha256.slice(0,16)}…</p>`;
    return;
  }
  const rows=['M0','M1','M2'].map(name=>{
    const m=score.models?.[name];
    if(!m)return `<tr><th>${name}</th><td colspan="4">Unavailable</td></tr>`;
    const signed=m.nearest_opponent_signed_gaps_by_quantile_ft||{};
    const q=['0.1','0.25','0.5','0.75','0.9'].map(k=>metric(signed[k])).join(' / ');
    return `<tr><th>${name}</th><td>${metric(m.centroid_pooled_error_ft)}<br>H/A ${metric(m.centroid_home_error_ft)} / ${metric(m.centroid_away_error_ft)}</td><td>${metric(m.team_spacing_error_ft)}<br>signed H/A ${metric(m.team_spacing_signed_home_bias_ft)} / ${metric(m.team_spacing_signed_away_bias_ft)}</td><td>${metric(m.pair_distance_error_mean_ft)} / ${metric(m.pair_distance_error_p90_ft)}<br>n=${c.all_unique_pairs??'—'}</td><td>${metric(m.nearest_opponent_quantile_gap_ft)}<br>signed q10/25/50/75/90 ${q}</td></tr>`;
  }).join('');
  host.innerHTML=`<p class="group-metric-status">Scored at +${step} ordinal increment (not seconds) · ${coverage}</p><p class="group-metric-meta">Errors and signed biases are rink-coordinate feet. Centroid cell is pooled, then Home/Away. JC result SHA-256 ${meta.results_sha256.slice(0,16)}… · evaluation commit ${meta.evaluation_commit.slice(0,12)}.</p><div class="group-metric-scroll"><table class="group-metric-table"><thead><tr><th>Model</th><th>Centroid error, ft</th><th>Spacing error / signed, ft</th><th>All-pair mean / P90, ft</th><th>Nearest-opponent gap / signed quantiles, ft</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function draw(){if(!scenario)return;const step=Number($('scrub').value);for(const p of panels)drawView(p,step);drawErrors(step);drawGroupMetrics(step);const f=frameAt(step);$('frame-label').textContent=`${step} ordinal steps · ${f.image_id||scenario.cutoff_image_id} · cutoff ${scenario.cutoff_image_id}`}

function setCamera(mode){for(const v of panels){if(mode==='top'){v.camera.position.set(0,0,190);v.camera.up.set(0,1,0);v.controls.enabled=false}else if(mode==='side'){v.camera.position.set(0,-145,100);v.camera.up.set(0,0,1);v.controls.enabled=false}else{v.camera.position.set(0,-145,135);v.camera.up.set(0,0,1);v.controls.enabled=true}v.camera.lookAt(0,0,0);v.controls.target.set(0,0,0);v.controls.update()}}

function provenance(){const meta={scenario_id:scenario.scenario_id,categories:scenario.categories,label:scenario.label,game:scenario.game,period:scenario.period,
  input_cutoff:scenario.cutoff_image_id,prediction_horizon_ordinal_steps:scenario.horizon_ordinal_steps,seed:scenario.random_seed,
  git_commit:archive.git_commit,archive_id:archive.joint_coherence?.archive_id,source_manifest_sha256:scenario.source_manifest_sha256,source_hashes:archive.source_hashes,
  joint_coherence:archive.joint_coherence?{milestone:'JC',preregistration_sha256:archive.joint_coherence.preregistration_sha256,results_sha256:archive.joint_coherence.results_sha256,evaluation_commit:archive.joint_coherence.evaluation_commit}:null,
  model_version:scenario.model_version,timebase_validated:scenario.timebase_validated,identity_conflicts_quarantined:scenario.identity_conflicts_quarantined,
    period_one_goalie_right_team:scenario.period_one_goalie_right_team,display_transform:$('transform').value,focus_team:$('focus-team').value,
    policy_configuration:scenario.policy_config,constraints:scenario.constraints};
  $('provenance').textContent=JSON.stringify(meta,null,2)}

async function runPolicies(){
  const fold=archive.fold_models[scenario.game],limits=archive.fold_constraints[scenario.game];if(!fold){$('status').textContent='Fold-specific model is unavailable.';return}
  $('status').textContent='Executing three learned policies in the Gridiron movement controller…';
  const engine={};
  for(const name of ['M0','M1','M2']){
    let state=initializeMovementScene({...scenario.initial_state,players:scenario.initial_state.players.map(p=>({...p,history:p.history.map(x=>({...x}))}))},hockeyResearchConfig);
    const policy=createHockeyMovementPolicy(fold[name==='M0'?'M0':'M1']);const constraints=name==='M2'?createHockeyConstraints(limits):null;
    const frames=[recordMovementFrame(state,{model:`${name} engine replay`,cutoff:scenario.cutoff_image_id})];
    for(let i=1;i<=45;i++){const intents=proposeMovement(state,policy,state.observationStep);state=stepHockeyMovement(state,intents,constraints);frames.push(recordMovementFrame(state,{model:`${name} engine replay`,ordinalStep:i}))}
    engine[name]=frames;
  }
  enginePaths=engine;
  // Add policy-replay choices to the panels without replacing the versioned recorded model timelines.
  for(const v of panels){const sel=v.container.querySelector('select');for(const option of ['M0 engine','M1 engine','M2 engine'])if(![...sel.options].some(o=>o.value===option))sel.add(new Option(option,option))}
  const maxima={};
  for(const name of ['M0','M1','M2']){let max=0;for(let step=0;step<=45;step++){
    const expected=scenario.frames.find(f=>f.step===step)?.models?.[name]?.players||{};
    const actual=Object.fromEntries(engine[name][step].players.map(p=>[p.id,[p.x,p.y]]));
    for(const [id,xy] of Object.entries(expected))if(actual[id])max=Math.max(max,Math.hypot(xy[0]-actual[id][0],xy[1]-actual[id][1]));
  }maxima[name]=max}
  const maxError=Math.max(...Object.values(maxima));
  $('status').textContent=`Gridiron controller generated 45 ordinal steps. Max path difference from Python archive: ${maxError.toFixed(5)} ft (M0 ${maxima.M0.toFixed(4)}, M1 ${maxima.M1.toFixed(4)}, M2 ${maxima.M2.toFixed(4)}).`;
  draw();
}

async function start(){
  makePanels();
  try{const mr=await fetch('../archive/manifest.json');if(!mr.ok)throw new Error(`archive manifest HTTP ${mr.status}`);const manifest=await mr.json();
    const entry=manifest.archives?.at(-1);if(!entry)throw new Error('No versioned scenario archive registered');
    const response=await fetch(`../archive/${entry.archive_file}`);if(!response.ok)throw new Error(`archive HTTP ${response.status}`);archive=JSON.parse(await decompress(await response.arrayBuffer()));
    if(archive.legendarypicks_git_commit!==entry.legendarypicks_git_commit)throw new Error('Manifest/source commit mismatch');
    const scenarios=Object.entries(archive.scenarios);if(!scenarios.length)throw new Error('No scenario recordings in archive');
    $('scenario').innerHTML=scenarios.map(([k,s])=>`<option value="${k}">${s.categories?.join(' / ')||'sampled state'} · ${s.game} · ${s.period} · ${s.cutoff_image_id}</option>`).join('');
    $('scenario').addEventListener('change',()=>{scenario=archive.scenarios[$('scenario').value];enginePaths=null;$('scrub').value=0;$('scrub').max=scenario.horizon_ordinal_steps;
      $('transform').disabled=scenario.period!=='P1'||!scenario.period_one_goalie_right_team;provenance();draw()});
    $('scenario').dispatchEvent(new Event('change'));$('status').textContent=`Loaded ${scenarios.length} versioned observed scenarios. Ten development games only.`;
  }catch(error){$('status').textContent=`Replay archive unavailable: ${error.message}`;console.error(error)}
}

$('play').addEventListener('click',()=>{if(timer)return;timer=setInterval(()=>{const s=Number($('scrub').value);if(s>=Number($('scrub').max)){clearInterval(timer);timer=null;return}$('scrub').value=s+1;draw()},120)});
$('pause').addEventListener('click',()=>{clearInterval(timer);timer=null});$('scrub').addEventListener('input',draw);
$('camera').addEventListener('change',e=>setCamera(e.target.value));$('run-policy').addEventListener('click',runPolicies);
$('transform').addEventListener('change',()=>{provenance();draw()});$('focus-team').addEventListener('change',()=>{provenance();draw()});
for(const id of ['trails','vectors','distances','uncertainty'])$(id).addEventListener('change',draw);
start();
