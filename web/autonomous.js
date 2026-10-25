import { createInsideZoneRoster, simulateInsideZone } from '../engine/autonomous-run.js';
import { simulateAutonomousPass } from '../engine/autonomous-pass.js';
import { Renderer } from './render.js';

const $ = (selector) => document.querySelector(selector);
const el = {
  canvas: $('#field'), snap: $('#snap'), front: $('#front'), side: $('#run-side'), seed: $('#seed'),
  playCall: $('#play-call'), coverage: $('#coverage'), los: $('#los'), down: $('#down'), toGo: $('#to-go'),
  runSetup: $('#run-setup'), coverageControl: $('#coverage-control'), title: $('#page-title'), dek: $('#page-dek'),
  ol: $('#ol-rating'), dl: $('#dl-rating'), rb: $('#rb-rating'), scrub: $('#scrub'), toggle: $('#toggle'),
  speed: $('#speed'), clock: $('#clock'), result: $('#result-main'), detail: $('#result-detail'),
  carrier: $('#carrier-readout'), lane: $('#lane-readout'), events: $('#play-events'), compare: $('#compare-runs'),
  label: $('#stage-label'), show: $('#show-decisions'), list: $('#decision-list'), focus: $('#focus-player'),
  focusText: $('#focus-decision'),
};

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

function updatePlaySetup() {
  const passCall = el.playCall.value !== 'inside_zone';
  el.runSetup.hidden = passCall;
  el.coverageControl.hidden = !passCall;
  el.front.disabled = passCall;
  const labels = {
    inside_zone: ['Inside Zone', '22 players read the front, fit gaps, block live threats and resolve the run from contact.'],
    slant_flat_left: ['Slant / Flat Left', 'The quarterback reads live coverage, protects the pocket and throws to an observed window.'],
    slant_flat_right: ['Slant / Flat Right', 'The quarterback reads live coverage, protects the pocket and throws to an observed window.'],
  };
  [el.title.textContent, el.dek.textContent] = labels[el.playCall.value];
}
el.playCall.addEventListener('change', updatePlaySetup);
updatePlaySetup();

function setRatingReadout(input, id) { $(`#${id}`).value = input.value; }
el.ol.addEventListener('input', () => setRatingReadout(el.ol, 'ol-value'));
el.dl.addEventListener('input', () => setRatingReadout(el.dl, 'dl-value'));
el.rb.addEventListener('input', () => setRatingReadout(el.rb, 'rb-value'));

function currentRatings(front = el.front.value) {
  const ratings = {};
  for (const role of ['LT', 'LG', 'C', 'RG', 'RT', 'TE', 'WR1', 'WR2', 'WR3']) {
    ratings[`O.${role}`] = { RBK: Number(el.ol.value), IBL: Number(el.ol.value), STR: Math.min(99, Number(el.ol.value) + 3) };
  }
  for (const p of createInsideZoneRoster({ front }).filter((player) => player.team === 'D')) {
    ratings[`D.${p.slot}`] = { BSH: Number(el.dl.value), TAK: Number(el.dl.value), STR: Math.min(99, Number(el.dl.value) + 3) };
  }
  ratings['O.RB'] = { BCV: Number(el.rb.value), AWR: Number(el.rb.value), AGI: Number(el.rb.value) };
  return ratings;
}

