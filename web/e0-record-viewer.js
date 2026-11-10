import { adaptLpPlayRecord, displayRecordValue } from './lp-play-record-adapter.js';

const FIXTURE_URL = 'docs/fixtures/nfl-seq-e0-play-record-seed1042.json';
const $ = (selector) => document.querySelector(selector);
const status = $('#record-status');
const content = $('#record-content');
const errorPanel = $('#load-error');

const STATE_FIELDS = [
  ['quarter', 'Quarter'],
  ['clock_seconds', 'Period clock (seconds)'],
  ['offense_team', 'Offense'],
  ['defense_team', 'Defense'],
  ['down', 'Down'],
  ['yards_to_go', 'Yards to go'],
  ['yardline_100', 'Yards to opponent goal'],
  ['home_score', 'Home score'],
  ['away_score', 'Away score'],
  ['home_timeouts', 'Home timeouts'],
  ['away_timeouts', 'Away timeouts'],
  ['drive_index', 'Drive index'],
  ['end_of_drive', 'Drive ending'],
];

const OUTCOME_FIELDS = [
  ['yards_gained', 'Yards gained'],
  ['touchdown', 'Touchdown'],
  ['turnover', 'Turnover'],
  ['safety', 'Safety'],
  ['passer_id', 'Passer ID'],
  ['receiver_id', 'Receiver ID'],
  ['rusher_id', 'Rusher ID'],
  ['clock_runoff_seconds', 'Clock runoff (seconds)'],
  ['sampled_from.game_id', 'Sample source game'],
  ['sampled_from.play_id', 'Sample source play'],
  ['sampled_from.game_date', 'Sample source date'],
];

