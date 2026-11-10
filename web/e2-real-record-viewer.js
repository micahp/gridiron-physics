import { assertPlayProjectionMatchesRecord, projectPlay } from './e2-real-record-model.js';

const PIN_URL = 'docs/fixtures/e2/real-record-pin.json';
const $ = (selector) => document.querySelector(selector);
const stateKeys = [
  ['drive_index', 'Drive index'],
  ['quarter', 'Quarter'],
  ['clock_seconds', 'Game clock'],
  ['offense_team', 'Possession'],
  ['defense_team', 'Defense'],
  ['down', 'Down'],
  ['yards_to_go', 'Distance'],
  ['yardline_100', 'Ball spot (yardline_100)'],
  ['home_score', 'LP home score'],
  ['away_score', 'LP away score'],
];
let payload;
let pin;
let currentDriveOffset = 0;
let currentPlayOffset = 0;

function sha256Hex(bytes) {
  return crypto.subtle.digest('SHA-256', bytes).then((digest) =>
    [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''));
}

function clockText(value) {
  if (value === null || value === undefined) return 'Not modelled';
  const seconds = Number(value);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function shown(value, kind = '') {
  if (value === null || value === undefined) return 'Not modelled';
  if (kind === 'clock_seconds') return clockText(value);
  if (kind === 'quarter') return `Q${value}`;
  if (kind === 'yards_to_go') return `${value} yd`;
  return String(value);
}

function putValue(node, field, value, kind = '') {
  node.dataset.field = field;
  node.dataset.value = value === null || value === undefined ? 'null' : String(value);
  node.textContent = shown(value, kind);
}

function addMeta(container, pairs) {
  container.replaceChildren();
  for (const [label, value] of pairs) {
    const term = document.createElement('dt');
    term.textContent = label;
    const definition = document.createElement('dd');
    definition.textContent = value === null || value === undefined ? 'Not modelled' : String(value);
    container.append(term, definition);
  }
}

function listDrives(record) {
  const driveSelect = $('#drive-select');
  const body = $('#drive-rows');
  driveSelect.replaceChildren();
  body.replaceChildren();
  record.drives.forEach((drive, offset) => {
    const first = drive.plays[0];
    const last = drive.plays.at(-1);
    const option = document.createElement('option');
    option.value = String(offset);
    option.textContent = `Drive ${drive.index} · ${drive.offense_team} · Q${drive.quarter_start} · ${drive.plays.length} plays`;
    driveSelect.append(option);

    const row = document.createElement('tr');
    const values = [
      `Drive ${drive.index}`,
      drive.offense_team,
      `Q${drive.quarter_start} ${clockText(drive.clock_start)}`,
      drive.plays.length,
      drive.terminal,
      `Q${drive.end_quarter} ${clockText(drive.end_clock)}`,
    ];
    for (const value of values) {
      const cell = document.createElement('td');
      cell.textContent = String(value);
      row.append(cell);
    }
    row.dataset.driveIndex = String(drive.index);
    row.title = `Open drive ${drive.index}, source sequence ${first.sequence} through ${last.sequence}`;
    row.tabIndex = 0;
    row.addEventListener('click', () => {
      driveSelect.value = String(offset);
      renderDrive(offset);
    });
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        driveSelect.value = String(offset);
        renderDrive(offset);
      }
    });
    body.append(row);
  });
  driveSelect.onchange = () => renderDrive(Number(driveSelect.value));
}

function renderState(container, state, prefix, projection) {
  container.replaceChildren();
  for (const [key, label] of stateKeys) {
    const term = document.createElement('dt');
    term.textContent = label;
    const definition = document.createElement('dd');
    putValue(definition, `${prefix}-${key}`, projection[key], key);
    container.append(term, definition);
  }
}