function createPlay() {
  const seed = el.seed.value.trim() || 'inside-zone-demo-1';
  const previous = simulation;
  const passCall = el.playCall.value !== 'inside_zone';
  const front = passCall ? 'nickel' : el.front.value;
  const ratings = currentRatings(front);
  const next = passCall
    ? simulateAutonomousPass({
      seed, concept: el.playCall.value, coverage: el.coverage.value,
      down: Number(el.down.value), toGo: Number(el.toGo.value),
      los: Number(el.los.value), dir: 1, ballY: 26.667, ratingOverrides: ratings,
    })
    : simulateInsideZone({
      seed, front, runSide: el.side.value,
      los: Number(el.los.value), dir: 1, ballY: 26.667, ratingOverrides: ratings,
    });
  simulation = next;
  comparison = previous ? { previous, current: simulation } : null;
  game.players = Object.fromEntries(createInsideZoneRoster({
    seed, front, ratingOverrides: ratings,
  }).map((p) => [p.id, p]));
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
  const endT = simulation.trajectories['O.RB'].at(-1)?.t ?? 0;
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
  const wins = (simulation.blockers ?? []).filter((b) => b.won);
  const who = simulation.roster.find((p) => p.id === simulation.tackle_id);
  if (!outcome) {
    el.result.textContent = `Simulation failure · ${simulation.failure?.reason ?? 'unresolved'}`;
    el.detail.textContent = `No football result is reported. Simulation stopped at ${simulation.failure?.time_limit_seconds ?? 'unknown'} seconds without a terminal event.`;
    el.label.textContent = 'Technical stop · no football result was invented.';
    return;
  }
  const yards = outcome.yards_gained;
  const signed = Number.isFinite(yards) ? `${yards >= 0 ? '+' : ''}${yards.toFixed(1)} yd` : null;
  const isPass = simulation.play_call !== 'inside_zone';
  const reason = outcome.reason === 'incomplete' ? 'Incomplete pass'
    : outcome.reason === 'sack' ? `Sack · ${signed}`
      : outcome.reason === 'interception_return_touchdown' ? `Interception return touchdown · +${(outcome.return_yards ?? 0).toFixed(1)} yd`
        : outcome.reason === 'interception_return' ? `Interception · return ${Math.max(0, outcome.return_yards ?? 0).toFixed(1)} yd`
          : outcome.reason === 'touchdown' ? `Touchdown · ${signed}`
            : isPass && outcome.pass_completed ? `Completed pass · ${signed}`
              : outcome.reason === 'tackle' ? `Tackle for ${signed}`
                : `${outcome.reason.replaceAll('_', ' ')}${signed ? ` · ${signed}` : ''}`;
  el.result.textContent = reason;
  const tackler = who ? ` · tackler ${who.roleKey}` : '';
  const blockerTotal = simulation.blockers?.length ?? 0;
  const possession = outcome.possession_team ? ` · possession ${outcome.possession_team}` : '';
  el.detail.textContent = `Dead-ball spot ${outcome.spot.x.toFixed(1)} yd · ${wins.length}/${blockerTotal} blockers won${tackler}${possession}`;
  el.carrier.textContent = `Ball carrier at whistle: ${simulation.roster.find((p) => p.id === simulation.carrier_id)?.roleKey ?? 'none'}`;
  el.label.textContent = `${reason} · ${outcome.reason.replaceAll('_', ' ')} · ball spot came from simulated motion and contact`;
}

function showPendingResult() {
  state.resultShown = false;
  el.result.textContent = 'Play in progress';
  el.detail.textContent = 'Ball flight, reads, contact and the dead-ball spot resolve from this simulation.';
  el.carrier.textContent = 'Ball carrier: —';
  el.lane.textContent = simulation.play_call === 'inside_zone' ? 'RB lane: —' : 'Carrier lane: —';
  el.label.textContent = 'Snap · watch the players react to the developing play.';
}

function formatOutcome(run) {
  if (!run.terminal) return `Failure · ${run.failure?.reason ?? 'unresolved'}`;
  const gain = run.terminal.yards_gained;
  const title = run.terminal.reason === 'incomplete' ? 'Incomplete pass'
    : run.terminal.reason === 'sack' ? `Sack ${Number.isFinite(gain) ? `${gain.toFixed(1)} yd` : ''}`
      : run.terminal.reason === 'interception_return_touchdown' ? `Interception return TD · +${(run.terminal.return_yards ?? 0).toFixed(1)} yd`
        : run.terminal.reason === 'interception_return' ? `Interception · +${(run.terminal.return_yards ?? 0).toFixed(1)} yd`
          : run.terminal.reason === 'touchdown' ? 'Touchdown'
            : Number.isFinite(gain) ? `${run.terminal.reason.replaceAll('_', ' ')} ${gain >= 0 ? '+' : ''}${gain.toFixed(1)} yd`
              : run.terminal.reason.replaceAll('_', ' ');
  return `${title} · spot ${run.terminal.spot.x.toFixed(1)} yd`;
}

