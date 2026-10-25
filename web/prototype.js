import { Renderer } from './render.js';
import { selectPlay, validateDemoSnapshot } from './prototype-model.js';
import { executeSelectedPlay } from './prototype-execution.js';

const $ = (id) => document.getElementById(id);
const snapshotUrl = './data/teams/matchup-2026-10-22.json';
const teamFiles = { NE: './data/playbooks/NE-2025.json', CHI: './data/playbooks/CHI-2025.json' };
const colors = {
  NE: { color: '#002244', alt: '#c60c30', short: 'Patriots' },
  CHI: { color: '#0b162a', alt: '#c83803', short: 'Bears' },
};

let snapshot, playbooks, game, renderer, current = null, selectedPlayer = null, personnelOverrides = {}, lastDemo = null;

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function playerFor(id) {
  return game?.players?.[id];
}

function inspectPlayer(id) {
  const p = playerFor(id);
  if (!p) return;
  selectedPlayer = id;
  renderer?.select(id);
  const ratings = Object.entries(p.ratings || {}).sort(([a], [b]) => a.localeCompare(b));
  $('player-detail').innerHTML = `<strong>${escapeHtml(p.name)}</strong> · ${escapeHtml(p.team)} · ${escapeHtml(p.pos)} · OVR estimate ${p.overall_estimate ?? '—'}<div class="p-muted">${p.height_in} in · ${p.weight_lb} lb · age ${p.age_on_snapshot_date ?? '—'} · status ${escapeHtml(p.availability)}</div><div class="p-muted">${ratings.map(([k, v]) => `${escapeHtml(k)} ${v}`).join(' · ')}</div><div class="p-muted">Confidence: ${Object.entries(p.rating_confidence_by_attribute || {}).filter(([, v]) => v < 0.7).length} of 35 attributes have evidence confidence below 0.70; estimated values are not official ratings.</div>`;
}

function makeGame() {
  const all = Object.values(snapshot.teams).flatMap((team) => team.roster);
  const players = Object.fromEntries(all.map((p) => [p.id, {
    ...p, team: p.team_id, short: p.name, pos: p.rating_position, group: p.rating_group,
  }]));
  game = {
    home: 'CHI', away: 'NE',
    teams: {
      CHI: { ...colors.CHI, name: 'Chicago Bears' },
      NE: { ...colors.NE, name: 'New England Patriots' },
    },
    players,
  };
  renderer = new Renderer($('field'), game, { displayFont: 'Arial, sans-serif' });
  renderer.setCamera('all22');
  renderer.resize();
  window.addEventListener('resize', () => renderer.resize());
  $('field').addEventListener('click', (e) => {
    const id = renderer.pick(e.clientX, e.clientY);
    if (id) inspectPlayer(id);
  });
}

function selectedFormation() {
  return $('formation').value;
}

function populateFormations() {
  const teamId = $('offense').value;
  const book = playbooks[teamId];
  const profile = book.offense.profile;
  const kind = $('kind').value;
  const candidates = book.offense.play_candidates?.[kind]?.candidates || [];
  const availableFormations = new Set(candidates.map((candidate) => candidate.attributes.formation));
  const categories = Object.entries(profile.formation.categories)
    .filter(([name]) => availableFormations.has(name))
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]));
  $('formation').innerHTML = categories.map(([name, item]) => `<option value="${escapeHtml(name)}">${escapeHtml(name)} · ${item.count}/${profile.formation.observed}</option>`).join('');
  populatePlaybookEntries();
  showProfileSummary();
}

function populatePlaybookEntries() {
  const teamId = $('offense').value;
  const kind = $('kind').value;
  const formation = $('formation').value;
  const candidates = (playbooks[teamId].offense.play_candidates?.[kind]?.candidates || [])
    .filter((candidate) => candidate.attributes.formation === formation);
  const previous = $('playbook-entry').value;
  const entryLabel = (candidate) => {
    const a = candidate.attributes;
    const shape = kind === 'run' ? `${a.run_gap} gap · ${a.run_location}` : `${a.pass_length} · ${a.pass_location}`;
    return `${a.shotgun ? 'Shotgun' : 'Under center'} · ${shape} · ${candidate.count}/${candidate.denominator}`;
  };
  $('playbook-entry').innerHTML = candidates.map((candidate) =>
    `<option value="${escapeHtml(candidate.candidate_id)}">${escapeHtml(entryLabel(candidate))}</option>`).join('');
  if (candidates.some((candidate) => candidate.candidate_id === previous)) $('playbook-entry').value = previous;
}

