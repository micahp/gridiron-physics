import { adaptLpDriveRecord } from './lp-drive-record-adapter.js';

const MANIFEST_URL = 'docs/fixtures/e1/MANIFEST.json';
const FIXTURE_DIR = 'docs/fixtures/e1/';
const $ = (selector) => document.querySelector(selector);
const status = $('#record-status');
const content = $('#record-content');
const errorPanel = $('#load-error');
const picker = $('#fixture-select');

function el(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

function shown(value) {
  if (value === null) return 'Not modelled';
  if (value === undefined) return 'Not provided';
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  return String(value);
}

async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function stateCell(state) {
  const parts = [
    `Q${state.quarter} ${Math.floor(state.clock_seconds / 60)}:${String(state.clock_seconds % 60).padStart(2, '0')}`,
    `${state.offense_team} ball`,
    state.down === null ? 'no scrimmage state' : `${state.down} & ${state.yards_to_go} at ${state.yardline_100}`,
  ];
  return parts.join(' · ');
}

function fieldCell(field) {
  const before = `dir ${shown(field.before.dir)}, LOS ${shown(field.before.los)}`;
  const after = `dir ${shown(field.after.dir)}, LOS ${shown(field.after.los)}`;
  return `${before} → ${after}`;
}

function outcomeCell(play) {
  const flags = [];
  if (play.outcome.touchdown) flags.push('touchdown');
  if (play.outcome.turnover) flags.push('turnover');
  if (play.outcome.punt) flags.push('punt');
  if (play.outcome.field_goal_attempt) flags.push('FG attempt (outcome unknown)');
  if (play.outcome.safety) flags.push('safety');
  if (play.outcome.quarter_change) flags.push('quarter change (same drive)');
  if (play.outcome.clock_clamped_to_zero) flags.push('clock clamped at quarter end');
  const yards = play.outcome.yards_gained === null ? 'yards not recorded' : `${play.outcome.yards_gained} yd`;
  return { yards, flags: flags.length ? flags.join(', ') : 'none' };
}

function renderSummary(drive, parent) {
  const grid = el('dl', undefined, 'meta-grid');
  const rows = [
    ['Plays', drive.recomputed.plays],
    ['Yards', drive.recomputed.yards],
    ['First downs', drive.recomputed.first_downs],
    ['Turnovers', drive.recomputed.turnovers],
    ['Punts', drive.recomputed.punts],
    ['Field-goal attempts (outcome unknown)', drive.recomputed.field_goal_attempts],
    ['Quarter changes (same drive)', drive.recomputed.quarter_changes],
    ['Clock runoff (seconds, sampled)', drive.recomputed.clock_runoff_total_seconds],
    ['Clock-clamped plays (quarter end)', drive.recomputed.clock_clamped_plays],
    ['Plays with negative yards', drive.recomputed.plays_with_negative_yards],
    ['Drive ending', drive.terminal],
  ];
  for (const [label, value] of rows) {
    const cell = el('div', undefined, 'meta-cell');
    cell.append(el('dt', label), el('dd', shown(value)));
    grid.append(cell);
  }
  parent.append(grid);
  parent.append(el('p', drive.terminalText, 'terminal-text'));
}

function renderTimeline(plays, parent) {
  const table = el('table', undefined, 'drive-table');
  const head = el('tr');
  for (const label of ['#', 'Event', 'Before', 'Result', 'After', 'Field (dir, LOS)', 'Ending / notes']) {
    head.append(el('th', label));
  }
  const thead = el('thead');
  thead.append(head);
  table.append(thead);
  const body = el('tbody');
  for (const play of plays) {
    const row = el('tr', undefined, play.quarterChange ? 'quarter-change' : '');
    const result = outcomeCell(play);
    row.append(el('td', String(play.sequence)));
    row.append(el('td', play.eventType));
    row.append(el('td', stateCell(play.stateBefore)));
    row.append(el('td', `${result.yards}; ${result.flags}`));
    row.append(el('td', play.stateAfter.end_of_drive ? `${stateCell(play.stateAfter)} (ends drive)` : stateCell(play.stateAfter)));
    row.append(el('td', fieldCell(play.field)));
    const note = play.terminalText ?? (play.quarterChange ? 'Quarter ends: same drive continues with the same series, no kickoff, and flipped direction.' : '');
    row.append(el('td', note));
    body.append(row);
  }
  table.append(body);
  parent.append(table);
}

function renderRecord(adapted, inputName, verification) {
  status.textContent = adapted.displayLabel;
  errorPanel.hidden = true;
  errorPanel.textContent = '';
  content.replaceChildren();
  $('#input-name').textContent = inputName;

  const meta = el('section', undefined, 'metadata');
  meta.append(el('h2', 'Record'));
  const grid = el('dl', undefined, 'meta-grid');
  const items = [
    ['Simulation', adapted.simulationId],
    ['Mode', adapted.mode],
    ['valid_full_game', adapted.validFullGame],
    ['Seed', adapted.seed],
    ['Model', adapted.modelVersion],
    ['Rules', adapted.rulesVersion],
    ['Field assignment', 'e1-field-end-v2 · authored orientation, not observed'],
    ['Temporal eligibility', adapted.temporalEligibility.status],
    ['Outcome pool digest', adapted.poolDigest ?? 'Not provided'],
    ['Pinned hash', verification],
  ];
  for (const [label, value] of items) {
    const cell = el('div', undefined, 'meta-cell');
    cell.append(el('dt', label), el('dd', shown(value)));
    grid.append(cell);
  }
  meta.append(grid);
  content.append(meta);

  const start = el('section', undefined, 'drive-summary');
  start.append(el('h2', 'Authored start'));
  start.append(el('p', `${adapted.startState.source}. Q${adapted.startState.quarter}, ${adapted.startState.clock} s, ${adapted.startState.offense} ${adapted.startState.down} & ${adapted.startState.togo} at yardline ${adapted.startState.yl}, authored orientation dir ${adapted.startState.dir}.`));
  content.append(start);

  const summary = el('section', undefined, 'drive-summary');
  summary.append(el('h2', 'Drive'));
  renderSummary(adapted.drive, summary);
  content.append(summary);

  const timeline = el('section', undefined, 'timeline');
  timeline.append(el('h2', 'Plays'));
  renderTimeline(adapted.plays, timeline);
  content.append(timeline);

  const gaps = el('section', undefined, 'gaps');
  gaps.append(el('h2', 'Not modelled (as stated by the LP record)'));
  const list = el('ul');
  for (const gap of adapted.gaps) list.append(el('li', gap));
  gaps.append(list);
  content.append(gaps);

  const replay = el('section', undefined, 'replay');
  replay.append(el('h2', 'Replay'));
  replay.append(el('p', `${adapted.replay.status}: ${adapted.replay.reason}`));
  content.append(replay);
}

function showError(error) {
  content.replaceChildren();
  errorPanel.hidden = false;
  errorPanel.textContent = `Record rejected: ${error.message}`;
  status.textContent = 'No record displayed';
}

async function loadFixture(name) {
  try {
    const manifest = await (await fetch(MANIFEST_URL)).json();
    const entry = manifest.fixtures.find((item) => item.file === name);
    if (!entry) throw new Error(`fixture ${name} is not in the pinned manifest`);
    const bytes = await (await fetch(FIXTURE_DIR + name)).arrayBuffer();
    const hash = await sha256Hex(bytes);
    const verification = hash === entry.sha256 ? `matches manifest (${manifest.lp_commit.slice(0, 10)})` : 'does NOT match manifest';
    if (hash !== entry.sha256) throw new Error(`pinned hash mismatch for ${name}`);
    renderRecord(adaptLpDriveRecord(JSON.parse(new TextDecoder().decode(bytes))), `Pinned fixture: ${name}`, verification);
  } catch (error) {
    showError(error);
  }
}

async function populatePicker() {
  const manifest = await (await fetch(MANIFEST_URL)).json();
  for (const entry of manifest.fixtures) {
    const option = el('option', entry.file);
    option.value = entry.file;
    picker.append(option);
  }
  picker.addEventListener('change', () => loadFixture(picker.value));
  const requested = new URLSearchParams(location.search).get('fixture');
  const initial = manifest.fixtures.find((item) => item.file === requested)?.file ?? manifest.fixtures[0].file;
  await loadFixture(initial);
  picker.value = initial;
}

$('#record-file').addEventListener('change', async (event) => {
  const file = event.currentTarget.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    renderRecord(adaptLpDriveRecord(JSON.parse(text)), `Local file: ${file.name}`, 'not pinned (local file)');
  } catch (error) {
    showError(error);
  }
});

populatePicker().catch(showError);
