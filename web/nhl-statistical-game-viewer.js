const MANIFEST_URL = 'docs/fixtures/nhl-statistical/MANIFEST.json';
const FIXTURE_DIRECTORY = 'docs/fixtures/nhl-statistical/';
const EXPECTED_MANIFEST_SHA256 = 'c9565dccdf5272eecb64fd2f2fe5cbe7bfdc31603afbd4e8887ad7b1b5979250';
const EXPECTED_GRIDIRON_BASE = 'c57638471cd35d4f258572fcee538978a466a7e3';
const EXPECTED_LP_COMMIT = '5ac101ff42a4fbdc737f011f5cec3b1b52ee6a83';
const EXPECTED_MODEL = 'empirical-period-bootstrap-v0.1';
const EXPECTED_SCHEMA = 'nhl-statistical-pbp-v0.1';
const EXPECTED_MODE = 'hypothetical_statistical_simulation';

const $ = (selector) => document.querySelector(selector);
const elements = {
  status: $('#load-status'),
  error: $('#load-error'),
  viewer: $('#viewer'),
  fixture: $('#fixture-select'),
  previous: $('#previous'),
  playPause: $('#play-pause'),
  next: $('#next'),
  scrubber: $('#event-scrubber'),
  position: $('#event-position'),
  homeLabel: $('#home-label'),
  awayLabel: $('#away-label'),
  homeScore: $('#home-score'),
  awayScore: $('#away-score'),
  homeSog: $('#home-sog'),
  awaySog: $('#away-sog'),
  finalMarker: $('#final-marker'),
  periodResult: $('#period-result'),
  winner: $('#winner-label'),
  model: $('#model-version'),
  seed: $('#seed-value'),
  eventCount: $('#event-count'),
  periodList: $('#period-list'),
  periodFilter: $('#period-filter'),
  timelineNote: $('#timeline-note'),
  eventList: $('#event-list'),
  selectedTitle: $('#selected-title'),
  selectedMeta: $('#selected-meta'),
  selectedDetails: $('#selected-details'),
  provenance: $('#provenance'),
};

let manifest;
let activeRecord;
let visibleEvents = [];
let selectedEventIndex = 0;
let playbackTimer = null;

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function textElement(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = String(text);
  if (className) node.className = className;
  return node;
}

function setMetadata(container, pairs) {
  container.replaceChildren();
  for (const [name, value] of pairs) {
    container.append(textElement('dt', name), textElement('dd', value));
  }
}