function showProfileSummary() {
  const off = $('offense').value, def = off === 'NE' ? 'CHI' : 'NE';
  const p = playbooks[off].offense.profile;
  const shotgun = p.shotgun.categories.true?.count || 0;
  const shotgunObserved = p.shotgun.observed;
  const formationsObserved = p.formation.observed;
  const formationDen = p.formation.denominator;
  $('summary').innerHTML = `<strong>${snapshot.teams[off].name} offense vs ${snapshot.teams[def].name} defense</strong><br>${p.eligible_scrimmage_plays} eligible 2025 REG plays: ${p.run_play_count} runs and ${p.pass_play_count_including_sacks} passes (sacks included).<br>Shotgun observed on ${shotgun}/${shotgunObserved}; formation charting ${formationsObserved}/${formationDen}. Play-action and motion fields were not present in the pinned PBP schema.<br><span class="p-muted">Both sides use 2026 week-7 roster identities. Only ACT players not on the official inactive list enter the demo unit.</span>`;
}

function updateSubstitutionOptions() {
  if (!lastDemo) return;
  const side = $('sub-side').value;
  const slots = side === 'offense' ? lastDemo.lineups.offense : lastDemo.lineups.defense;
  const teamId = side === 'offense' ? lastDemo.play.off : lastDemo.play.def;
  const slotSelect = $('sub-slot');
  const prior = slotSelect.value;
  slotSelect.innerHTML = Object.keys(slots).map((slot) => `<option value="${escapeHtml(slot)}">${escapeHtml(slot)}</option>`).join('');
  if (Object.keys(slots).includes(prior)) slotSelect.value = prior;
  const playerSelect = $('sub-player');
  const old = playerSelect.value;
  const teamRoster = snapshot.teams[teamId].roster.filter((p) => p.availability === 'available');
  playerSelect.innerHTML = teamRoster.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)} · ${escapeHtml(p.depth_chart_position || p.position)} · OVR ${p.overall_estimate ?? '—'}</option>`).join('');
  if (teamRoster.some((p) => p.id === old)) playerSelect.value = old;
  const currentId = personnelOverrides[side]?.[slotSelect.value] || slots[slotSelect.value];
  if (teamRoster.some((p) => p.id === currentId)) playerSelect.value = currentId;
}

function renderOnField(demo) {
  const lineupRows = [];
  for (const [side, slots] of [[demo.play.off, demo.lineups.offense], [demo.play.def, demo.lineups.defense]]) {
    for (const [slot, id] of Object.entries(slots)) lineupRows.push({ side, slot, player: playerFor(id) });
  }
  lineupRows.sort((a, b) => a.side.localeCompare(b.side) || a.slot.localeCompare(b.slot));
  $('players').innerHTML = lineupRows.map(({ side, slot, player: p }) => `<button data-id="${escapeHtml(p.id)}" title="${escapeHtml(slot)}">${escapeHtml(p.name)} <span>(${escapeHtml(slot)})</span></button><span>${escapeHtml(side)}</span><span>${p.overall_estimate ?? '—'}</span>`).join('');
  $('players').querySelectorAll('button[data-id]').forEach((b) => b.addEventListener('click', () => inspectPlayer(b.dataset.id)));
  if (selectedPlayer && lineupRows.some((r) => r.player.id === selectedPlayer)) inspectPlayer(selectedPlayer);
  else $('player-detail').textContent = 'Select a listed player or click a player on the field to inspect all 35 estimated attributes.';
}

function execute() {
  try {
    const offenseId = $('offense').value;
    const defenseId = offenseId === 'NE' ? 'CHI' : 'NE';
    const demo = selectPlay({
      schema_version: 'gridiron.play_selection.v1', teams: snapshot.teams, playbooks,
      active_rosters: Object.fromEntries([offenseId, defenseId].map((id) => [id,
        snapshot.teams[id].roster.filter((p) => p.availability === 'available').map((p) => p.id)])),
      personnel_availability: { [offenseId]: { inactive_ids: snapshot.teams[offenseId].official_inactives },
        [defenseId]: { inactive_ids: snapshot.teams[defenseId].official_inactives } },
      game_state: { game_id: 'demo-patriots-bears', offense_team_id: offenseId, defense_team_id: defenseId,
        down: 1, distance_yards: 10, yard_line: 45, score: { NE: 0, CHI: 0 }, clock_seconds: 900,
        timeouts: { NE: 3, CHI: 3 }, field_direction: Number($('direction').value) },
      demo_controls: { kind: $('kind').value, formation: selectedFormation(), candidate_id: $('playbook-entry').value,
        personnel_overrides: personnelOverrides },
      contextual_constraints: { supported_personnel: 'engine-compatible units' }, random_seed: $('seed').value,
    });
    lastDemo = demo;
    const slots = [
      ...Object.entries(demo.lineups.offense).map(([slot, id]) => ({ id, team: offenseId, slot })),
      ...Object.entries(demo.lineups.defense).map(([slot, id]) => ({ id, team: defenseId, slot })),
    ];
    renderer.clearTrail();
    renderer.setRoster(slots);
    renderer.setCamera('all22');
    renderer.setLines(demo.play.los, demo.play.los + demo.play.dir * 10);
    const physical = executeSelectedPlay(demo);
    if (physical.failure) throw new Error(`${physical.failure.code}: ${physical.failure.message}`);
    const rec = physical.record;
    current = { rec, dir: demo.play.dir, started: null, duration: (rec.frames.length - 1) / rec.hz };
    renderOnField(demo);
    updateSubstitutionOptions();
    const entry = demo.selection.playbook_entry;
    const srcIds = entry.source_ids.slice(0, 3).map((x) => `${x.game_id} play ${x.play_id}`).join(', ');
    const details = demo.selection.selected_draws;
    const formationCI = demo.selection.formation_observation.ci95_wilson;
    const typeCI = demo.selection.historical_type_marginal_ci95_wilson;
    const drawText = demo.play.kind === 'run'
      ? `Synthetic gain anchor ${demo.play.gain.toFixed(1)} yd · ${demo.play.loc}/${demo.play.gap}`
      : `Synthetic target role ${details.targetSlot} · ${demo.play.air} yd air-depth setting · ${demo.play.loc}`;
    const adaptations = demo.lineups.role_adaptations.length
      ? `<br><strong>Personnel adaptation:</strong> ${demo.lineups.role_adaptations.map((x) => `${escapeHtml(playerFor(x.player_id).name)} assigned to ${escapeHtml(x.engine_slot)} from charted ${escapeHtml(x.roster_role)}; synthetic flex, depth not verified`).join('; ')}` : '';
    const entryCI = entry.ci95_wilson;
    const entryAttrs = Object.entries(entry.attributes).map(([key, value]) => `${key}=${value}`).join(', ');
    $('provenance').innerHTML = `<strong>${escapeHtml(demo.selection.play_id)}</strong><br>Execution provenance: <b>${demo.selection.provenance}</b>; selected catalog entry: <b>${entry.provenance}</b> ${escapeHtml(entry.candidate_id)}.<br>Charted attribute combination: ${escapeHtml(entryAttrs)} · ${entry.count}/${entry.denominator} ${entry.action} plays (${(100 * entry.rate).toFixed(1)}%; 95% Wilson ${(100 * entryCI[0]).toFixed(1)}–${(100 * entryCI[1]).toFixed(1)}%).<br>Formation reference: <b>observed_2025</b> ${escapeHtml(demo.selection.formation_reference)} (${demo.selection.formation_observation.count}/${demo.selection.formation_observation.denominator} charted; 95% Wilson ${(100 * formationCI[0]).toFixed(1)}–${(100 * formationCI[1]).toFixed(1)}%).<br>Historical run/pass marginal: ${demo.selection.historical_type_marginal_rate == null ? 'unknown' : `${(100 * demo.selection.historical_type_marginal_rate).toFixed(1)}%${typeCI ? ` (95% Wilson ${(100 * typeCI[0]).toFixed(1)}–${(100 * typeCI[1]).toFixed(1)}%)` : ''}`}; combined selection probability: unavailable.<br>${escapeHtml(demo.selection.personnel_concept)}<br>${escapeHtml(drawText)}${adaptations}<br><span class="p-muted">Source examples: ${escapeHtml(srcIds)} · seed ${escapeHtml(demo.selection.random_seed)}</span><br><strong>Physics result:</strong> ${escapeHtml(rec.end.reason || 'no whistle')} at ${rec.end.x.toFixed(1)} yd; ${rec.frames.length} trajectory frames, ${rec.events.length} events. Physics status: ${escapeHtml(physical.status)}; this is not a prediction.`;
    $('limitations').innerHTML = `Unsupported for this ${demo.play.kind === 'run' ? 'run' : 'pass'} demo: ${demo.execution_contract.unsupported.map(escapeHtml).join('; ')}. Engine mode: ${demo.execution_contract.mode}. No historical receiver, tackler, catch point, or end spot was read.`;
    $('status').textContent = `${snapshot.teams[offenseId].name} offense / ${snapshot.teams[defenseId].name} defense · ${demo.play.kind === 'run' ? 'run' : 'pass'} visualization ready · deterministic seed ${demo.selection.random_seed}`;
  } catch (error) {
    current = null;
    $('status').textContent = `Scenario unavailable: ${error.message}`;
    $('provenance').textContent = `Unsupported scenario: ${error.message}`;
  }
}

function animate(now) {
  if (renderer) {
    if (current) {
      if (current.started == null) current.started = now;
      const elapsed = Math.min(current.duration, (now - current.started) / 1000);
      renderer.draw(current.rec, current.rec.t0 + elapsed, 1 / 60);
      if (elapsed >= current.duration) current = null;
    }
    renderer.updateCamera(1 / 60, { dir: 1 });
    renderer.render();
  }
  requestAnimationFrame(animate);
}

async function start() {
  try {
    const [snapshotResponse, neResponse, chiResponse] = await Promise.all([
      fetch(snapshotUrl), fetch(teamFiles.NE), fetch(teamFiles.CHI),
    ]);
    if (![snapshotResponse, neResponse, chiResponse].every((r) => r.ok)) throw new Error('one or more pinned JSON assets could not be loaded');
    [snapshot, playbooks] = await Promise.all([
      snapshotResponse.json(), Promise.all([neResponse.json(), chiResponse.json()]).then(([ne, chi]) => ({ NE: ne, CHI: chi })),
    ]);
    validateDemoSnapshot(snapshot);
    makeGame();
    populateFormations();
    $('offense').addEventListener('change', () => { personnelOverrides = {}; populateFormations(); execute(); });
    $('kind').addEventListener('change', () => { populateFormations(); execute(); });
    $('formation').addEventListener('change', () => { populatePlaybookEntries(); execute(); });
    $('playbook-entry').addEventListener('change', execute);
    $('direction').addEventListener('change', execute);
    $('execute').addEventListener('click', execute);
    $('sub-side').addEventListener('change', updateSubstitutionOptions);
    $('sub-slot').addEventListener('change', updateSubstitutionOptions);
    $('apply-sub').addEventListener('click', () => {
      if (!lastDemo) return;
      const side = $('sub-side').value;
      const slot = $('sub-slot').value;
      personnelOverrides = { ...personnelOverrides, [side]: { ...(personnelOverrides[side] || {}), [slot]: $('sub-player').value } };
      execute();
    });
    $('reset-sub').addEventListener('click', () => { personnelOverrides = {}; execute(); });
    $('new-seed').addEventListener('click', () => {
      const input = $('seed');
      input.value = `${input.value || 'seed'}-next`;
      execute();
    });
    $('seed').addEventListener('keydown', (e) => { if (e.key === 'Enter') execute(); });
    $('status').textContent = 'Ready · observed profiles and frozen roster loaded.';
    execute();
    requestAnimationFrame(animate);
  } catch (error) {
    $('status').textContent = `Could not load prototype: ${error.message}`;
  }
}

start();
