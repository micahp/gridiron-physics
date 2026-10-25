import { createInsideZoneRoster, roleKeysForFront, simulateInsideZone } from '../engine/autonomous-run.js';
import { createPassRoster, simulatePassPlay } from '../engine/autonomous/passing.js';
import { Renderer } from './render.js';

const $ = (selector) => document.querySelector(selector);
const el = {
  canvas: $('#field'), snap: $('#snap'), front: $('#front'), side: $('#run-side'), seed: $('#seed'),
  play: $('#play-call'), coverage: $('#coverage'), coverageRow: $('#coverage-row'),
  ol: $('#ol-rating'), dl: $('#dl-rating'), rb: $('#rb-rating'), scrub: $('#scrub'), toggle: $('#toggle'),
  speed: $('#speed'), clock: $('#clock'), result: $('#result-main'), detail: $('#result-detail'),
  carrier: $('#carrier-readout'), lane: $('#lane-readout'), events: $('#play-events'), compare: $('#compare-runs'),
  label: $('#stage-label'), show: $('#show-decisions'), list: $('#decision-list'), focus: $('#focus-player'),
  focusText: $('#focus-decision'),
  overlayAssignments: $('#overlay-assignments'), overlayPursuit: $('#overlay-pursuit'), overlayLanes: $('#overlay-lanes'),
};

const PASS_FRONTS = new Set(['nickel_over', 'nickel_under']);
const RUN_FRONT_ROSTER = { nickel: 'nickel' };
// Contract defensive slot names -> the alignment slots the run roster uses.
const DEFENSE_SLOT_TO_ROSTER = { LEDGE: 'LDE', REDGE: 'RDE', MLB: 'MIKE', WLB: 'WILL' };
const isPass = () => el.play.value === 'slant_flat';

/** Ratings keyed the way the rushing executor expects for the chosen front. */
function runRatings() {
  const allowed = roleKeysForFront(RUN_FRONT_ROSTER[el.front.value] ?? el.front.value);
  const out = {};
  for (const [key, value] of Object.entries(currentRatings())) {
    const [team, slot] = key.split('.');
    const rosterSlot = team === 'D' ? (DEFENSE_SLOT_TO_ROSTER[slot] ?? slot) : slot;
    const rosterKey = `${team}.${rosterSlot}`;
    if (allowed.has(rosterKey)) out[rosterKey] = value;
  }
  return out;
}

function syncControls() {
  const pass = isPass();
  el.coverageRow.hidden = !pass;
  // The pass concepts are nickel-only; keep the front selector honest.
  for (const option of el.front.options) {
    if (PASS_FRONTS.has(option.value)) option.hidden = !pass;
    else option.hidden = pass;
  }
  if (pass && !PASS_FRONTS.has(el.front.value)) el.front.value = 'nickel_over';
  if (!pass && PASS_FRONTS.has(el.front.value)) el.front.value = 'over';
}

const game = {
  home: 'O', away: 'D',
  teams: {
    O: { id: 'O', abbr: 'OFF', name: 'Offense', short: 'OFF', color: '#174e38', alt: '#f3cf4b', logo: '' },
    D: { id: 'D', abbr: 'DEF', name: 'Defense', short: 'DEF', color: '#18304a', alt: '#e8edf2', logo: '' },
  },
  players: {},
};
const renderer = new Renderer(el.canvas, game, { displayFont: '"Saira Condensed", "Arial Narrow", sans-serif' });
renderer.resize();
new ResizeObserver(() => renderer.resize()).observe(el.canvas);

let simulation = null;
let comparison = null;
let state = { t: 0, playing: false, camera: 'broadcast', lastDecisionFrame: -1, resultShown: false };
let previousNow = 0;

function setRatingReadout(input, id) { $(`#${id}`).value = input.value; }
el.ol.addEventListener('input', () => setRatingReadout(el.ol, 'ol-value'));
el.dl.addEventListener('input', () => setRatingReadout(el.dl, 'dl-value'));
el.rb.addEventListener('input', () => setRatingReadout(el.rb, 'rb-value'));