async function sha256Hex(buffer) {
  invariant(globalThis.crypto?.subtle, 'SHA-256 verification needs a secure origin; serve this page from localhost or HTTPS.');
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function fetchPinnedJson(path, expectedHash, label) {
  const response = await fetch(path, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  const actualHash = await sha256Hex(bytes);
  invariant(actualHash === expectedHash, `${label} SHA-256 does not match the pinned manifest.`);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function parseClock(value) {
  invariant(typeof value === 'string' && /^\d{2}:\d{2}$/.test(value), `Unsupported event clock: ${value}`);
  const [minutes, seconds] = value.split(':').map(Number);
  invariant(seconds < 60, `Invalid seconds in event clock: ${value}`);
  return minutes * 60 + seconds;
}

function pair(value, label) {
  invariant(value && Number.isInteger(value.home) && Number.isInteger(value.away), `${label} must contain integer home/away counts.`);
  invariant(value.home >= 0 && value.away >= 0, `${label} cannot be negative.`);
  return { home: value.home, away: value.away };
}

function samePair(actual, expected, label) {
  invariant(actual.home === expected.home && actual.away === expected.away,
    `${label} differs: expected HOME ${expected.home} / AWAY ${expected.away}, got HOME ${actual.home} / AWAY ${actual.away}.`);
}

function periodKey(event) {
  return `${event.period_type}-${event.period_number}`;
}

function expectedPeriodSeconds(type) {
  if (type === 'REG') return 1200;
  if (type === 'OT') return 300;
  if (type === 'SO') return 0;
  throw new Error(`Unsupported period type ${type}.`);
}

function rejectIdentityOrCoordinateFields(value, path = 'record') {
  const identityField = /(player|goalie|goaltender|athlete|shooter|scorer)(id|name|identifier)$/;
  const coordinateFields = new Set([
    'xcoord', 'ycoord', 'xcoordinate', 'ycoordinate', 'coordinates', 'locationxy',
    'playerposition', 'goalieposition', 'goaltenderposition', 'shotlocation', 'locationcoordinates',
  ]);
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectIdentityOrCoordinateFields(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    const normalized = key.toLowerCase().replace(/[^a-z]/g, '');
    invariant(!identityField.test(normalized) && !coordinateFields.has(normalized),
      `${path} contains a forbidden identity/coordinate field: ${key}.`);
    rejectIdentityOrCoordinateFields(nested, `${path}.${key}`);
  }
}

function validateManifest(value) {
  invariant(value?.manifest_version === 'gridiron-nhl-statistical-pbp-viewer-v0.1', 'Unsupported NHL fixture manifest version.');
  invariant(value.gridiron?.base_commit === EXPECTED_GRIDIRON_BASE, 'GridIron base commit differs from the viewer pin.');
  invariant(value.gridiron?.display_contract === EXPECTED_SCHEMA && value.gridiron?.read_only === true,
    'GridIron manifest does not declare the read-only NHL statistical PBP contract.');
  invariant(value.upstream?.repository === 'micahp/legendarypicks', 'Unexpected LP producer repository.');
  invariant(value.upstream?.branch === 'research/nhl-statistical-full-game-2026-10-25', 'Unexpected LP producer branch.');
  invariant(value.upstream?.producer_commit === EXPECTED_LP_COMMIT, 'LP producer commit differs from the pinned revision.');
  invariant(value.upstream?.model_version === EXPECTED_MODEL && value.upstream?.mode === EXPECTED_MODE,
    'LP model version or mode differs from the viewer contract.');
  invariant(value.upstream?.team_labels_are_display_only === true, 'Team labels must remain display-only for this model.');
  invariant(value.upstream?.sportsbook_data_used === false, 'Sportsbook data must not be an input to this statistical event viewer.');
  invariant(Array.isArray(value.fixtures) && value.fixtures.length === 2, 'Expected the frozen regulation and shootout-path fixtures.');
  for (const entry of value.fixtures) {
    invariant(typeof entry.id === 'string' && /^[a-z0-9-]+$/.test(entry.id), 'Fixture ID is invalid.');
    invariant(typeof entry.file === 'string' && entry.file === entry.file.split('/').at(-1), 'Fixture path must be a filename in the pinned fixture directory.');
    invariant(/^[a-f0-9]{64}$/.test(entry.sha256), `Fixture ${entry.id} has no valid SHA-256 pin.`);
    invariant(Number.isInteger(entry.seed), `Fixture ${entry.id} is missing its integer seed.`);
    invariant(entry.home_label === 'HOME' && entry.away_label === 'AWAY', 'Fixtures must use the synthetic HOME/AWAY display labels.');
    invariant(Array.isArray(entry.expected_periods) && entry.expected_periods.length >= 3, `Fixture ${entry.id} has no period expectation.`);
  }
}

function validateRecord(record, entry) {
  invariant(record?.schema_version === EXPECTED_SCHEMA, 'Unsupported LP record schema.');
  invariant(record.mode === EXPECTED_MODE && record.record_complete === true, 'Record is not a complete hypothetical statistical simulation.');
  invariant(record.model_version === EXPECTED_MODEL, 'LP record model version does not match the viewer pin.');
  invariant(record.seed === entry.seed, 'Record seed differs from the fixture manifest.');
  invariant(record.teams?.home === entry.home_label && record.teams?.away === entry.away_label,
    'Record labels differ from the fixture manifest.');
  invariant(record.provenance?.source_player_identity_fields_removed === true, 'LP provenance does not confirm player identity removal.');
  invariant(record.provenance?.source_coordinates_removed === true, 'LP provenance does not confirm source coordinate removal.');
  invariant(/^[a-f0-9]{64}$/.test(record.provenance?.source_manifest_sha256 ?? ''), 'PBP source manifest hash is invalid.');
  invariant(/^[a-f0-9]{64}$/.test(record.provenance?.independent_boxscore_manifest_sha256 ?? ''), 'Independent boxscore manifest hash is invalid.');
  invariant(typeof record.simulation_id === 'string' && record.simulation_id.length > 0, 'Simulation ID is missing.');
  invariant(record.rules_profile?.regulation_periods === 3 && record.rules_profile?.regulation_period_seconds === 1200,
    'Unsupported regulation rules profile.');
  invariant(record.rules_profile?.overtime_period_seconds === 300, 'Unsupported overtime rules profile.');
  invariant(Array.isArray(record.events) && record.events.length > 0, 'The event record is empty.');
  invariant(record.summary?.event_count === record.events.length, 'Event count does not match the event array.');
  rejectIdentityOrCoordinateFields(record.events);

  let score = { home: 0, away: 0 };
  let sog = { home: 0, away: 0 };
  const eventCounts = Object.create(null);
  const regOtGoals = { home: 0, away: 0 };
  const periods = new Map();
  const periodOrder = [];
  let shootoutDecisions = 0;
  let gameEndCount = 0;
  let lastPeriodKey = null;

  for (const [index, event] of record.events.entries()) {
    invariant(event && event.sequence === index + 1, `Event sequence is not contiguous at event ${index + 1}.`);
    invariant(['REG', 'OT', 'SO'].includes(event.period_type), `Unsupported period type at event ${event.sequence}.`);
    const validNumber = event.period_type === 'REG'
      ? event.period_number >= 1 && event.period_number <= 3
      : event.period_type === 'OT' ? event.period_number === 4 : event.period_number === 5;
    invariant(validNumber, `Period number is inconsistent at event ${event.sequence}.`);
    invariant(event.team_side === null || event.team_side === 'home' || event.team_side === 'away',
      `Invalid team side at event ${event.sequence}.`);
    invariant(typeof event.event_type === 'string' && event.event_type.length > 0, `Missing event type at event ${event.sequence}.`);
    invariant(event.details && typeof event.details === 'object' && !Array.isArray(event.details), `Event details are invalid at event ${event.sequence}.`);

    const key = periodKey(event);
    const limit = expectedPeriodSeconds(event.period_type);
    invariant(Number.isInteger(event.clock_elapsed_seconds) && Number.isInteger(event.clock_remaining_seconds),
      `Numeric clock is invalid at event ${event.sequence}.`);
    invariant(event.clock_elapsed_seconds >= 0 && event.clock_remaining_seconds >= 0,
      `Negative clock at event ${event.sequence}.`);
    if (event.period_type === 'SO') {
      invariant(event.clock_elapsed_seconds === 0 && event.clock_remaining_seconds === 0,
        `Shootout clock must be untimed at event ${event.sequence}.`);
    } else {
      invariant(event.clock_elapsed_seconds <= limit && event.clock_remaining_seconds <= limit,
        `Clock exceeds the period limit at event ${event.sequence}.`);
      invariant(event.clock_elapsed_seconds + event.clock_remaining_seconds === limit,
        `Elapsed/remaining clocks do not reconcile at event ${event.sequence}.`);
    }
    invariant(parseClock(event.time_in_period) === event.clock_elapsed_seconds,
      `Displayed elapsed clock differs from numeric clock at event ${event.sequence}.`);
    invariant(parseClock(event.time_remaining) === event.clock_remaining_seconds,
      `Displayed remaining clock differs from numeric clock at event ${event.sequence}.`);

    if (key !== lastPeriodKey) {
      invariant(!periods.has(key), `Period ${key} is noncontiguous in the event stream.`);
      periods.set(key, { elapsed: -1, remaining: limit });
      periodOrder.push(key);
      lastPeriodKey = key;
    }
    const clock = periods.get(key);
    invariant(event.clock_elapsed_seconds >= clock.elapsed, `Event clocks move backward in ${key}.`);
    invariant(event.clock_remaining_seconds <= clock.remaining, `Remaining clock increases in ${key}.`);
    clock.elapsed = event.clock_elapsed_seconds;
    clock.remaining = event.clock_remaining_seconds;

    samePair(pair(event.state_before?.score, `event ${event.sequence} score_before`), score, `event ${event.sequence} score_before`);
    samePair(pair(event.state_before?.sog_event_count, `event ${event.sequence} sog_before`), sog, `event ${event.sequence} sog_before`);

    const side = event.team_side;
    if (event.period_type === 'REG' || event.period_type === 'OT') {
      if (event.event_type === 'goal') {
        invariant(side !== null, `Goal has no team side at event ${event.sequence}.`);
        score[side] += 1;
        sog[side] += 1;
        regOtGoals[side] += 1;
      } else if (event.event_type === 'shot-on-goal') {
        invariant(side !== null, `Shot on goal has no team side at event ${event.sequence}.`);
        sog[side] += 1;
      }
    } else {
      invariant(event.event_type !== 'goal' && event.event_type !== 'shot-on-goal',
        `Shootout attempts cannot be player goal/SOG events at ${event.sequence}.`);
      if (event.event_type === 'shootout-decision') {
        invariant(side !== null, `Shootout decision has no winner at event ${event.sequence}.`);
        invariant(event.details.official_bonus_goal === 1 && event.details.player_goal === false,
          `Shootout decision does not use the official scoreboard-only bonus at event ${event.sequence}.`);
        score[side] += 1;
        shootoutDecisions += 1;
      }
    }
    samePair(pair(event.state_after?.score, `event ${event.sequence} score_after`), score, `event ${event.sequence} score_after`);
    samePair(pair(event.state_after?.sog_event_count, `event ${event.sequence} sog_after`), sog, `event ${event.sequence} sog_after`);
    eventCounts[event.event_type] = (eventCounts[event.event_type] ?? 0) + 1;
    if (event.event_type === 'game-end') gameEndCount += 1;
  }

  const expectedOrder = entry.expected_periods;
  invariant(JSON.stringify(periodOrder) === JSON.stringify(expectedOrder),
    `Observed period order ${periodOrder.join(', ')} differs from fixture expectation.`);
  invariant(periodOrder.slice(0, 3).join(',') === 'REG-1,REG-2,REG-3', 'All three regulation periods are required.');
  invariant(gameEndCount === 1 && record.events.at(-1).event_type === 'game-end', 'The record must end with exactly one game-end event.');
  invariant(periods.get('REG-1')?.elapsed === 1200 && periods.get('REG-2')?.elapsed === 1200
    && periods.get('REG-3')?.elapsed === 1200, 'Regulation must contain three complete 20-minute periods.');
  if (periodOrder.includes('OT-4')) {
    invariant(periods.get('OT-4').elapsed <= 300, 'Overtime exceeds five minutes.');
  }
  if (periodOrder.includes('SO-5')) {
    invariant(periodOrder.includes('OT-4'), 'Shootout cannot occur without overtime.');
    invariant(shootoutDecisions === 1, 'A shootout must have exactly one scoreboard decision.');
    invariant(regOtGoals.home === regOtGoals.away, 'A shootout can only follow a tied regulation/overtime score.');
    invariant(periods.get('OT-4').elapsed === 300, 'A tied overtime must expire before the shootout.');
  } else {
    invariant(shootoutDecisions === 0, 'A shootout decision exists without a shootout period.');
    invariant(regOtGoals.home !== regOtGoals.away, 'A game without a shootout cannot end tied after regulation/overtime.');
  }
  if (periodOrder.includes('OT-4') && !periodOrder.includes('SO-5')) {
    const overtimeGoals = record.events.filter((event) => event.period_type === 'OT' && event.event_type === 'goal');
    invariant(overtimeGoals.length === 1, 'An overtime game without a shootout must have one sudden-death goal.');
  }

  samePair(pair(record.summary.regulation_overtime_score, 'summary regulation_overtime_score'), regOtGoals,
    'summary regulation_overtime_score');
  samePair(pair(record.summary.official_final_score, 'summary official_final_score'), score,
    'summary official_final_score');
  samePair(pair(record.summary.sog_event_counts, 'summary sog_event_counts'), sog,
    'summary sog_event_counts');
  invariant(score.home !== score.away, 'The final official score is tied.');
  invariant(record.summary.winner === (score.home > score.away ? 'home' : 'away'), 'Winner differs from the official final score.');
  const expectedShootoutWinner = shootoutDecisions
    ? (score.home > regOtGoals.home ? 'home' : 'away')
    : null;
  invariant(record.summary.shootout_winner === expectedShootoutWinner, 'Shootout winner differs from the official score transition.');
  invariant(JSON.stringify(Object.entries(eventCounts).sort()) === JSON.stringify(Object.entries(record.summary.event_counts ?? {}).sort()),
    'Event-type counts do not reconcile to the event stream.');
}

function periodLabel(key) {
  const [type, number] = key.split('-');
  if (type === 'REG') return `Period ${number}`;
  if (type === 'OT') return 'Overtime';
  return 'Shootout';
}

function prettyEvent(type) {
  return type.split('-').map((part) => part[0].toUpperCase() + part.slice(1)).join(' ');
}

function sideLabel(side) {
  if (side === 'home') return activeRecord.teams.home;
  if (side === 'away') return activeRecord.teams.away;
  return '—';
}

function finalPeriodLabel(record) {
  if (record.summary.shootout_winner) return 'Final · shootout';
  if (record.events.some((event) => event.period_type === 'OT')) return 'Final · overtime';
  return 'Final · regulation';
}

function populateSummary(record, entry) {
  const finalScore = record.summary.official_final_score;
  const sog = record.summary.sog_event_counts;
  elements.homeLabel.textContent = record.teams.home;
  elements.awayLabel.textContent = record.teams.away;
  elements.homeScore.textContent = finalScore.home;
  elements.awayScore.textContent = finalScore.away;
  elements.homeSog.textContent = `${sog.home} SOG`;
  elements.awaySog.textContent = `${sog.away} SOG`;
  elements.finalMarker.textContent = record.summary.shootout_winner ? 'FINAL · SO' : 'FINAL';
  elements.periodResult.textContent = finalPeriodLabel(record);
  elements.winner.textContent = `${sideLabel(record.summary.winner)} wins`;
  elements.model.textContent = record.model_version;
  elements.seed.textContent = record.seed;
  elements.eventCount.textContent = record.events.length;
  elements.periodList.textContent = entry.expected_periods.map(periodLabel).join(' · ');
  elements.timelineNote.textContent = entry.fixture_role;

  const p = record.provenance;
  setMetadata(elements.provenance, [
    ['LP producer', `${manifest.upstream.producer_commit.slice(0, 12)} · ${manifest.upstream.branch}`],
    ['LP model', record.model_version],
    ['Simulation ID', record.simulation_id],
    ['Seed', record.seed],
    ['PBP manifest SHA-256', p.source_manifest_sha256],
    ['Boxscore manifest SHA-256', p.independent_boxscore_manifest_sha256],
    ['Donor periods', p.donor_blocks_for_audit.length],
    ['Team identity', 'Display labels only'],
  ]);
}

function renderEventList() {
  const selectedPeriod = elements.periodFilter.value;
  visibleEvents = activeRecord.events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => selectedPeriod === 'all' || periodKey(event) === selectedPeriod);
  elements.eventList.replaceChildren();
  elements.scrubber.min = '0';
  elements.scrubber.max = String(Math.max(visibleEvents.length - 1, 0));
  elements.scrubber.disabled = visibleEvents.length < 2;

  for (const { event, index } of visibleEvents) {
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `event-row${event.event_type === 'goal' ? ' is-goal' : ''}`;
    button.dataset.eventIndex = String(index);
    button.setAttribute('aria-current', 'false');
    const period = textElement('span', `${event.period_type} ${event.period_number}`, 'event-sequence');
    const clock = textElement('span', event.time_remaining, 'event-clock');
    const type = textElement('span', prettyEvent(event.event_type), 'event-name');
    const teamClass = event.team_side === 'home' ? 'team-home' : event.team_side === 'away' ? 'team-away' : '';
    const team = textElement('span', sideLabel(event.team_side), `event-team ${teamClass}`.trim());
    const score = textElement('span', `${event.state_after.score.home}–${event.state_after.score.away}`, 'event-score');
    button.append(period, clock, type, team, score);
    button.title = `Event ${event.sequence}, ${periodLabel(periodKey(event))}, ${event.time_remaining} remaining`;
    button.addEventListener('click', () => selectGlobalIndex(index));
    item.append(button);
    elements.eventList.append(item);
  }
  if (visibleEvents.length === 0) {
    elements.eventList.append(textElement('li', 'No events in this period.'));
    return;
  }
  const first = visibleEvents[0].index;
  const isSelectedVisible = visibleEvents.some(({ index }) => index === selectedEventIndex);
  if (!isSelectedVisible) selectedEventIndex = first;
  updateSelectedEvent();
}

function selectGlobalIndex(index) {
  const visibleIndex = visibleEvents.findIndex((entry) => entry.index === index);
  if (visibleIndex < 0) return;
  selectedEventIndex = index;
  elements.scrubber.value = String(visibleIndex);
  updateSelectedEvent();
}

function updateSelectedEvent() {
  const event = activeRecord.events[selectedEventIndex];
  if (!event) return;
  const eventIndexInFilter = visibleEvents.findIndex(({ index }) => index === selectedEventIndex);
  if (eventIndexInFilter >= 0) elements.scrubber.value = String(eventIndexInFilter);
  elements.position.textContent = `Event ${event.sequence} / ${activeRecord.events.length}`;
  elements.previous.disabled = eventIndexInFilter <= 0;
  elements.next.disabled = eventIndexInFilter < 0 || eventIndexInFilter >= visibleEvents.length - 1;
  elements.eventList.querySelectorAll('[data-event-index]').forEach((button) => {
    button.setAttribute('aria-current', String(Number(button.dataset.eventIndex) === selectedEventIndex));
  });
  elements.selectedTitle.textContent = prettyEvent(event.event_type);
  const elapsed = `${Math.floor(event.clock_elapsed_seconds / 60)}:${String(event.clock_elapsed_seconds % 60).padStart(2, '0')}`;
  const remaining = `${Math.floor(event.clock_remaining_seconds / 60)}:${String(event.clock_remaining_seconds % 60).padStart(2, '0')}`;
  setMetadata(elements.selectedMeta, [
    ['Event sequence', `${event.sequence} of ${activeRecord.events.length}`],
    ['Period', periodLabel(periodKey(event))],
    ['Time in period', elapsed],
    ['Time remaining', remaining],
    ['Event team', sideLabel(event.team_side)],
    ['Score before', `${event.state_before.score.home}–${event.state_before.score.away}`],
    ['Score after', `${event.state_after.score.home}–${event.state_after.score.away}`],
    ['SOG after', `${event.state_after.sog_event_count.home}–${event.state_after.sog_event_count.away}`],
  ]);
  elements.selectedDetails.textContent = JSON.stringify(event.details, null, 2);
}

function stopPlayback() {
  if (playbackTimer !== null) {
    clearInterval(playbackTimer);
    playbackTimer = null;
  }
  elements.playPause.textContent = 'Play';
}

function stepVisibleCursor(amount) {
  const visibleIndex = visibleEvents.findIndex(({ index }) => index === selectedEventIndex);
  const nextIndex = visibleIndex + amount;
  if (nextIndex < 0 || nextIndex >= visibleEvents.length) {
    stopPlayback();
    return;
  }
  selectGlobalIndex(visibleEvents[nextIndex].index);
  if (nextIndex === visibleEvents.length - 1) stopPlayback();
}

function startPlayback() {
  if (playbackTimer !== null) {
    stopPlayback();
    return;
  }
  if (visibleEvents.length < 2) return;
  if (visibleEvents.findIndex(({ index }) => index === selectedEventIndex) === visibleEvents.length - 1) {
    selectGlobalIndex(visibleEvents[0].index);
  }
  elements.playPause.textContent = 'Pause';
  playbackTimer = setInterval(() => stepVisibleCursor(1), 350);
}

function preparePeriodFilter(record) {
  const keys = [...new Set(record.events.map(periodKey))];
  elements.periodFilter.replaceChildren();
  elements.periodFilter.append(new Option('All periods', 'all'));
  for (const key of keys) elements.periodFilter.append(new Option(periodLabel(key), key));
  elements.periodFilter.value = 'all';
}

async function loadSelectedFixture() {
  stopPlayback();
  elements.viewer.hidden = true;
  elements.status.hidden = false;
  elements.status.classList.remove('error');
  elements.status.textContent = 'Verifying the pinned LP event record…';
  elements.error.hidden = true;
  try {
    const entry = manifest.fixtures.find((fixture) => fixture.id === elements.fixture.value);
    invariant(entry, 'Selected fixture is not in the frozen manifest.');
    const record = await fetchPinnedJson(FIXTURE_DIRECTORY + entry.file, entry.sha256, 'LP statistical game fixture');
    validateRecord(record, entry);
    activeRecord = record;
    selectedEventIndex = 0;
    elements.status.textContent = `Integrity verified · ${entry.id} · ${entry.sha256.slice(0, 16)}… · read-only`;
    preparePeriodFilter(record);
    populateSummary(record, entry);
    renderEventList();
    elements.viewer.hidden = false;
    elements.previous.disabled = true;
    elements.next.disabled = visibleEvents.length < 2;
    elements.playPause.disabled = visibleEvents.length < 2;
  } catch (error) {
    elements.status.hidden = true;
    elements.error.textContent = `Record rejected; nothing was rendered. ${error.message}`;
    elements.error.hidden = false;
    elements.viewer.hidden = true;
  }
}

async function start() {
  try {
    invariant(EXPECTED_MANIFEST_SHA256 !== 'PENDING_MANIFEST_SHA256', 'The viewer manifest checksum has not been frozen.');
    manifest = await fetchPinnedJson(MANIFEST_URL, EXPECTED_MANIFEST_SHA256, 'NHL fixture manifest');
    validateManifest(manifest);
    elements.fixture.replaceChildren();
    for (const entry of manifest.fixtures) {
      elements.fixture.append(new Option(`${entry.id} · seed ${entry.seed}`, entry.id));
    }
    elements.fixture.disabled = false;
    elements.fixture.addEventListener('change', loadSelectedFixture);
    elements.periodFilter.addEventListener('change', () => {
      stopPlayback();
      renderEventList();
    });
    elements.previous.addEventListener('click', () => stepVisibleCursor(-1));
    elements.next.addEventListener('click', () => stepVisibleCursor(1));
    elements.playPause.addEventListener('click', startPlayback);
    elements.scrubber.addEventListener('input', () => {
      stopPlayback();
      const index = Number(elements.scrubber.value);
      if (visibleEvents[index]) selectGlobalIndex(visibleEvents[index].index);
    });
    await loadSelectedFixture();
  } catch (error) {
    elements.status.hidden = true;
    elements.error.textContent = `Viewer initialization failed. ${error.message}`;
    elements.error.hidden = false;
  }
}

start();