function renderPlay() {
  const drive = payload.record.drives[currentDriveOffset];
  const play = drive.plays[currentPlayOffset];
  const projection = projectPlay(payload.record, drive, play);
  assertPlayProjectionMatchesRecord(payload.record, drive, play, projection);

  const select = $('#play-select');
  select.value = String(currentPlayOffset);
  for (const [offset, button] of [...$('#play-list').querySelectorAll('button')].entries()) {
    button.setAttribute('aria-current', String(offset === currentPlayOffset));
  }

  putValue($('#final-a'), 'final-points-a', projection.final_points.A);
  putValue($('#final-b'), 'final-points-b', projection.final_points.B);
  $('#event-text').textContent = `${play.event_type} · yards_gained ${play.outcome.yards_gained ?? 'not modelled'} · touchdown ${play.outcome.touchdown}`;
  $('#event-text').dataset.field = 'event-type';
  $('#event-text').dataset.value = play.event_type;
  const has3d = projection.three_d_replay_available;
  $('#replay-availability').textContent = has3d
    ? '3D replay available: explicit LP per-play 3D frame data is present.'
    : '3D replay unavailable for this play: the LP record supplies sampled participants but no explicit 3D trajectory frames.';
  $('#replay-availability').dataset.field = 'three-d-replay-availability';
  $('#replay-availability').dataset.value = has3d ? 'available' : 'unavailable';
  putValue($('#summary-drive-index'), 'summary-drive-index', drive.index);
  putValue($('#summary-state-drive-index'), 'summary-state-drive-index', play.state_before.drive_index);
  putValue($('#summary-possession'), 'summary-possession', play.state_before.offense_team);
  putValue($('#summary-play-count'), 'summary-play-count', drive.plays.length);
  putValue($('#summary-terminal'), 'summary-terminal', drive.terminal);

  renderState($('#before-state'), play.state_before, 'before', projection.before);
  renderState($('#after-state'), play.state_after, 'after', projection.after);
  const field = play.field ?? {};
  const beforeField = field.before ?? {};
  $('#field-assignment').textContent = `${field.assignment_version ?? 'Not provided'} · ${field.source ?? 'source unknown'} · dir ${beforeField.dir ?? 'Not provided'} · los ${beforeField.los ?? 'Not provided'}`;
  $('#field-assignment').dataset.field = 'field-assignment';
  $('#field-assignment').dataset.value = JSON.stringify(field);
  $('#play-json').textContent = JSON.stringify(play, null, 2);
}

function renderDrive(offset, initialPlayOffset = 0) {
  currentDriveOffset = offset;
  currentPlayOffset = initialPlayOffset;
  const drive = payload.record.drives[offset];
  const playSelect = $('#play-select');
  const list = $('#play-list');
  playSelect.replaceChildren();
  list.replaceChildren();
  drive.plays.forEach((play, playOffset) => {
    const option = document.createElement('option');
    option.value = String(playOffset);
    option.textContent = `Play ${play.sequence} · ${play.event_type}`;
    playSelect.append(option);
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = String(play.sequence);
    button.title = `${play.event_type} · ${play.id}`;
    button.addEventListener('click', () => {
      currentPlayOffset = playOffset;
      renderPlay();
    });
    item.append(button);
    list.append(item);
  });
  playSelect.onchange = () => {
    currentPlayOffset = Number(playSelect.value);
    renderPlay();
  };
  renderPlay();
}

function movePlay(delta) {
  const drive = payload.record.drives[currentDriveOffset];
  const nextOffset = currentPlayOffset + delta;
  if (nextOffset >= 0 && nextOffset < drive.plays.length) {
    currentPlayOffset = nextOffset;
  } else {
    const nextDriveOffset = currentDriveOffset + Math.sign(delta);
    if (nextDriveOffset < 0 || nextDriveOffset >= payload.record.drives.length) return;
    const nextPlayOffset = delta > 0 ? 0 : payload.record.drives[nextDriveOffset].plays.length - 1;
    $('#drive-select').value = String(nextDriveOffset);
    renderDrive(nextDriveOffset, nextPlayOffset);
    return;
  }
  renderPlay();
}