function currentRatings() {
  const ratings = {};
  const ol = Number(el.ol.value);
  for (const role of ['LT', 'LG', 'C', 'RG', 'RT', 'TE', 'WR1', 'WR2', 'WR3']) {
    ratings[`O.${role}`] = { RBK: ol, IBL: ol, PBK: ol, STR: Math.min(99, ol + 3) };
  }
  const dl = Number(el.dl.value);
  for (const role of ['LEDGE', 'LDT', 'RDT', 'REDGE', 'MLB', 'WLB', 'NB', 'LCB', 'RCB', 'SS', 'FS']) {
    ratings[`D.${role}`] = { BSH: dl, TAK: dl, STR: Math.min(99, dl + 3) };
  }
  const rb = Number(el.rb.value);
  ratings['O.RB'] = { BCV: rb, AWR: rb, AGI: rb };
  for (const role of ['WR1', 'WR2', 'WR3', 'TE']) {
    ratings[`O.${role}`] = { ...ratings[`O.${role}`], CTH: rb, CIT: rb };
  }
  return ratings;
}

function scenarioConfig() {
  const base = {
    seed: el.seed.value.trim() || (isPass() ? 'slant-flat-demo-1' : 'inside-zone-demo-1'),
    los: 35,
    dir: 1,
    ballY: 26.667,
    ratingOverrides: currentRatings(),
  };
  if (!isPass()) return { ...base, front: el.front.value, runSide: el.side.value, ratingOverrides: runRatings() };
  return {
    ...base,
    front: el.front.value,
    coverage: el.coverage.value,
    concept: 'slant_flat',
    direction: el.side.value,
  };
}