function textElement(tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

function getPath(object, dottedPath) {
  let current = object;
  for (const part of dottedPath.split('.')) {
    if (current === null || current === undefined) return current;
    current = current[part];
  }
  return current;
}

function appendFieldList(parent, values, fields) {
  const dl = document.createElement('dl');
  dl.className = 'fields';
  for (const [key, label] of fields) {
    const dt = textElement('dt', label);
    const value = displayRecordValue(getPath(values, key));
    const dd = textElement('dd', value, value === 'Not modelled' || value === 'Not provided' ? 'not-modelled' : '');
    dl.append(dt, dd);
  }
  parent.append(dl);
}

function appendMetadata(parent, fields) {
  const grid = document.createElement('dl');
  grid.className = 'meta-grid';
  for (const [label, value] of fields) {
    const cell = document.createElement('div');
    cell.className = 'meta-cell';
    cell.append(textElement('dt', label));
    cell.append(textElement('dd', displayRecordValue(value)));
    grid.append(cell);
  }
  parent.append(grid);
}

function showNullPaths(parent, paths) {
  if (paths.length === 0) return;
  const details = document.createElement('details');
  details.className = 'missing';
  details.append(textElement('summary', `Fields recorded as null (${paths.length})`));
  const list = document.createElement('ul');
  for (const path of paths) list.append(textElement('li', path));
  details.append(list);
  parent.append(details);
}

function renderRecord(record, inputName) {
  const adapted = adaptLpPlayRecord(record);
  status.textContent = adapted.displayLabel;
  errorPanel.hidden = true;
  errorPanel.textContent = '';
  content.replaceChildren();
  $('#input-name').textContent = inputName;

  const metadata = document.createElement('section');
  metadata.className = 'metadata';
  metadata.append(textElement('h2', 'Simulation record'));
  appendMetadata(metadata, [
    ['Mode', adapted.mode],
    ['Valid full game', adapted.validFullGame],
    ['Simulation ID', adapted.simulationId],
    ['Game ID', adapted.gameId],
    ['Model version', adapted.modelVersion],
    ['Rules version', adapted.rulesVersion],
    ['Seed', adapted.seed],
    ['Home team', adapted.teams.home],
    ['Away team', adapted.teams.away],
    ['Outcome provenance', adapted.provenance.outcomes],
    ['Lineup provenance', adapted.provenance.lineups],
    ['Route provenance', adapted.provenance.routes],
    ['Motion provenance', adapted.provenance.motion],
    ['As-of verification', adapted.provenance.sources_as_of_verified],
    ['As-of UTC', adapted.provenance.as_of_utc],
    ['Snapshot hash', adapted.provenance.snapshot_hash],
  ]);
  metadata.append(textElement('p', adapted.startStateSource ?? 'Start state source: Not provided', 'muted'));
  content.append(metadata);

  const temporal = adapted.temporalEligibility;
  if (temporal) {
    const temporalBox = document.createElement('section');
    temporalBox.className = 'notice';
    temporalBox.append(textElement('h2', 'Temporal eligibility'));
    temporalBox.append(textElement('p', `Status: ${displayRecordValue(temporal.status)}. ${displayRecordValue(temporal.cell_rows_dated_after_start)} of ${displayRecordValue(temporal.cell_rows_total)} outcome-pool rows postdate the start game.`));
    temporalBox.append(textElement('p', `Start game date: ${displayRecordValue(temporal.start_game_date)} · As-of date: ${displayRecordValue(temporal.as_of_date)}`, 'muted'));
    content.append(temporalBox);
  }

  const pool = document.createElement('section');
  pool.className = 'metadata';
  pool.append(textElement('h2', 'Outcome pool provenance'));
  appendMetadata(pool, [
    ['Seasons', adapted.outcomePool.seasons],
    ['Selection cell', adapted.outcomePool.cell],
    ['Cell rows', adapted.outcomePool.cell_size],
    ['Event shares', adapted.outcomePool.event_shares],
    ['Excluded start game', adapted.outcomePool.start_game_excluded],
    ['Pool SHA-256', adapted.outcomePool.pool_sha256],
    ['Excluded-from-pool counts', adapted.excludedFromPool],
  ]);
  content.append(pool);

  const replay = document.createElement('section');
  replay.className = 'replay';
  replay.append(textElement('h2', '3D replay status'));
  replay.append(textElement('p', adapted.replay.reason));
  content.append(replay);

  for (const play of adapted.plays) {
    const card = document.createElement('article');
    card.className = 'play-card';
    const head = document.createElement('header');
    head.className = 'play-head';
    head.append(textElement('h3', `Play ${play.sequence}: ${play.eventType}`));
    head.append(textElement('span', play.id, 'play-id'));
    card.append(head);

    const states = document.createElement('div');
    states.className = 'state-grid';
    for (const [heading, state] of [['State before', play.stateBefore], ['State after', play.stateAfter]]) {
      const panel = document.createElement('section');
      panel.className = 'state-panel';
      panel.append(textElement('h4', heading));
      appendFieldList(panel, state, STATE_FIELDS);
      states.append(panel);
    }
    card.append(states);

    const field = document.createElement('section');
    field.className = 'state-panel field-panel';
    field.append(textElement('h4', 'Field coordinates · authored, not observed'));
    const afterField = play.field.after;
    appendMetadata(field, [
      ['Assignment version', play.field.assignment_version],
      ['Assignment source', play.field.source],
      ['Before direction', play.field.before.dir],
      ['Before LOS (x)', play.field.before.los],
      ['After direction', afterField === null ? null : afterField?.dir],
      ['After LOS (x)', afterField === null ? null : afterField?.los],
    ]);
    field.append(textElement('p', 'LOS is shown only under the authored demo convention; it is not observed field orientation or an observed play result.', 'muted'));
    card.append(field);

    const bottom = document.createElement('div');
    bottom.className = 'play-bottom';
    const decisionPanel = document.createElement('section');
    decisionPanel.className = 'state-panel';
    decisionPanel.append(textElement('h4', 'Decision'));
    appendMetadata(decisionPanel, Object.entries(play.decision));
    const outcomePanel = document.createElement('section');
    outcomePanel.className = 'state-panel';
    outcomePanel.append(textElement('h4', 'Outcome'));
    appendFieldList(outcomePanel, play.outcome, OUTCOME_FIELDS);
    bottom.append(decisionPanel, outcomePanel);
    card.append(bottom);
    showNullPaths(card, play.nullPaths);
    content.append(card);
  }

  if (adapted.gaps.length) {
    const gaps = document.createElement('section');
    gaps.className = 'gaps';
    gaps.append(textElement('h2', 'Declared limitations'));
    const list = document.createElement('ul');
    for (const item of adapted.gaps) list.append(textElement('li', item));
    gaps.append(list);
    content.append(gaps);
  } else {
    const gaps = document.createElement('section');
    gaps.className = 'gaps';
    gaps.append(textElement('h2', 'Declared limitations'));
    gaps.append(textElement('p', adapted.gaps === null ? 'Not modelled' : 'No declared limitations'));
    content.append(gaps);
  }

  const summary = document.createElement('section');
  summary.className = 'metadata';
  summary.append(textElement('h2', 'Record summary'));
  appendMetadata(summary, [
    ['Home score', adapted.summary.home_score],
    ['Away score', adapted.summary.away_score],
    ['Valid full game', adapted.summary.valid_full_game],
    ['Player stats', adapted.summary.player_stats],
    ['Team stats', adapted.summary.team_stats],
  ]);
  content.append(summary);
}

async function loadPinnedFixture() {
  $('#record-file').value = '';
  try {
    const response = await fetch(FIXTURE_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Fixture request failed (${response.status})`);
    renderRecord(await response.json(), 'Pinned LP seed-1042 fixture');
  } catch (error) {
    showError(error);
  }
}

function showError(error) {
  content.replaceChildren();
  errorPanel.hidden = false;
  errorPanel.textContent = `Record rejected: ${error.message}`;
  status.textContent = 'No record displayed';
}

$('#reload-fixture').addEventListener('click', loadPinnedFixture);
$('#record-file').addEventListener('change', async (event) => {
  const file = event.currentTarget.files?.[0];
  if (!file) return;
  try {
    renderRecord(JSON.parse(await file.text()), `Local file: ${file.name}`);
  } catch (error) {
    showError(error);
  }
});

loadPinnedFixture();
