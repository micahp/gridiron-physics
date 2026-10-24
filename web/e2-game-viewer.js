import { adaptLpGamePayload } from './lp-game-record-adapter.js';
import { renderE3Comparison } from './e3-game-comparison.js';
import {
  MATCHUP_INDEX_URL,
  MATCHUPS,
  findMatchup,
  matchupFixture,
  matchupLpSource,
} from './e2-matchup-index.js';

const MANIFEST_URL = 'docs/fixtures/e2/MANIFEST.json';
const FIXTURE_DIR = 'docs/fixtures/e2/';
const $ = (selector) => document.querySelector(selector);
const status = $('#record-status');
const errorPanel = $('#load-error');
const validationPanel = $('#validation');
const viewerContent = $('#viewer-content');
let adapted;
let activeMatchupLabel = null;

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function shown(value) {
  if (value === null) return 'Not modelled';
  if (value === undefined) return 'Not provided';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

function formatClock(seconds) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function appendMeta(container, pairs) {
  container.replaceChildren();
  for (const [label, value] of pairs) {
    container.append(el('dt', label), el('dd', shown(value)));
  }
}

function renderMetadata(verification, sourcePayloadSha256) {
  const record = adapted.record;
  $('#mode-label').textContent = activeMatchupLabel
    ? `${activeMatchupLabel} · ${adapted.displayLabel}`
    : adapted.displayLabel;
  status.textContent = `${record.status} · Q${record.final_quarter} ${formatClock(record.final_clock_seconds)} · seed ${record.seed}`;
  $('#score-a').textContent = record.points.A;
  $('#score-b').textContent = record.points.B;
  $('#game-state').textContent = `complete_regulation=${record.complete_regulation} · valid_full_game=${record.valid_full_game} · tied=${record.tied}`;
  appendMeta($('#record-meta'), [
    ['LP mode', record.mode],
    ['Seed', record.seed],
    ['Game simulation ID', record.simulation_id],
    ['Drives', adapted.drives.length],
    ['Plays', adapted.sourcePlayCount],
    ['LP producer commit', adapted.source.base_commit],
    ['Fixture hash', verification],
    ['LP source payload SHA-256 (index/manifest pin)', sourcePayloadSha256],
    ['Producer tree', adapted.source.producer_worktree_dirty ? 'dirty; file hashes pinned' : 'committed'],
    ['Team identities', 'A/B labels only'],
  ]);
  $('#producer-note').textContent = adapted.source.producer_worktree_dirty
    ? 'Producer code was uncommitted when sampled; its file hashes are pinned, but this handoff is not stable.'
    : `Producer code is pinned at LP commit ${adapted.source.base_commit}. PBP outcomes are retrospective samples, not a forecast.`;
}

function renderValidation() {
  const messages = [];
  if (!adapted.validation.passed) {
    messages.push('LP source validation findings:');
    for (const finding of adapted.validation.findings) messages.push(finding);
  }
  if (!adapted.sharedV1Audit.conforms) {
    messages.push('Shared GRIDIRON-CONTRACT-v1 gate: NOT CONFORMING. This E2 transport view preserves the retrospective source; it does not promote it to a pregame simulation.');
    for (const violation of adapted.sharedV1Audit.violations) messages.push(violation);
  }
  validationPanel.hidden = messages.length === 0;
  validationPanel.classList.toggle('error', !adapted.validation.passed || !adapted.sharedV1Audit.conforms);
  validationPanel.replaceChildren();
  for (const message of messages) validationPanel.append(el('p', message));
}

function renderLedgerAndKickoffs() {
  $('#ledger-json').textContent = JSON.stringify(adapted.record.ledger, null, 2);
  const list = $('#kickoff-list');
  list.replaceChildren();
  for (const kickoff of adapted.record.kickoffs) {
    list.append(el('li', `Q${kickoff.quarter} ${kickoff.kind}: ${kickoff.kicking_team} kicks to ${kickoff.receiving_team}; after drive ${kickoff.after_drive}; source ${kickoff.source?.game_id ?? 'unknown'} play ${kickoff.source?.play_id ?? 'unknown'}`));
  }
  const unsupported = $('#unsupported-list');
  unsupported.replaceChildren();
  for (const rule of adapted.record.unsupported_rules) unsupported.append(el('li', rule));
}

function renderTeamStats() {
  const body = $('#team-stats');
  body.replaceChildren();
  for (const [team, stats] of Object.entries(adapted.record.stats?.team ?? {})) {
    for (const [name, value] of Object.entries(stats)) {
      const row = document.createElement('tr');
      row.append(el('td', team), el('td', name), el('td', shown(value)));
      body.append(row);
    }
  }
}

function renderPlay(playEntry, drive) {
  const play = playEntry.source;
  appendMeta($('#play-meta'), [
    ['Game sequence', playEntry.gamePlayIndex],
    ['LP play ID', playEntry.sourceId],
    ['Drive / game sequence', `${drive.index} / ${playEntry.sourceSequence}`],
    ['Event', play.event_type],
    ['Before', `Q${play.state_before.quarter} ${formatClock(play.state_before.clock_seconds)} · ${play.state_before.offense_team} · ${play.state_before.down} & ${play.state_before.yards_to_go} · ydline100 ${play.state_before.yardline_100}`],
    ['After', `Q${play.state_after.quarter} ${formatClock(play.state_after.clock_seconds)} · ${play.state_after.offense_team} · ${play.state_after.down} & ${play.state_after.yards_to_go} · ydline100 ${play.state_after.yardline_100}`],
    ['Field assignment', `${play.field?.assignment_version ?? 'Not provided'} · ${play.field?.source ?? 'source unknown'}`],
    ['Participant attribution', play.participants?.attribution],
  ]);
  $('#play-json').textContent = JSON.stringify({ outcome: play.outcome, participants: play.participants,
    decision: play.decision, sampling: play.sampling, field: play.field }, null, 2);
}

function renderDrive(driveIndex) {
  const drive = adapted.drives[driveIndex];
  const driveSelect = $('#drive-select');
  const playSelect = $('#play-select');
  const list = $('#play-list');
  const priorPoints = { A: 0, B: 0 };
  for (const previous of adapted.record.drives.slice(0, drive.index - 1)) {
    if (previous.points_scored_on_drive) priorPoints[previous.points_scored_on_drive.team] += previous.points_scored_on_drive.points;
  }
  const afterPoints = { ...priorPoints };
  if (drive.source.points_scored_on_drive) {
    afterPoints[drive.source.points_scored_on_drive.team] += drive.source.points_scored_on_drive.points;
  }
  $('#drive-summary').textContent = `Drive ${drive.index} · ${drive.offenseTeam} · Q${drive.quarterStart} ${formatClock(drive.clockStart)} · ${drive.plays.length} plays · ${drive.terminal} · score before ${priorPoints.A}–${priorPoints.B}, after ${afterPoints.A}–${afterPoints.B}`;
  playSelect.replaceChildren();
  list.replaceChildren();
  for (const [offset, entry] of drive.plays.entries()) {
    const option = el('option', `Play ${entry.sourceSequence} · ${entry.source.event_type}`);
    option.value = String(offset);
    playSelect.append(option);
    const item = document.createElement('li');
    const button = el('button', String(entry.sourceSequence));
    button.type = 'button';
    button.title = `${entry.source.event_type} · ${entry.sourceId}`;
    button.addEventListener('click', () => {
      playSelect.value = String(offset);
      renderPlay(entry, drive);
      for (const other of list.querySelectorAll('button')) other.setAttribute('aria-current', String(other === button));
    });
    item.append(button);
    list.append(item);
  }
  const choosePlay = () => {
    const offset = Number(playSelect.value);
    const entry = drive.plays[offset];
    renderPlay(entry, drive);
    [...list.querySelectorAll('button')].forEach((button, index) => button.setAttribute('aria-current', String(index === offset)));
  };
  playSelect.onchange = choosePlay;
  choosePlay();
}

function showError(error) {
  errorPanel.hidden = false;
  errorPanel.textContent = `Record rejected: ${error.message}`;
  status.textContent = 'No record displayed';
  viewerContent.hidden = true;
}

async function loadFixture() {
  try {
    const manifestResponse = await fetch(MANIFEST_URL);
    if (!manifestResponse.ok) throw new Error(`manifest HTTP ${manifestResponse.status}`);
    const baseManifest = await manifestResponse.json();
    const requestedMatchup = new URLSearchParams(globalThis.window?.location?.search ?? '').get('matchup');
    let manifest = baseManifest;
    let matchupRow = null;
    if (requestedMatchup) {
      const indexResponse = await fetch(MATCHUP_INDEX_URL, { cache: 'no-store' });
      if (!indexResponse.ok) throw new Error(`LP matchup index HTTP ${indexResponse.status}`);
      const index = await indexResponse.json();
      matchupRow = findMatchup(index, requestedMatchup);
      if (!matchupRow) throw new Error(`LP matchup index has no ${requestedMatchup} entry`);
      const indexedFixture = matchupFixture(matchupRow);
      if (!indexedFixture) throw new Error('LP matchup entry does not pin a game payload file and SHA-256');
      manifest = {
        ...baseManifest,
        lp_source: matchupLpSource(index, matchupRow, {}),
      };
      manifest.fixtures = [indexedFixture];
      activeMatchupLabel = MATCHUPS.find((item) => item.slug === requestedMatchup)?.label ?? requestedMatchup;
    }
    const entry = manifest.fixtures[0];
    if (!entry) throw new Error('the game fixture is missing from its manifest');
    const fixturePath = entry.file.startsWith('docs/') ? entry.file : FIXTURE_DIR + entry.file;
    const fixtureResponse = await fetch(fixturePath);
    if (!fixtureResponse.ok) throw new Error(`fixture HTTP ${fixtureResponse.status}`);
    const bytes = await fixtureResponse.arrayBuffer();
    const hash = await sha256Hex(bytes);
    if (hash !== entry.sha256) throw new Error('pinned fixture SHA-256 mismatch');
    let payload = JSON.parse(new TextDecoder().decode(bytes));
    if (!payload.record && payload.game && typeof payload.game === 'object') payload = { ...payload, record: payload.game };
    if (!payload.record && payload.drives) payload = { ...payload, record: payload };
    if (!payload.record) throw new Error('indexed payload has no game record');
    payload.source = payload.source ?? {};
    let upstream = null;
    let upstreamHash = 'not separately supplied';
    if (entry.upstream_source_file && entry.upstream_source_sha256) {
      const sourcePath = entry.upstream_source_file.startsWith('docs/')
        ? entry.upstream_source_file
        : FIXTURE_DIR + entry.upstream_source_file;
      const upstreamResponse = await fetch(sourcePath);
      if (!upstreamResponse.ok) throw new Error(`LP source payload HTTP ${upstreamResponse.status}`);
      const upstreamBytes = await upstreamResponse.arrayBuffer();
      upstreamHash = await sha256Hex(upstreamBytes);
      if (upstreamHash !== entry.upstream_source_sha256
          || (payload.source?.payload_sha256 && payload.source.payload_sha256 !== upstreamHash)) {
        throw new Error('pinned LP source payload SHA-256 mismatch');
      }
      upstream = JSON.parse(new TextDecoder().decode(upstreamBytes));
      if (canonicalJson(upstream.record) !== canonicalJson(payload.record)) {
        throw new Error('Gridiron transport record differs from the pinned LP source record');
      }
    } else if (requestedMatchup) {
      const declaredSourceHash = matchupRow.source_payload_sha256 ?? matchupRow.lp_payload_sha256;
      if (declaredSourceHash && payload.source?.payload_sha256 !== declaredSourceHash) {
        throw new Error('LP source payload SHA-256 differs from the matchup index');
      }
      upstream = { record: payload.record, sources: payload.sources ?? matchupRow.sources ?? {} };
      upstreamHash = declaredSourceHash ?? payload.source?.payload_sha256 ?? 'not separately supplied';
    } else {
      throw new Error('manifest does not pin the original LP source payload');
    }
    const lpSource = manifest.lp_source ?? {};
    if ((lpSource.base_commit && payload.source.base_commit !== lpSource.base_commit)
        || (lpSource.branch && payload.source.branch !== lpSource.branch)
        || (payload.source.payload_path && lpSource.payload_file && payload.source.payload_path !== lpSource.payload_file)) {
      throw new Error('LP producer revision or source path does not match its matchup index');
    }
    if (!requestedMatchup) {
      const conversionSource = lpSource.conversion_source_script_sha256;
      if (lpSource.conversion_source_script_commit !== lpSource.base_commit
          || !/^[a-f0-9]{64}$/i.test(conversionSource ?? '')) {
        throw new Error('conversion source semantics are not pinned to the LP producer commit');
      }
      const auditPayload = {
        ...payload,
        sources: upstream.sources,
        source: {
          ...payload.source,
          producer_file_sha256: {
            ...payload.source.producer_file_sha256,
            [lpSource.conversion_source_script_file]: conversionSource,
          },
        },
      };
      await renderE3Comparison(auditPayload);
    } else {
      $('#e3-comparison').hidden = true;
      const sides = matchupRow.score_sides ?? matchupRow.team_labels ?? matchupRow.teams ?? {};
      const a = sides.A ?? sides.a ?? matchupRow.team_a ?? matchupRow.teamA;
      const b = sides.B ?? sides.b ?? matchupRow.team_b ?? matchupRow.teamB;
      const label = (value) => typeof value === 'object' ? value.name ?? value.abbr ?? value.code : value;
      if (a) $('#team-a-label').textContent = label(a);
      if (b) $('#team-b-label').textContent = label(b);
    }
    adapted = adaptLpGamePayload(payload);
    viewerContent.hidden = false;
    renderMetadata(`matches index (${hash.slice(0, 12)})`, upstreamHash);
    renderValidation();
    renderLedgerAndKickoffs();
    renderTeamStats();
    const driveSelect = $('#drive-select');
    for (const [offset, drive] of adapted.drives.entries()) {
      const option = el('option', `Drive ${drive.index} · ${drive.offenseTeam} · Q${drive.quarterStart} · ${drive.plays.length} plays`);
      option.value = String(offset);
      driveSelect.append(option);
    }
    driveSelect.addEventListener('change', () => renderDrive(Number(driveSelect.value)));
    renderDrive(0);
  } catch (error) {
    showError(error);
  }
}

loadFixture();