function renderGame() {
  const { record } = payload;
  if (record.valid_full_game !== false || payload.valid_full_game !== false) {
    throw new Error('the pinned LP record does not keep valid_full_game=false');
  }
  if (!Array.isArray(record.drives) || !record.drives.length) throw new Error('LP game record has no drives');
  $('#source-mode').textContent = `${record.mode} · retrospective LP sample · not a forecast`;
  $('#load-status').textContent = `LP seed ${record.seed} · ${record.drives.length} drives · ${record.drives.reduce((n, drive) => n + drive.plays.length, 0)} plays · valid_full_game=false`;
  $('#game-flags').textContent = `complete_regulation=${record.complete_regulation} · valid_full_game=false · teams are abstract A/B`;
  putValue($('#final-a'), 'final-points-a', record.points.A);
  putValue($('#final-b'), 'final-points-b', record.points.B);
  addMeta($('#game-meta'), [
    ['LP mode', record.mode], ['Seed', record.seed], ['Simulation ID', record.simulation_id],
    ['Status', record.status], ['Drives', record.drives.length],
    ['Plays', record.drives.reduce((n, drive) => n + drive.plays.length, 0)],
    ['Final quarter', record.final_quarter], ['Final clock seconds', record.final_clock_seconds],
    ['valid_full_game', false], ['Scheduled matchup identity', 'Not supplied by LP'],
  ]);
  addMeta($('#source-meta'), [
    ['LP repository', pin.lp_repository], ['LP commit', pin.lp_commit],
    ['Artifact path', pin.lp_artifact_path], ['Artifact SHA-256', pin.lp_artifact_sha256],
    ['Generated by', payload.generated_by], ['Source window', payload.sources?.window],
    ['Source selection', payload.sources?.drive_pool], ['3D player trajectories', 'Not supplied in this artifact'],
  ]);
  listDrives(record);
  $('#previous-play').addEventListener('click', () => movePlay(-1));
  $('#next-play').addEventListener('click', () => movePlay(1));
  renderDrive(0);
}

async function loadRecord() {
  try {
    const pinResponse = await fetch(PIN_URL, { cache: 'no-store' });
    if (!pinResponse.ok) throw new Error(`pin manifest HTTP ${pinResponse.status}`);
    pin = await pinResponse.json();
    if (pin.schema !== 'gridiron.lp-e2-real-record-pin.v1') throw new Error('unsupported local LP pin schema');
    if (pin.valid_full_game !== false) throw new Error('pin must preserve valid_full_game=false');
    const snapshotPath = String(pin.local_snapshot_path ?? '');
    if (!snapshotPath.startsWith('docs/fixtures/e2/') || snapshotPath.includes('..')) {
      throw new Error('pin snapshot must remain under docs/fixtures/e2');
    }
    const response = await fetch(snapshotPath, { cache: 'no-store' });
    if (!response.ok) throw new Error(`LP source snapshot HTTP ${response.status}`);
    const bytes = await response.arrayBuffer();
    const digest = await sha256Hex(bytes);
    if (digest !== pin.lp_artifact_sha256) throw new Error('LP source snapshot SHA-256 does not match the pin');
    payload = JSON.parse(new TextDecoder().decode(bytes));
    if (payload.schema !== 'lp-e2-game-1' || payload.record?.seed !== 1) throw new Error('LP seed-1 record shape is not supported');
    if (payload.record.valid_full_game !== false || payload.valid_full_game !== false) throw new Error('LP source changed valid_full_game from false');
    if (payload.record.drives.length !== pin.drive_count
        || payload.record.points.A !== pin.points.A || payload.record.points.B !== pin.points.B) {
      throw new Error('LP source game totals differ from the repin summary');
    }
    renderGame();
  } catch (error) {
    $('#load-error').hidden = false;
    $('#load-error').textContent = `LP record not displayed: ${error.message}`;
    $('#load-status').textContent = 'Source pin could not be verified';
  }
}

loadRecord();