function renderComparison() {
  if (!comparison) {
    el.compare.textContent = 'Run a second seed or front to compare outcomes.';
    return;
  }
  const renderRun = (label, run) => `<div class="compare-run"><b>${label} · ${escapeHtml(run.seed)}</b>`
    + `<span>${escapeHtml(run.play_call)} · ${escapeHtml(run.defense_call ?? run.front)} · ${escapeHtml(run.run_side)}</span>`
    + `<span>${escapeHtml(formatOutcome(run))}</span></div>`;
  el.compare.innerHTML = `<div class="compare-grid">${renderRun('Previous', comparison.previous)}${renderRun('Current', comparison.current)}</div>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function sampleIndexAt(t) {
  const first = simulation?.roster?.[0]?.id;
  const n = first ? simulation?.trajectories?.[first]?.length ?? 0 : 0;
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
  const relative = lateral * (simulation.run_side === 'left' ? 1 : -1);
  if (relative < -1.6) return 'backside C';
  if (relative < -0.5) return 'backside A';
  if (relative <= 0.5) return 'play-side A';
  if (relative <= 1.6) return 'play-side B';
  return 'play-side C';
}

function renderLiveSituation(frame) {
  const carrier = simulation.roster.find((p) => simulation.trajectories[p.id]?.[frame]?.hasBall);
  const throwEvent = simulation.events.find((event) => event.type === 'throw' && event.t <= state.t + 1e-6);
  const resolvedPass = simulation.events.some((event) => ['catch', 'interception', 'incomplete_pass'].includes(event.type)
    && event.t <= state.t + 1e-6);
  const carrierRole = carrier?.roleKey ?? (throwEvent && !resolvedPass
    ? `pass in flight to ${simulation.roster.find((p) => p.id === throwEvent.target_id)?.roleKey ?? 'receiver'}` : 'none');
  const first = simulation.roster[0]?.id;
  const terminal = state.t >= (simulation.trajectories[first]?.at(-1)?.t ?? Infinity) - 1e-6;
  el.carrier.textContent = `${terminal ? 'Ball carrier at whistle' : 'Current ball carrier'}: ${carrierRole}`;
  const lane = (carrier && simulation.trajectories[carrier.id]?.[frame]?.lane_local_yards)
    ?? simulation.trajectories['O.RB']?.[frame]?.lane_local_yards;
  const label = simulation.play_call === 'inside_zone' ? 'RB lane' : 'Carrier lane';
  el.lane.textContent = lane == null ? `${label}: awaiting a live carrier` : `${label}: ${laneLabel(lane)} (${lane.toFixed(2)} yd local)`;
}

function renderEventLog() {
  const roles = new Map(simulation.roster.map((p) => [p.id, p.roleKey]));
  const eventRows = simulation.events.filter((event) => event.t <= state.t + 1e-6 && [
    'snap', 'snap_receive', 'handoff', 'lane_read', 'block_engage', 'block_release',
    'shed', 'broken_tackle', 'tackle', 'tackle_start', 'tackle_contact', 'touchdown', 'whistle', 'simulation_failure',
    'route_release', 'route_break', 'qb_read', 'throw', 'catch_attempt', 'catch', 'interception',
    'incomplete_pass', 'pass_deflection', 'pass_out_of_bounds', 'sack_contact', 'qb_scramble',
    'defensive_pass_read', 'pass_protection_set', 'interception_return_touchdown',
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
    else if (event.type === 'route_release') detail = `${roles.get(event.receiver_id)} releases on ${event.route}`;
    else if (event.type === 'route_break') detail = `${roles.get(event.receiver_id)} reaches ${event.route}`;
    else if (event.type === 'qb_read') detail = `${roles.get(event.quarterback_id)} reads ${roles.get(event.target_id)} · separation ${event.separation_yards.toFixed(1)} yd`;
    else if (event.type === 'throw') detail = `${roles.get(event.by)} throws toward ${roles.get(event.target_id)} · ${event.estimated_flight_seconds.toFixed(2)} s in flight`;
    else if (event.type === 'catch_attempt') detail = `${roles.get(event.player_id)} attempts a ${event.contested ? `contested catch vs ${roles.get(event.contesting_player_id)}` : 'catch'}`;
    else if (event.type === 'catch') detail = `${roles.get(event.player_id)} secures the pass`;
    else if (event.type === 'interception') detail = `${roles.get(event.player_id)} intercepts the pass`;
    else if (event.type === 'incomplete_pass') detail = 'Pass hits the ground · incomplete';
    else if (event.type === 'pass_deflection') detail = `${roles.get(event.by)} deflects the pass`;
    else if (event.type === 'pass_out_of_bounds') detail = 'Pass crosses the sideline';
    else if (event.type === 'tackle_contact') detail = `${roles.get(event.defender_id)} reaches ${roles.get(event.carrier_id)} · ${event.source.replaceAll('_', ' ')}`;
    else if (event.type === 'tackle_start') detail = `${roles.get(event.by)} wraps ${roles.get(event.on)}`;
    else if (event.type === 'sack_contact') detail = `${roles.get(event.by)} reaches the quarterback`;
    else if (event.type === 'qb_scramble') detail = `${roles.get(event.quarterback_id)} leaves the pocket · ${event.reason.replaceAll('_', ' ')}`;
    else if (event.type === 'defensive_pass_read') detail = `${roles.get(event.player_id)} recognizes the pass after ${event.reaction_delay_seconds.toFixed(2)} s`;
    else if (event.type === 'pass_protection_set') detail = 'Offensive line sets the pass-protection front';
    else if (event.type === 'interception_return_touchdown') detail = `${roles.get(event.carrier_id)} returns the interception for a touchdown`;
    else if (event.type === 'tackle') detail = `${roles.get(event.by)} wraps ${roles.get(event.on)}`;
    else if (event.type === 'touchdown') detail = `${roles.get(event.carrier_id)} crosses the goal line`;
    else if (event.type === 'whistle') detail = `Whistle · ${event.reason.replaceAll('_', ' ')} · spot ${event.ball_spot.x.toFixed(1)} yd`;
    else if (event.type === 'simulation_failure') detail = `No football result · stopped at ${event.time_limit_seconds}s`;
    return `<li><strong>${event.t.toFixed(2)}s</strong> · ${escapeHtml(detail)}</li>`;
  });
  el.events.innerHTML = lines.length ? lines.join('') : '<li class="muted">No play events yet.</li>';
  el.events.scrollTop = el.events.scrollHeight;
}

function draw(dt) {
  if (!simulation) { renderer.updateCamera(dt, { dir: 1 }); renderer.render(); return; }
  const samples = simulation.trajectories[simulation.roster[0]?.id] ?? [];
  const endT = samples.at(-1)?.t ?? 0;
  state.t = Math.max(0, Math.min(endT, state.t));
  renderer.draw(simulation, state.t, dt);
  renderer.updateCamera(dt, { dir: simulation.direction });
  renderer.render();
  if (state.t >= endT - 1e-6 && !state.resultShown) showResult();
  el.scrub.value = endT > 0 ? String(Math.round(state.t / endT * 1000)) : '0';
  el.clock.textContent = `${state.t.toFixed(2)} s`;
  renderDecisionPanel();
}

function animate(now) {
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, Math.max(0, (now - previousNow) / 1000));
  previousNow = now;
  if (state.playing && simulation) {
    const endT = simulation.trajectories[simulation.roster[0]?.id]?.at(-1)?.t ?? 0;
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
  const endT = simulation.trajectories['O.RB'].at(-1)?.t ?? 0;
  if (state.t >= endT) {
    state.t = 0;
    showPendingResult();
  }
  state.playing = !state.playing;
  el.toggle.textContent = state.playing ? 'Ⅱ Pause' : '▶ Play';
});
el.scrub.addEventListener('input', () => {
  if (!simulation) return;
  const endT = simulation.trajectories['O.RB'].at(-1)?.t ?? 0;
  state.t = endT * Number(el.scrub.value) / 1000;
  state.playing = false;
  el.toggle.textContent = state.t >= endT ? '↻ Replay' : '▶ Play';
  draw(1 / 60);
});
el.focus.addEventListener('change', () => { renderer.select(el.focus.value); renderDecisionPanel(true); });
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
