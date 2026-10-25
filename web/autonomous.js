import { createInsideZoneRoster, simulateInsideZone } from '../engine/autonomous-run.js';
import { Renderer } from './render.js';

const $ = (selector) => document.querySelector(selector);
const el = {
  canvas: $('#field'), snap: $('#snap'), front: $('#front'), side: $('#run-side'), seed: $('#seed'),
  ol: $('#ol-rating'), dl: $('#dl-rating'), rb: $('#rb-rating'), scrub: $('#scrub'), toggle: $('#toggle'),
  speed: $('#speed'), clock: $('#clock'), result: $('#result-main'), detail: $('#result-detail'),
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
let state = { t: 0, playing: false, camera: 'broadcast', lastDecisionFrame: -1, resultShown: false };
let previousNow = 0;

function setRatingReadout(input, id) { $(`#${id}`).value = input.value; }
el.ol.addEventListener('input', () => setRatingReadout(el.ol, 'ol-value'));
el.dl.addEventListener('input', () => setRatingReadout(el.dl, 'dl-value'));
el.rb.addEventListener('input', () => setRatingReadout(el.rb, 'rb-value'));

function currentRatings() {
  const ratings = {};
  for (const role of ['LT', 'LG', 'C', 'RG', 'RT', 'TE', 'WR1', 'WR2', 'WR3']) {
    ratings[`O.${role}`] = { RBK: Number(el.ol.value), IBL: Number(el.ol.value), STR: Math.min(99, Number(el.ol.value) + 3) };
  }
  for (const p of createInsideZoneRoster({ front: el.front.value }).filter((player) => player.team === 'D')) {
    ratings[`D.${p.slot}`] = { BSH: Number(el.dl.value), TAK: Number(el.dl.value), STR: Math.min(99, Number(el.dl.value) + 3) };
  }
  ratings['O.RB'] = { BCV: Number(el.rb.value), AWR: Number(el.rb.value), AGI: Number(el.rb.value) };
  return ratings;
}

function createPlay() {
  const seed = el.seed.value.trim() || 'inside-zone-demo-1';
  simulation = simulateInsideZone({
    seed,
    front: el.front.value,
    runSide: el.side.value,
    los: 35,
    dir: 1,
    ballY: 26.667,
    ratingOverrides: currentRatings(),
  });
  game.players = Object.fromEntries(createInsideZoneRoster({
    seed, front: el.front.value, ratingOverrides: currentRatings(),
  }).map((p) => [p.id, p]));
  renderer.setRoster(simulation.roster);
  renderer.setLines(simulation.line_of_scrimmage, null);
  renderer.clearTrail();
  renderer.select(null);
  renderer.setCamera(state.camera);

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
  const wins = simulation.blockers.filter((b) => b.won);
  const who = simulation.roster.find((p) => p.id === simulation.tackle_id);
  if (!outcome) {
    el.result.textContent = 'Unresolved at the simulation time cap';
    el.detail.textContent = 'No dead-ball spot is reported because no terminal event occurred.';
    el.label.textContent = 'No whistle · increase the playback to inspect the developing play.';
    return;
  }
  const yards = outcome.yards_gained;
  const signed = `${yards >= 0 ? '+' : ''}${yards.toFixed(1)} yd`;
  const reason = outcome.reason === 'tackle' ? `Tackle for ${signed}`
    : outcome.reason === 'touchdown' ? `Touchdown · ${signed}`
      : `${outcome.reason.replaceAll('_', ' ')} · ${signed}`;
  el.result.textContent = reason;
  const tackler = who ? ` · ${who.roleKey} made contact` : '';
  el.detail.textContent = `Dead-ball spot ${outcome.spot.x.toFixed(1)} yd · ${wins.length}/${simulation.blockers.length} blockers won${tackler}`;
  el.label.textContent = `${outcome.reason.replaceAll('_', ' ')} · ${signed} · ball spot came from simulated forward progress`;
}

function showPendingResult() {
  state.resultShown = false;
  el.result.textContent = 'Play in progress';
  el.detail.textContent = 'Gain, dead-ball spot and contact resolve from this simulation.';
  el.label.textContent = 'Snap · watch the players react to the developing play.';
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
  const selectedId = el.focus.value || 'O.RB';
  const selected = simulation.trajectories[selectedId]?.[frame];
  if (selected) {
    const role = simulation.roster.find((p) => p.id === selectedId)?.roleKey ?? selectedId;
    el.focusText.innerHTML = `<b>${escapeHtml(role)}</b> · ${escapeHtml(selected.assignment)}<br><span>${escapeHtml(selected.decision)}</span>`;
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

function draw(dt) {
  if (!simulation) { renderer.updateCamera(dt, { dir: 1 }); renderer.render(); return; }
  const samples = simulation.trajectories['O.RB'];
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
    const endT = simulation.trajectories['O.RB'].at(-1)?.t ?? 0;
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