function createPlay() {
  const config = scenarioConfig();
  const previous = simulation;
  const next = isPass() ? simulatePassPlay(config) : simulateInsideZone(config);
  simulation = next;
  comparison = previous ? { previous, current: simulation } : null;
  const rosterInfo = isPass() ? createPassRoster(config) : createInsideZoneRoster(config);
  game.players = Object.fromEntries(rosterInfo.map((p) => [p.id, p]));
  renderer.setRoster(simulation.roster);
  renderer.setLines(simulation.line_of_scrimmage, null);
  renderer.clearTrail();
  renderer.select(null);
  renderer.setCamera(state.camera);
  renderComparison();

  const ids = simulation.roster.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.roleKey)}</option>`).join('');
  el.focus.innerHTML = ids;
  el.focus.disabled = false;
  $('#focus-player').value = 'O.RB';
  renderer.select('O.RB');
  state.t = 0;
  state.playing = true;
  state.lastDecisionFrame = -1;
  previousNow = performance.now();
  const endT = playEndTime(simulation);
  el.scrub.disabled = false;
  el.scrub.value = '0';
  el.toggle.disabled = false;
  el.toggle.textContent = 'Ⅱ Pause';
  el.clock.textContent = '0.00 s';
  showPendingResult();
  renderDecisionPanel(true);
  draw(1 / 60);
  if (endT <= 0) state.playing = false;
}

function showResult() {
  state.resultShown = true;
  const outcome = simulation.terminal;
  const wins = simulation.blockers.filter((b) => b.won);
  const who = simulation.roster.find((p) => p.id === simulation.tackle_id);
  if (!outcome) {
    el.result.textContent = `Simulation failure · ${simulation.failure?.reason ?? 'unresolved'}`;
    el.detail.textContent = `No football result is reported. Simulation stopped at ${simulation.failure?.time_limit_seconds ?? 'unknown'} seconds without a terminal event.`;
    el.label.textContent = 'Technical stop · no football result was invented.';
    return;
  }
  const yards = outcome.yards_gained;
  const signed = `${yards >= 0 ? '+' : ''}${yards.toFixed(1)} yd`;
  const reason = outcome.reason === 'tackle' ? `Tackle for ${signed}`
    : outcome.reason === 'touchdown' ? `Touchdown · ${signed}`
      : `${outcome.reason.replaceAll('_', ' ')} · ${signed}`;
  el.result.textContent = reason;
  const tackler = who ? ` · ${who.roleKey} made contact` : '';
  const pass = simulation.throw
    ? ` · ${rolesOf().get(simulation.throw.quarterback_id) ?? 'QB'} → ${rolesOf().get(simulation.throw.target_id) ?? 'target'}`
    : '';
  el.detail.textContent = `Dead-ball spot ${outcome.spot.x.toFixed(1)} yd · ${wins.length}/${simulation.blockers.length} blocks won${tackler}${pass}`;
  el.carrier.textContent = `Ball carrier at whistle: ${simulation.roster.find((p) => p.id === simulation.carrier_id)?.roleKey ?? 'none'}`;
  el.label.textContent = `${outcome.reason.replaceAll('_', ' ')} · ${signed} · ball spot came from simulated forward progress`;
}

function showPendingResult() {
  state.resultShown = false;
  el.result.textContent = 'Play in progress';
  el.detail.textContent = 'Gain, dead-ball spot and contact resolve from this simulation.';
  el.carrier.textContent = 'Ball carrier: —';
  el.lane.textContent = 'RB lane: —';
  el.label.textContent = 'Snap · watch the players react to the developing play.';
}

function formatOutcome(run) {
  if (!run.terminal) return `Failure · ${run.failure?.reason ?? 'unresolved'}`;
  const gain = run.terminal.yards_gained;
  const title = run.terminal.reason === 'touchdown' ? 'Touchdown'
    : run.terminal.reason === 'tackle' ? `Tackle ${gain >= 0 ? '+' : ''}${gain.toFixed(1)} yd`
      : `${run.terminal.reason.replaceAll('_', ' ')} ${gain >= 0 ? '+' : ''}${gain.toFixed(1)} yd`;
  return `${title} · spot ${run.terminal.spot.x.toFixed(1)} yd`;
}

function renderComparison() {
  if (!comparison) {
    el.compare.textContent = 'Run a second seed or front to compare outcomes.';
    return;
  }
  const callOf = (run) => run.play_call === 'slant_flat'
    ? `slant–flat · ${run.coverage ?? ''} · ${run.direction}`
    : `${run.play_call ?? 'inside zone'} · ${run.front} · ${run.run_side}`;
  const renderRun = (label, run) => `<div class="compare-run"><b>${label} · ${escapeHtml(run.seed)}</b>`
    + `<span>${escapeHtml(callOf(run))}</span>`
    + `<span>${escapeHtml(formatOutcome(run))}</span></div>`;
  el.compare.innerHTML = `<div class="compare-grid">${renderRun('Previous', comparison.previous)}${renderRun('Current', comparison.current)}</div>`;
}

/** Simulated length of a play, from any recorded player's last sample. */
function playEndTime(sim) {
  if (!sim) return 0;
  let end = 0;
  for (const path of Object.values(sim.trajectories)) {
    const t = path.at(-1)?.t ?? 0;
    if (t > end) end = t;
  }
  return end;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function sampleIndexAt(t) {
  const n = simulation?.trajectories?.['O.RB']?.length ?? 0;
  if (!n) return 0;
  return Math.min(n - 1, Math.max(0, Math.round(t * simulation.hz)));
}

function renderDecisionPanel(force = false) {
  if (!simulation) return;
  const frame = sampleIndexAt(state.t);
  if (!force && frame === state.lastDecisionFrame) return;
  state.lastDecisionFrame = frame;
  renderLiveSituation(frame);
  renderEventLog();
  const selectedId = el.focus.value || 'O.RB';
  const selected = simulation.trajectories[selectedId]?.[frame];
  if (selected) {
    const role = simulation.roster.find((p) => p.id === selectedId)?.roleKey ?? selectedId;
    const target = selected.assignment_target ? ` · target ${selected.assignment_target}` : '';
    const engagement = selected.engaged_with ? ` · engaged with ${selected.engaged_with}` : '';
    const lane = selected.lane_local_yards == null ? '' : `<br>Lane: ${escapeHtml(laneLabel(selected.lane_local_yards))}${selected.lane_locked ? ' · locked' : ''}`;
    el.focusText.innerHTML = `<b>${escapeHtml(role)}</b> · ${escapeHtml(selected.assignment)}${escapeHtml(target)}${escapeHtml(engagement)}<br><span>${escapeHtml(selected.decision)}</span>${lane}`;
  }
  if (!el.show.checked) {
    el.list.hidden = true;
    return;
  }
  el.list.hidden = false;
  el.list.innerHTML = simulation.roster.map((p) => {
    const sample = simulation.trajectories[p.id]?.[frame];
    return `<div class="decision-row"><b>${escapeHtml(p.roleKey)}</b><span>${escapeHtml(sample?.assignment ?? '—')}</span><span class="intent">${escapeHtml(sample?.decision ?? '—')}</span></div>`;
  }).join('');
}

function laneLabel(lateral) {
  const side = simulation.run_side ?? simulation.direction ?? 'right';
  const relative = lateral * (side === 'left' ? 1 : -1);
  if (relative < -1.6) return 'backside C';
  if (relative < -0.5) return 'backside A';
  if (relative <= 0.5) return 'play-side A';
  if (relative <= 1.6) return 'play-side B';
  return 'play-side C';
}

function renderLiveSituation(frame) {
  const carrier = simulation.roster.find((p) => simulation.trajectories[p.id]?.[frame]?.hasBall);
  const carrierRole = carrier?.roleKey ?? 'none';
  const terminal = state.t >= playEndTime(simulation) - 1e-6;
  el.carrier.textContent = `${terminal ? 'Ball carrier at whistle' : 'Current ball carrier'}: ${carrierRole}`;
  const lane = simulation.trajectories['O.RB']?.[frame]?.lane_local_yards;
  el.lane.textContent = lane == null ? 'RB lane: reading the mesh' : `RB lane: ${laneLabel(lane)} (${lane.toFixed(2)} yd local)`;
}

function rolesOf() {
  return new Map(simulation.roster.map((p) => [p.id, p.roleKey]));
}

function renderEventLog() {
  const roles = rolesOf();
  const eventRows = simulation.events.filter((event) => event.t <= state.t + 1e-6 && [
    'snap', 'snap_receive', 'handoff', 'lane_read', 'block_engage', 'block_release',
    'shed', 'broken_tackle', 'tackle', 'touchdown', 'whistle', 'simulation_failure',
    'throw', 'catch', 'interception', 'incomplete', 'pass_deflected', 'catch_contest',
    'sack', 'qb_read', 'throw_away', 'tackle_attempt',
  ].includes(event.type));
  const lines = eventRows.map((event) => {
    let detail = '';
    if (event.type === 'snap') detail = `Center → ${roles.get(event.to) ?? 'QB'}`;
    else if (event.type === 'snap_receive') detail = `${roles.get(event.quarterback_id) ?? 'QB'} secures the snap`;
    else if (event.type === 'handoff') detail = `${roles.get(event.from) ?? 'QB'} hands to ${roles.get(event.to) ?? 'RB'}`;
    else if (event.type === 'lane_read') detail = `${roles.get(event.carrier_id) ?? 'RB'} selects ${laneLabel(event.lane_local_yards)}`;
    else if (event.type === 'block_engage') detail = `${roles.get(event.blocker_id)} engages ${roles.get(event.defender_id)}`;
    else if (event.type === 'block_release') detail = `${roles.get(event.blocker_id)} releases ${roles.get(event.defender_id)}${event.by ? ` · shed by ${roles.get(event.by)}` : ''}`;
    else if (event.type === 'shed') detail = `${roles.get(event.by)} sheds ${roles.get(event.from)}`;
    else if (event.type === 'broken_tackle') detail = `${roles.get(event.carrier_id)} breaks ${roles.get(event.defender_id)} contact`;
    else if (event.type === 'tackle') detail = `${roles.get(event.by)} wraps ${roles.get(event.on)}`;
    else if (event.type === 'touchdown') detail = `${roles.get(event.carrier_id)} crosses the goal line`;
    else if (event.type === 'whistle') detail = `Whistle · ${event.reason.replaceAll('_', ' ')} · spot ${event.ball_spot.x.toFixed(1)} yd`;
    else if (event.type === 'simulation_failure') detail = `No football result · stopped at ${event.time_limit_seconds}s`;
    else if (event.type === 'throw') detail = `${roles.get(event.quarterback_id)} throws to ${roles.get(event.target_id)} · ${event.separation_yards.toFixed(1)} yd separation · ${event.pressure_yards.toFixed(1)} yd pressure`;
    else if (event.type === 'catch') detail = `${roles.get(event.player_id)} secures the catch`;
    else if (event.type === 'interception') detail = `${roles.get(event.player_id)} intercepts`;
    else if (event.type === 'incomplete') detail = 'Pass falls incomplete';
    else if (event.type === 'pass_deflected') detail = `${roles.get(event.by)} breaks the pass up`;
    else if (event.type === 'catch_contest') detail = `${roles.get(event.player_id)} contests the ball · ${(event.chance * 100).toFixed(0)}%`;
    else if (event.type === 'sack') detail = `${roles.get(event.defender_id)} sacks ${roles.get(event.quarterback_id)}`;
    else if (event.type === 'throw_away') detail = `${roles.get(event.quarterback_id)} throws it away`;
    else if (event.type === 'qb_read') detail = `${roles.get(event.quarterback_id)} holds · best read ${roles.get(event.target_id)} (${event.utility})`;
    else if (event.type === 'tackle_attempt') detail = `${roles.get(event.defender_id)} attempts the tackle on ${roles.get(event.carrier_id)}`;
    else if (event.type === 'hit') detail = `${roles.get(event.a)} and ${roles.get(event.b)} collide`;
    return `<li><strong>${event.t.toFixed(2)}s</strong> · ${escapeHtml(detail)}</li>`;
  });
  el.events.innerHTML = lines.length ? lines.join('') : '<li class="muted">No play events yet.</li>';
  el.events.scrollTop = el.events.scrollHeight;
}

/** Coaching annotations, drawn only when the operator asks for them. */
function updateOverlay(frame) {
  if (!simulation) return;
  const wantAssign = el.overlayAssignments.checked;
  const wantPursuit = el.overlayPursuit.checked;
  const wantLanes = el.overlayLanes.checked;
  if (!wantAssign && !wantPursuit && !wantLanes) { renderer.setDebugOverlay(null); return; }
  const roleById = new Map(simulation.roster.map((p) => [p.id, p]));
  const at = (id) => simulation.trajectories[id]?.[frame] ?? null;
  const segments = [];
  const marks = [];
  const carrierSample = simulation.roster.map((p) => ({ p, s: at(p.id) })).find((x) => x.s?.hasBall);
  if (wantAssign) {
    for (const p of simulation.roster) {
      const s = at(p.id);
      const targetId = s?.assignment_target;
      const target = targetId ? at(targetId) : null;
      if (!s || !target) continue;
      segments.push({
        x0: s.x, y0: s.y, x1: target.x, y1: target.y,
        color: p.team === 'O' ? '#f5d33a' : '#ff7a6b',
      });
    }
  }
  if (wantPursuit && carrierSample) {
    for (const p of simulation.roster) {
      if (p.team === carrierSample.p.team) continue;
      const s = at(p.id);
      if (!s) continue;
      segments.push({ x0: s.x, y0: s.y, x1: carrierSample.s.x, y1: carrierSample.s.y, color: '#4ad2ff' });
    }
    marks.push({ x: carrierSample.s.x, y: carrierSample.s.y, color: '#4ad2ff', radius: 1.1 });
  }
  if (wantLanes) {
    const laneCarrier = simulation.roster.find((p) => p.id === simulation.carrier_id);
    const s = laneCarrier ? at(laneCarrier.id) : null;
    if (s) {
      for (const lane of [-2.65, -1.68, -0.58, 0.58, 1.68, 2.65]) {
        marks.push({ x: s.x + simulation.direction * 2, y: simulation.ball_y + simulation.direction * lane, color: '#b6f36b', radius: 0.5 });
      }
    }
  }
  renderer.setDebugOverlay({ segments, marks });
}

function draw(dt) {
  if (!simulation) { renderer.updateCamera(dt, { dir: 1 }); renderer.render(); return; }
  const endT = playEndTime(simulation);
  state.t = Math.max(0, Math.min(endT, state.t));
  renderer.draw(simulation, state.t, dt);
  renderer.updateCamera(dt, { dir: simulation.direction });
  renderer.render();
  if (state.t >= endT - 1e-6 && !state.resultShown) showResult();
  el.scrub.value = endT > 0 ? String(Math.round(state.t / endT * 1000)) : '0';
  el.clock.textContent = `${state.t.toFixed(2)} s`;
  renderDecisionPanel();
  updateOverlay(Math.min(simulation.frames.length - 1, Math.round((state.t - simulation.t0) * simulation.hz)));
}

function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, Math.max(0, (now - previousNow) / 1000));
  previousNow = now;
  if (state.playing && simulation) {
    const endT = playEndTime(simulation);
    state.t += dt * Number(el.speed.value);
    if (state.t >= endT) {
      state.t = endT;
      state.playing = false;
      el.toggle.textContent = '↻ Replay';
    }
  }
  draw(dt);
}
requestAnimationFrame(animate);

el.snap.addEventListener('click', () => {
  el.snap.disabled = true;
  el.label.textContent = 'Snap · all 22 players are reading the live play.';
  requestAnimationFrame(() => {
    try { createPlay(); }
    catch (error) {
      console.error(error);
      el.result.textContent = 'Simulation failed';
      el.detail.textContent = error.message;
    } finally { el.snap.disabled = false; }
  });
});
el.toggle.addEventListener('click', () => {
  if (!simulation) return;
  const endT = playEndTime(simulation);
  if (state.t >= endT) {
    state.t = 0;
    showPendingResult();
  }
  state.playing = !state.playing;
  el.toggle.textContent = state.playing ? 'Ⅱ Pause' : '▶ Play';
});
el.scrub.addEventListener('input', () => {
  if (!simulation) return;
  const endT = playEndTime(simulation);
  state.t = endT * Number(el.scrub.value) / 1000;
  state.playing = false;
  el.toggle.textContent = state.t >= endT ? '↻ Replay' : '▶ Play';
  draw(1 / 60);
});
el.focus.addEventListener('change', () => { renderer.select(el.focus.value); renderDecisionPanel(true); });
el.play.addEventListener('change', syncControls);
for (const box of [el.overlayAssignments, el.overlayPursuit, el.overlayLanes]) {
  box.addEventListener('change', () => draw(1 / 60));
}
syncControls();
el.show.addEventListener('change', () => renderDecisionPanel(true));
for (const button of document.querySelectorAll('[data-cam]')) {
  button.addEventListener('click', () => {
    state.camera = button.dataset.cam;
    renderer.setCamera(state.camera);
    for (const other of document.querySelectorAll('[data-cam]')) other.classList.toggle('on', other === button);
  });
}
el.canvas.addEventListener('click', (event) => {
  const id = renderer.pick(event.clientX, event.clientY);
  if (id && simulation?.roster.some((p) => p.id === id)) {
    el.focus.value = id;
    renderer.select(id);
    renderDecisionPanel(true);
  }
});
window.addEventListener('resize', () => renderer.resize());
